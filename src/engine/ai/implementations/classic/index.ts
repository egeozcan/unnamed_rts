import { GameState, Action, PlayerState, Vector } from '../../../types.js';
import { createEntityCache, getEnemiesOf, getBuildingsForOwner, getUnitsForOwner } from '../../../perf.js';
import {
    getAIState,
    resetAIState,
    findBaseCenter,
    updateEnemyBaseLocation,
    updateEnemyIntelligence,
    updateVengeance,
    getPersonalityForPlayer
} from '../../state.js';
import {
    AI_CONSTANTS,
    getDifficultyModifiers
} from '../../utils.js';
import {
    detectThreats,
    updateStrategy,
    evaluateInvestmentPriority
} from '../../planning.js';
import {
    handleEconomy,
    handleEmergencySell,
    handleLastResortSell,
    handleAllInSell,
    handleBuildingPlacement,
    handleBuildingRepair,
    handleMCVOperations,
    handleHarvesterGathering,
    handleInductionRigOperations
} from '../../action_economy.js';
import {
    handleAttack,
    handleDefense,
    handleHarass,
    handleRally,
    handleScouting,
    handleMicro,
    handleHarvesterSafety,
    handleHarvesterSuicideAttack,
    handleAirStrikes,
    handleDemoTruckAssault,
    handleUnitRepair,
    handleEngineerCapture
} from '../../action_combat.js';
import { updateHarvesterAI } from '../../harvester/index.js';
import { AIImplementation } from '../../contracts.js';
import { RULES } from '../../../../data/schemas/index.js';

const GREEDY_RUSH_MIN_TICK = 900; // 15 seconds
const GREEDY_RUSH_MIN_COMBAT_UNITS = 3;
const GREEDY_RUSH_VENGEANCE_BOOST = 250;
const NON_COMBAT_UNIT_KEYS = new Set(['harvester', 'mcv', 'engineer', 'induction_rig']);

function isCombatUnitKey(key: string): boolean {
    if (NON_COMBAT_UNIT_KEYS.has(key)) {
        return false;
    }
    const unitData = RULES.units[key];
    return Boolean(unitData && unitData.damage > 0);
}

function isProducingCombatUnits(player: PlayerState | undefined): boolean {
    if (!player) return false;

    const productionKeys: string[] = [];
    const queues = [player.queues.infantry, player.queues.vehicle, player.queues.air];

    for (const queue of queues) {
        if (queue.current) {
            productionKeys.push(queue.current);
        }
        if (queue.queued && queue.queued.length > 0) {
            productionKeys.push(...queue.queued);
        }
    }

    return productionKeys.some(isCombatUnitKey);
}

function isProducingDefenseBuildings(player: PlayerState | undefined): boolean {
    if (!player) return false;

    const queuedBuildingKeys: string[] = [];
    if (player.queues.building.current) {
        queuedBuildingKeys.push(player.queues.building.current);
    }
    if (player.queues.building.queued && player.queues.building.queued.length > 0) {
        queuedBuildingKeys.push(...player.queues.building.queued);
    }
    if (player.readyToPlace) {
        queuedBuildingKeys.push(player.readyToPlace);
    }

    return queuedBuildingKeys.some(key => Boolean(RULES.buildings[key]?.isDefense));
}

type GreedyRushTarget = {
    ownerId: number;
    targetPos: Vector;
};

function findGreedyRushTarget(
    state: GameState,
    cache: ReturnType<typeof createEntityCache>,
    playerId: number,
    baseCenter: Vector
): GreedyRushTarget | null {
    if (state.tick < GREEDY_RUSH_MIN_TICK) {
        return null;
    }

    const ownerIds = Array.from(cache.byOwner.keys()).filter(ownerId => ownerId !== playerId && ownerId !== -1);
    let bestTarget: GreedyRushTarget | null = null;
    let bestDistance = Infinity;

    for (const ownerId of ownerIds) {
        const enemyBuildings = getBuildingsForOwner(cache, ownerId);
        const enemyUnits = getUnitsForOwner(cache, ownerId);
        if (enemyBuildings.length === 0) continue;

        const hasRefinery = enemyBuildings.some(b => b.key === 'refinery');
        const hasProduction = enemyBuildings.some(b => b.key === 'barracks' || b.key === 'factory' || b.key === 'airforce_command');
        if (!hasRefinery || !hasProduction) {
            continue;
        }

        const enemyCombatUnits = enemyUnits.filter(u => isCombatUnitKey(u.key));
        const enemyDefenses = enemyBuildings.filter(b => Boolean(RULES.buildings[b.key]?.isDefense));
        const enemyPlayerState = state.players[ownerId];

        if (enemyCombatUnits.length > 0) continue;
        if (enemyDefenses.length > 0) continue;
        if (isProducingCombatUnits(enemyPlayerState)) continue;
        if (isProducingDefenseBuildings(enemyPlayerState)) continue;

        const primaryTarget =
            enemyBuildings.find(b => b.key === 'conyard') ||
            enemyBuildings.find(b => b.key === 'factory') ||
            enemyBuildings.find(b => b.key === 'barracks') ||
            enemyBuildings.find(b => b.key === 'refinery') ||
            enemyBuildings[0];

        const distanceToTarget = primaryTarget.pos.dist(baseCenter);
        if (distanceToTarget < bestDistance) {
            bestDistance = distanceToTarget;
            bestTarget = {
                ownerId,
                targetPos: primaryTarget.pos
            };
        }
    }

    return bestTarget;
}

/**
 * Main AI Logic Loop.
 * This is the existing/default ("classic") implementation and preserves legacy behavior.
 */
export function computeClassicAiActions(state: GameState, playerId: number): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const aiState = getAIState(playerId);
    const personality = getPersonalityForPlayer(playerId);

    // PERFORMANCE OPTIMIZATION: Use cached entity lookups
    const cache = createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId);

    // Check for elimination (no buildings AND no MCV)
    const hasMCV = myUnits.some(u => u.key === 'mcv');
    if (myBuildings.length === 0 && !hasMCV) {
        return actions;
    }

    const harvesters = myUnits.filter(u => u.key === 'harvester');
    // Exclude harvesters, MCVs, engineers, and demo trucks from regular combat units
    // Demo trucks have specialized assault logic, engineers have capture logic
    const combatUnits = myUnits.filter(u =>
        u.key !== 'harvester' &&
        u.key !== 'mcv' &&
        u.key !== 'engineer' &&
        u.key !== 'demo_truck'
    );

    const baseCenter = findBaseCenter(myBuildings);

    // CRITICAL INTELLIGENCE: Update every tick for accurate decision-making
    updateEnemyBaseLocation(aiState, enemies);
    updateEnemyIntelligence(aiState, enemies, state.tick);
    updateVengeance(state, playerId, aiState, [...myBuildings, ...myUnits]);

    // PERFORMANCE: Stagger AI computation across ticks
    // Each AI player computes on different ticks to distribute CPU load
    // Always compute on early ticks (< AI_TICK_INTERVAL) to ensure immediate game start response
    const tickOffset = playerId % AI_CONSTANTS.AI_TICK_INTERVAL;
    const isFullComputeTick = state.tick < AI_CONSTANTS.AI_TICK_INTERVAL ||
        state.tick % AI_CONSTANTS.AI_TICK_INTERVAL === tickOffset;

    // Get difficulty modifiers for this player
    const difficultyMods = getDifficultyModifiers(player.difficulty);

    // CRITICAL REACTIONS: Detect threats on compute ticks or when threats exist
    // Skip expensive O(enemies × buildings) calculation when idle
    const shouldDetectThreats = isFullComputeTick ||
        aiState.threatsNearBase.length > 0 ||
        aiState.harvestersUnderAttack.length > 0;

    if (shouldDetectThreats) {
        const threats = detectThreats(
            baseCenter,
            harvesters,
            enemies,
            myBuildings,
            player.difficulty,  // Pass difficulty for threat detection radius scaling
            state.tick  // Pass current tick to determine recent attacks
        );
        aiState.threatsNearBase = threats.threatsNearBase;
        aiState.harvestersUnderAttack = threats.harvestersUnderAttack;
    }
    const threatsNearBase = aiState.threatsNearBase;

    // Track when threats first appeared (for reaction delay)
    if (threatsNearBase.length > 0 && aiState.lastThreatDetectedTick === 0) {
        aiState.lastThreatDetectedTick = state.tick;
    } else if (threatsNearBase.length === 0) {
        aiState.lastThreatDetectedTick = 0;  // Reset when threats clear
    }

    // DUMMY AI: Skip all combat reactions - just build and gather
    const isDummy = player.difficulty === 'dummy';

    // Always handle critical combat reactions (except for dummy AI)
    if (!isDummy) {
        actions.push(...handleHarvesterSafety(state, playerId, harvesters, combatUnits, baseCenter, enemies, aiState, cache, player.difficulty));

        // Defense with reaction delay - easier AI takes longer to respond
        const reactionDelayPassed = threatsNearBase.length > 0 &&
            (state.tick - aiState.lastThreatDetectedTick >= difficultyMods.reactionDelay);

        if (reactionDelayPassed && combatUnits.length > 0) {
            actions.push(...handleDefense(state, playerId, aiState, combatUnits, baseCenter, personality));
        }
    }

    // FULL AI COMPUTATION: Only on designated ticks
    if (!isFullComputeTick) {
        // On non-compute ticks, only run critical reactions (above)
        return actions;
    }

    // 2. Full AI Computation (strategy, economy, production)

    // Update Strategy
    updateStrategy(
        aiState,
        state.tick,
        myBuildings,
        combatUnits,
        enemies,
        threatsNearBase,
        personality,
        player.credits,
        player.difficulty  // Pass difficulty for strategy cooldown and attack threshold scaling
    );

    // Evaluate Investment Priority
    evaluateInvestmentPriority(
        state,
        playerId,
        aiState,
        myBuildings,
        combatUnits,
        enemies,
        baseCenter
    );

    const greedyRushTarget = findGreedyRushTarget(state, cache, playerId, baseCenter);
    const shouldGreedyRush = !isDummy &&
        aiState.strategy !== 'all_in' &&
        threatsNearBase.length === 0 &&
        combatUnits.length >= GREEDY_RUSH_MIN_COMBAT_UNITS &&
        greedyRushTarget !== null;

    if (shouldGreedyRush && greedyRushTarget) {
        aiState.strategy = 'attack';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = combatUnits.map(unit => unit.id);
        aiState.harassGroup = [];
        aiState.enemyBaseLocation = greedyRushTarget.targetPos;
        aiState.vengeanceScores[greedyRushTarget.ownerId] = Math.max(
            aiState.vengeanceScores[greedyRushTarget.ownerId] || 0,
            GREEDY_RUSH_VENGEANCE_BOOST
        );
    }

    // 3. Execute Actions based on State

    // --- ECONOMY & PRODUCTION ---
    if (player.readyToPlace) {
        actions.push(...handleBuildingPlacement(state, playerId, myBuildings, player));
    }

    actions.push(...handleEmergencySell(state, playerId, myBuildings, player, aiState));
    actions.push(...handleLastResortSell(state, playerId, myBuildings, player, aiState));
    actions.push(...handleAllInSell(state, playerId, myBuildings, aiState));
    actions.push(...handleEconomy(state, playerId, myBuildings, player, personality, aiState, enemies));
    actions.push(...handleBuildingRepair(state, playerId, myBuildings, player, aiState));
    actions.push(...handleMCVOperations(state, playerId, aiState, myBuildings, myUnits));
    actions.push(...handleInductionRigOperations(state, playerId, myBuildings, myUnits)); // Deploy rigs on wells
    actions.push(...handleHarvesterGathering(state, playerId, harvesters, aiState.harvestersUnderAttack, aiState, player.difficulty)); // Gather resources

    // Update harvester AI (medium/hard only)
    const harvesterResult = updateHarvesterAI(
        aiState.harvesterAI,
        playerId,
        state,
        player.difficulty
    );
    aiState.harvesterAI = harvesterResult.harvesterAI;
    actions.push(...harvesterResult.actions);

    // --- COMBAT & UNIT CONTROL ---
    // Dummy AI skips all combat - just rallies units near base
    if (isDummy) {
        // Rally units near base but don't attack
        actions.push(...handleRally(state, playerId, aiState, combatUnits, baseCenter, enemies));
        return actions;
    }

    // Defense already handled above for critical response
    if (aiState.strategy === 'defend') {
        // Defense group management (non-critical parts)
        aiState.defenseGroup = aiState.defenseGroup || [];
    } else {
        aiState.defenseGroup = [];
    }

    if (aiState.strategy === 'attack' || aiState.strategy === 'all_in') {
        const ignoreSizeLimit = aiState.strategy === 'all_in' || shouldGreedyRush;
        actions.push(...handleAttack(state, playerId, aiState, combatUnits, enemies, baseCenter, personality, ignoreSizeLimit));

        if (aiState.strategy === 'all_in') {
            actions.push(...handleHarvesterSuicideAttack(state, playerId, harvesters, enemies, combatUnits));
        }
    }

    if (aiState.strategy === 'harass') {
        actions.push(...handleHarass(state, playerId, aiState, combatUnits, enemies));
    }

    if (aiState.strategy === 'buildup') {
        actions.push(...handleRally(state, playerId, aiState, combatUnits, baseCenter, enemies));
    }

    actions.push(...handleScouting(state, playerId, aiState, combatUnits, enemies, baseCenter));
    actions.push(...handleMicro(state, combatUnits, enemies, baseCenter, personality, myBuildings, player.difficulty));

    // Retreat critically damaged units to service depot for repairs
    actions.push(...handleUnitRepair(state, playerId, combatUnits, myBuildings));

    // Engineer capture missions - send engineers to capture valuable enemy buildings
    const engineers = myUnits.filter(u => u.key === 'engineer' && !u.dead);
    if (engineers.length > 0) {
        actions.push(...handleEngineerCapture(state, playerId, aiState, engineers, enemies, baseCenter));
    }

    // Air strikes with harriers - can trigger regardless of ground strategy
    // Harriers are opportunistic and don't require ground army coordination
    if (enemies.length > 0) {
        actions.push(...handleAirStrikes(state, playerId, enemies, aiState));
    }

    // Demo truck assault - send suicide trucks to high-value targets
    // Demo trucks are tactical weapons that deal massive splash damage
    if (enemies.length > 0) {
        actions.push(...handleDemoTruckAssault(state, playerId, enemies, aiState));
    }

    return actions;
}

export const classicAIImplementation: AIImplementation = {
    id: 'classic',
    name: 'Classic',
    description: 'Current built-in RTS AI behavior.',
    computeActions: ({ state, playerId }) => computeClassicAiActions(state, playerId),
    reset: resetAIState
};

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
    getDifficultyModifiers,
    hasProductionBuildingFor,
    checkPrerequisites
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
const LOW_DEFENSE_RUSH_MIN_TICK = 600; // 10 seconds - hit eco greed before tank mass snowballs
const LOW_DEFENSE_RUSH_MAX_DEFENSES = 1;
const LOW_DEFENSE_RUSH_MIN_UNIT_LEAD = 1;
const LOW_DEFENSE_RUSH_MIN_RATIO = 1.35;
const LOW_DEFENSE_RUSH_MIN_BOOM_SCORE = 20;
const LOW_DEFENSE_RUSH_VENGEANCE_BOOST = 225;
const BOOM_RUSH_MIN_TICK = 1200; // 20 seconds - needs more scouting data
const BOOM_RUSH_MIN_BOOM_SCORE = 30;
const BOOM_RUSH_MAX_DEFENSES = 1;
const BOOM_RUSH_VENGEANCE_BOOST = 200;
const ECO_COUNTER_RUSH_MIN_TICK = 540; // 9 seconds
const ECO_COUNTER_RUSH_MIN_COMBAT_UNITS = 2;
const ECO_COUNTER_RUSH_MAX_DEFENSES = 1;
const ECO_COUNTER_RUSH_VENGEANCE_BOOST = 260;
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

function hasClearArmyAdvantage(myCombatCount: number, enemyCombatCount: number): boolean {
    if (myCombatCount < GREEDY_RUSH_MIN_COMBAT_UNITS) {
        return false;
    }

    if (enemyCombatCount === 0) {
        return true;
    }

    const unitLead = myCombatCount - enemyCombatCount;
    if (unitLead >= LOW_DEFENSE_RUSH_MIN_UNIT_LEAD) {
        return true;
    }

    return myCombatCount / enemyCombatCount >= LOW_DEFENSE_RUSH_MIN_RATIO;
}

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

function findLowDefenseRushTarget(
    state: GameState,
    cache: ReturnType<typeof createEntityCache>,
    playerId: number,
    baseCenter: Vector,
    myCombatCount: number,
    aiState: ReturnType<typeof getAIState>
): GreedyRushTarget | null {
    if (state.tick < LOW_DEFENSE_RUSH_MIN_TICK || myCombatCount < GREEDY_RUSH_MIN_COMBAT_UNITS) {
        return null;
    }

    const ownerIds = Array.from(cache.byOwner.keys()).filter(ownerId => ownerId !== playerId && ownerId !== -1);
    let bestTarget: GreedyRushTarget | null = null;
    let bestScore = -Infinity;

    for (const ownerId of ownerIds) {
        const enemyBuildings = getBuildingsForOwner(cache, ownerId);
        const enemyUnits = getUnitsForOwner(cache, ownerId);
        if (enemyBuildings.length === 0) continue;

        const hasRefinery = enemyBuildings.some(b => b.key === 'refinery');
        const hasProduction = enemyBuildings.some(b => b.key === 'barracks' || b.key === 'factory' || b.key === 'airforce_command');
        if (!hasRefinery || !hasProduction) continue;

        const enemyCombatUnits = enemyUnits.filter(u => isCombatUnitKey(u.key));
        const enemyPlayerState = state.players[ownerId];
        const enemyIsArming = isProducingCombatUnits(enemyPlayerState) || enemyCombatUnits.length > 0;
        if (!enemyIsArming) continue;
        if (isProducingDefenseBuildings(enemyPlayerState)) continue;
        if (!hasClearArmyAdvantage(myCombatCount, enemyCombatUnits.length)) continue;

        const enemyDefenses = enemyBuildings.filter(b => Boolean(RULES.buildings[b.key]?.isDefense));
        if (enemyDefenses.length > LOW_DEFENSE_RUSH_MAX_DEFENSES) continue;

        const enemyRefineries = enemyBuildings.filter(b => b.key === 'refinery').length;
        const enemyHarvesters = enemyUnits.filter(u => u.key === 'harvester').length;
        const boomScore = aiState.enemyIntelligence.boomScores[ownerId] || 0;
        const hasEcoAllInSignal =
            boomScore >= LOW_DEFENSE_RUSH_MIN_BOOM_SCORE ||
            enemyRefineries >= 3 ||
            (enemyRefineries >= 2 && enemyHarvesters >= 4);

        if (!hasEcoAllInSignal) continue;

        const primaryTarget =
            enemyBuildings.find(b => b.key === 'conyard') ||
            enemyBuildings.find(b => b.key === 'factory') ||
            enemyBuildings.find(b => b.key === 'refinery') ||
            enemyBuildings[0];

        const unitLead = Math.max(0, myCombatCount - enemyCombatUnits.length);
        const defensePenalty = enemyDefenses.length * 20;
        const score =
            boomScore * 8 +
            unitLead * 40 +
            enemyRefineries * 20 +
            enemyHarvesters * 8 -
            defensePenalty -
            primaryTarget.pos.dist(baseCenter);

        if (score > bestScore) {
            bestScore = score;
            bestTarget = {
                ownerId,
                targetPos: primaryTarget.pos
            };
        }
    }

    return bestTarget;
}

type BoomRushTarget = {
    ownerId: number;
    targetPos: Vector;
};

function findBoomingRushTarget(
    state: GameState,
    cache: ReturnType<typeof createEntityCache>,
    playerId: number,
    baseCenter: Vector,
    aiState: ReturnType<typeof getAIState>
): BoomRushTarget | null {
    if (state.tick < BOOM_RUSH_MIN_TICK) {
        return null;
    }

    const myCombatUnits = getUnitsForOwner(cache, playerId).filter(u => isCombatUnitKey(u.key));
    if (myCombatUnits.length < GREEDY_RUSH_MIN_COMBAT_UNITS) {
        return null;
    }

    const ownerIds = Array.from(cache.byOwner.keys()).filter(ownerId => ownerId !== playerId && ownerId !== -1);
    let bestTarget: BoomRushTarget | null = null;
    let bestScore = -Infinity;

    for (const ownerId of ownerIds) {
        const boomScore = aiState.enemyIntelligence.boomScores[ownerId] || 0;
        if (boomScore < BOOM_RUSH_MIN_BOOM_SCORE) continue;

        const enemyBuildings = getBuildingsForOwner(cache, ownerId);
        const enemyUnits = getUnitsForOwner(cache, ownerId);
        if (enemyBuildings.length === 0) continue;

        const enemyCombatUnits = enemyUnits.filter(u => isCombatUnitKey(u.key));
        const enemyDefenses = enemyBuildings.filter(b => Boolean(RULES.buildings[b.key]?.isDefense));

        // Allow some combat units, but we must outnumber them
        if (enemyCombatUnits.length >= myCombatUnits.length) continue;
        // Allow up to 1 defense building
        if (enemyDefenses.length > BOOM_RUSH_MAX_DEFENSES) continue;

        const primaryTarget =
            enemyBuildings.find(b => b.key === 'conyard') ||
            enemyBuildings.find(b => b.key === 'factory') ||
            enemyBuildings.find(b => b.key === 'barracks') ||
            enemyBuildings.find(b => b.key === 'refinery') ||
            enemyBuildings[0];

        const distanceToTarget = primaryTarget.pos.dist(baseCenter);
        // Score by boom level + proximity (closer is better)
        const score = boomScore * 10 - distanceToTarget;
        if (score > bestScore) {
            bestScore = score;
            bestTarget = {
                ownerId,
                targetPos: primaryTarget.pos
            };
        }
    }

    return bestTarget;
}

function findEcoCounterRushTarget(
    state: GameState,
    cache: ReturnType<typeof createEntityCache>,
    playerId: number,
    baseCenter: Vector
): GreedyRushTarget | null {
    if (state.tick < ECO_COUNTER_RUSH_MIN_TICK) {
        return null;
    }

    const ecoOpponents = Object.values(state.players).filter(
        p => p.id !== playerId && p.isAi && p.aiImplementationId === 'eco_tank_all_in'
    );
    if (ecoOpponents.length === 0) {
        return null;
    }

    let bestTarget: GreedyRushTarget | null = null;
    let bestScore = -Infinity;

    for (const opponent of ecoOpponents) {
        const enemyBuildings = getBuildingsForOwner(cache, opponent.id);
        if (enemyBuildings.length === 0) continue;

        const enemyUnits = getUnitsForOwner(cache, opponent.id);
        const enemyDefenses = enemyBuildings.filter(b => Boolean(RULES.buildings[b.key]?.isDefense));
        if (enemyDefenses.length > ECO_COUNTER_RUSH_MAX_DEFENSES) continue;

        const enemyRefineries = enemyBuildings.filter(b => b.key === 'refinery').length;
        const enemyHarvesters = enemyUnits.filter(u => u.key === 'harvester').length;
        const enemyFactoryCount = enemyBuildings.filter(b => b.key === 'factory').length;
        const primaryTarget =
            enemyBuildings.find(b => b.key === 'factory') ||
            enemyBuildings.find(b => b.key === 'conyard') ||
            enemyBuildings.find(b => b.key === 'refinery') ||
            enemyBuildings[0];

        const score =
            enemyRefineries * 36 +
            enemyHarvesters * 10 +
            enemyFactoryCount * 20 -
            enemyDefenses.length * 60 -
            primaryTarget.pos.dist(baseCenter);

        if (score > bestScore) {
            bestScore = score;
            bestTarget = {
                ownerId: opponent.id,
                targetPos: primaryTarget.pos
            };
        }
    }

    return bestTarget;
}

function appendEcoCounterFallbackProduction(
    playerId: number,
    player: PlayerState,
    myBuildings: ReturnType<typeof getBuildingsForOwner>,
    actions: Action[]
): void {
    let creditsRemaining = player.credits;
    const infantryQueueBusy = Boolean(player.queues.infantry.current);
    const vehicleQueueBusy = Boolean(player.queues.vehicle.current);
    const buildingQueueBusy = Boolean(player.queues.building.current);

    const infantryQueuedThisTick = actions.some(
        a => a.type === 'START_BUILD' && a.payload.category === 'infantry'
    );
    const vehicleQueuedThisTick = actions.some(
        a => a.type === 'START_BUILD' && a.payload.category === 'vehicle'
    );
    const buildingQueuedThisTick = actions.some(
        a => a.type === 'START_BUILD' && a.payload.category === 'building'
    );

    if (!infantryQueueBusy && !infantryQueuedThisTick && hasProductionBuildingFor('infantry', myBuildings)) {
        for (const key of ['rocket', 'rifle']) {
            const data = RULES.units[key];
            const cost = data?.cost ?? 0;
            if (checkPrerequisites(key, myBuildings) && creditsRemaining >= cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'infantry', key, playerId } });
                creditsRemaining -= cost;
                break;
            }
        }
    }

    if (!vehicleQueueBusy && !vehicleQueuedThisTick && hasProductionBuildingFor('vehicle', myBuildings)) {
        for (const key of ['heavy', 'light', 'jeep']) {
            const data = RULES.units[key];
            const cost = data?.cost ?? 0;
            if (checkPrerequisites(key, myBuildings) && creditsRemaining >= cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key, playerId } });
                break;
            }
        }
    }

    if (!buildingQueueBusy && !buildingQueuedThisTick) {
        const hasBarracks = myBuildings.some(b => b.key === 'barracks' && !b.dead);
        const hasFactory = myBuildings.some(b => b.key === 'factory' && !b.dead);
        const missingCoreBuilding = !hasBarracks ? 'barracks' : (!hasFactory ? 'factory' : null);
        if (missingCoreBuilding) {
            const data = RULES.buildings[missingCoreBuilding];
            if (data && checkPrerequisites(missingCoreBuilding, myBuildings) && player.credits >= data.cost) {
                actions.push({
                    type: 'START_BUILD',
                    payload: { category: 'building', key: missingCoreBuilding, playerId }
                });
                return;
            }
        }

        const refineries = myBuildings.filter(b => b.key === 'refinery' && !b.dead).length;
        if (refineries === 0 && checkPrerequisites('refinery', myBuildings)) {
            const refineryCost = RULES.buildings.refinery?.cost ?? 0;
            if (player.credits >= refineryCost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'refinery', playerId } });
                return;
            }
        }

        const existingDefenses = myBuildings.filter(b => Boolean(RULES.buildings[b.key]?.isDefense)).length;
        if (existingDefenses === 0 && checkPrerequisites('turret', myBuildings)) {
            const turretCost = RULES.buildings.turret?.cost ?? 0;
            if (player.credits >= turretCost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'turret', playerId } });
            }
        }
    }
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
    const hasEcoTankAllInOpponent = Object.values(state.players).some(
        p => p.id !== playerId && p.isAi && p.aiImplementationId === 'eco_tank_all_in'
    );

    let personality = getPersonalityForPlayer(playerId);

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

    const maxEnemyBoomScore = Object.values(aiState.enemyIntelligence.boomScores).reduce(
        (max, value) => Math.max(max, value),
        0
    );
    const isEnemyBooming = maxEnemyBoomScore >= LOW_DEFENSE_RUSH_MIN_BOOM_SCORE;
    if (hasEcoTankAllInOpponent) {
        personality = {
            ...personality,
            attack_threshold: Math.min(personality.attack_threshold || 5, 4),
            min_attack_group_size: Math.min(personality.min_attack_group_size || 5, 3),
            harass_threshold: Math.min(personality.harass_threshold || 3, 2),
            harvester_ratio: Math.min(personality.harvester_ratio || 2, 1.6),
            credit_buffer: Math.min(personality.credit_buffer || 400, 150),
            defense_investment: Math.min(personality.defense_investment || 3, 2),
            unit_preferences: {
                infantry: ['rocket', 'rifle', 'grenadier'],
                vehicle: ['heavy', 'light', 'artillery']
            }
        };
    }
    if (isEnemyBooming) {
        const baseInfantryPrefs = personality.unit_preferences?.infantry || [];
        personality = {
            ...personality,
            attack_threshold: Math.min(personality.attack_threshold || 5, 4),
            min_attack_group_size: Math.min(personality.min_attack_group_size || 5, 4),
            harvester_ratio: Math.min(personality.harvester_ratio || 2, 1.8),
            credit_buffer: Math.min(personality.credit_buffer || 400, 250),
            unit_preferences: {
                ...personality.unit_preferences,
                infantry: ['rocket', ...baseInfantryPrefs.filter(key => key !== 'rocket')]
            }
        };
    }

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
    if (hasEcoTankAllInOpponent) {
        aiState.investmentPriority = 'warfare';
    }

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

    const ecoCounterRushTarget = hasEcoTankAllInOpponent && !shouldGreedyRush
        ? findEcoCounterRushTarget(state, cache, playerId, baseCenter)
        : null;
    const shouldEcoCounterRush = !isDummy &&
        aiState.strategy !== 'all_in' &&
        threatsNearBase.length === 0 &&
        combatUnits.length >= ECO_COUNTER_RUSH_MIN_COMBAT_UNITS &&
        ecoCounterRushTarget !== null;

    if (shouldEcoCounterRush && ecoCounterRushTarget) {
        aiState.strategy = 'attack';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = combatUnits.map(unit => unit.id);
        aiState.harassGroup = [];
        aiState.enemyBaseLocation = ecoCounterRushTarget.targetPos;
        aiState.vengeanceScores[ecoCounterRushTarget.ownerId] = Math.max(
            aiState.vengeanceScores[ecoCounterRushTarget.ownerId] || 0,
            ECO_COUNTER_RUSH_VENGEANCE_BOOST
        );
    }

    const lowDefenseRushTarget = !shouldGreedyRush && !shouldEcoCounterRush
        ? findLowDefenseRushTarget(state, cache, playerId, baseCenter, combatUnits.length, aiState)
        : null;
    const shouldLowDefenseRush = !isDummy &&
        aiState.strategy !== 'all_in' &&
        threatsNearBase.length === 0 &&
        combatUnits.length >= GREEDY_RUSH_MIN_COMBAT_UNITS &&
        lowDefenseRushTarget !== null;

    if (shouldLowDefenseRush && lowDefenseRushTarget) {
        aiState.strategy = 'attack';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = combatUnits.map(unit => unit.id);
        aiState.harassGroup = [];
        aiState.enemyBaseLocation = lowDefenseRushTarget.targetPos;
        aiState.vengeanceScores[lowDefenseRushTarget.ownerId] = Math.max(
            aiState.vengeanceScores[lowDefenseRushTarget.ownerId] || 0,
            LOW_DEFENSE_RUSH_VENGEANCE_BOOST
        );
    }

    // Boom rush: detect economic booming and attack before they mass tanks
    const boomRushTarget = !shouldGreedyRush && !shouldEcoCounterRush && !shouldLowDefenseRush
        ? findBoomingRushTarget(state, cache, playerId, baseCenter, aiState)
        : null;
    const shouldBoomRush = !isDummy &&
        aiState.strategy !== 'all_in' &&
        threatsNearBase.length === 0 &&
        combatUnits.length >= GREEDY_RUSH_MIN_COMBAT_UNITS &&
        boomRushTarget !== null;

    if (shouldBoomRush && boomRushTarget) {
        aiState.strategy = 'attack';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = combatUnits.map(unit => unit.id);
        aiState.harassGroup = [];
        aiState.enemyBaseLocation = boomRushTarget.targetPos;
        aiState.vengeanceScores[boomRushTarget.ownerId] = Math.max(
            aiState.vengeanceScores[boomRushTarget.ownerId] || 0,
            BOOM_RUSH_VENGEANCE_BOOST
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
    let economyActions = handleEconomy(state, playerId, myBuildings, player, personality, aiState, enemies);
    if (hasEcoTankAllInOpponent) {
        const existingRefineries = myBuildings.filter(b => b.key === 'refinery' && !b.dead).length;
        economyActions = economyActions.filter(action => {
            if (action.type !== 'START_BUILD') return true;
            if (action.payload.category === 'air') return false;
            if (action.payload.category === 'vehicle' &&
                (action.payload.key === 'mcv' || action.payload.key === 'induction_rig' || action.payload.key === 'demo_truck')) {
                return false;
            }
            if (action.payload.category === 'infantry' && action.payload.key === 'engineer') {
                return false;
            }
            if (action.payload.category === 'building' &&
                (action.payload.key === 'airforce_command' ||
                    action.payload.key === 'tech' ||
                    action.payload.key === 'service_depot')) {
                return false;
            }
            if (action.payload.category === 'building' && action.payload.key === 'refinery' && existingRefineries >= 2) {
                return false;
            }
            return true;
        });
        appendEcoCounterFallbackProduction(playerId, player, myBuildings, economyActions);
    }
    actions.push(...economyActions);
    actions.push(...handleBuildingRepair(state, playerId, myBuildings, player, aiState));
    if (!hasEcoTankAllInOpponent) {
        actions.push(...handleMCVOperations(state, playerId, aiState, myBuildings, myUnits));
        actions.push(...handleInductionRigOperations(state, playerId, myBuildings, myUnits)); // Deploy rigs on wells
    }
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
        const ignoreSizeLimit = aiState.strategy === 'all_in' || shouldGreedyRush || shouldEcoCounterRush || shouldLowDefenseRush || shouldBoomRush;
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
    if (engineers.length > 0 && !hasEcoTankAllInOpponent) {
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

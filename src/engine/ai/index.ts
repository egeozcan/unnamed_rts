import { GameState, Action } from '../types.js';
import { createEntityCache, getEnemiesOf, getBuildingsForOwner, getUnitsForOwner } from '../perf.js';

// Export everything for consumers (tests, game.ts, etc.)
export * from './types.js';
export * from './state.js';
export * from './utils.js';
export * from './planning.js';
export * from './action_economy.js';
export * from './action_combat.js';

// Import locally for computeAiActions and _testUtils
import {
    getAIState,
    findBaseCenter,
    updateEnemyBaseLocation,
    updateEnemyIntelligence,
    updateVengeance,
    getGroupCenter,
    getPersonalityForPlayer,
    setPersonalityForPlayer
} from './state.js';

import {
    getNonDefenseBuildings,
    getDefenseBuildings,
    getRefineries,
    getAllOre,
    getAccessibleOre,
    findNearestUncoveredOre,
    isWithinBuildRange,
    findNearestBuilding,
    getCounterUnits,
    AI_CONSTANTS,
    DIFFICULTY_MODIFIERS,
    getDifficultyModifiers,
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE,
    BASE_DEFENSE_RADIUS,
    HARVESTER_FLEE_DISTANCE,
    RALLY_DISTANCE,
    VENGEANCE_DECAY,
    VENGEANCE_PER_HIT
} from './utils.js';

import {
    detectThreats,
    updateStrategy,
    evaluateInvestmentPriority
} from './planning.js';

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
} from './action_economy.js';

import {
    handleAttack,
    handleDefense,
    handleHarass,
    handleRally,
    handleScouting,
    handleMicro,
    handleHarvesterSafety,
    handleHarvesterSuicideAttack,
    findNearestDefender,
    handleAirStrikes,
    handleUnitRepair,
    handleEngineerCapture
} from './action_combat.js';

/**
 * Main AI Logic Loop
 * This function determines the actions for an AI player for a given tick.
 * 
 * PERFORMANCE OPTIMIZATION: AI computation is staggered across ticks.
 * Each AI player computes on different ticks (based on playerId % AI_TICK_INTERVAL).
 * Critical reactions (defense, harvester safety) run every tick for responsiveness.
 */
export function computeAiActions(state: GameState, playerId: number): Action[] {
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
    const combatUnits = myUnits.filter(u => u.key !== 'harvester' && u.key !== 'mcv');

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
        actions.push(...handleHarvesterSafety(state, playerId, harvesters, combatUnits, baseCenter, enemies, aiState, cache));

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
    actions.push(...handleHarvesterGathering(state, playerId, harvesters, aiState.harvestersUnderAttack)); // Gather resources

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
        const ignoreSizeLimit = aiState.strategy === 'all_in';
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

    return actions;
}

// Export internal functions for testing and backward compatibility
export const _testUtils = {
    findBaseCenter,
    detectThreats,
    updateStrategy,
    handleDefense,
    handleAttack,
    handleHarass,
    handleRally,
    handleHarvesterSafety,
    handleEmergencySell,
    handleMCVOperations,
    updateEnemyIntelligence,
    updateVengeance,
    getAIState,
    getGroupCenter,
    updateEnemyBaseLocation,
    getPersonalityForPlayer,
    setPersonalityForPlayer,
    DIFFICULTY_MODIFIERS,
    getDifficultyModifiers,
    AI_CONSTANTS,
    getNonDefenseBuildings,
    getDefenseBuildings,
    getRefineries,
    getAllOre,
    getAccessibleOre,
    findNearestUncoveredOre,
    isWithinBuildRange,
    findNearestBuilding,
    findNearestDefender,
    getCounterUnits,
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE,
    BASE_DEFENSE_RADIUS,
    HARVESTER_FLEE_DISTANCE,
    RALLY_DISTANCE,
    VENGEANCE_DECAY,
    VENGEANCE_PER_HIT
};

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
    getGroupCenter
} from './state.js';

import {
    getPersonalityForPlayer,
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
    DIFFICULTY_TO_PERSONALITY,
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
    handleAllInSell,
    handleBuildingPlacement,
    handleBuildingRepair,
    handleMCVOperations,
    handleHarvesterGathering
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
    findNearestDefender
} from './action_combat.js';

/**
 * Main AI Logic Loop
 * This function determines the actions for an AI player for a given tick.
 */
export function computeAiActions(state: GameState, playerId: number): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const aiState = getAIState(playerId);
    const personality = getPersonalityForPlayer(player);

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

    // 2. Update Intelligence & State
    updateEnemyBaseLocation(aiState, enemies);
    updateEnemyIntelligence(aiState, enemies, state.tick);
    updateVengeance(state, playerId, aiState, [...myBuildings, ...myUnits]);

    // Detect threats
    const { threatsNearBase, harvestersUnderAttack } = detectThreats(
        baseCenter,
        harvesters,
        enemies,
        myBuildings
    );
    aiState.threatsNearBase = threatsNearBase;
    aiState.harvestersUnderAttack = harvestersUnderAttack;

    // Update Strategy
    updateStrategy(
        aiState,
        state.tick,
        myBuildings,
        combatUnits,
        enemies,
        threatsNearBase,
        personality,
        player.credits
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
    actions.push(...handleAllInSell(state, playerId, myBuildings, aiState));
    actions.push(...handleEconomy(state, playerId, myBuildings, player, personality, aiState, enemies));
    actions.push(...handleBuildingRepair(state, playerId, myBuildings, player, aiState));
    actions.push(...handleMCVOperations(state, playerId, aiState, myBuildings, myUnits));
    actions.push(...handleHarvesterGathering(state, playerId, harvesters, aiState.harvestersUnderAttack)); // Gather resources

    // --- COMBAT & UNIT CONTROL ---
    actions.push(...handleHarvesterSafety(state, playerId, harvesters, combatUnits, baseCenter, enemies, aiState));

    if (aiState.strategy === 'defend') {
        actions.push(...handleDefense(state, playerId, aiState, combatUnits, baseCenter, personality));
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
    actions.push(...handleMicro(state, combatUnits, enemies, baseCenter));

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
    DIFFICULTY_TO_PERSONALITY,
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

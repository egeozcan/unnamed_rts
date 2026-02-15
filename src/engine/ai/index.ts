import { GameState, Action } from '../types.js';
import { EntityCache } from '../perf.js';

// Public AI module exports
export * from './types.js';
export * from './state.js';
export * from './utils.js';
export * from './planning.js';
export * from './action_economy.js';
export * from './action_combat.js';
export * from './contracts.js';
export * from './registry.js';
export * from './controller.js';

import {
    getAIState,
    resetAIState,
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
    updateStrategy
} from './planning.js';

import {
    handleEmergencySell,
    handleMCVOperations
} from './action_economy.js';

import {
    handleAttack,
    handleDefense,
    handleHarass,
    handleRally,
    handleHarvesterSafety,
    findNearestDefender
} from './action_combat.js';

import { computeAiActionsForPlayer } from './controller.js';
import { computeClassicAiActions } from './implementations/classic/index.js';

export function computeAiActions(state: GameState, playerId: number, sharedCache?: EntityCache): Action[] {
    return computeAiActionsForPlayer(state, playerId, sharedCache);
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
    resetAIState,
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
    VENGEANCE_PER_HIT,
    computeClassicAiActions
};

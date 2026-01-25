/**
 * Harvester AI Orchestrator
 *
 * Main entry point for the harvester AI system. Coordinates all harvester AI
 * modules with proper update intervals:
 * - Danger map: every 30 ticks
 * - Desperation: every 60 ticks
 * - Coordinator: every 60 ticks
 * - Escort: every 90 ticks
 * - Stuck resolver: every tick
 *
 * Difficulty gating:
 * - 'dummy' and 'easy': Return early with no changes
 * - 'medium' and 'hard': Full orchestration
 */

import {
    GameState,
    EntityId,
    HarvesterUnit,
    CombatUnit,
    BuildingEntity,
    ResourceEntity,
    Action
} from '../../types.js';
import { createEntityCache, getEnemiesOf } from '../../perf.js';
import {
    HarvesterAIState,
    HARVESTER_AI_CONSTANTS
} from './types.js';
import { updateDangerMap } from './danger_map.js';
import { calculateDesperationScore } from './desperation.js';
import {
    assignHarvesterRoles,
    distributeOreFields,
    manageRefineryQueue
} from './coordinator.js';
import { updateEscortAssignments, releaseEscort } from './escort.js';
import { detectStuckHarvester, resolveStuckHarvester, StuckResolution } from './stuck_resolver.js';

const {
    DANGER_MAP_UPDATE_INTERVAL,
    DESPERATION_UPDATE_INTERVAL,
    COORDINATOR_UPDATE_INTERVAL,
    ESCORT_UPDATE_INTERVAL
} = HARVESTER_AI_CONSTANTS;

type AiDifficulty = 'dummy' | 'easy' | 'medium' | 'hard';

export interface HarvesterAIResult {
    harvesterAI: HarvesterAIState;
    actions: Action[];
}

/**
 * Convert a stuck resolution to game actions.
 */
function convertResolutionToActions(
    resolution: StuckResolution,
    harvesterId: EntityId
): Action[] {
    switch (resolution.action) {
        case 'nudge': {
            // Nudge generates a small movement in the nudge direction
            if (resolution.nudgeDirection) {
                // Move a small distance in the nudge direction
                // We'll let the reducer handle the actual position calculation
                // For now, just return an empty array since nudge is handled differently
                return [];
            }
            break;
        }
        case 'detour': {
            if (resolution.targetOre) {
                return [{
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: [harvesterId],
                        x: resolution.targetOre.pos.x,
                        y: resolution.targetOre.pos.y
                    }
                }];
            }
            break;
        }
        case 'relocate': {
            if (resolution.targetOre) {
                return [{
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: [harvesterId],
                        x: resolution.targetOre.pos.x,
                        y: resolution.targetOre.pos.y
                    }
                }];
            }
            break;
        }
        case 'retreat': {
            if (resolution.targetRefinery) {
                return [{
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: [harvesterId],
                        x: resolution.targetRefinery.pos.x,
                        y: resolution.targetRefinery.pos.y
                    }
                }];
            }
            break;
        }
        case 'emergency': {
            // Emergency clears targets - harvester will idle until new assignment
            // No action needed, the harvester reducer will handle idle state
            return [];
        }
        case 'none':
        default:
            return [];
    }
    return [];
}

/**
 * Deep clone the harvester AI state for immutable updates.
 */
function cloneHarvesterAIState(state: HarvesterAIState): HarvesterAIState {
    return {
        dangerMap: new Map(state.dangerMap),
        dangerMapLastUpdate: state.dangerMapLastUpdate,
        desperationScore: state.desperationScore,
        harvesterRoles: new Map(state.harvesterRoles),
        oreFieldClaims: new Map(state.oreFieldClaims),
        refineryQueue: new Map(state.refineryQueue),
        escortAssignments: new Map(state.escortAssignments),
        blacklistedOre: new Map(state.blacklistedOre),
        stuckStates: new Map(state.stuckStates),
        harvesterDeaths: [...state.harvesterDeaths]
    };
}

/**
 * Main harvester AI update function.
 *
 * Orchestrates all harvester AI modules with proper update intervals.
 *
 * @param harvesterAI - Current harvester AI state
 * @param playerId - Player ID to update AI for
 * @param state - Current game state
 * @param difficulty - AI difficulty level
 * @returns Updated harvester AI state and any actions to execute
 */
export function updateHarvesterAI(
    harvesterAI: HarvesterAIState,
    playerId: number,
    state: GameState,
    difficulty: AiDifficulty
): HarvesterAIResult {
    // Early exit for difficulties that don't use harvester AI
    if (difficulty === 'dummy' || difficulty === 'easy') {
        return {
            harvesterAI,
            actions: []
        };
    }

    const tick = state.tick;

    // Create entity cache for efficient lookups
    const cache = createEntityCache(state.entities);

    // Get player's harvesters
    const playerUnits = cache.unitsByOwner.get(playerId) || [];
    const playerHarvesters = playerUnits.filter(
        (u): u is HarvesterUnit => u.type === 'UNIT' && u.key === 'harvester' && !u.dead
    );

    // Get player's combat units
    const playerCombatUnits = playerUnits.filter(
        (u): u is CombatUnit =>
            u.type === 'UNIT' &&
            u.key !== 'harvester' &&
            u.key !== 'mcv' &&
            u.key !== 'harrier' &&
            !u.dead
    ) as CombatUnit[];

    // Get all ore resources
    const allOre = cache.resources.filter(
        (r): r is ResourceEntity => r.type === 'RESOURCE' && !r.dead
    );

    // Get player's refineries
    const playerBuildings = cache.buildingsByOwner.get(playerId) || [];
    const refineries = playerBuildings.filter(
        (b): b is BuildingEntity => b.type === 'BUILDING' && b.key === 'refinery' && !b.dead
    );

    // Get enemy units
    const enemies = getEnemiesOf(cache, playerId).filter(e => e.type === 'UNIT' && !e.dead);

    // Get player state for desperation calculation
    const player = state.players[playerId];

    // Clone state for immutable updates
    const newState = cloneHarvesterAIState(harvesterAI);

    // Track if any updates were made
    let stateChanged = false;

    // 1. Update danger map (if interval)
    if (tick % DANGER_MAP_UPDATE_INTERVAL === 0) {
        updateDangerMap(
            newState,
            playerId,
            enemies,
            newState.harvesterDeaths, // Use harvester deaths as attack events
            tick,
            difficulty
        );
        stateChanged = true;
    }

    // 2. Update desperation (if interval)
    if (tick % DESPERATION_UPDATE_INTERVAL === 0) {
        if (player) {
            // Count harvesters and refineries for desperation calculation
            const harvesterCount = playerHarvesters.length;
            const refineryCount = refineries.length;

            // Estimate income/expense rates (simplified - could be enhanced later)
            const incomeRate = harvesterCount * 2; // Rough estimate
            const expenseRate = refineryCount > 0 ? 1 : 0; // Rough estimate

            newState.desperationScore = calculateDesperationScore(
                player,
                harvesterCount,
                refineryCount,
                incomeRate,
                expenseRate,
                tick,
                difficulty
            );
            stateChanged = true;
        }
    }

    // 3. Update coordinator (if interval)
    if (tick % COORDINATOR_UPDATE_INTERVAL === 0) {
        // Assign roles
        assignHarvesterRoles(
            newState,
            playerHarvesters,
            newState.desperationScore,
            difficulty
        );

        // Distribute ore fields
        distributeOreFields(
            newState,
            playerHarvesters,
            allOre,
            difficulty
        );

        // Manage refinery queues
        manageRefineryQueue(
            newState,
            playerHarvesters,
            refineries,
            difficulty
        );

        stateChanged = true;
    }

    // 4. Update escorts (if interval)
    if (tick % ESCORT_UPDATE_INTERVAL === 0) {
        // Release escorts from safe zones first
        releaseEscort(newState, allOre);

        // Update escort assignments
        updateEscortAssignments(
            newState,
            playerHarvesters,
            playerCombatUnits,
            allOre,
            newState.desperationScore,
            difficulty
        );

        stateChanged = true;
    }

    // 5. Check stuck harvesters (every tick) - collect actions
    const actions: Action[] = [];
    for (const harvester of playerHarvesters) {
        if (detectStuckHarvester(harvester)) {
            const resolution = resolveStuckHarvester(
                newState,
                harvester,
                allOre,
                refineries,
                tick,
                difficulty
            );

            if (resolution && resolution.action !== 'none') {
                const resolutionActions = convertResolutionToActions(resolution, harvester.id);
                actions.push(...resolutionActions);
                stateChanged = true;
            }
        }
    }

    // Return original state if nothing changed (preserves reference equality)
    if (!stateChanged) {
        return {
            harvesterAI,
            actions: []
        };
    }

    return {
        harvesterAI: newState,
        actions
    };
}

// Re-export types and utilities for convenience
export { createInitialHarvesterAIState } from './types.js';
export type { HarvesterAIState } from './types.js';

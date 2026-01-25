import { Entity, EntityId, Vector, HarvesterUnit } from '../../types.js';
import {
    HARVESTER_AI_CONSTANTS,
    HarvesterAIState,
    StuckLevel
} from './types.js';

const {
    STUCK_LEVEL_1_TICKS,
    STUCK_LEVEL_2_TICKS,
    STUCK_LEVEL_3_TICKS,
    STUCK_LEVEL_4_TICKS,
    STUCK_LEVEL_5_TICKS,
    BLACKLIST_DURATION,
    DETOUR_SEARCH_RADIUS
} = HARVESTER_AI_CONSTANTS;

// Velocity threshold considered "near zero" (magnitude)
const VELOCITY_NEAR_ZERO_THRESHOLD = 0.5;

// Distance threshold for being "near" a refinery
const NEAR_REFINERY_DISTANCE = 100;

// Ticks stuck required to be considered stuck at refinery
const STUCK_AT_REFINERY_TICKS = 30;

// ============ TYPES ============

export type StuckAction = 'none' | 'nudge' | 'detour' | 'relocate' | 'retreat' | 'emergency';

export interface StuckResolution {
    action: StuckAction;
    targetOre?: Entity;
    targetRefinery?: Entity;
    nudgeDirection?: Vector;
}

// ============ DETECTION ============

/**
 * Detect if a harvester is stuck.
 *
 * Returns true if:
 * - harvestAttemptTicks > STUCK_LEVEL_1_TICKS (5)
 * - OR has resourceTargetId but velocity near zero
 *
 * Returns false if:
 * - has moveTarget (actively moving)
 */
export function detectStuckHarvester(harvester: HarvesterUnit, _currentTick: number): boolean {
    // If actively moving toward a destination, not stuck
    if (harvester.movement.moveTarget !== null) {
        return false;
    }

    // If harvestAttemptTicks exceeds threshold, stuck
    const harvestAttemptTicks = harvester.harvester.harvestAttemptTicks ?? 0;
    if (harvestAttemptTicks > STUCK_LEVEL_1_TICKS) {
        return true;
    }

    // If has resource target but velocity near zero, stuck
    if (harvester.harvester.resourceTargetId !== null) {
        const vel = harvester.movement.vel;
        const velMag = vel.mag();
        if (velMag < VELOCITY_NEAR_ZERO_THRESHOLD) {
            return true;
        }
    }

    return false;
}

/**
 * Check if a harvester is stuck specifically at a refinery.
 *
 * Returns true if:
 * - Harvester is within 100px of any refinery
 * - AND stuck for > 30 ticks (harvestAttemptTicks > 30)
 */
export function isStuckAtRefinery(harvester: HarvesterUnit, refineries: Entity[]): boolean {
    if (refineries.length === 0) {
        return false;
    }

    const harvestAttemptTicks = harvester.harvester.harvestAttemptTicks ?? 0;
    if (harvestAttemptTicks <= STUCK_AT_REFINERY_TICKS) {
        return false;
    }

    // Check if near any refinery
    for (const refinery of refineries) {
        const dist = harvester.pos.dist(refinery.pos);
        if (dist < NEAR_REFINERY_DISTANCE) {
            return true;
        }
    }

    return false;
}

// ============ RESOLUTION ============

/**
 * Determine the current stuck level based on stuck ticks.
 */
function getStuckLevel(stuckTicks: number): StuckLevel {
    if (stuckTicks > STUCK_LEVEL_5_TICKS) return 5;
    if (stuckTicks > STUCK_LEVEL_4_TICKS) return 4;
    if (stuckTicks > STUCK_LEVEL_3_TICKS) return 3;
    if (stuckTicks > STUCK_LEVEL_2_TICKS) return 2;
    return 1;
}

/**
 * Get the maximum allowed stuck level for a difficulty.
 */
function getMaxLevelForDifficulty(difficulty: 'dummy' | 'easy' | 'medium' | 'hard'): StuckLevel {
    switch (difficulty) {
        case 'dummy':
        case 'easy':
            return 2;
        case 'medium':
            return 4;
        case 'hard':
            return 5;
    }
}

/**
 * Clean up expired blacklist entries.
 */
function cleanupExpiredBlacklist(harvesterAI: HarvesterAIState, currentTick: number): void {
    for (const [oreId, expiryTick] of harvesterAI.blacklistedOre) {
        if (expiryTick <= currentTick) {
            harvesterAI.blacklistedOre.delete(oreId);
        }
    }
}

/**
 * Filter ores to exclude blacklisted ones.
 */
function filterBlacklistedOres(
    ores: Entity[],
    harvesterAI: HarvesterAIState,
    currentTick: number
): Entity[] {
    return ores.filter(ore => {
        const expiryTick = harvesterAI.blacklistedOre.get(ore.id);
        if (expiryTick === undefined) {
            return true; // Not blacklisted
        }
        return expiryTick <= currentTick; // Expired blacklist
    });
}

/**
 * Find nearest ore to harvester position.
 */
function findNearestOre(harvester: HarvesterUnit, ores: Entity[]): Entity | null {
    let nearest: Entity | null = null;
    let minDist = Infinity;

    for (const ore of ores) {
        const dist = harvester.pos.dist(ore.pos);
        if (dist < minDist) {
            minDist = dist;
            nearest = ore;
        }
    }

    return nearest;
}

/**
 * Find alternate ore within detour radius, excluding current target.
 */
function findAlternateOreWithinRadius(
    harvester: HarvesterUnit,
    ores: Entity[],
    radius: number,
    currentTargetId: EntityId | null
): Entity | null {
    let nearest: Entity | null = null;
    let minDist = Infinity;

    for (const ore of ores) {
        // Skip current target
        if (ore.id === currentTargetId) {
            continue;
        }

        const dist = harvester.pos.dist(ore.pos);
        if (dist < radius && dist < minDist) {
            minDist = dist;
            nearest = ore;
        }
    }

    return nearest;
}

/**
 * Find nearest refinery to harvester.
 */
function findNearestRefinery(harvester: HarvesterUnit, refineries: Entity[]): Entity | null {
    let nearest: Entity | null = null;
    let minDist = Infinity;

    for (const refinery of refineries) {
        const dist = harvester.pos.dist(refinery.pos);
        if (dist < minDist) {
            minDist = dist;
            nearest = refinery;
        }
    }

    return nearest;
}

/**
 * Generate a random perpendicular nudge direction.
 */
function generateNudgeDirection(): Vector {
    // Random angle
    const angle = Math.random() * Math.PI * 2;
    return new Vector(Math.cos(angle), Math.sin(angle));
}

/**
 * Resolve a stuck harvester by determining the appropriate action.
 *
 * Escalation Levels:
 * - Level 1 (5 ticks stuck): nudge - random perpendicular push
 * - Level 2 (15 ticks): detour - find alternate ore within 300px
 * - Level 3 (30 ticks): relocate - find distant ore, blacklist current
 * - Level 4 (45 ticks): retreat - return to closest refinery
 * - Level 5 (60 ticks): emergency - full reset, double blacklist duration
 *
 * Difficulty max levels:
 * - Easy/Dummy: max level 2
 * - Medium: max level 4
 * - Hard: full 5 levels
 */
export function resolveStuckHarvester(
    harvesterAI: HarvesterAIState,
    harvester: HarvesterUnit,
    availableOres: Entity[],
    refineries: Entity[],
    currentTick: number,
    difficulty: 'dummy' | 'easy' | 'medium' | 'hard'
): StuckResolution {
    // Clean up expired blacklist entries
    cleanupExpiredBlacklist(harvesterAI, currentTick);

    // Get or create stuck state for this harvester
    let stuckState = harvesterAI.stuckStates.get(harvester.id);
    if (!stuckState) {
        stuckState = {
            stuckTicks: 0,
            currentLevel: 1,
            lastActionTick: 0,
            blacklistedOre: new Set()
        };
        harvesterAI.stuckStates.set(harvester.id, stuckState);
    }

    // Determine current level
    const rawLevel = getStuckLevel(stuckState.stuckTicks);
    const maxLevel = getMaxLevelForDifficulty(difficulty);
    const effectiveLevel = Math.min(rawLevel, maxLevel) as StuckLevel;

    // Filter out blacklisted ores
    const filteredOres = filterBlacklistedOres(availableOres, harvesterAI, currentTick);

    // Current target
    const currentTargetId = harvester.harvester.resourceTargetId;

    // Process based on level
    switch (effectiveLevel) {
        case 1: {
            // Level 1: Nudge - random perpendicular push
            return {
                action: 'nudge',
                nudgeDirection: generateNudgeDirection()
            };
        }

        case 2: {
            // Level 2: Detour - find alternate ore within radius
            const alternateOre = findAlternateOreWithinRadius(
                harvester,
                filteredOres,
                DETOUR_SEARCH_RADIUS,
                currentTargetId
            );

            if (alternateOre) {
                return {
                    action: 'detour',
                    targetOre: alternateOre
                };
            }

            // Fallback to nudge if no alternate ore found
            return {
                action: 'nudge',
                nudgeDirection: generateNudgeDirection()
            };
        }

        case 3: {
            // Level 3: Relocate - find distant ore, blacklist current
            // Blacklist current ore
            if (currentTargetId) {
                harvesterAI.blacklistedOre.set(
                    currentTargetId,
                    currentTick + BLACKLIST_DURATION
                );
            }

            // Find any ore (distant is fine)
            const distantOre = findNearestOre(
                harvester,
                filteredOres.filter(o => o.id !== currentTargetId)
            );

            if (distantOre) {
                return {
                    action: 'relocate',
                    targetOre: distantOre
                };
            }

            // Fallback to nudge
            return {
                action: 'nudge',
                nudgeDirection: generateNudgeDirection()
            };
        }

        case 4: {
            // Level 4: Retreat - return to closest refinery
            const nearestRefinery = findNearestRefinery(harvester, refineries);

            if (nearestRefinery) {
                return {
                    action: 'retreat',
                    targetRefinery: nearestRefinery
                };
            }

            // Fallback to nudge if no refinery
            return {
                action: 'nudge',
                nudgeDirection: generateNudgeDirection()
            };
        }

        case 5: {
            // Level 5: Emergency - full reset, double blacklist duration
            // Double blacklist current ore
            if (currentTargetId) {
                harvesterAI.blacklistedOre.set(
                    currentTargetId,
                    currentTick + BLACKLIST_DURATION * 2
                );
            }

            return {
                action: 'emergency'
            };
        }

        default: {
            return { action: 'none' };
        }
    }
}

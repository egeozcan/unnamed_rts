/**
 * Escort System for Harvester AI
 *
 * Assigns combat units to protect harvesters in dangerous areas.
 * Dynamically manages escort assignments based on:
 * - Zone danger levels
 * - Harvester value (base + cargo)
 * - AI desperation level
 *
 * Difficulty Scaling:
 * - Easy/Dummy: No escorts (return early)
 * - Medium: Only assign when harvester actively damaged (handled elsewhere)
 * - Hard: Full proactive escort system
 */

import { EntityId, HarvesterUnit, CombatUnit, ResourceEntity } from '../../types.js';
import { HarvesterAIState, HARVESTER_AI_CONSTANTS } from './types.js';
import { getZoneDanger } from './danger_map.js';

const {
    ESCORT_ASSIGN_DANGER,
    ESCORT_PRIORITY_DANGER,
    ESCORT_RELEASE_DANGER,
    ESCORT_PATROL_RADIUS
} = HARVESTER_AI_CONSTANTS;

// Base harvester value for escort calculations
const HARVESTER_BASE_VALUE = 400;

// Minimum value thresholds for escort assignment
const MIN_VALUE_FOR_ESCORT = 500;
const MIN_VALUE_FOR_PRIORITY_ESCORT = 1000;

// Desperation threshold to limit escorts
const HIGH_DESPERATION_THRESHOLD = 50;

// Radius to consider harvesters "near" an ore field
const HARVESTER_NEAR_ORE_RADIUS = 200;

/**
 * Update escort assignments for ore fields based on danger and harvester value.
 *
 * For each ore field with harvesters:
 * - Calculate fieldDanger using getZoneDanger
 * - Calculate harvesterValue = sum of (400 + cargo) for harvesters near that ore
 * - If danger > 40 (ESCORT_ASSIGN_DANGER) AND value > 500: assign 1 escort
 * - If danger > 70 (ESCORT_PRIORITY_DANGER) AND value > 1000: assign 2 escorts
 *
 * At high desperation (>50), limit to 1 escort max.
 * Easy/Dummy/Medium: No proactive escorts (return early).
 */
export function updateEscortAssignments(
    harvesterAI: HarvesterAIState,
    harvesters: HarvesterUnit[],
    combatUnits: CombatUnit[],
    oreFields: ResourceEntity[],
    desperationScore: number,
    difficulty: 'dummy' | 'easy' | 'medium' | 'hard'
): void {
    // Easy, dummy, and medium difficulties don't proactively assign escorts
    // Medium difficulty handles escorts reactively when harvesters are damaged (elsewhere)
    if (difficulty === 'easy' || difficulty === 'dummy' || difficulty === 'medium') {
        return;
    }

    // Track which combat units are available for escort duty
    const availableEscorts = combatUnits.filter(unit =>
        !unit.dead &&
        !unit.combat?.targetId && // Not currently attacking
        !harvesterAI.escortAssignments.has(unit.id) // Not already escorting
    );

    // Process each ore field
    for (const ore of oreFields) {
        // Calculate danger at this ore field
        const fieldDanger = getZoneDanger(harvesterAI, ore.pos.x, ore.pos.y);

        // Skip if danger is below escort threshold
        if (fieldDanger <= ESCORT_ASSIGN_DANGER) {
            continue;
        }

        // Find harvesters near this ore (within 200px)
        const harvestersNearOre = harvesters.filter(h =>
            !h.dead &&
            h.pos.dist(ore.pos) <= HARVESTER_NEAR_ORE_RADIUS
        );

        if (harvestersNearOre.length === 0) {
            continue;
        }

        // Calculate total harvester value at this ore
        const harvesterValue = harvestersNearOre.reduce(
            (sum, h) => sum + HARVESTER_BASE_VALUE + h.harvester.cargo,
            0
        );

        // Skip if value is below minimum threshold
        if (harvesterValue <= MIN_VALUE_FOR_ESCORT) {
            continue;
        }

        // Determine how many escorts to assign
        let desiredEscorts = 1; // Default: 1 escort

        // Priority escort: 2 units for very dangerous zones with high value
        if (fieldDanger > ESCORT_PRIORITY_DANGER && harvesterValue > MIN_VALUE_FOR_PRIORITY_ESCORT) {
            desiredEscorts = 2;
        }

        // High desperation limits escorts to save units for attacking
        if (desperationScore > HIGH_DESPERATION_THRESHOLD) {
            desiredEscorts = 1;
        }

        // Count existing escorts for this ore
        const existingEscorts = getEscortForOreField(harvesterAI, ore.id);
        const neededEscorts = desiredEscorts - existingEscorts.length;

        if (neededEscorts <= 0) {
            continue;
        }

        // Find and assign available escorts
        // Prefer idle units near the ore field
        const sortedEscorts = [...availableEscorts].sort((a, b) =>
            a.pos.dist(ore.pos) - b.pos.dist(ore.pos)
        );

        for (let i = 0; i < neededEscorts && i < sortedEscorts.length; i++) {
            const escort = sortedEscorts[i];
            harvesterAI.escortAssignments.set(escort.id, ore.id);

            // Remove from available list
            const idx = availableEscorts.indexOf(escort);
            if (idx !== -1) {
                availableEscorts.splice(idx, 1);
            }
        }
    }
}

/**
 * Release escort assignments when danger drops below threshold or ore no longer exists.
 *
 * Removes assignments when:
 * - Danger drops below 30 (ESCORT_RELEASE_DANGER)
 * - Ore field no longer exists in the provided list
 */
export function releaseEscort(
    harvesterAI: HarvesterAIState,
    oreFields: ResourceEntity[]
): void {
    const oreIds = new Set(oreFields.map(o => o.id));
    const toRemove: EntityId[] = [];

    for (const [unitId, oreId] of harvesterAI.escortAssignments) {
        // Check if ore still exists
        if (!oreIds.has(oreId)) {
            toRemove.push(unitId);
            continue;
        }

        // Find the ore to check its danger
        const ore = oreFields.find(o => o.id === oreId);
        if (!ore) {
            toRemove.push(unitId);
            continue;
        }

        // Check if danger has dropped below release threshold
        const danger = getZoneDanger(harvesterAI, ore.pos.x, ore.pos.y);
        if (danger < ESCORT_RELEASE_DANGER) {
            toRemove.push(unitId);
        }
    }

    // Remove all marked assignments
    for (const unitId of toRemove) {
        harvesterAI.escortAssignments.delete(unitId);
    }
}

/**
 * Get the ore field ID that a combat unit is escorting.
 *
 * @returns The ore field EntityId, or null if not escorting
 */
export function getEscortedOreField(
    harvesterAI: HarvesterAIState,
    unitId: EntityId
): EntityId | null {
    return harvesterAI.escortAssignments.get(unitId) ?? null;
}

/**
 * Get all combat units escorting a specific ore field.
 *
 * @returns Array of combat unit EntityIds
 */
export function getEscortForOreField(
    harvesterAI: HarvesterAIState,
    oreId: EntityId
): EntityId[] {
    const escorts: EntityId[] = [];

    for (const [unitId, escortedOreId] of harvesterAI.escortAssignments) {
        if (escortedOreId === oreId) {
            escorts.push(unitId);
        }
    }

    return escorts;
}

/**
 * Calculate the patrol position for an escort around an ore field.
 *
 * Positions are spread around the ore at ESCORT_PATROL_RADIUS (150px),
 * with each escort index getting a different angle.
 *
 * @param ore The ore field to patrol around
 * @param escortIndex Index of this escort (0, 1, 2, etc.) for position spreading
 * @returns Position {x, y} for the escort to patrol to
 */
export function getEscortPatrolPosition(
    ore: ResourceEntity,
    escortIndex: number
): { x: number; y: number } {
    // Spread escorts around the ore in a circle
    // Use 4 base positions (N, E, S, W) offset by index
    const angleOffset = (Math.PI / 2) * escortIndex;

    // Start from north (top), rotate clockwise
    const angle = -Math.PI / 2 + angleOffset;

    const x = ore.pos.x + Math.cos(angle) * ESCORT_PATROL_RADIUS;
    const y = ore.pos.y + Math.sin(angle) * ESCORT_PATROL_RADIUS;

    return { x, y };
}

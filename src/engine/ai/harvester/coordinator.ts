/**
 * Harvester Coordinator for Fleet Management
 *
 * Manages harvester fleet through role assignment and resource distribution.
 * Coordinates multiple harvesters to prevent overcrowding at ore fields
 * and refineries.
 *
 * Features:
 * - Role assignment based on harvester state and desperation
 * - Ore field distribution to prevent overcrowding
 * - Refinery queue management to balance unloading
 *
 * Difficulty Scaling:
 * - Easy/Dummy: No coordination (return early)
 * - Medium: Basic coordination with higher thresholds
 * - Hard: Full coordination with optimal thresholds
 */

import { EntityId, HarvesterUnit, BuildingEntity, ResourceEntity } from '../../types.js';
import {
    HarvesterAIState,
    HarvesterRole,
    HARVESTER_AI_CONSTANTS
} from './types.js';

const { MAX_HARVESTERS_PER_ORE, MAX_HARVESTERS_PER_REFINERY } = HARVESTER_AI_CONSTANTS;

// Thresholds for role assignment
const HP_SAFE_THRESHOLD = 0.5;        // Below 50% HP -> safe role
const CARGO_SAFE_THRESHOLD = 400;     // Above 400 cargo -> safe role
const CARGO_RISK_THRESHOLD = 100;     // Below 100 cargo when desperate -> risk-taker
const DESPERATION_HIGH_THRESHOLD = 70;  // Above 70 -> risk-taker eligible
const DESPERATION_MEDIUM_LOW = 40;      // Below 40 -> standard
const DESPERATION_MEDIUM_HIGH = 70;     // 40-70 -> opportunist

// Medium difficulty uses higher threshold for refinery queues
const MEDIUM_REFINERY_THRESHOLD = 3;

/**
 * Assign roles to harvesters based on their state and current desperation level.
 *
 * Role assignment logic (in priority order):
 * 1. HP < 50%: 'safe' - Prioritize survival
 * 2. cargo > 400: 'safe' - Protect valuable cargo
 * 3. desperation > 70 && cargo < 100: 'risk-taker' - Take risks when desperate
 * 4. desperation 40-70: 'opportunist' - Moderate risk tolerance
 * 5. else: 'standard' - Normal behavior
 *
 * Easy/Dummy difficulties don't assign roles (return early).
 */
export function assignHarvesterRoles(
    harvesterAI: HarvesterAIState,
    harvesters: HarvesterUnit[],
    desperationScore: number,
    difficulty: 'dummy' | 'easy' | 'medium' | 'hard'
): void {
    // Easy and dummy difficulties don't use role assignment
    if (difficulty === 'easy' || difficulty === 'dummy') {
        return;
    }

    for (const harvester of harvesters) {
        const role = determineHarvesterRole(harvester, desperationScore);
        harvesterAI.harvesterRoles.set(harvester.id, role);
    }
}

/**
 * Determine the role for a single harvester based on its state.
 */
function determineHarvesterRole(
    harvester: HarvesterUnit,
    desperationScore: number
): HarvesterRole {
    const hpPercent = harvester.hp / harvester.maxHp;
    const cargo = harvester.harvester.cargo;

    // Priority 1: Low HP -> safe
    if (hpPercent < HP_SAFE_THRESHOLD) {
        return 'safe';
    }

    // Priority 2: High cargo -> safe
    if (cargo > CARGO_SAFE_THRESHOLD) {
        return 'safe';
    }

    // Priority 3: Desperate with low cargo -> risk-taker
    if (desperationScore > DESPERATION_HIGH_THRESHOLD && cargo < CARGO_RISK_THRESHOLD) {
        return 'risk-taker';
    }

    // Priority 4: Medium desperation -> opportunist
    if (desperationScore >= DESPERATION_MEDIUM_LOW && desperationScore <= DESPERATION_MEDIUM_HIGH) {
        return 'opportunist';
    }

    // Default: standard
    return 'standard';
}

/**
 * Get the role for a harvester, defaulting to 'standard' if not assigned.
 */
export function getHarvesterRole(
    harvesterAI: HarvesterAIState,
    harvesterId: EntityId
): HarvesterRole {
    return harvesterAI.harvesterRoles.get(harvesterId) ?? 'standard';
}

/**
 * Distribute harvesters across ore fields to prevent overcrowding.
 *
 * Returns a mapping of ore field ID -> harvester IDs assigned to it.
 * Each ore field is limited to MAX_HARVESTERS_PER_ORE (3) harvesters.
 *
 * Skips harvesters that are already returning to base (have baseTargetId).
 *
 * Easy/Dummy difficulties don't distribute (return empty map).
 */
export function distributeOreFields(
    harvesterAI: HarvesterAIState,
    harvesters: HarvesterUnit[],
    oreFields: ResourceEntity[],
    difficulty: 'dummy' | 'easy' | 'medium' | 'hard'
): Map<EntityId, EntityId[]> {
    const distribution = new Map<EntityId, EntityId[]>();

    // Easy and dummy difficulties don't coordinate
    if (difficulty === 'easy' || difficulty === 'dummy') {
        harvesterAI.oreFieldClaims = distribution;
        return distribution;
    }

    if (oreFields.length === 0) {
        harvesterAI.oreFieldClaims = distribution;
        return distribution;
    }

    // Initialize distribution map with empty arrays
    for (const ore of oreFields) {
        distribution.set(ore.id, []);
    }

    // Filter out harvesters that are returning to base
    const availableHarvesters = harvesters.filter(h => !h.harvester.baseTargetId);

    // Assign each available harvester to nearest ore that isn't full
    for (const harvester of availableHarvesters) {
        // Find nearest ore that isn't at capacity
        let nearestOre: ResourceEntity | null = null;
        let nearestDistance = Infinity;

        for (const ore of oreFields) {
            const assigned = distribution.get(ore.id) ?? [];
            if (assigned.length >= MAX_HARVESTERS_PER_ORE) {
                continue; // This ore is full
            }

            const distance = harvester.pos.dist(ore.pos);
            if (distance < nearestDistance) {
                nearestDistance = distance;
                nearestOre = ore;
            }
        }

        if (nearestOre) {
            const assigned = distribution.get(nearestOre.id)!;
            assigned.push(harvester.id);
        }
    }

    // Update state
    harvesterAI.oreFieldClaims = distribution;
    return distribution;
}

/**
 * Manage refinery queues and redirect excess harvesters.
 *
 * Returns a list of harvesters that should be redirected to different refineries.
 *
 * Thresholds:
 * - Medium: 3 harvesters per refinery
 * - Hard: 2 harvesters per refinery (MAX_HARVESTERS_PER_REFINERY)
 *
 * Easy/Dummy difficulties don't manage queues (return empty array).
 */
export function manageRefineryQueue(
    harvesterAI: HarvesterAIState,
    harvesters: HarvesterUnit[],
    refineries: BuildingEntity[],
    difficulty: 'dummy' | 'easy' | 'medium' | 'hard'
): { harvesterId: EntityId; newRefineryId: EntityId }[] {
    const redirects: { harvesterId: EntityId; newRefineryId: EntityId }[] = [];

    // Easy and dummy difficulties don't manage queues
    if (difficulty === 'easy' || difficulty === 'dummy') {
        return redirects;
    }

    if (refineries.length === 0) {
        return redirects;
    }

    // Determine threshold based on difficulty
    const threshold = difficulty === 'medium' ? MEDIUM_REFINERY_THRESHOLD : MAX_HARVESTERS_PER_REFINERY;

    // Count harvesters per refinery (only those with baseTargetId)
    const refineryQueues = new Map<EntityId, EntityId[]>();
    for (const refinery of refineries) {
        refineryQueues.set(refinery.id, []);
    }

    const harvestersHeadingToRefinery = harvesters.filter(h => h.harvester.baseTargetId);
    for (const harvester of harvestersHeadingToRefinery) {
        const refineryId = harvester.harvester.baseTargetId!;
        if (refineryQueues.has(refineryId)) {
            refineryQueues.get(refineryId)!.push(harvester.id);
        }
    }

    // Update state
    harvesterAI.refineryQueue = refineryQueues;

    // Find overloaded refineries and redirect excess harvesters
    for (const [refineryId, harvesterIds] of refineryQueues) {
        if (harvesterIds.length > threshold) {
            // Need to redirect some harvesters
            const excessCount = harvesterIds.length - threshold;

            // Find alternative refineries with capacity
            const alternativeRefineries = refineries.filter(ref => {
                const queueSize = refineryQueues.get(ref.id)?.length ?? 0;
                return ref.id !== refineryId && queueSize < threshold;
            });

            if (alternativeRefineries.length === 0) {
                continue; // No alternatives available
            }

            // Redirect excess harvesters (starting from end of queue)
            for (let i = 0; i < excessCount && i < alternativeRefineries.length; i++) {
                const harvesterIdToRedirect = harvesterIds[harvesterIds.length - 1 - i];
                const newRefinery = alternativeRefineries[i % alternativeRefineries.length];

                redirects.push({
                    harvesterId: harvesterIdToRedirect,
                    newRefineryId: newRefinery.id
                });
            }
        }
    }

    return redirects;
}

/**
 * Get the maximum acceptable danger level for a harvester role.
 *
 * Role danger limits:
 * - 'safe': 30 (always cautious)
 * - 'standard': 50 + desperationScore/2 (scales with desperation)
 * - 'opportunist': 70 (moderate risk)
 * - 'risk-taker': 100 (maximum risk)
 */
export function getRoleMaxDanger(role: HarvesterRole, desperationScore: number): number {
    switch (role) {
        case 'safe':
            return 30;
        case 'standard':
            return Math.min(100, 50 + desperationScore / 2);
        case 'opportunist':
            return 70;
        case 'risk-taker':
            return 100;
    }
}

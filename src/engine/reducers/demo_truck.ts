import { DemoTruckUnit, Entity, EntityId, Vector } from '../types';
import { RULES } from '../../data/schemas/index';

const DETONATION_RANGE = 40; // Distance at which truck detonates

/**
 * Update demo truck behavior for a single tick.
 * Handles movement toward detonation target and triggering detonation.
 *
 * @returns Updated entity and whether it should detonate
 */
export function updateDemoTruckBehavior(
    truck: DemoTruckUnit,
    allEntities: Record<EntityId, Entity>
): { entity: DemoTruckUnit; shouldDetonate: boolean } {

    // Already detonated or dead - do nothing
    if (truck.demoTruck.hasDetonated || truck.dead) {
        return { entity: truck, shouldDetonate: false };
    }

    // Check for detonation target
    let targetPos: Vector | null = null;
    let targetId: EntityId | null = truck.demoTruck.detonationTargetId;

    if (targetId) {
        const target = allEntities[targetId];
        if (target && !target.dead) {
            targetPos = target.pos;
        } else {
            // Target destroyed - clear it
            return {
                entity: {
                    ...truck,
                    demoTruck: { ...truck.demoTruck, detonationTargetId: null }
                },
                shouldDetonate: false
            };
        }
    } else if (truck.demoTruck.detonationTargetPos) {
        targetPos = truck.demoTruck.detonationTargetPos;
    }

    // No target - just move normally (handled by movement system)
    if (!targetPos) {
        return { entity: truck, shouldDetonate: false };
    }

    // Check if close enough to detonate
    const dist = truck.pos.dist(targetPos);
    if (dist <= DETONATION_RANGE) {
        // DETONATE! Mark as dead - the explosion system will handle the rest
        return {
            entity: {
                ...truck,
                dead: true,
                hp: 0,
                movement: {
                    ...truck.movement,
                    moveTarget: null,
                    vel: new Vector(0, 0),
                    path: null
                }
            },
            shouldDetonate: true
        };
    }

    // Set movement target toward the detonation target
    // The movement system will handle actually moving the unit
    if (!truck.movement.moveTarget || truck.movement.moveTarget.dist(targetPos) > 5) {
        return {
            entity: {
                ...truck,
                movement: {
                    ...truck.movement,
                    moveTarget: targetPos,
                    finalDest: targetPos
                }
            },
            shouldDetonate: false
        };
    }

    return { entity: truck, shouldDetonate: false };
}

/**
 * Set a detonation target for a demo truck.
 * Used when the player commands the truck to attack an enemy.
 */
export function setDetonationTarget(
    truck: DemoTruckUnit,
    targetId: EntityId | null,
    targetPos: Vector | null
): DemoTruckUnit {
    return {
        ...truck,
        demoTruck: {
            ...truck.demoTruck,
            detonationTargetId: targetId,
            detonationTargetPos: targetPos
        },
        // Clear any existing move target - the behavior update will set it
        movement: {
            ...truck.movement,
            moveTarget: null,
            path: null
        }
    };
}

/**
 * Get explosion stats for demo truck from rules.
 */
export function getDemoTruckExplosionStats(): { damage: number; radius: number } {
    const data = RULES.units['demo_truck'];
    return {
        damage: data?.explosionDamage || 500,
        radius: data?.explosionRadius || 120
    };
}

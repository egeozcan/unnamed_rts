import {
    EntityId, Entity, Projectile, CombatUnit, AttackStance, Vector
} from '../types';
import { RULES, isUnitData } from '../../data/schemas/index';
import { getRuleData, createProjectile } from './helpers';
import { getSpatialGrid } from '../spatial';
import { moveToward } from './movement';

// Maximum distance a unit will pursue a target when on defensive stance or attack-move
const DEFENSIVE_PURSUIT_RANGE = 400;

/**
 * Update combat unit behavior - handles auto-targeting and attacks.
 *
 * Respects attack stances:
 * - aggressive: auto-acquire and pursue indefinitely (default)
 * - defensive: auto-acquire, pursue up to DEFENSIVE_PURSUIT_RANGE, then return home
 * - hold_ground: never move, only attack targets in weapon range
 *
 * Also handles attack-move: move toward destination, engage enemies en route with limited pursuit.
 */
export function updateCombatUnitBehavior(
    combatUnit: CombatUnit,
    allEntities: Record<EntityId, Entity>,
    entityList: Entity[]
): { entity: CombatUnit, projectile?: Projectile | null } {

    let nextEntity: CombatUnit = { ...combatUnit };
    let projectile: Projectile | null = null;

    const data = getRuleData(nextEntity.key);
    if (!data || !isUnitData(data)) {
        return { entity: nextEntity, projectile: null };
    }

    const spatialGrid = getSpatialGrid();
    const isEngineer = !!(data.canCaptureEnemyBuildings || data.canRepairFriendlyBuildings);
    const stance: AttackStance = nextEntity.combat.stance || 'aggressive';
    const range = data.range || 100;

    // Check if we're in attack-move mode
    const isAttackMove = !!nextEntity.combat.attackMoveTarget;

    // Auto-acquire target based on stance
    if (!nextEntity.combat.targetId && (data.damage || isEngineer)) {
        const shouldAutoAcquire = shouldAutoAcquireTarget(nextEntity, stance, isAttackMove);

        if (shouldAutoAcquire) {
            // For hold_ground, only search within weapon range
            const searchRange = stance === 'hold_ground' ? range : undefined;
            const result = findCombatTarget(nextEntity, data, spatialGrid, searchRange);

            if (result) {
                // Record home position when first acquiring target (for defensive/attack-move)
                const shouldRecordHome = (stance === 'defensive' || isAttackMove) && !nextEntity.combat.stanceHomePos;
                nextEntity = {
                    ...nextEntity,
                    combat: {
                        ...nextEntity.combat,
                        targetId: result,
                        stanceHomePos: shouldRecordHome ? nextEntity.pos : nextEntity.combat.stanceHomePos
                    }
                };
            }
        }
    }

    // Handle targeting and attacking
    const isHealer = data.damage < 0;
    if (nextEntity.combat.targetId) {
        const target = allEntities[nextEntity.combat.targetId];
        // Clear target if: dead, gone, or healer's target is fully healed
        const shouldClearTarget = !target || target.dead || (isHealer && target.hp >= target.maxHp);
        if (target && !shouldClearTarget) {
            // Check if we should give up pursuit (defensive/attack-move distance limit)
            if (shouldGiveUpPursuit(nextEntity, target, stance, isAttackMove)) {
                nextEntity = clearTargetAndReturnHome(nextEntity, isAttackMove);
            } else {
                const result = handleCombatTarget(nextEntity, target, data, entityList, isEngineer, stance);
                nextEntity = result.entity;
                projectile = result.projectile;
            }
        } else {
            // Target dead, gone, or fully healed - handle return behavior
            nextEntity = clearTargetAndReturnHome(nextEntity, isAttackMove);
        }
    } else if (nextEntity.movement.moveTarget) {
        // No target, just moving (regular move or attack-move in progress)
        nextEntity = moveToward(nextEntity, nextEntity.movement.moveTarget, entityList) as CombatUnit;
        if (nextEntity.pos.dist(nextEntity.movement.moveTarget!) < 10) {
            // Reached intermediate waypoint - check if we still need to reach finalDest
            const finalDest = nextEntity.movement.finalDest;
            const distToFinal = finalDest ? nextEntity.pos.dist(finalDest) : 0;

            if (finalDest && distToFinal > 15) {
                // Still far from final destination - continue moving toward it
                // This prevents units from getting stuck when collision pushes them away
                nextEntity = {
                    ...nextEntity,
                    movement: {
                        ...nextEntity.movement,
                        moveTarget: finalDest,
                        path: null,  // Clear path to trigger re-pathing
                        pathIdx: 0
                    }
                };
            } else {
                // Reached final destination - clear all movement state including unstuck
                nextEntity = {
                    ...nextEntity,
                    movement: {
                        ...nextEntity.movement,
                        moveTarget: null,
                        finalDest: null,
                        stuckTimer: 0,
                        unstuckTimer: 0,
                        unstuckDir: null,
                        avgVel: undefined
                    },
                    combat: {
                        ...nextEntity.combat,
                        attackMoveTarget: null,  // Clear attack-move destination
                        stanceHomePos: null      // Clear home position
                    }
                };
            }
        }
    } else if (nextEntity.movement.unstuckTimer && nextEntity.movement.unstuckTimer > 0) {
        // Unit is idle but still has stale unstuck state - clear it
        nextEntity = {
            ...nextEntity,
            movement: {
                ...nextEntity.movement,
                stuckTimer: 0,
                unstuckTimer: 0,
                unstuckDir: null,
                avgVel: undefined
            }
        };
    } else {
        // Unit is truly idle - check if we're blocking a moving ally and should scatter
        const scatterResult = checkAndScatterForAlly(nextEntity, spatialGrid);
        if (scatterResult) {
            nextEntity = scatterResult;
        }
    }

    if (stance === 'defensive' && nextEntity.combat.stanceHomePos) {
        // Defensive stance: return to home position when idle
        const homePos = nextEntity.combat.stanceHomePos;
        if (nextEntity.pos.dist(homePos) > 20) {
            nextEntity = moveToward(nextEntity, homePos, entityList) as CombatUnit;
        } else {
            // Close enough to home, clear it
            nextEntity = {
                ...nextEntity,
                combat: { ...nextEntity.combat, stanceHomePos: null }
            };
        }
    }

    return { entity: nextEntity, projectile };
}

/**
 * Determine if unit should auto-acquire a new target based on stance
 */
function shouldAutoAcquireTarget(unit: CombatUnit, stance: AttackStance, isAttackMove: boolean): boolean {
    // Attack-move: always actively looking for targets while moving toward destination
    // Check this FIRST since it overrides normal stance behavior
    if (isAttackMove) {
        return true;
    }

    // Hold ground auto-acquires but never moves, so we look for in-range targets
    if (stance === 'hold_ground') {
        return true;
    }

    // Aggressive and defensive: auto-acquire when idle (no movement target)
    return !unit.movement.moveTarget;
}

/**
 * Check if unit should give up pursuit and return home (defensive/attack-move)
 */
function shouldGiveUpPursuit(unit: CombatUnit, _target: Entity, stance: AttackStance, isAttackMove: boolean): boolean {
    // Aggressive never gives up
    if (stance === 'aggressive' && !isAttackMove) {
        return false;
    }

    // Hold ground doesn't pursue at all (handled elsewhere)
    if (stance === 'hold_ground') {
        return false;
    }

    // Check distance from home position
    const homePos = unit.combat.stanceHomePos;
    if (!homePos) {
        return false;  // No home recorded, don't give up
    }

    const distFromHome = unit.pos.dist(homePos);
    return distFromHome > DEFENSIVE_PURSUIT_RANGE;
}

/**
 * Clear target and set up return behavior
 */
function clearTargetAndReturnHome(unit: CombatUnit, isAttackMove: boolean): CombatUnit {
    // Clear stale movement state when changing targets/destinations
    const clearedMovement = {
        ...unit.movement,
        stuckTimer: 0,
        unstuckTimer: 0,
        unstuckDir: null
    };

    if (isAttackMove && unit.combat.attackMoveTarget) {
        // Resume attack-move toward original destination
        return {
            ...unit,
            movement: { ...clearedMovement, moveTarget: unit.combat.attackMoveTarget, path: null },
            combat: {
                ...unit.combat,
                targetId: null,
                stanceHomePos: null  // Will be set fresh when new target acquired
            }
        };
    } else if (unit.combat.stanceHomePos) {
        // Defensive: return to home position
        return {
            ...unit,
            movement: { ...clearedMovement, moveTarget: unit.combat.stanceHomePos, path: null },
            combat: { ...unit.combat, targetId: null }
        };
    } else {
        // Just clear target and movement state
        return {
            ...unit,
            movement: clearedMovement,
            combat: { ...unit.combat, targetId: null }
        };
    }
}

/**
 * Check if this idle unit is blocking a moving ally that is STUCK, and if so, scatter out of the way.
 * Only triggers when the moving ally is actually stuck - not just passing by.
 * Returns the updated unit with a scatter target, or null if no scatter needed.
 */
function checkAndScatterForAlly(
    unit: CombatUnit,
    spatialGrid: ReturnType<typeof getSpatialGrid>
): CombatUnit | null {
    // Only scatter if truly idle - no movement target, no combat target
    if (unit.movement.moveTarget || unit.combat.targetId) {
        return null;
    }

    // Find nearby moving allies
    const nearbyEntities = spatialGrid.queryRadius(unit.pos.x, unit.pos.y, 50);

    for (const other of nearbyEntities) {
        if (other.id === unit.id || other.dead || other.type !== 'UNIT') continue;
        if (other.owner !== unit.owner) continue; // Only scatter for allies

        // Check if other unit is trying to move and we're in their path
        const otherUnit = other as CombatUnit;
        const otherMoveTarget = otherUnit.movement.moveTarget;

        // Only consider units that have an explicit move target (not combat targets)
        // This prevents scattering for units that are just attacking nearby targets
        if (!otherMoveTarget) continue;

        // CRITICAL: Only scatter if the moving unit is actually STUCK
        // This prevents unnecessary scattering when there's room to go around
        const stuckTimer = otherUnit.movement.stuckTimer || 0;
        if (stuckTimer < 15) continue; // Not stuck enough to warrant scatter

        // Check if we're blocking their path
        const dirToTarget = otherMoveTarget.sub(otherUnit.pos).norm();
        const toUs = unit.pos.sub(otherUnit.pos);
        const distToUs = toUs.mag();

        if (distToUs > 45) continue; // Too far to be blocking

        // Project our position onto their movement line
        const projDist = toUs.x * dirToTarget.x + toUs.y * dirToTarget.y;

        // If we're in front of them (positive projection) and close
        if (projDist > 0 && projDist < 50) {
            // Calculate perpendicular distance to their movement line
            const perpDist = Math.abs(toUs.x * (-dirToTarget.y) + toUs.y * dirToTarget.x);

            // If we're directly in their collision corridor (tight check)
            if (perpDist < unit.radius + otherUnit.radius) {
                // Scatter perpendicular to their movement
                // Use "keep right" convention: move to the right side of their path
                const scatterDir = new Vector(-dirToTarget.y, dirToTarget.x);
                const scatterDist = 35 + Math.random() * 15; // Random scatter distance
                const scatterTarget = unit.pos.add(scatterDir.scale(scatterDist));

                return {
                    ...unit,
                    movement: {
                        ...unit.movement,
                        moveTarget: scatterTarget,
                        path: null,
                        pathIdx: 0
                    }
                };
            }
        }
    }

    return null;
}

/**
 * Find a combat target using spatial grid search
 * @param maxRange - Optional max range override (used for hold_ground to limit to weapon range)
 */
function findCombatTarget(
    unit: CombatUnit,
    data: ReturnType<typeof getRuleData>,
    spatialGrid: ReturnType<typeof getSpatialGrid>,
    maxRange?: number
): EntityId | null {

    if (!data || !isUnitData(data)) return null;

    const isHealer = data.damage < 0;
    const isEngineer = data.canCaptureEnemyBuildings || data.canRepairFriendlyBuildings;
    const range = maxRange ?? ((data.range || 100) + (isHealer ? 100 : 50));

    const weaponType = data.weaponType || 'bullet';
    const targeting = RULES.weaponTargeting?.[weaponType] || { canTargetGround: true, canTargetAir: false };

    const predicate = (other: Entity) => {
        if (other.dead || other.owner === -1) return false;

        // Check weapon targeting capabilities (air vs ground)
        const otherData = getRuleData(other.key);
        const isTargetAir = otherData && isUnitData(otherData) && otherData.fly === true;
        if (isTargetAir && !targeting.canTargetAir) return false;
        if (!isTargetAir && !targeting.canTargetGround) return false;

        if (isHealer) {
            // Medics can only heal infantry units
            const targetType = otherData && isUnitData(otherData) ? otherData.type : null;
            return other.owner === unit.owner && other.hp < other.maxHp && other.type === 'UNIT' && other.id !== unit.id && targetType === 'infantry';
        } else if (isEngineer) {
            if (other.type !== 'BUILDING') return false;
            if (other.owner !== unit.owner && data.canCaptureEnemyBuildings) return true;
            if (other.owner === unit.owner && other.hp < other.maxHp && data.canRepairFriendlyBuildings) return true;
            return false;
        } else {
            return other.owner !== unit.owner;
        }
    };

    const searchRadius = Math.max(range, 200);
    const found = spatialGrid.findNearest(unit.pos.x, unit.pos.y, searchRadius, predicate);

    if (found && found.pos.dist(unit.pos) <= range) {
        return found.id;
    }

    return null;
}

/**
 * Handle attacking or interacting with a combat target
 */
function handleCombatTarget(
    unit: CombatUnit,
    target: Entity,
    data: ReturnType<typeof getRuleData>,
    entityList: Entity[],
    isEngineer: boolean,
    stance: AttackStance
): { entity: CombatUnit, projectile: Projectile | null } {

    if (!data || !isUnitData(data)) {
        return { entity: unit, projectile: null };
    }

    // Check if this unit can actually attack the target type (air vs ground)
    const targetData = getRuleData(target.key);
    const isTargetAir = targetData && isUnitData(targetData) && targetData.fly === true;
    const weaponType = data.weaponType || 'bullet';
    const targeting = RULES.weaponTargeting?.[weaponType] || { canTargetGround: true, canTargetAir: false };

    if (isTargetAir && !targeting.canTargetAir) {
        // Can't attack air targets - clear target and stop chasing
        return {
            entity: {
                ...unit,
                combat: { ...unit.combat, targetId: null },
                movement: { ...unit.movement, moveTarget: null, path: null, pathIdx: 0 }
            },
            projectile: null
        };
    }
    if (!isTargetAir && !targeting.canTargetGround) {
        // Can't attack ground targets - clear target
        return {
            entity: {
                ...unit,
                combat: { ...unit.combat, targetId: null },
                movement: { ...unit.movement, moveTarget: null, path: null, pathIdx: 0 }
            },
            projectile: null
        };
    }

    const dist = unit.pos.dist(target.pos);
    const range = data.range || 100;

    // Ground units should NEVER chase air units - only attack if already in range
    // If air target is out of range, clear target and move on
    if (isTargetAir && dist > range) {
        return {
            entity: {
                ...unit,
                combat: { ...unit.combat, targetId: null }
                // Don't clear moveTarget - let unit continue to original destination
            },
            projectile: null
        };
    }

    // Hold ground stance: if target is out of range, clear it (don't pursue)
    if (stance === 'hold_ground' && dist > range) {
        return {
            entity: {
                ...unit,
                combat: { ...unit.combat, targetId: null }
            },
            projectile: null
        };
    }

    let nextUnit = unit;
    let projectile: Projectile | null = null;

    // Engineer special behavior
    if (isEngineer && target.type === 'BUILDING') {
        // Entry distance based on building bounds (not radius) - allows entry from any direction
        const halfW = target.w / 2;
        const halfH = target.h / 2;
        const dx = Math.abs(unit.pos.x - target.pos.x);
        const dy = Math.abs(unit.pos.y - target.pos.y);
        const entryBuffer = 30; // pixels from building edge
        const canEnter = dx < halfW + entryBuffer && dy < halfH + entryBuffer;
        if (canEnter) {
            nextUnit = {
                ...nextUnit,
                movement: { ...nextUnit.movement, moveTarget: null }
            };

            const targetBuildingData = RULES.buildings[target.key];
            const isCapturable = targetBuildingData?.capturable === true;
            if (target.owner !== unit.owner && data.canCaptureEnemyBuildings && isCapturable) {
                // Capture enemy building - engineer is consumed
                nextUnit = {
                    ...nextUnit,
                    dead: true,
                    engineer: { ...nextUnit.engineer, captureTargetId: target.id }
                };
            } else if (target.owner === unit.owner && data.canRepairFriendlyBuildings && target.hp < target.maxHp) {
                // Repair friendly building - engineer enters and is consumed, building fully healed
                nextUnit = {
                    ...nextUnit,
                    dead: true,
                    engineer: { ...nextUnit.engineer, repairTargetId: target.id }
                };
            }
            return { entity: nextUnit, projectile: null };
        } else {
            // Move to building
            return { entity: moveToward(unit, target.pos, entityList) as CombatUnit, projectile: null };
        }
    }

    // Normal combat behavior
    if (dist <= range) {
        // In range - attack
        // Only stop moving if this unit cannot attack while moving
        const canAttackWhileMoving = data.canAttackWhileMoving === true;
        if (!canAttackWhileMoving) {
            nextUnit = {
                ...nextUnit,
                movement: { ...nextUnit.movement, moveTarget: null }
            };
        }

        if (unit.combat.cooldown <= 0) {
            projectile = createProjectile(unit, target);
            nextUnit = {
                ...nextUnit,
                combat: { ...nextUnit.combat, cooldown: data.rate || 30 }
            };
        }
    } else {
        // Move toward target
        nextUnit = moveToward(unit, target.pos, entityList) as CombatUnit;
    }

    return { entity: nextUnit, projectile };
}

import {
    EntityId, Entity, Projectile, CombatUnit
} from '../types';
import { RULES, isUnitData } from '../../data/schemas/index';
import { getRuleData, createProjectile } from './helpers';
import { getSpatialGrid } from '../spatial';
import { moveToward } from './movement';

/**
 * Update combat unit behavior - handles auto-targeting and attacks.
 * 
 * Extracted from updateUnit for better maintainability.
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

    // Auto-acquire target if we don't have one and we're idle
    if (!nextEntity.combat.targetId && !nextEntity.movement.moveTarget && (data.damage || isEngineer)) {
        const result = findCombatTarget(nextEntity, data, spatialGrid);
        if (result) {
            nextEntity = {
                ...nextEntity,
                combat: { ...nextEntity.combat, targetId: result }
            };
        }
    }

    // Handle targeting and attacking
    if (nextEntity.combat.targetId) {
        const target = allEntities[nextEntity.combat.targetId];
        if (target && !target.dead) {
            const result = handleCombatTarget(nextEntity, target, data, entityList, isEngineer);
            nextEntity = result.entity;
            projectile = result.projectile;
        } else {
            // Target dead or gone - clear it
            nextEntity = {
                ...nextEntity,
                combat: { ...nextEntity.combat, targetId: null }
            };
        }
    } else if (nextEntity.movement.moveTarget) {
        // No target, just moving
        nextEntity = moveToward(nextEntity, nextEntity.movement.moveTarget, entityList) as CombatUnit;
        if (nextEntity.pos.dist(nextEntity.movement.moveTarget!) < 10) {
            nextEntity = {
                ...nextEntity,
                movement: { ...nextEntity.movement, moveTarget: null }
            };
        }
    }

    return { entity: nextEntity, projectile };
}

/**
 * Find a combat target using spatial grid search
 */
function findCombatTarget(
    unit: CombatUnit,
    data: ReturnType<typeof getRuleData>,
    spatialGrid: ReturnType<typeof getSpatialGrid>
): EntityId | null {

    if (!data || !isUnitData(data)) return null;

    const isHealer = data.damage < 0;
    const isEngineer = data.canCaptureEnemyBuildings || data.canRepairFriendlyBuildings;
    const range = (data.range || 100) + (isHealer ? 100 : 50);

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
            return other.owner === unit.owner && other.hp < other.maxHp && other.type === 'UNIT' && other.id !== unit.id;
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
    isEngineer: boolean
): { entity: CombatUnit, projectile: Projectile | null } {

    if (!data || !isUnitData(data)) {
        return { entity: unit, projectile: null };
    }

    const dist = unit.pos.dist(target.pos);
    const range = data.range || 100;
    let nextUnit = unit;
    let projectile: Projectile | null = null;

    // Engineer special behavior
    if (isEngineer && target.type === 'BUILDING') {
        if (dist < 40) {
            nextUnit = {
                ...nextUnit,
                movement: { ...nextUnit.movement, moveTarget: null }
            };

            if (target.owner !== unit.owner && data.canCaptureEnemyBuildings) {
                // Capture enemy building - engineer is consumed
                nextUnit = {
                    ...nextUnit,
                    dead: true,
                    engineer: { ...nextUnit.engineer, captureTargetId: target.id }
                };
            } else if (target.owner === unit.owner && data.canRepairFriendlyBuildings) {
                // Repair friendly building
                if (unit.combat.cooldown <= 0) {
                    nextUnit = {
                        ...nextUnit,
                        combat: { ...nextUnit.combat, cooldown: data.rate || 30 },
                        engineer: { ...nextUnit.engineer, repairTargetId: target.id }
                    };
                }
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
        nextUnit = {
            ...nextUnit,
            movement: { ...nextUnit.movement, moveTarget: null }
        };

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

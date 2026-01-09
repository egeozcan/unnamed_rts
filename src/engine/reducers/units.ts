import {
    GameState, EntityId, Entity, Vector, UnitEntity, HarvesterUnit, CombatUnit, Projectile, AirUnit, BuildingEntity
} from '../types';
import { isUnitData } from '../../data/schemas/index';
import { getRuleData, createProjectile, createEntity } from './helpers';
import { isAirUnit } from '../entity-helpers';
import { updateHarvesterBehavior } from './harvester';
import { updateCombatUnitBehavior } from './combat';
import { moveToward } from './movement';

// Re-export for backwards compatibility
export { moveToward };

/**
 * Calculate formation positions for a group of units moving to a target.
 * Uses a box/grid formation that grows with unit count.
 */
function calculateFormationPositions(center: Vector, unitCount: number, unitRadius: number): Vector[] {
    if (unitCount <= 1) return [center];

    // Spacing between units (based on typical unit radius + buffer)
    const spacing = unitRadius * 2.5;

    // Calculate grid dimensions - prefer wider than tall formations
    const cols = Math.ceil(Math.sqrt(unitCount * 1.5));
    const rows = Math.ceil(unitCount / cols);

    // Calculate offset to center the formation on the target
    const offsetX = ((cols - 1) * spacing) / 2;
    const offsetY = ((rows - 1) * spacing) / 2;

    const positions: Vector[] = [];
    for (let i = 0; i < unitCount; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        positions.push(new Vector(
            center.x - offsetX + col * spacing,
            center.y - offsetY + row * spacing
        ));
    }

    return positions;
}

export function commandMove(state: GameState, payload: { unitIds: EntityId[]; x: number; y: number }): GameState {
    const { unitIds, x, y } = payload;
    const target = new Vector(x, y);

    // Filter to valid movable units
    const movableUnits: UnitEntity[] = [];
    for (const id of unitIds) {
        const entity = state.entities[id];
        if (entity && entity.owner !== -1 && entity.type === 'UNIT' && !isAirUnit(entity)) {
            movableUnits.push(entity);
        }
    }

    if (movableUnits.length === 0) {
        return state;
    }

    // Calculate formation positions based on average unit radius
    const avgRadius = movableUnits.reduce((sum, u) => sum + u.radius, 0) / movableUnits.length;
    const formationPositions = calculateFormationPositions(target, movableUnits.length, avgRadius);

    // Sort units by distance to target center for efficient position assignment
    // Units closest to target get positions closest to center
    const sortedUnits = [...movableUnits].sort((a, b) =>
        a.pos.dist(target) - b.pos.dist(target)
    );

    // Assign positions - match each unit to the closest available formation slot
    const assignedPositions = new Map<EntityId, Vector>();
    const availablePositions = [...formationPositions];

    for (const unit of sortedUnits) {
        // Find closest available position to this unit's current position
        let bestIdx = 0;
        let bestDist = unit.pos.dist(availablePositions[0]);
        for (let i = 1; i < availablePositions.length; i++) {
            const dist = unit.pos.dist(availablePositions[i]);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }
        assignedPositions.set(unit.id, availablePositions[bestIdx]);
        availablePositions.splice(bestIdx, 1);
    }

    let nextEntities = { ...state.entities };
    for (const unit of movableUnits) {
        const formationTarget = assignedPositions.get(unit.id) || target;

        if (unit.key === 'harvester') {
            // Harvester: clear harvesting targets and enable manual mode
            nextEntities[unit.id] = {
                ...unit,
                movement: { ...unit.movement, moveTarget: formationTarget, path: null },
                combat: { ...unit.combat, targetId: null },
                harvester: { ...unit.harvester, resourceTargetId: null, baseTargetId: null, manualMode: true }
            };
        } else {
            // Combat unit
            nextEntities[unit.id] = {
                ...unit,
                movement: { ...unit.movement, moveTarget: formationTarget, path: null },
                combat: { ...unit.combat, targetId: null }
            };
        }
    }
    return { ...state, entities: nextEntities };
}

export function commandAttack(state: GameState, payload: { unitIds: EntityId[]; targetId: EntityId }): GameState {
    const { unitIds, targetId } = payload;
    const target = state.entities[targetId];

    let nextEntities = { ...state.entities };
    for (const id of unitIds) {
        const entity = nextEntities[id];
        if (entity && entity.owner !== -1 && entity.type === 'UNIT') {
            // Special handling for harvesters: right-clicking on resources or refineries
            // enables auto-harvesting mode
            if (entity.key === 'harvester' && target) {
                if (target.type === 'RESOURCE') {
                    // Right-click on ore: enable auto-harvesting and set resource target
                    nextEntities[id] = {
                        ...entity,
                        movement: { ...entity.movement, moveTarget: null, path: null },
                        harvester: {
                            ...entity.harvester,
                            resourceTargetId: targetId,
                            baseTargetId: null,
                            manualMode: false
                        }
                    };
                } else if (target.key === 'refinery' && target.owner === entity.owner) {
                    // Right-click on own refinery: enable auto-harvesting and go dock
                    nextEntities[id] = {
                        ...entity,
                        movement: { ...entity.movement, moveTarget: null, path: null },
                        harvester: {
                            ...entity.harvester,
                            baseTargetId: targetId,
                            manualMode: false
                        }
                    };
                } else {
                    // Harvesters can't attack other things, treat as move
                    nextEntities[id] = {
                        ...entity,
                        movement: { ...entity.movement, moveTarget: target.pos, path: null },
                        combat: { ...entity.combat, targetId: null }
                    };
                }
            } else if (isAirUnit(entity)) {
                // Special handling for air units (harriers)
                // Only launch if docked and has ammo, and target is enemy
                if (entity.airUnit.state === 'docked' && entity.airUnit.ammo > 0 && target && target.owner !== entity.owner) {
                    // Launch harrier - set to flying, assign target, clear slot on air base
                    const homeBaseId = entity.airUnit.homeBaseId;
                    const dockedSlot = entity.airUnit.dockedSlot;

                    // Update harrier to flying state
                    const launchedHarrier: AirUnit = {
                        ...entity,
                        airUnit: {
                            ...entity.airUnit,
                            state: 'flying',
                            dockedSlot: null
                        },
                        combat: { ...entity.combat, targetId: targetId }
                    };
                    nextEntities[id] = launchedHarrier;

                    // Clear slot on air base
                    if (homeBaseId && dockedSlot !== null) {
                        const airBase = nextEntities[homeBaseId] as BuildingEntity;
                        if (airBase && airBase.airBase) {
                            const newSlots = [...airBase.airBase.slots];
                            newSlots[dockedSlot] = null;
                            nextEntities[homeBaseId] = {
                                ...airBase,
                                airBase: {
                                    ...airBase.airBase,
                                    slots: newSlots
                                }
                            };
                        }
                    }
                }
                // Otherwise (not docked, no ammo, or no target): ignore command
            } else {
                // Normal combat unit attack behavior - only target enemies
                if (target && target.owner !== entity.owner) {
                    nextEntities[id] = {
                        ...entity,
                        movement: { ...entity.movement, moveTarget: null, path: null },
                        combat: { ...entity.combat, targetId: targetId }
                    };
                }
            }
        }
    }
    return { ...state, entities: nextEntities };
}

export function deployMCV(state: GameState, payload: { unitId: EntityId }): GameState {
    const { unitId } = payload;
    const mcv = state.entities[unitId];

    // Validate MCV
    if (!mcv || mcv.type !== 'UNIT' || mcv.key !== 'mcv' || mcv.dead) {
        return state;
    }

    // Define ConYard dimensions (90x90 per rules)
    const size = 90;
    const radius = size / 2;
    const x = mcv.pos.x;
    const y = mcv.pos.y;

    // Check bounds
    if (x < size / 2 || x > state.config.width - size / 2 ||
        y < size / 2 || y > state.config.height - size / 2) {
        return {
            ...state,
            notification: { text: 'Cannot deploy: Out of bounds', type: 'error', tick: state.tick }
        };
    }

    // Check collisions with other entities
    const blockers = Object.values(state.entities).filter(e =>
        !e.dead && e.id !== unitId && (
            e.type === 'BUILDING' ||
            e.type === 'RESOURCE' ||
            e.type === 'ROCK' ||
            e.type === 'WELL'
        )
    );

    for (const blocker of blockers) {
        const combinedRadius = radius + blocker.radius;
        if (mcv.pos.dist(blocker.pos) < combinedRadius * 0.9) { // 0.9 grace factor
            return {
                ...state,
                notification: { text: "Cannot deploy: Blocked", type: 'error', tick: state.tick }
            };
        }
    }

    // Valid placement: Create ConYard
    // Remove MCV
    const nextEntities = { ...state.entities };
    delete nextEntities[unitId];

    // Create ConYard
    const newConYard = createEntity(x, y, mcv.owner, 'BUILDING', 'conyard', state);

    nextEntities[newConYard.id] = newConYard;

    // Clear selection if MCV was selected
    const nextSelection = state.selection.filter(id => id !== unitId);
    // Auto-select the new conyard? Usually yes.
    nextSelection.push(newConYard.id);

    return {
        ...state,
        entities: nextEntities,
        selection: nextSelection,
        notification: { text: "Base Established", type: 'info', tick: state.tick }
    };
}

export function updateUnit(
    entity: UnitEntity,
    allEntities: Record<EntityId, Entity>,
    entityList: Entity[],
    mapConfig: { width: number, height: number },
    currentTick: number,
    harvesterCounts?: Record<EntityId, number>
): { entity: UnitEntity, projectile?: Projectile | null, creditsEarned: number, resourceDamage?: { id: string, amount: number } | null } {

    const data = getRuleData(entity.key);

    // Handle harvester units
    if (entity.key === 'harvester') {
        const result = updateHarvesterBehavior(
            entity as HarvesterUnit,
            allEntities,
            entityList,
            mapConfig,
            currentTick,
            harvesterCounts
        );

        // Handle harvester attacking with explicit targetId (rare case - AI commanded attack)
        if ((result.entity as HarvesterUnit).combat.targetId) {
            const harvester = result.entity as HarvesterUnit;
            const target = allEntities[harvester.combat.targetId!];
            if (target && !target.dead) {
                const harvData = getRuleData('harvester');
                const dist = harvester.pos.dist(target.pos);
                const range = harvData?.range ?? 60;

                if (dist <= range) {
                    let updatedHarv: HarvesterUnit = {
                        ...harvester,
                        movement: { ...harvester.movement, moveTarget: null }
                    };
                    if (harvester.combat.cooldown <= 0) {
                        const projectile = createProjectile(harvester, target);
                        updatedHarv = {
                            ...updatedHarv,
                            combat: { ...updatedHarv.combat, cooldown: harvData?.rate ?? 30 }
                        };
                        return { entity: updatedHarv, projectile, creditsEarned: result.creditsEarned, resourceDamage: result.resourceDamage };
                    }
                    return { entity: updatedHarv, projectile: result.projectile, creditsEarned: result.creditsEarned, resourceDamage: result.resourceDamage };
                } else {
                    const movedHarv = moveToward(harvester, target.pos, entityList) as HarvesterUnit;
                    return { entity: movedHarv, projectile: result.projectile, creditsEarned: result.creditsEarned, resourceDamage: result.resourceDamage };
                }
            } else {
                return {
                    entity: {
                        ...harvester,
                        combat: { ...harvester.combat, targetId: null }
                    },
                    projectile: result.projectile,
                    creditsEarned: result.creditsEarned,
                    resourceDamage: result.resourceDamage
                };
            }
        }

        // Handle harvester manual move target
        if (result.entity.movement.moveTarget) {
            let nextEntity = moveToward(result.entity, result.entity.movement.moveTarget, entityList) as HarvesterUnit;

            const clearDistance = 30;
            const harvesterFleeTimeout = 40;
            const isStuckOnFlee = (nextEntity.movement.stuckTimer || 0) > harvesterFleeTimeout;
            let moveTargetTicks = result.entity.movement.moveTargetNoProgressTicks || 0;
            moveTargetTicks++;
            const absoluteFleeTimeout = 90;
            const isFleeTimedOut = moveTargetTicks > absoluteFleeTimeout;

            if (nextEntity.pos.dist(result.entity.movement.moveTarget!) < clearDistance || isStuckOnFlee || isFleeTimedOut) {
                const shouldDisableManualMode = isFleeTimedOut || isStuckOnFlee;
                const fleeCooldownDuration = 300;
                nextEntity = {
                    ...nextEntity,
                    movement: {
                        ...nextEntity.movement,
                        moveTarget: null,
                        path: null,
                        pathIdx: 0,
                        stuckTimer: 0,
                        lastDistToMoveTarget: undefined,
                        bestDistToMoveTarget: undefined,
                        moveTargetNoProgressTicks: undefined
                    },
                    harvester: {
                        ...nextEntity.harvester,
                        manualMode: shouldDisableManualMode ? false : nextEntity.harvester.manualMode,
                        fleeCooldownUntilTick: shouldDisableManualMode ? (currentTick + fleeCooldownDuration) : undefined
                    }
                };
            } else {
                nextEntity = {
                    ...nextEntity,
                    movement: {
                        ...nextEntity.movement,
                        moveTargetNoProgressTicks: moveTargetTicks
                    }
                };
            }

            return { entity: nextEntity, projectile: result.projectile, creditsEarned: result.creditsEarned, resourceDamage: result.resourceDamage };
        }

        return result;
    }

    // Handle combat units (non-harvester, non-air)
    if (data && isUnitData(data)) {
        const result = updateCombatUnitBehavior(
            entity as CombatUnit,
            allEntities,
            entityList
        );
        return { entity: result.entity, projectile: result.projectile, creditsEarned: 0, resourceDamage: null };
    }

    // Fallback for unknown unit types
    return { entity, projectile: null, creditsEarned: 0, resourceDamage: null };
}

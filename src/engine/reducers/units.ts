import {
    GameState, EntityId, Entity, Vector, UnitEntity, HarvesterUnit, CombatUnit, Projectile, AirUnit, BuildingEntity
} from '../types';
import { isUnitData } from '../../data/schemas/index';
import { getRuleData, createProjectile, createEntity } from './helpers';
import { isAirUnit } from '../entity-helpers';
import { updateHarvesterBehavior } from './harvester';
import { updateCombatUnitBehavior } from './combat';
import { moveToward } from './movement';
import { getSpatialGrid } from '../spatial';

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

/**
 * Calculate spread positions around a target for attack commands.
 * Units spread in a ring around the target to avoid bunching up.
 */
function calculateAttackSpreadPositions(targetPos: Vector, attackerPositions: Vector[], approachRange: number): Vector[] {
    const count = attackerPositions.length;
    if (count <= 1) return [targetPos];

    // Calculate average direction from attackers to target
    let avgDir = new Vector(0, 0);
    for (const pos of attackerPositions) {
        avgDir = avgDir.add(targetPos.sub(pos).norm());
    }
    avgDir = avgDir.norm();

    // Spread units in an arc facing the target
    // Arc widens based on number of units
    const arcAngle = Math.min(Math.PI * 0.8, (count - 1) * 0.3); // Max 144 degrees
    const startAngle = Math.atan2(avgDir.y, avgDir.x) - arcAngle / 2;

    const positions: Vector[] = [];
    for (let i = 0; i < count; i++) {
        const angle = count > 1 ? startAngle + (arcAngle * i) / (count - 1) : startAngle;
        // Position units at approach range from target
        positions.push(new Vector(
            targetPos.x - Math.cos(angle) * approachRange,
            targetPos.y - Math.sin(angle) * approachRange
        ));
    }

    return positions;
}

export function commandAttack(state: GameState, payload: { unitIds: EntityId[]; targetId: EntityId }): GameState {
    const { unitIds, targetId } = payload;
    const target = state.entities[targetId];

    if (!target) {
        return state;
    }

    // Collect combat units that will attack
    const attackers: UnitEntity[] = [];
    for (const id of unitIds) {
        const entity = state.entities[id];
        if (entity && entity.owner !== -1 && entity.type === 'UNIT' &&
            entity.key !== 'harvester' && !isAirUnit(entity) &&
            target.owner !== entity.owner) {
            attackers.push(entity);
        }
    }

    // Calculate spread positions for attackers
    const attackerPositions = attackers.map(u => u.pos);
    const approachRange = 80; // Distance from target to spread to
    const spreadPositions = calculateAttackSpreadPositions(target.pos, attackerPositions, approachRange);

    // Assign spread positions to attackers (closest unit to closest position)
    const assignedSpread = new Map<EntityId, Vector>();
    const availableSpread = [...spreadPositions];
    const sortedAttackers = [...attackers].sort((a, b) => a.pos.dist(target.pos) - b.pos.dist(target.pos));

    for (const unit of sortedAttackers) {
        if (availableSpread.length === 0) break;
        let bestIdx = 0;
        let bestDist = unit.pos.dist(availableSpread[0]);
        for (let i = 1; i < availableSpread.length; i++) {
            const dist = unit.pos.dist(availableSpread[i]);
            if (dist < bestDist) {
                bestDist = dist;
                bestIdx = i;
            }
        }
        assignedSpread.set(unit.id, availableSpread[bestIdx]);
        availableSpread.splice(bestIdx, 1);
    }

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
                    // Use spread position if assigned, otherwise approach directly
                    const spreadPos = assignedSpread.get(id);
                    nextEntities[id] = {
                        ...entity,
                        movement: { ...entity.movement, moveTarget: spreadPos || null, path: null },
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

export function deployInductionRig(state: GameState, payload: { unitId: EntityId; wellId: EntityId }): GameState {
    const { unitId, wellId } = payload;
    const rig = state.entities[unitId];
    const well = state.entities[wellId];

    // Validate induction rig
    if (!rig || rig.type !== 'UNIT' || rig.key !== 'induction_rig' || rig.dead) {
        return state;
    }

    // Validate well
    if (!well || well.type !== 'WELL' || well.dead) {
        return {
            ...state,
            notification: { text: 'Cannot deploy: Invalid well', type: 'error', tick: state.tick }
        };
    }

    // Check if another induction rig is already on this well
    const existingRig = Object.values(state.entities).find(e =>
        e.type === 'BUILDING' &&
        e.key === 'induction_rig_deployed' &&
        !e.dead &&
        e.inductionRig?.wellId === wellId
    );

    if (existingRig) {
        return {
            ...state,
            notification: { text: 'Cannot deploy: Well already has a rig', type: 'error', tick: state.tick }
        };
    }

    // Check distance to well (must be close enough to deploy)
    const deployRange = 80; // Distance required to deploy on a well
    if (rig.pos.dist(well.pos) > deployRange) {
        return {
            ...state,
            notification: { text: 'Cannot deploy: Move closer to well', type: 'error', tick: state.tick }
        };
    }

    // Valid placement: Create deployed induction rig
    // Remove the mobile rig
    const nextEntities = { ...state.entities };
    delete nextEntities[unitId];

    // Clear ores around the well that would block placement
    const clearRadius = 40; // Slightly larger than rig half-size (25) + ore radius
    for (const id in nextEntities) {
        const entity = nextEntities[id];
        if (entity.type === 'RESOURCE' && !entity.dead) {
            const dist = entity.pos.dist(well.pos);
            if (dist < clearRadius) {
                delete nextEntities[id];
            }
        }
    }

    // Create deployed induction rig on the well's position
    const deployedRig = createEntity(well.pos.x, well.pos.y, rig.owner, 'BUILDING', 'induction_rig_deployed', state);

    // Add the inductionRig component with the well reference
    const deployedRigWithComponent: BuildingEntity = {
        ...deployedRig as BuildingEntity,
        inductionRig: {
            wellId: wellId,
            accumulatedCredits: 0
        }
    };

    nextEntities[deployedRigWithComponent.id] = deployedRigWithComponent;

    // Clear selection if rig was selected
    const nextSelection = state.selection.filter(id => id !== unitId);
    nextSelection.push(deployedRigWithComponent.id);

    return {
        ...state,
        entities: nextEntities,
        selection: nextSelection,
        notification: { text: "Induction Rig Deployed", type: 'info', tick: state.tick }
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

            // Check if target is unreachable (inside a building)
            const spatialGrid = getSpatialGrid();
            const target = result.entity.movement.moveTarget!;
            // Check entities near the target
            const nearbyBlockers = spatialGrid.queryRadius(target.x, target.y, 60);
            const isTargetBlocked = nearbyBlockers.some(e =>
                (e.type === 'BUILDING' || e.type === 'ROCK') &&
                !e.dead &&
                target.dist(e.pos) < e.radius
            );

            if (nextEntity.pos.dist(result.entity.movement.moveTarget!) < clearDistance || isStuckOnFlee || isFleeTimedOut || isTargetBlocked) {
                // Keep manualMode - harvesters should stay idle after reaching destination or getting stuck
                // Only explicitly commanding to harvest (right-click ore) should disable manual mode
                // EXCEPTION: If blocked by building (e.g. user clicked refinery), clear manualMode to allow auto-docking/harvesting
                const shouldClearManual = isTargetBlocked;

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
                        moveTargetNoProgressTicks: undefined,
                        vel: isTargetBlocked ? new Vector(0, 0) : nextEntity.movement.vel
                    },
                    harvester: {
                        ...nextEntity.harvester,
                        manualMode: shouldClearManual ? false : nextEntity.harvester.manualMode
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

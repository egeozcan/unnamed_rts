import {
    GameState, EntityId, Entity, Vector, UnitEntity, HarvesterUnit, CombatUnit, DemoTruckUnit, Projectile, BuildingEntity, AttackStance
} from '../types';
import { isUnitData } from '../../data/schemas/index';
import { getRuleData, createProjectile, createEntity } from './helpers';
import { isAirUnit } from '../entity-helpers';
import { isDemoTruck } from '../type-guards';
import { updateHarvesterBehavior } from './harvester';
import { updateCombatUnitBehavior } from './combat';
import { updateDemoTruckBehavior, setDetonationTarget } from './demo_truck';
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

    // Sort units by ID for stable position assignment
    // Prevents "circling" where moving units constantly swap slots as their distances change
    const sortedUnits = [...movableUnits].sort((a, b) =>
        a.id.localeCompare(b.id)
    );

    // STABLE ASSIGNMENT: Map sorted units to formation positions by index
    // This ensures that as long as the group membership is stable, the slot assignment is stable.
    const assignedPositions = new Map<EntityId, Vector>();
    for (let i = 0; i < sortedUnits.length; i++) {
        if (i < formationPositions.length) {
            assignedPositions.set(sortedUnits[i].id, formationPositions[i]);
        } else {
            // Fallback if more units than positions (shouldn't happen with current calculation)
            assignedPositions.set(sortedUnits[i].id, target);
        }
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

    // Expand unitIds to include ALL harriers (docked OR flying) from any selected airforce_command buildings
    const expandedUnitIds: EntityId[] = [...unitIds];
    const selectedBaseIds: EntityId[] = [];

    // First pass: Identify selected air bases
    for (const id of unitIds) {
        const entity = state.entities[id];
        if (entity && entity.type === 'BUILDING' && entity.key === 'airforce_command') {
            selectedBaseIds.push(id);
        }
    }

    // If any air bases selected, find ALL their harriers (docked or flying)
    if (selectedBaseIds.length > 0) {
        for (const id in state.entities) {
            const ent = state.entities[id];
            if (ent.type === 'UNIT' && ent.key === 'harrier' && !ent.dead && isAirUnit(ent)) {
                if (ent.airUnit.homeBaseId && selectedBaseIds.includes(ent.airUnit.homeBaseId)) {
                    if (!expandedUnitIds.includes(id)) {
                        expandedUnitIds.push(id);
                    }
                }
            }
        }
    }

    // Collect combat units that will attack
    const attackers: UnitEntity[] = [];
    for (const id of expandedUnitIds) {
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

    // STABLE ASSIGNMENT: Map sorted units to spread positions by index
    const assignedSpread = new Map<EntityId, Vector>();
    const sortedAttackers = [...attackers].sort((a, b) => a.id.localeCompare(b.id));

    for (let i = 0; i < sortedAttackers.length; i++) {
        if (i < spreadPositions.length) {
            assignedSpread.set(sortedAttackers[i].id, spreadPositions[i]);
        } else {
            assignedSpread.set(sortedAttackers[i].id, target.pos); // Fallback
        }
    }

    let nextEntities = { ...state.entities };
    for (const id of expandedUnitIds) {
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
                    // Start launch sequence: just set targetId.
                    // The AirBase update loop will detect this target and launch the harrier in a staggered way.
                    nextEntities[id] = {
                        ...entity,
                        combat: { ...entity.combat, targetId: targetId }
                    };
                }
                else if (entity.airUnit.state !== 'docked' && entity.airUnit.ammo > 0 && target && target.owner !== entity.owner) {
                    // Redirect flying/returning/attacking harriers
                    nextEntities[id] = {
                        ...entity,
                        airUnit: { ...entity.airUnit, state: 'flying' }, // Reset to flying to approach new target
                        combat: { ...entity.combat, targetId: targetId }
                    };
                }
            } else if (isDemoTruck(entity)) {
                // Special handling for demo trucks - set detonation target
                if (target && target.owner !== entity.owner) {
                    nextEntities[id] = setDetonationTarget(entity, targetId, null);
                }
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
                } else if (target && target.owner === entity.owner && target.key === 'service_depot') {
                    // Right click friendly service depot - go dock instead of attack
                    const unitData = getRuleData(entity.key);
                    const isVehicle = unitData && isUnitData(unitData) && unitData.type === 'vehicle';
                    if (isVehicle && ('combat' in entity)) {
                        nextEntities[id] = {
                            ...entity,
                            movement: { ...entity.movement, moveTarget: target.pos, path: null, repairTargetId: target.id },
                            combat: { ...entity.combat, targetId: null }
                        } as any;
                    }
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

    let nextEntity = entity;

    // Clear repairTargetId if safely away from depot
    if (nextEntity.movement.repairTargetId) {
        const depot = allEntities[nextEntity.movement.repairTargetId];
        if (!depot || depot.dead) {
            nextEntity = {
                ...nextEntity,
                movement: { ...nextEntity.movement, repairTargetId: null }
            } as UnitEntity;
        } else {
            const dist = nextEntity.pos.dist(depot.pos);
            const safeDist = depot.radius + nextEntity.radius - 2;
            const isCommandedAway = nextEntity.movement.moveTarget && nextEntity.movement.moveTarget.dist(depot.pos) > 10;
            if (isCommandedAway && dist > safeDist) {
                nextEntity = {
                    ...nextEntity,
                    movement: { ...nextEntity.movement, repairTargetId: null }
                } as UnitEntity;
            }
        }
    }

    const data = getRuleData(nextEntity.key);

    // Handle harvester units
    if (nextEntity.key === 'harvester') {
        const result = updateHarvesterBehavior(
            nextEntity as HarvesterUnit,
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
            // Ensure target is a proper Vector (may be plain object from JSON save)
            const rawTarget = result.entity.movement.moveTarget!;
            const target = rawTarget instanceof Vector
                ? rawTarget
                : new Vector((rawTarget as { x: number; y: number }).x, (rawTarget as { x: number; y: number }).y);
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

    // Handle demo truck units
    if (isDemoTruck(nextEntity)) {
        const result = updateDemoTruckBehavior(nextEntity, allEntities);

        // If demo truck has a detonation target, move toward it
        if (result.entity.demoTruck.detonationTargetId || result.entity.demoTruck.detonationTargetPos) {
            // Movement is handled by the standard movement system
            // Just move toward the target position
            let targetPos: Vector | null = null;
            if (result.entity.demoTruck.detonationTargetId) {
                const target = allEntities[result.entity.demoTruck.detonationTargetId];
                if (target && !target.dead) {
                    targetPos = target.pos;
                }
            } else if (result.entity.demoTruck.detonationTargetPos) {
                targetPos = result.entity.demoTruck.detonationTargetPos;
            }

            if (targetPos && !result.shouldDetonate) {
                const movedTruck = moveToward(result.entity, targetPos, entityList) as DemoTruckUnit;
                return { entity: movedTruck, projectile: null, creditsEarned: 0, resourceDamage: null };
            }
        }

        // Handle standard move target (right-click to move without attack)
        if (result.entity.movement.moveTarget && !result.shouldDetonate) {
            const movedTruck = moveToward(result.entity, result.entity.movement.moveTarget, entityList) as DemoTruckUnit;
            return { entity: movedTruck, projectile: null, creditsEarned: 0, resourceDamage: null };
        }

        return { entity: result.entity, projectile: null, creditsEarned: 0, resourceDamage: null };
    }

    // Handle combat units (non-harvester, non-air, non-demo-truck)
    if (data && isUnitData(data)) {
        const result = updateCombatUnitBehavior(
            nextEntity as CombatUnit,
            allEntities,
            entityList
        );
        return { entity: result.entity, projectile: result.projectile, creditsEarned: 0, resourceDamage: null };
    }

    // Fallback for unknown unit types
    return { entity: nextEntity, projectile: null, creditsEarned: 0, resourceDamage: null };
}

/**
 * Command units to attack-move to a location.
 * Units will move toward the destination, engaging enemies encountered along the way.
 * Unlike aggressive stance, attack-move has limited pursuit distance before resuming toward destination.
 */
export function commandAttackMove(state: GameState, payload: { unitIds: EntityId[]; x: number; y: number }): GameState {
    const { unitIds, x, y } = payload;
    const target = new Vector(x, y);

    // Filter to valid movable combat units (exclude harvesters, MCVs, and air units)
    const movableUnits: UnitEntity[] = [];
    for (const id of unitIds) {
        const entity = state.entities[id];
        if (entity && entity.owner !== -1 && entity.type === 'UNIT' &&
            entity.key !== 'harvester' && entity.key !== 'mcv' && !isAirUnit(entity)) {
            movableUnits.push(entity);
        }
    }

    if (movableUnits.length === 0) {
        return { ...state, attackMoveMode: false };
    }

    // Calculate formation positions based on average unit radius
    const avgRadius = movableUnits.reduce((sum, u) => sum + u.radius, 0) / movableUnits.length;
    const formationPositions = calculateFormationPositions(target, movableUnits.length, avgRadius);

    // Sort units by ID for stable position assignment
    const sortedUnits = [...movableUnits].sort((a, b) =>
        a.id.localeCompare(b.id)
    );

    // STABLE ASSIGNMENT: Map sorted units to formation positions by index
    const assignedPositions = new Map<EntityId, Vector>();
    for (let i = 0; i < sortedUnits.length; i++) {
        if (i < formationPositions.length) {
            assignedPositions.set(sortedUnits[i].id, formationPositions[i]);
        } else {
            assignedPositions.set(sortedUnits[i].id, target);
        }
    }

    let nextEntities = { ...state.entities };
    for (const unit of movableUnits) {
        const formationTarget = assignedPositions.get(unit.id) || target;

        nextEntities[unit.id] = {
            ...unit,
            movement: { ...unit.movement, moveTarget: formationTarget, path: null },
            combat: {
                ...unit.combat,
                targetId: null,  // Will auto-acquire targets during move
                attackMoveTarget: formationTarget,  // Remember this is an attack-move
                stanceHomePos: null  // Will be set when target is acquired
            }
        };
    }

    return { ...state, entities: nextEntities, attackMoveMode: false };
}

/**
 * Set the attack stance for selected units.
 * - aggressive: auto-acquire and pursue indefinitely (default behavior)
 * - defensive: auto-acquire but return home after kill or if target goes too far
 * - hold_ground: never move, only fire at targets in weapon range
 */
export function setStance(state: GameState, payload: { unitIds: EntityId[]; stance: AttackStance }): GameState {
    const { unitIds, stance } = payload;

    let nextEntities = { ...state.entities };

    for (const id of unitIds) {
        const entity = nextEntities[id];
        if (entity && entity.type === 'UNIT' && entity.combat) {
            // Only apply stance to combat units (exclude harvesters and MCVs)
            if (entity.key !== 'harvester' && entity.key !== 'mcv') {
                nextEntities[id] = {
                    ...entity,
                    combat: {
                        ...entity.combat,
                        stance,
                        // Clear stanceHomePos when stance changes - will be set fresh when needed
                        stanceHomePos: null
                    }
                };
            }
        }
    }

    return { ...state, entities: nextEntities };
}

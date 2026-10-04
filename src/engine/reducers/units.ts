import {
    type GameState, type EntityId, type Entity, Vector, type UnitEntity, type HarvesterUnit, type CombatUnit, type DemoTruckUnit, type Projectile, type BuildingEntity, type AttackStance, TILE_SIZE
} from '../types';
import { isUnitData } from '../../data/schemas/index';
import { getRuleData, createProjectile, createEntity } from './helpers';
import { isAirUnit } from '../entity-helpers';
import { isDemoTruck } from '../type-guards';
import { isEnemy } from '../teams';
import { getTransportCapacity, getTransportPassengers, isGarrisonableTransport, isInfantryUnit, isTransportedUnit } from '../transport';
import { updateHarvesterBehavior } from './harvester';
import { updateCombatUnitBehavior } from './combat';
import { updateDemoTruckBehavior, setDetonationTarget } from './demo_truck';
import { moveToward, trackMoveProgress, isMoveHopeless } from './movement';
import { getSpatialGrid } from '../spatial';
import type { UnitTickContext } from '../perf';

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
        if (entity && entity.owner !== -1 && entity.type === 'UNIT' && !isAirUnit(entity) && !isTransportedUnit(entity)) {
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

    const nextEntities = { ...state.entities };
    for (const unit of movableUnits) {
        const formationTarget = assignedPositions.get(unit.id) || target;

        if (unit.key === 'harvester') {
            // Harvester: clear harvesting targets and enable manual mode
            nextEntities[unit.id] = {
                ...unit,
                movement: { ...unit.movement, moveTarget: formationTarget, finalDest: null, path: null, lastDistToMoveTarget: undefined, bestDistToMoveTarget: undefined, moveTargetNoProgressTicks: undefined },
                combat: { ...unit.combat, targetId: null },
                harvester: { ...unit.harvester, resourceTargetId: null, baseTargetId: null, manualMode: true }
            };
        } else if (isDemoTruck(unit)) {
            // A move order disarms the truck; otherwise it turns straight back to its old target
            nextEntities[unit.id] = {
                ...unit,
                movement: { ...unit.movement, moveTarget: formationTarget, finalDest: null, path: null, lastDistToMoveTarget: undefined, bestDistToMoveTarget: undefined, moveTargetNoProgressTicks: undefined },
                combat: { ...unit.combat, targetId: null },
                demoTruck: { ...unit.demoTruck, detonationTargetId: null, detonationTargetPos: null }
            };
        } else {
            // Combat unit
            nextEntities[unit.id] = {
                ...unit,
                movement: { ...unit.movement, moveTarget: formationTarget, finalDest: null, path: null, lastDistToMoveTarget: undefined, bestDistToMoveTarget: undefined, moveTargetNoProgressTicks: undefined },
                combat: { ...unit.combat, targetId: null }
            };
        }
    }
    return { ...state, entities: nextEntities };
}

function calculateUngarrisonPositions(transport: UnitEntity, unitCount: number): Vector[] {
    if (unitCount <= 0) return [];

    const positions: Vector[] = [];
    const baseAngle = (transport.id.split('').reduce((sum, c) => sum + c.charCodeAt(0), 0) % 360) * (Math.PI / 180);
    const radius = transport.radius + 20;
    for (let i = 0; i < unitCount; i++) {
        const angle = baseAngle + (Math.PI * 2 * i) / unitCount;
        positions.push(new Vector(
            transport.pos.x + Math.cos(angle) * radius,
            transport.pos.y + Math.sin(angle) * radius
        ));
    }
    return positions;
}

/**
 * Stop: ground units drop their move and attack orders and stand where they are.
 * Harvesters stay idle (manual mode) until given a new order; armed demo trucks are disarmed.
 */
export function commandStop(state: GameState, payload: { unitIds: EntityId[] }): GameState {
    let nextEntities: Record<EntityId, Entity> | null = null;
    for (const id of payload.unitIds) {
        const unit = state.entities[id];
        if (!unit || unit.dead || unit.type !== 'UNIT' || isAirUnit(unit) || isTransportedUnit(unit)) continue;
        const movement = {
            ...unit.movement,
            moveTarget: null,
            finalDest: null,
            path: null,
            pathIdx: 0,
            vel: new Vector(0, 0),
            stuckTimer: 0,
            unstuckTimer: 0,
            unstuckDir: null,
            lastDistToMoveTarget: undefined,
            bestDistToMoveTarget: undefined,
            moveTargetNoProgressTicks: undefined,
            repairTargetId: null,
            deployWellId: null
        };
        let stopped: UnitEntity;
        if (unit.key === 'harvester') {
            const harv = unit as HarvesterUnit;
            stopped = {
                ...harv,
                movement,
                combat: { ...harv.combat, targetId: null },
                harvester: { ...harv.harvester, resourceTargetId: null, baseTargetId: null, manualMode: true }
            };
        } else if (isDemoTruck(unit)) {
            stopped = {
                ...unit,
                movement,
                combat: { ...unit.combat, targetId: null },
                demoTruck: { ...unit.demoTruck, detonationTargetId: null, detonationTargetPos: null }
            };
        } else if ('combat' in unit && unit.combat) {
            stopped = {
                ...unit,
                movement,
                combat: { ...unit.combat, targetId: null, attackMoveTarget: null, stanceHomePos: null }
            } as UnitEntity;
        } else {
            stopped = { ...unit, movement } as UnitEntity;
        }
        nextEntities ??= { ...state.entities };
        nextEntities[id] = stopped;
    }
    return nextEntities ? { ...state, entities: nextEntities } : state;
}

export function commandUngarrison(state: GameState, payload: { unitIds: EntityId[] }): GameState {
    const { unitIds } = payload;
    const nextEntities = { ...state.entities };
    let changed = false;

    for (const id of unitIds) {
        const entity = nextEntities[id];
        if (!entity || entity.type !== 'UNIT' || !isGarrisonableTransport(entity) || entity.dead) continue;

        const passengers = getTransportPassengers(nextEntities, entity.id).sort((a, b) => a.id.localeCompare(b.id));
        if (passengers.length === 0) continue;

        const unloadPositions = calculateUngarrisonPositions(entity, passengers.length);
        for (let i = 0; i < passengers.length; i++) {
            const passenger = nextEntities[passengers[i].id] as UnitEntity | undefined;
            if (!passenger || passenger.dead || passenger.movement.transportId !== entity.id) continue;

            const targetPos = unloadPositions[i] || entity.pos;
            const clampedPos = new Vector(
                Math.max(passenger.radius, Math.min(state.config.width - passenger.radius, targetPos.x)),
                Math.max(passenger.radius, Math.min(state.config.height - passenger.radius, targetPos.y))
            );

            nextEntities[passenger.id] = {
                ...passenger,
                pos: clampedPos,
                prevPos: clampedPos,
                movement: {
                    ...passenger.movement,
                    transportId: null,
                    vel: new Vector(0, 0),
                    moveTarget: null,
                    path: null,
                    pathIdx: 0,
                    finalDest: null,
                    stuckTimer: 0,
                    unstuckDir: null,
                    unstuckTimer: 0,
                    avgVel: undefined
                },
                combat: {
                    ...passenger.combat,
                    targetId: null,
                    attackMoveTarget: null,
                    stanceHomePos: null
                }
            };
            changed = true;
        }
    }

    if (!changed) return state;
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

/**
 * The area `target` blocks: its footprint, plus for buildings the collision-grid tiles marked
 * for it (see `markGrid`), which can stick out past the footprint.
 */
function getBlockedRect(target: Entity): { left: number; right: number; top: number; bottom: number } {
    const left = target.pos.x - target.w / 2;
    const top = target.pos.y - target.h / 2;
    const rect = { left, right: left + target.w, top, bottom: top + target.h };
    if (target.type !== 'BUILDING') return rect;
    const gx = Math.floor(left / TILE_SIZE);
    const gy = Math.floor(top / TILE_SIZE);
    return {
        left: Math.min(rect.left, gx * TILE_SIZE),
        right: Math.max(rect.right, (gx + Math.ceil(target.w / TILE_SIZE)) * TILE_SIZE),
        top: Math.min(rect.top, gy * TILE_SIZE),
        bottom: Math.max(rect.bottom, (gy + Math.ceil(target.h / TILE_SIZE)) * TILE_SIZE)
    };
}

/**
 * `point` moved to just outside `target`'s blocked area (grown by `margin`) via the nearest edge;
 * returned unchanged (same object) when it is already outside. A point at the exact centre leaves
 * towards `fallbackFrom` (e.g. where the units are coming from).
 */
function pushOutsideFootprint(point: Vector, target: Entity, margin: number, fallbackFrom?: Vector): Vector {
    const rect = getBlockedRect(target);
    const left = rect.left - margin;
    const right = rect.right + margin;
    const top = rect.top - margin;
    const bottom = rect.bottom + margin;
    if (point.x <= left || point.x >= right || point.y <= top || point.y >= bottom) return point;

    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    let dx = point.x - cx;
    let dy = point.y - cy;
    if (dx === 0 && dy === 0 && fallbackFrom) {
        dx = fallbackFrom.x - cx;
        dy = fallbackFrom.y - cy;
    }
    // Leave through the edge the point is relatively closest to
    if (Math.abs(dx) / (right - cx) >= Math.abs(dy) / (bottom - cy)) {
        return new Vector(dx >= 0 ? right : left, point.y);
    }
    return new Vector(point.x, dy >= 0 ? bottom : top);
}

/** Whether `p` sits on a vertical (left/right) edge of `target`'s blocked area grown by `margin`. */
function isOnVerticalEdge(p: Vector, target: Entity, margin: number): boolean {
    const rect = getBlockedRect(target);
    return p.x <= rect.left - margin + 0.01 || p.x >= rect.right + margin - 0.01;
}

/**
 * Right-click on an entity. `x`/`y` is the clicked point: units with nothing to do with the target
 * (neutral rock, own building, ally...) move there in formation instead.
 */
export function commandAttack(state: GameState, payload: { unitIds: EntityId[]; targetId: EntityId; x?: number; y?: number }): GameState {
    const { unitIds, targetId } = payload;
    const target = state.entities[targetId];

    if (!target || (target.type === 'UNIT' && isTransportedUnit(target))) {
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
            entity.key !== 'harvester' && !isAirUnit(entity) && !isTransportedUnit(entity) &&
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

    const nextEntities = { ...state.entities };
    const fallbackMoveIds: EntityId[] = [];
    for (const id of expandedUnitIds) {
        const entity = nextEntities[id];
        if (entity && entity.owner !== -1 && entity.type === 'UNIT' && !isTransportedUnit(entity)) {
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
                    fallbackMoveIds.push(id);
                }
            } else if (isAirUnit(entity)) {
                // Special handling for air units (harriers)
                // Only launch if docked and has ammo, and target is enemy
                if (entity.airUnit.state === 'docked' && entity.airUnit.ammo > 0 && target && target.owner !== -1 && isEnemy(state, target.owner, entity.owner)) {
                    // Start launch sequence: just set targetId.
                    // The AirBase update loop will detect this target and launch the harrier in a staggered way.
                    nextEntities[id] = {
                        ...entity,
                        combat: { ...entity.combat, targetId: targetId }
                    };
                }
                else if (entity.airUnit.state !== 'docked' && entity.airUnit.ammo > 0 && target && target.owner !== -1 && isEnemy(state, target.owner, entity.owner)) {
                    // Redirect flying/returning/attacking harriers
                    nextEntities[id] = {
                        ...entity,
                        airUnit: { ...entity.airUnit, state: 'flying' }, // Reset to flying to approach new target
                        combat: { ...entity.combat, targetId: targetId }
                    };
                }
            } else if (isDemoTruck(entity)) {
                // Special handling for demo trucks - set detonation target
                if (!(target && target.owner !== -1 && isEnemy(state, target.owner, entity.owner))) {
                    fallbackMoveIds.push(id);
                } else {
                    nextEntities[id] = setDetonationTarget(entity, targetId, null);
                }
            } else {
                if (target && target.owner === entity.owner && isGarrisonableTransport(target) && isInfantryUnit(entity)) {
                    const capacity = getTransportCapacity(target);
                    const passengerCount = getTransportPassengers(nextEntities, target.id).length;
                    if (capacity > 0 && passengerCount < capacity) {
                        nextEntities[id] = {
                            ...entity,
                            movement: {
                                ...entity.movement,
                                moveTarget: null,
                                path: null,
                                pathIdx: 0,
                                finalDest: null,
                                repairTargetId: null
                            },
                            combat: {
                                ...entity.combat,
                                targetId: targetId,
                                attackMoveTarget: null,
                                stanceHomePos: null
                            }
                        };
                    } else {
                        nextEntities[id] = {
                            ...entity,
                            combat: { ...entity.combat, targetId: null }
                        };
                    }
                    continue;
                }

                const unitData = getRuleData(entity.key);
                const isEngineer = unitData && isUnitData(unitData) && unitData.canRepairFriendlyBuildings === true;

                // Normal combat unit attack behavior - only target enemies
                if (target && target.owner === entity.owner && target.type === 'BUILDING' && target.hp < target.maxHp && isEngineer) {
                    // Engineers can be ordered to enter damaged friendly buildings.
                    nextEntities[id] = {
                        ...entity,
                        movement: { ...entity.movement, moveTarget: target.pos, path: null },
                        combat: { ...entity.combat, targetId: targetId }
                    };
                } else if (target && target.owner !== -1 && isEnemy(state, target.owner, entity.owner)) {
                    // Use spread position if assigned, otherwise approach directly
                    const spreadPos = assignedSpread.get(id);
                    nextEntities[id] = {
                        ...entity,
                        movement: { ...entity.movement, moveTarget: spreadPos || null, path: null },
                        // An order, not an auto-pick: never swapped for a higher-priority target
                        combat: { ...entity.combat, targetId: targetId, autoTargetId: null }
                    };
                } else if (target && target.owner === entity.owner && target.key === 'service_depot') {
                    // Right click friendly service depot - go dock instead of attack
                    const isVehicle = unitData && isUnitData(unitData) && unitData.type === 'vehicle';
                    if (isVehicle && ('combat' in entity)) {
                        nextEntities[id] = {
                            ...entity,
                            movement: { ...entity.movement, moveTarget: target.pos, path: null, repairTargetId: target.id },
                            combat: { ...entity.combat, targetId: null }
                        };
                    }
                } else if (target) {
                    // Neutral (ore, rocks, wells), allied, or own target with no special interaction:
                    // a right-click there means "go there", never "shoot it" or "do nothing"
                    fallbackMoveIds.push(id);
                }
            }
        }
    }
    const nextState = { ...state, entities: nextEntities };
    if (fallbackMoveIds.length === 0) return nextState;

    // The clicked point is usually on the target itself (a building, a rock): gather just outside it
    // instead, or units would chase spots inside an impassable footprint forever
    const clickPoint = new Vector(payload.x ?? target.pos.x, payload.y ?? target.pos.y);
    const pushed = pushOutsideFootprint(clickPoint, target, 25, state.entities[fallbackMoveIds[0]]?.pos);
    // A building at the map edge can push the anchor off the map: keep it on, on the other side if need be
    const { width: mapW, height: mapH } = state.config;
    let anchor = pushed;
    if (pushed.x < 20 || pushed.x > mapW - 20 || pushed.y < 20 || pushed.y > mapH - 20) {
        const mirrored = pushOutsideFootprint(new Vector(2 * target.pos.x - clickPoint.x, 2 * target.pos.y - clickPoint.y), target, 25);
        anchor = new Vector(Math.max(20, Math.min(mapW - 20, mirrored.x)), Math.max(20, Math.min(mapH - 20, mirrored.y)));
    }
    const moved = commandMove(nextState, { unitIds: fallbackMoveIds, x: anchor.x, y: anchor.y });

    // Formation slots spread around the anchor can still fall on the footprint: push those out too
    // (pushed slots slide along the edge until they are clear of every other unit's slot)
    const movedEntities = { ...moved.entities };
    const takenSlots: { pos: Vector; radius: number }[] = [];
    const pushedIds: EntityId[] = [];
    for (const id of fallbackMoveIds) {
        const unit = movedEntities[id];
        if (!unit || unit.type !== 'UNIT' || !unit.movement.moveTarget) continue;
        const slot = unit.movement.moveTarget;
        if (pushOutsideFootprint(slot, target, unit.radius + 5, unit.pos) === slot) {
            takenSlots.push({ pos: slot, radius: unit.radius });
        } else {
            pushedIds.push(id);
        }
    }
    for (const id of pushedIds) {
        const unit = movedEntities[id];
        if (!unit || unit.type !== 'UNIT' || !unit.movement.moveTarget) continue;
        const edgeSlot = pushOutsideFootprint(unit.movement.moveTarget, target, unit.radius + 5, unit.pos);
        // Tangent of the edge the slot sits on
        const onVerticalEdge = isOnVerticalEdge(edgeSlot, target, unit.radius + 5);
        const step = unit.radius * 2 + 4;
        let slot = edgeSlot;
        for (let i = 1; i <= 24 && takenSlots.some(t => t.pos.dist(slot) < t.radius + unit.radius + 2); i++) {
            const offset = Math.ceil(i / 2) * step * (i % 2 === 1 ? 1 : -1);
            slot = onVerticalEdge
                ? new Vector(edgeSlot.x, edgeSlot.y + offset)
                : new Vector(edgeSlot.x + offset, edgeSlot.y);
        }
        takenSlots.push({ pos: slot, radius: unit.radius });
        movedEntities[id] = { ...unit, movement: { ...unit.movement, moveTarget: slot } } as typeof unit;
    }
    return { ...moved, entities: movedEntities };
}

/** Deploy feedback is for the commanding human only: AI deploys stay silent. */
function notifyOwner(state: GameState, owner: number, notification: NonNullable<GameState['notification']>): GameState['notification'] {
    return state.players[owner]?.isAi ? state.notification : notification;
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
            notification: notifyOwner(state, mcv.owner, { text: 'Cannot deploy: Out of bounds', type: 'error', tick: state.tick })
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
                notification: notifyOwner(state, mcv.owner, { text: "Cannot deploy: Blocked", type: 'error', tick: state.tick })
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
        notification: notifyOwner(state, mcv.owner, { text: "Base Established", type: 'info', tick: state.tick })
    };
}

/** Distance from a well at which an Induction Rig can deploy on it. */
export const RIG_DEPLOY_RANGE = 80;

/**
 * Deploy an Induction Rig on a well, or drive it there first and deploy on arrival.
 * The pending deploy lives on the rig (movement.deployWellId) so it survives saves/reloads.
 */
export function commandDeployRig(state: GameState, payload: { unitId: EntityId; wellId: EntityId }): GameState {
    const { unitId, wellId } = payload;
    const rig = state.entities[unitId];
    const well = state.entities[wellId];
    if (!rig || rig.type !== 'UNIT' || rig.key !== 'induction_rig' || rig.dead || !well || well.dead) {
        return state;
    }
    if (rig.pos.dist(well.pos) <= RIG_DEPLOY_RANGE) {
        return deployInductionRig(state, payload);
    }
    const moved = commandMove(state, { unitIds: [unitId], x: well.pos.x, y: well.pos.y });
    const movedRig = moved.entities[unitId];
    if (!movedRig || movedRig.type !== 'UNIT') return moved;
    return {
        ...moved,
        entities: {
            ...moved.entities,
            [unitId]: { ...movedRig, movement: { ...movedRig.movement, deployWellId: wellId } } as UnitEntity
        }
    };
}

/**
 * Deploy rigs whose pending well is now in range. A rig that was given another order
 * (its destination is no longer the well) or lost its well forgets the deploy.
 */
export function deployArrivedRigs(state: GameState): GameState {
    let next = state;
    for (const id in state.entities) {
        const rig = state.entities[id];
        if (rig.type !== 'UNIT' || rig.key !== 'induction_rig' || !rig.movement.deployWellId) continue;
        const wellId = rig.movement.deployWellId;
        const well = next.entities[wellId];
        if (!rig.dead && well && !well.dead && rig.pos.dist(well.pos) <= RIG_DEPLOY_RANGE) {
            next = deployInductionRig(next, { unitId: id, wellId });
            if (next.entities[id]) {
                // Deploy refused (e.g. the well was taken) - forget it
                next = clearDeployWell(next, id);
            }
            continue;
        }
        const target = rig.movement.moveTarget ? (rig.movement.finalDest ?? rig.movement.moveTarget) : null;
        if (rig.dead || !well || well.dead || !target ||
            Math.hypot(target.x - well.pos.x, target.y - well.pos.y) > RIG_DEPLOY_RANGE) {
            next = clearDeployWell(next, id);
        }
    }
    return next;
}

function clearDeployWell(state: GameState, id: EntityId): GameState {
    const rig = state.entities[id];
    if (!rig || rig.type !== 'UNIT') return state;
    return {
        ...state,
        entities: { ...state.entities, [id]: { ...rig, movement: { ...rig.movement, deployWellId: null } } as UnitEntity }
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
            notification: notifyOwner(state, rig.owner, { text: 'Cannot deploy: Invalid well', type: 'error', tick: state.tick })
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
            notification: notifyOwner(state, rig.owner, { text: 'Cannot deploy: Well already has a rig', type: 'error', tick: state.tick })
        };
    }

    // Check distance to well (must be close enough to deploy)
    if (rig.pos.dist(well.pos) > RIG_DEPLOY_RANGE) {
        return {
            ...state,
            notification: notifyOwner(state, rig.owner, { text: 'Cannot deploy: Move closer to well', type: 'error', tick: state.tick })
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
        notification: notifyOwner(state, rig.owner, { text: "Induction Rig Deployed", type: 'info', tick: state.tick })
    };
}

export function updateUnit(
    entity: UnitEntity,
    allEntities: Record<EntityId, Entity>,
    entityList: Entity[],
    mapConfig: { width: number, height: number },
    currentTick: number,
    harvesterCounts?: Record<EntityId, number>,
    state?: GameState,
    tickContext?: UnitTickContext
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
        // Human players' move orders are carried out in full; the AI's flee orders time out
        const isPlayerOrder = state?.players[nextEntity.owner]?.isAi === false;
        const result = updateHarvesterBehavior(
            nextEntity as HarvesterUnit,
            allEntities,
            entityList,
            mapConfig,
            currentTick,
            harvesterCounts,
            isPlayerOrder,
            tickContext?.refineryOwners
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
            const isStuckOnFlee = !isPlayerOrder && (nextEntity.movement.stuckTimer || 0) > harvesterFleeTimeout;
            // AI flee orders time out after a fixed time; player orders when no closer for a while
            let moveTargetTicks: number;
            let isFleeTimedOut: boolean;
            if (isPlayerOrder) {
                // Like other ground units: only give up when close to the spot and getting no closer
                // (detours on the way there are fine; pathfinding gives up on unreachable far spots)
                nextEntity = trackMoveProgress(nextEntity);
                moveTargetTicks = nextEntity.movement.moveTargetNoProgressTicks || 0;
                isFleeTimedOut = isMoveHopeless(nextEntity);
            } else {
                moveTargetTicks = (result.entity.movement.moveTargetNoProgressTicks || 0) + 1;
                isFleeTimedOut = moveTargetTicks > 90;
            }

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
            let movedTruck = trackMoveProgress(moveToward(result.entity, result.entity.movement.moveTarget, entityList) as DemoTruckUnit);
            // Arrived (or stuck just short of a blocked spot): stop, like other ground units
            const arrived = movedTruck.pos.dist(result.entity.movement.moveTarget) < 10;
            if (arrived || isMoveHopeless(movedTruck)) {
                movedTruck = {
                    ...movedTruck,
                    movement: {
                        ...movedTruck.movement,
                        moveTarget: null,
                        finalDest: null,
                        path: null,
                        pathIdx: 0,
                        lastDistToMoveTarget: undefined,
                        bestDistToMoveTarget: undefined,
                        moveTargetNoProgressTicks: undefined
                    }
                };
            }
            return { entity: movedTruck, projectile: null, creditsEarned: 0, resourceDamage: null };
        }

        return { entity: result.entity, projectile: null, creditsEarned: 0, resourceDamage: null };
    }

    // Handle combat units (non-harvester, non-air, non-demo-truck)
    if (data && isUnitData(data)) {
        const result = updateCombatUnitBehavior(
            nextEntity as CombatUnit,
            allEntities,
            entityList,
            state,
            tickContext?.stuckMoversByOwner
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
            entity.key !== 'harvester' && entity.key !== 'mcv' && !isAirUnit(entity) && !isTransportedUnit(entity)) {
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

    const nextEntities = { ...state.entities };
    for (const unit of movableUnits) {
        const formationTarget = assignedPositions.get(unit.id) || target;

        nextEntities[unit.id] = {
            ...unit,
            movement: { ...unit.movement, moveTarget: formationTarget, finalDest: null, path: null, lastDistToMoveTarget: undefined, bestDistToMoveTarget: undefined, moveTargetNoProgressTicks: undefined },
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

    const nextEntities = { ...state.entities };

    for (const id of unitIds) {
        const entity = nextEntities[id];
        if (entity && entity.type === 'UNIT' && entity.combat && !isTransportedUnit(entity)) {
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

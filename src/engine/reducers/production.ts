import { type GameState, type PlayerState, type Entity, type EntityId, Vector, type BuildingEntity, type AirUnit } from '../types';
import { RULES } from '../../data/schemas/index';
import { canBuild, calculatePower, getRuleData, createEntity, getBuildTicks } from './helpers';
import { getDifficultyModifiers } from '../ai/utils';
import { type EntityCache } from '../perf';
import { isAirBase } from '../entity-helpers';
import { DebugEvents } from '../debug/events';

export function updateProduction(player: PlayerState, _entities: Record<EntityId, Entity>, state: GameState, cache: EntityCache): { player: PlayerState, createdEntities: Entity[], modifiedEntities: Record<EntityId, Entity> } {
    let nextPlayer = { ...player, queues: { ...player.queues } };
    const createdEntities: Entity[] = [];
    const modifiedEntities: Record<EntityId, Entity> = {};

    // Check if player is eliminated (no buildings AND no MCV)
    // This matches the win condition check in tick()
    // Eliminated players cannot produce anything
    const playerBuildings = cache.buildingsByOwner.get(player.id) || [];
    const hasMCV = cache.mcvs.some(e => e.owner === player.id);

    // If player is eliminated (no buildings AND no MCV), cancel all their production queues
    if (playerBuildings.length === 0 && !hasMCV) {
        // Cancel any pending builds silently (no refund since player is eliminated)
        nextPlayer = {
            ...nextPlayer,
            queues: {
                building: { current: null, progress: 0, invested: 0, queued: [] },
                infantry: { current: null, progress: 0, invested: 0, queued: [] },
                vehicle: { current: null, progress: 0, invested: 0, queued: [] },
                air: { current: null, progress: 0, invested: 0, queued: [] }
            },
            readyToPlace: null
        };
        return { player: nextPlayer, createdEntities, modifiedEntities };
    }

    // Calculate power (cached per tick) - pass cache for optimized lookup
    const power = calculatePower(player.id, cache, state.tick);
    const speedFactor = (power.out < power.in) ? 0.25 : 1.0;


    for (const key in nextPlayer.queues) {
        const cat = key as keyof typeof nextPlayer.queues;
        const q = nextPlayer.queues[cat];
        if (!q.current) continue;

        const data = getRuleData(q.current);
        if (!data) continue;

        // Check if player still has the required production building for a category
        // If not, cancel production and refund invested credits
        if (!canBuild(q.current, cat, player.id, cache)) {
            nextPlayer = {
                ...nextPlayer,
                credits: nextPlayer.credits + (q.invested || 0),
                queues: {
                    ...nextPlayer.queues,
                    [cat]: { current: null, progress: 0, invested: 0, queued: [] }
                }
            };
            continue;
        }

        const totalCost = data.cost;

        // Calculate production speed multiplier based on number of production buildings
        // Each additional production building of the relevant type adds 50% speed
        const validBuildings: string[] = RULES.productionBuildings?.[cat] || [];
        const productionBuildingCount = playerBuildings.filter(e =>
            validBuildings.includes(e.key)
        ).length || 1;
        // Speed multiplier: 1.0 for 1 building, 1.5 for 2, 2.0 for 3, etc.
        const speedMult = 1 + (productionBuildingCount - 1) * 0.5;

        // Apply difficulty build speed bonus for AI players
        const difficultySpeedMult = player.isAi ? getDifficultyModifiers(player.difficulty).buildSpeedBonus : 1.0;

        const costPerTick = (totalCost / getBuildTicks(q.current)) * speedMult * speedFactor * difficultySpeedMult;

        // Linear cost deduction: spend only what we can afford
        const affordableCost = Math.min(costPerTick, nextPlayer.credits);

        if (affordableCost > 0) {
            nextPlayer = {
                ...nextPlayer,
                credits: nextPlayer.credits - affordableCost,
                queues: {
                    ...nextPlayer.queues,
                    [cat]: {
                        ...q,
                        progress: q.progress + (affordableCost / totalCost) * 100,
                        invested: (q.invested || 0) + affordableCost
                    }
                }
            };

            if (nextPlayer.queues[cat].progress >= 100) {
                if (cat === 'building') {
                    if (import.meta.env?.DEV) {
                        DebugEvents.emit('production', {
                            tick: state.tick,
                            playerId: player.id,
                            data: {
                                action: 'completed',
                                category: cat,
                                key: q.current,
                                queueLength: 0
                            }
                        });
                    }
                    nextPlayer = {
                        ...nextPlayer,
                        readyToPlace: q.current,
                        queues: {
                            ...nextPlayer.queues,
                            [cat]: { current: null, progress: 0, invested: 0, queued: [] }
                        }
                    };
                } else {
                    // Unit complete. Spawn it.
                    const unitType = RULES.units[q.current]?.type || 'infantry';

                    if (unitType === 'air') {
                        // Air unit production: find Air-Force Command with available slot
                        const airBases = playerBuildings.filter(isAirBase);

                        let foundSlot = false;
                        for (const airBase of airBases) {
                            const slotIndex = airBase.airBase.slots.findIndex((s: EntityId | null) => s === null);
                            if (slotIndex !== -1) {
                                // Create harrier in docked state at this base/slot
                                const unitData = RULES.units[q.current];
                                const maxAmmo = unitData?.ammo || 1;

                                const newHarrier = createEntity(
                                    airBase.pos.x, airBase.pos.y,
                                    player.id, 'UNIT', q.current!, state
                                ) as AirUnit;

                                // Set harrier as docked at this base
                                const dockedHarrier: AirUnit = {
                                    ...newHarrier,
                                    airUnit: {
                                        ...newHarrier.airUnit,
                                        state: 'docked',
                                        homeBaseId: airBase.id,
                                        dockedSlot: slotIndex,
                                        ammo: maxAmmo,
                                        maxAmmo: maxAmmo
                                    },
                                    movement: {
                                        ...newHarrier.movement,
                                        vel: new Vector(0, 0),
                                        moveTarget: null
                                    }
                                };

                                createdEntities.push(dockedHarrier);

                                // Update air base slots to include this harrier
                                const newSlots = [...airBase.airBase.slots];
                                newSlots[slotIndex] = dockedHarrier.id;
                                modifiedEntities[airBase.id] = {
                                    ...airBase,
                                    airBase: {
                                        ...airBase.airBase,
                                        slots: newSlots
                                    }
                                } as BuildingEntity;

                                // Emit production completed event for air unit
                                if (import.meta.env?.DEV) {
                                    DebugEvents.emit('production', {
                                        tick: state.tick,
                                        playerId: player.id,
                                        entityId: dockedHarrier.id,
                                        data: {
                                            action: 'completed',
                                            category: cat,
                                            key: q.current,
                                            queueLength: (nextPlayer.queues[cat].queued || []).length
                                        }
                                    });
                                }

                                foundSlot = true;
                                break;
                            }
                        }

                        if (!foundSlot) {
                            // No slot available - keep at 100% progress, don't complete
                            // Production is effectively paused until a slot opens
                            continue;
                        }

                        // Start next unit in queue if available
                        const currentQueue = nextPlayer.queues[cat];
                        const queuedItems = currentQueue.queued || [];
                        const nextInQueue = queuedItems[0] || null;
                        const remainingQueue = queuedItems.slice(1);

                        nextPlayer = {
                            ...nextPlayer,
                            queues: {
                                ...nextPlayer.queues,
                                [cat]: {
                                    current: nextInQueue,
                                    progress: 0,
                                    invested: 0,
                                    queued: remainingQueue
                                }
                            }
                        };
                    } else {
                        // Ground unit production (infantry/vehicle)
                        const spawnBuildingKey = unitType === 'infantry' ? 'barracks' : 'factory';
                        const primaryCategory = unitType === 'infantry' ? 'infantry' : 'vehicle';

                        let spawnPos = new Vector(100, 100); // Default fallback
                        let rallyPoint: Vector | null = null;
                        let exitFactory: BuildingEntity | null = null;

                        const factories = playerBuildings.filter(e => e.key === spawnBuildingKey);
                        if (factories.length > 0) {
                            // Use primary building if set and still valid, otherwise use first
                            const primaryId = player.primaryBuildings?.[primaryCategory];
                            const primaryFactory = primaryId
                                ? factories.find(f => f.id === primaryId)
                                : null;
                            const factory = (primaryFactory || factories[0]) as BuildingEntity;
                            spawnPos = factory.pos.add(new Vector(0, factory.h / 2 + 20));
                            // Check for rally point
                            if (factory.building.rallyPoint) {
                                rallyPoint = factory.building.rallyPoint;
                            } else {
                                exitFactory = factory;
                            }
                        } else {
                            // Fallback to conyard
                            const conyards = playerBuildings.filter(e => e.key === 'conyard');
                            if (conyards.length > 0) spawnPos = conyards[0].pos.add(new Vector(0, 60));
                        }

                        const newUnit = createEntity(spawnPos.x, spawnPos.y, player.id, 'UNIT', q.current!, state);
                        const offset = new Vector((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
                        let movedUnit = { ...newUnit, pos: newUnit.pos.add(offset) };

                        // Without a rally point, drive out to a free spot in front of the door
                        // so consecutive units don't pile up on the spawn point.
                        // Harvesters head off to ore on their own.
                        if (!rallyPoint && exitFactory && movedUnit.type === 'UNIT' && movedUnit.key !== 'harvester') {
                            rallyPoint = findFreeExitSlot(exitFactory, movedUnit.radius, state, createdEntities);
                        }

                        // Apply rally point if set
                        if (rallyPoint && movedUnit.type === 'UNIT' && 'movement' in movedUnit) {
                            movedUnit = {
                                ...movedUnit,
                                movement: {
                                    ...movedUnit.movement,
                                    moveTarget: rallyPoint,
                                    finalDest: rallyPoint
                                }
                            };
                        }

                        createdEntities.push(movedUnit);

                        // Emit production completed event for ground unit
                        if (import.meta.env?.DEV) {
                            DebugEvents.emit('production', {
                                tick: state.tick,
                                playerId: player.id,
                                entityId: movedUnit.id,
                                data: {
                                    action: 'completed',
                                    category: cat,
                                    key: q.current,
                                    queueLength: (nextPlayer.queues[cat].queued || []).length - 1
                                }
                            });
                        }

                        // Start next unit in queue if available
                        const currentQueue = nextPlayer.queues[cat];
                        const queuedItems = currentQueue.queued || [];
                        const nextInQueue = queuedItems[0] || null;
                        const remainingQueue = queuedItems.slice(1);

                        nextPlayer = {
                            ...nextPlayer,
                            queues: {
                                ...nextPlayer.queues,
                                [cat]: {
                                    current: nextInQueue,
                                    progress: 0,
                                    invested: 0,
                                    queued: remainingQueue
                                }
                            }
                        };
                    }
                }
            }
        }
        // When credits are 0, production simply pauses (no change to queue)
    }
    return { player: nextPlayer, createdEntities, modifiedEntities };
}

export function startBuild(state: GameState, payload: { category: string; key: string; playerId: number }): GameState {
    const { category, key, playerId } = payload;
    const player = state.players[playerId];
    if (!player) return state;

    // For units (infantry/vehicle/air), use the queue system (AI compatibility)
    if (category === 'infantry' || category === 'vehicle' || category === 'air') {
        return queueUnit(state, { category, key, playerId, count: 1 });
    }

    const q = player.queues[category as keyof typeof player.queues];
    if (q.current) return state;
    if (category === 'building' && player.readyToPlace) return state;

    // Validate the key exists in rules (no credit check - costs are deducted linearly during production)
    if (category === 'building') {
        if (!RULES.buildings[key]) return state;
    } else {
        if (!RULES.units[key]) return state;
    }

    // Check prerequisites and production building requirements
    if (!canBuild(key, category, playerId, state.entities)) {
        return state;
    }

    // Emit production started event
    if (import.meta.env?.DEV) {
        DebugEvents.emit('production', {
            tick: state.tick,
            playerId,
            data: {
                action: 'started',
                category,
                key,
                queueLength: 0
            }
        });
    }

    return {
        ...state,
        players: {
            ...state.players,
            [playerId]: {
                ...player,
                queues: {
                    ...player.queues,
                    [category]: { current: key, progress: 0, invested: 0, queued: [] }
                }
            }
        }
    };
}

export function queueUnit(state: GameState, payload: { category: string; key: string; playerId: number; count: number }): GameState {
    const { category, key, playerId, count } = payload;
    const player = state.players[playerId];
    if (!player) return state;

    // Only infantry, vehicle, and air can be queued
    if (category !== 'infantry' && category !== 'vehicle' && category !== 'air') return state;

    // Validate the key exists
    if (!RULES.units[key]) return state;

    // Check prerequisites and production building requirements
    if (!canBuild(key, category, playerId, state.entities)) {
        return state;
    }

    const q = player.queues[category as keyof typeof player.queues];
    const existingQueued = q.queued || [];

    // Special slot limit for air units (harriers)
    // Cannot build more than total available slots across all Air-Force Commands
    if (category === 'air') {
        const playerEntities = Object.values(state.entities).filter(e => e.owner === playerId && !e.dead);
        const airBases = playerEntities.filter(e => e.type === 'BUILDING' && e.key === 'airforce_command' && isAirBase(e));
        const totalSlots = airBases.length * 6;

        // Count existing harriers (valid ones only)
        // We exclude "ghost" harriers that think they are docked but are not in the base's slot array
        const existingHarriers = playerEntities.filter(e => {
            if (e.type !== 'UNIT' || e.key !== 'harrier') return false;

            // Check for ghost docked harriers
            if (e.airUnit?.state === 'docked' && e.airUnit.homeBaseId) {
                const homeBase = state.entities[e.airUnit.homeBaseId];

                // If home base is missing, it's a ghost
                if (!homeBase) return false;

                // If home base claims to be the base but doesn't have the harrier in slots, it's a ghost
                if (homeBase.type === 'BUILDING' && homeBase.airBase && !homeBase.airBase.slots.includes(e.id)) {
                    return false;
                }
            }
            return true;
        }).length;

        // Count harriers in queue (current + queued)
        const harrisersInQueue = (q.current === 'harrier' ? 1 : 0) +
            existingQueued.filter(k => k === 'harrier').length;

        const availableSlots = totalSlots - existingHarriers - harrisersInQueue;
        if (availableSlots <= 0) return state;
    }

    // Calculate how many we can add (max 99 total including current)
    const currentTotal = (q.current ? 1 : 0) + existingQueued.length;
    const addCount = Math.min(count, 99 - currentTotal);
    if (addCount <= 0) return state;

    // Create array of items to add
    const itemsToAdd = Array(addCount).fill(key);

    // If nothing is currently building, start the first one
    if (!q.current) {
        // Emit production started event
        if (import.meta.env?.DEV) {
            DebugEvents.emit('production', {
                tick: state.tick,
                playerId,
                data: {
                    action: 'started',
                    category,
                    key: itemsToAdd[0],
                    queueLength: itemsToAdd.length - 1
                }
            });
        }
        return {
            ...state,
            players: {
                ...state.players,
                [playerId]: {
                    ...player,
                    queues: {
                        ...player.queues,
                        [category]: {
                            current: itemsToAdd[0],
                            progress: 0,
                            invested: 0,
                            queued: itemsToAdd.slice(1)
                        }
                    }
                }
            }
        };
    }

    // Otherwise just add to queue
    return {
        ...state,
        players: {
            ...state.players,
            [playerId]: {
                ...player,
                queues: {
                    ...player.queues,
                    [category]: {
                        ...q,
                        queued: [...existingQueued, ...itemsToAdd]
                    }
                }
            }
        }
    };
}

export function dequeueUnit(state: GameState, payload: { category: string; key: string; playerId: number; count: number }): GameState {
    const { category, key, playerId, count } = payload;
    const player = state.players[playerId];
    if (!player) return state;

    // Only infantry, vehicle, and air can be dequeued
    if (category !== 'infantry' && category !== 'vehicle' && category !== 'air') return state;

    const q = player.queues[category as keyof typeof player.queues];
    const existingQueued = q.queued || [];

    // Nothing to dequeue
    if (!q.current && existingQueued.length === 0) return state;

    let toRemove = count;
    const newQueued = [...existingQueued];

    // Remove from end of queue first (LIFO for same item type)
    for (let i = newQueued.length - 1; i >= 0 && toRemove > 0; i--) {
        if (newQueued[i] === key) {
            newQueued.splice(i, 1);
            toRemove--;
        }
    }

    // If we still need to remove more and current item matches
    if (toRemove > 0 && q.current === key) {
        // Cancel current build - refund invested
        if (newQueued.length === 0) {
            // No more items in queue, clear everything
            return {
                ...state,
                players: {
                    ...state.players,
                    [playerId]: {
                        ...player,
                        credits: player.credits + (q.invested || 0),
                        queues: {
                            ...player.queues,
                            [category]: { current: null, progress: 0, invested: 0, queued: [] }
                        }
                    }
                }
            };
        } else {
            // Start next item in queue, refund current invested
            const nextItem = newQueued.shift()!;
            return {
                ...state,
                players: {
                    ...state.players,
                    [playerId]: {
                        ...player,
                        credits: player.credits + (q.invested || 0),
                        queues: {
                            ...player.queues,
                            [category]: {
                                current: nextItem,
                                progress: 0,
                                invested: 0,
                                queued: newQueued
                            }
                        }
                    }
                }
            };
        }
    }

    // Just update the queue (removed items from queue only)
    return {
        ...state,
        players: {
            ...state.players,
            [playerId]: {
                ...player,
                queues: {
                    ...player.queues,
                    [category]: { ...q, queued: newQueued }
                }
            }
        }
    };
}

export function cancelBuild(state: GameState, payload: { category: string; playerId: number }): GameState {
    const { category, playerId } = payload;
    const player = state.players[playerId];
    if (!player) return state;

    let refund = 0;
    let newQueue = { ...player.queues[category as keyof typeof player.queues] };
    let newReadyToPlace = player.readyToPlace;
    let newPlacingBuilding = state.placingBuilding;

    if (category === 'building' && player.readyToPlace) {
        const data = RULES.buildings[player.readyToPlace];
        if (data) refund = data.cost;
        newReadyToPlace = null;
        // Also clear placement mode if we're canceling the building being placed
        if (state.placingBuilding === player.readyToPlace) {
            newPlacingBuilding = null;
        }
    } else if (newQueue.current) {
        const data = getRuleData(newQueue.current);
        if (data) {
            // Refund the actual invested credits
            refund = newQueue.invested || 0;
        }
        newQueue = { current: null, progress: 0, invested: 0, queued: [] };
    }

    return {
        ...state,
        players: {
            ...state.players,
            [playerId]: {
                ...player,
                credits: player.credits + refund,
                queues: {
                    ...player.queues,
                    [category]: newQueue
                },
                readyToPlace: newReadyToPlace
            }
        },
        placingBuilding: newPlacingBuilding
    };
}

/**
 * Find a free spot in front of a factory's door for a newly produced unit.
 * Slots fill row by row, centre first, skipping anything occupied by a unit
 * (or a unit already heading there), a building or a rock.
 */
function findFreeExitSlot(
    factory: BuildingEntity,
    radius: number,
    state: GameState,
    createdEntities: Entity[]
): Vector | null {
    const spacing = radius * 2 + 6;
    const firstRowY = factory.pos.y + factory.h / 2 + 20 + spacing;
    const doorX = factory.pos.x;
    const { width, height } = state.config;

    const near: Entity[] = [];
    const reach = Math.max(factory.w, factory.h) + spacing * 6;
    const consider = (e: Entity) => {
        if (e.dead || e.type === 'RESOURCE') return;
        const extent = Math.max(e.radius, (e.w || 0) / 2, (e.h || 0) / 2);
        if (Math.abs(e.pos.x - doorX) > reach + extent || Math.abs(e.pos.y - firstRowY) > reach + extent) {
            // Still consider units heading into the area
            if (!(e.type === 'UNIT' && 'movement' in e && e.movement.moveTarget)) return;
        }
        near.push(e);
    };
    for (const id in state.entities) consider(state.entities[id]);
    for (const e of createdEntities) consider(e);

    const isFree = (p: Vector): boolean => {
        if (p.x < radius || p.y < radius || p.x > width - radius || p.y > height - radius) return false;
        for (const e of near) {
            if (e.type === 'BUILDING' || e.type === 'ROCK') {
                const hw = (e.w || e.radius * 2) / 2 + radius;
                const hh = (e.h || e.radius * 2) / 2 + radius;
                if (Math.abs(p.x - e.pos.x) < hw && Math.abs(p.y - e.pos.y) < hh) return false;
                continue;
            }
            const minDist = e.radius + radius;
            if (e.pos.dist(p) < minDist) return false;
            const mt = e.type === 'UNIT' && 'movement' in e ? e.movement.moveTarget : null;
            if (mt && Math.hypot(mt.x - p.x, mt.y - p.y) < minDist) return false;
        }
        return true;
    };

    for (let row = 0; row < 4; row++) {
        for (let col = 0; col < 7; col++) {
            // 0, +1, -1, +2, -2, ...
            const offset = col === 0 ? 0 : (col % 2 === 1 ? 1 : -1) * Math.ceil(col / 2);
            const p = new Vector(doorX + offset * spacing, firstRowY + row * spacing);
            if (isFree(p)) return p;
        }
    }
    // The area in front of the door is taken (e.g. another building): try rings round the factory
    for (let ring = 1; ring <= 4; ring++) {
        const r = Math.max(factory.w, factory.h) / 2 + 20 + ring * spacing;
        const steps = Math.ceil((2 * Math.PI * r) / spacing);
        for (let i = 0; i < steps; i++) {
            // Start below the door and alternate sides
            const k = i === 0 ? 0 : (i % 2 === 1 ? 1 : -1) * Math.ceil(i / 2);
            const angle = Math.PI / 2 + (k * 2 * Math.PI) / steps;
            const p = new Vector(factory.pos.x + Math.cos(angle) * r, factory.pos.y + Math.sin(angle) * r);
            if (isFree(p)) return p;
        }
    }
    return null;
}

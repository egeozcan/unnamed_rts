import { GameState, PlayerState, Entity, EntityId, Vector } from '../types';
import { RULES } from '../../data/schemas/index';
import { canBuild, calculatePower, getRuleData, createEntity } from './helpers';
import { getDifficultyModifiers } from '../ai/utils';
import { type EntityCache } from '../perf';

export function updateProduction(player: PlayerState, _entities: Record<EntityId, Entity>, state: GameState, cache: EntityCache): { player: PlayerState, createdEntities: Entity[] } {
    let nextPlayer = { ...player, queues: { ...player.queues } };
    let createdEntities: Entity[] = [];

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
        return { player: nextPlayer, createdEntities };
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

        const costPerTick = (totalCost / 600) * speedMult * speedFactor * difficultySpeedMult;

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
                    // Find a building that produces this unit (e.g. barracks for infantry)
                    // For simplicity, spawn at first valid building or construction yard if none found?
                    // Ideally we look for specific factories.
                    // RULES.units[q.current] doesn't explicitly say "producedAt".
                    // But we can infer: infantry -> barracks, vehicle -> factory.
                    // Or just spawn near any building of the player for now to fix the bug.
                    // Better: find "barracks" for infantry, "factory" for vehicle.

                    const unitType = RULES.units[q.current]?.type || 'infantry';
                    const spawnBuildingKey = unitType === 'infantry' ? 'barracks' : 'factory';

                    let spawnPos = new Vector(100, 100); // Default fallback

                    const factories = playerBuildings.filter(e => e.key === spawnBuildingKey);
                    if (factories.length > 0) {
                        const factory = factories[0];
                        spawnPos = factory.pos.add(new Vector(0, factory.h / 2 + 20));
                    } else {
                        // Fallback to conyard
                        const conyards = playerBuildings.filter(e => e.key === 'conyard');
                        if (conyards.length > 0) spawnPos = conyards[0].pos.add(new Vector(0, 60));
                    }

                    const newUnit = createEntity(spawnPos.x, spawnPos.y, player.id, 'UNIT', q.current!, state);
                    const offset = new Vector((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
                    const movedUnit = { ...newUnit, pos: newUnit.pos.add(offset) };

                    createdEntities.push(movedUnit);

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
        // When credits are 0, production simply pauses (no change to queue)
    }
    return { player: nextPlayer, createdEntities };
}

export function startBuild(state: GameState, payload: { category: string; key: string; playerId: number }): GameState {
    const { category, key, playerId } = payload;
    const player = state.players[playerId];
    if (!player) return state;

    // For units (infantry/vehicle), use the queue system (AI compatibility)
    if (category === 'infantry' || category === 'vehicle') {
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

    // Only infantry and vehicle can be queued
    if (category !== 'infantry' && category !== 'vehicle') return state;

    // Validate the key exists
    if (!RULES.units[key]) return state;

    // Check prerequisites and production building requirements
    if (!canBuild(key, category, playerId, state.entities)) {
        return state;
    }

    const q = player.queues[category as keyof typeof player.queues];
    const existingQueued = q.queued || [];

    // Calculate how many we can add (max 99 total including current)
    const currentTotal = (q.current ? 1 : 0) + existingQueued.length;
    const addCount = Math.min(count, 99 - currentTotal);
    if (addCount <= 0) return state;

    // Create array of items to add
    const itemsToAdd = Array(addCount).fill(key);

    // If nothing is currently building, start the first one
    if (!q.current) {
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

    // Only infantry and vehicle can be dequeued
    if (category !== 'infantry' && category !== 'vehicle') return state;

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

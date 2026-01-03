import {
    Action, GameState, Entity, EntityId, PlayerState, Vector, TILE_SIZE, PLAYER_COLORS,
    Projectile, Particle,
    UnitEntity, BuildingEntity, HarvesterUnit, CombatUnit, ResourceEntity, WellEntity,
    UnitKey, BuildingKey, MapConfig
} from './types.js';
import { RULES, Building, Unit, isBuildingData, isUnitData } from '../data/schemas/index.js';
import { collisionGrid, refreshCollisionGrid, findPath, getGridW, getGridH, setPathCacheTick } from './utils.js';
import { rebuildSpatialGrid, getSpatialGrid } from './spatial.js';
import { createDefaultMovement, createDefaultCombat, createDefaultHarvester, createDefaultBuildingState } from './entity-helpers.js';

// Power calculation cache - keyed by tick to auto-invalidate
let powerCache: Map<number, { in: number, out: number }> = new Map();
let powerCacheTick = -1;

/**
 * Check if prerequisites are met for a building or unit.
 * Prerequisites are defined on the unit/building data objects.
 */
function checkPrerequisites(key: string, playerBuildings: Entity[]): boolean {
    const unitData = RULES.units[key];
    const buildingData = RULES.buildings[key];
    const prereqs = unitData?.prerequisites || buildingData?.prerequisites || [];
    return prereqs.every((req: string) => playerBuildings.some(b => b.key === req && !b.dead));
}

/**
 * Check if a player has the required production building for a category.
 * Production building requirements are defined in RULES.productionBuildings.
 * Each category can have multiple valid production buildings (for faction support).
 */
function hasProductionBuilding(category: string, playerBuildings: Entity[]): boolean {
    const validBuildings: string[] = RULES.productionBuildings?.[category] || [];
    if (validBuildings.length === 0) return false;
    return playerBuildings.some(b => validBuildings.includes(b.key) && !b.dead);
}

/**
 * Check if a player can build a specific item (has prerequisites and production building).
 */
export function canBuild(key: string, category: string, playerId: number, entities: Record<EntityId, Entity>): boolean {
    const playerBuildings = Object.values(entities).filter(
        e => e.owner === playerId && e.type === 'BUILDING' && !e.dead
    );

    // Check production building requirement
    if (!hasProductionBuilding(category, playerBuildings)) {
        return false;
    }

    // Check prerequisites
    return checkPrerequisites(key, playerBuildings);
}

export const INITIAL_STATE: GameState = {
    running: false,
    mode: 'menu',
    difficulty: 'easy',
    tick: 0,
    camera: { x: 0, y: 0 },
    zoom: 1.0,
    entities: {},
    projectiles: [],
    particles: [],
    selection: [],
    placingBuilding: null,
    sellMode: false,
    repairMode: false,
    players: {
        0: createPlayerState(0, false, 'medium', PLAYER_COLORS[0]),
        1: createPlayerState(1, true, 'medium', PLAYER_COLORS[1])
    },
    winner: null,
    config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
    debugMode: false,
    showMinimap: true,
    notification: null
};

export function createPlayerState(id: number, isAi: boolean, difficulty: 'easy' | 'medium' | 'hard' = 'medium', color: string = PLAYER_COLORS[id] || '#888888'): PlayerState {
    return {
        id,
        isAi,
        difficulty,
        color,
        credits: isAi ? 10000 : 3000,
        maxPower: 0,
        usedPower: 0,
        queues: {
            building: { current: null, progress: 0, invested: 0, queued: [] },
            infantry: { current: null, progress: 0, invested: 0, queued: [] },
            vehicle: { current: null, progress: 0, invested: 0, queued: [] },
            air: { current: null, progress: 0, invested: 0, queued: [] }
        },
        readyToPlace: null
    };
}

export function update(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'TICK':
            return tick(state);
        case 'START_BUILD':
            return startBuild(state, action.payload);
        case 'PLACE_BUILDING':
            return placeBuilding(state, action.payload);
        case 'CANCEL_BUILD':
            return cancelBuild(state, action.payload);
        case 'COMMAND_MOVE':
            return commandMove(state, action.payload);
        case 'COMMAND_ATTACK':
            return commandAttack(state, action.payload);
        case 'SELECT_UNITS':
            return { ...state, selection: action.payload };
        case 'SELL_BUILDING':
            return sellBuilding(state, action.payload);
        case 'TOGGLE_SELL_MODE':
            return { ...state, sellMode: !state.sellMode, repairMode: false };
        case 'TOGGLE_REPAIR_MODE':
            return { ...state, repairMode: !state.repairMode, sellMode: false };
        case 'START_REPAIR':
            return startRepair(state, action.payload);
        case 'STOP_REPAIR':
            return stopRepair(state, action.payload);
        case 'TOGGLE_DEBUG':
            return { ...state, debugMode: !state.debugMode };
        case 'TOGGLE_MINIMAP':
            return { ...state, showMinimap: !state.showMinimap };
        case 'DEPLOY_MCV':
            return deployMCV(state, action.payload);
        case 'QUEUE_UNIT':
            return queueUnit(state, action.payload);
        case 'DEQUEUE_UNIT':
            return dequeueUnit(state, action.payload);
        default:
            return state;
    }
}

export function tick(state: GameState): GameState {
    if (!state.running) return state;

    const nextTick = state.tick + 1;

    // Update path cache tick for proper cache invalidation
    setPathCacheTick(nextTick);

    // Clear notification after 3 seconds (180 ticks)
    let nextNotification = state.notification;
    if (nextNotification && state.tick - nextNotification.tick > 180) {
        nextNotification = null;
    }

    let nextEntities = { ...state.entities };
    let nextPlayers = { ...state.players };

    // Update Production
    for (const pid in nextPlayers) {
        const res = updateProduction(nextPlayers[pid], state.entities, state);
        nextPlayers[pid] = res.player;
        res.createdEntities.forEach(e => {
            nextEntities[e.id] = e;
        });
    }

    // Update Wells - spawn new ore and grow existing ore near wells
    nextEntities = updateWells(nextEntities, nextTick, state.config);

    // Entity Updates
    const updateState = { ...state, players: nextPlayers, entities: nextEntities };
    const { entities: updatedEntities, projectiles: newProjs, creditsEarned } = updateEntities(updateState);

    // Apply Credits
    for (const pidStr in creditsEarned) {
        const pid = parseInt(pidStr);
        if (nextPlayers[pid]) {
            nextPlayers[pid] = {
                ...nextPlayers[pid],
                credits: nextPlayers[pid].credits + creditsEarned[pid]
            };
        }
    }

    // Projectile Updates
    let nextProjectiles: Projectile[] = [];
    let damageEvents: { targetId: EntityId; amount: number; attackerId: EntityId }[] = [];

    [...state.projectiles, ...newProjs].forEach(p => {
        const res = updateProjectile(p, updatedEntities);
        if (!res.proj.dead) {
            nextProjectiles.push(res.proj);
        }
        if (res.damage) {
            damageEvents.push(res.damage);
        }
    });

    // Apply Damage
    for (const d of damageEvents) {
        if (updatedEntities[d.targetId]) {
            const ent = updatedEntities[d.targetId];
            const nextHp = Math.max(0, ent.hp - d.amount);

            // Update combat component for units and buildings with combat
            if (ent.type === 'UNIT') {
                updatedEntities[d.targetId] = {
                    ...ent,
                    hp: nextHp,
                    dead: nextHp <= 0,
                    combat: {
                        ...ent.combat,
                        flash: 5,
                        lastAttackerId: d.attackerId,
                        lastDamageTick: state.tick
                    }
                };
            } else if (ent.type === 'BUILDING' && ent.combat) {
                updatedEntities[d.targetId] = {
                    ...ent,
                    hp: nextHp,
                    dead: nextHp <= 0,
                    combat: {
                        ...ent.combat,
                        flash: 5,
                        lastAttackerId: d.attackerId,
                        lastDamageTick: state.tick
                    }
                };
            } else {
                // Resources, rocks, or buildings without combat
                updatedEntities[d.targetId] = {
                    ...ent,
                    hp: nextHp,
                    dead: nextHp <= 0
                };
            }
        }
    }

    // Process Building Repairs
    const repairCostPercentage = RULES.economy?.repairCostPercentage || 0.3;
    const repairDurationTicks = 600; // Same as build time - 10 seconds at 60fps

    for (const id in updatedEntities) {
        const ent = updatedEntities[id];
        if (ent.type === 'BUILDING' && ent.building.isRepairing && !ent.dead) {
            const buildingData = RULES.buildings[ent.key];
            if (!buildingData) continue;

            const player = nextPlayers[ent.owner];
            if (!player) continue;

            // Calculate repair costs and healing per tick
            const totalRepairCost = buildingData.cost * repairCostPercentage;
            const missingHp = ent.maxHp - ent.hp;
            const hpPerTick = ent.maxHp / repairDurationTicks;
            const costPerTick = totalRepairCost / repairDurationTicks;

            // Check if player can afford this tick's repair
            if (player.credits >= costPerTick) {
                const hpToHeal = Math.min(hpPerTick, missingHp);
                const actualCost = (hpToHeal / ent.maxHp) * totalRepairCost;

                // Deduct credits
                nextPlayers[ent.owner] = {
                    ...nextPlayers[ent.owner],
                    credits: nextPlayers[ent.owner].credits - actualCost
                };

                // Heal building - flash goes to combat component if defense building
                const newHp = Math.min(ent.maxHp, ent.hp + hpToHeal);
                const isFullHp = newHp >= ent.maxHp;

                updatedEntities[id] = {
                    ...ent,
                    hp: newHp,
                    combat: ent.combat ? { ...ent.combat, flash: 3 } : undefined,
                    building: { ...ent.building, isRepairing: !isFullHp }
                };
            } else {
                // No credits - stop repairing
                updatedEntities[id] = {
                    ...ent,
                    building: { ...ent.building, isRepairing: false }
                };
            }
        }
    }

    // Filter dead entities
    let finalEntities: Record<EntityId, Entity> = {};
    const buildingCounts: Record<number, number> = {};
    const mcvCounts: Record<number, number> = {};

    // Initialize counts for active players
    for (const pid in nextPlayers) {
        buildingCounts[pid] = 0;
        mcvCounts[pid] = 0;
    }

    for (const id in updatedEntities) {
        const ent = updatedEntities[id];
        if (!ent.dead) {
            finalEntities[id] = ent;
            if (ent.type === 'BUILDING') {
                buildingCounts[ent.owner] = (buildingCounts[ent.owner] || 0) + 1;
            } else if (ent.type === 'UNIT' && ent.key === 'mcv') {
                mcvCounts[ent.owner] = (mcvCounts[ent.owner] || 0) + 1;
            }
        }
    }

    // Check for win/loss
    // A player is defeated if they have 0 buildings AND 0 MCVs.
    // The game ends if only one player remains with assets.
    // We only check this in game or demo mode to avoid breaking tests.
    let nextWinner = state.winner;
    let nextRunning: boolean = state.running;

    if (nextWinner === null && (state.mode === 'game' || state.mode === 'demo')) {
        const alivePlayers = Object.keys(nextPlayers)
            .map(Number)
            .filter(pid => buildingCounts[pid] > 0 || mcvCounts[pid] > 0);

        // Kill units of any eliminated players immediately
        // (those with 0 buildings AND 0 MCVs)
        const eliminatedPlayers = Object.keys(nextPlayers)
            .map(Number)
            .filter(pid => buildingCounts[pid] === 0 && mcvCounts[pid] === 0);

        for (const eliminatedId of eliminatedPlayers) {
            finalEntities = killPlayerEntities(finalEntities, eliminatedId);
        }

        if (alivePlayers.length === 1) {
            nextWinner = alivePlayers[0];
            nextRunning = false; // Stop game on win

        } else if (alivePlayers.length === 0 && Object.keys(nextPlayers).length > 0) {
            // Draw or everyone destroyed?
            nextWinner = -1; // -1 for draw
            nextRunning = false;
        }
    }

    return {
        ...state,
        tick: nextTick,
        entities: finalEntities,
        players: nextPlayers,
        projectiles: nextProjectiles,
        winner: nextWinner,
        running: nextRunning,
        notification: nextNotification
    };
}

function updateProduction(player: PlayerState, entities: Record<EntityId, Entity>, state: GameState): { player: PlayerState, createdEntities: Entity[] } {
    let nextPlayer = { ...player, queues: { ...player.queues } };
    let createdEntities: Entity[] = [];

    // Check if player is eliminated (no buildings AND no MCV)
    // This matches the win condition check in tick()
    // Eliminated players cannot produce anything
    const playerBuildings = Object.values(entities).filter(e =>
        e.owner === player.id && e.type === 'BUILDING' && !e.dead
    );
    const hasMCV = Object.values(entities).some(e =>
        e.owner === player.id && e.key === 'mcv' && !e.dead
    );

    // If player is eliminated (no buildings AND no MCV), cancel all their production queues
    if (playerBuildings.length === 0 && !hasMCV) {
        // Cancel any pending builds silently (no refund since player is eliminated)
        nextPlayer = {
            ...nextPlayer,
            queues: {
                building: { current: null, progress: 0, invested: 0 },
                infantry: { current: null, progress: 0, invested: 0 },
                vehicle: { current: null, progress: 0, invested: 0 },
                air: { current: null, progress: 0, invested: 0 }
            },
            readyToPlace: null
        };
        return { player: nextPlayer, createdEntities };
    }

    // Calculate power (cached per tick)
    const power = calculatePower(player.id, entities, state.tick);
    const speedFactor = (power.out < power.in) ? 0.25 : 1.0;


    for (const key in nextPlayer.queues) {
        const cat = key as keyof typeof nextPlayer.queues;
        const q = nextPlayer.queues[cat];
        if (!q.current) continue;

        const data = getRuleData(q.current);
        if (!data) continue;

        // Check if player still has the required production building for this category
        // If not, cancel production and refund invested credits
        if (!canBuild(q.current, cat, player.id, entities)) {
            nextPlayer = {
                ...nextPlayer,
                credits: nextPlayer.credits + (q.invested || 0),
                queues: {
                    ...nextPlayer.queues,
                    [cat]: { current: null, progress: 0, invested: 0 }
                }
            };
            continue;
        }

        const totalCost = data.cost;

        // Calculate production speed multiplier based on number of production buildings
        // Each additional production building of the relevant type adds 50% speed
        const validBuildings: string[] = RULES.productionBuildings?.[cat] || [];
        const productionBuildingCount = Object.values(entities).filter(e =>
            e.owner === player.id && validBuildings.includes(e.key) && !e.dead
        ).length || 1;
        // Speed multiplier: 1.0 for 1 building, 1.5 for 2, 2.0 for 3, etc.
        const speedMult = 1 + (productionBuildingCount - 1) * 0.5;

        const costPerTick = (totalCost / 600) * speedMult * speedFactor;

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
                            [cat]: { current: null, progress: 0, invested: 0 }
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

                    const factories = Object.values(entities).filter(e => e.owner === player.id && e.key === spawnBuildingKey && !e.dead);
                    if (factories.length > 0) {
                        const factory = factories[0];
                        spawnPos = factory.pos.add(new Vector(0, factory.h / 2 + 20));
                    } else {
                        // Fallback to conyard
                        const conyards = Object.values(entities).filter(e => e.owner === player.id && e.key === 'conyard' && !e.dead);
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

function calculatePower(playerId: number, entities: Record<EntityId, Entity>, tick?: number): { in: number, out: number } {
    // Use cache if available for current tick
    if (tick !== undefined) {
        if (tick !== powerCacheTick) {
            // New tick - clear cache
            powerCache.clear();
            powerCacheTick = tick;
        }
        const cached = powerCache.get(playerId);
        if (cached) {
            return cached;
        }
    }

    let p = { in: 0, out: 0 };
    for (const id in entities) {
        const e = entities[id];
        if (e.owner === playerId && !e.dead) {
            const data = RULES.buildings[e.key];
            if (data) {
                if (data.power) p.out += data.power;
                if (data.drain) p.in += data.drain;
            }
        }
    }

    // Cache the result if tick is provided
    if (tick !== undefined) {
        powerCache.set(playerId, p);
    }

    return p;
}

// Returns rule data for a building or unit key.
function getRuleData(key: string): Building | Unit | null {
    if (RULES.buildings[key]) return RULES.buildings[key];
    if (RULES.units[key]) return RULES.units[key];
    return null;
}

function startBuild(state: GameState, payload: { category: string; key: string; playerId: number }): GameState {
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

function queueUnit(state: GameState, payload: { category: string; key: string; playerId: number; count: number }): GameState {
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

function dequeueUnit(state: GameState, payload: { category: string; key: string; playerId: number; count: number }): GameState {
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

function cancelBuild(state: GameState, payload: { category: string; playerId: number }): GameState {
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

function placeBuilding(state: GameState, payload: { key: string; x: number; y: number; playerId: number }): GameState {
    const { key, x, y, playerId } = payload;
    const player = state.players[playerId];
    if (!player || player.readyToPlace !== key) return state;

    // === BUILD RANGE VALIDATION ===
    // Building must be within BUILD_RADIUS of an existing building (excluding defenses)
    const BUILD_RADIUS = 400;
    const myBuildings = Object.values(state.entities).filter(e =>
        e.owner === playerId && e.type === 'BUILDING' && !e.dead
    );

    let withinBuildRange = false;
    for (const b of myBuildings) {
        const bData = RULES.buildings[b.key];
        // Defense buildings don't extend build range
        if (bData?.isDefense) continue;

        const dist = Math.sqrt((x - b.pos.x) ** 2 + (y - b.pos.y) ** 2);
        if (dist < BUILD_RADIUS) {
            withinBuildRange = true;
            break;
        }
    }

    // Reject placement if not within build range (unless this is first building)
    if (myBuildings.length > 0 && !withinBuildRange) {
        console.warn(`[Reducer] Rejected PLACE_BUILDING: position (${x}, ${y}) is outside build range`);
        return state;
    }

    const building = createEntity(x, y, playerId, 'BUILDING', key, state);

    let extraEntities: Record<EntityId, Entity> = {};
    if (key === 'refinery') {
        const harv = createEntity(x, y + 50, playerId, 'UNIT', 'harvester', state) as HarvesterUnit;
        // Harvesters spawned by refineries should auto-harvest immediately
        extraEntities[harv.id] = {
            ...harv,
            harvester: { ...harv.harvester, manualMode: false }
        };
    }

    // Only clear placingBuilding for human players.
    // AI players never use placement mode (they go directly to PLACE_BUILDING),
    // so their placements should not affect the human's placement UI.
    const shouldClearPlacing = !player.isAi;

    return {
        ...state,
        entities: { ...state.entities, [building.id]: building, ...extraEntities },
        players: {
            ...state.players,
            [playerId]: {
                ...player,
                readyToPlace: null
            }
        },
        placingBuilding: shouldClearPlacing ? null : state.placingBuilding
    };
}

function sellBuilding(state: GameState, payload: { buildingId: EntityId; playerId: number }): GameState {
    const { buildingId, playerId } = payload;
    const building = state.entities[buildingId];
    if (!building || building.owner !== playerId || building.type !== 'BUILDING' || building.dead) {
        return state;
    }

    const player = state.players[playerId];
    if (!player) return state;

    const buildingData = RULES.buildings[building.key];
    if (!buildingData) return state;

    const sellPercentage = RULES.economy?.sellBuildingReturnPercentage || 0.5;
    const refund = Math.floor(buildingData.cost * sellPercentage * (building.hp / building.maxHp));

    const nextEntities = { ...state.entities };
    delete nextEntities[buildingId];

    // Also clear from selection if it was selected
    const nextSelection = state.selection.filter(id => id !== buildingId);

    const newState = {
        ...state,
        entities: nextEntities,
        selection: nextSelection,
        players: {
            ...state.players,
            [playerId]: {
                ...player,
                credits: player.credits + refund
            }
        }
    };

    // Check for win/loss immediately
    if (newState.mode === 'game' || newState.mode === 'demo') {
        const buildingCounts: Record<number, number> = {};
        const mcvCounts: Record<number, number> = {};

        // Count just for this check
        for (const id in newState.entities) {
            const ent = newState.entities[id];
            if (!ent.dead) {
                if (ent.type === 'BUILDING') {
                    buildingCounts[ent.owner] = (buildingCounts[ent.owner] || 0) + 1;
                } else if (ent.type === 'UNIT' && ent.key === 'mcv') {
                    mcvCounts[ent.owner] = (mcvCounts[ent.owner] || 0) + 1;
                }
            }
        }

        const alivePlayers = Object.keys(newState.players)
            .map(Number)
            .filter(pid => (buildingCounts[pid] || 0) > 0 || (mcvCounts[pid] || 0) > 0);

        if (alivePlayers.length === 1) {
            // Kill loser entities
            const winner = alivePlayers[0];
            const losers = Object.keys(newState.players).map(Number).filter(id => id !== winner);
            let finalEntities = { ...newState.entities };
            for (const loserId of losers) {
                finalEntities = killPlayerEntities(finalEntities, loserId);
            }

            return {
                ...newState,
                entities: finalEntities,
                winner: winner,
                running: false
            };
        } else if (alivePlayers.length === 0 && Object.keys(newState.players).length > 0) {
            return {
                ...newState,
                winner: -1,
                running: false
            };
        }
    }

    return newState;
}

function startRepair(state: GameState, payload: { buildingId: EntityId; playerId: number }): GameState {
    const { buildingId, playerId } = payload;
    const building = state.entities[buildingId];

    // Validate building exists, is owned by player, is a building, not dead
    if (!building || building.owner !== playerId || building.type !== 'BUILDING' || building.dead) {
        return state;
    }

    // Can't repair if already at full HP
    if (building.hp >= building.maxHp) {
        return state;
    }

    // Can't repair if already repairing (toggle off instead)
    if (building.building.isRepairing) {
        return stopRepair(state, payload);
    }

    const player = state.players[playerId];
    if (!player) return state;

    // Check if player has any credits
    if (player.credits <= 0) {
        return state;
    }

    return {
        ...state,
        entities: {
            ...state.entities,
            [buildingId]: {
                ...building,
                building: { ...building.building, isRepairing: true }
            }
        }
    };
}

function stopRepair(state: GameState, payload: { buildingId: EntityId; playerId: number }): GameState {
    const { buildingId, playerId } = payload;
    const building = state.entities[buildingId];

    if (!building || building.owner !== playerId || building.type !== 'BUILDING') {
        return state;
    }

    if (!building.building.isRepairing) {
        return state;
    }

    return {
        ...state,
        entities: {
            ...state.entities,
            [buildingId]: {
                ...building,
                building: { ...building.building, isRepairing: false }
            }
        }
    };
}

function deployMCV(state: GameState, payload: { unitId: EntityId }): GameState {
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
    // We only care about static things that woud block a building:
    // Buildings, Resources, Rocks, Wells.
    // Units should technically move, but for simplicity we can say "blocked by units" too 
    // or just let them be squished/pushed. Starcraft/C&C usually prevents if units are in the way?
    // Actually C&C usually crushes infantry or waits.
    // Let's just check against static obstacles for now to match "not enough space".

    const blockers = Object.values(state.entities).filter(e =>
        !e.dead && e.id !== unitId && (
            e.type === 'BUILDING' ||
            e.type === 'RESOURCE' ||
            e.type === 'ROCK' ||
            e.type === 'WELL'
        )
    );

    for (const blocker of blockers) {
        // Simple circle/box overlap check. 
        // Buildings/Rocks/Wells are roughly circular or boxy.
        // Let's use radius for a quick check, or box for more precision if we had box collision logic handy.
        // Using radius sum is safer to prevent overlap.
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
    const conyardData = RULES.buildings['conyard'];
    const newConYard: BuildingEntity = {
        id: `conyard_${unitId}_${state.tick}`, // Unique ID
        owner: mcv.owner,
        type: 'BUILDING',
        key: 'conyard',
        pos: mcv.pos,
        prevPos: mcv.pos,
        hp: conyardData?.hp || 3000,
        maxHp: conyardData?.hp || 3000,
        w: size,
        h: size,
        radius: radius,
        dead: false,
        building: {
            isRepairing: false,
            placedTick: state.tick
        }
    };

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

function commandMove(state: GameState, payload: { unitIds: EntityId[]; x: number; y: number }): GameState {
    const { unitIds, x, y } = payload;
    const target = new Vector(x, y);

    let nextEntities = { ...state.entities };
    for (const id of unitIds) {
        const entity = nextEntities[id];
        if (entity && entity.owner !== -1 && entity.type === 'UNIT') {
            if (entity.key === 'harvester') {
                // Harvester: clear harvesting targets and enable manual mode
                nextEntities[id] = {
                    ...entity,
                    movement: { ...entity.movement, moveTarget: target, path: null },
                    combat: { ...entity.combat, targetId: null },
                    harvester: { ...entity.harvester, resourceTargetId: null, baseTargetId: null, manualMode: true }
                };
            } else {
                // Combat unit
                nextEntities[id] = {
                    ...entity,
                    movement: { ...entity.movement, moveTarget: target, path: null },
                    combat: { ...entity.combat, targetId: null }
                };
            }
        }
    }
    return { ...state, entities: nextEntities };
}

function commandAttack(state: GameState, payload: { unitIds: EntityId[]; targetId: EntityId }): GameState {
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
            } else {
                // Normal combat unit attack behavior
                nextEntities[id] = {
                    ...entity,
                    movement: { ...entity.movement, moveTarget: null, path: null },
                    combat: { ...entity.combat, targetId: targetId }
                };
            }
        }
    }
    return { ...state, entities: nextEntities };
}

function updateEntities(state: GameState): { entities: Record<EntityId, Entity>, projectiles: Projectile[], particles: Particle[], creditsEarned: Record<number, number> } {
    let nextEntities = { ...state.entities };
    let newProjectiles: Projectile[] = [];
    let newParticles: Particle[] = [];
    let creditsEarned: Record<number, number> = {};

    // Refresh collision grid for pathfinding (passing map config for dynamic grid sizing)
    refreshCollisionGrid(state.entities, state.config);

    // PERFORMANCE: Rebuild spatial grid for O(1) neighbor lookups
    rebuildSpatialGrid(state.entities);

    const entityList = Object.values(state.entities);

    for (const id in nextEntities) {
        const entity = nextEntities[id];
        if (entity.dead) continue;

        if (entity.type === 'UNIT') {
            const res = updateUnit(entity, state.entities, entityList, state.config, state.tick);
            nextEntities[id] = res.entity;
            if (res.projectile) newProjectiles.push(res.projectile);
            if (res.creditsEarned > 0) {
                creditsEarned[entity.owner] = (creditsEarned[entity.owner] || 0) + res.creditsEarned;
            }
            if (res.resourceDamage) {
                const target = nextEntities[res.resourceDamage.id];
                if (target) {
                    const newHp = target.hp - res.resourceDamage.amount;
                    nextEntities[res.resourceDamage.id] = {
                        ...target,
                        hp: newHp,
                        dead: newHp <= 0
                    };
                }
            }

            // Handle Engineer Capture/Repair
            const ent = nextEntities[id] as UnitEntity;
            if (ent.key !== 'harvester' && ent.engineer?.captureTargetId) {
                const engTargetId = ent.engineer.captureTargetId;
                const engTarget = nextEntities[engTargetId];
                if (engTarget && engTarget.type === 'BUILDING') {
                    // Flash the captured building
                    nextEntities[engTargetId] = {
                        ...engTarget,
                        owner: ent.owner,
                        combat: engTarget.combat ? { ...engTarget.combat, flash: 30 } : undefined
                    };
                    nextEntities[id] = {
                        ...ent,
                        dead: true,
                        engineer: { ...ent.engineer, captureTargetId: null }
                    };
                }
            } else if (ent.key !== 'harvester' && ent.engineer?.repairTargetId) {
                const engTargetId = ent.engineer.repairTargetId;
                const engTarget = nextEntities[engTargetId];
                if (engTarget && engTarget.type === 'BUILDING' && engTarget.hp < engTarget.maxHp) {
                    const repairAmount = 20; // Repair strength
                    nextEntities[engTargetId] = {
                        ...engTarget,
                        hp: Math.min(engTarget.maxHp, engTarget.hp + repairAmount),
                        combat: engTarget.combat ? { ...engTarget.combat, flash: 5 } : undefined
                    };
                    nextEntities[id] = {
                        ...ent,
                        engineer: { ...ent.engineer, repairTargetId: null }
                    };
                }
            }
        } else if (entity.type === 'BUILDING') {
            const res = updateBuilding(entity, state.entities, entityList);
            nextEntities[id] = res.entity;
            if (res.projectile) newProjectiles.push(res.projectile);
        }

        // Movement, rotation, cooldown, flash, turret updates (units only)
        let currentEnt = nextEntities[id];
        if (currentEnt.type === 'UNIT') {
            const vel = currentEnt.movement.vel;
            if (vel.mag() > 0) {
                currentEnt = { ...currentEnt, prevPos: currentEnt.pos, pos: currentEnt.pos.add(vel) };
                const data = getRuleData(currentEnt.key);
                const canFly = data && isUnitData(data) && data.fly;
                if (data && !canFly) {
                    // Smooth rotation
                    const targetRot = Math.atan2(vel.y, vel.x);
                    let diff = targetRot - currentEnt.movement.rotation;
                    while (diff > Math.PI) diff -= Math.PI * 2;
                    while (diff < -Math.PI) diff += Math.PI * 2;
                    let newRotation = currentEnt.movement.rotation + diff * 0.2;
                    while (newRotation > Math.PI) newRotation -= Math.PI * 2;
                    while (newRotation < -Math.PI) newRotation += Math.PI * 2;
                    currentEnt = {
                        ...currentEnt,
                        movement: { ...currentEnt.movement, rotation: newRotation }
                    };
                }
                currentEnt = {
                    ...currentEnt,
                    movement: { ...currentEnt.movement, vel: new Vector(0, 0) }
                };
                nextEntities[id] = currentEnt;
            }

            // Update cooldown and flash in combat component
            if (currentEnt.combat.cooldown > 0 || currentEnt.combat.flash > 0) {
                nextEntities[id] = {
                    ...currentEnt,
                    combat: {
                        ...currentEnt.combat,
                        cooldown: Math.max(0, currentEnt.combat.cooldown - 1),
                        flash: Math.max(0, currentEnt.combat.flash - 1)
                    }
                };
                currentEnt = nextEntities[id] as UnitEntity;
            }

            // Update turret angle to track target
            if (currentEnt.combat.targetId) {
                const target = nextEntities[currentEnt.combat.targetId];
                if (target && !target.dead) {
                    const deltaX = target.pos.x - currentEnt.pos.x;
                    const deltaY = target.pos.y - currentEnt.pos.y;
                    const targetTurretAngle = Math.atan2(deltaY, deltaX);

                    let angleDiff = targetTurretAngle - currentEnt.combat.turretAngle;
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                    const newTurretAngle = currentEnt.combat.turretAngle + angleDiff * 0.25;
                    nextEntities[id] = {
                        ...currentEnt,
                        combat: { ...currentEnt.combat, turretAngle: newTurretAngle }
                    };
                }
            }
        } else if (currentEnt.type === 'BUILDING' && currentEnt.combat) {
            // Update cooldown and flash for defense buildings
            if (currentEnt.combat.cooldown > 0 || currentEnt.combat.flash > 0) {
                nextEntities[id] = {
                    ...currentEnt,
                    combat: {
                        ...currentEnt.combat,
                        cooldown: Math.max(0, currentEnt.combat.cooldown - 1),
                        flash: Math.max(0, currentEnt.combat.flash - 1)
                    }
                };
            }
        }
    }

    // Resolve Hard Collisions
    nextEntities = resolveCollisions(nextEntities);

    return { entities: nextEntities, projectiles: newProjectiles, particles: newParticles, creditsEarned };
}

// Mutable version of Entity for collision resolution (allows position updates)
type MutableEntity = { -readonly [K in keyof Entity]: Entity[K] };

function resolveCollisions(entities: Record<EntityId, Entity>): Record<EntityId, Entity> {
    // Create a mutable lookup for working copies
    const workingEntities: Record<EntityId, MutableEntity> = {};
    const units: MutableEntity[] = [];

    for (const id in entities) {
        const e: MutableEntity = { ...entities[id] };
        workingEntities[id] = e;
        if (e.type === 'UNIT' && !e.dead) {
            units.push(e);
        }
    }

    // Early exit if no units
    if (units.length === 0) return workingEntities as Record<EntityId, Entity>;

    const iterations = 4; // Run a few passes for stability
    const spatialGrid = getSpatialGrid();

    // Max collision check radius (max unit radius ~45 + max other radius ~45 + buffer)
    const MAX_CHECK_RADIUS = 100;

    for (let k = 0; k < iterations; k++) {
        // Only iterate units (at least one entity must be a unit for collision to matter)
        for (const a of units) {
            if (a.dead) continue;

            // Use spatial grid to find nearby entities instead of checking all
            const nearby = spatialGrid.queryRadius(a.pos.x, a.pos.y, MAX_CHECK_RADIUS);

            for (const nearbyEntity of nearby) {
                // Skip self and already processed pairs (use id comparison to avoid duplicates)
                if (nearbyEntity.id <= a.id) continue;

                // Get the working copy (with potentially updated position)
                const b = workingEntities[nearbyEntity.id];
                if (!b || b.dead) continue;

                const isUnitB = b.type === 'UNIT';
                // a is always a unit, skip if b is not a unit and not a building/resource that matters
                if (!isUnitB && b.type !== 'BUILDING' && b.type !== 'ROCK') continue;

                const dist = a.pos.dist(b.pos);
                // Allow slight soft overlap to reduce jittering
                const softOverlap = 2;
                const minDist = a.radius + b.radius - softOverlap;

                if (dist < minDist && dist > 0.001) {
                    const overlap = minDist - dist;
                    const dir = b.pos.sub(a.pos).norm();

                    if (isUnitB) {
                        // Determine which unit is moving vs stationary
                        const aUnit = a as unknown as UnitEntity;
                        const bUnit = b as unknown as UnitEntity;
                        const aMoving = aUnit.movement.moveTarget !== null || aUnit.combat.targetId !== null || (aUnit.movement.vel && aUnit.movement.vel.mag() > 0.5);
                        const bMoving = bUnit.movement.moveTarget !== null || bUnit.combat.targetId !== null || (bUnit.movement.vel && bUnit.movement.vel.mag() > 0.5);

                        // Use stronger push to counteract movement speed
                        const pushScale = Math.min(overlap, 2.5);

                        if (aMoving && !bMoving) {
                            // A is moving, B is stationary - A yields more
                            const push = dir.scale(pushScale);
                            a.pos = a.pos.sub(push.scale(0.8));
                            b.pos = b.pos.add(push.scale(0.2));
                        } else if (bMoving && !aMoving) {
                            // B is moving, A is stationary - B yields more
                            const push = dir.scale(pushScale);
                            a.pos = a.pos.sub(push.scale(0.2));
                            b.pos = b.pos.add(push.scale(0.8));
                        } else if (aMoving && bMoving) {
                            // BOTH moving - use both radial push and perpendicular slide
                            const push = dir.scale(pushScale * 0.5);
                            a.pos = a.pos.sub(push);
                            b.pos = b.pos.add(push);

                            // Also use perpendicular push to slide past each other (keep right)
                            const perpA = new Vector(-dir.y, dir.x);
                            const perpB = new Vector(dir.y, -dir.x);
                            a.pos = a.pos.add(perpA.scale(pushScale * 0.5));
                            b.pos = b.pos.add(perpB.scale(pushScale * 0.5));
                        } else {
                            // Both stationary - minimal push
                            const totalR = a.radius + b.radius;
                            const ratioA = b.radius / totalR;
                            const ratioB = a.radius / totalR;
                            const push = dir.scale(pushScale * 0.5); // Half strength for stationary
                            a.pos = a.pos.sub(push.scale(ratioA));
                            b.pos = b.pos.add(push.scale(ratioB));
                        }
                    } else {
                        // A is unit, B is building/rock - A yields completely
                        a.pos = a.pos.sub(dir.scale(overlap));
                    }
                }
            }
        }
    }

    return workingEntities as Record<EntityId, Entity>;
}


function updateUnit(entity: UnitEntity, allEntities: Record<EntityId, Entity>, entityList: Entity[], mapConfig: { width: number, height: number }, currentTick: number): { entity: UnitEntity, projectile?: Projectile | null, creditsEarned: number, resourceDamage?: { id: string, amount: number } | null } {
    let nextEntity: UnitEntity = { ...entity };
    const data = getRuleData(nextEntity.key);
    let projectile = null;
    let creditsEarned = 0;

    let resourceDamage: { id: string, amount: number } | null = null;

    // Harvester Logic
    if (nextEntity.key === 'harvester') {
        let harvester = nextEntity as HarvesterUnit;
        const capacity = 500;

        // 0a. Harvester auto-attack: Fire at enemies in range (before harvesting)
        // This runs first so harvesters will shoot nearby enemies even while harvesting
        if (harvester.combat.cooldown <= 0 && !harvester.movement.moveTarget) {
            const harvData = getRuleData('harvester');
            const harvRange = harvData?.range ?? 60;

            // Find closest enemy in range
            let closestEnemy: Entity | null = null;
            let closestDist = harvRange;

            for (const other of entityList) {
                if (other.dead || other.owner === -1 || other.owner === harvester.owner) continue;

                const d = harvester.pos.dist(other.pos);
                if (d < closestDist) {
                    closestDist = d;
                    closestEnemy = other;
                }
            }

            // Fire at enemy without setting targetId (no chasing)
            if (closestEnemy) {
                projectile = createProjectile(harvester, closestEnemy);
                harvester = {
                    ...harvester,
                    combat: { ...harvester.combat, cooldown: harvData?.rate ?? 30 }
                };
                nextEntity = harvester;
            }
        }

        // 0b. If manual move (flee/player command), skip automated logic
        // BUT: If harvester has full cargo, ALWAYS clear moveTarget so it can go unload
        // This fixes the "dancing" bug where harvesters flee to safety but then can't return
        // to base because they keep trying to reach the flee destination
        if (harvester.movement.moveTarget) {
            if (harvester.harvester.cargo >= capacity) {
                // Full cargo - clear flee target immediately so harvester can go unload
                // Don't wait for stuckTimer - harvesters with full cargo should prioritize unloading
                harvester = {
                    ...harvester,
                    movement: { ...harvester.movement, moveTarget: null, path: null, pathIdx: 0 }
                };
                nextEntity = harvester;
            }
            // Otherwise, fall through to generic move logic (allow fleeing with low cargo)
        }
        // 1. If full, return to refinery
        else if (harvester.harvester.cargo >= capacity) {
            harvester = {
                ...harvester,
                harvester: { ...harvester.harvester, resourceTargetId: null }
            };
            if (!harvester.harvester.baseTargetId) {
                // Find nearest refinery using spatial query (search within reasonable range first)
                const spatialGrid = getSpatialGrid();
                const searchRadius = 1500; // Start with nearby search
                let bestRef = spatialGrid.findNearest(
                    harvester.pos.x, harvester.pos.y, searchRadius,
                    (e) => e.owner === harvester.owner && e.key === 'refinery' && !e.dead
                );
                // Fallback to global search if nothing nearby
                if (!bestRef) {
                    let minDst = Infinity;
                    for (const other of entityList) {
                        if (other.owner === harvester.owner && other.key === 'refinery' && !other.dead) {
                            const d = harvester.pos.dist(other.pos);
                            if (d < minDst) {
                                minDst = d;
                                bestRef = other;
                            }
                        }
                    }
                }
                if (bestRef) {
                    harvester = {
                        ...harvester,
                        harvester: { ...harvester.harvester, baseTargetId: bestRef.id }
                    };
                }
            }

            if (harvester.harvester.baseTargetId) {
                const ref = allEntities[harvester.harvester.baseTargetId];
                if (ref && !ref.dead) {
                    // Target "Docking Point" (bottom of refinery)
                    // Clamp dock position to map bounds to prevent pathfinding issues
                    const rawDockPos = ref.pos.add(new Vector(0, 100));
                    const dockPos = new Vector(
                        Math.max(0, Math.min(mapConfig.width - 1, rawDockPos.x)),
                        Math.max(0, Math.min(mapConfig.height - 1, rawDockPos.y))
                    );
                    const ourDist = harvester.pos.dist(dockPos);

                    // Check if another harvester is ahead of us in the queue
                    let positionInQueue = 0; // 0 = first in line
                    for (const other of entityList) {
                        if (other.id !== harvester.id &&
                            other.type === 'UNIT' &&
                            other.key === 'harvester' &&
                            other.owner === harvester.owner &&
                            !other.dead) {
                            const otherHarv = other as HarvesterUnit;
                            if (otherHarv.harvester.cargo > 0 && // Only count harvesters with cargo (wanting to dock)
                                otherHarv.harvester.baseTargetId === harvester.harvester.baseTargetId && // Only count harvesters targeting SAME refinery
                                otherHarv.movement.moveTarget === null) { // Ignore harvesters with player move override
                                const otherDist = other.pos.dist(dockPos);
                                // If another harvester is closer to the dock
                                if (otherDist < ourDist) {
                                    positionInQueue++;
                                }
                            }
                        }
                    }


                    if (ourDist < 20 && positionInQueue === 0) {
                        // We're at dock and first in line - Unload
                        nextEntity = {
                            ...harvester,
                            harvester: { ...harvester.harvester, cargo: 0, baseTargetId: null }
                        };
                        creditsEarned = 500;
                    } else if (positionInQueue > 0 && ourDist < 80) {
                        // Someone is ahead of us and we're near dock - wait stationary
                        // Explicitly set velocity to zero
                        nextEntity = {
                            ...harvester,
                            movement: { ...harvester.movement, vel: new Vector(0, 0) }
                        };
                    } else if (positionInQueue > 2 && ourDist < 200) {
                        // Far back in queue (3rd or later) and getting close - slow down/wait
                        // This prevents traffic jams from harvesters all rushing to the same waypoint
                        nextEntity = {
                            ...harvester,
                            movement: { ...harvester.movement, vel: new Vector(0, 0) }
                        };
                    } else {
                        // Move toward dock
                        // Skip whisker avoidance when close to dock to avoid false positives
                        // from grid resolution issues (dock and nearby buildings in same grid cell)
                        const skipWhiskers = ourDist < 80;
                        nextEntity = moveToward(harvester, dockPos, entityList, skipWhiskers) as HarvesterUnit;
                    }
                } else {
                    nextEntity = {
                        ...harvester,
                        harvester: { ...harvester.harvester, baseTargetId: null }
                    }; // Refinery died
                }
            }
        }
        // 2. If valid resource target, go gather
        else {
            // Only auto-acquire resources if NOT in manual mode
            // Harvesters start in manual mode by default (manualMode is undefined or true)
            // They enter auto mode (manualMode = false) when right-clicking ore/refinery
            const isManualMode = harvester.harvester.manualMode !== false;
            if (!harvester.harvester.resourceTargetId && !isManualMode) {
                // Find best ore considering:
                // 1. Distance (prefer closer)
                // 2. Congestion (prefer ores with fewer harvesters, max 2 per ore)
                const blockedOreId = harvester.harvester.blockedOreId;
                const MAX_HARVESTERS_PER_ORE = 2;

                // First, count harvesters per ore (all harvesters, including enemies)
                const harvestersPerOre: Record<string, number> = {};
                for (const other of entityList) {
                    if (other.type === 'UNIT' &&
                        other.key === 'harvester' &&
                        !other.dead &&
                        other.id !== harvester.id) {
                        const otherHarv = other as HarvesterUnit;
                        // For queue/congestion, we care about active harvesting
                        if (otherHarv.harvester.resourceTargetId) {
                            // If it's an enemy, count it as congestion but maybe flag it?
                            // Currently we just count.
                            harvestersPerOre[otherHarv.harvester.resourceTargetId] = (harvestersPerOre[otherHarv.harvester.resourceTargetId] || 0) + 1;
                        }
                    }
                }

                let bestOre: Entity | null = null;
                let bestScore = -Infinity;

                // Use spatial query to find nearby ore first (800px radius)
                const spatialGrid = getSpatialGrid();
                const nearbyOre = spatialGrid.queryRadiusByType(harvester.pos.x, harvester.pos.y, 800, 'RESOURCE');

                for (const other of nearbyOre) {
                    if (other.dead || other.id === blockedOreId) continue;
                    const dist = harvester.pos.dist(other.pos);
                    const harvestersAtOre = harvestersPerOre[other.id] || 0;

                    // Skip if already at max capacity
                    if (harvestersAtOre >= MAX_HARVESTERS_PER_ORE) continue;

                    // Score: closer is better, fewer harvesters is better
                    // Congestion penalty: each existing harvester is like 500 extra distance (was 100)
                    // This strongly discourages sharing unless the alternative is very far (> 500px diff)
                    const effectiveDist = dist + harvestersAtOre * 500;
                    const score = -effectiveDist; // Higher is better (less distance = higher score)

                    if (score > bestScore) {
                        bestScore = score;
                        bestOre = other;
                    }
                }

                // Fallback to global search if no nearby ore found
                if (!bestOre) {
                    for (const other of entityList) {
                        if (other.type === 'RESOURCE' && !other.dead && other.id !== blockedOreId) {
                            const dist = harvester.pos.dist(other.pos);
                            const harvestersAtOre = harvestersPerOre[other.id] || 0;

                            // Skip if already at max capacity
                            if (harvestersAtOre >= MAX_HARVESTERS_PER_ORE) continue;

                            const effectiveDist = dist + harvestersAtOre * 500;
                            const score = -effectiveDist;

                            if (score > bestScore) {
                                bestScore = score;
                                bestOre = other;
                            }
                        }
                    }

                    // Last resort: pick nearest ore even if congested
                    if (!bestOre) {
                        let minDst = Infinity;
                        for (const other of entityList) {
                            if (other.type === 'RESOURCE' && !other.dead && other.id !== blockedOreId) {
                                const d = harvester.pos.dist(other.pos);
                                if (d < minDst) {
                                    minDst = d;
                                    bestOre = other;
                                }
                            }
                        }
                    }
                }

                if (bestOre) {
                    harvester = {
                        ...harvester,
                        harvester: { ...harvester.harvester, resourceTargetId: bestOre.id }
                    };
                }
            }

            if (harvester.harvester.resourceTargetId) {
                const ore = allEntities[harvester.harvester.resourceTargetId];
                if (ore && !ore.dead) {
                    const distToOre = harvester.pos.dist(ore.pos);

                    // Track how long we've been trying to reach this ore
                    const harvestAttemptTicks = harvester.harvester.harvestAttemptTicks || 0;

                    // Decay blocked ore timer
                    const blockedOreTimer = harvester.harvester.blockedOreTimer || 0;
                    if (blockedOreTimer > 0) {
                        harvester = {
                            ...harvester,
                            harvester: { ...harvester.harvester, blockedOreTimer: blockedOreTimer - 1 }
                        };
                        nextEntity = harvester;
                        if (blockedOreTimer <= 1) {
                            // Clear blocked ore after timer expires (allow retry)
                            harvester = {
                                ...harvester,
                                harvester: { ...harvester.harvester, blockedOreId: null }
                            };
                            nextEntity = harvester;
                        }
                    }

                    if (distToOre < 40) {
                        // Harvest
                        if (harvester.combat.cooldown <= 0) {
                            const harvestAmount = 25;
                            // Check if ore has enough
                            const actualHarvest = Math.min(harvestAmount, ore.hp);

                            nextEntity = {
                                ...harvester,
                                combat: { ...harvester.combat, cooldown: 30 },
                                harvester: {
                                    ...harvester.harvester,
                                    cargo: harvester.harvester.cargo + actualHarvest,
                                    harvestAttemptTicks: 0
                                }
                            };
                            resourceDamage = { id: ore.id, amount: actualHarvest };
                        }
                    } else {
                        // Still far from ore - track progress toward it
                        const prevLastDist = harvester.harvester.lastDistToOre;
                        const lastDistToOre = prevLastDist ?? distToOre;
                        const prevBestDist = harvester.harvester.bestDistToOre;
                        const bestDistToOre = prevBestDist ?? distToOre;

                        // Track minimum distance ever achieved
                        const newBestDist = Math.min(bestDistToOre, distToOre);

                        // Check if we're making REAL progress toward being able to harvest
                        // Use bestDistToOre improvement, not just any movement, to prevent
                        // oscillating harvesters from resetting the stuck timer forever
                        const madeProgress = (prevBestDist === undefined) || (newBestDist < bestDistToOre - 5);

                        // Check for congestion - is another harvester closer to this ore?
                        let positionInQueue = 0;
                        let blockedByHarvester = false;
                        for (const other of entityList) {
                            if (other.id !== harvester.id &&
                                other.type === 'UNIT' &&
                                other.key === 'harvester' &&
                                !other.dead) {
                                const otherHarv = other as HarvesterUnit;
                                if (otherHarv.harvester.resourceTargetId === ore.id) {
                                    const otherDistToOre = other.pos.dist(ore.pos);
                                    if (otherDistToOre < distToOre) {
                                        positionInQueue++;
                                        // Check if this other harvester is very close to us (blocking)
                                        const distToOther = harvester.pos.dist(other.pos);
                                        if (distToOther < 50) {
                                            blockedByHarvester = true;
                                        }
                                    }
                                }
                            }
                        }

                        // If blocked by a harvester and not making progress, switch to different ore
                        if (blockedByHarvester && harvestAttemptTicks > 15) {
                            // Find a different ore with less congestion
                            const MAX_HARVESTERS_PER_ORE = 2;
                            let altOre: Entity | null = null;
                            let bestAltScore = -Infinity;

                            for (const other of entityList) {
                                if (other.type === 'RESOURCE' && !other.dead && other.id !== ore.id) {
                                    const d = harvester.pos.dist(other.pos);
                                    // Count harvesters at this ore
                                    let harvestersAtOre = 0;
                                    for (const h of entityList) {
                                        if (h.type === 'UNIT' && h.key === 'harvester' && !h.dead) {
                                            const hHarv = h as HarvesterUnit;
                                            if (hHarv.harvester.resourceTargetId === other.id) {
                                                harvestersAtOre++;
                                            }
                                        }
                                    }
                                    // Skip if already at max capacity
                                    if (harvestersAtOre >= MAX_HARVESTERS_PER_ORE) continue;

                                    // Score: closer is better, fewer harvesters is better
                                    const effectiveDist = d + harvestersAtOre * 100;
                                    const score = -effectiveDist;

                                    if (score > bestAltScore) {
                                        bestAltScore = score;
                                        altOre = other;
                                    }
                                }
                            }
                            if (altOre) {
                                nextEntity = {
                                    ...harvester,
                                    movement: { ...harvester.movement, path: null, pathIdx: 0 },
                                    harvester: {
                                        ...harvester.harvester,
                                        resourceTargetId: altOre.id,
                                        harvestAttemptTicks: 0,
                                        lastDistToOre: null,
                                        bestDistToOre: null
                                    }
                                };
                            } else {
                                // No alternative ore - wait in queue
                                nextEntity = {
                                    ...harvester,
                                    movement: { ...harvester.movement, vel: new Vector(0, 0) }
                                };
                            }
                        } else if (harvestAttemptTicks > 30 && distToOre > 43) {
                            // Give up on this ore after being stuck for too long
                            // Always mark as blocked to prevent immediately retargeting the same ore
                            // This fixes the "spinning harvester" bug where harvesters get stuck
                            // trying to reach ore near refineries and keep retargeting it
                            nextEntity = {
                                ...harvester,
                                movement: { ...harvester.movement, stuckTimer: 0, path: null, pathIdx: 0 },
                                harvester: {
                                    ...harvester.harvester,
                                    resourceTargetId: null,
                                    harvestAttemptTicks: 0,
                                    lastDistToOre: null,
                                    bestDistToOre: null,
                                    blockedOreId: ore.id,
                                    blockedOreTimer: 300 // Block this ore for ~5 seconds
                                }
                            };
                        } else if (newBestDist > 45 && harvestAttemptTicks > 60) {
                            // Failsafe: if after 60 ticks we've never gotten close enough to harvest
                            // (bestDistToOre > 45), the ore is likely unreachable (blocked by building)
                            // This catches oscillating harvesters that keep "making progress" but
                            // never actually get close enough due to pathing around obstacles
                            nextEntity = {
                                ...harvester,
                                movement: { ...harvester.movement, stuckTimer: 0, path: null, pathIdx: 0 },
                                harvester: {
                                    ...harvester.harvester,
                                    resourceTargetId: null,
                                    harvestAttemptTicks: 0,
                                    lastDistToOre: null,
                                    bestDistToOre: null,
                                    blockedOreId: ore.id,
                                    blockedOreTimer: 300
                                }
                            };
                        } else {
                            // Keep trying - move toward ore
                            nextEntity = moveToward(harvester, ore.pos, entityList) as HarvesterUnit;

                            if (madeProgress) {
                                // Making progress - reset counter, update tracking points
                                nextEntity = {
                                    ...nextEntity,
                                    harvester: {
                                        ...(nextEntity as HarvesterUnit).harvester,
                                        harvestAttemptTicks: 0,
                                        lastDistToOre: distToOre,
                                        bestDistToOre: newBestDist
                                    }
                                } as HarvesterUnit;
                            } else {
                                // Not making progress - increment counter
                                // Keep bestDistToOre at the old value so we can detect 5+ unit improvement
                                nextEntity = {
                                    ...nextEntity,
                                    harvester: {
                                        ...(nextEntity as HarvesterUnit).harvester,
                                        harvestAttemptTicks: harvestAttemptTicks + 1,
                                        lastDistToOre: lastDistToOre,
                                        bestDistToOre: bestDistToOre  // Don't update - wait for 5+ unit improvement
                                    }
                                } as HarvesterUnit;
                            }
                        }
                    }
                } else {
                    nextEntity = {
                        ...harvester,
                        harvester: { ...harvester.harvester, resourceTargetId: null, harvestAttemptTicks: 0 }
                    };
                }
            }
        }
    }

    // Existing generic unit logic (combat, movement) - ONLY if not harvesting?
    // Harvesters should flee or defend if attacked?
    // For now simple overwrite: If we did harvester logic and moved/acted, skip generic?
    // Or merge.
    // If harvester has `moveTarget` (manual command), that overrides harvest logic.
    if (nextEntity.key !== 'harvester' || !nextEntity.movement.moveTarget) {
        // Skip generic combat/move logic if doing harvest things
        // But we want it to react to attacks?
        // Let's keep generic logic for `moveTarget` override.
    }

    // Original generic logic follows...
    // Generic logic calling block
    if (nextEntity.key !== 'harvester' && data && isUnitData(data)) {
        let combatUnit = nextEntity as CombatUnit;
        const isHealer = data.damage < 0;
        const isEngineer = data.canCaptureEnemyBuildings || data.canRepairFriendlyBuildings;

        // Only auto-acquire targets if unit doesn't have a pending move command
        // This allows players to retreat units that are auto-attacking
        if (!combatUnit.combat.targetId && !combatUnit.movement.moveTarget && (data.damage || isEngineer)) {
            const range = (data.range || 100) + (isHealer ? 100 : 50);
            let bestTargetId: EntityId | null = null;
            let bestDist = range;

            for (const other of entityList) {
                if (other.dead || other.owner === -1) continue;

                const d = combatUnit.pos.dist(other.pos);
                if (d < bestDist) {
                    if (isHealer) {
                        // Medic/Healer targets friendlies that need help
                        if (other.owner === combatUnit.owner && other.hp < other.maxHp && other.type === 'UNIT' && other.id !== combatUnit.id) {
                            bestDist = d;
                            bestTargetId = other.id;
                        }
                    } else if (isEngineer) {
                        // Engineer targets buildings
                        if (other.type === 'BUILDING') {
                            if (other.owner !== combatUnit.owner && data.canCaptureEnemyBuildings) {
                                bestDist = d;
                                bestTargetId = other.id;
                            } else if (other.owner === combatUnit.owner && other.hp < other.maxHp && data.canRepairFriendlyBuildings) {
                                bestDist = d;
                                bestTargetId = other.id;
                            }
                        }
                    } else {
                        // Normal combat targets enemies
                        if (other.owner !== combatUnit.owner) {
                            bestDist = d;
                            bestTargetId = other.id;
                        }
                    }
                }
            }
            if (bestTargetId) {
                combatUnit = {
                    ...combatUnit,
                    combat: { ...combatUnit.combat, targetId: bestTargetId }
                };
                nextEntity = combatUnit;
            }
        }

        if (combatUnit.combat.targetId) {
            const target = allEntities[combatUnit.combat.targetId];
            if (target && !target.dead) {
                const dist = combatUnit.pos.dist(target.pos);
                const range = data.range || 100;

                if (isEngineer && target.type === 'BUILDING') {
                    if (dist < 40) {
                        combatUnit = {
                            ...combatUnit,
                            movement: { ...combatUnit.movement, moveTarget: null }
                        };
                        if (target.owner !== combatUnit.owner && data.canCaptureEnemyBuildings) {
                            // CAPTURE: Engineer consumed, building ownership transfers
                            combatUnit = {
                                ...combatUnit,
                                dead: true,
                                engineer: { ...combatUnit.engineer, captureTargetId: target.id }
                            };
                        } else if (target.owner === combatUnit.owner && data.canRepairFriendlyBuildings) {
                            // REPAIR: Engineer heals building over time
                            if (combatUnit.combat.cooldown <= 0) {
                                combatUnit = {
                                    ...combatUnit,
                                    combat: { ...combatUnit.combat, cooldown: data.rate || 30 },
                                    engineer: { ...combatUnit.engineer, repairTargetId: target.id }
                                };
                            }
                        }
                        nextEntity = combatUnit;
                    } else {
                        nextEntity = moveToward(combatUnit, target.pos, entityList) as CombatUnit;
                    }
                } else if (dist <= range) {
                    combatUnit = {
                        ...combatUnit,
                        movement: { ...combatUnit.movement, moveTarget: null }
                    };
                    if (combatUnit.combat.cooldown <= 0) {
                        projectile = createProjectile(combatUnit, target);
                        combatUnit = {
                            ...combatUnit,
                            combat: { ...combatUnit.combat, cooldown: data.rate || 30 }
                        };
                    }
                    nextEntity = combatUnit;
                } else {
                    nextEntity = moveToward(combatUnit, target.pos, entityList) as CombatUnit;
                }
            } else {
                nextEntity = {
                    ...combatUnit,
                    combat: { ...combatUnit.combat, targetId: null }
                };
            }
        } else if (combatUnit.movement.moveTarget) {
            nextEntity = moveToward(combatUnit, combatUnit.movement.moveTarget, entityList) as CombatUnit;
            if (nextEntity.pos.dist(combatUnit.movement.moveTarget!) < 10) {
                nextEntity = {
                    ...nextEntity,
                    movement: { ...(nextEntity as CombatUnit).movement, moveTarget: null }
                };
            }
        }
    } else if (nextEntity.key === 'harvester') {
        const harvesterUnit = nextEntity as HarvesterUnit;
        if (harvesterUnit.combat.targetId) {
            // Manual attack command for harvester - active attack mode (chasing)
            const target = allEntities[harvesterUnit.combat.targetId];
            if (target && !target.dead) {
                const harvData = getRuleData('harvester');
                const dist = harvesterUnit.pos.dist(target.pos);
                const range = harvData?.range ?? 60;

                if (dist <= range) {
                    // In range - fire!
                    let updatedHarv: HarvesterUnit = {
                        ...harvesterUnit,
                        movement: { ...harvesterUnit.movement, moveTarget: null }
                    };
                    if (harvesterUnit.combat.cooldown <= 0) {
                        projectile = createProjectile(harvesterUnit, target);
                        updatedHarv = {
                            ...updatedHarv,
                            combat: { ...updatedHarv.combat, cooldown: harvData?.rate ?? 30 }
                        };
                    }
                    nextEntity = updatedHarv;
                } else {
                    // Chase the target
                    nextEntity = moveToward(harvesterUnit, target.pos, entityList) as HarvesterUnit;
                }
            } else {
                // Target dead or gone - clear it and resume normal behavior
                nextEntity = {
                    ...harvesterUnit,
                    combat: { ...harvesterUnit.combat, targetId: null }
                };
            }
        } else if (harvesterUnit.movement.moveTarget) {
            // Manual move override for harvester (flee commands, player commands)
            nextEntity = moveToward(harvesterUnit, harvesterUnit.movement.moveTarget, entityList) as HarvesterUnit;

            // Harvesters can clear moveTarget at a larger distance (30 units) than regular units (10 units)
            // This prevents the circling bug where multiple harvesters flee to the same area
            // and collide, unable to reach within 10 units of their target
            const clearDistance = 30;

            // Also check if harvester has been stuck trying to reach this moveTarget for too long
            // If stuck for more than 40 ticks, give up and resume normal harvesting behavior
            const harvesterFleeTimeout = 40;
            const isStuckOnFlee = ((nextEntity as HarvesterUnit).movement.stuckTimer || 0) > harvesterFleeTimeout;

            // NEW: Track time spent trying to reach moveTarget - fixes "spinning/dancing" bug
            // where harvesters bounce off each other and can't reach their flee destination
            let moveTargetTicks = harvesterUnit.movement.moveTargetNoProgressTicks || 0;
            moveTargetTicks++;

            // Absolute timeout: give up on flee destination after 90 ticks (~1.5 seconds)
            // This ensures harvesters don't get stuck trying to reach unreachable destinations forever
            const absoluteFleeTimeout = 90;
            const isFleeTimedOut = moveTargetTicks > absoluteFleeTimeout;

            if (nextEntity.pos.dist(harvesterUnit.movement.moveTarget!) < clearDistance || isStuckOnFlee || isFleeTimedOut) {
                // When clearing flee moveTarget due to timeout, also:
                // 1. Set manualMode: false so harvester starts auto-harvesting
                // 2. Set a flee cooldown to prevent AI from immediately issuing another flee command
                const shouldDisableManualMode = isFleeTimedOut || isStuckOnFlee;
                const fleeCooldownDuration = 300; // ~5 seconds cooldown before can flee again
                nextEntity = {
                    ...nextEntity,
                    movement: {
                        ...(nextEntity as HarvesterUnit).movement,
                        moveTarget: null,
                        path: null,
                        pathIdx: 0,
                        stuckTimer: 0,
                        lastDistToMoveTarget: undefined,
                        bestDistToMoveTarget: undefined,
                        moveTargetNoProgressTicks: undefined
                    },
                    harvester: {
                        ...(nextEntity as HarvesterUnit).harvester,
                        manualMode: shouldDisableManualMode ? false : (nextEntity as HarvesterUnit).harvester.manualMode,
                        fleeCooldownUntilTick: shouldDisableManualMode ? (currentTick + fleeCooldownDuration) : undefined
                    }
                };
            } else {
                // Update tick counter
                nextEntity = {
                    ...nextEntity,
                    movement: {
                        ...(nextEntity as HarvesterUnit).movement,
                        moveTargetNoProgressTicks: moveTargetTicks
                    }
                };
            }
        }
    }

    return { entity: nextEntity, projectile, creditsEarned, resourceDamage };
}

function updateBuilding(entity: BuildingEntity, allEntities: Record<EntityId, Entity>, entityList: Entity[]): { entity: BuildingEntity, projectile?: Projectile | null } {
    let nextEntity: BuildingEntity = { ...entity };
    const data = getRuleData(nextEntity.key);
    let projectile = null;

    // Only process defense buildings (buildings with isDefense flag and combat component)
    if (data && isBuildingData(data) && data.isDefense && nextEntity.combat) {
        if (!nextEntity.combat.targetId) {
            const range = data.range || 200;
            let bestTargetId: EntityId | null = null;
            let targetIsAir = false;

            for (const other of entityList) {
                if (other.owner !== entity.owner && other.owner !== -1 && !other.dead) {
                    if (entity.pos.dist(other.pos) < range) {
                        const otherData = getRuleData(other.key);
                        const isAir = otherData && isUnitData(otherData) && otherData.fly === true;

                        if (nextEntity.key === 'sam_site') {
                            if (isAir && !targetIsAir) {
                                bestTargetId = other.id;
                                targetIsAir = true;
                            } else if (!bestTargetId) {
                                bestTargetId = other.id;
                            }
                        } else {
                            // Default: take first target in range
                            bestTargetId = other.id;
                            break;
                        }
                    }
                }
            }
            if (bestTargetId) {
                nextEntity = {
                    ...nextEntity,
                    combat: { ...nextEntity.combat!, targetId: bestTargetId }
                };
            }
        }

        if (nextEntity.combat!.targetId) {
            const target = allEntities[nextEntity.combat!.targetId];
            if (target && !target.dead && entity.pos.dist(target.pos) <= (data.range || 200)) {
                if (nextEntity.combat!.cooldown <= 0) {
                    projectile = createProjectile(nextEntity, target);
                    nextEntity = {
                        ...nextEntity,
                        combat: { ...nextEntity.combat!, cooldown: data.rate || 30 }
                    };
                }
            } else {
                nextEntity = {
                    ...nextEntity,
                    combat: { ...nextEntity.combat!, targetId: null }
                };
            }
        }
    }

    return { entity: nextEntity, projectile };
}

function updateProjectile(proj: Projectile, entities: Record<EntityId, Entity>): { proj: Projectile, damage?: { targetId: EntityId, amount: number, attackerId: EntityId } } {
    const nextPos = proj.pos.add(proj.vel);
    let nextProj = { ...proj, pos: nextPos };
    let damageEvent = undefined;

    const target = entities[proj.targetId];
    if (target && !target.dead) {
        if (nextPos.dist(target.pos) < target.radius + 15) {
            nextProj.dead = true;

            // Apply damage modifiers
            const targetData = getRuleData(target.key);
            const armorType = targetData?.armor || 'none';
            const weaponType = proj.weaponType || 'bullet';
            const modifiers = RULES.damageModifiers?.[weaponType];
            const modifier = modifiers?.[armorType] ?? 1.0;

            damageEvent = {
                targetId: target.id,
                amount: Math.round(proj.damage * modifier),
                attackerId: proj.ownerId
            };
        }
    } else if (target && target.dead && nextPos.dist(target.pos) < 20) {
        nextProj.dead = true;
    }

    return { proj: nextProj, damage: damageEvent };
}

function moveToward(entity: UnitEntity, target: Vector, _allEntities: Entity[], skipWhiskerAvoidance = false): UnitEntity {
    const distToTarget = entity.pos.dist(target);
    if (distToTarget < 2) {
        return {
            ...entity,
            movement: { ...entity.movement, vel: new Vector(0, 0), path: null, pathIdx: 0 }
        };
    }

    const unitData = getRuleData(entity.key);
    const speed = (unitData && isUnitData(unitData)) ? unitData.speed : 1;

    // Average velocity tracking for stuck detection
    let avgVel = entity.movement.avgVel || new Vector(0, 0);
    const effectiveVel = entity.pos.sub(entity.prevPos);
    avgVel = avgVel.scale(0.9).add(effectiveVel.scale(0.1));

    let stuckTimer = entity.movement.stuckTimer || 0;
    let unstuckDir = entity.movement.unstuckDir;
    let unstuckTimer = entity.movement.unstuckTimer || 0;
    let path = entity.movement.path;
    let pathIdx = entity.movement.pathIdx || 0;
    let finalDest = entity.movement.finalDest;

    // Check if we need a new path
    const needNewPath = !path || path.length === 0 ||
        (finalDest && finalDest.dist(target) > 20) ||
        (stuckTimer > 30); // Recalculate path if stuck

    if (needNewPath) {
        // Try A* pathfinding
        const newPath = findPath(entity.pos, target, entity.radius, entity.owner);
        if (newPath && newPath.length > 1) {
            path = newPath;
            pathIdx = 1; // Skip first waypoint (our current position)
            finalDest = target;
            stuckTimer = 0; // Reset stuck timer on new path
        } else {
            // If A* fails, clear path and use direct movement
            path = null;
            pathIdx = 0;
            finalDest = target;
        }
    }

    // Determine immediate movement target
    let immediateTarget = target;
    if (path && pathIdx < path.length) {
        immediateTarget = path[pathIdx];
        // Check if close enough to advance to next waypoint
        const waypointDist = entity.pos.dist(immediateTarget);
        if (waypointDist < 25) {
            pathIdx++;
            if (pathIdx < path.length) {
                immediateTarget = path[pathIdx];
            } else {
                immediateTarget = target;
            }
        }
    }

    // Stuck Condition
    // Use average velocity for stuck detection - this tracks actual movement over time
    // Note: entity.vel is always 0 after position updates, so we can't use it reliably here
    if (distToTarget > 10) {
        if (avgVel.mag() < speed * 0.15) {
            stuckTimer++;
        } else {
            stuckTimer = Math.max(0, stuckTimer - 2);
        }
    } else {
        stuckTimer = 0;
    }

    // Trigger unstuck logic - use smarter unstuck direction
    if (stuckTimer > 20) {
        unstuckTimer = 25;
        stuckTimer = 0;
        // Choose perpendicular direction to current heading for better unsticking
        const toTarget = target.sub(entity.pos).norm();
        const perpendicular = Math.random() > 0.5
            ? new Vector(-toTarget.y, toTarget.x)
            : new Vector(toTarget.y, -toTarget.x);
        unstuckDir = perpendicular;
        // Force path recalculation after unstuck
        path = null;
        pathIdx = 0;
    }

    if (unstuckTimer > 0 && unstuckDir) {
        return {
            ...entity,
            movement: {
                ...entity.movement,
                vel: unstuckDir.scale(speed * 0.8),
                stuckTimer: 0,
                unstuckTimer: unstuckTimer - 1,
                unstuckDir: unstuckDir,
                avgVel: avgVel,
                path: null, // Clear path during unstuck
                pathIdx: 0,
                finalDest
            }
        };
    }

    // Normal Movement with Steering
    const dir = immediateTarget.sub(entity.pos).norm();
    let separation = new Vector(0, 0);
    let entityCount = 0;

    // Entity Separation - use spatial grid for O(k) instead of O(n) lookup
    // Query radius covers entity.radius + max_other_radius + 3, using 60 as conservative max
    const nearbyEntities = getSpatialGrid().queryRadius(entity.pos.x, entity.pos.y, 60);
    for (const other of nearbyEntities) {
        if (other.id === entity.id || other.dead || other.type === 'RESOURCE') continue;
        const d = entity.pos.dist(other.pos);
        const minDist = entity.radius + other.radius;

        if (d < minDist + 3 && d > 0.001) {
            // Weight separation by how close the entities are
            const weight = (minDist + 3 - d) / (minDist + 3);
            separation = separation.add(entity.pos.sub(other.pos).norm().scale(weight));
            entityCount++;
        }
    }

    // Static Collision Avoidance (Whiskers) - weaker when we have a valid A* path
    // Skip entirely when explicitly requested (e.g., harvesters close to dock)
    const hasValidPath = path && path.length > 0;
    let avoidance = new Vector(0, 0);

    if (!skipWhiskerAvoidance) {
        const angles = hasValidPath ? [0, 0.3, -0.3] : [0, 0.4, -0.4, 0.8, -0.8];

        for (const a of angles) {
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            const wx = dir.x * cos - dir.y * sin;
            const wy = dir.x * sin + dir.y * cos;
            const whisker = new Vector(wx, wy).norm();

            const checkDist = entity.radius + (hasValidPath ? 10 : 15);
            const checkPos = entity.pos.add(whisker.scale(checkDist));

            const gx = Math.floor(checkPos.x / TILE_SIZE);
            const gy = Math.floor(checkPos.y / TILE_SIZE);

            if (gx >= 0 && gx < getGridW() && gy >= 0 && gy < getGridH()) {
                if (collisionGrid[gy * getGridW() + gx] === 1) {
                    // Reduced avoidance when we have a path (path already handles navigation)
                    const baseWeight = hasValidPath ? 1.0 : 2.5;
                    const weight = a === 0 ? baseWeight : baseWeight * 0.6;
                    avoidance = avoidance.sub(whisker.scale(weight));
                }
            }
        }
    }

    let finalDir = dir;
    if (entityCount > 0 || avoidance.mag() > 0.001) {
        // Keep-right bias for head-on situations
        const right = new Vector(-dir.y, dir.x);
        const rightBias = entityCount > 0 ? 0.4 : 0;

        // Increase separation weight to be more effective
        finalDir = dir.add(separation.scale(0.8)).add(avoidance).add(right.scale(rightBias)).norm();

        // CRITICAL: Prevent avoidance from completely reversing movement direction
        // If finalDir points backward (>90° from intended), clamp to perpendicular
        // This prevents units from spinning when blocked by buildings ahead
        const dotProduct = finalDir.dot(dir);
        if (dotProduct < 0) {
            // finalDir is pointing backward - project onto perpendicular plane
            // Use the right vector as the fallback direction
            const perpendicular = right.scale(finalDir.dot(right) >= 0 ? 1 : -1);
            finalDir = perpendicular;
        }
    }

    // Smoothing
    // Blend with previous velocity to prevent jitter (zigzagging)
    // 0.6 old + 0.4 new provides good responsiveness while damping high-frequency oscillation
    let newVel = finalDir.scale(speed);
    if (entity.movement.vel.mag() > 0.1 && newVel.mag() > 0.1) {
        const blended = entity.movement.vel.scale(0.6).add(newVel.scale(0.4));
        if (blended.mag() > 0.01) {
            newVel = blended.norm().scale(speed);
        }
    }

    return {
        ...entity,
        movement: {
            ...entity.movement,
            vel: newVel,
            stuckTimer,
            unstuckTimer: 0,
            unstuckDir: null,
            avgVel,
            path,
            pathIdx,
            finalDest
        }
    };
}


function createProjectile(source: Entity, target: Entity): Projectile {
    const data = getRuleData(source.key);
    const weaponType = data?.weaponType || 'bullet';
    const isRocket = weaponType === 'rocket' || weaponType === 'missile' || weaponType === 'heavy_cannon';
    const speed = isRocket ? 9 : 18;

    return {
        ownerId: source.id,
        pos: source.pos,
        vel: target.pos.sub(source.pos).norm().scale(speed),
        targetId: target.id,
        speed: speed,
        damage: data?.damage || 10,
        splash: (data && isUnitData(data)) ? (data.splash || 0) : 0,
        type: weaponType,
        weaponType: weaponType,
        dead: false
    };
}

/**
 * Update ore wells - spawn new ore around wells and grow existing ore.
 */
function updateWells(
    entities: Record<EntityId, Entity>,
    tick: number,
    config: MapConfig
): Record<EntityId, Entity> {
    const wellConfig = RULES.wells?.well;
    if (!wellConfig) return entities;

    let nextEntities = { ...entities };

    // Process each well
    for (const id in nextEntities) {
        const entity = nextEntities[id];
        if (entity.type !== 'WELL' || entity.dead) continue;

        const well = entity as WellEntity;

        // Group nearby ores
        const nearbyOres: ResourceEntity[] = [];
        const fillableOres: ResourceEntity[] = [];

        for (const otherId in nextEntities) {
            const other = nextEntities[otherId];
            if (other.type === 'RESOURCE' && !other.dead) {
                if (well.pos.dist(other.pos) <= wellConfig.oreSpawnRadius) {
                    nearbyOres.push(other as ResourceEntity);
                    if (other.hp < other.maxHp) {
                        fillableOres.push(other as ResourceEntity);
                    }
                }
            }
        }

        // Logic: Grow one fillable ore if exists, otherwise try to spawn
        if (fillableOres.length > 0) {
            // Pick one to grow (first one found)
            const targetOre = fillableOres[0];

            // Only update if we haven't already updated this ore this tick (e.g. from another well)
            // But nextEntities is a copy, so updating it here is fine. 
            // If an ore is near two wells, it might get updated twice. 
            // Let's accept that rare double-growth for now as "bonus".
            // However, since we are iterating `nextEntities` (which is a copy), 
            // if we modify `nextEntities[targetOre.id]`, the next well will see the MODIFIED ore.
            // If the next well also picks it, it will grow again. This is acceptable.

            nextEntities[targetOre.id] = {
                ...targetOre,
                hp: Math.min(targetOre.maxHp, targetOre.hp + wellConfig.oreGrowthRate)
            };

            // Update well tracking - well is actively growing, so not blocked
            nextEntities[id] = {
                ...well,
                well: {
                    ...well.well,
                    currentOreCount: nearbyOres.length,
                    isBlocked: false
                }
            };

        } else {
            // Check if should spawn new ore
            const shouldSpawn = tick >= well.well.nextSpawnTick &&
                nearbyOres.length < wellConfig.maxOrePerWell;

            if (shouldSpawn) {
                // Try to find a valid spawn position (avoid units and buildings)
                const oreRadius = 12;
                const maxAttempts = 8;
                let foundValidPosition = false;
                let finalX = 0;
                let finalY = 0;

                // Pre-collect units and buildings for collision checks
                const blockers: { pos: Vector; radius: number }[] = [];
                for (const otherId in nextEntities) {
                    const other = nextEntities[otherId];
                    if (other.dead) continue;
                    if (other.type === 'UNIT' || other.type === 'BUILDING') {
                        blockers.push({ pos: other.pos, radius: other.radius });
                    }
                }

                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    // Try evenly distributed angles with some randomness
                    const baseAngle = (attempt / maxAttempts) * Math.PI * 2;
                    const angle = baseAngle + (Math.random() - 0.5) * (Math.PI / maxAttempts);
                    const dist = 30 + Math.random() * (wellConfig.oreSpawnRadius - 30);
                    const spawnX = well.pos.x + Math.cos(angle) * dist;
                    const spawnY = well.pos.y + Math.sin(angle) * dist;

                    // Clamp to map bounds
                    const testX = Math.max(50, Math.min(config.width - 50, spawnX));
                    const testY = Math.max(50, Math.min(config.height - 50, spawnY));
                    const testPos = new Vector(testX, testY);

                    // Check collision with all units and buildings
                    let collides = false;
                    for (const blocker of blockers) {
                        const dist = testPos.dist(blocker.pos);
                        if (dist < oreRadius + blocker.radius) {
                            collides = true;
                            break;
                        }
                    }

                    if (!collides) {
                        foundValidPosition = true;
                        finalX = testX;
                        finalY = testY;
                        break;
                    }
                }

                if (foundValidPosition) {
                    // Create new ore entity
                    const oreId = `ore_well_${id}_${tick}`;
                    const newOre: ResourceEntity = {
                        id: oreId,
                        owner: -1,
                        type: 'RESOURCE',
                        key: 'ore',
                        pos: new Vector(finalX, finalY),
                        prevPos: new Vector(finalX, finalY),
                        hp: wellConfig.initialOreAmount,
                        maxHp: wellConfig.maxOreAmount,
                        w: 25,
                        h: 25,
                        radius: oreRadius,
                        dead: false
                    };
                    nextEntities[oreId] = newOre;

                    // Calculate next spawn tick (random interval)
                    const nextSpawnDelay = wellConfig.spawnRateTicksMin +
                        Math.random() * (wellConfig.spawnRateTicksMax - wellConfig.spawnRateTicksMin);

                    // Update well state - successfully spawned, not blocked
                    nextEntities[id] = {
                        ...well,
                        well: {
                            ...well.well,
                            nextSpawnTick: tick + nextSpawnDelay,
                            currentOreCount: nearbyOres.length + 1,
                            totalSpawned: well.well.totalSpawned + 1,
                            isBlocked: false
                        }
                    };
                } else {
                    // No valid spawn position found - mark well as blocked
                    nextEntities[id] = {
                        ...well,
                        well: {
                            ...well.well,
                            currentOreCount: nearbyOres.length,
                            isBlocked: true
                        }
                    };
                }
            } else {
                // Not time to spawn yet or at max ore - check if still blocked
                // If we're at max ore, not blocked. If not time yet, preserve previous blocked state.
                const isAtMaxOre = nearbyOres.length >= wellConfig.maxOrePerWell;
                nextEntities[id] = {
                    ...well,
                    well: {
                        ...well.well,
                        currentOreCount: nearbyOres.length,
                        isBlocked: isAtMaxOre ? false : well.well.isBlocked
                    }
                };
            }
        }
    }

    return nextEntities;
}

export function createEntity(x: number, y: number, owner: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE', key: string, state: GameState): Entity {
    const id = 'e_' + state.tick + '_' + Math.floor(Math.random() * 100000);

    const data = getRuleData(key);
    const isResource = type === 'RESOURCE';

    // Resource entities have fixed stats, others use rules data
    const hp = isResource ? 1000 : (data?.hp || 100);
    const w = isResource ? 25 : (data?.w || 20);
    const h = isResource ? 25 : ((data && isBuildingData(data)) ? data.h : (data?.w || 20));

    const baseProps = {
        id,
        owner,
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp,
        maxHp: hp,
        w,
        h,
        radius: w / 2,
        dead: false
    };

    if (type === 'UNIT') {
        if (key === 'harvester') {
            return {
                ...baseProps,
                type: 'UNIT' as const,
                key: 'harvester' as const,
                movement: createDefaultMovement(),
                combat: createDefaultCombat(),
                harvester: createDefaultHarvester()
            };
        } else {
            return {
                ...baseProps,
                type: 'UNIT' as const,
                key: key as Exclude<UnitKey, 'harvester'>,
                movement: createDefaultMovement(),
                combat: createDefaultCombat(),
                engineer: key === 'engineer' ? { captureTargetId: null, repairTargetId: null } : undefined
            };
        }
    } else if (type === 'BUILDING') {
        const isDefense = ['turret', 'sam_site', 'pillbox', 'obelisk'].includes(key);
        return {
            ...baseProps,
            type: 'BUILDING' as const,
            key: key as BuildingKey,
            combat: isDefense ? createDefaultCombat() : undefined,
            building: {
                ...createDefaultBuildingState(),
                placedTick: state.tick
            }
        };
    } else {
        // RESOURCE
        return {
            ...baseProps,
            type: 'RESOURCE' as const,
            key: 'ore' as const
        };
    }
}

function killPlayerEntities(entities: Record<EntityId, Entity>, playerId: number): Record<EntityId, Entity> {
    const nextEntities = { ...entities };
    for (const id in nextEntities) {
        const ent = nextEntities[id];
        if (ent.owner === playerId && !ent.dead) {
            if (ent.type === 'UNIT') {
                nextEntities[id] = {
                    ...ent,
                    dead: true,
                    hp: 0,
                    combat: { ...ent.combat, flash: 10 }
                };
            } else if (ent.type === 'BUILDING' && ent.combat) {
                nextEntities[id] = {
                    ...ent,
                    dead: true,
                    hp: 0,
                    combat: { ...ent.combat, flash: 10 }
                };
            } else {
                nextEntities[id] = { ...ent, dead: true, hp: 0 };
            }
        }
    }
    return nextEntities;
}

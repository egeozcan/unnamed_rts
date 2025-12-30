import { Action, GameState, Entity, EntityId, PlayerState, Vector, TILE_SIZE, PLAYER_COLORS } from './types.js';
import { RULES } from '../data/schemas/index.js';
import { collisionGrid, refreshCollisionGrid, findPath, getGridW, getGridH } from './utils.js';
import { rebuildSpatialGrid } from './spatial.js';

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
    showMinimap: true
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
            building: { current: null, progress: 0, invested: 0 },
            infantry: { current: null, progress: 0, invested: 0 },
            vehicle: { current: null, progress: 0, invested: 0 },
            air: { current: null, progress: 0, invested: 0 }
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
        default:
            return state;
    }
}

function tick(state: GameState): GameState {
    if (!state.running) return state;

    const nextTick = state.tick + 1;
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
    let nextProjectiles: any[] = [];
    let damageEvents: any[] = [];

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
            updatedEntities[d.targetId] = {
                ...ent,
                hp: nextHp,
                dead: nextHp <= 0,
                flash: 5,
                lastAttackerId: d.attackerId,
                lastDamageTick: state.tick
            };
        }
    }

    // Process Building Repairs
    const repairCostPercentage = RULES.economy?.repairCostPercentage || 0.3;
    const repairDurationTicks = 600; // Same as build time - 10 seconds at 60fps

    for (const id in updatedEntities) {
        const ent = updatedEntities[id];
        if (ent.type === 'BUILDING' && ent.isRepairing && !ent.dead) {
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

                // Heal building
                const newHp = Math.min(ent.maxHp, ent.hp + hpToHeal);
                const isFullHp = newHp >= ent.maxHp;

                updatedEntities[id] = {
                    ...ent,
                    hp: newHp,
                    flash: 3, // Flash while repairing
                    isRepairing: !isFullHp // Auto-stop when full
                };
            } else {
                // No credits - stop repairing
                updatedEntities[id] = {
                    ...ent,
                    isRepairing: false
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
        running: nextRunning
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

    // Calculate power
    const power = calculatePower(player.id, entities);
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

                    nextPlayer = {
                        ...nextPlayer,
                        queues: {
                            ...nextPlayer.queues,
                            [cat]: { current: null, progress: 0, invested: 0 }
                        }
                    };
                }
            }
        }
        // When credits are 0, production simply pauses (no change to queue)
    }
    return { player: nextPlayer, createdEntities };
}

function calculatePower(playerId: number, entities: Record<EntityId, Entity>): { in: number, out: number } {
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
    return p;
}

function getRuleData(key: string): any {
    if (RULES.buildings[key]) return RULES.buildings[key];
    if (RULES.units[key]) return RULES.units[key];
    return null;
}

function startBuild(state: GameState, payload: { category: string; key: string; playerId: number }): GameState {
    const { category, key, playerId } = payload;
    const player = state.players[playerId];
    if (!player) return state;

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
                    [category]: { current: key, progress: 0, invested: 0 }
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

    if (category === 'building' && player.readyToPlace) {
        const data = RULES.buildings[player.readyToPlace];
        if (data) refund = data.cost;
        newReadyToPlace = null;
    } else if (newQueue.current) {
        const data = getRuleData(newQueue.current);
        if (data) {
            // Refund the actual invested credits
            refund = newQueue.invested || 0;
        }
        newQueue = { current: null, progress: 0, invested: 0 };
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
        }
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
        const harv = createEntity(x, y + 50, playerId, 'UNIT', 'harvester', state);
        // Harvesters spawned by refineries should auto-harvest immediately
        (harv as any).manualMode = false;
        extraEntities[harv.id] = harv;
    }

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
        placingBuilding: null
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
    if (building.isRepairing) {
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
                isRepairing: true
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

    if (!building.isRepairing) {
        return state;
    }

    return {
        ...state,
        entities: {
            ...state.entities,
            [buildingId]: {
                ...building,
                isRepairing: false
            }
        }
    };
}

function commandMove(state: GameState, payload: { unitIds: EntityId[]; x: number; y: number }): GameState {
    const { unitIds, x, y } = payload;
    const target = new Vector(x, y);

    let nextEntities = { ...state.entities };
    for (const id of unitIds) {
        const entity = nextEntities[id];
        if (entity && entity.owner !== -1 && entity.type === 'UNIT') {
            const updates: Partial<Entity> = {
                moveTarget: target,
                targetId: null,
                path: null
            };

            // If it's a harvester, clear its harvesting targets and enable manual mode
            // Harvesters in manual mode won't auto-acquire resources until explicitly tasked
            if (entity.key === 'harvester') {
                (updates as any).resourceTargetId = null;
                (updates as any).baseTargetId = null;
                (updates as any).manualMode = true; // Stop auto-harvesting
            }

            nextEntities[id] = {
                ...entity,
                ...updates
            } as Entity;
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
                        resourceTargetId: targetId,
                        baseTargetId: null,
                        moveTarget: null,
                        path: null,
                        manualMode: false  // Enable auto-harvesting
                    } as Entity;
                } else if (target.key === 'refinery' && target.owner === entity.owner) {
                    // Right-click on own refinery: enable auto-harvesting and go dock
                    nextEntities[id] = {
                        ...entity,
                        baseTargetId: targetId,
                        moveTarget: null,
                        path: null,
                        manualMode: false  // Enable auto-harvesting
                    } as Entity;
                } else {
                    // Harvesters can't attack other things, treat as move
                    nextEntities[id] = {
                        ...entity,
                        moveTarget: target.pos,
                        targetId: null,
                        path: null
                    };
                }
            } else {
                // Normal combat unit attack behavior
                nextEntities[id] = {
                    ...entity,
                    targetId: targetId,
                    moveTarget: null,
                    path: null
                };
            }
        }
    }
    return { ...state, entities: nextEntities };
}

function updateEntities(state: GameState): { entities: Record<EntityId, Entity>, projectiles: any[], particles: any[], creditsEarned: Record<number, number> } {
    let nextEntities = { ...state.entities };
    let newProjectiles: any[] = [];
    let newParticles: any[] = [];
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
            const res = updateUnit(entity, state.entities, entityList, state.config);
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
            const ent = nextEntities[id];
            if ((ent as any).captureTargetId) {
                const targetId = (ent as any).captureTargetId;
                const target = nextEntities[targetId];
                if (target && target.type === 'BUILDING') {
                    nextEntities[targetId] = { ...target, owner: ent.owner, flash: 30 };
                    nextEntities[id] = { ...ent, dead: true, captureTargetId: null };
                }
            } else if ((ent as any).repairTargetId) {
                const targetId = (ent as any).repairTargetId;
                const target = nextEntities[targetId];
                if (target && target.type === 'BUILDING' && target.hp < target.maxHp) {
                    const repairAmount = 20; // Repair strength
                    nextEntities[targetId] = {
                        ...target,
                        hp: Math.min(target.maxHp, target.hp + repairAmount),
                        flash: 5
                    };
                    nextEntities[id] = { ...ent, repairTargetId: null };
                }
            }
        } else if (entity.type === 'BUILDING') {
            const res = updateBuilding(entity, state.entities, entityList);
            nextEntities[id] = res.entity;
            if (res.projectile) newProjectiles.push(res.projectile);
        }

        let ent = nextEntities[id];
        if (ent.vel.mag() > 0) {
            ent = { ...ent, prevPos: ent.pos, pos: ent.pos.add(ent.vel) };
            const data = getRuleData(ent.key);
            if (data && !data.fly) {
                // Smooth rotation
                const targetRot = Math.atan2(ent.vel.y, ent.vel.x);
                let diff = targetRot - ent.rotation;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                // Faster turn if moving fast? Or constant turn rate?
                // 0.2 is good for responsiveness without jitter
                let newRotation = ent.rotation + diff * 0.2;
                // Normalize rotation to [-PI, PI] to prevent unbounded growth
                while (newRotation > Math.PI) newRotation -= Math.PI * 2;
                while (newRotation < -Math.PI) newRotation += Math.PI * 2;
                ent = { ...ent, rotation: newRotation };
            }
            ent = { ...ent, vel: new Vector(0, 0) };
            nextEntities[id] = ent;
        }

        if (ent.cooldown > 0) nextEntities[id] = { ...ent, cooldown: ent.cooldown - 1 };
        if (ent.flash > 0) nextEntities[id] = { ...ent, flash: ent.flash - 1 };

        // Update turret angle to track target
        ent = nextEntities[id];
        if (ent.targetId) {
            const target = nextEntities[ent.targetId];
            if (target && !target.dead) {
                const deltaX = target.pos.x - ent.pos.x;
                const deltaY = target.pos.y - ent.pos.y;
                const targetTurretAngle = Math.atan2(deltaY, deltaX);

                // Smooth turret rotation (faster than body rotation for responsive aiming)
                let angleDiff = targetTurretAngle - ent.turretAngle;
                while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                // Turret turn speed (0.25 = responsive but smooth)
                const newTurretAngle = ent.turretAngle + angleDiff * 0.25;
                nextEntities[id] = { ...ent, turretAngle: newTurretAngle };
            }
        }
    }

    // Resolve Hard Collisions
    nextEntities = resolveCollisions(nextEntities);

    return { entities: nextEntities, projectiles: newProjectiles, particles: newParticles, creditsEarned };
}

function resolveCollisions(entities: Record<EntityId, Entity>): Record<EntityId, Entity> {
    const ids = Object.keys(entities);
    // Create a mutable list of working copies
    const workingEntities = ids.map(id => ({ ...entities[id] }));
    const iterations = 4; // Run a few passes for stability

    for (let k = 0; k < iterations; k++) {
        for (let i = 0; i < workingEntities.length; i++) {
            const a = workingEntities[i];
            if (a.dead) continue;

            for (let j = i + 1; j < workingEntities.length; j++) {
                const b = workingEntities[j];
                if (b.dead) continue;

                const isUnitA = a.type === 'UNIT';
                const isUnitB = b.type === 'UNIT';

                if (!isUnitA && !isUnitB) continue; // Static vs Static

                const dist = a.pos.dist(b.pos);
                // Allow slight soft overlap to reduce jittering
                const softOverlap = 2;
                const minDist = a.radius + b.radius - softOverlap;

                if (dist < minDist && dist > 0.001) {
                    const overlap = minDist - dist;
                    const dir = b.pos.sub(a.pos).norm();

                    if (isUnitA && isUnitB) {
                        // Determine which unit is moving vs stationary
                        const aMoving = a.moveTarget !== null || a.targetId !== null || (a.vel && a.vel.mag() > 0.5);
                        const bMoving = b.moveTarget !== null || b.targetId !== null || (b.vel && b.vel.mag() > 0.5);

                        let ratioA = 0.5;
                        let ratioB = 0.5;

                        // Use stronger push to counteract movement speed
                        const pushScale = Math.min(overlap, 2.5);

                        if (aMoving && !bMoving) {
                            // A is moving, B is stationary - A yields more
                            ratioA = 0.8;
                            ratioB = 0.2;
                            const push = dir.scale(pushScale);
                            a.pos = a.pos.sub(push.scale(ratioA));
                            b.pos = b.pos.add(push.scale(ratioB));
                        } else if (bMoving && !aMoving) {
                            // B is moving, A is stationary - B yields more
                            ratioA = 0.2;
                            ratioB = 0.8;
                            const push = dir.scale(pushScale);
                            a.pos = a.pos.sub(push.scale(ratioA));
                            b.pos = b.pos.add(push.scale(ratioB));
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
                            ratioA = b.radius / totalR;
                            ratioB = a.radius / totalR;
                            const push = dir.scale(pushScale * 0.5); // Half strength for stationary
                            a.pos = a.pos.sub(push.scale(ratioA));
                            b.pos = b.pos.add(push.scale(ratioB));
                        }
                    } else if (isUnitA) {
                        // A is unit, B is building/resource - A yields completely
                        a.pos = a.pos.sub(dir.scale(overlap));
                    } else if (isUnitB) {
                        // B is unit, A is building/resource - B yields completely
                        b.pos = b.pos.add(dir.scale(overlap));
                    }
                }
            }
        }
    }

    // Reconstruct lookup
    const result: Record<EntityId, Entity> = {};
    workingEntities.forEach(e => {
        result[e.id] = e;
    });
    return result;
}


function updateUnit(entity: Entity, allEntities: Record<EntityId, Entity>, entityList: Entity[], mapConfig: { width: number, height: number }): { entity: Entity, projectile?: any, creditsEarned: number, resourceDamage?: { id: string, amount: number } | null } {
    let nextEntity = { ...entity };
    const data = getRuleData(nextEntity.key);
    let projectile = null;
    let creditsEarned = 0;

    let resourceDamage: { id: string, amount: number } | null = null;

    // Harvester Logic
    if (nextEntity.key === 'harvester') {
        const harvester = nextEntity;
        const capacity = 500;

        // 0. If manual move (flee/player command), skip automated logic
        // BUT: If harvester has full cargo, ALWAYS clear moveTarget so it can go unload
        // This fixes the "dancing" bug where harvesters flee to safety but then can't return
        // to base because they keep trying to reach the flee destination
        if (harvester.moveTarget) {
            if (harvester.cargo >= capacity) {
                // Full cargo - clear flee target immediately so harvester can go unload
                // Don't wait for stuckTimer - harvesters with full cargo should prioritize unloading
                nextEntity = { ...harvester, moveTarget: null, path: null, pathIdx: 0 };
            }
            // Otherwise, fall through to generic move logic (allow fleeing with low cargo)
        }
        // 1. If full, return to refinery
        else if (harvester.cargo >= capacity) {
            harvester.resourceTargetId = null; // Forget resource
            if (!harvester.baseTargetId) {
                // Find nearest refinery
                let bestRef: Entity | null = null;
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
                if (bestRef) harvester.baseTargetId = bestRef.id;
            }

            if (harvester.baseTargetId) {
                const ref = allEntities[harvester.baseTargetId];
                if (ref && !ref.dead) {
                    // Target "Docking Point" (bottom of refinery)
                    // Clamp dock position to map bounds to prevent pathfinding issues
                    const rawDockPos = ref.pos.add(new Vector(0, 60));
                    const dockPos = new Vector(
                        Math.max(0, Math.min(mapConfig.width - 1, rawDockPos.x)),
                        Math.max(0, Math.min(mapConfig.height - 1, rawDockPos.y))
                    );
                    const ourDist = harvester.pos.dist(dockPos);

                    // Check if another harvester is ahead of us in the queue
                    let positionInQueue = 0; // 0 = first in line
                    for (const other of entityList) {
                        if (other.id !== harvester.id &&
                            other.key === 'harvester' &&
                            other.owner === harvester.owner &&
                            !other.dead &&
                            (other as any).cargo > 0 && // Only count harvesters with cargo (wanting to dock)
                            (other as any).baseTargetId === harvester.baseTargetId && // Only count harvesters targeting SAME refinery
                            other.moveTarget === null) { // Ignore harvesters with player move override
                            const otherDist = other.pos.dist(dockPos);
                            // If another harvester is closer to the dock
                            if (otherDist < ourDist) {
                                positionInQueue++;
                            }
                        }
                    }


                    if (ourDist < 20 && positionInQueue === 0) {
                        // We're at dock and first in line - Unload
                        nextEntity = { ...harvester, cargo: 0, baseTargetId: null };
                        creditsEarned = 500;
                    } else if (positionInQueue > 0 && ourDist < 80) {
                        // Someone is ahead of us and we're near dock - wait stationary
                        // Explicitly set velocity to zero
                        nextEntity = { ...harvester, vel: new Vector(0, 0) };
                    } else if (positionInQueue > 2 && ourDist < 200) {
                        // Far back in queue (3rd or later) and getting close - slow down/wait
                        // This prevents traffic jams from harvesters all rushing to the same waypoint
                        nextEntity = { ...harvester, vel: new Vector(0, 0) };
                    } else {
                        // Move toward dock
                        nextEntity = moveToward(harvester, dockPos, entityList);
                    }
                } else {
                    nextEntity = { ...harvester, baseTargetId: null }; // Refinery died
                }
            }
        }
        // 2. If valid resource target, go gather
        else {
            // Only auto-acquire resources if NOT in manual mode
            // Harvesters start in manual mode by default (manualMode is undefined or true)
            // They enter auto mode (manualMode = false) when right-clicking ore/refinery
            const isManualMode = (harvester as any).manualMode !== false;
            if (!harvester.resourceTargetId && !isManualMode) {
                // Find best ore considering:
                // 1. Distance (prefer closer)
                // 2. Congestion (prefer ores with fewer harvesters, max 2 per ore)
                const blockedOreId = (harvester as any).blockedOreId;
                const MAX_HARVESTERS_PER_ORE = 2;

                // First, count harvesters per ore
                const harvestersPerOre: Record<string, number> = {};
                for (const other of entityList) {
                    if (other.key === 'harvester' &&
                        other.owner === harvester.owner &&
                        !other.dead &&
                        other.id !== harvester.id &&
                        other.resourceTargetId) {
                        harvestersPerOre[other.resourceTargetId] = (harvestersPerOre[other.resourceTargetId] || 0) + 1;
                    }
                }

                let bestOre: Entity | null = null;
                let bestScore = -Infinity;

                for (const other of entityList) {
                    if (other.type === 'RESOURCE' && !other.dead && other.id !== blockedOreId) {
                        const dist = harvester.pos.dist(other.pos);
                        const harvestersAtOre = harvestersPerOre[other.id] || 0;

                        // Skip if already at max capacity
                        if (harvestersAtOre >= MAX_HARVESTERS_PER_ORE) continue;

                        // Score: closer is better, fewer harvesters is better
                        // Congestion penalty: each existing harvester is like 100 extra distance
                        const effectiveDist = dist + harvestersAtOre * 100;
                        const score = -effectiveDist; // Higher is better (less distance = higher score)

                        if (score > bestScore) {
                            bestScore = score;
                            bestOre = other;
                        }
                    }
                }

                // Fallback: if all ore is congested, still pick the nearest one
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

                if (bestOre) harvester.resourceTargetId = bestOre.id;
            }

            if (harvester.resourceTargetId) {
                const ore = allEntities[harvester.resourceTargetId];
                if (ore && !ore.dead) {
                    const distToOre = harvester.pos.dist(ore.pos);

                    // Track how long we've been trying to reach this ore
                    const harvestAttemptTicks = (harvester as any).harvestAttemptTicks || 0;

                    // Decay blocked ore timer
                    const blockedOreTimer = ((harvester as any).blockedOreTimer || 0);
                    if (blockedOreTimer > 0) {
                        nextEntity = { ...harvester, blockedOreTimer: blockedOreTimer - 1 } as any;
                        if (blockedOreTimer <= 1) {
                            // Clear blocked ore after timer expires (allow retry)
                            nextEntity = { ...nextEntity, blockedOreId: null } as any;
                        }
                    }

                    if (distToOre < 40) {
                        // Harvest
                        if (harvester.cooldown <= 0) {
                            const harvestAmount = 25;
                            // Check if ore has enough
                            const actualHarvest = Math.min(harvestAmount, ore.hp);

                            nextEntity = {
                                ...harvester,
                                cargo: harvester.cargo + actualHarvest,
                                cooldown: 30,
                                harvestAttemptTicks: 0 // Reset on successful harvest
                            } as any;
                            resourceDamage = { id: ore.id, amount: actualHarvest };
                        }
                    } else {
                        // Still far from ore - track progress toward it
                        const prevLastDist = (harvester as any).lastDistToOre;
                        const lastDistToOre = prevLastDist ?? distToOre;
                        const prevBestDist = (harvester as any).bestDistToOre;
                        const bestDistToOre = prevBestDist ?? distToOre;

                        // First tick = initialize, else check for 10px progress from LAST tracking point
                        const madeProgress = (prevLastDist === undefined) || (distToOre < lastDistToOre - 10);
                        // Track minimum distance ever achieved
                        const newBestDist = Math.min(bestDistToOre, distToOre);

                        // Check for congestion - is another friendly harvester closer to this ore?
                        let positionInQueue = 0;
                        let blockedByFriendly = false;
                        for (const other of entityList) {
                            if (other.id !== harvester.id &&
                                other.key === 'harvester' &&
                                other.owner === harvester.owner &&
                                !other.dead &&
                                other.resourceTargetId === ore.id) {
                                const otherDistToOre = other.pos.dist(ore.pos);
                                if (otherDistToOre < distToOre) {
                                    positionInQueue++;
                                    // Check if this other harvester is very close to us (blocking)
                                    const distToOther = harvester.pos.dist(other.pos);
                                    if (distToOther < 50) {
                                        blockedByFriendly = true;
                                    }
                                }
                            }
                        }

                        // If blocked by a friendly harvester and not making progress, switch to different ore
                        if (blockedByFriendly && harvestAttemptTicks > 15) {
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
                                        if (h.key === 'harvester' && h.owner === harvester.owner && !h.dead && h.resourceTargetId === other.id) {
                                            harvestersAtOre++;
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
                                    resourceTargetId: altOre.id,
                                    path: null,
                                    pathIdx: 0,
                                    harvestAttemptTicks: 0,
                                    lastDistToOre: null,
                                    bestDistToOre: null
                                } as any;
                            } else {
                                // No alternative ore - wait in queue
                                nextEntity = { ...harvester, vel: new Vector(0, 0) };
                            }
                        } else if (harvestAttemptTicks > 30 && distToOre > 43) {
                            // Give up on this ore after being stuck
                            // Blocked (by building): best distance is far (> 55px, can't get close)
                            // Congested (by units): best distance is close (< 55px, ore is reachable)
                            const isBlocked = newBestDist > 55;
                            nextEntity = {
                                ...harvester,
                                resourceTargetId: null,
                                stuckTimer: 0,
                                path: null,
                                pathIdx: 0,
                                harvestAttemptTicks: 0,
                                lastDistToOre: null,
                                bestDistToOre: null,
                                blockedOreId: isBlocked ? ore.id : (harvester as any).blockedOreId,
                                blockedOreTimer: isBlocked ? 500 : (harvester as any).blockedOreTimer
                            } as any;
                        } else {
                            // Keep trying - move toward ore
                            nextEntity = moveToward(harvester, ore.pos, entityList);

                            if (madeProgress) {
                                // Making progress - reset counter, update tracking points
                                nextEntity = {
                                    ...nextEntity,
                                    harvestAttemptTicks: 0,
                                    lastDistToOre: distToOre,
                                    bestDistToOre: newBestDist
                                } as any;
                            } else {
                                // Not making progress - increment counter, preserve lastDistToOre
                                nextEntity = {
                                    ...nextEntity,
                                    harvestAttemptTicks: harvestAttemptTicks + 1,
                                    lastDistToOre: lastDistToOre,  // Preserve the last tracking point
                                    bestDistToOre: newBestDist
                                } as any;
                            }
                        }
                    }
                } else {
                    nextEntity = { ...harvester, resourceTargetId: null, harvestAttemptTicks: 0 } as any;
                }
            }
        }
    }

    // Existing generic unit logic (combat, movement) - ONLY if not harvesting?
    // Harvesters should flee or defend if attacked?
    // For now simple overwrite: If we did harvester logic and moved/acted, skip generic?
    // Or merge.
    // If harvester has `moveTarget` (manual command), that overrides harvest logic.
    if (!nextEntity.moveTarget && nextEntity.key === 'harvester') {
        // Skip generic combat/move logic if doing harvest things
        // But we want it to react to attacks?
        // Let's keep generic logic for `moveTarget` override.
    } else {
        // ... generic logic ...
        // We need to duplicate the generic logic block here or wrap it.
        // It's cleaner to keep the generic logic below, but `nextEntity` might have changed.
        // I will Paste the generic logic here too, but modified to check for harvester override.
    }

    // Original generic logic follows...
    // Generic logic calling block
    if (nextEntity.key !== 'harvester') {
        const isHealer = data.damage < 0;
        const isEngineer = data.canCaptureEnemyBuildings || data.canRepairFriendlyBuildings;

        // Only auto-acquire targets if unit doesn't have a pending move command
        // This allows players to retreat units that are auto-attacking
        if (!nextEntity.targetId && !nextEntity.moveTarget && (data.damage || isEngineer)) {
            const range = (data.range || 100) + (isHealer ? 100 : 50);
            let bestTargetId: EntityId | null = null;
            let bestDist = range;

            for (const other of entityList) {
                if (other.dead || other.owner === -1) continue;

                const d = nextEntity.pos.dist(other.pos);
                if (d < bestDist) {
                    if (isHealer) {
                        // Medic/Healer targets friendlies that need help
                        if (other.owner === nextEntity.owner && other.hp < other.maxHp && other.type === 'UNIT' && other.id !== nextEntity.id) {
                            bestDist = d;
                            bestTargetId = other.id;
                        }
                    } else if (isEngineer) {
                        // Engineer targets buildings
                        if (other.type === 'BUILDING') {
                            if (other.owner !== nextEntity.owner && data.canCaptureEnemyBuildings) {
                                bestDist = d;
                                bestTargetId = other.id;
                            } else if (other.owner === nextEntity.owner && other.hp < other.maxHp && data.canRepairFriendlyBuildings) {
                                bestDist = d;
                                bestTargetId = other.id;
                            }
                        }
                    } else {
                        // Normal combat targets enemies
                        if (other.owner !== nextEntity.owner) {
                            bestDist = d;
                            bestTargetId = other.id;
                        }
                    }
                }
            }
            if (bestTargetId) nextEntity = { ...nextEntity, targetId: bestTargetId };
        }

        if (nextEntity.targetId) {
            const target = allEntities[nextEntity.targetId];
            if (target && !target.dead) {
                const dist = nextEntity.pos.dist(target.pos);
                const range = data.range || 100;

                if (isEngineer && target.type === 'BUILDING') {
                    if (dist < 40) {
                        nextEntity = { ...nextEntity, moveTarget: null };
                        if (target.owner !== nextEntity.owner && data.canCaptureEnemyBuildings) {
                            // CAPTURE: Engineer consumed, building ownership transfers
                            (nextEntity as any).dead = true;
                            (nextEntity as any).captureTargetId = target.id;
                        } else if (target.owner === nextEntity.owner && data.canRepairFriendlyBuildings) {
                            // REPAIR: Engineer heals building over time
                            if (nextEntity.cooldown <= 0) {
                                (nextEntity as any).repairTargetId = target.id;
                                nextEntity = { ...nextEntity, cooldown: data.rate || 30 };
                            }
                        }
                    } else {
                        nextEntity = moveToward(nextEntity, target.pos, entityList);
                    }
                } else if (dist <= range) {
                    nextEntity = { ...nextEntity, moveTarget: null };
                    if (nextEntity.cooldown <= 0) {
                        projectile = createProjectile(nextEntity, target);
                        nextEntity = { ...nextEntity, cooldown: data.rate || 30 };
                    }
                } else {
                    nextEntity = moveToward(nextEntity, target.pos, entityList);
                }
            } else {
                nextEntity = { ...nextEntity, targetId: null };
            }
        } else if (nextEntity.moveTarget) {
            nextEntity = moveToward(nextEntity, nextEntity.moveTarget, entityList);
            if (nextEntity.pos.dist(nextEntity.moveTarget!) < 10) {
                nextEntity = { ...nextEntity, moveTarget: null };
            }
        }
    } else if (nextEntity.moveTarget) {
        // Manual move override for harvester (flee commands, player commands)
        nextEntity = moveToward(nextEntity, nextEntity.moveTarget, entityList);

        // Harvesters can clear moveTarget at a larger distance (30 units) than regular units (10 units)
        // This prevents the circling bug where multiple harvesters flee to the same area
        // and collide, unable to reach within 10 units of their target
        const clearDistance = 30;

        // Also check if harvester has been stuck trying to reach this moveTarget for too long
        // If stuck for more than 40 ticks, give up and resume normal harvesting behavior
        const harvesterFleeTimeout = 40;
        const isStuckOnFlee = (nextEntity.stuckTimer || 0) > harvesterFleeTimeout;

        if (nextEntity.pos.dist(nextEntity.moveTarget!) < clearDistance || isStuckOnFlee) {
            nextEntity = { ...nextEntity, moveTarget: null, path: null, pathIdx: 0, stuckTimer: 0 };
        }
    }

    return { entity: nextEntity, projectile, creditsEarned, resourceDamage };
}

function updateBuilding(entity: Entity, allEntities: Record<EntityId, Entity>, entityList: Entity[]): { entity: Entity, projectile?: any } {
    let nextEntity = { ...entity };
    const data = getRuleData(nextEntity.key);
    let projectile = null;

    if (data.isDefense) {
        if (!nextEntity.targetId) {
            const range = data.range || 200;
            let bestTargetId: EntityId | null = null;
            let targetIsAir = false;

            for (const other of entityList) {
                if (other.owner !== entity.owner && other.owner !== -1 && !other.dead) {
                    if (entity.pos.dist(other.pos) < range) {
                        const otherData = getRuleData(other.key);
                        const isAir = otherData?.fly === true;

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
                nextEntity = { ...nextEntity, targetId: bestTargetId };
            }
        }

        if (nextEntity.targetId) {
            const target = allEntities[nextEntity.targetId];
            if (target && !target.dead && entity.pos.dist(target.pos) <= (data.range || 200)) {
                if (nextEntity.cooldown <= 0) {
                    projectile = createProjectile(nextEntity, target);
                    nextEntity = { ...nextEntity, cooldown: data.rate || 30 };
                }
            } else {
                nextEntity = { ...nextEntity, targetId: null };
            }
        }
    }

    return { entity: nextEntity, projectile };
}

function updateProjectile(proj: any, entities: Record<EntityId, Entity>): { proj: any, damage?: { targetId: EntityId, amount: number, attackerId: number } } {
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

function moveToward(entity: Entity, target: Vector, allEntities: Entity[]): Entity {
    const distToTarget = entity.pos.dist(target);
    if (distToTarget < 2) return { ...entity, vel: new Vector(0, 0), path: null, pathIdx: 0 };

    const speed = getRuleData(entity.key)?.speed || 1;

    // Average velocity tracking for stuck detection
    let avgVel = entity.avgVel || new Vector(0, 0);
    const effectiveVel = entity.pos.sub(entity.prevPos);
    avgVel = avgVel.scale(0.9).add(effectiveVel.scale(0.1));

    let stuckTimer = entity.stuckTimer || 0;
    let unstuckDir = entity.unstuckDir;
    let unstuckTimer = entity.unstuckTimer || 0;
    let path = entity.path;
    let pathIdx = entity.pathIdx || 0;
    let finalDest = entity.finalDest;

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
            vel: unstuckDir.scale(speed * 0.8),
            stuckTimer: 0,
            unstuckTimer: unstuckTimer - 1,
            unstuckDir: unstuckDir,
            avgVel: avgVel,
            path: null, // Clear path during unstuck
            pathIdx: 0,
            finalDest
        };
    }

    // Normal Movement with Steering
    const dir = immediateTarget.sub(entity.pos).norm();
    let separation = new Vector(0, 0);
    let entityCount = 0;

    // Entity Separation - reduced force, only from very close entities
    for (const other of allEntities) {
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
    const hasValidPath = path && path.length > 0;
    const angles = hasValidPath ? [0, 0.3, -0.3] : [0, 0.4, -0.4, 0.8, -0.8];
    let avoidance = new Vector(0, 0);

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

    let finalDir = dir;
    if (entityCount > 0 || avoidance.mag() > 0.001) {
        // Keep-right bias for head-on situations
        const right = new Vector(-dir.y, dir.x);
        const rightBias = entityCount > 0 ? 0.4 : 0;

        // Increase separation weight to be more effective
        finalDir = dir.add(separation.scale(0.8)).add(avoidance).add(right.scale(rightBias)).norm();
    }

    // Smoothing
    // Blend with previous velocity to prevent jitter (zigzagging)
    // 0.6 old + 0.4 new provides good responsiveness while damping high-frequency oscillation
    let newVel = finalDir.scale(speed);
    if (entity.vel.mag() > 0.1 && newVel.mag() > 0.1) {
        const blended = entity.vel.scale(0.6).add(newVel.scale(0.4));
        if (blended.mag() > 0.01) {
            newVel = blended.norm().scale(speed);
        }
    }

    return {
        ...entity,
        vel: newVel,
        stuckTimer,
        unstuckTimer: 0,
        unstuckDir: null,
        avgVel,
        path,
        pathIdx,
        finalDest
    };
}


function createProjectile(source: Entity, target: Entity) {
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
        splash: data?.splash || 0,
        type: weaponType,
        weaponType: weaponType,
        dead: false
    };
}

export function createEntity(x: number, y: number, owner: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE', key: string, state: GameState): Entity {
    const id = 'e_' + state.tick + '_' + Math.floor(Math.random() * 100000);

    let data = getRuleData(key);
    if (type === 'RESOURCE') data = { hp: 1000, w: 25 };

    return {
        id,
        owner,
        type,
        key,
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp: data?.hp || 100,
        maxHp: data?.hp || 100,
        w: data?.w || 20,
        h: data?.h || data?.w || 20,
        radius: (data?.w || 20) / 2,
        dead: false,
        vel: new Vector(0, 0),
        rotation: 0,
        moveTarget: null,
        path: null,
        pathIdx: 0,
        finalDest: null,
        stuckTimer: 0,
        unstuckDir: null,
        unstuckTimer: 0,
        targetId: null,
        lastAttackerId: null,
        cooldown: 0,
        flash: 0,
        turretAngle: 0,
        cargo: 0,
        resourceTargetId: null,
        baseTargetId: null,
        dockPos: undefined,
        placedTick: type === 'BUILDING' ? state.tick : undefined
    };
}

function killPlayerEntities(entities: Record<EntityId, Entity>, playerId: number): Record<EntityId, Entity> {
    const nextEntities = { ...entities };
    for (const id in nextEntities) {
        if (nextEntities[id].owner === playerId && !nextEntities[id].dead) {
            nextEntities[id] = { ...nextEntities[id], dead: true, hp: 0, flash: 10 };
        }
    }
    return nextEntities;
}

import { Action, GameState, Entity, EntityId, PlayerState, Vector, TILE_SIZE, GRID_W, GRID_H } from './types.js';
import rules from '../data/rules.json';
import { collisionGrid, refreshCollisionGrid, findPath } from './utils.js';

// Type assertions for JSON data
const RULES = rules as any;

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
    players: {
        0: createPlayerState(0, false),
        1: createPlayerState(1, true)
    },
    config: { width: 3000, height: 3000 }
};

function createPlayerState(id: number, isAi: boolean): PlayerState {
    return {
        id,
        isAi,
        credits: isAi ? 10000 : 3000,
        maxPower: 0,
        usedPower: 0,
        queues: {
            building: { current: null, progress: 0 },
            infantry: { current: null, progress: 0 },
            vehicle: { current: null, progress: 0 },
            air: { current: null, progress: 0 }
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
                lastAttackerId: d.attackerId
            };
        }
    }

    // Filter dead entities
    const finalEntities: Record<EntityId, Entity> = {};
    for (const id in updatedEntities) {
        if (!updatedEntities[id].dead) {
            finalEntities[id] = updatedEntities[id];
        }
    }

    return {
        ...state,
        tick: nextTick,
        entities: finalEntities,
        players: nextPlayers,
        projectiles: nextProjectiles
    };
}

function updateProduction(player: PlayerState, entities: Record<EntityId, Entity>, state: GameState): { player: PlayerState, createdEntities: Entity[] } {
    let nextPlayer = { ...player, queues: { ...player.queues } };
    let createdEntities: Entity[] = [];

    // Calculate power
    const power = calculatePower(player.id, entities);
    const speedFactor = (power.out < power.in) ? 0.25 : 1.0;

    for (const key in nextPlayer.queues) {
        const cat = key as keyof typeof nextPlayer.queues;
        const q = nextPlayer.queues[cat];
        if (!q.current) continue;

        const data = getRuleData(q.current);
        if (!data) continue;

        const totalCost = data.cost;
        let speedMult = 1;

        const costPerTick = (totalCost / 600) * speedMult * speedFactor;

        if (nextPlayer.credits >= costPerTick) {
            nextPlayer = {
                ...nextPlayer,
                credits: nextPlayer.credits - costPerTick,
                queues: {
                    ...nextPlayer.queues,
                    [cat]: {
                        ...q,
                        progress: q.progress + (costPerTick / totalCost) * 100
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
                            [cat]: { current: null, progress: 0 }
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
                            [cat]: { current: null, progress: 0 }
                        }
                    };
                }
            }
        }
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

    return {
        ...state,
        players: {
            ...state.players,
            [playerId]: {
                ...player,
                queues: {
                    ...player.queues,
                    [category]: { current: key, progress: 0 }
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
            const paid = data.cost * (newQueue.progress / 100);
            refund = paid;
        }
        newQueue = { current: null, progress: 0 };
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

    const building = createEntity(x, y, playerId, 'BUILDING', key, state);

    let extraEntities: Record<EntityId, Entity> = {};
    if (key === 'refinery') {
        const harv = createEntity(x, y + 50, playerId, 'UNIT', 'harvester', state);
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

function commandMove(state: GameState, payload: { unitIds: EntityId[]; x: number; y: number }): GameState {
    const { unitIds, x, y } = payload;
    const target = new Vector(x, y);

    let nextEntities = { ...state.entities };
    for (const id of unitIds) {
        const entity = nextEntities[id];
        if (entity && entity.owner === 0 && entity.type === 'UNIT') {
            nextEntities[id] = {
                ...entity,
                moveTarget: target,
                targetId: null,
                path: null
            };
        }
    }
    return { ...state, entities: nextEntities };
}

function commandAttack(state: GameState, payload: { unitIds: EntityId[]; targetId: EntityId }): GameState {
    const { unitIds, targetId } = payload;

    let nextEntities = { ...state.entities };
    for (const id of unitIds) {
        const entity = nextEntities[id];
        if (entity && entity.owner !== -1 && entity.type === 'UNIT') {
            nextEntities[id] = {
                ...entity,
                targetId: targetId,
                moveTarget: null,
                path: null
            };
        }
    }
    return { ...state, entities: nextEntities };
}

function updateEntities(state: GameState): { entities: Record<EntityId, Entity>, projectiles: any[], particles: any[], creditsEarned: Record<number, number> } {
    let nextEntities = { ...state.entities };
    let newProjectiles: any[] = [];
    let newParticles: any[] = [];
    let creditsEarned: Record<number, number> = {};

    // Refresh collision grid for pathfinding
    refreshCollisionGrid(state.entities);

    const entityList = Object.values(state.entities);

    for (const id in nextEntities) {
        const entity = nextEntities[id];
        if (entity.dead) continue;

        if (entity.type === 'UNIT') {
            const res = updateUnit(entity, state.entities, entityList);
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
                ent = { ...ent, rotation: ent.rotation + diff * 0.2 };
            }
            ent = { ...ent, vel: new Vector(0, 0) };
            nextEntities[id] = ent;
        }

        if (ent.cooldown > 0) nextEntities[id] = { ...ent, cooldown: ent.cooldown - 1 };
        if (ent.flash > 0) nextEntities[id] = { ...ent, flash: ent.flash - 1 };
    }

    // Resolve Hard Collisions
    nextEntities = resolveCollisions(nextEntities);

    return { entities: nextEntities, projectiles: newProjectiles, particles: newParticles, creditsEarned };
}

function resolveCollisions(entities: Record<EntityId, Entity>): Record<EntityId, Entity> {
    const ids = Object.keys(entities);
    // Create a mutable list of working copies
    const workingEntities = ids.map(id => ({ ...entities[id] }));
    const iterations = 2; // Run a few passes for stability

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

                        // Use smaller push to reduce backslide
                        const pushScale = Math.min(overlap, 0.8);

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


function updateUnit(entity: Entity, allEntities: Record<EntityId, Entity>, entityList: Entity[]): { entity: Entity, projectile?: any, creditsEarned: number, resourceDamage?: { id: string, amount: number } | null } {
    let nextEntity = { ...entity };
    const data = getRuleData(nextEntity.key);
    let projectile = null;
    let creditsEarned = 0;

    let resourceDamage: { id: string, amount: number } | null = null;

    // Harvester Logic
    if (nextEntity.key === 'harvester') {
        const harvester = nextEntity;
        const capacity = 500;

        // 1. If full, return to refinery
        if (harvester.cargo >= capacity) {
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
                    const dockPos = ref.pos.add(new Vector(0, 60));
                    const ourDist = harvester.pos.dist(dockPos);

                    // Check if another harvester is ahead of us in the queue
                    let positionInQueue = 0; // 0 = first in line
                    for (const other of entityList) {
                        if (other.id !== harvester.id &&
                            other.key === 'harvester' &&
                            other.owner === harvester.owner &&
                            !other.dead &&
                            (other as any).cargo > 0) { // Only count harvesters with cargo (wanting to dock)
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
            if (!harvester.resourceTargetId) {
                // Find nearest ore (excluding any blocked ore)
                const blockedOreId = (harvester as any).blockedOreId;
                let bestOre: Entity | null = null;
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

                        if (harvestAttemptTicks > 30 && distToOre > 43) {
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
        if (!nextEntity.targetId && data.damage) {
            const range = (data.range || 100) + 50;
            let bestTargetId: string | null = null;
            let bestDist = range;

            for (const other of entityList) {
                if (other.owner !== nextEntity.owner && other.owner !== -1 && !other.dead) {
                    const d = nextEntity.pos.dist(other.pos);
                    if (d < bestDist) {
                        bestDist = d;
                        bestTargetId = other.id;
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
                if (dist <= range) {
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
        // Manual move override for harvester
        nextEntity = moveToward(nextEntity, nextEntity.moveTarget, entityList);
        if (nextEntity.pos.dist(nextEntity.moveTarget!) < 10) {
            nextEntity = { ...nextEntity, moveTarget: null };
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
            for (const other of entityList) {
                if (other.owner !== entity.owner && other.owner !== -1 && !other.dead) {
                    if (entity.pos.dist(other.pos) < range) {
                        nextEntity = { ...nextEntity, targetId: other.id };
                        break;
                    }
                }
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
            damageEvent = {
                targetId: target.id,
                amount: proj.damage,
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
        const newPath = findPath(entity.pos, target, entity.radius);
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
    if (distToTarget > 10 && avgVel.mag() < speed * 0.15) {
        stuckTimer++;
    } else {
        stuckTimer = Math.max(0, stuckTimer - 2); // Decay faster when moving
    }

    // Trigger unstuck logic - use smarter unstuck direction
    if (stuckTimer > 40) {
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

        if (gx >= 0 && gx < GRID_W && gy >= 0 && gy < GRID_H) {
            if (collisionGrid[gy * GRID_W + gx] === 1) {
                // Reduced avoidance when we have a path (path already handles navigation)
                const baseWeight = hasValidPath ? 1.0 : 2.5;
                const weight = a === 0 ? baseWeight : baseWeight * 0.6;
                avoidance = avoidance.sub(whisker.scale(weight));
            }
        }
    }

    let finalDir = dir;
    if (entityCount > 0 || avoidance.mag() > 0.001) {
        // Keep-right bias for head-on situations, but reduce it
        const right = new Vector(-dir.y, dir.x);
        const rightBias = entityCount > 0 ? 0.3 : 0;

        // Reduce separation force significantly - let collision resolution handle overlap
        finalDir = dir.add(separation.scale(0.5)).add(avoidance).add(right.scale(rightBias)).norm();
    }

    return {
        ...entity,
        vel: finalDir.scale(speed),
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
    const isRocket = (source.key === 'rocket' || source.key === 'artillery');
    return {
        ownerId: source.id,
        pos: source.pos,
        vel: target.pos.sub(source.pos).norm().scale(isRocket ? 9 : 18),
        targetId: target.id,
        speed: isRocket ? 9 : 18,
        damage: data.damage,
        splash: data.splash || 0,
        type: isRocket ? 'rocket' : 'bullet',
        dead: false
    };
}

function createEntity(x: number, y: number, owner: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE', key: string, state: GameState): Entity {
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
        cargo: 0,
        resourceTargetId: null,
        baseTargetId: null,
        dockPos: undefined
    };
}

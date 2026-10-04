import {
    type GameState, type EntityId, type Entity, type Projectile, type Particle, type UnitEntity, Vector, type HarvesterUnit,
    type ExplosionEvent, type VisualEvent, VISUAL_EVENT_TTL
} from '../types';
import { RULES, isUnitData } from '../../data/schemas/index';
import { getRuleData, killPlayerEntities } from './helpers';
import { setPathCacheTick, refreshCollisionGrid, syncGridsToWorker, spawnExplosionParticles } from '../utils';
import { rebuildSpatialGrid, getSpatialGrid } from '../spatial';
import { createEntityCache, type StuckMover, type UnitTickContext } from '../perf';
import { updateProduction } from './production';
import { updateWells, updateBuilding } from './buildings';
import { updateUnit } from './units';
import { updateAirUnitState, updateAirBase } from './air_units';
import { getDifficultyModifiers } from '../ai/utils';
import { isAirUnit } from '../entity-helpers';
import { isDemoTruck } from '../type-guards';
import { getTransportCapacity, getTransportPassengers, isGarrisonableTransport, isTransportedUnit } from '../transport';
import { getDemoTruckExplosionStats } from './demo_truck';
import { updateFogOfWar } from './fog';
import { isAlly } from '../teams';
import { DebugEvents } from '../debug/events';
import { aimAngle, applyMovementInertia, getTurretTurnRate, stepTurret, wrapAngle } from '../inertia';

const MAX_TRAIL_POINTS = 30;

export function tick(state: GameState): GameState {
    if (!state.running) return state;

    const headless = state.headless === true;
    const nextTick = state.tick + 1;

    // Update path cache tick for proper cache invalidation
    setPathCacheTick(nextTick);

    // Clear notification after 3 seconds (180 ticks)
    let nextNotification = state.notification;
    if (nextNotification && state.tick - nextNotification.tick > 180) {
        nextNotification = null;
    }

    // Copy-on-write: the entity map is only cloned if production actually adds/changes
    // something this tick (updateEntities makes its own working copy for the heavy lifting).
    let nextEntities = state.entities;
    let entitiesOwned = false;
    const ownEntities = () => {
        if (!entitiesOwned) {
            nextEntities = { ...state.entities };
            entitiesOwned = true;
        }
    };
    const nextPlayers = { ...state.players };

    // PERFORMANCE: Create entity cache once per tick for optimized lookups
    const entityCache = createEntityCache(state.entities);

    // Update Production
    for (const pid in nextPlayers) {
        const res = updateProduction(nextPlayers[pid], state.entities, state, entityCache);
        nextPlayers[pid] = res.player;
        if (res.createdEntities.length > 0) ownEntities();
        res.createdEntities.forEach(e => {
            nextEntities[e.id] = e;
        });
        // Apply modified entities (e.g., air base slots updated when harrier spawns docked)
        for (const entityId in res.modifiedEntities) {
            ownEntities();
            nextEntities[entityId] = res.modifiedEntities[entityId];
        }
    }

    // Rebuild spatial grid for updateWells usage (it needs to query nearby ores/blockers)
    rebuildSpatialGrid(nextEntities);

    // Update fog of war (visual only, skip in headless mode)
    const nextFogOfWar = headless ? state.fogOfWar : updateFogOfWar({ ...state, entities: nextEntities });

    // Update Wells - spawn new ore and grow existing ore near wells
    // Also handles induction rig income generation
    const wellResult = updateWells(nextEntities, nextTick, state.config, nextPlayers);
    nextEntities = wellResult.entities;

    // Apply induction rig credits (with difficulty modifier for AI players)
    for (const pidStr in wellResult.playerCredits) {
        const pid = parseInt(pidStr);
        const player = nextPlayers[pid];
        if (player) {
            const modifier = player.isAi ? getDifficultyModifiers(player.difficulty).resourceBonus : 1.0;
            const adjustedCredits = Math.floor(wellResult.playerCredits[pid] * modifier);
            nextPlayers[pid] = {
                ...player,
                credits: player.credits + adjustedCredits
            };
        }
    }

    // Entity Updates
    const updateState = { ...state, players: nextPlayers, entities: nextEntities };
    const {
        entities: updatedEntities,
        projectiles: newProjs,
        creditsEarned,
        hasDemoTruck
    } = updateEntities(updateState, headless);

    // Apply Credits (with difficulty modifier for AI players)
    for (const pidStr in creditsEarned) {
        const pid = parseInt(pidStr);
        const player = nextPlayers[pid];
        if (player) {
            // Apply difficulty resource bonus for AI players
            const modifier = player.isAi ? getDifficultyModifiers(player.difficulty).resourceBonus : 1.0;
            const adjustedCredits = Math.floor(creditsEarned[pid] * modifier);
            nextPlayers[pid] = {
                ...player,
                credits: player.credits + adjustedCredits
            };

            // Emit economy event for harvester deposit
            if (import.meta.env?.DEV && adjustedCredits > 0) {
                DebugEvents.emit('economy', {
                    tick: nextTick,
                    playerId: pid,
                    data: {
                        credits: nextPlayers[pid].credits,
                        delta: adjustedCredits,
                        source: 'harvest'
                    }
                });
            }
        }
    }

    // Effects for the renderer (muzzle flashes, impacts, wrecks) - visual only
    const visualEvents: VisualEvent[] | null = headless ? null : [];
    if (visualEvents) {
        for (const p of newProjs) {
            visualEvents.push({
                kind: 'fire', tick: nextTick, sourceId: p.ownerId, targetId: p.targetId,
                weaponType: p.weaponType || p.type, archetype: p.archetype
            });
        }
    }
    const pushImpact = (p: Projectile, x: number, y: number, air: boolean, intercepted = false) => {
        visualEvents?.push({
            kind: 'impact', tick: nextTick, x, y, weaponType: p.weaponType || p.type, archetype: p.archetype,
            splash: p.splash, damage: p.damage, air, intercepted
        });
    };

    // Projectile Updates
    const nextProjectiles: Projectile[] = [];
    const damageEvents: { targetId: EntityId; amount: number; attackerId: EntityId }[] = [];
    const splashEvents: { projectile: Projectile; hitPos: Vector; includePrimaryTarget: boolean }[] = [];
    // Temporary state for interception checks (uses updatedEntities from this tick)
    const interceptionState = { ...state, entities: updatedEntities };

    [...state.projectiles, ...newProjs].forEach(p => {
        // Apply AA interception damage to interceptable projectiles
        const interceptedProj = applyInterception(interceptionState, p);
        // If projectile was killed by interception, don't process further
        if (interceptedProj.dead) {
            pushImpact(p, p.pos.x, p.pos.y, true, true);
            return; // Skip this projectile, don't add to nextProjectiles
        }
        const res = updateProjectile(interceptedProj, updatedEntities, state.config.width, state.config.height);
        if (!res.proj.dead) {
            // Update trail points before adding to nextProjectiles (skip in headless mode)
            nextProjectiles.push(headless ? res.proj : updateProjectileTrail(res.proj));
        } else if (visualEvents) {
            // Hits, ground bursts, and shots reaching a target that died meanwhile; not shots
            // cancelled mid-flight because their target vanished
            const target = updatedEntities[p.targetId];
            if (res.damage || res.detonation || target?.dead) {
                pushImpact(p, res.proj.pos.x, res.proj.pos.y, !res.detonation && !!target && isFlyingEntity(target));
            }
        }
        if (res.damage) {
            damageEvents.push(res.damage);
            // Track splash damage events for projectiles that hit their target
            if (p.splash > 0) {
                splashEvents.push({ projectile: p, hitPos: res.proj.pos, includePrimaryTarget: false });
            }
        } else if (res.detonation && p.splash > 0) {
            // Ground burst that missed its target: splash everything there, target included
            splashEvents.push({ projectile: p, hitPos: res.detonation, includePrimaryTarget: true });
        }
    });

    // Apply Damage
    for (const d of damageEvents) {
        if (updatedEntities[d.targetId]) {
            const ent = updatedEntities[d.targetId];
            const prevHp = ent.hp;
            const nextHp = Math.min(ent.maxHp, Math.max(0, ent.hp - d.amount));
            const nowDead = nextHp <= 0;

            // Emit state-change event for damage
            if (import.meta.env?.DEV) {
                DebugEvents.emit('state-change', {
                    tick: state.tick,
                    playerId: ent.owner,
                    entityId: ent.id,
                    data: {
                        subject: ent.type === 'UNIT' ? 'unit' : 'building',
                        field: 'hp',
                        from: prevHp,
                        to: nextHp,
                        cause: `attack from ${d.attackerId.slice(0, 8)}`
                    }
                });
                if (nowDead) {
                    DebugEvents.emit('state-change', {
                        tick: state.tick,
                        playerId: ent.owner,
                        entityId: ent.id,
                        data: {
                            subject: ent.type === 'UNIT' ? 'unit' : 'building',
                            field: 'dead',
                            from: false,
                            to: true,
                            cause: `killed by ${d.attackerId.slice(0, 8)}`
                        }
                    });
                }
            }

            // Update combat component for units and buildings with combat
            if (ent.type === 'UNIT') {
                updatedEntities[d.targetId] = {
                    ...ent,
                    hp: nextHp,
                    dead: nowDead,
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
                    dead: nowDead,
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
                    dead: nowDead
                };
            }
        }
    }

    // Apply Splash Damage from projectile hits
    for (const splash of splashEvents) {
        // Apply splash damage to all entities in radius (except the primary target which already took direct damage)
        const tempState = { ...state, entities: updatedEntities };
        const splashResult = applySplashDamage(tempState, splash.projectile, splash.hitPos, { includePrimaryTarget: splash.includePrimaryTarget });
        // Copy updated entities back
        for (const id in splashResult.entities) {
            updatedEntities[id] = splashResult.entities[id];
        }
    }

    // Process Demo Truck Explosions (chain reactions)
    const explosionResult = hasDemoTruck
        ? processExplosions(updatedEntities, nextTick, headless, visualEvents)
        : { entities: updatedEntities, particles: [], explosionCount: 0 };
    // Note: We use a mutable reference approach here since updatedEntities is from destructuring
    // Copy the explosion-processed entities back into updatedEntities object
    for (const id in explosionResult.entities) {
        updatedEntities[id] = explosionResult.entities[id];
    }
    const explosionParticles = explosionResult.particles;
    const triggerScreenShake = explosionResult.explosionCount > 0;

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

    // Process Service Depot Repair Aura
    // OPTIMIZED: Use spatial grid instead of O(n²) nested loops
    const depotData = RULES.buildings['service_depot'];
    if (depotData) {
        const repairRadius = depotData.repairRadius || 60;
        const repairRate = depotData.repairRate || 1;
        const spatialGrid = getSpatialGrid();

        // Collect service depots in a single pass
        const serviceDepots: Entity[] = [];
        for (const id in updatedEntities) {
            const ent = updatedEntities[id];
            if (ent.type === 'BUILDING' && ent.key === 'service_depot' && !ent.dead) {
                serviceDepots.push(ent);
            }
        }

        // For each depot, use spatial query to find nearby units (O(k) instead of O(n))
        for (const depot of serviceDepots) {
            // Skip if player has low power
            const player = nextPlayers[depot.owner];
            if (!player || player.usedPower > player.maxPower) continue;

            // Query nearby entities using spatial grid
            const nearbyEntities = spatialGrid.queryRadius(depot.pos.x, depot.pos.y, repairRadius + 30);

            for (const entity of nearbyEntities) {
                // Filter for friendly damaged vehicles only (not infantry)
                if (entity.type !== 'UNIT' || entity.dead) continue;
                if (entity.owner !== depot.owner) continue;

                // Get latest version from updatedEntities (may have been modified this tick)
                const unit = updatedEntities[entity.id] as UnitEntity;
                if (!unit || unit.type !== 'UNIT' || unit.dead || unit.hp >= unit.maxHp) continue;

                // Docking logic: target must have THIS depot as repairTargetId
                if (unit.movement.repairTargetId !== depot.id) continue;

                // Service depot only repairs vehicles, not infantry
                const unitData = getRuleData(entity.key);
                if (!unitData || !isUnitData(unitData) || unitData.type !== 'vehicle') continue;

                // Precise distance check - must be fully inside or very close to center to be "docked"
                const dist = unit.pos.dist(depot.pos);
                // Building is 120x120 (radius 60). We consider it docked if it's securely on the pad.
                if (dist <= depot.radius) {
                    const newHp = Math.min(unit.maxHp, unit.hp + repairRate);
                    updatedEntities[entity.id] = {
                        ...unit,
                        hp: newHp
                    };

                    // If fully healed, command the unit to roll out automatically
                    if (newHp >= unit.maxHp) {
                        const updated = updatedEntities[entity.id] as UnitEntity;
                        const rolloutPos = depot.pos.add(new Vector(0, depot.radius + unit.radius + 30));
                        updatedEntities[entity.id] = {
                            ...updated,
                            movement: {
                                ...updated.movement,
                                moveTarget: rolloutPos,
                                path: null
                            }
                        };
                    }
                }
            }
        }
    }

    // Transport lifecycle:
    // - Destroyed transports eject all passengers with clamped spill damage (never below 5% HP)
    // - Ownership mismatch ejects passengers without damage (prevents hidden stranded units)
    processTransportLifecycle(updatedEntities, state.config);

    // Filter dead entities
    const buildingCounts: Record<number, number> = {};
    const mcvCounts: Record<number, number> = {};

    // Initialize counts for active players
    for (const pid in nextPlayers) {
        buildingCounts[pid] = 0;
        mcvCounts[pid] = 0;
    }

    let anyDead = false;
    for (const id in updatedEntities) {
        const ent = updatedEntities[id];
        if (ent.dead) {
            anyDead = true;
            // Killed (not consumed like engineers and hijackers, which leave with HP to spare)
            if (visualEvents && ent.hp <= 0 && (ent.type === 'UNIT' || ent.type === 'BUILDING')) {
                visualEvents.push({
                    kind: 'destroyed', tick: nextTick, x: ent.pos.x, y: ent.pos.y, entityType: ent.type,
                    key: ent.key, owner: ent.owner, rotation: ent.type === 'UNIT' ? ent.movement.rotation : 0,
                    radius: ent.radius, air: isFlyingEntity(ent)
                });
            }
            continue;
        }
        if (ent.type === 'BUILDING') {
            buildingCounts[ent.owner] = (buildingCounts[ent.owner] || 0) + 1;
        } else if (ent.type === 'UNIT' && ent.key === 'mcv') {
            mcvCounts[ent.owner] = (mcvCounts[ent.owner] || 0) + 1;
        }
    }

    // updatedEntities is a fresh, tick-local map, so when nothing died it can be used as is
    // instead of being copied entry by entry.
    let finalEntities: Record<EntityId, Entity> = updatedEntities;
    if (anyDead) {
        finalEntities = {};
        for (const id in updatedEntities) {
            const ent = updatedEntities[id];
            if (!ent.dead) finalEntities[id] = ent;
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
        } else if (alivePlayers.length > 1) {
            // Team-aware victory: all alive players must share the same team
            const firstTeam = nextPlayers[alivePlayers[0]]?.team;
            if (firstTeam != null) {
                const allSameTeam = alivePlayers.every(pid => nextPlayers[pid]?.team === firstTeam);
                if (allSameTeam) {
                    nextWinner = alivePlayers[0];
                    nextRunning = false;
                }
            }
        } else if (alivePlayers.length === 0 && Object.keys(nextPlayers).length > 0) {
            // Draw or everyone destroyed?
            nextWinner = -1; // -1 for draw
            nextRunning = false;
        }
    }

    // Skip visual-only computations in headless mode
    let nextCommandIndicator: typeof state.commandIndicator = null;
    let nextCamera = state.camera;
    let nextParticles: typeof state.particles;

    if (headless) {
        nextParticles = [];
    } else {
        // Clear command indicator after 2 seconds (120 ticks)
        const INDICATOR_DURATION = 120;
        nextCommandIndicator = state.commandIndicator &&
            (nextTick - state.commandIndicator.startTick < INDICATOR_DURATION)
            ? state.commandIndicator
            : null;

        // Update screen shake (decay or trigger new)
        if (triggerScreenShake) {
            // Trigger new screen shake from explosion
            nextCamera = {
                ...state.camera,
                shakeIntensity: 10,
                shakeDuration: 15
            };
        } else if (state.camera.shakeDuration && state.camera.shakeDuration > 0) {
            // Decay existing shake
            nextCamera = {
                ...state.camera,
                shakeDuration: state.camera.shakeDuration - 1
            };
            if (nextCamera.shakeDuration === 0) {
                nextCamera = {
                    ...nextCamera,
                    shakeIntensity: undefined,
                    shakeDuration: undefined
                };
            }
        }

        // Update particles (decay life, remove dead)
        const existingParticles = state.particles
            .map(p => ({
                ...p,
                pos: new Vector(p.pos.x + p.vel.x, p.pos.y + p.vel.y),
                life: p.life - 1
            }))
            .filter(p => p.life > 0);
        nextParticles = [...existingParticles, ...explosionParticles];
    }

    return {
        ...state,
        tick: nextTick,
        entities: finalEntities,
        selection: state.selection.filter(id => {
            const entity = finalEntities[id];
            if (!entity || entity.dead) return false;
            return entity.type !== 'UNIT' || !isTransportedUnit(entity);
        }),
        players: nextPlayers,
        projectiles: nextProjectiles,
        particles: nextParticles,
        visualEvents: visualEvents ? recentVisualEvents(state.visualEvents, visualEvents, nextTick) : state.visualEvents,
        camera: nextCamera,
        winner: nextWinner,
        running: nextRunning,
        notification: nextNotification,
        commandIndicator: nextCommandIndicator,
        fogOfWar: nextFogOfWar
    };
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

function processTransportLifecycle(
    entities: Record<EntityId, Entity>,
    mapConfig: { width: number; height: number }
): void {
    // Fast path: most ticks have no transport carrying passengers, so avoid the
    // Object.values/filter/sort allocation entirely. Passengers are the only units
    // with a transportId set, so one cheap scan tells us whether there is any work.
    let hasPassengers = false;
    for (const id in entities) {
        const entity = entities[id];
        if (entity.type === 'UNIT' && entity.movement?.transportId != null) {
            hasPassengers = true;
            break;
        }
    }
    if (!hasPassengers) {
        // A dead transport can only have passengers if some unit references it.
        return;
    }

    const transports = Object.values(entities)
        .filter((entity): entity is UnitEntity =>
            entity.type === 'UNIT' && isGarrisonableTransport(entity)
        )
        .sort((a, b) => a.id.localeCompare(b.id));

    for (const transport of transports) {
        const passengers = getTransportPassengers(entities, transport.id).sort((a, b) => a.id.localeCompare(b.id));
        if (passengers.length === 0) continue;

        const shouldDamagePassengers = transport.dead;
        const capacity = getTransportCapacity(transport);
        const overflowPassengers = passengers.slice(capacity);
        const mismatchedPassengers = passengers.filter(passenger => passenger.owner !== transport.owner);
        const toEject = shouldDamagePassengers
            ? passengers
            : Array.from(new Map([...overflowPassengers, ...mismatchedPassengers].map(p => [p.id, p])).values());
        if (toEject.length === 0) continue;

        const ejectPositions = calculateUngarrisonPositions(transport, toEject.length);
        for (let i = 0; i < toEject.length; i++) {
            const passenger = entities[toEject[i].id];
            if (!passenger || passenger.type !== 'UNIT' || passenger.dead) continue;
            if (passenger.movement.transportId !== transport.id) continue;

            const rawPos = ejectPositions[i] || transport.pos;
            const clampedPos = new Vector(
                Math.max(passenger.radius, Math.min(mapConfig.width - passenger.radius, rawPos.x)),
                Math.max(passenger.radius, Math.min(mapConfig.height - passenger.radius, rawPos.y))
            );

            const damage = shouldDamagePassengers ? Math.round(passenger.maxHp * 0.6) : 0;
            const minHp = Math.max(1, Math.ceil(passenger.maxHp * 0.05));
            const nextHp = shouldDamagePassengers
                ? Math.max(minHp, passenger.hp - damage)
                : passenger.hp;

            entities[passenger.id] = {
                ...passenger,
                hp: nextHp,
                dead: false,
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
        }
    }
}

export function updateEntities(
    state: GameState,
    headless: boolean = false
): {
    entities: Record<EntityId, Entity>,
    projectiles: Projectile[],
    particles: Particle[],
    creditsEarned: Record<number, number>,
    hasDemoTruck: boolean
} {
    let nextEntities = { ...state.entities };
    const newProjectiles: Projectile[] = [];
    const newParticles: Particle[] = [];
    const creditsEarned: Record<number, number> = {};
    let hasDemoTruck = false;

    // Refresh collision grid for pathfinding (passing map config for dynamic grid sizing)
    const playerIds = Object.keys(state.players).map(Number);
    refreshCollisionGrid(state.entities, state.config, playerIds);

    // Sync grids to pathfinding web worker (if enabled)
    if (!headless) {
        syncGridsToWorker(playerIds);
    }

    // NOTE: Spatial grid was already rebuilt in tick() before updateWells
    // No need to rebuild again - new ore from wells is rare and minor

    const entityList = Object.values(state.entities);

    // Pre-calculate harvester counts per resource to avoid O(N^2) loop in updateUnit
    const harvesterCounts: Record<string, number> = {};
    // Owners with a live refinery: full harvesters of other owners have nowhere to unload,
    // so they can skip the (map-wide) refinery search.
    const refineryOwners = new Set<number>();
    // Stuck movers (what idle units scatter for), matching what the spatial grid would yield
    const stuckMoversByOwner = new Map<number, StuckMover[]>();
    for (const ent of entityList) {
        if (ent.dead) continue;
        if (ent.key === 'refinery') refineryOwners.add(ent.owner);
        if (ent.type === 'UNIT' && ent.movement.moveTarget && (ent.movement.stuckTimer || 0) >= 15 && !isTransportedUnit(ent)) {
            let list = stuckMoversByOwner.get(ent.owner);
            if (!list) {
                list = [];
                stuckMoversByOwner.set(ent.owner, list);
            }
            list.push({ owner: ent.owner, x: ent.pos.x, y: ent.pos.y });
        }
        if (ent.type === 'UNIT' && ent.key === 'harvester') {
            const h = ent as HarvesterUnit;
            if (h.harvester.resourceTargetId) {
                harvesterCounts[h.harvester.resourceTargetId] = (harvesterCounts[h.harvester.resourceTargetId] || 0) + 1;
            }
        }
    }

    const tickContext: UnitTickContext = { refineryOwners, stuckMoversByOwner };

    for (const id in nextEntities) {
        const entity = nextEntities[id];
        if (entity.type === 'UNIT' && entity.key === 'demo_truck') {
            // Include dead demo trucks so tick() can process death-triggered explosions.
            hasDemoTruck = true;
        }
        if (entity.dead) continue;
        if (entity.type === 'UNIT' && isTransportedUnit(entity)) {
            nextEntities[id] = {
                ...entity,
                movement: {
                    ...entity.movement,
                    vel: new Vector(0, 0),
                    moveTarget: null,
                    path: null,
                    pathIdx: 0,
                    finalDest: null,
                    unstuckDir: null,
                    unstuckTimer: 0,
                    stuckTimer: 0,
                    avgVel: undefined
                },
                combat: {
                    ...entity.combat,
                    targetId: null,
                    attackMoveTarget: null,
                    stanceHomePos: null
                }
            };
            continue;
        }

        if (entity.type === 'UNIT') {
            // Check if this is an air unit (harrier) - use different state machine
            if (isAirUnit(entity)) {
                const airRes = updateAirUnitState(entity, state.entities, entityList, state);
                nextEntities[id] = airRes.entity;
                if (airRes.projectile) newProjectiles.push(airRes.projectile);
                // Apply modified entities (e.g., air base slots updated when harrier docks)
                if (airRes.modifiedEntities) {
                    for (const modId in airRes.modifiedEntities) {
                        nextEntities[modId] = airRes.modifiedEntities[modId];
                    }
                }
            } else {
                const res = updateUnit(entity, state.entities, entityList, state.config, state.tick, harvesterCounts, state, tickContext);
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
            }

            // Handle Engineer Capture/Repair (only for CombatUnit, not harvester or harrier)
            const ent = nextEntities[id] as UnitEntity;
            if (ent.key !== 'harvester' && ent.key !== 'harrier' && 'engineer' in ent && ent.engineer?.captureTargetId) {
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
            } else if (ent.key !== 'harvester' && ent.key !== 'harrier' && 'engineer' in ent && ent.engineer?.repairTargetId) {
                // Engineer entered friendly building to repair - fully heal the building
                const engTargetId = ent.engineer.repairTargetId;
                const engTarget = nextEntities[engTargetId];
                if (engTarget && engTarget.type === 'BUILDING' && engTarget.hp < engTarget.maxHp) {
                    // Fully repair the building
                    nextEntities[engTargetId] = {
                        ...engTarget,
                        hp: engTarget.maxHp,
                        combat: engTarget.combat ? { ...engTarget.combat, flash: 5 } : undefined
                    };
                }
                // Engineer is consumed (already marked dead in combat.ts)
                nextEntities[id] = {
                    ...ent,
                    dead: true,
                    engineer: { ...ent.engineer, repairTargetId: null }
                };
            }

            // Handle Hijacker vehicle takeover - mark hijacker dead but keep target ID for post-loop processing
            // (Processing hijacks inline would be overwritten when target entity is updated later in loop)
            if (ent.key === 'hijacker' && 'hijacker' in ent && ent.hijacker?.hijackTargetId) {
                // Mark hijacker as dead, but keep the hijackTargetId for post-loop processing
                nextEntities[id] = {
                    ...ent,
                    dead: true
                    // NOTE: hijackTargetId preserved intentionally - will be processed after all entity updates
                };
            }
        } else if (entity.type === 'BUILDING') {
            const res = updateBuilding(entity, state.entities, entityList, state);
            nextEntities[id] = res.entity;
            if (res.projectile) newProjectiles.push(res.projectile);

            // Handle Air-Force Command building reload
            if (res.entity.key === 'airforce_command' && res.entity.airBase) {
                const airBaseRes = updateAirBase(res.entity, nextEntities, state.tick);
                nextEntities[id] = airBaseRes.entity;

                // Apply harrier ammo updates
                for (const harrierId in airBaseRes.updatedHarriers) {
                    nextEntities[harrierId] = airBaseRes.updatedHarriers[harrierId];
                }
            }
        }

        // Movement, rotation, cooldown, flash, turret updates (units only)
        let currentEnt = nextEntities[id];
        if (currentEnt.type === 'UNIT') {
            const movement = currentEnt.movement;
            if (movement.vel.mag() > 0) {
                const vel = applyMovementInertia(currentEnt.key, movement.vel, movement.lastVel, movement.currentSpeed ?? 0);
                let rotation = movement.rotation;
                const data = getRuleData(currentEnt.key);
                const canFly = data && isUnitData(data) && data.fly;
                if (data && !canFly) {
                    // Smooth rotation (the turret returns to it when idle, so it runs headless too)
                    rotation = wrapAngle(rotation + wrapAngle(Math.atan2(vel.y, vel.x) - rotation) * 0.2);
                }
                currentEnt = {
                    ...currentEnt,
                    prevPos: currentEnt.pos,
                    pos: currentEnt.pos.add(vel),
                    movement: {
                        ...movement,
                        rotation,
                        vel: new Vector(0, 0),
                        // Store the velocity before clearing so avgVel can track intended movement
                        lastVel: vel,
                        currentSpeed: vel.mag()
                    }
                };
                nextEntities[id] = currentEnt;
            } else if (movement.currentSpeed) {
                currentEnt = { ...currentEnt, movement: { ...movement, currentSpeed: 0 } };
                nextEntities[id] = currentEnt;
            }

            // Update cooldown and flash in combat component
            const shouldUpdateCombatTimers = headless
                ? currentEnt.combat.cooldown > 0
                : (currentEnt.combat.cooldown > 0 || currentEnt.combat.flash > 0);
            if (shouldUpdateCombatTimers) {
                nextEntities[id] = {
                    ...currentEnt,
                    combat: {
                        ...currentEnt.combat,
                        cooldown: Math.max(0, currentEnt.combat.cooldown - 1),
                        flash: headless ? currentEnt.combat.flash : Math.max(0, currentEnt.combat.flash - 1)
                    }
                };
                currentEnt = nextEntities[id] as UnitEntity;
            }

            const turretAngle = nextTurretAngle(currentEnt, nextEntities, headless);
            if (turretAngle !== currentEnt.combat.turretAngle) {
                nextEntities[id] = { ...currentEnt, combat: { ...currentEnt.combat, turretAngle } };
            }
        } else if (currentEnt.type === 'BUILDING' && currentEnt.combat) {
            let combat = currentEnt.combat;
            // Update cooldown and flash for defense buildings
            const shouldUpdateCombatTimers = headless
                ? combat.cooldown > 0
                : (combat.cooldown > 0 || combat.flash > 0);
            if (shouldUpdateCombatTimers) {
                combat = {
                    ...combat,
                    cooldown: Math.max(0, combat.cooldown - 1),
                    flash: headless ? combat.flash : Math.max(0, combat.flash - 1)
                };
                nextEntities[id] = { ...currentEnt, combat };
            }

            const turretAngle = nextTurretAngle(currentEnt, nextEntities, headless);
            if (turretAngle !== combat.turretAngle) {
                nextEntities[id] = { ...currentEnt, combat: { ...combat, turretAngle } };
            }
        }
    }

    // Post-loop: Process hijacker vehicle takeovers (must happen after all entity updates)
    for (const id in nextEntities) {
        const ent = nextEntities[id] as UnitEntity;
        if (ent.type === 'UNIT' && ent.key === 'hijacker' && 'hijacker' in ent && ent.hijacker?.hijackTargetId && ent.dead) {
            const hijackTargetId = ent.hijacker.hijackTargetId;
            const hijackTarget = nextEntities[hijackTargetId] as UnitEntity | undefined;
            if (hijackTarget && hijackTarget.type === 'UNIT' && hijackTarget.combat && hijackTarget.owner !== ent.owner) {
                // Transfer vehicle ownership to hijacker's owner
                nextEntities[hijackTargetId] = {
                    ...hijackTarget,
                    owner: ent.owner,
                    combat: { ...hijackTarget.combat, flash: 30, targetId: null },
                    movement: { ...hijackTarget.movement, moveTarget: null }
                };
            }
            // Clear hijacker's target ID (it's already marked dead)
            nextEntities[id] = {
                ...ent,
                hijacker: { hijackTargetId: null }
            };
        }
    }

    // Resolve Hard Collisions
    nextEntities = resolveCollisions(nextEntities);

    // Clamp all unit positions to map boundaries
    // This ensures units can never leave the map (from movement, collision push, or any other source)
    const mapWidth = state.config.width;
    const mapHeight = state.config.height;
    for (const id in nextEntities) {
        const ent = nextEntities[id];
        if (ent.type === 'UNIT' && !ent.dead) {
            const r = ent.radius;
            // Clamp position so unit (including radius) stays within map
            const minX = r;
            const maxX = mapWidth - r;
            const minY = r;
            const maxY = mapHeight - r;

            if (ent.pos.x < minX || ent.pos.x > maxX || ent.pos.y < minY || ent.pos.y > maxY) {
                nextEntities[id] = {
                    ...ent,
                    pos: new Vector(
                        Math.max(minX, Math.min(maxX, ent.pos.x)),
                        Math.max(minY, Math.min(maxY, ent.pos.y))
                    )
                };
            }
        }
    }

    return {
        entities: nextEntities,
        projectiles: newProjectiles,
        particles: newParticles,
        creditsEarned,
        hasDemoTruck
    };
}

// Mutable version of Entity for collision resolution (allows position updates)
type MutableEntity = { -readonly [K in keyof Entity]: Entity[K] };

/**
 * Resolve overlaps between ground units and static obstacles.
 * NOTE: mutates (and returns) the passed map - callers must own it.
 */
function resolveCollisions(entities: Record<EntityId, Entity>): Record<EntityId, Entity> {
    // Only ground units are ever repositioned by collision resolution, so only those need
    // mutable working copies. Buildings, rocks and resources (usually the bulk of the
    // entities) are shared by reference instead of being cloned every tick.
    // `entities` is owned by the caller (updateEntities' per-tick working map), so unit copies
    // are swapped in place rather than cloning the whole map again.
    const workingEntities = entities as Record<EntityId, MutableEntity>;
    const workingUnits = new Set<MutableEntity>();
    const groundUnits: MutableEntity[] = [];  // Ground units only (not flying)
    const movingUnits: MutableEntity[] = []; // OPTIMIZATION: Track only units that moved

    for (const id in entities) {
        const original = entities[id];
        if (original.type === 'UNIT' && !original.dead) {
            if (isTransportedUnit(original)) continue;
            // Skip flying units from ground collision - they fly above everything
            const unitData = getRuleData(original.key);
            const canFly = unitData && isUnitData(unitData) && unitData.fly === true;
            if (canFly) continue; // Air units don't participate in ground collision

            const e: MutableEntity = { ...original };
            workingEntities[id] = e;
            workingUnits.add(e);
            groundUnits.push(e);

            // OPTIMIZATION: Only process units that actually moved or have movement intent
            const unitEntity = e as unknown as UnitEntity;
            const hasMoveTarget = unitEntity.movement.moveTarget !== null;
            const hasActivePath = unitEntity.movement.path !== null &&
                unitEntity.movement.pathIdx < unitEntity.movement.path.length;
            const hasCombatTarget = unitEntity.combat.targetId !== null;
            const hasVelocity = unitEntity.movement.vel && unitEntity.movement.vel.mag() > 0.1;

            // Consider a unit "moving" if it has any movement intent or recent velocity
            if (hasMoveTarget || hasActivePath || hasCombatTarget || hasVelocity) {
                movingUnits.push(e);
            }
        }
    }

    // Early exit if no ground units to process
    if (groundUnits.length === 0) return workingEntities as Record<EntityId, Entity>;

    // OPTIMIZATION: Reduce iterations if mostly stationary units
    // Use fewer iterations when most units aren't moving
    const movingRatio = movingUnits.length / groundUnits.length;
    const iterations = movingRatio > 0.5 ? 4 : 2; // 4 iterations if >50% moving, else 2

    const spatialGrid = getSpatialGrid();

    // Max collision check radius (max unit radius ~45 + max other radius ~45 + buffer)
    const MAX_CHECK_RADIUS = 100;

    // Save start positions for moving units to correct backward displacement after all iterations
    const startPositions = new Map<string, Vector>();
    for (const unit of movingUnits) {
        const unitData = unit as unknown as UnitEntity;
        if (unitData.movement.moveTarget) {
            startPositions.set(unit.id, unit.pos);
        }
    }

    for (let k = 0; k < iterations; k++) {
        let hadOverlap = false; // OPTIMIZATION: Track if we found any overlaps this iteration

        // OPTIMIZATION: Only iterate moving units for collision checks
        // Stationary units will still be checked against (via spatial grid), but won't initiate checks
        const unitsToCheck = movingUnits.length > 0 ? movingUnits : groundUnits;

        for (const a of unitsToCheck) {
            if (a.dead) continue;

            // Use spatial grid to find nearby entities instead of checking all
            const nearby = spatialGrid.queryRadius(a.pos.x, a.pos.y, MAX_CHECK_RADIUS);

            for (const nearbyEntity of nearby) {
                // Skip self and already processed pairs (use id comparison to avoid duplicates)
                if (nearbyEntity.id <= a.id) continue;

                // Get the working copy (with potentially updated position)
                let b = workingEntities[nearbyEntity.id];
                if (!b || b.dead) continue;

                const isUnitB = b.type === 'UNIT';
                // Units that have no working copy yet (e.g. infantry that boarded a transport this tick, after
                // the grid was built) still collide like before, so clone them lazily. Flyers are skipped below.
                if (isUnitB && !workingUnits.has(b)) {
                    const bData = getRuleData(b.key);
                    if (!(bData && isUnitData(bData) && bData.fly === true)) {
                        const copy: MutableEntity = { ...b };
                        workingEntities[nearbyEntity.id] = copy;
                        workingUnits.add(copy);
                        b = copy;
                    }
                }
                // a is always a unit, skip if b is not a unit and not a building/resource that matters
                if (!isUnitB && b.type !== 'BUILDING' && b.type !== 'ROCK') continue;

                // Skip flying units in collision checks - they fly above ground units
                if (isUnitB) {
                    const bData = getRuleData(b.key);
                    if (bData && isUnitData(bData) && bData.fly === true) continue;
                }

                const dist = a.pos.dist(b.pos);
                // Allow slight soft overlap to reduce jittering
                const softOverlap = 2;
                const minDist = a.radius + b.radius - softOverlap;

                if (dist < minDist && dist > 0.001) {
                    // Skip collision if A is a vehicle docking to B (Service Depot)
                    const aUnit = a as unknown as UnitEntity;
                    if (!isUnitB && b.type === 'BUILDING' && b.key === 'service_depot' && aUnit.movement?.repairTargetId === b.id) {
                        continue;
                    }

                    hadOverlap = true; // Found an overlap
                    const overlap = minDist - dist;
                    const dir = b.pos.sub(a.pos).norm();

                    if (isUnitB) {
                        // Determine which unit is moving vs stationary
                        // A unit is "moving" if it has an explicit moveTarget OR is actively following a path
                        // Having only combat.targetId doesn't mean moving - unit may be in attack position
                        const aUnit = a as unknown as UnitEntity;
                        const bUnit = b as unknown as UnitEntity;

                        // Check for active path following (has path waypoints remaining)
                        const aHasActivePath = aUnit.movement.path !== null &&
                            aUnit.movement.pathIdx < aUnit.movement.path.length;
                        const bHasActivePath = bUnit.movement.path !== null &&
                            bUnit.movement.pathIdx < bUnit.movement.path.length;

                        // Use avgVel to detect meaningful movement vs stuck oscillation
                        // Units oscillating from collision have low avgVel magnitude
                        const aAvgVelMag = aUnit.movement.avgVel ?
                            Math.sqrt(aUnit.movement.avgVel.x ** 2 + aUnit.movement.avgVel.y ** 2) : 0;
                        const bAvgVelMag = bUnit.movement.avgVel ?
                            Math.sqrt(bUnit.movement.avgVel.x ** 2 + bUnit.movement.avgVel.y ** 2) : 0;

                        // Threshold for meaningful movement (units actively traveling, not oscillating)
                        const movingThreshold = 0.8;

                        const aMoving = aUnit.movement.moveTarget !== null ||
                            (aHasActivePath && aAvgVelMag > movingThreshold);
                        const bMoving = bUnit.movement.moveTarget !== null ||
                            (bHasActivePath && bAvgVelMag > movingThreshold);

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
                            // Reduced from 0.5 to 0.15 to prevent "dancing" in dense clumps
                            const perpA = new Vector(-dir.y, dir.x);
                            const perpB = new Vector(dir.y, -dir.x);
                            a.pos = a.pos.add(perpA.scale(pushScale * 0.15));
                            b.pos = b.pos.add(perpB.scale(pushScale * 0.15));
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

        // OPTIMIZATION: Early exit if no overlaps detected in this iteration
        // Collision resolution has converged
        if (!hadOverlap) {
            break;
        }
    }

    // After all iterations, correct any backward displacement for moving units.
    // This prevents collision resolution from fighting against intended movement.
    for (const [unitId, startPos] of startPositions) {
        const unit = workingEntities[unitId];
        if (!unit || unit.dead) continue;

        const unitData = unit as unknown as UnitEntity;
        const target = unitData.movement.moveTarget;
        if (!target) continue;

        // Calculate net displacement from collision resolution
        const dispX = unit.pos.x - startPos.x;
        const dispY = unit.pos.y - startPos.y;
        const dispMag = Math.sqrt(dispX * dispX + dispY * dispY);
        if (dispMag < 0.001) continue;

        // Get direction to target
        const toTargetX = target.x - startPos.x;
        const toTargetY = target.y - startPos.y;
        const toTargetMag = Math.sqrt(toTargetX * toTargetX + toTargetY * toTargetY);
        if (toTargetMag < 0.001) continue;

        const toTargetNormX = toTargetX / toTargetMag;
        const toTargetNormY = toTargetY / toTargetMag;

        // Check if net displacement is backward (opposite to target direction)
        const dispDotTarget = (dispX / dispMag) * toTargetNormX + (dispY / dispMag) * toTargetNormY;
        if (dispDotTarget >= -0.3) {
            // Displacement is mostly forward or sideways - allow it
            continue;
        }

        // Net displacement is significantly backward - project perpendicular to target direction
        // Remove the backward component, keep only the perpendicular part
        const backwardComponent = (dispX * toTargetNormX + dispY * toTargetNormY);
        const projectedX = dispX - backwardComponent * toTargetNormX;
        const projectedY = dispY - backwardComponent * toTargetNormY;
        const projMag = Math.sqrt(projectedX * projectedX + projectedY * projectedY);

        if (projMag < 0.001) {
            // Displacement was directly backward - use perpendicular (keep right rule)
            const perpX = -toTargetNormY;
            const perpY = toTargetNormX;
            (unit as MutableEntity).pos = new Vector(startPos.x + perpX * dispMag, startPos.y + perpY * dispMag);
        } else {
            // Use the perpendicular component with original magnitude
            (unit as MutableEntity).pos = new Vector(
                startPos.x + (projectedX / projMag) * dispMag,
                startPos.y + (projectedY / projMag) * dispMag
            );
        }
    }

    return workingEntities as Record<EntityId, Entity>;
}

// Archetypes that burst at their aimed ground point (with splash) even if the target moved away
const GROUND_BURST_ARCHETYPES: ReadonlySet<string> = new Set(['artillery', 'grenade']);

/** Closest point to `p` on the segment a-b. */
function closestPointOnSegment(a: Vector, b: Vector, p: Vector): Vector {
    const ab = b.sub(a);
    const lenSq = ab.dot(ab);
    if (lenSq === 0) return a;
    const t = Math.max(0, Math.min(1, p.sub(a).dot(ab) / lenSq));
    return a.add(ab.scale(t));
}

export function updateProjectile(proj: Projectile, entities: Record<EntityId, Entity>, mapWidth: number, mapHeight: number): { proj: Projectile, damage?: { targetId: EntityId, amount: number, attackerId: EntityId }, detonation?: Vector } {
    let currentVel = proj.vel;
    const target = entities[proj.targetId];
    const groundBurstPos = GROUND_BURST_ARCHETYPES.has(proj.archetype) ? proj.targetPos : undefined;
    const targetTransported = !!target && target.type === 'UNIT' && isTransportedUnit(target);

    if (targetTransported && !groundBurstPos) {
        return { proj: { ...proj, dead: true } };
    }

    // Homing logic for missile-archetype weapons (SAMs, Stealth Tanks, Harriers...)
    // They track their target perfectly
    if (proj.archetype === 'missile' && target && !target.dead) {
        const speed = proj.speed || 28;
        const dir = target.pos.sub(proj.pos).norm();
        currentVel = dir.scale(speed);
    }

    const nextPos = proj.pos.add(currentVel);
    const nextProj = { ...proj, pos: nextPos, vel: currentVel };
    let damageEvent = undefined;

    // Kill projectiles that go out of bounds (with margin for edge cases)
    const MARGIN = 200;
    if (nextPos.x < -MARGIN || nextPos.x > mapWidth + MARGIN ||
        nextPos.y < -MARGIN || nextPos.y > mapHeight + MARGIN) {
        nextProj.dead = true;
        return { proj: nextProj, damage: damageEvent };
    }

    // Hit test along the whole step (segment vs circle) so fast shots can't tunnel past small targets
    if (target && !target.dead && !targetTransported) {
        const hitPos = closestPointOnSegment(proj.pos, nextPos, target.pos);
        if (hitPos.dist(target.pos) < target.radius + 15) {
            nextProj.pos = hitPos;
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
            return { proj: nextProj, damage: damageEvent };
        }
    }

    // Artillery/grenades that missed their (moved, dead or gone) target burst where they were aimed
    if (groundBurstPos) {
        if (proj.pos.dist(groundBurstPos) <= currentVel.mag()) {
            nextProj.pos = groundBurstPos;
            nextProj.dead = true;
            return { proj: nextProj, detonation: groundBurstPos };
        }
        return { proj: nextProj };
    }

    // Kill projectile if target no longer exists
    if (!target) {
        nextProj.dead = true;
        return { proj: nextProj, damage: damageEvent };
    }

    if (target.dead && closestPointOnSegment(proj.pos, nextPos, target.pos).dist(target.pos) < 20) {
        // Target is dead, kill projectile when it reaches where target was
        nextProj.dead = true;
    }

    return { proj: nextProj, damage: damageEvent };
}

/**
 * Update projectile trail points, maintaining a max of 30 entries.
 */
export function updateProjectileTrail(projectile: Projectile): Projectile {
    const newTrail = [...projectile.trailPoints, projectile.pos];

    // Keep only the last 30 points
    const trimmedTrail = newTrail.length > MAX_TRAIL_POINTS
        ? newTrail.slice(newTrail.length - MAX_TRAIL_POINTS)
        : newTrail;

    return {
        ...projectile,
        trailPoints: trimmedTrail
    };
}

function isFlyingEntity(entity: Entity): boolean {
    const data = getRuleData(entity.key);
    return !!data && isUnitData(data) && data.fly === true;
}

/**
 * Apply splash damage from a projectile hit.
 * Uses linear falloff: full damage at center, zero at edge.
 * Includes friendly fire - damages all entities regardless of owner.
 * Only hits entities at the blast's level: ground blasts skip aircraft, air blasts skip ground.
 *
 * @param options.includePrimaryTarget - also splash the primary target (ground bursts that missed it)
 * @param options.airLevel - blast level; defaults to the primary target's level (ground if it is gone)
 */
export function applySplashDamage(
    state: GameState,
    projectile: Projectile,
    hitPos: Vector,
    options: { includePrimaryTarget?: boolean; airLevel?: boolean } = {}
): GameState {
    const splashRadius = projectile.splash;
    if (splashRadius <= 0) return state;

    const primaryTarget = state.entities[projectile.targetId];
    const airLevel = options.airLevel ?? (primaryTarget ? isFlyingEntity(primaryTarget) : false);

    const entities = { ...state.entities };

    // Find all entities that could be affected
    for (const id in entities) {
        const entity = entities[id];
        if (entity.dead) continue;
        if (entity.type !== 'UNIT' && entity.type !== 'BUILDING') continue;
        if (entity.type === 'UNIT' && isTransportedUnit(entity)) continue;
        // Skip the primary target - they already took direct damage
        if (id === projectile.targetId && !options.includePrimaryTarget) continue;
        if (isFlyingEntity(entity) !== airLevel) continue;

        const dist = hitPos.dist(entity.pos);
        if (dist >= splashRadius) continue;

        // Linear falloff: 100% at center, 0% at edge
        const falloff = 1 - (dist / splashRadius);
        const baseDamage = projectile.damage * falloff;

        // Apply armor modifiers
        const targetData = getRuleData(entity.key);
        const armorType = targetData?.armor || 'none';
        const weaponType = projectile.weaponType || 'bullet';
        const modifiers = RULES.damageModifiers?.[weaponType];
        const modifier = modifiers?.[armorType] ?? 1.0;

        const finalDamage = Math.round(baseDamage * modifier);
        if (finalDamage <= 0) continue;

        const newHp = Math.max(0, entity.hp - finalDamage);
        const isDead = newHp <= 0;

        if (entity.type === 'UNIT') {
            entities[id] = {
                ...entity,
                hp: newHp,
                dead: isDead,
                combat: { ...entity.combat, flash: 10 }
            };
        } else if (entity.type === 'BUILDING') {
            if (entity.combat) {
                entities[id] = {
                    ...entity,
                    hp: newHp,
                    dead: isDead,
                    combat: { ...entity.combat, flash: 10 }
                };
            } else {
                entities[id] = {
                    ...entity,
                    hp: newHp,
                    dead: isDead
                };
            }
        }
    }

    return { ...state, entities };
}

/**
 * Where an armed unit's or defense's turret points after this tick. Turrets with a traverse rate
 * (`turretTurn`) gate firing, so they turn in headless simulation too; the rest are cosmetic.
 * Idle vehicle turrets swing back over the hull while driving.
 */
function nextTurretAngle(entity: UnitEntity | Entity, entities: Record<EntityId, Entity>, headless: boolean): number {
    if (!('combat' in entity) || !entity.combat) return 0;
    const { combat } = entity;
    const rate = getTurretTurnRate(entity.key);
    if (rate === null && headless) return combat.turretAngle;

    const target = combat.targetId ? entities[combat.targetId] : undefined;
    if (target && !target.dead) {
        return stepTurret(combat.turretAngle, aimAngle(entity, target.pos), rate);
    }
    if (rate !== null && entity.type === 'UNIT' && entity.movement.currentSpeed) {
        return stepTurret(combat.turretAngle, entity.movement.rotation, rate * 0.5);
    }
    return combat.turretAngle;
}

/** This tick's visual events plus the ones still within VISUAL_EVENT_TTL (shared when nothing changed). */
function recentVisualEvents(previous: readonly VisualEvent[] | undefined, fresh: VisualEvent[], tick: number): readonly VisualEvent[] | undefined {
    const oldest = tick - VISUAL_EVENT_TTL;
    if (!previous || previous.length === 0) return fresh.length > 0 ? fresh : previous;
    if (fresh.length === 0 && previous[0].tick > oldest) return previous;
    const kept = previous[previous.length - 1].tick > oldest ? previous.filter(e => e.tick > oldest) : [];
    return kept.length > 0 ? kept.concat(fresh) : fresh;
}

/**
 * Process demo truck explosions with chain reaction support.
 * Uses breadth-first queue processing to prevent stack overflow.
 */
function processExplosions(
    entities: Record<EntityId, Entity>,
    tick: number,
    headless?: boolean,
    visualEvents?: VisualEvent[] | null
): { entities: Record<EntityId, Entity>; particles: Particle[]; explosionCount: number } {
    const explosionQueue: ExplosionEvent[] = [];
    const explodedIds = new Set<EntityId>();
    let particles: Particle[] = [];
    const updatedEntities = { ...entities };

    // Find all demo trucks that just died this tick and haven't detonated
    for (const id in updatedEntities) {
        const ent = updatedEntities[id];
        if (isDemoTruck(ent) && ent.dead && !ent.demoTruck.hasDetonated) {
            // Queue explosion
            const { damage, radius } = getDemoTruckExplosionStats();
            explosionQueue.push({
                pos: ent.pos,
                damage,
                radius,
                ownerId: ent.owner,
                sourceId: ent.id
            });
            // Mark as detonated to prevent re-queuing
            updatedEntities[id] = {
                ...ent,
                demoTruck: { ...ent.demoTruck, hasDetonated: true }
            };
            explodedIds.add(id);
        }
    }

    // Process queue breadth-first for chain reactions
    while (explosionQueue.length > 0) {
        const explosion = explosionQueue.shift()!;

        // Spawn explosion particles (skip in headless mode)
        if (!headless) {
            particles = particles.concat(spawnExplosionParticles(explosion.pos, explosion.radius));
            visualEvents?.push({
                kind: 'impact', tick, x: explosion.pos.x, y: explosion.pos.y, weaponType: 'explosion',
                archetype: 'artillery', splash: explosion.radius, damage: explosion.damage, air: false
            });
        }

        // Apply splash damage to all entities in radius
        for (const id in updatedEntities) {
            const ent = updatedEntities[id];
            // Skip dead entities, the source entity, and neutral entities
            if (ent.dead || id === explosion.sourceId || ent.owner === -1) continue;
            // Skip resources and rocks
            if (ent.type === 'RESOURCE' || ent.type === 'ROCK') continue;
            if (ent.type === 'UNIT' && isTransportedUnit(ent)) continue;

            const dist = ent.pos.dist(explosion.pos);
            const effectiveRadius = explosion.radius + ent.radius;

            if (dist <= effectiveRadius) {
                // Calculate damage with distance falloff
                const falloff = 1 - (dist / effectiveRadius);
                const baseDamage = explosion.damage * falloff;

                // Apply armor modifier
                const data = getRuleData(ent.key);
                const armorType = (data && 'armor' in data) ? (data.armor || 'none') : 'none';
                const damageModifiers = RULES.damageModifiers as Record<string, Record<string, number>>;
                const modifier = damageModifiers?.['explosion']?.[armorType] ?? 1.0;
                const finalDamage = Math.round(baseDamage * modifier);

                const prevHp = ent.hp;
                const newHp = Math.max(0, ent.hp - finalDamage);
                const nowDead = newHp <= 0;

                // Emit state-change event for explosion damage
                if (import.meta.env?.DEV && finalDamage > 0) {
                    DebugEvents.emit('state-change', {
                        tick,
                        playerId: ent.owner,
                        entityId: ent.id,
                        data: {
                            subject: ent.type === 'UNIT' ? 'unit' : 'building',
                            field: 'hp',
                            from: prevHp,
                            to: newHp,
                            cause: `explosion from ${explosion.sourceId.slice(0, 8)}`
                        }
                    });
                    if (nowDead) {
                        DebugEvents.emit('state-change', {
                            tick,
                            playerId: ent.owner,
                            entityId: ent.id,
                            data: {
                                subject: ent.type === 'UNIT' ? 'unit' : 'building',
                                field: 'dead',
                                from: false,
                                to: true,
                                cause: `explosion from ${explosion.sourceId.slice(0, 8)}`
                            }
                        });
                    }
                }

                // Update entity with damage
                if (ent.type === 'UNIT') {
                    updatedEntities[id] = {
                        ...ent,
                        hp: newHp,
                        dead: nowDead,
                        combat: {
                            ...ent.combat,
                            flash: 5
                        }
                    };
                } else if (ent.type === 'BUILDING') {
                    updatedEntities[id] = {
                        ...ent,
                        hp: newHp,
                        dead: nowDead,
                        combat: ent.combat ? { ...ent.combat, flash: 5 } : undefined
                    };
                }

                // Chain reaction: if this killed a demo truck, queue its explosion
                const updatedEnt = updatedEntities[id];
                if (nowDead && isDemoTruck(updatedEnt) && !explodedIds.has(id)) {
                    const { damage: chainDamage, radius: chainRadius } = getDemoTruckExplosionStats();
                    explosionQueue.push({
                        pos: updatedEnt.pos,
                        damage: chainDamage,
                        radius: chainRadius,
                        ownerId: updatedEnt.owner,
                        sourceId: id
                    });
                    explodedIds.add(id);
                    // Mark as detonated
                    updatedEntities[id] = {
                        ...updatedEnt,
                        demoTruck: { ...updatedEnt.demoTruck, hasDetonated: true }
                    };
                }
            }
        }
    }

    return {
        entities: updatedEntities,
        particles,
        explosionCount: explodedIds.size
    };
}

/**
 * Apply AA interception damage to a projectile.
 * Only affects interceptable projectiles (rockets, missiles, artillery).
 * Friendly AA does not intercept own team's projectiles.
 */
export function applyInterception(state: GameState, projectile: Projectile): Projectile {
    // Only intercept projectiles that have HP (are interceptable)
    if (projectile.hp <= 0 && projectile.maxHp <= 0) return projectile;
    if (projectile.dead) return projectile;

    // Get projectile owner's team
    const sourceEntity = state.entities[projectile.ownerId];
    const projectileOwner = sourceEntity?.owner ?? -1;

    let totalDamage = 0;

    // Check all entities for interception auras
    for (const id in state.entities) {
        const entity = state.entities[id];
        if (entity.dead) continue;

        // Get interception aura from rules
        const data = getRuleData(entity.key);
        const aura = data?.interceptionAura;
        if (!aura) continue;

        // Allied AA doesn't intercept allied projectiles
        if (isAlly(state, entity.owner, projectileOwner)) continue;

        // Check if projectile is in range
        const dist = projectile.pos.dist(entity.pos);
        if (dist > aura.radius) continue;

        // Apply DPS (converted to per-tick)
        totalDamage += aura.dps / 60;
    }

    if (totalDamage <= 0) return projectile;

    const newHp = projectile.hp - totalDamage;
    return {
        ...projectile,
        hp: newHp,
        dead: newHp <= 0
    };
}

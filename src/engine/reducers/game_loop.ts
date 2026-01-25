import {
    GameState, EntityId, Entity, Projectile, Particle, UnitEntity, Vector, HarvesterUnit,
    ExplosionEvent
} from '../types';
import { RULES, isUnitData } from '../../data/schemas/index';
import { getRuleData, killPlayerEntities } from './helpers';
import { setPathCacheTick, refreshCollisionGrid, syncGridsToWorker, spawnExplosionParticles } from '../utils';
import { rebuildSpatialGrid, getSpatialGrid } from '../spatial';
import { createEntityCache } from '../perf';
import { updateProduction } from './production';
import { updateWells, updateBuilding } from './buildings';
import { updateUnit } from './units';
import { updateAirUnitState, updateAirBase } from './air_units';
import { getDifficultyModifiers } from '../ai/utils';
import { isAirUnit } from '../entity-helpers';
import { isDemoTruck } from '../type-guards';
import { getDemoTruckExplosionStats } from './demo_truck';
import { DebugEvents } from '../debug/events';

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

    // PERFORMANCE: Create entity cache once per tick for optimized lookups
    const entityCache = createEntityCache(state.entities);

    // Update Production
    for (const pid in nextPlayers) {
        const res = updateProduction(nextPlayers[pid], state.entities, state, entityCache);
        nextPlayers[pid] = res.player;
        res.createdEntities.forEach(e => {
            nextEntities[e.id] = e;
        });
        // Apply modified entities (e.g., air base slots updated when harrier spawns docked)
        for (const entityId in res.modifiedEntities) {
            nextEntities[entityId] = res.modifiedEntities[entityId];
        }
    }

    // Rebuild spatial grid for updateWells usage (it needs to query nearby ores/blockers)
    rebuildSpatialGrid(nextEntities);

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
    const { entities: updatedEntities, projectiles: newProjs, creditsEarned } = updateEntities(updateState);

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

    // Projectile Updates
    let nextProjectiles: Projectile[] = [];
    let damageEvents: { targetId: EntityId; amount: number; attackerId: EntityId }[] = [];

    [...state.projectiles, ...newProjs].forEach(p => {
        const res = updateProjectile(p, updatedEntities, state.config.width, state.config.height);
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

    // Process Demo Truck Explosions (chain reactions)
    const explosionResult = processExplosions(updatedEntities, nextTick);
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
                if (entity.hp >= entity.maxHp) continue;

                // Service depot only repairs vehicles, not infantry
                const unitData = getRuleData(entity.key);
                if (!unitData || !isUnitData(unitData) || unitData.type !== 'vehicle') continue;

                // Get latest version from updatedEntities (may have been modified this tick)
                const unit = updatedEntities[entity.id];
                if (!unit || unit.type !== 'UNIT' || unit.dead || unit.hp >= unit.maxHp) continue;

                // Precise distance check
                const dist = unit.pos.dist(depot.pos);
                if (dist <= repairRadius + unit.radius) {
                    updatedEntities[entity.id] = {
                        ...unit,
                        hp: Math.min(unit.maxHp, unit.hp + repairRate)
                    };
                }
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

    // Clear command indicator after 2 seconds (120 ticks)
    const INDICATOR_DURATION = 120;
    const nextCommandIndicator = state.commandIndicator &&
        (nextTick - state.commandIndicator.startTick < INDICATOR_DURATION)
        ? state.commandIndicator
        : null;

    // Update screen shake (decay or trigger new)
    let nextCamera = state.camera;
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
    const nextParticles = [...existingParticles, ...explosionParticles];

    return {
        ...state,
        tick: nextTick,
        entities: finalEntities,
        players: nextPlayers,
        projectiles: nextProjectiles,
        particles: nextParticles,
        camera: nextCamera,
        winner: nextWinner,
        running: nextRunning,
        notification: nextNotification,
        commandIndicator: nextCommandIndicator
    };
}

export function updateEntities(state: GameState): { entities: Record<EntityId, Entity>, projectiles: Projectile[], particles: Particle[], creditsEarned: Record<number, number> } {
    let nextEntities = { ...state.entities };
    let newProjectiles: Projectile[] = [];
    let newParticles: Particle[] = [];
    let creditsEarned: Record<number, number> = {};

    // Refresh collision grid for pathfinding (passing map config for dynamic grid sizing)
    const playerIds = Object.keys(state.players).map(Number);
    refreshCollisionGrid(state.entities, state.config, playerIds);

    // Sync grids to pathfinding web worker (if enabled)
    syncGridsToWorker(playerIds);

    // NOTE: Spatial grid was already rebuilt in tick() before updateWells
    // No need to rebuild again - new ore from wells is rare and minor

    const entityList = Object.values(state.entities);

    // Pre-calculate harvester counts per resource to avoid O(N^2) loop in updateUnit
    const harvesterCounts: Record<string, number> = {};
    for (const ent of entityList) {
        if (ent.type === 'UNIT' && ent.key === 'harvester' && !ent.dead) {
            const h = ent as HarvesterUnit;
            if (h.harvester.resourceTargetId) {
                harvesterCounts[h.harvester.resourceTargetId] = (harvesterCounts[h.harvester.resourceTargetId] || 0) + 1;
            }
        }
    }

    for (const id in nextEntities) {
        const entity = nextEntities[id];
        if (entity.dead) continue;

        if (entity.type === 'UNIT') {
            // Check if this is an air unit (harrier) - use different state machine
            if (isAirUnit(entity)) {
                const airRes = updateAirUnitState(entity, state.entities, entityList);
                nextEntities[id] = airRes.entity;
                if (airRes.projectile) newProjectiles.push(airRes.projectile);
                // Apply modified entities (e.g., air base slots updated when harrier docks)
                if (airRes.modifiedEntities) {
                    for (const modId in airRes.modifiedEntities) {
                        nextEntities[modId] = airRes.modifiedEntities[modId];
                    }
                }
            } else {
                const res = updateUnit(entity, state.entities, entityList, state.config, state.tick, harvesterCounts);
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
        } else if (entity.type === 'BUILDING') {
            const res = updateBuilding(entity, state.entities, entityList);
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
                    movement: {
                        ...currentEnt.movement,
                        vel: new Vector(0, 0),
                        // Store the velocity before clearing so avgVel can track intended movement
                        lastVel: vel
                    }
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
            let combat = currentEnt.combat;
            // Update cooldown and flash for defense buildings
            if (combat.cooldown > 0 || combat.flash > 0) {
                combat = {
                    ...combat,
                    cooldown: Math.max(0, combat.cooldown - 1),
                    flash: Math.max(0, combat.flash - 1)
                };
                nextEntities[id] = { ...currentEnt, combat };
            }

            // Update turret angle to track target for defense buildings
            if (combat.targetId) {
                const target = nextEntities[combat.targetId];
                if (target && !target.dead) {
                    const deltaX = target.pos.x - currentEnt.pos.x;
                    const deltaY = target.pos.y - currentEnt.pos.y;
                    // Add π/2 offset because building turret SVGs point UP, not RIGHT
                    const targetTurretAngle = Math.atan2(deltaY, deltaX) + Math.PI / 2;

                    let angleDiff = targetTurretAngle - combat.turretAngle;
                    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
                    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

                    const newTurretAngle = combat.turretAngle + angleDiff * 0.25;
                    nextEntities[id] = {
                        ...currentEnt,
                        combat: { ...combat, turretAngle: newTurretAngle }
                    };
                }
            }
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

    return { entities: nextEntities, projectiles: newProjectiles, particles: newParticles, creditsEarned };
}

// Mutable version of Entity for collision resolution (allows position updates)
type MutableEntity = { -readonly [K in keyof Entity]: Entity[K] };

function resolveCollisions(entities: Record<EntityId, Entity>): Record<EntityId, Entity> {
    // Create a mutable lookup for working copies
    const workingEntities: Record<EntityId, MutableEntity> = {};
    const groundUnits: MutableEntity[] = [];  // Ground units only (not flying)
    const movingUnits: MutableEntity[] = []; // OPTIMIZATION: Track only units that moved

    for (const id in entities) {
        const e: MutableEntity = { ...entities[id] };
        workingEntities[id] = e;
        if (e.type === 'UNIT' && !e.dead) {
            // Skip flying units from ground collision - they fly above everything
            const unitData = getRuleData(e.key);
            const canFly = unitData && isUnitData(unitData) && unitData.fly === true;
            if (canFly) continue; // Air units don't participate in ground collision

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
                const b = workingEntities[nearbyEntity.id];
                if (!b || b.dead) continue;

                const isUnitB = b.type === 'UNIT';
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

export function updateProjectile(proj: Projectile, entities: Record<EntityId, Entity>, mapWidth: number, mapHeight: number): { proj: Projectile, damage?: { targetId: EntityId, amount: number, attackerId: EntityId } } {
    let currentVel = proj.vel;
    const target = entities[proj.targetId];

    // Homing logic for missiles (SAMs, Stealth Tanks)
    // They track their target perfectly
    if (proj.weaponType === 'missile' && target && !target.dead) {
        const speed = proj.speed || 28;
        const dir = target.pos.sub(proj.pos).norm();
        currentVel = dir.scale(speed);
    }

    const nextPos = proj.pos.add(currentVel);
    let nextProj = { ...proj, pos: nextPos, vel: currentVel };
    let damageEvent = undefined;

    // Kill projectiles that go out of bounds (with margin for edge cases)
    const MARGIN = 200;
    if (nextPos.x < -MARGIN || nextPos.x > mapWidth + MARGIN ||
        nextPos.y < -MARGIN || nextPos.y > mapHeight + MARGIN) {
        nextProj.dead = true;
        return { proj: nextProj, damage: damageEvent };
    }

    // Kill projectile if target no longer exists
    if (!target) {
        nextProj.dead = true;
        return { proj: nextProj, damage: damageEvent };
    }

    if (!target.dead) {
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
    } else if (nextPos.dist(target.pos) < 20) {
        // Target is dead, kill projectile when it reaches where target was
        nextProj.dead = true;
    }

    return { proj: nextProj, damage: damageEvent };
}

/**
 * Process demo truck explosions with chain reaction support.
 * Uses breadth-first queue processing to prevent stack overflow.
 */
function processExplosions(
    entities: Record<EntityId, Entity>,
    _tick: number
): { entities: Record<EntityId, Entity>; particles: Particle[]; explosionCount: number } {
    const explosionQueue: ExplosionEvent[] = [];
    const explodedIds = new Set<EntityId>();
    let particles: Particle[] = [];
    let updatedEntities = { ...entities };

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

        // Spawn explosion particles
        particles = particles.concat(spawnExplosionParticles(explosion.pos, explosion.radius));

        // Apply splash damage to all entities in radius
        for (const id in updatedEntities) {
            const ent = updatedEntities[id];
            // Skip dead entities, the source entity, and neutral entities
            if (ent.dead || id === explosion.sourceId || ent.owner === -1) continue;
            // Skip resources and rocks
            if (ent.type === 'RESOURCE' || ent.type === 'ROCK') continue;

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
                        tick: _tick,
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
                            tick: _tick,
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

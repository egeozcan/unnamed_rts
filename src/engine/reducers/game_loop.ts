import {
    GameState, EntityId, Entity, Projectile, Particle, UnitEntity, Vector, HarvesterUnit
} from '../types';
import { RULES, isUnitData } from '../../data/schemas/index';
import { getRuleData, killPlayerEntities } from './helpers';
import { setPathCacheTick, refreshCollisionGrid } from '../utils';
import { rebuildSpatialGrid, getSpatialGrid } from '../spatial';
import { updateProduction } from './production';
import { updateWells, updateBuilding } from './buildings';
import { updateUnit } from './units';
import { getDifficultyModifiers } from '../ai/utils';

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

    // Rebuild spatial grid for updateWells usage (it needs to query nearby ores/blockers)
    rebuildSpatialGrid(nextEntities);

    // Update Wells - spawn new ore and grow existing ore near wells
    nextEntities = updateWells(nextEntities, nextTick, state.config);

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

export function updateEntities(state: GameState): { entities: Record<EntityId, Entity>, projectiles: Projectile[], particles: Particle[], creditsEarned: Record<number, number> } {
    let nextEntities = { ...state.entities };
    let newProjectiles: Projectile[] = [];
    let newParticles: Particle[] = [];
    let creditsEarned: Record<number, number> = {};

    // Refresh collision grid for pathfinding (passing map config for dynamic grid sizing)
    refreshCollisionGrid(state.entities, state.config);

    // PERFORMANCE: Rebuild spatial grid for O(1) neighbor lookups
    rebuildSpatialGrid(state.entities);

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

export function updateProjectile(proj: Projectile, entities: Record<EntityId, Entity>): { proj: Projectile, damage?: { targetId: EntityId, amount: number, attackerId: EntityId } } {
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

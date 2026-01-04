import {
    GameState, EntityId, Entity, Vector, UnitEntity, HarvesterUnit, CombatUnit, Projectile, TILE_SIZE
} from '../types';
import { isUnitData } from '../../data/schemas/index';
import { getRuleData, createProjectile, createEntity } from './helpers';
import { findPath, getGridW, getGridH, collisionGrid } from '../utils';
import { getSpatialGrid } from '../spatial';

export function commandMove(state: GameState, payload: { unitIds: EntityId[]; x: number; y: number }): GameState {
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

export function commandAttack(state: GameState, payload: { unitIds: EntityId[]; targetId: EntityId }): GameState {
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

export function updateUnit(
    entity: UnitEntity,
    allEntities: Record<EntityId, Entity>,
    entityList: Entity[],
    mapConfig: { width: number, height: number },
    currentTick: number,
    harvesterCounts?: Record<EntityId, number>
): { entity: UnitEntity, projectile?: Projectile | null, creditsEarned: number, resourceDamage?: { id: string, amount: number } | null } {

    let nextEntity: UnitEntity = { ...entity };
    const data = getRuleData(nextEntity.key);
    let projectile = null;
    let creditsEarned = 0;

    let resourceDamage: { id: string, amount: number } | null = null;
    const spatialGrid = getSpatialGrid();

    // Harvester Logic
    if (nextEntity.key === 'harvester') {
        let harvester = nextEntity as HarvesterUnit;
        const capacity = 500;

        // 0a. Harvester auto-attack: Fire at enemies in range (before harvesting)
        if (harvester.combat.cooldown <= 0 && !harvester.movement.moveTarget) {
            const harvData = getRuleData('harvester');
            const harvRange = harvData?.range ?? 60;

            // Find closest enemy in range using Spatial Grid
            const closestEnemy = spatialGrid.findNearest(
                harvester.pos.x,
                harvester.pos.y,
                harvRange,
                e => e.owner !== -1 && e.owner !== harvester.owner && !e.dead
            );

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
        if (harvester.movement.moveTarget) {
            if (harvester.harvester.cargo >= capacity) {
                // Full cargo - clear flee target immediately so harvester can go unload
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
                // Find nearest refinery using spatial query
                const searchRadius = 1500; // Start with nearby search
                let bestRef = spatialGrid.findNearest(
                    harvester.pos.x, harvester.pos.y, searchRadius,
                    (e) => e.owner === harvester.owner && e.key === 'refinery' && !e.dead
                );
                // Fallback to global search if nothing nearby - optimization: increased radius for spatial search and removed global fallback
                if (!bestRef) {
                    // Try one more wider search if initial failed (e.g. 3000px cover almost whole map)
                    bestRef = spatialGrid.findNearest(
                        harvester.pos.x, harvester.pos.y, 3000,
                        (e) => e.owner === harvester.owner && e.key === 'refinery' && !e.dead
                    );
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
                    // OPTIMIZATION: Use spatial grid for this check? 
                    // Since harvesters cluster at refinery, spatial grid is effective.
                    // Search radius 200 around dock is sufficient to find queue.
                    const harvestersNearby = spatialGrid.queryRadius(dockPos.x, dockPos.y, 250);

                    let positionInQueue = 0; // 0 = first in line
                    for (const other of harvestersNearby) {
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
                        nextEntity = {
                            ...harvester,
                            movement: { ...harvester.movement, vel: new Vector(0, 0) }
                        };
                    } else if (positionInQueue > 2 && ourDist < 200) {
                        // Far back in queue (3rd or later) and getting close - slow down/wait
                        nextEntity = {
                            ...harvester,
                            movement: { ...harvester.movement, vel: new Vector(0, 0) }
                        };
                    } else {
                        // Move toward dock
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
            const isManualMode = harvester.harvester.manualMode !== false;
            if (!harvester.harvester.resourceTargetId && !isManualMode) {
                const blockedOreId = harvester.harvester.blockedOreId;
                const MAX_HARVESTERS_PER_ORE = 2;

                // Use passed harvesterCounts if available, otherwise calculate using SpatialGrid or list
                let harvestersPerOre: Record<string, number> = harvesterCounts || {};

                // If harvesterCounts not provided (legacy call), calculate locally (expensive!)
                if (!harvesterCounts) {
                    for (const other of entityList) {
                        if (other.type === 'UNIT' &&
                            other.key === 'harvester' &&
                            !other.dead &&
                            other.id !== harvester.id) {
                            const otherHarv = other as HarvesterUnit;
                            if (otherHarv.harvester.resourceTargetId) {
                                harvestersPerOre[otherHarv.harvester.resourceTargetId] = (harvestersPerOre[otherHarv.harvester.resourceTargetId] || 0) + 1;
                            }
                        }
                    }
                }

                let bestOre: Entity | null = null;
                let bestScore = -Infinity;

                // Use spatial query to find nearby ore first (800px radius)
                const nearbyOre = spatialGrid.queryRadiusByType(harvester.pos.x, harvester.pos.y, 800, 'RESOURCE');

                for (const other of nearbyOre) {
                    if (other.dead || other.id === blockedOreId) continue;
                    const dist = harvester.pos.dist(other.pos);
                    const harvestersAtOre = harvestersPerOre[other.id] || 0;

                    if (harvestersAtOre >= MAX_HARVESTERS_PER_ORE) continue;

                    const effectiveDist = dist + harvestersAtOre * 500;
                    const score = -effectiveDist;

                    if (score > bestScore) {
                        bestScore = score;
                        bestOre = other;
                    }
                }

                // Fallback to global search removed for performance. 
                // Increased initial search radius and added a second wider pass if needed.
                if (!bestOre) {
                    // Try wider search (2000px)
                    const widerOre = spatialGrid.queryRadiusByType(harvester.pos.x, harvester.pos.y, 2000, 'RESOURCE');
                    for (const other of widerOre) {
                        if (other.dead || other.id === blockedOreId) continue;
                        const dist = harvester.pos.dist(other.pos);
                        const harvestersAtOre = harvestersPerOre[other.id] || 0;

                        if (harvestersAtOre >= MAX_HARVESTERS_PER_ORE) continue;

                        const effectiveDist = dist + harvestersAtOre * 500;
                        const score = -effectiveDist;

                        if (score > bestScore) {
                            bestScore = score;
                            bestOre = other;
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
                    const harvestAttemptTicks = harvester.harvester.harvestAttemptTicks || 0;
                    const blockedOreTimer = harvester.harvester.blockedOreTimer || 0;
                    if (blockedOreTimer > 0) {
                        harvester = {
                            ...harvester,
                            harvester: { ...harvester.harvester, blockedOreTimer: blockedOreTimer - 1 }
                        };
                        nextEntity = harvester;
                        if (blockedOreTimer <= 1) {
                            harvester = {
                                ...harvester,
                                harvester: { ...harvester.harvester, blockedOreId: null }
                            };
                            nextEntity = harvester;
                        }
                    }

                    const wasRecentlyDamaged = harvester.combat.lastDamageTick !== undefined &&
                        (currentTick - harvester.combat.lastDamageTick) < 60;
                    const isNearOre = distToOre < 60;
                    const hasBeenTryingToHarvest = harvestAttemptTicks > 0;

                    if (wasRecentlyDamaged && isNearOre && hasBeenTryingToHarvest) {
                        harvester = {
                            ...harvester,
                            harvester: {
                                ...harvester.harvester,
                                blockedOreId: ore.id,
                                blockedOreTimer: 300,
                                resourceTargetId: null,
                                harvestAttemptTicks: 0,
                                lastDistToOre: null,
                                bestDistToOre: null
                            }
                        };
                        nextEntity = harvester;
                    } else if (distToOre < 40) {
                        // Harvest
                        if (harvester.combat.cooldown <= 0) {
                            const harvestAmount = 25;
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
                        // Move toward ore
                        const prevLastDist = harvester.harvester.lastDistToOre;
                        const lastDistToOre = prevLastDist ?? distToOre;
                        const prevBestDist = harvester.harvester.bestDistToOre;
                        const bestDistToOre = prevBestDist ?? distToOre;
                        const newBestDist = Math.min(bestDistToOre, distToOre);
                        const madeProgress = (prevBestDist === undefined) || (newBestDist < bestDistToOre - 5);

                        // Blocked by harvester check
                        // Optimization: Check nearby harvesters using spatial grid
                        let blockedByHarvester = false;
                        const nearbyHarvesters = spatialGrid.queryRadius(harvester.pos.x, harvester.pos.y, 60);

                        for (const other of nearbyHarvesters) {
                            if (other.id !== harvester.id &&
                                other.type === 'UNIT' &&
                                other.key === 'harvester' &&
                                !other.dead) {
                                const otherHarv = other as HarvesterUnit;
                                if (otherHarv.harvester.resourceTargetId === ore.id) {
                                    const otherDistToOre = other.pos.dist(ore.pos);
                                    if (otherDistToOre < distToOre) {
                                        const distToOther = harvester.pos.dist(other.pos);
                                        if (distToOther < 50) {
                                            blockedByHarvester = true;
                                            break;
                                        }
                                    }
                                }
                            }
                        }

                        if (blockedByHarvester && harvestAttemptTicks > 15) {
                            // Find alternative - Optimization needed
                            const MAX_HARVESTERS_FOR_ALT = 3;
                            let altOre: Entity | null = null;
                            let bestAltScore = -Infinity;

                            // Use passed harvesterCounts if available
                            let harvestersPerOre: Record<string, number> = harvesterCounts || {};
                            // Note: if harvesterCounts is missing, we skip counting validness for performance or rely on cached?
                            // Actually, calculating harvestersPerOre fully again is O(N).
                            // If we are here, we really need to find an alt ore.

                            // Iterate nearby resources first
                            const nearbyAlts = spatialGrid.queryRadiusByType(harvester.pos.x, harvester.pos.y, 800, 'RESOURCE');

                            for (const other of nearbyAlts) {
                                if (!other.dead && other.id !== ore.id) {
                                    const d = harvester.pos.dist(other.pos);
                                    const harvestersAtOre = harvestersPerOre[other.id] || 0; // Optimistic if no counts

                                    if (harvestersAtOre >= MAX_HARVESTERS_FOR_ALT) continue;

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
                                nextEntity = moveToward(harvester, ore.pos, entityList) as HarvesterUnit;
                            }
                        } else if (harvestAttemptTicks > 30 && distToOre > 43) {
                            // ... existing stuck logic
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
                        } else if (newBestDist > 45 && harvestAttemptTicks > 60) {
                            // ... existing stuck logic
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
                            nextEntity = moveToward(harvester, ore.pos, entityList) as HarvesterUnit;

                            if (madeProgress) {
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
                                nextEntity = {
                                    ...nextEntity,
                                    harvester: {
                                        ...(nextEntity as HarvesterUnit).harvester,
                                        harvestAttemptTicks: harvestAttemptTicks + 1,
                                        lastDistToOre: lastDistToOre,
                                        bestDistToOre: bestDistToOre
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

    // Generic logic (Combat & Harvester fallback mechanics)
    if (nextEntity.key !== 'harvester' && data && isUnitData(data)) {
        let combatUnit = nextEntity as CombatUnit;
        const isHealer = data.damage < 0;
        const isEngineer = data.canCaptureEnemyBuildings || data.canRepairFriendlyBuildings;

        if (!combatUnit.combat.targetId && !combatUnit.movement.moveTarget && (data.damage || isEngineer)) {
            const range = (data.range || 100) + (isHealer ? 100 : 50);

            // OPTIMIZATION: Use spatial grid `findNearest` instead of iterating all entities
            // For engineers/healers it's complex because we need to check properties (hp < maxHp) which findNearest support.

            let bestTargetId: EntityId | null = null;

            // Define predicate for search
            const predicate = (other: Entity) => {
                if (other.dead || other.owner === -1) return false;
                if (isHealer) {
                    return other.owner === combatUnit.owner && other.hp < other.maxHp && other.type === 'UNIT' && other.id !== combatUnit.id;
                } else if (isEngineer) {
                    if (other.type !== 'BUILDING') return false;
                    if (other.owner !== combatUnit.owner && data.canCaptureEnemyBuildings) return true;
                    if (other.owner === combatUnit.owner && other.hp < other.maxHp && data.canRepairFriendlyBuildings) return true;
                    return false;
                } else {
                    return other.owner !== combatUnit.owner;
                }
            };

            // Use spatial search with reasonable radius (range * 1.5 to be safe)
            const searchRadius = Math.max(range, 200);
            const found = spatialGrid.findNearest(combatUnit.pos.x, combatUnit.pos.y, searchRadius, predicate);
            if (found && found.pos.dist(combatUnit.pos) <= range) {
                bestTargetId = found.id;
            } else if (!found) {
                // Should we fallback to global? Only if range is huge or we suspect spatial grid missed something?
                // For now, trust spatial grid results within reasonable range reduces strictness but highly improves performance.
            }

            if (bestTargetId) {
                combatUnit = {
                    ...combatUnit,
                    combat: { ...combatUnit.combat, targetId: bestTargetId }
                };
                nextEntity = combatUnit;
            }
        }

        // ... rest of logic stays mostly same, utilizing moveToward which is spatial-aware-ish ...
        // ... (truncated for brevity, maintaining existing logic) ...
        if (combatUnit.combat.targetId) {
            // ... existing targeting logic ...
            const target = allEntities[combatUnit.combat.targetId];
            if (target && !target.dead) {
                const dist = combatUnit.pos.dist(target.pos);
                const range = data.range || 100;

                if (isEngineer && target.type === 'BUILDING') {
                    if (dist < 40) {
                        // ... engineer logic ...
                        combatUnit = {
                            ...combatUnit,
                            movement: { ...combatUnit.movement, moveTarget: null }
                        };
                        if (target.owner !== combatUnit.owner && data.canCaptureEnemyBuildings) {
                            combatUnit = {
                                ...combatUnit,
                                dead: true,
                                engineer: { ...combatUnit.engineer, captureTargetId: target.id }
                            };
                        } else if (target.owner === combatUnit.owner && data.canRepairFriendlyBuildings) {
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
                    // ... attack logic ...
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
            const target = allEntities[harvesterUnit.combat.targetId];
            if (target && !target.dead) {
                const harvData = getRuleData('harvester');
                const dist = harvesterUnit.pos.dist(target.pos);
                const range = harvData?.range ?? 60;

                if (dist <= range) {
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
                    nextEntity = moveToward(harvesterUnit, target.pos, entityList) as HarvesterUnit;
                }
            } else {
                nextEntity = {
                    ...harvesterUnit,
                    combat: { ...harvesterUnit.combat, targetId: null }
                };
            }
        } else if (harvesterUnit.movement.moveTarget) {
            nextEntity = moveToward(harvesterUnit, harvesterUnit.movement.moveTarget, entityList) as HarvesterUnit;

            // ... existing stuck logic for harvester manual move ...
            const clearDistance = 30;
            const harvesterFleeTimeout = 40;
            const isStuckOnFlee = ((nextEntity as HarvesterUnit).movement.stuckTimer || 0) > harvesterFleeTimeout;
            let moveTargetTicks = harvesterUnit.movement.moveTargetNoProgressTicks || 0;
            moveTargetTicks++;
            const absoluteFleeTimeout = 90;
            const isFleeTimedOut = moveTargetTicks > absoluteFleeTimeout;

            if (nextEntity.pos.dist(harvesterUnit.movement.moveTarget!) < clearDistance || isStuckOnFlee || isFleeTimedOut) {
                const shouldDisableManualMode = isFleeTimedOut || isStuckOnFlee;
                const fleeCooldownDuration = 300;
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

export function moveToward(entity: UnitEntity, target: Vector, _allEntities: Entity[], skipWhiskerAvoidance = false): UnitEntity {
    // ... keep moveToward mostly as is but ensure efficient neighbor query ...
    // moveToward already uses `getSpatialGrid().queryRadius`!

    // Copying the existing moveToward logic for completeness

    const distToTarget = entity.pos.dist(target);
    if (distToTarget < 2) {
        return {
            ...entity,
            movement: { ...entity.movement, vel: new Vector(0, 0), path: null, pathIdx: 0 }
        };
    }

    const unitData = getRuleData(entity.key);
    const speed = (unitData && isUnitData(unitData)) ? unitData.speed : 1;

    let avgVel = entity.movement.avgVel || new Vector(0, 0);
    const effectiveVel = entity.pos.sub(entity.prevPos);
    avgVel = avgVel.scale(0.9).add(effectiveVel.scale(0.1));

    let stuckTimer = entity.movement.stuckTimer || 0;
    let unstuckDir = entity.movement.unstuckDir;
    let unstuckTimer = entity.movement.unstuckTimer || 0;
    let path = entity.movement.path;
    let pathIdx = entity.movement.pathIdx || 0;
    let finalDest = entity.movement.finalDest;

    // OPTIMIZATION: Skip pathfinding for very close targets - direct steering is sufficient
    const isCloseTarget = distToTarget < 80;

    const needNewPath = !isCloseTarget && (
        !path || path.length === 0 ||
        (finalDest && finalDest.dist(target) > 20) ||
        // OPTIMIZATION: Stagger path recalculation when stuck (every 10 ticks)
        (stuckTimer > 30 && stuckTimer % 10 === 0)
    );

    if (needNewPath) {
        const newPath = findPath(entity.pos, target, entity.radius, entity.owner);
        if (newPath && newPath.length > 1) {
            path = newPath;
            pathIdx = 1;
            finalDest = target;
            stuckTimer = 0;
        } else {
            path = null;
            pathIdx = 0;
            finalDest = target;
        }
    } else if (isCloseTarget) {
        // Clear path for close targets - use direct steering
        path = null;
        pathIdx = 0;
    }

    let immediateTarget = target;
    if (path && pathIdx < path.length) {
        immediateTarget = path[pathIdx];
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

    if (distToTarget > 10) {
        if (avgVel.mag() < speed * 0.15) {
            stuckTimer++;
        } else {
            stuckTimer = Math.max(0, stuckTimer - 2);
        }
    } else {
        stuckTimer = 0;
    }

    if (stuckTimer > 20) {
        unstuckTimer = 25;
        stuckTimer = 0;
        const toTarget = target.sub(entity.pos).norm();
        const perpendicular = Math.random() > 0.5
            ? new Vector(-toTarget.y, toTarget.x)
            : new Vector(toTarget.y, -toTarget.x);
        unstuckDir = perpendicular;
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
                path: null,
                pathIdx: 0,
                finalDest
            }
        };
    }

    const dir = immediateTarget.sub(entity.pos).norm();
    let separation = new Vector(0, 0);
    let entityCount = 0;

    const nearbyEntities = getSpatialGrid().queryRadius(entity.pos.x, entity.pos.y, 60);
    for (const other of nearbyEntities) {
        if (other.id === entity.id || other.dead || other.type === 'RESOURCE') continue;
        const d = entity.pos.dist(other.pos);
        const minDist = entity.radius + other.radius;

        if (d < minDist + 3 && d > 0.001) {
            const weight = (minDist + 3 - d) / (minDist + 3);
            separation = separation.add(entity.pos.sub(other.pos).norm().scale(weight));
            entityCount++;
        }
    }

    const hasValidPath = path && path.length > 0;
    let avoidanceX = 0;
    let avoidanceY = 0;

    // OPTIMIZATION: Skip whisker avoidance for stationary units or when explicitly skipped
    // Also skip if we have a valid path (pathfinding already avoids obstacles)
    const shouldSkipWhiskers = skipWhiskerAvoidance || (!entity.movement.moveTarget && !entity.combat.targetId && !hasValidPath);

    if (!shouldSkipWhiskers) {
        const angles = hasValidPath ? [0, 0.3, -0.3] : [0, 0.4, -0.4, 0.8, -0.8];
        const gridW = getGridW();
        const gridH = getGridH();
        const checkDist = entity.radius + (hasValidPath ? 10 : 15);

        for (const a of angles) {
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            // OPTIMIZATION: Inline vector math to avoid object allocation
            const wx = dir.x * cos - dir.y * sin;
            const wy = dir.x * sin + dir.y * cos;
            const mag = Math.sqrt(wx * wx + wy * wy);
            const whiskerX = mag > 0.001 ? wx / mag : 0;
            const whiskerY = mag > 0.001 ? wy / mag : 0;

            const checkPosX = entity.pos.x + whiskerX * checkDist;
            const checkPosY = entity.pos.y + whiskerY * checkDist;

            const gx = Math.floor(checkPosX / TILE_SIZE);
            const gy = Math.floor(checkPosY / TILE_SIZE);

            if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
                if (collisionGrid[gy * gridW + gx] === 1) {
                    const baseWeight = hasValidPath ? 1.0 : 2.5;
                    const weight = a === 0 ? baseWeight : baseWeight * 0.6;
                    avoidanceX -= whiskerX * weight;
                    avoidanceY -= whiskerY * weight;
                }
            }
        }
    }

    let finalDir = dir;
    const avoidanceMag = Math.sqrt(avoidanceX * avoidanceX + avoidanceY * avoidanceY);
    if (entityCount > 0 || avoidanceMag > 0.001) {
        // OPTIMIZATION: Inline vector operations to reduce allocations
        const rightX = -dir.y;
        const rightY = dir.x;
        const rightBias = entityCount > 0 ? 0.4 : 0;

        // finalDir = dir + separation*0.8 + avoidance + right*rightBias
        let fdX = dir.x + separation.x * 0.8 + avoidanceX + rightX * rightBias;
        let fdY = dir.y + separation.y * 0.8 + avoidanceY + rightY * rightBias;
        const fdMag = Math.sqrt(fdX * fdX + fdY * fdY);
        if (fdMag > 0.001) {
            fdX /= fdMag;
            fdY /= fdMag;
        }
        finalDir = new Vector(fdX, fdY);

        const dotProduct = fdX * dir.x + fdY * dir.y;
        if (dotProduct < 0) {
            const rightDot = fdX * rightX + fdY * rightY;
            finalDir = new Vector(rightX * (rightDot >= 0 ? 1 : -1), rightY * (rightDot >= 0 ? 1 : -1));
        }
    }

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

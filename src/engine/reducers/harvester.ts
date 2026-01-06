import {
    EntityId, Entity, Vector, HarvesterUnit, Projectile
} from '../types';
import { getRuleData, createProjectile } from './helpers';
import { getSpatialGrid } from '../spatial';
import { moveToward } from './movement';

/**
 * Update harvester unit behavior - handles auto-attack, cargo management, 
 * resource targeting, and refinery docking.
 * 
 * Extracted from updateUnit for better maintainability.
 */
export function updateHarvesterBehavior(
    harvester: HarvesterUnit,
    allEntities: Record<EntityId, Entity>,
    entityList: Entity[],
    mapConfig: { width: number, height: number },
    currentTick: number,
    harvesterCounts?: Record<EntityId, number>
): { entity: HarvesterUnit, projectile?: Projectile | null, creditsEarned: number, resourceDamage?: { id: string, amount: number } | null } {

    let nextEntity: HarvesterUnit = { ...harvester };
    let projectile: Projectile | null = null;
    let creditsEarned = 0;
    let resourceDamage: { id: string, amount: number } | null = null;

    const spatialGrid = getSpatialGrid();
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
            nextEntity = {
                ...nextEntity,
                combat: { ...nextEntity.combat, cooldown: harvData?.rate ?? 30 }
            };
        }
    }

    // 0b. If manual move (flee/player command), skip automated logic
    if (nextEntity.movement.moveTarget) {
        if (nextEntity.harvester.cargo >= capacity) {
            // Full cargo - clear flee target immediately so harvester can go unload
            nextEntity = {
                ...nextEntity,
                movement: { ...nextEntity.movement, moveTarget: null, path: null, pathIdx: 0 }
            };
        }
        // Otherwise, fall through to generic move logic (allow fleeing with low cargo)
    }
    // 1. If full, return to refinery
    else if (nextEntity.harvester.cargo >= capacity) {
        nextEntity = handleFullCargo(nextEntity, allEntities, entityList, mapConfig, spatialGrid);
        if (nextEntity.harvester.cargo === 0) {
            creditsEarned = 500;
        }
    }
    // 2. If valid resource target, go gather
    else {
        const result = handleGathering(nextEntity, allEntities, entityList, currentTick, harvesterCounts, spatialGrid);
        nextEntity = result.entity;
        resourceDamage = result.resourceDamage;
    }

    return { entity: nextEntity, projectile, creditsEarned, resourceDamage };
}

/**
 * Handle harvester returning to refinery with full cargo
 */
function handleFullCargo(
    harvester: HarvesterUnit,
    allEntities: Record<EntityId, Entity>,
    entityList: Entity[],
    mapConfig: { width: number, height: number },
    spatialGrid: ReturnType<typeof getSpatialGrid>
): HarvesterUnit {
    let nextHarvester = {
        ...harvester,
        harvester: { ...harvester.harvester, resourceTargetId: null }
    };

    if (!nextHarvester.harvester.baseTargetId) {
        // Find nearest refinery using spatial query
        const searchRadius = 1500;
        let bestRef = spatialGrid.findNearest(
            nextHarvester.pos.x, nextHarvester.pos.y, searchRadius,
            (e) => e.owner === nextHarvester.owner && e.key === 'refinery' && !e.dead
        );
        // Fallback to wider search if nothing nearby
        if (!bestRef) {
            bestRef = spatialGrid.findNearest(
                nextHarvester.pos.x, nextHarvester.pos.y, 3000,
                (e) => e.owner === nextHarvester.owner && e.key === 'refinery' && !e.dead
            );
        }
        if (bestRef) {
            nextHarvester = {
                ...nextHarvester,
                harvester: { ...nextHarvester.harvester, baseTargetId: bestRef.id }
            };
        }
    }

    if (nextHarvester.harvester.baseTargetId) {
        const ref = allEntities[nextHarvester.harvester.baseTargetId];
        if (ref && !ref.dead) {
            // Target "Docking Point" (bottom of refinery)
            // Clamp dock position to map bounds to prevent pathfinding issues
            const rawDockPos = ref.pos.add(new Vector(0, 100));
            const dockPos = new Vector(
                Math.max(0, Math.min(mapConfig.width - 1, rawDockPos.x)),
                Math.max(0, Math.min(mapConfig.height - 1, rawDockPos.y))
            );
            const ourDist = nextHarvester.pos.dist(dockPos);

            // Check queue position using spatial grid
            const harvestersNearby = spatialGrid.queryRadius(dockPos.x, dockPos.y, 250);

            let positionInQueue = 0;
            for (const other of harvestersNearby) {
                if (other.id !== nextHarvester.id &&
                    other.type === 'UNIT' &&
                    other.key === 'harvester' &&
                    other.owner === nextHarvester.owner &&
                    !other.dead) {
                    const otherHarv = other as HarvesterUnit;
                    if (otherHarv.harvester.cargo > 0 &&
                        otherHarv.harvester.baseTargetId === nextHarvester.harvester.baseTargetId &&
                        otherHarv.movement.moveTarget === null) {
                        const otherDist = other.pos.dist(dockPos);
                        if (otherDist < ourDist) {
                            positionInQueue++;
                        }
                    }
                }
            }

            if (ourDist < 20 && positionInQueue === 0) {
                // We're at dock and first in line - Unload
                return {
                    ...nextHarvester,
                    harvester: { ...nextHarvester.harvester, cargo: 0, baseTargetId: null }
                };
            } else if (positionInQueue > 0 && ourDist < 80) {
                // Someone is ahead of us and we're near dock - wait stationary
                return {
                    ...nextHarvester,
                    movement: { ...nextHarvester.movement, vel: new Vector(0, 0) }
                };
            } else if (positionInQueue > 2 && ourDist < 200) {
                // Far back in queue - slow down/wait
                return {
                    ...nextHarvester,
                    movement: { ...nextHarvester.movement, vel: new Vector(0, 0) }
                };
            } else {
                // Move toward dock
                const skipWhiskers = ourDist < 80;
                return moveToward(nextHarvester, dockPos, entityList, skipWhiskers) as HarvesterUnit;
            }
        } else {
            return {
                ...nextHarvester,
                harvester: { ...nextHarvester.harvester, baseTargetId: null }
            };
        }
    }

    return nextHarvester;
}

/**
 * Handle harvester finding and gathering resources
 */
function handleGathering(
    harvester: HarvesterUnit,
    allEntities: Record<EntityId, Entity>,
    entityList: Entity[],
    currentTick: number,
    harvesterCounts?: Record<EntityId, number>,
    spatialGrid?: ReturnType<typeof getSpatialGrid>
): { entity: HarvesterUnit, resourceDamage: { id: string, amount: number } | null } {

    let nextHarvester = harvester;
    let resourceDamage: { id: string, amount: number } | null = null;
    const grid = spatialGrid || getSpatialGrid();

    const isManualMode = nextHarvester.harvester.manualMode !== false;

    // Find a resource target if we don't have one
    if (!nextHarvester.harvester.resourceTargetId && !isManualMode) {
        nextHarvester = findResourceTarget(nextHarvester, entityList, harvesterCounts, grid);
    }

    // Handle moving to and harvesting from resource
    if (nextHarvester.harvester.resourceTargetId) {
        const ore = allEntities[nextHarvester.harvester.resourceTargetId];
        if (ore && !ore.dead) {
            const result = handleHarvestingFromOre(nextHarvester, ore, entityList, currentTick, harvesterCounts, grid);
            nextHarvester = result.entity;
            resourceDamage = result.resourceDamage;
        } else {
            nextHarvester = {
                ...nextHarvester,
                harvester: { ...nextHarvester.harvester, resourceTargetId: null, harvestAttemptTicks: 0 }
            };
        }
    }

    return { entity: nextHarvester, resourceDamage };
}

/**
 * Find a nearby resource target for the harvester
 */
function findResourceTarget(
    harvester: HarvesterUnit,
    entityList: Entity[],
    harvesterCounts?: Record<EntityId, number>,
    spatialGrid?: ReturnType<typeof getSpatialGrid>
): HarvesterUnit {
    const grid = spatialGrid || getSpatialGrid();
    const blockedOreId = harvester.harvester.blockedOreId;
    const MAX_HARVESTERS_PER_ORE = 2;

    // Use passed harvesterCounts if available, otherwise calculate locally
    let harvestersPerOre: Record<string, number> = harvesterCounts || {};

    if (!harvesterCounts) {
        for (const other of entityList) {
            if (other.type === 'UNIT' &&
                other.key === 'harvester' &&
                !other.dead &&
                other.id !== harvester.id) {
                const otherHarv = other as HarvesterUnit;
                if (otherHarv.harvester.resourceTargetId) {
                    harvestersPerOre[otherHarv.harvester.resourceTargetId] =
                        (harvestersPerOre[otherHarv.harvester.resourceTargetId] || 0) + 1;
                }
            }
        }
    }

    let bestOre: Entity | null = null;
    let bestScore = -Infinity;

    // Use spatial query to find nearby ore first (800px radius)
    const nearbyOre = grid.queryRadiusByType(harvester.pos.x, harvester.pos.y, 800, 'RESOURCE');

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

    // Fallback: wider search if nothing nearby
    if (!bestOre) {
        const widerOre = grid.queryRadiusByType(harvester.pos.x, harvester.pos.y, 2000, 'RESOURCE');
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
        return {
            ...harvester,
            harvester: { ...harvester.harvester, resourceTargetId: bestOre.id }
        };
    }

    return harvester;
}

/**
 * Handle the actual harvesting process once at a resource
 */
function handleHarvestingFromOre(
    harvester: HarvesterUnit,
    ore: Entity,
    entityList: Entity[],
    currentTick: number,
    harvesterCounts?: Record<EntityId, number>,
    spatialGrid?: ReturnType<typeof getSpatialGrid>
): { entity: HarvesterUnit, resourceDamage: { id: string, amount: number } | null } {

    const grid = spatialGrid || getSpatialGrid();
    let nextHarvester = harvester;

    const distToOre = harvester.pos.dist(ore.pos);
    const harvestAttemptTicks = harvester.harvester.harvestAttemptTicks || 0;
    const blockedOreTimer = harvester.harvester.blockedOreTimer || 0;

    // Handle blocked ore cooldown
    if (blockedOreTimer > 0) {
        nextHarvester = {
            ...nextHarvester,
            harvester: { ...nextHarvester.harvester, blockedOreTimer: blockedOreTimer - 1 }
        };
        if (blockedOreTimer <= 1) {
            nextHarvester = {
                ...nextHarvester,
                harvester: { ...nextHarvester.harvester, blockedOreId: null }
            };
        }
    }

    const wasRecentlyDamaged = harvester.combat.lastDamageTick !== undefined &&
        (currentTick - harvester.combat.lastDamageTick) < 60;
    const isNearOre = distToOre < 60;
    const hasBeenTryingToHarvest = harvestAttemptTicks > 0;

    // Contested ore - mark as blocked and find alternative
    if (wasRecentlyDamaged && isNearOre && hasBeenTryingToHarvest) {
        return {
            entity: {
                ...nextHarvester,
                harvester: {
                    ...nextHarvester.harvester,
                    blockedOreId: ore.id,
                    blockedOreTimer: 300,
                    resourceTargetId: null,
                    harvestAttemptTicks: 0,
                    lastDistToOre: null,
                    bestDistToOre: null
                }
            },
            resourceDamage: null
        };
    }

    // Close enough to harvest
    if (distToOre < 40) {
        if (harvester.combat.cooldown <= 0) {
            const harvestAmount = 25;
            const actualHarvest = Math.min(harvestAmount, ore.hp);

            return {
                entity: {
                    ...nextHarvester,
                    combat: { ...nextHarvester.combat, cooldown: 30 },
                    harvester: {
                        ...nextHarvester.harvester,
                        cargo: nextHarvester.harvester.cargo + actualHarvest,
                        harvestAttemptTicks: 0
                    }
                },
                resourceDamage: { id: ore.id, amount: actualHarvest }
            };
        }
        return { entity: nextHarvester, resourceDamage: null };
    }

    // Need to move toward ore
    return handleMoveToOre(nextHarvester, ore, entityList, harvestAttemptTicks, harvesterCounts, grid);
}

/**
 * Handle moving toward ore, including stuck detection and alternative finding
 */
function handleMoveToOre(
    harvester: HarvesterUnit,
    ore: Entity,
    entityList: Entity[],
    harvestAttemptTicks: number,
    harvesterCounts?: Record<EntityId, number>,
    spatialGrid?: ReturnType<typeof getSpatialGrid>
): { entity: HarvesterUnit, resourceDamage: { id: string, amount: number } | null } {

    const grid = spatialGrid || getSpatialGrid();
    const distToOre = harvester.pos.dist(ore.pos);

    const prevLastDist = harvester.harvester.lastDistToOre;
    const lastDistToOre = prevLastDist ?? distToOre;
    const prevBestDist = harvester.harvester.bestDistToOre;
    const bestDistToOre = prevBestDist ?? distToOre;
    const newBestDist = Math.min(bestDistToOre, distToOre);
    const madeProgress = (prevBestDist === undefined) || (newBestDist < bestDistToOre - 5);

    // Check if blocked by another harvester
    let blockedByHarvester = false;
    const nearbyHarvesters = grid.queryRadius(harvester.pos.x, harvester.pos.y, 60);

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

    // Blocked by another harvester - try to find alternative ore
    if (blockedByHarvester && harvestAttemptTicks > 15) {
        const altOre = findAlternativeOre(harvester, ore.id, harvesterCounts, grid);
        if (altOre) {
            return {
                entity: {
                    ...harvester,
                    movement: { ...harvester.movement, path: null, pathIdx: 0 },
                    harvester: {
                        ...harvester.harvester,
                        resourceTargetId: altOre.id,
                        harvestAttemptTicks: 0,
                        lastDistToOre: null,
                        bestDistToOre: null
                    }
                },
                resourceDamage: null
            };
        }
    }

    // Stuck for too long - give up on this ore
    if (harvestAttemptTicks > 30 && distToOre > 43) {
        return {
            entity: {
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
            },
            resourceDamage: null
        };
    }

    // Same, but tracking best distance progress
    if (newBestDist > 45 && harvestAttemptTicks > 60) {
        return {
            entity: {
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
            },
            resourceDamage: null
        };
    }

    // Normal movement toward ore
    let nextEntity = moveToward(harvester, ore.pos, entityList) as HarvesterUnit;

    if (madeProgress) {
        nextEntity = {
            ...nextEntity,
            harvester: {
                ...nextEntity.harvester,
                harvestAttemptTicks: 0,
                lastDistToOre: distToOre,
                bestDistToOre: newBestDist
            }
        };
    } else {
        nextEntity = {
            ...nextEntity,
            harvester: {
                ...nextEntity.harvester,
                harvestAttemptTicks: harvestAttemptTicks + 1,
                lastDistToOre: lastDistToOre,
                bestDistToOre: bestDistToOre
            }
        };
    }

    return { entity: nextEntity, resourceDamage: null };
}

/**
 * Find an alternative ore patch when blocked at current one
 */
function findAlternativeOre(
    harvester: HarvesterUnit,
    currentOreId: EntityId,
    harvesterCounts?: Record<EntityId, number>,
    spatialGrid?: ReturnType<typeof getSpatialGrid>
): Entity | null {
    const grid = spatialGrid || getSpatialGrid();
    const MAX_HARVESTERS_FOR_ALT = 3;
    const harvestersPerOre: Record<string, number> = harvesterCounts || {};

    let altOre: Entity | null = null;
    let bestAltScore = -Infinity;

    const nearbyAlts = grid.queryRadiusByType(harvester.pos.x, harvester.pos.y, 800, 'RESOURCE');

    for (const other of nearbyAlts) {
        if (!other.dead && other.id !== currentOreId) {
            const d = harvester.pos.dist(other.pos);
            const harvestersAtOre = harvestersPerOre[other.id] || 0;

            if (harvestersAtOre >= MAX_HARVESTERS_FOR_ALT) continue;

            const effectiveDist = d + harvestersAtOre * 100;
            const score = -effectiveDist;
            if (score > bestAltScore) {
                bestAltScore = score;
                altOre = other;
            }
        }
    }

    return altOre;
}

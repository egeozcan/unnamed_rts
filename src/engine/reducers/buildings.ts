import {
    GameState, EntityId, Entity, BuildingEntity, HarvesterUnit, ResourceEntity, WellEntity, Vector, Projectile, MapConfig
} from '../types';
import { RULES, isBuildingData, isUnitData } from '../../data/schemas/index';
import { createEntity, getRuleData, createProjectile, killPlayerEntities } from './helpers';
import { getSpatialGrid } from '../spatial';

export function placeBuilding(state: GameState, payload: { key: string; x: number; y: number; playerId: number }): GameState {
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

export function sellBuilding(state: GameState, payload: { buildingId: EntityId; playerId: number }): GameState {
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

export function startRepair(state: GameState, payload: { buildingId: EntityId; playerId: number }): GameState {
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

export function stopRepair(state: GameState, payload: { buildingId: EntityId; playerId: number }): GameState {
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

export function updateBuilding(entity: BuildingEntity, allEntities: Record<EntityId, Entity>, _entityList: Entity[]): { entity: BuildingEntity, projectile?: Projectile | null } {
    let nextEntity: BuildingEntity = { ...entity };
    const data = getRuleData(nextEntity.key);
    let projectile = null;
    const spatialGrid = getSpatialGrid();

    // Only process defense buildings (buildings with isDefense flag and combat component)
    if (data && isBuildingData(data) && data.isDefense && nextEntity.combat) {
        if (!nextEntity.combat.targetId) {
            const range = data.range || 200;
            let bestTargetId: EntityId | null = null;
            let targetIsAir = false;

            // Use spatial grid to query enemies in range
            const enemiesInRange = spatialGrid.queryEnemiesInRadius(entity.pos.x, entity.pos.y, range, entity.owner);

            for (const other of enemiesInRange) {
                if (other.dead) continue;
                // Double check specific distance
                if (entity.pos.dist(other.pos) > range) continue;

                const otherData = getRuleData(other.key);
                const isAir = otherData && isUnitData(otherData) && otherData.fly === true;

                if (nextEntity.key === 'sam_site') {
                    if (isAir && !targetIsAir) {
                        bestTargetId = other.id;
                        targetIsAir = true;
                    } else if (!bestTargetId) {
                        // Fallback for SAM site (ideally shouldn't shoot ground but if rules allow?)
                        // Assuming SAM site prefers air but can shoot ground? 
                        // Or if SAM site ONLY shoots air, we should enforce that.
                        // For now, mirroring previous logic which just prioritized air.
                        bestTargetId = other.id;
                    }
                } else {
                    // Default: take first target in range
                    bestTargetId = other.id;
                    break;
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

/**
 * Update ore wells - spawn new ore around wells and grow existing ore.
 */
export function updateWells(
    entities: Record<EntityId, Entity>,
    tick: number,
    config: MapConfig
): Record<EntityId, Entity> {
    const wellConfig = RULES.wells?.well;
    if (!wellConfig) return entities;

    // Use Spatial Grid to find nearby ores optimistically
    const spatialGrid = getSpatialGrid();

    let nextEntities = { ...entities };

    // Process each well
    for (const id in nextEntities) {
        const entity = nextEntities[id];
        if (entity.type !== 'WELL' || entity.dead) continue;

        const well = entity as WellEntity;

        // Group nearby ores
        const nearbyOres: ResourceEntity[] = [];
        const fillableOres: ResourceEntity[] = [];

        // OPTIMIZATION: Query specifically for RESOURCE type near the well
        const candidates = spatialGrid.queryRadiusByType(well.pos.x, well.pos.y, wellConfig.oreSpawnRadius + 20, 'RESOURCE');

        for (const other of candidates) {
            if (!other.dead) {
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
                    // OPTIMIZATION: Use spatial grid to check ONLY nearby blockers
                    const blockers = spatialGrid.queryRadius(testPos.x, testPos.y, oreRadius + 60);
                    let collides = false;
                    for (const blocker of blockers) {
                        if (blocker.dead) continue;
                        if (blocker.type === 'UNIT' || blocker.type === 'BUILDING') {
                            const dist = testPos.dist(blocker.pos);
                            if (dist < oreRadius + blocker.radius) {
                                collides = true;
                                break;
                            }
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

/**
 * Pure utility functions for game logic.
 * These are separated from game.ts to enable unit testing without DOM dependencies.
 */

import { GameState, Vector, EntityId, Entity, ResourceEntity, RockEntity, WellEntity, SkirmishConfig, MAP_SIZES, DENSITY_SETTINGS, WELL_DENSITY_SETTINGS, HarvesterUnit } from './engine/types.js';
import { isHarvester } from './engine/type-guards.js';
import { createDefaultWellComponent } from './engine/entity-helpers.js';
import { RULES } from './data/schemas/index.js';

/**
 * Get starting positions for players based on map size.
 * Uses octagonal layout for 8 players (corners + mid-edges).
 */
export function getStartingPositions(mapWidth: number, mapHeight: number, numPlayers: number): Vector[] {
    const margin = 350; // Distance from edge
    const centerX = mapWidth / 2;
    const centerY = mapHeight / 2;

    // 8 positions: corners + mid-edges for maximum spacing
    const positions = [
        new Vector(margin, margin),                          // Top-left (0)
        new Vector(mapWidth - margin, mapHeight - margin),   // Bottom-right (1)
        new Vector(mapWidth - margin, margin),               // Top-right (2)
        new Vector(margin, mapHeight - margin),              // Bottom-left (3)
        new Vector(centerX, margin),                         // Top-center (4)
        new Vector(centerX, mapHeight - margin),             // Bottom-center (5)
        new Vector(margin, centerY),                         // Left-center (6)
        new Vector(mapWidth - margin, centerY)               // Right-center (7)
    ];
    return positions.slice(0, numPlayers);
}

/**
 * Reconstruct Vector objects from plain {x, y} objects when loading game state from JSON.
 */
export function reconstructVectors(state: GameState): GameState {
    // Deep clone and reconstruct vectors
    const entities: Record<EntityId, Entity> = {};
    for (const id in state.entities) {
        const e = state.entities[id];
        const base = {
            ...e,
            pos: new Vector(e.pos.x, e.pos.y),
            prevPos: new Vector(e.prevPos.x, e.prevPos.y)
        };

        if (e.type === 'UNIT') {
            // Reconstruct movement component vectors
            const movement = e.movement ? {
                ...e.movement,
                vel: e.movement.vel ? new Vector(e.movement.vel.x, e.movement.vel.y) : new Vector(0, 0),
                moveTarget: e.movement.moveTarget ? new Vector(e.movement.moveTarget.x, e.movement.moveTarget.y) : null,
                finalDest: e.movement.finalDest ? new Vector(e.movement.finalDest.x, e.movement.finalDest.y) : null,
                unstuckDir: e.movement.unstuckDir ? new Vector(e.movement.unstuckDir.x, e.movement.unstuckDir.y) : null,
                path: e.movement.path ? e.movement.path.map((p: { x: number, y: number }) => new Vector(p.x, p.y)) : null,
                avgVel: e.movement.avgVel ? new Vector(e.movement.avgVel.x, e.movement.avgVel.y) : undefined
            } : e.movement;

            // Reconstruct harvester component vectors if present
            if (isHarvester(e)) {
                const harvester = e.harvester.dockPos ? {
                    ...e.harvester,
                    dockPos: new Vector(e.harvester.dockPos.x, e.harvester.dockPos.y)
                } : e.harvester;
                entities[id] = { ...base, movement, harvester } as HarvesterUnit;
            } else {
                entities[id] = { ...base, movement } as Entity;
            }
        } else {
            entities[id] = base as Entity;
        }
    }

    return {
        ...state,
        entities,
        camera: { x: state.camera.x, y: state.camera.y }
    };
}

/**
 * Calculate power production and consumption for a specific player.
 */
export function calculatePower(pid: number, entities: Record<EntityId, Entity>): { in: number; out: number } {
    let p = { in: 0, out: 0 };
    for (const id in entities) {
        const e = entities[id];
        if (e.owner === pid && !e.dead) {
            const data = RULES.buildings[e.key];
            if (data) {
                if (data.power) p.out += data.power;
                if (data.drain) p.in += data.drain;
            }
        }
    }
    return p;
}

function generateMirroredTwoPlayerEntities(
    mapWidth: number,
    mapHeight: number,
    resourceCount: number,
    rockCount: number,
    wellCount: number,
    spawnZones: Vector[]
): Record<EntityId, Entity> {
    const entities: Record<EntityId, Entity> = {};
    const centerX = mapWidth / 2;
    const centerY = mapHeight / 2;
    const spawnRadius = 200;

    function isNearSpawnZone(x: number, y: number): boolean {
        for (const zone of spawnZones) {
            if (new Vector(x, y).dist(zone) < spawnRadius) return true;
        }
        return false;
    }

    function isPrimaryHalf(x: number, y: number): boolean {
        return x < centerX || (x === centerX && y <= centerY);
    }

    function isWithinBounds(x: number, y: number, pad: number): boolean {
        return x >= pad && x <= mapWidth - pad && y >= pad && y <= mapHeight - pad;
    }

    function mirrorPos(x: number, y: number): Vector {
        return new Vector(mapWidth - x, mapHeight - y);
    }

    // ---- Resources (mirrored clusters) ----
    let resourceId = 0;
    const mirroredResourceTarget = resourceCount - (resourceCount % 2);

    function addResource(x: number, y: number): void {
        const id = `res_${resourceId++}`;
        const resource: ResourceEntity = {
            id,
            owner: -1,
            type: 'RESOURCE',
            key: 'ore',
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 1000,
            maxHp: 1000,
            w: 25,
            h: 25,
            radius: 12,
            dead: false
        };
        entities[id] = resource;
    }

    function tryPlaceResourcePair(x: number, y: number): boolean {
        if (resourceId >= mirroredResourceTarget) return false;
        if (!isPrimaryHalf(x, y) || !isWithinBounds(x, y, 100)) return false;

        const mirrored = mirrorPos(x, y);
        if (!isWithinBounds(mirrored.x, mirrored.y, 100)) return false;
        if (Math.abs(mirrored.x - x) < 0.1 && Math.abs(mirrored.y - y) < 0.1) return false;

        addResource(x, y);
        addResource(mirrored.x, mirrored.y);
        return true;
    }

    const numClusters = Math.floor(resourceCount / 8) + 3;
    const resourcesPerCluster = Math.ceil(resourceCount / Math.max(1, numClusters));
    const clusterCenters: Vector[] = [];
    for (let c = 0; c < numClusters; c++) {
        let found = false;
        for (let attempt = 0; attempt < 40; attempt++) {
            const cx = 500 + Math.random() * (mapWidth - 1000);
            const cy = 500 + Math.random() * (mapHeight - 1000);
            if (!isPrimaryHalf(cx, cy)) continue;
            clusterCenters.push(new Vector(cx, cy));
            found = true;
            break;
        }
        if (!found) {
            clusterCenters.push(new Vector(centerX - 150, centerY));
        }
    }

    for (const center of clusterCenters) {
        const clusterSize = resourcesPerCluster + Math.floor(Math.random() * 5) - 2;
        for (let i = 0; i < clusterSize && resourceId < mirroredResourceTarget; i++) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 20 + Math.random() * 100;
            const x = center.x + Math.cos(angle) * dist;
            const y = center.y + Math.sin(angle) * dist;
            tryPlaceResourcePair(x, y);
        }
    }

    let resourceAttempts = 0;
    while (resourceId < mirroredResourceTarget && resourceAttempts < mirroredResourceTarget * 20) {
        resourceAttempts++;
        const x = 100 + Math.random() * (centerX - 120);
        const y = 100 + Math.random() * (mapHeight - 200);
        tryPlaceResourcePair(x, y);
    }

    if (resourceCount % 2 === 1) {
        addResource(centerX, centerY);
    }

    // ---- Rocks (mirrored obstacles) ----
    let rockId = 0;
    let rocksPlaced = 0;
    const mirroredRockTarget = rockCount - (rockCount % 2);

    function addRock(x: number, y: number, size: number): void {
        const id = `rock_${rockId++}`;
        const rock: RockEntity = {
            id,
            owner: -1,
            type: 'ROCK',
            key: 'rock',
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 9999,
            maxHp: 9999,
            w: size,
            h: size,
            radius: size / 2,
            dead: false
        };
        entities[id] = rock;
    }

    function tryPlaceRockPair(x: number, y: number, size: number): boolean {
        if (rocksPlaced >= mirroredRockTarget) return false;
        if (!isPrimaryHalf(x, y) || !isWithinBounds(x, y, 300)) return false;
        if (isNearSpawnZone(x, y)) return false;

        const mirrored = mirrorPos(x, y);
        if (!isWithinBounds(mirrored.x, mirrored.y, 300)) return false;
        if (isNearSpawnZone(mirrored.x, mirrored.y)) return false;
        if (Math.abs(mirrored.x - x) < 0.1 && Math.abs(mirrored.y - y) < 0.1) return false;

        addRock(x, y, size);
        addRock(mirrored.x, mirrored.y, size);
        rocksPlaced += 2;
        return true;
    }

    let rockAttempts = 0;
    while (rocksPlaced < mirroredRockTarget && rockAttempts < mirroredRockTarget * 30) {
        rockAttempts++;
        const x = 300 + Math.random() * (centerX - 350);
        const y = 300 + Math.random() * (mapHeight - 600);
        const size = 30 + Math.random() * 40;
        tryPlaceRockPair(x, y, size);
    }

    if (rockCount % 2 === 1) {
        const size = 30 + Math.random() * 40;
        addRock(centerX, centerY, size);
    }

    // ---- Wells (mirrored neutral economy) ----
    let nextWellId = 0;
    let wellsPlaced = 0;
    const mirroredWellTarget = wellCount - (wellCount % 2);
    const placedWells: Vector[] = [];

    function canPlaceWell(pos: Vector): boolean {
        if (!isWithinBounds(pos.x, pos.y, 500)) return false;
        if (isNearSpawnZone(pos.x, pos.y)) return false;
        for (const existing of placedWells) {
            if (pos.dist(existing) < 400) return false;
        }
        return true;
    }

    function addWell(pos: Vector): void {
        const id = `well_${nextWellId++}`;
        const well: WellEntity = {
            id,
            owner: -1,
            type: 'WELL',
            key: 'well',
            pos,
            prevPos: new Vector(pos.x, pos.y),
            hp: 9999,
            maxHp: 9999,
            w: 50,
            h: 50,
            radius: 25,
            dead: false,
            well: createDefaultWellComponent()
        };
        entities[id] = well;
        placedWells.push(pos);
    }

    function tryPlaceWellPair(x: number, y: number): boolean {
        if (wellsPlaced >= mirroredWellTarget) return false;
        if (!isPrimaryHalf(x, y)) return false;

        const pos = new Vector(x, y);
        const mirrored = mirrorPos(x, y);
        if (Math.abs(mirrored.x - x) < 0.1 && Math.abs(mirrored.y - y) < 0.1) return false;
        if (!canPlaceWell(pos) || !canPlaceWell(mirrored)) return false;

        addWell(pos);
        addWell(mirrored);
        wellsPlaced += 2;
        return true;
    }

    let wellAttempts = 0;
    while (wellsPlaced < mirroredWellTarget && wellAttempts < mirroredWellTarget * 50) {
        wellAttempts++;
        const x = 500 + Math.random() * (centerX - 550);
        const y = 500 + Math.random() * (mapHeight - 1000);
        tryPlaceWellPair(x, y);
    }

    if (wellCount % 2 === 1) {
        const centerWell = new Vector(centerX, centerY);
        if (canPlaceWell(centerWell)) {
            addWell(centerWell);
        }
    }

    return entities;
}

/**
 * Generate map entities including resources and rocks.
 */
export function generateMap(config: SkirmishConfig): { entities: Record<EntityId, Entity>, mapWidth: number, mapHeight: number } {
    const entities: Record<EntityId, Entity> = {};
    const mapDims = MAP_SIZES[config.mapSize];
    const { width: mapWidth, height: mapHeight } = mapDims;
    const density = DENSITY_SETTINGS[config.resourceDensity];
    const rockSettings = DENSITY_SETTINGS[config.rockDensity];

    // Get actual player count and starting positions
    const numPlayers = config.players.filter(p => p.type !== 'none').length;
    const playerPositions = getStartingPositions(mapWidth, mapHeight, numPlayers);

    // Calculate spawn zones to avoid for rocks (use all player positions)
    const spawnRadius = 200; // Keep rocks away from spawn areas
    const spawnZones = playerPositions;

    // 2-player skirmish maps use mirrored generation to minimize positional bias.
    if (numPlayers === 2) {
        const mirroredEntities = generateMirroredTwoPlayerEntities(
            mapWidth,
            mapHeight,
            density.resources,
            rockSettings.rocks,
            WELL_DENSITY_SETTINGS[config.resourceDensity],
            spawnZones
        );
        return { entities: mirroredEntities, mapWidth, mapHeight };
    }

    // Helper to check if position is near any spawn zone
    function isNearSpawnZone(x: number, y: number): boolean {
        for (const zone of spawnZones) {
            if (new Vector(x, y).dist(zone) < spawnRadius) {
                return true;
            }
        }
        return false;
    }

    // Generate resources in clusters
    const resourceCount = density.resources;
    const numClusters = Math.floor(resourceCount / 8) + 3; // More resources = more clusters
    const resourcesPerCluster = Math.ceil(resourceCount / numClusters);

    // Generate cluster centers in the middle area of the map
    const clusterCenters: Vector[] = [];
    for (let c = 0; c < numClusters; c++) {
        const cx = 500 + Math.random() * (mapWidth - 1000);
        const cy = 500 + Math.random() * (mapHeight - 1000);
        clusterCenters.push(new Vector(cx, cy));
    }

    // Generate resources around cluster centers
    let resourceId = 0;
    for (const center of clusterCenters) {
        const clusterSize = resourcesPerCluster + Math.floor(Math.random() * 5) - 2;
        for (let i = 0; i < clusterSize && resourceId < resourceCount; i++) {
            // Random position within cluster radius (50-150 from center)
            const angle = Math.random() * Math.PI * 2;
            const dist = 20 + Math.random() * 100;
            const x = center.x + Math.cos(angle) * dist;
            const y = center.y + Math.sin(angle) * dist;

            // Skip if out of bounds
            if (x < 100 || x > mapWidth - 100 || y < 100 || y > mapHeight - 100) continue;

            const id = 'res_' + resourceId++;
            const resource: ResourceEntity = {
                id,
                owner: -1,
                type: 'RESOURCE',
                key: 'ore',
                pos: new Vector(x, y),
                prevPos: new Vector(x, y),
                hp: 1000,
                maxHp: 1000,
                w: 25,
                h: 25,
                radius: 12,
                dead: false
            };
            entities[id] = resource;
        }
    }

    // Generate rocks (impassable obstacles) - avoid spawn zones
    const rockCount = rockSettings.rocks;
    let rocksPlaced = 0;
    let attempts = 0;
    const maxAttempts = rockCount * 10;

    while (rocksPlaced < rockCount && attempts < maxAttempts) {
        attempts++;
        const x = 300 + Math.random() * (mapWidth - 600);
        const y = 300 + Math.random() * (mapHeight - 600);

        // Skip if too close to a spawn zone
        if (isNearSpawnZone(x, y)) {
            continue;
        }

        const size = 30 + Math.random() * 40;
        const id = 'rock_' + rocksPlaced;
        const rock: RockEntity = {
            id,
            owner: -1,
            type: 'ROCK',
            key: 'rock',
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 9999,
            maxHp: 9999,
            w: size,
            h: size,
            radius: size / 2,
            dead: false
        };
        entities[id] = rock;
        rocksPlaced++;
    }

    // Generate ore wells (neutral resource generators)
    // Distribute fairly based on player starting positions with some variance
    const wellCount = WELL_DENSITY_SETTINGS[config.resourceDensity];
    const placedWells: Vector[] = [];

    // Helper to score a position based on fairness
    // Higher score = more fair (equidistant from players)
    function scoreWellPosition(pos: Vector): number {
        if (playerPositions.length <= 1) return 1; // No fairness concern with 1 player

        // Calculate distances to all players
        const distances = playerPositions.map(p => pos.dist(p));
        const minDist = Math.min(...distances);
        const maxDist = Math.max(...distances);

        // Penalize if too close to any player (< 400px) or too far from all (> 1500px)
        if (minDist < 400) return 0;
        if (minDist > 1500) return 0.3;

        // Score based on how equal the distances are (low variance = fair)
        // Ratio of min/max distance - closer to 1 is more fair
        const fairnessRatio = minDist / maxDist;

        // Add some randomness for variance (0.7 to 1.0 multiplier)
        const variance = 0.7 + Math.random() * 0.3;

        return fairnessRatio * variance;
    }

    // Generate candidate positions and pick the best ones
    for (let w = 0; w < wellCount; w++) {
        let bestPos: Vector | null = null;
        let bestScore = -1;
        const candidateCount = 30; // Try 30 random positions, pick best

        for (let attempt = 0; attempt < candidateCount; attempt++) {
            // Place wells in middle area of map (500px from edges for more options)
            const x = 500 + Math.random() * (mapWidth - 1000);
            const y = 500 + Math.random() * (mapHeight - 1000);
            const pos = new Vector(x, y);

            // Skip if too close to a spawn zone
            if (isNearSpawnZone(x, y)) continue;

            // Check not too close to existing wells (min 400px apart)
            let tooCloseToWell = false;
            for (const existingWell of placedWells) {
                if (pos.dist(existingWell) < 400) {
                    tooCloseToWell = true;
                    break;
                }
            }
            if (tooCloseToWell) continue;

            // Score this position
            const score = scoreWellPosition(pos);
            if (score > bestScore) {
                bestScore = score;
                bestPos = pos;
            }
        }

        // If we found a valid position, place the well
        if (bestPos && bestScore > 0) {
            const id = 'well_' + w;
            const well: WellEntity = {
                id,
                owner: -1,
                type: 'WELL',
                key: 'well',
                pos: bestPos,
                prevPos: new Vector(bestPos.x, bestPos.y),
                hp: 9999,
                maxHp: 9999,
                w: 50,
                h: 50,
                radius: 25,
                dead: false,
                well: createDefaultWellComponent()
            };
            entities[id] = well;
            placedWells.push(bestPos);
        }
    }

    return { entities, mapWidth, mapHeight };
}

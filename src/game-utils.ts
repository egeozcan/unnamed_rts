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

/**
 * Generate map entities including resources and rocks.
 */
export function generateMap(config: SkirmishConfig): { entities: Record<EntityId, Entity>, mapWidth: number, mapHeight: number } {
    const entities: Record<EntityId, Entity> = {};
    const mapDims = MAP_SIZES[config.mapSize];
    const { width: mapWidth, height: mapHeight } = mapDims;
    const density = DENSITY_SETTINGS[config.resourceDensity];
    const rockSettings = DENSITY_SETTINGS[config.rockDensity];

    // Calculate spawn zones to avoid for rocks
    const margin = 350;
    const spawnRadius = 200; // Keep rocks away from spawn areas
    const spawnZones = [
        new Vector(margin, margin),                          // Top-left
        new Vector(mapWidth - margin, mapHeight - margin),   // Bottom-right
        new Vector(mapWidth - margin, margin),               // Top-right
        new Vector(margin, mapHeight - margin)               // Bottom-left
    ];

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
    const wellCount = WELL_DENSITY_SETTINGS[config.resourceDensity]; // Use resource density for wells
    let wellsPlaced = 0;
    let wellAttempts = 0;
    const maxWellAttempts = wellCount * 20;

    while (wellsPlaced < wellCount && wellAttempts < maxWellAttempts) {
        wellAttempts++;

        // Place wells in middle area of map (600px from edges)
        const x = 600 + Math.random() * (mapWidth - 1200);
        const y = 600 + Math.random() * (mapHeight - 1200);

        // Skip if too close to a spawn zone
        if (isNearSpawnZone(x, y)) {
            continue;
        }

        // Check not too close to existing wells (min 400px apart)
        let tooClose = false;
        for (const id in entities) {
            const e = entities[id];
            if (e.type === 'WELL') {
                if (new Vector(x, y).dist(e.pos) < 400) {
                    tooClose = true;
                    break;
                }
            }
        }
        if (tooClose) continue;

        const id = 'well_' + wellsPlaced;
        const well: WellEntity = {
            id,
            owner: -1,
            type: 'WELL',
            key: 'well',
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 9999,
            maxHp: 9999,
            w: 50,
            h: 50,
            radius: 25,
            dead: false,
            well: createDefaultWellComponent()
        };
        entities[id] = well;
        wellsPlaced++;
    }

    return { entities, mapWidth, mapHeight };
}

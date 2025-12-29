/**
 * Pure utility functions for game logic.
 * These are separated from game.ts to enable unit testing without DOM dependencies.
 */

import { GameState, Vector, EntityId, Entity, SkirmishConfig, MAP_SIZES, DENSITY_SETTINGS } from './engine/types.js';
import rules from './data/rules.json';

const RULES = rules as any;

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
        entities[id] = {
            ...e,
            pos: new Vector(e.pos.x, e.pos.y),
            prevPos: new Vector(e.prevPos.x, e.prevPos.y),
            vel: new Vector(e.vel.x, e.vel.y),
            moveTarget: e.moveTarget ? new Vector(e.moveTarget.x, e.moveTarget.y) : null,
            finalDest: e.finalDest ? new Vector(e.finalDest.x, e.finalDest.y) : null,
            unstuckDir: e.unstuckDir ? new Vector(e.unstuckDir.x, e.unstuckDir.y) : null,
            path: e.path ? e.path.map((p: { x: number, y: number }) => new Vector(p.x, p.y)) : null
        };
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
export function calculatePower(pid: number, entities: Record<EntityId, any>): { in: number; out: number } {
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
            entities[id] = {
                id, owner: -1, type: 'RESOURCE', key: 'ore',
                pos: new Vector(x, y), prevPos: new Vector(x, y),
                hp: 1000, maxHp: 1000, w: 25, h: 25, radius: 12, dead: false,
                vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
                targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
            };
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
        entities[id] = {
            id, owner: -1, type: 'ROCK', key: 'rock',
            pos: new Vector(x, y), prevPos: new Vector(x, y),
            hp: 9999, maxHp: 9999, w: size, h: size, radius: size / 2, dead: false,
            vel: new Vector(0, 0), rotation: Math.random() * Math.PI * 2, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
            targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
        };
        rocksPlaced++;
    }

    return { entities, mapWidth, mapHeight };
}

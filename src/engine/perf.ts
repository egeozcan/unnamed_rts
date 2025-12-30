/**
 * Performance utilities for efficient entity lookups.
 * 
 * These helpers provide cached and indexed views of entities to avoid
 * repeated Object.values() and filter() calls in hot paths.
 */

import { Entity, EntityId } from './types.js';

/**
 * Cached entity views for a single tick.
 * Create once at tick start and pass around to avoid repeated lookups.
 */
export interface EntityCache {
    /** All entities as a list (avoids Object.values() calls) */
    readonly all: Entity[];

    /** All living entities (not dead) */
    readonly alive: Entity[];

    /** Entities grouped by owner */
    readonly byOwner: Map<number, Entity[]>;

    /** Entities grouped by type */
    readonly byType: Map<string, Entity[]>;

    /** Buildings by owner (common lookup) */
    readonly buildingsByOwner: Map<number, Entity[]>;

    /** Units by owner (common lookup) */
    readonly unitsByOwner: Map<number, Entity[]>;

    /** Resources (ore) */
    readonly resources: Entity[];

    /** Quick lookup helpers */
    readonly hasBuildingByOwner: Map<number, Set<string>>;
}

/**
 * Create cached entity views from game state.
 * Call once at the start of tick() and pass to functions that need entity lookups.
 */
export function createEntityCache(entities: Record<EntityId, Entity>): EntityCache {
    const all: Entity[] = [];
    const alive: Entity[] = [];
    const byOwner = new Map<number, Entity[]>();
    const byType = new Map<string, Entity[]>();
    const buildingsByOwner = new Map<number, Entity[]>();
    const unitsByOwner = new Map<number, Entity[]>();
    const resources: Entity[] = [];
    const hasBuildingByOwner = new Map<number, Set<string>>();

    // Single pass through all entities
    for (const id in entities) {
        const e = entities[id];
        all.push(e);

        if (e.dead) continue;

        alive.push(e);

        // By owner
        if (!byOwner.has(e.owner)) byOwner.set(e.owner, []);
        byOwner.get(e.owner)!.push(e);

        // By type
        if (!byType.has(e.type)) byType.set(e.type, []);
        byType.get(e.type)!.push(e);

        // Buildings by owner
        if (e.type === 'BUILDING') {
            if (!buildingsByOwner.has(e.owner)) buildingsByOwner.set(e.owner, []);
            buildingsByOwner.get(e.owner)!.push(e);

            // Track which building keys each owner has
            if (!hasBuildingByOwner.has(e.owner)) hasBuildingByOwner.set(e.owner, new Set());
            hasBuildingByOwner.get(e.owner)!.add(e.key);
        }

        // Units by owner
        if (e.type === 'UNIT') {
            if (!unitsByOwner.has(e.owner)) unitsByOwner.set(e.owner, []);
            unitsByOwner.get(e.owner)!.push(e);
        }

        // Resources
        if (e.type === 'RESOURCE') {
            resources.push(e);
        }
    }

    return {
        all,
        alive,
        byOwner,
        byType,
        buildingsByOwner,
        unitsByOwner,
        resources,
        hasBuildingByOwner
    };
}

/**
 * Get entities for a specific owner from cache.
 * Returns empty array if owner not found (safe for iteration).
 */
export function getEntitiesForOwner(cache: EntityCache, owner: number): Entity[] {
    return cache.byOwner.get(owner) || [];
}

/**
 * Get buildings for a specific owner from cache.
 */
export function getBuildingsForOwner(cache: EntityCache, owner: number): Entity[] {
    return cache.buildingsByOwner.get(owner) || [];
}

/**
 * Get units for a specific owner from cache.
 */
export function getUnitsForOwner(cache: EntityCache, owner: number): Entity[] {
    return cache.unitsByOwner.get(owner) || [];
}

/**
 * Check if an owner has a specific building type.
 */
export function ownerHasBuilding(cache: EntityCache, owner: number, buildingKey: string): boolean {
    const buildings = cache.hasBuildingByOwner.get(owner);
    return buildings ? buildings.has(buildingKey) : false;
}

/**
 * Get all enemies of a player (living entities owned by other players, excluding neutral).
 */
export function getEnemiesOf(cache: EntityCache, playerId: number): Entity[] {
    const enemies: Entity[] = [];
    for (const [owner, entities] of cache.byOwner) {
        if (owner !== playerId && owner !== -1) {
            enemies.push(...entities);
        }
    }
    return enemies;
}

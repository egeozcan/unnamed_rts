/**
 * Spatial Hash Grid for efficient neighbor queries.
 * 
 * Divides the game world into cells and tracks which entities are in each cell.
 * This enables O(1) lookups for entities near a given position instead of O(n) searches.
 */

import { Entity, EntityId } from './types.js';

// Cell size should be roughly the size of the largest query radius we commonly use
// Most queries are for ranges 100-400 units, so 200 is a good balance
const DEFAULT_CELL_SIZE = 200;

/**
 * Spatial hash grid for fast spatial queries.
 */
export class SpatialGrid {
    private cellSize: number;
    private cells: Map<string, Entity[]>;
    private entityCells: Map<EntityId, string[]>; // Track which cells each entity is in

    constructor(cellSize: number = DEFAULT_CELL_SIZE) {
        this.cellSize = cellSize;
        this.cells = new Map();
        this.entityCells = new Map();
    }

    /**
     * Clear all entities from the grid.
     */
    clear(): void {
        this.cells.clear();
        this.entityCells.clear();
    }

    /**
     * Get all cell keys that an entity occupies (based on its radius).
     */
    private getEntityCellKeys(entity: Entity): string[] {
        const keys: string[] = [];
        const minX = entity.pos.x - entity.radius;
        const maxX = entity.pos.x + entity.radius;
        const minY = entity.pos.y - entity.radius;
        const maxY = entity.pos.y + entity.radius;

        const minCx = Math.floor(minX / this.cellSize);
        const maxCx = Math.floor(maxX / this.cellSize);
        const minCy = Math.floor(minY / this.cellSize);
        const maxCy = Math.floor(maxY / this.cellSize);

        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                keys.push(`${cx},${cy}`);
            }
        }

        return keys;
    }

    /**
     * Insert an entity into the grid.
     */
    insert(entity: Entity): void {
        if (entity.dead) return;

        const cellKeys = this.getEntityCellKeys(entity);
        this.entityCells.set(entity.id, cellKeys);

        for (const key of cellKeys) {
            let cell = this.cells.get(key);
            if (!cell) {
                cell = [];
                this.cells.set(key, cell);
            }
            cell.push(entity);
        }
    }

    /**
     * Rebuild the grid from a collection of entities.
     */
    rebuild(entities: Record<EntityId, Entity> | Entity[]): void {
        this.clear();

        const list = Array.isArray(entities) ? entities : Object.values(entities);
        for (const entity of list) {
            this.insert(entity);
        }
    }

    /**
     * Query all entities within a given radius of a position.
     * Returns entities whose bounding boxes may overlap - caller should do precise distance check.
     */
    queryRadius(x: number, y: number, radius: number): Entity[] {
        // Calculate which cells to check
        const minCx = Math.floor((x - radius) / this.cellSize);
        const maxCx = Math.floor((x + radius) / this.cellSize);
        const minCy = Math.floor((y - radius) / this.cellSize);
        const maxCy = Math.floor((y + radius) / this.cellSize);

        // OPTIMIZATION: For single-cell queries (common case), skip Set overhead
        if (minCx === maxCx && minCy === maxCy) {
            const cell = this.cells.get(`${minCx},${minCy}`);
            return cell ? [...cell] : [];
        }

        // Multi-cell query: use Set to deduplicate entities spanning multiple cells
        const result: Entity[] = [];
        const seen = new Set<EntityId>();

        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                const cell = this.cells.get(`${cx},${cy}`);
                if (cell) {
                    for (const entity of cell) {
                        if (!seen.has(entity.id)) {
                            seen.add(entity.id);
                            result.push(entity);
                        }
                    }
                }
            }
        }

        return result;
    }

    /**
     * Query entities within radius and filter by exact distance.
     * This does the precise distance check.
     */
    queryRadiusExact(x: number, y: number, radius: number): Entity[] {
        const candidates = this.queryRadius(x, y, radius);
        return candidates.filter(e => {
            const dx = e.pos.x - x;
            const dy = e.pos.y - y;
            return dx * dx + dy * dy <= (radius + e.radius) * (radius + e.radius);
        });
    }

    /**
     * Query entities within radius, filtered by owner.
     */
    queryRadiusByOwner(x: number, y: number, radius: number, owner: number): Entity[] {
        return this.queryRadiusExact(x, y, radius).filter(e => e.owner === owner);
    }

    /**
     * Query enemies (entities not owned by the given player and not neutral).
     */
    queryEnemiesInRadius(x: number, y: number, radius: number, playerId: number): Entity[] {
        return this.queryRadiusExact(x, y, radius).filter(e =>
            e.owner !== playerId && e.owner !== -1
        );
    }

    /**
     * Query entities within radius by type.
     */
    queryRadiusByType(x: number, y: number, radius: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE'): Entity[] {
        return this.queryRadiusExact(x, y, radius).filter(e => e.type === type);
    }

    /**
     * Find the nearest entity matching a predicate.
     * Searches outward from the position.
     */
    findNearest(x: number, y: number, maxRadius: number, predicate: (e: Entity) => boolean): Entity | null {
        const candidates = this.queryRadiusExact(x, y, maxRadius).filter(predicate);

        if (candidates.length === 0) return null;

        let nearest: Entity | null = null;
        let nearestDistSq = Infinity;

        for (const entity of candidates) {
            const dx = entity.pos.x - x;
            const dy = entity.pos.y - y;
            const distSq = dx * dx + dy * dy;
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = entity;
            }
        }

        return nearest;
    }

    /**
     * Find the nearest enemy unit to a position.
     */
    findNearestEnemy(x: number, y: number, maxRadius: number, playerId: number): Entity | null {
        return this.findNearest(x, y, maxRadius, e =>
            e.owner !== playerId && e.owner !== -1 && e.type === 'UNIT'
        );
    }

    /**
     * Find the nearest resource (ore) to a position.
     */
    findNearestResource(x: number, y: number, maxRadius: number): Entity | null {
        return this.findNearest(x, y, maxRadius, e => e.type === 'RESOURCE');
    }

    /**
     * Count entities in radius matching a predicate.
     */
    countInRadius(x: number, y: number, radius: number, predicate: (e: Entity) => boolean): number {
        return this.queryRadiusExact(x, y, radius).filter(predicate).length;
    }
}

// Global spatial grid instance for the game
let globalGrid: SpatialGrid | null = null;

/**
 * Get the global spatial grid instance.
 */
export function getSpatialGrid(): SpatialGrid {
    if (!globalGrid) {
        globalGrid = new SpatialGrid();
    }
    return globalGrid;
}

/**
 * Rebuild the global spatial grid from entities.
 * Call this once per tick before doing spatial queries.
 */
export function rebuildSpatialGrid(entities: Record<EntityId, Entity> | Entity[]): void {
    getSpatialGrid().rebuild(entities);
}

/**
 * Query helpers that use the global grid.
 */
export function queryEntitiesInRadius(x: number, y: number, radius: number): Entity[] {
    return getSpatialGrid().queryRadiusExact(x, y, radius);
}

export function queryEnemiesNear(x: number, y: number, radius: number, playerId: number): Entity[] {
    return getSpatialGrid().queryEnemiesInRadius(x, y, radius, playerId);
}

export function findNearestEnemy(x: number, y: number, maxRadius: number, playerId: number): Entity | null {
    return getSpatialGrid().findNearestEnemy(x, y, maxRadius, playerId);
}

export function findNearestResource(x: number, y: number, maxRadius: number): Entity | null {
    return getSpatialGrid().findNearestResource(x, y, maxRadius);
}

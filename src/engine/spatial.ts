/**
 * Spatial Hash Grid for efficient neighbor queries.
 * 
 * Divides the game world into cells and tracks which entities are in each cell.
 * This enables O(1) lookups for entities near a given position instead of O(n) searches.
 */

import { Entity, EntityId } from './types.js';
import { isTransportedUnit } from './transport.js';

// Cell size should be roughly the size of the largest query radius we commonly use
// Most queries are for ranges 100-400 units, so 200 is a good balance
const DEFAULT_CELL_SIZE = 200;

/**
 * A single grid cell. Entities are stored alongside the min cell coordinates of the
 * entity's footprint so multi-cell entities can be de-duplicated during a query
 * without allocating a Set (an entity is only reported from the first cell of the
 * query range that it occupies).
 */
interface Cell {
    items: Entity[];
    minCx: number[];
    minCy: number[];
    /** Bitmask of the (non-neutral) owners present in this cell, see ownerBit(). */
    ownerMask: number;
}

/**
 * Bit for an owner id in a Cell.ownerMask. Neutral owners (-1) contribute no bit; owners
 * that don't fit in the mask all share the top bit so they are never wrongly skipped.
 */
export function ownerBit(owner: number): number {
    if (owner < 0) return 0;
    return owner < 31 ? (1 << owner) : (1 << 31);
}

// Cell coordinates are packed into a single numeric Map key. The offset keeps
// moderately negative coordinates (e.g. off-map explosions) from colliding.
const KEY_OFFSET = 32768;
const KEY_STRIDE = 65536;

function cellKey(cx: number, cy: number): number {
    return (cx + KEY_OFFSET) * KEY_STRIDE + (cy + KEY_OFFSET);
}

/**
 * Spatial hash grid for fast spatial queries.
 *
 * PERFORMANCE NOTES: the grid is rebuilt every tick and queried hundreds of times per
 * tick (target acquisition, collisions, ...), so it avoids string keys, per-query Sets
 * and chained filter() arrays. Cell storage is pooled across rebuilds.
 */
export class SpatialGrid {
    private cellSize: number;
    private cells: Map<number, Cell>;

    constructor(cellSize: number = DEFAULT_CELL_SIZE) {
        this.cellSize = cellSize;
        this.cells = new Map();
    }

    /**
     * Clear all entities from the grid. Cell storage is kept (emptied) so a per-tick
     * rebuild does not have to reallocate every cell.
     */
    clear(): void {
        for (const cell of this.cells.values()) {
            cell.items.length = 0;
            cell.minCx.length = 0;
            cell.minCy.length = 0;
            cell.ownerMask = 0;
        }
    }

    /**
     * Insert an entity into the grid.
     */
    insert(entity: Entity): void {
        if (entity.dead) return;
        if (isTransportedUnit(entity)) return;

        const cs = this.cellSize;
        const minCx = Math.floor((entity.pos.x - entity.radius) / cs);
        const maxCx = Math.floor((entity.pos.x + entity.radius) / cs);
        const minCy = Math.floor((entity.pos.y - entity.radius) / cs);
        const maxCy = Math.floor((entity.pos.y + entity.radius) / cs);

        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                const key = cellKey(cx, cy);
                let cell = this.cells.get(key);
                if (!cell) {
                    cell = { items: [], minCx: [], minCy: [], ownerMask: 0 };
                    this.cells.set(key, cell);
                }
                cell.items.push(entity);
                cell.ownerMask |= ownerBit(entity.owner);
                cell.minCx.push(minCx);
                cell.minCy.push(minCy);
            }
        }
    }

    /**
     * Rebuild the grid from a collection of entities.
     */
    rebuild(entities: Record<EntityId, Entity> | Entity[]): void {
        this.clear();

        if (Array.isArray(entities)) {
            for (const entity of entities) this.insert(entity);
        } else {
            for (const id in entities) this.insert(entities[id]);
        }
    }

    /**
     * Visit every entity whose footprint touches the cells overlapped by the query
     * circle, exactly once, in deterministic (cx-major, cy-minor, insertion) order.
     * The visitor may return `false` to stop early.
     */
    private forEachCandidate(
        x: number,
        y: number,
        radius: number,
        visit: (e: Entity) => void | false,
        ignoredOwnersMask: number = -1
    ): void {
        const cs = this.cellSize;
        const qMinCx = Math.floor((x - radius) / cs);
        const qMaxCx = Math.floor((x + radius) / cs);
        const qMinCy = Math.floor((y - radius) / cs);
        const qMaxCy = Math.floor((y + radius) / cs);
        const single = qMinCx === qMaxCx && qMinCy === qMaxCy;

        for (let cx = qMinCx; cx <= qMaxCx; cx++) {
            for (let cy = qMinCy; cy <= qMaxCy; cy++) {
                const cell = this.cells.get(cellKey(cx, cy));
                if (!cell) continue;
                // Optional pruning: a cell holding only ignored (and neutral) owners can't contain a match.
                if (ignoredOwnersMask !== -1 && (cell.ownerMask & ~ignoredOwnersMask) === 0) continue;
                const { items, minCx, minCy } = cell;
                for (let i = 0; i < items.length; i++) {
                    // De-duplicate: only report an entity from the first cell of the
                    // query range that it occupies.
                    if (!single && (cx !== Math.max(minCx[i], qMinCx) || cy !== Math.max(minCy[i], qMinCy))) continue;
                    if (visit(items[i]) === false) return;
                }
            }
        }
    }

    /**
     * Allocation-free variant of queryRadius(): calls `visit` for each candidate entity (each exactly
     * once). Return `false` from the visitor to stop early. Like queryRadius, candidates are not
     * filtered by exact distance.
     */
    forEachInRadius(x: number, y: number, radius: number, visit: (e: Entity) => void | false): void {
        this.forEachCandidate(x, y, radius, visit);
    }

    /**
     * Query all entities within a given radius of a position.
     * Returns entities whose bounding boxes may overlap - caller should do precise distance check.
     */
    queryRadius(x: number, y: number, radius: number): Entity[] {
        const result: Entity[] = [];
        this.forEachCandidate(x, y, radius, e => { result.push(e); });
        return result;
    }

    /**
     * Query entities within radius and filter by exact distance.
     * This does the precise distance check.
     */
    queryRadiusExact(x: number, y: number, radius: number): Entity[] {
        const result: Entity[] = [];
        this.forEachCandidate(x, y, radius, e => {
            const dx = e.pos.x - x;
            const dy = e.pos.y - y;
            const r = radius + e.radius;
            if (dx * dx + dy * dy <= r * r) result.push(e);
        });
        return result;
    }

    /**
     * Query entities within radius, filtered by owner.
     */
    queryRadiusByOwner(x: number, y: number, radius: number, owner: number): Entity[] {
        return this.queryRadiusMatching(x, y, radius, e => e.owner === owner);
    }

    /**
     * Query enemies (entities not owned by the given player and not neutral).
     */
    queryEnemiesInRadius(x: number, y: number, radius: number, playerId: number): Entity[] {
        return this.queryRadiusMatching(x, y, radius, e => e.owner !== playerId && e.owner !== -1);
    }

    /**
     * Query entities within radius by type.
     */
    queryRadiusByType(x: number, y: number, radius: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE'): Entity[] {
        return this.queryRadiusMatching(x, y, radius, e => e.type === type);
    }

    /**
     * Exact-distance query that also applies a predicate in the same pass.
     */
    private queryRadiusMatching(x: number, y: number, radius: number, predicate: (e: Entity) => boolean): Entity[] {
        const result: Entity[] = [];
        this.forEachCandidate(x, y, radius, e => {
            const dx = e.pos.x - x;
            const dy = e.pos.y - y;
            const r = radius + e.radius;
            if (dx * dx + dy * dy <= r * r && predicate(e)) result.push(e);
        });
        return result;
    }

    /**
     * Find the nearest entity matching a predicate (single pass, no intermediate arrays).
     * Ties resolve to the first candidate in query order.
     *
     * `ignoredOwnersMask` (bits from ownerBit()) is a pruning hint: cells that only contain
     * entities of those owners (plus neutrals) are skipped without looking at their entities.
     * Only pass it when the predicate is guaranteed to reject those owners (and neutrals).
     * The default (-1) disables pruning.
     */
    findNearest(
        x: number,
        y: number,
        maxRadius: number,
        predicate: (e: Entity) => boolean,
        ignoredOwnersMask: number = -1
    ): Entity | null {
        let nearest: Entity | null = null;
        let nearestDistSq = Infinity;

        this.forEachCandidate(x, y, maxRadius, e => {
            const dx = e.pos.x - x;
            const dy = e.pos.y - y;
            const distSq = dx * dx + dy * dy;
            // Cheap rejects first: not closer than the best so far, or outside exact range.
            if (distSq >= nearestDistSq) return;
            const r = maxRadius + e.radius;
            if (distSq > r * r) return;
            if (!predicate(e)) return;
            nearestDistSq = distSq;
            nearest = e;
        }, ignoredOwnersMask);

        return nearest;
    }

    /**
     * Find the entity with the highest `score` among those within `maxRadius` (center distance) that
     * pass `predicate`. Entities scoring <= 0 are ignored; ties resolve to the first in query order.
     * `ignoredOwnersMask` works as in findNearest().
     */
    findBest(
        x: number,
        y: number,
        maxRadius: number,
        predicate: (e: Entity) => boolean,
        score: (e: Entity, dist: number) => number,
        ignoredOwnersMask: number = -1
    ): { entity: Entity; score: number } | null {
        let best: Entity | null = null;
        let bestScore = 0;
        const maxSq = maxRadius * maxRadius;

        this.forEachCandidate(x, y, maxRadius, e => {
            const dx = e.pos.x - x;
            const dy = e.pos.y - y;
            const distSq = dx * dx + dy * dy;
            if (distSq > maxSq) return;
            if (!predicate(e)) return;
            const s = score(e, Math.sqrt(distSq));
            if (s > bestScore) {
                bestScore = s;
                best = e;
            }
        }, ignoredOwnersMask);

        return best ? { entity: best, score: bestScore } : null;
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
        let count = 0;
        this.forEachCandidate(x, y, radius, e => {
            const dx = e.pos.x - x;
            const dy = e.pos.y - y;
            const r = radius + e.radius;
            if (dx * dx + dy * dy <= r * r && predicate(e)) count++;
        });
        return count;
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

import { Entity, Vector, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, Particle, BuildingKey, UnitKey } from './types.js';
import { RULES } from '../data/schemas/index.js';

// Default grid dimensions based on default map size
const DEFAULT_GRID_W = Math.ceil(MAP_WIDTH / TILE_SIZE);
const DEFAULT_GRID_H = Math.ceil(MAP_HEIGHT / TILE_SIZE);

// Path cache for A* results
interface PathCacheEntry {
    path: Vector[] | null;
    tick: number;
}
const pathCache = new Map<string, PathCacheEntry>();
const PATH_CACHE_TTL = 300; // Valid for 300 ticks (~250ms at lightning speed, 5s at normal)
const PATH_CACHE_MAX_SIZE = 2000; // Support 400+ entities with path variations
let currentPathTick = 0;

// Update the current tick for path caching (call from game loop)
export function setPathCacheTick(tick: number): void {
    currentPathTick = tick;
}

function getPathCacheKey(startGx: number, startGy: number, goalGx: number, goalGy: number, ownerId?: number): string {
    return `${startGx},${startGy}->${goalGx},${goalGy}:${ownerId ?? -1}`;
}

// Dynamic Grid Manager - allows resizing based on map config
class GridManager {
    private _gridW: number = DEFAULT_GRID_W;
    private _gridH: number = DEFAULT_GRID_H;
    private _collisionGrid: Uint8Array;
    private _dangerGrids: Record<number, Uint8Array>;

    constructor() {
        this._collisionGrid = new Uint8Array(this._gridW * this._gridH);
        this._dangerGrids = {}; // Danger grids created on-demand for each player
    }

    get gridW(): number { return this._gridW; }
    get gridH(): number { return this._gridH; }
    get collisionGrid(): Uint8Array { return this._collisionGrid; }
    get dangerGrids(): Record<number, Uint8Array> { return this._dangerGrids; }

    // Resize grids if map config changed
    ensureSize(mapWidth: number, mapHeight: number): void {
        const newGridW = Math.ceil(mapWidth / TILE_SIZE);
        const newGridH = Math.ceil(mapHeight / TILE_SIZE);

        if (newGridW !== this._gridW || newGridH !== this._gridH) {
            this._gridW = newGridW;
            this._gridH = newGridH;
            this._collisionGrid = new Uint8Array(this._gridW * this._gridH);
            // Recreate danger grids for all existing players
            const existingPlayerIds = Object.keys(this._dangerGrids).map(Number);
            this._dangerGrids = {};
            for (const pid of existingPlayerIds) {
                this._dangerGrids[pid] = new Uint8Array(this._gridW * this._gridH);
            }
        }
    }

    clear(): void {
        this._collisionGrid.fill(0);
        // Clear all existing danger grids
        for (const playerId in this._dangerGrids) {
            this._dangerGrids[playerId].fill(0);
        }
    }

    // Ensure danger grid exists for a player
    ensureDangerGrid(playerId: number): void {
        if (!this._dangerGrids[playerId]) {
            this._dangerGrids[playerId] = new Uint8Array(this._gridW * this._gridH);
        }
    }

    markGrid(x: number, y: number, w: number, h: number, blocked: boolean): void {
        const gx = Math.floor(x / TILE_SIZE);
        const gy = Math.floor(y / TILE_SIZE);
        const gw = Math.ceil(w / TILE_SIZE);
        const gh = Math.ceil(h / TILE_SIZE);

        for (let j = gy; j < gy + gh; j++) {
            for (let i = gx; i < gx + gw; i++) {
                if (i >= 0 && i < this._gridW && j >= 0 && j < this._gridH) {
                    this._collisionGrid[j * this._gridW + i] = blocked ? 1 : 0;
                }
            }
        }
    }

    markDanger(playerId: number, x: number, y: number, radius: number): void {
        // Ensure the danger grid exists for this player
        this.ensureDangerGrid(playerId);

        const gx = Math.floor(x / TILE_SIZE);
        const gy = Math.floor(y / TILE_SIZE);
        const gr = Math.ceil(radius / TILE_SIZE);

        const grid = this._dangerGrids[playerId];
        if (!grid) return;

        // PERF: Precompute squared radius to avoid sqrt in inner loop
        const grSq = gr * gr;

        for (let j = gy - gr; j <= gy + gr; j++) {
            for (let i = gx - gr; i <= gx + gr; i++) {
                if (i >= 0 && i < this._gridW && j >= 0 && j < this._gridH) {
                    const dx = i - gx;
                    const dy = j - gy;
                    const distSq = dx * dx + dy * dy;
                    if (distSq <= grSq) {
                        // Use squared ratio instead of sqrt - steeper falloff, but equivalent for avoidance
                        const distRatioSq = distSq / grSq;
                        const dangerCost = Math.floor(100 - 50 * distRatioSq);
                        const idx = j * this._gridW + i;
                        if (dangerCost > grid[idx]) {
                            grid[idx] = dangerCost;
                        }
                    }
                }
            }
        }
    }
}

// Global grid manager instance
const gridManager = new GridManager();

// Export getters for backwards compatibility
export function getGridW(): number { return gridManager.gridW; }
export function getGridH(): number { return gridManager.gridH; }
export const collisionGrid = new Proxy({} as Uint8Array, {
    get(_, prop: string | symbol) {
        return Reflect.get(gridManager.collisionGrid, prop);
    },
    set(_, prop: string | symbol, value: unknown) {
        return Reflect.set(gridManager.collisionGrid, prop, value);
    }
});
export const dangerGrids = new Proxy({} as Record<number, Uint8Array>, {
    get(_, prop: string | symbol) {
        return Reflect.get(gridManager.dangerGrids, prop);
    }
});

// Legacy standalone functions that delegate to gridManager
export function markGrid(x: number, y: number, w: number, h: number, blocked: boolean): void {
    gridManager.markGrid(x, y, w, h, blocked);
}

export function markDanger(playerId: number, x: number, y: number, radius: number): void {
    gridManager.markDanger(playerId, x, y, radius);
}


export function refreshCollisionGrid(entities: Record<string, Entity> | Entity[], mapConfig?: { width: number, height: number }, playerIds?: number[]): void {
    // Resize grids if map config is provided and different from current
    if (mapConfig) {
        gridManager.ensureSize(mapConfig.width, mapConfig.height);
    }

    gridManager.clear();

    // Collect all player IDs from entities if not provided
    const allPlayerIds = playerIds || [...new Set(
        (Array.isArray(entities) ? entities : Object.values(entities))
            .filter(e => e.owner >= 0)
            .map(e => e.owner)
    )];

    const list = Array.isArray(entities) ? entities : Object.values(entities);
    for (const e of list) {
        if (e.type === 'BUILDING' && !e.dead) {
            markGrid(e.pos.x - e.w / 2, e.pos.y - e.h / 2, e.w, e.h, true);

            // Mark danger if it's a defensive building
            const data = RULES.buildings[e.key];
            if (data && data.isDefense && e.owner !== -1) {
                // Mark danger on ALL enemy player danger maps
                const range = (data.range || 200);
                for (const pid of allPlayerIds) {
                    if (pid !== e.owner) {
                        markDanger(pid, e.pos.x, e.pos.y, range);
                    }
                }
            }
        }
    }
}


let nextEntityId = 1;

export function createEntity(x: number, y: number, owner: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE', statsKey: string): Entity {
    // NOTE: This is a legacy/utility version primarily for tests or simple entity creation without full GameState.
    // For main game logic, use createEntity from reducers/helpers.ts which uses state.tick for ID generation.

    const isBuilding = type === 'BUILDING';
    const isResource = type === 'RESOURCE';

    type EntityStats = { hp?: number; w?: number; h?: number };
    let data: EntityStats;
    if (isBuilding) {
        data = RULES.buildings[statsKey] ?? { hp: 100, w: 20, h: 20 };
    } else if (isResource) {
        data = { hp: 1000, w: 25, h: 25 };
    } else {
        data = RULES.units[statsKey] ?? { hp: 100, w: 20, h: 20 };
    }

    const id = 'e' + (nextEntityId++);
    const pos = new Vector(x, y);
    const hp = data.hp || 100;
    const w = data.w || 20;
    const h = data.h || data.w || 20;
    const radius = Math.max(w, h) / 2;

    const baseProps = {
        id,
        owner,
        pos,
        prevPos: new Vector(x, y),
        hp,
        maxHp: hp,
        w,
        h,
        radius,
        dead: false
    };

    if (isResource) {
        return {
            ...baseProps,
            type: 'RESOURCE' as const,
            key: 'ore' as const
        };
    }

    if (isBuilding) {
        const isDefense = ['turret', 'sam_site', 'pillbox', 'obelisk'].includes(statsKey);
        return {
            ...baseProps,
            type: 'BUILDING' as const,
            key: statsKey as BuildingKey,
            combat: isDefense ? {
                targetId: null,
                lastAttackerId: null,
                lastDamageTick: undefined,
                cooldown: 0,
                flash: 0,
                turretAngle: 0
            } : undefined,
            building: {
                isRepairing: undefined,
                placedTick: undefined
            }
        };
    }

    // Unit
    const movement = {
        vel: new Vector(0, 0),
        rotation: 0,
        moveTarget: null,
        path: null,
        pathIdx: 0,
        finalDest: null,
        stuckTimer: 0,
        unstuckDir: null,
        unstuckTimer: 0,
        avgVel: undefined
    };

    const combat = {
        targetId: null,
        lastAttackerId: null,
        lastDamageTick: undefined,
        cooldown: 0,
        flash: 0,
        turretAngle: 0
    };

    if (statsKey === 'harvester') {
        return {
            ...baseProps,
            type: 'UNIT' as const,
            key: 'harvester' as const,
            movement,
            combat,
            harvester: {
                cargo: 0,
                resourceTargetId: null,
                baseTargetId: null,
                dockPos: undefined,
                manualMode: undefined,
                harvestAttemptTicks: undefined,
                lastDistToOre: undefined,
                bestDistToOre: undefined,
                blockedOreId: undefined,
                blockedOreTimer: undefined
            }
        };
    }

    return {
        ...baseProps,
        type: 'UNIT' as const,
        key: statsKey as Exclude<UnitKey, 'harvester'>,
        movement,
        combat
    };
}

export function findOpenSpot(x: number, y: number, radius: number, entities: Entity[]): Vector {
    for (let r = radius; r < radius + 200; r += 20) {
        for (let a = 0; a < Math.PI * 2; a += 0.5) {
            const cx = x + Math.cos(a) * r;
            const cy = y + Math.sin(a) * r;
            const gx = Math.floor(cx / TILE_SIZE);
            const gy = Math.floor(cy / TILE_SIZE);

            if (gx >= 0 && gx < getGridW() && gy >= 0 && gy < getGridH() && gridManager.collisionGrid[gy * getGridW() + gx] === 0) {
                let clear = true;
                for (const e of entities) {
                    if (e.pos.dist(new Vector(cx, cy)) < e.radius + 15) {
                        clear = false;
                        break;
                    }
                }
                if (clear) return new Vector(cx, cy);
            }
        }
    }
    return new Vector(x, y + radius);
}

export function spawnParticle(particles: Particle[], x: number, y: number, color: string, speed: number): void {
    particles.push({
        pos: new Vector(x, y),
        vel: new Vector((Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed),
        life: 15 + Math.random() * 15,
        color
    });
}

export function spawnFloater(particles: Particle[], x: number, y: number, text: string, color: string): void {
    particles.push({
        pos: new Vector(x, y),
        vel: new Vector(0, -1),
        life: 40,
        text,
        color
    });
}

export function hasBuilding(key: string, owner: number, entities: Entity[]): boolean {
    return entities.some(e => e.owner === owner && e.key === key && !e.dead);
}

export function calculatePower(entities: Entity[]): Record<number, { in: number; out: number }> {
    const power: Record<number, { in: number; out: number }> = {};

    for (const e of entities) {
        if (e.type === 'BUILDING' && !e.dead && e.owner >= 0) {
            // Ensure power entry exists for this owner
            if (!power[e.owner]) {
                power[e.owner] = { in: 0, out: 0 };
            }
            const data = RULES.buildings[e.key];
            if (data) {
                if (data.power !== undefined) power[e.owner].out += data.power;
                if (data.drain !== undefined) power[e.owner].in += data.drain;
            }
        }
    }

    return power;
}

export function isValidMCVSpot(x: number, y: number, selfId: string | null, entities: Entity[]): boolean {
    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);

    if (gx >= 0 && gx + 2 < getGridW() && gy >= 0 && gy + 2 < getGridH()) {
        if (gridManager.collisionGrid[gy * getGridW() + gx] === 1) return false;
    }

    for (const e of entities) {
        if (!e.dead && e.id !== selfId && e.pos.dist(new Vector(x, y)) < (e.radius + 45)) {
            return false;
        }
    }
    return true;
}

// A* Pathfinding
interface PathNode {
    x: number;
    y: number;
    g: number; // cost from start
    h: number; // heuristic to goal
    f: number; // g + h
    parent: PathNode | null;
}

class MinHeap {
    private heap: PathNode[] = [];

    push(node: PathNode): void {
        this.heap.push(node);
        this.bubbleUp(this.heap.length - 1);
    }

    pop(): PathNode | null {
        if (this.heap.length === 0) return null;
        const min = this.heap[0];
        const last = this.heap.pop()!;
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.bubbleDown(0);
        }
        return min;
    }

    isEmpty(): boolean {
        return this.heap.length === 0;
    }

    private bubbleUp(i: number): void {
        while (i > 0) {
            const parent = Math.floor((i - 1) / 2);
            if (this.heap[parent].f <= this.heap[i].f) break;
            [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
            i = parent;
        }
    }

    private bubbleDown(i: number): void {
        while (true) {
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            let smallest = i;

            if (left < this.heap.length && this.heap[left].f < this.heap[smallest].f) {
                smallest = left;
            }
            if (right < this.heap.length && this.heap[right].f < this.heap[smallest].f) {
                smallest = right;
            }
            if (smallest === i) break;
            [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
            i = smallest;
        }
    }
}

export function findPath(start: Vector, goal: Vector, entityRadius: number = 10, ownerId?: number): Vector[] | null {
    // Convert world coordinates to grid coordinates
    const startGx = Math.floor(start.x / TILE_SIZE);
    const startGy = Math.floor(start.y / TILE_SIZE);
    const goalGx = Math.floor(goal.x / TILE_SIZE);
    const goalGy = Math.floor(goal.y / TILE_SIZE);

    // Check path cache first
    const cacheKey = getPathCacheKey(startGx, startGy, goalGx, goalGy, ownerId);
    const cachedEntry = pathCache.get(cacheKey);
    if (cachedEntry && (currentPathTick - cachedEntry.tick) < PATH_CACHE_TTL) {
        // Return a copy of cached path (since paths get modified during use)
        return cachedEntry.path ? cachedEntry.path.map(v => new Vector(v.x, v.y)) : null;
    }

    // Check if goal is blocked - if so, find nearest unblocked tile
    let actualGoalGx = goalGx;
    let actualGoalGy = goalGy;

    if (goalGx >= 0 && goalGx < getGridW() && goalGy >= 0 && goalGy < getGridH()) {
        if (gridManager.collisionGrid[goalGy * getGridW() + goalGx] === 1) {
            // Find nearest unblocked tile
            let found = false;
            for (let r = 1; r <= 5 && !found; r++) {
                for (let dy = -r; dy <= r && !found; dy++) {
                    for (let dx = -r; dx <= r && !found; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const nx = goalGx + dx;
                        const ny = goalGy + dy;
                        if (nx >= 0 && nx < getGridW() && ny >= 0 && ny < getGridH()) {
                            if (gridManager.collisionGrid[ny * getGridW() + nx] === 0) {
                                actualGoalGx = nx;
                                actualGoalGy = ny;
                                found = true;
                            }
                        }
                    }
                }
            }
        }
    }

    // If start is blocked, return null
    if (startGx >= 0 && startGx < getGridW() && startGy >= 0 && startGy < getGridH()) {
        if (gridManager.collisionGrid[startGy * getGridW() + startGx] === 1) {
            // We're on a blocked tile - return direct movement to let steering handle it
            return null;
        }
    }

    // A* algorithm
    const openSet = new MinHeap();
    const closedSet = new Set<string>();
    const openMap = new Map<string, PathNode>();
    const dangerGrid = ownerId !== undefined ? dangerGrids[ownerId] : null;

    const startNode: PathNode = {
        x: startGx,
        y: startGy,
        g: 0,
        h: Math.abs(actualGoalGx - startGx) + Math.abs(actualGoalGy - startGy),
        f: 0,
        parent: null
    };
    startNode.f = startNode.g + startNode.h;

    openSet.push(startNode);
    openMap.set(`${startGx},${startGy}`, startNode);

    // 8-directional movement
    const directions = [
        { dx: 0, dy: -1, cost: 1 },    // N
        { dx: 1, dy: -1, cost: 1.41 }, // NE
        { dx: 1, dy: 0, cost: 1 },     // E
        { dx: 1, dy: 1, cost: 1.41 },  // SE
        { dx: 0, dy: 1, cost: 1 },     // S
        { dx: -1, dy: 1, cost: 1.41 }, // SW
        { dx: -1, dy: 0, cost: 1 },    // W
        { dx: -1, dy: -1, cost: 1.41 } // NW
    ];

    let iterations = 0;
    const maxIterations = 2000; // Increased because danger might force longer paths

    while (!openSet.isEmpty() && iterations < maxIterations) {
        iterations++;
        const current = openSet.pop()!;
        const currentKey = `${current.x},${current.y}`;

        if (current.x === actualGoalGx && current.y === actualGoalGy) {
            // Reconstruct path
            const gridPath: { x: number, y: number }[] = [];
            let node: PathNode | null = current;
            while (node) {
                gridPath.unshift({ x: node.x, y: node.y });
                node = node.parent;
            }

            // Convert grid path to world coordinates and smooth
            const path: Vector[] = [];
            for (const p of gridPath) {
                path.push(new Vector(
                    p.x * TILE_SIZE + TILE_SIZE / 2,
                    p.y * TILE_SIZE + TILE_SIZE / 2
                ));
            }

            // Add actual goal position
            path.push(goal);

            // Smooth path - remove intermediate waypoints that are in direct line of sight
            // NOTE: Smoothing might cut through danger zones if not careful.
            // For now, keep smoothing but maybe basic hasLineOfSight should check danger?
            // If I omit danger check in LoS, units might smooth "across" a danger zone.
            const smoothedPath = smoothPath(path, entityRadius, ownerId);

            // Cache the result
            if (pathCache.size >= PATH_CACHE_MAX_SIZE) {
                // Remove oldest entry (simple eviction - first entry)
                const firstKey = pathCache.keys().next().value;
                if (firstKey) pathCache.delete(firstKey);
            }
            pathCache.set(cacheKey, { path: smoothedPath, tick: currentPathTick });

            return smoothedPath;
        }

        closedSet.add(currentKey);
        openMap.delete(currentKey);

        for (const dir of directions) {
            const nx = current.x + dir.dx;
            const ny = current.y + dir.dy;
            const neighborKey = `${nx},${ny}`;

            if (nx < 0 || nx >= getGridW() || ny < 0 || ny >= getGridH()) continue;
            if (closedSet.has(neighborKey)) continue;
            if (gridManager.collisionGrid[ny * getGridW() + nx] === 1) continue;

            // Check diagonal corner cutting
            if (dir.dx !== 0 && dir.dy !== 0) {
                const corner1 = gridManager.collisionGrid[current.y * getGridW() + nx];
                const corner2 = gridManager.collisionGrid[ny * getGridW() + current.x];
                if (corner1 === 1 || corner2 === 1) continue; // Don't cut corners
            }

            // Calculate heuristic cost modifier for danger
            let dangerCost = 0;
            if (dangerGrid) {
                dangerCost = dangerGrid[ny * getGridW() + nx];
            }

            const g = current.g + dir.cost + dangerCost;
            const existingNode = openMap.get(neighborKey);

            if (!existingNode || g < existingNode.g) {
                const h = Math.abs(actualGoalGx - nx) + Math.abs(actualGoalGy - ny);
                const newNode: PathNode = {
                    x: nx,
                    y: ny,
                    g,
                    h,
                    f: g + h,
                    parent: current
                };

                if (!existingNode) {
                    openSet.push(newNode);
                    openMap.set(neighborKey, newNode);
                } else {
                    // Update existing node (heap doesn't reorder, but this is acceptable for game pathfinding)
                    existingNode.g = g;
                    existingNode.f = g + h;
                    existingNode.parent = current;
                }
            }
        }
    }

    // No path found - cache the negative result too
    if (pathCache.size >= PATH_CACHE_MAX_SIZE) {
        const firstKey = pathCache.keys().next().value;
        if (firstKey) pathCache.delete(firstKey);
    }
    pathCache.set(cacheKey, { path: null, tick: currentPathTick });

    return null;
}

function smoothPath(path: Vector[], entityRadius: number, ownerId?: number): Vector[] {
    if (path.length <= 2) return path;

    const smoothed: Vector[] = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
        // Find the furthest visible waypoint
        let furthest = current + 1;
        for (let i = current + 2; i < path.length; i++) {
            if (hasLineOfSight(path[current], path[i], entityRadius, ownerId)) {
                furthest = i;
            }
        }
        smoothed.push(path[furthest]);
        current = furthest;
    }

    return smoothed;
}

function hasLineOfSight(from: Vector, to: Vector, entityRadius: number, ownerId?: number): boolean {
    const dist = from.dist(to);
    const steps = Math.ceil(dist / (TILE_SIZE / 2));
    const dangerGrid = ownerId !== undefined ? dangerGrids[ownerId] : null;

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;

        // Check a few points around the line to account for entity radius
        const checkOffsets = [
            { dx: 0, dy: 0 },
            { dx: entityRadius, dy: 0 },
            { dx: -entityRadius, dy: 0 },
            { dx: 0, dy: entityRadius },
            { dx: 0, dy: -entityRadius }
        ];

        for (const offset of checkOffsets) {
            const gx = Math.floor((x + offset.dx) / TILE_SIZE);
            const gy = Math.floor((y + offset.dy) / TILE_SIZE);

            if (gx >= 0 && gx < getGridW() && gy >= 0 && gy < getGridH()) {
                const idx = gy * getGridW() + gx;
                if (gridManager.collisionGrid[idx] === 1) {
                    return false;
                }
                // Check danger
                if (dangerGrid && dangerGrid[idx] > 0) {
                    return false;
                }
            }
        }
    }
    return true;
}


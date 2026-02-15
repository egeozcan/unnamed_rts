import { Entity, Vector, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, Particle, BuildingKey, UnitKey } from './types.js';
import { RULES, isUnitData } from '../data/schemas/index.js';
import { pathfindingWorker } from './pathfinding-worker-manager.js';

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
    // Tick can move backwards between matches/tests. Without clearing here,
    // stale cached paths (including cached null) remain "fresh" because
    // (newTick - oldTick) becomes negative and still passes TTL checks.
    if (tick < currentPathTick) {
        pathCache.clear();
    }
    currentPathTick = tick;
}

function getPathCacheKey(startGx: number, startGy: number, goalGx: number, goalGy: number, ownerId?: number): string {
    return `${startGx},${startGy}->${goalGx},${goalGy}:${ownerId ?? -1}`;
}

function areUint8ArraysEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

// Dynamic Grid Manager - allows resizing based on map config
class GridManager {
    private _gridW: number = DEFAULT_GRID_W;
    private _gridH: number = DEFAULT_GRID_H;
    private _collisionGrid: Uint8Array;
    private _dangerGrids: Record<number, Uint8Array>;
    private _collisionRevision = 0;
    private _dangerRevisions: Record<number, number>;
    private _lastCollisionSnapshot: Uint8Array;
    private _lastDangerSnapshots: Record<number, Uint8Array>;

    constructor() {
        this._collisionGrid = new Uint8Array(this._gridW * this._gridH);
        this._dangerGrids = {}; // Danger grids created on-demand for each player
        this._dangerRevisions = {};
        this._lastCollisionSnapshot = new Uint8Array(this._collisionGrid.length);
        this._lastDangerSnapshots = {};
    }

    get gridW(): number { return this._gridW; }
    get gridH(): number { return this._gridH; }
    get collisionGrid(): Uint8Array { return this._collisionGrid; }
    get dangerGrids(): Record<number, Uint8Array> { return this._dangerGrids; }
    get collisionRevision(): number { return this._collisionRevision; }

    getDangerRevision(playerId: number): number {
        return this._dangerRevisions[playerId] || 0;
    }

    // Resize grids if map config changed
    ensureSize(mapWidth: number, mapHeight: number): void {
        const newGridW = Math.ceil(mapWidth / TILE_SIZE);
        const newGridH = Math.ceil(mapHeight / TILE_SIZE);

        if (newGridW !== this._gridW || newGridH !== this._gridH) {
            this._gridW = newGridW;
            this._gridH = newGridH;
            this._collisionGrid = new Uint8Array(this._gridW * this._gridH);
            this._lastCollisionSnapshot = new Uint8Array(this._collisionGrid.length);
            this._collisionRevision++;
            // Recreate danger grids for all existing players
            const existingPlayerIds = Object.keys(this._dangerGrids).map(Number);
            this._dangerGrids = {};
            for (const pid of existingPlayerIds) {
                this._dangerGrids[pid] = new Uint8Array(this._gridW * this._gridH);
                this._dangerRevisions[pid] = (this._dangerRevisions[pid] || 0) + 1;
                this._lastDangerSnapshots[pid] = new Uint8Array(this._gridW * this._gridH);
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
            this._dangerRevisions[playerId] = this._dangerRevisions[playerId] || 0;
            this._lastDangerSnapshots[playerId] = new Uint8Array(this._gridW * this._gridH);
        }
    }

    refreshRevisions(playerIds: number[]): void {
        if (this._lastCollisionSnapshot.length !== this._collisionGrid.length ||
            !areUint8ArraysEqual(this._collisionGrid, this._lastCollisionSnapshot)) {
            if (this._lastCollisionSnapshot.length !== this._collisionGrid.length) {
                this._lastCollisionSnapshot = new Uint8Array(this._collisionGrid.length);
            }
            this._lastCollisionSnapshot.set(this._collisionGrid);
            this._collisionRevision++;
        }

        for (const playerId of playerIds) {
            const currentDanger = this._dangerGrids[playerId];
            if (!currentDanger) continue;

            const lastSnapshot = this._lastDangerSnapshots[playerId];
            if (!lastSnapshot || lastSnapshot.length !== currentDanger.length) {
                this._lastDangerSnapshots[playerId] = new Uint8Array(currentDanger);
                this._dangerRevisions[playerId] = (this._dangerRevisions[playerId] || 0) + 1;
                continue;
            }

            if (!areUint8ArraysEqual(currentDanger, lastSnapshot)) {
                lastSnapshot.set(currentDanger);
                this._dangerRevisions[playerId] = (this._dangerRevisions[playerId] || 0) + 1;
            }
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
        } else if (e.type === 'UNIT' && !e.dead && e.owner !== -1) {
            // Mark enemy combat units as danger for pathfinding
            // This helps units route around enemy clusters instead of through them
            const unitData = RULES.units[e.key];
            if (unitData && isUnitData(unitData) && unitData.damage > 0) {
                // Use smaller radius than buildings (units are mobile)
                // Skip flying units - ground units can't be blocked by them
                if (!unitData.fly) {
                    const dangerRadius = 40; // Small radius - just the immediate area around the unit
                    for (const pid of allPlayerIds) {
                        if (pid !== e.owner) {
                            markDangerLight(pid, e.pos.x, e.pos.y, dangerRadius);
                        }
                    }
                }
            }
        }
    }

    gridManager.refreshRevisions(allPlayerIds);
}

/**
 * Mark danger with lower cost than defensive buildings (for enemy units)
 * Units are mobile so we use lower cost to prefer avoiding but not mandate it
 */
function markDangerLight(playerId: number, x: number, y: number, radius: number): void {
    gridManager.ensureDangerGrid(playerId);

    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);
    const gr = Math.ceil(radius / TILE_SIZE);

    const grid = gridManager.dangerGrids[playerId];
    if (!grid) return;

    const gridW = gridManager.gridW;
    const gridH = gridManager.gridH;

    for (let j = gy - gr; j <= gy + gr; j++) {
        for (let i = gx - gr; i <= gx + gr; i++) {
            if (i >= 0 && i < gridW && j >= 0 && j < gridH) {
                const dx = i - gx;
                const dy = j - gy;
                const distSq = dx * dx + dy * dy;
                const grSq = gr * gr;
                if (distSq <= grSq) {
                    // Lower cost than defensive buildings (max 30 vs 100)
                    // This makes it a preference to avoid, not a hard requirement
                    const distRatioSq = distSq / grSq;
                    const dangerCost = Math.floor(30 - 20 * distRatioSq);
                    const idx = j * gridW + i;
                    // Add to existing cost (cumulative for clusters)
                    // But cap at 50 to not make clusters completely impassable
                    grid[idx] = Math.min(50, grid[idx] + dangerCost);
                }
            }
        }
    }
}

// ============================================================================
// Pathfinding Worker Integration
// ============================================================================

/**
 * Initialize the pathfinding web worker.
 * Should be called once when game starts.
 */
export async function initPathfindingWorker(mapWidth: number, mapHeight: number): Promise<void> {
    const gridW = Math.ceil(mapWidth / TILE_SIZE);
    const gridH = Math.ceil(mapHeight / TILE_SIZE);
    await pathfindingWorker.init(gridW, gridH);
    lastSyncedCollisionRevision = -1;
    lastSyncedDangerRevisions.clear();
}

let lastSyncedCollisionRevision = -1;
const lastSyncedDangerRevisions = new Map<number, number>();

/**
 * Sync collision and danger grids to the pathfinding worker.
 * Should be called after refreshCollisionGrid.
 */
export function syncGridsToWorker(playerIds: number[]): void {
    if (!pathfindingWorker.isEnabled()) return;

    const collisionRevision = gridManager.collisionRevision;
    if (collisionRevision !== lastSyncedCollisionRevision) {
        pathfindingWorker.updateCollisionGrid(
            gridManager.collisionGrid,
            gridManager.gridW,
            gridManager.gridH
        );
        lastSyncedCollisionRevision = collisionRevision;
    }

    // Sync danger grids for each player
    for (const playerId of playerIds) {
        const dangerGrid = gridManager.dangerGrids[playerId];
        const dangerRevision = gridManager.getDangerRevision(playerId);
        if (dangerGrid && lastSyncedDangerRevisions.get(playerId) !== dangerRevision) {
            pathfindingWorker.updateDangerGrid(playerId, dangerGrid);
            lastSyncedDangerRevisions.set(playerId, dangerRevision);
        }
    }

    for (const trackedPlayerId of Array.from(lastSyncedDangerRevisions.keys())) {
        if (!playerIds.includes(trackedPlayerId)) {
            lastSyncedDangerRevisions.delete(trackedPlayerId);
        }
    }
}

/**
 * Check if pathfinding worker is enabled and ready
 */
export function isPathfindingWorkerEnabled(): boolean {
    return pathfindingWorker.isEnabled();
}

/**
 * Request a path asynchronously via the web worker.
 * Returns a promise that resolves with the path or null.
 * Falls back to sync pathfinding if worker is not available.
 */
export async function findPathAsync(
    start: Vector,
    goal: Vector,
    entityRadius: number = 10,
    ownerId?: number
): Promise<Vector[] | null> {
    if (pathfindingWorker.isEnabled()) {
        try {
            return await pathfindingWorker.requestPath(start, goal, entityRadius, ownerId);
        } catch {
            // Worker not ready or failed, fall back to sync
            return findPath(start, goal, entityRadius, ownerId);
        }
    }
    // Worker not available, use sync
    return findPath(start, goal, entityRadius, ownerId);
}

/**
 * Get number of pending pathfinding requests
 */
export function getPendingPathRequests(): number {
    return pathfindingWorker.getPendingCount();
}

// Re-export for direct access
export { pathfindingWorker };


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
        const isAirBase = statsKey === 'airforce_command';
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
            },
            airBase: isAirBase ? {
                slots: [null, null, null, null, null, null] as readonly (string | null)[],
                reloadProgress: 0
            } : undefined
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
                manualMode: false,  // New harvesters auto-harvest by default
                harvestAttemptTicks: undefined,
                lastDistToOre: undefined,
                bestDistToOre: undefined,
                blockedOreId: undefined,
                blockedOreTimer: undefined
            }
        };
    }

    if (statsKey === 'harrier') {
        return {
            ...baseProps,
            type: 'UNIT' as const,
            key: 'harrier' as const,
            movement,
            combat,
            airUnit: {
                ammo: 1,
                maxAmmo: 1,
                state: 'docked' as const,
                homeBaseId: null,
                dockedSlot: null
            }
        };
    }

    if (statsKey === 'demo_truck') {
        return {
            ...baseProps,
            type: 'UNIT' as const,
            key: 'demo_truck' as const,
            movement,
            combat,
            demoTruck: {
                detonationTargetId: null,
                detonationTargetPos: null,
                hasDetonated: false
            }
        };
    }

    return {
        ...baseProps,
        type: 'UNIT' as const,
        key: statsKey as Exclude<UnitKey, 'harvester' | 'harrier' | 'demo_truck'>,
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

/**
 * Spawn explosion particles for demo truck detonation.
 * Creates fire particles (orange/yellow) and smoke particles (gray).
 */
export function spawnExplosionParticles(pos: Vector, radius: number): Particle[] {
    const particles: Particle[] = [];
    const count = Math.floor(radius / 5); // More particles for larger explosions

    // Fire particles (orange/yellow)
    for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 3 + Math.random() * 5;
        particles.push({
            pos: new Vector(pos.x, pos.y),
            vel: new Vector(Math.cos(angle) * speed, Math.sin(angle) * speed),
            life: 20 + Math.random() * 20,
            color: Math.random() > 0.5 ? '#ff4400' : '#ffaa00'
        });
    }

    // Smoke particles (gray, rising)
    for (let i = 0; i < count / 2; i++) {
        particles.push({
            pos: new Vector(pos.x + (Math.random() - 0.5) * 20, pos.y + (Math.random() - 0.5) * 20),
            vel: new Vector((Math.random() - 0.5) * 2, -1 - Math.random()),
            life: 30 + Math.random() * 20,
            color: '#666666'
        });
    }

    return particles;
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

    // A* algorithm - OPTIMIZED: Use numeric keys and typed arrays
    const gridW = getGridW();
    const gridH = getGridH();
    const gridSize = gridW * gridH;

    const openSet = new MinHeap();
    const closedSet = new Uint8Array(gridSize); // 0 = open, 1 = closed
    const openMap = new Map<number, PathNode>(); // numeric key = y * gridW + x
    const dangerGrid = ownerId !== undefined ? dangerGrids[ownerId] : null;
    const collisionGrid = gridManager.collisionGrid;

    // Octile heuristic for 8-directional movement (more accurate than Manhattan)
    const dx0 = Math.abs(actualGoalGx - startGx);
    const dy0 = Math.abs(actualGoalGy - startGy);
    const startH = Math.max(dx0, dy0) + 0.41 * Math.min(dx0, dy0);

    const startNode: PathNode = {
        x: startGx,
        y: startGy,
        g: 0,
        h: startH,
        f: startH,
        parent: null
    };

    const startKey = startGy * gridW + startGx;
    openSet.push(startNode);
    openMap.set(startKey, startNode);

    // 8 directions: [dx, dy, cost] - N, NE, E, SE, S, SW, W, NW (moved outside loop)
    const dirs: [number, number, number][] = [[0,-1,1], [1,-1,1.41], [1,0,1], [1,1,1.41], [0,1,1], [-1,1,1.41], [-1,0,1], [-1,-1,1.41]];

    let iterations = 0;
    const maxIterations = 4000;

    while (!openSet.isEmpty() && iterations < maxIterations) {
        iterations++;
        const current = openSet.pop()!;
        const currentKey = current.y * gridW + current.x;

        // Skip if already processed (can happen with duplicate heap entries)
        if (closedSet[currentKey] === 1) continue;

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

            // OPTIMIZATION: Skip smoothing for short paths - not worth the hasLineOfSight cost
            if (path.length <= 4) {
                // Cache and return unsmoothed short path
                if (pathCache.size >= PATH_CACHE_MAX_SIZE) {
                    const firstKey = pathCache.keys().next().value;
                    if (firstKey) pathCache.delete(firstKey);
                }
                pathCache.set(cacheKey, { path, tick: currentPathTick });
                return path;
            }

            // Smooth longer paths - remove intermediate waypoints that are in direct line of sight
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

        closedSet[currentKey] = 1;
        openMap.delete(currentKey);

        // Process neighbors
        const cx = current.x;
        const cy = current.y;
        const cg = current.g;

        for (let d = 0; d < 8; d++) {
            const dx = dirs[d][0];
            const dy = dirs[d][1];
            const cost = dirs[d][2];

            const nx = cx + dx;
            const ny = cy + dy;

            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;

            const neighborKey = ny * gridW + nx;
            if (closedSet[neighborKey] === 1) continue;
            if (collisionGrid[neighborKey] === 1) continue;

            // Check diagonal corner cutting
            if (dx !== 0 && dy !== 0) {
                if (collisionGrid[cy * gridW + nx] === 1 || collisionGrid[ny * gridW + cx] === 1) continue;
            }

            // Danger cost
            const dangerCost = dangerGrid ? dangerGrid[neighborKey] : 0;
            const g = cg + cost + dangerCost;
            const existingNode = openMap.get(neighborKey);

            if (!existingNode || g < existingNode.g) {
                // Octile heuristic
                const hdx = Math.abs(actualGoalGx - nx);
                const hdy = Math.abs(actualGoalGy - ny);
                const h = Math.max(hdx, hdy) + 0.41 * Math.min(hdx, hdy);

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

import { type Entity, Vector, TILE_SIZE, MAP_WIDTH, MAP_HEIGHT, type Particle, type BuildingKey, type UnitKey } from './types.js';
import { RULES, isUnitData } from '../data/schemas/index.js';
import { pathfindingWorker } from './pathfinding-worker-manager.js';
import { isTransportedUnit } from './transport.js';

// Default grid dimensions based on default map size
const DEFAULT_GRID_W = Math.ceil(MAP_WIDTH / TILE_SIZE);
const DEFAULT_GRID_H = Math.ceil(MAP_HEIGHT / TILE_SIZE);

// Path cache for A* results
interface PathCacheEntry {
    path: Vector[] | null;
    tick: number;
}
const pathCache = new Map<PathCacheKey, PathCacheEntry>();
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

type PathCacheKey = number | string;

// Packs (start, goal, owner) into one safe integer: 4 x 11-bit coords + 5-bit owner = 49 bits.
// Falls back to a string key for out-of-range values (never collides with numeric keys).
const KEY_COORD_OFFSET = 1024;
const KEY_COORD_RANGE = 2048;
function packCoord(v: number): number {
    const c = v + KEY_COORD_OFFSET;
    return c >= 0 && c < KEY_COORD_RANGE ? c : -1;
}
function getPathCacheKey(startGx: number, startGy: number, goalGx: number, goalGy: number, ownerId?: number): PathCacheKey {
    const sx = packCoord(startGx), sy = packCoord(startGy), gx = packCoord(goalGx), gy = packCoord(goalGy);
    const owner = (ownerId ?? -1) + 1;
    if (sx < 0 || sy < 0 || gx < 0 || gy < 0 || owner < 0 || owner >= 32 || !Number.isInteger(owner)) {
        return `${startGx},${startGy}->${goalGx},${goalGy}:${ownerId ?? -1}`;
    }
    return (((sx * KEY_COORD_RANGE + sy) * KEY_COORD_RANGE + gx) * KEY_COORD_RANGE + gy) * 32 + owner;
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
        } else if (e.type === 'UNIT' && !e.dead && e.owner !== -1 && !isTransportedUnit(e)) {
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

    // Revision tracking (full-grid compares + snapshots) only exists to drive the worker
    // sync, so skip it until something actually asks the worker for a path.
    if (workerSyncActive) {
        gridManager.refreshRevisions(allPlayerIds);
    }
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
 * Grid syncing to the pathfinding worker is lazy: it costs several full-grid copies per
 * player per tick, so it is only switched on once the first async path request is made.
 */
let workerSyncActive = false;

function activateWorkerSync(): void {
    if (workerSyncActive) return;
    workerSyncActive = true;
    const playerIds = Object.keys(gridManager.dangerGrids).map(Number);
    gridManager.refreshRevisions(playerIds);
    lastSyncedCollisionRevision = -1;
    lastSyncedDangerRevisions.clear();
    syncGridsToWorker(playerIds);
}

/**
 * Sync collision and danger grids to the pathfinding worker.
 * Should be called after refreshCollisionGrid.
 */
export function syncGridsToWorker(playerIds: number[]): void {
    if (!workerSyncActive || !pathfindingWorker.isEnabled()) return;

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
        activateWorkerSync();
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

// 8 directions - N, NE, E, SE, S, SW, W, NW
const DIR_DX = [0, 1, 1, 1, 0, -1, -1, -1];
const DIR_DY = [-1, -1, 0, 1, 1, 1, 0, -1];
const DIR_COST = [1, 1.41, 1, 1.41, 1, 1.41, 1, 1.41];
const MAX_ASTAR_ITERATIONS = 4000;

// Preallocated A* scratch buffers, sized to the current grid. Open/closed membership
// is generation-stamped so the buffers never need clearing between searches.
let astarSize = 0;
let astarG = new Float64Array(0);
let astarF = new Float64Array(0);
let astarParent = new Int32Array(0);
let astarOpen = new Uint32Array(0);
let astarClosed = new Uint32Array(0);
let astarHeap = new Int32Array(0);
let astarGen = 0;

function ensureAstarBuffers(size: number): void {
    if (astarSize === size) return;
    astarSize = size;
    astarG = new Float64Array(size);
    astarF = new Float64Array(size);
    astarParent = new Int32Array(size);
    astarOpen = new Uint32Array(size);
    astarClosed = new Uint32Array(size);
    astarHeap = new Int32Array(size);
    astarGen = 0;
}

/**
 * Grid A* over cell indices. Returns the path as cell indices (start..goal), or null.
 * The start cell must be inside the grid. The binary heap (sift order and the
 * in-place decrease-key that updates f without re-sifting) deliberately mirrors the
 * original object-based implementation so results are identical.
 */
function astarGrid(
    startGx: number, startGy: number, goalGx: number, goalGy: number,
    gridW: number, gridH: number, collisionGrid: Uint8Array, dangerGrid: Uint8Array | null | undefined
): number[] | null {
    ensureAstarBuffers(gridW * gridH);
    astarGen++;
    if (astarGen === 0xffffffff) {
        astarOpen.fill(0);
        astarClosed.fill(0);
        astarGen = 1;
    }
    const gen = astarGen;
    const gArr = astarG, fArr = astarF, parent = astarParent, open = astarOpen, closed = astarClosed, heap = astarHeap;
    let heapSize = 0;

    const push = (k: number): void => {
        let i = heapSize++;
        heap[i] = k;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (fArr[heap[p]] <= fArr[heap[i]]) break;
            const t = heap[p]; heap[p] = heap[i]; heap[i] = t;
            i = p;
        }
    };
    const pop = (): number => {
        const min = heap[0];
        const last = heap[--heapSize];
        if (heapSize > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = l + 1;
                let s = i;
                if (l < heapSize && fArr[heap[l]] < fArr[heap[s]]) s = l;
                if (r < heapSize && fArr[heap[r]] < fArr[heap[s]]) s = r;
                if (s === i) break;
                const t = heap[s]; heap[s] = heap[i]; heap[i] = t;
                i = s;
            }
        }
        return min;
    };

    // Octile heuristic for 8-directional movement
    const dx0 = Math.abs(goalGx - startGx);
    const dy0 = Math.abs(goalGy - startGy);
    const startKey = startGy * gridW + startGx;
    gArr[startKey] = 0;
    fArr[startKey] = Math.max(dx0, dy0) + 0.41 * Math.min(dx0, dy0);
    parent[startKey] = -1;
    open[startKey] = gen;
    push(startKey);

    const goalInGrid = goalGx >= 0 && goalGx < gridW && goalGy >= 0 && goalGy < gridH;
    const goalKey = goalInGrid ? goalGy * gridW + goalGx : -1;

    let iterations = 0;
    while (heapSize > 0 && iterations < MAX_ASTAR_ITERATIONS) {
        iterations++;
        const currentKey = pop();
        if (closed[currentKey] === gen) continue;

        if (currentKey === goalKey) {
            const out: number[] = [];
            for (let n = currentKey; n !== -1; n = parent[n]) out.push(n);
            return out.reverse();
        }

        closed[currentKey] = gen;
        open[currentKey] = 0;

        const cx = currentKey % gridW;
        const cy = (currentKey - cx) / gridW;
        const cg = gArr[currentKey];

        for (let d = 0; d < 8; d++) {
            const dx = DIR_DX[d];
            const dy = DIR_DY[d];
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;

            const nk = ny * gridW + nx;
            if (closed[nk] === gen) continue;
            if (collisionGrid[nk] === 1) continue;

            // Check diagonal corner cutting
            if (dx !== 0 && dy !== 0) {
                if (collisionGrid[cy * gridW + nx] === 1 || collisionGrid[ny * gridW + cx] === 1) continue;
            }

            const dangerCost = dangerGrid ? dangerGrid[nk] : 0;
            const g = cg + DIR_COST[d] + dangerCost;
            const isOpen = open[nk] === gen;

            if (!isOpen || g < gArr[nk]) {
                const hdx = Math.abs(goalGx - nx);
                const hdy = Math.abs(goalGy - ny);
                const h = Math.max(hdx, hdy) + 0.41 * Math.min(hdx, hdy);
                gArr[nk] = g;
                fArr[nk] = g + h;
                parent[nk] = currentKey;
                if (!isOpen) {
                    open[nk] = gen;
                    push(nk);
                }
            }
        }
    }
    return null;
}

/**
 * Object-based A* kept only for the rare case of a start cell outside the grid
 * (which the index-based search cannot represent). Returns cell coordinates as
 * a flat [x0, y0, x1, y1, ...] array, or null.
 */
function astarGridOutOfBounds(
    startGx: number, startGy: number, goalGx: number, goalGy: number,
    gridW: number, gridH: number, collisionGrid: Uint8Array, dangerGrid: Uint8Array | null | undefined
): number[] | null {
    interface PathNode { x: number; y: number; g: number; f: number; parent: PathNode | null; }
    const heap: PathNode[] = [];
    const push = (node: PathNode): void => {
        heap.push(node);
        let i = heap.length - 1;
        while (i > 0) {
            const p = Math.floor((i - 1) / 2);
            if (heap[p].f <= heap[i].f) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
        }
    };
    const pop = (): PathNode => {
        const min = heap[0];
        const last = heap.pop()!;
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1;
                const r = 2 * i + 2;
                let s = i;
                if (l < heap.length && heap[l].f < heap[s].f) s = l;
                if (r < heap.length && heap[r].f < heap[s].f) s = r;
                if (s === i) break;
                [heap[s], heap[i]] = [heap[i], heap[s]];
                i = s;
            }
        }
        return min;
    };

    const closedSet = new Uint8Array(gridW * gridH);
    const openMap = new Map<number, PathNode>();
    const dx0 = Math.abs(goalGx - startGx);
    const dy0 = Math.abs(goalGy - startGy);
    const startH = Math.max(dx0, dy0) + 0.41 * Math.min(dx0, dy0);
    const startNode: PathNode = { x: startGx, y: startGy, g: 0, f: startH, parent: null };
    push(startNode);
    openMap.set(startGy * gridW + startGx, startNode);

    let iterations = 0;
    while (heap.length > 0 && iterations < MAX_ASTAR_ITERATIONS) {
        iterations++;
        const current = pop();
        const currentKey = current.y * gridW + current.x;
        if (closedSet[currentKey] === 1) continue;

        if (current.x === goalGx && current.y === goalGy) {
            const coords: number[] = [];
            for (let n: PathNode | null = current; n; n = n.parent) coords.push(n.y, n.x);
            return coords.reverse();
        }

        closedSet[currentKey] = 1;
        openMap.delete(currentKey);

        for (let d = 0; d < 8; d++) {
            const dx = DIR_DX[d];
            const dy = DIR_DY[d];
            const nx = current.x + dx;
            const ny = current.y + dy;
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            const nk = ny * gridW + nx;
            if (closedSet[nk] === 1) continue;
            if (collisionGrid[nk] === 1) continue;
            if (dx !== 0 && dy !== 0) {
                if (collisionGrid[current.y * gridW + nx] === 1 || collisionGrid[ny * gridW + current.x] === 1) continue;
            }
            const g = current.g + DIR_COST[d] + (dangerGrid ? dangerGrid[nk] : 0);
            const existing = openMap.get(nk);
            if (!existing || g < existing.g) {
                const hdx = Math.abs(goalGx - nx);
                const hdy = Math.abs(goalGy - ny);
                const h = Math.max(hdx, hdy) + 0.41 * Math.min(hdx, hdy);
                if (!existing) {
                    const node: PathNode = { x: nx, y: ny, g, f: g + h, parent: current };
                    push(node);
                    openMap.set(nk, node);
                } else {
                    existing.g = g;
                    existing.f = g + h;
                    existing.parent = current;
                }
            }
        }
    }
    return null;
}

function storePathInCache(cacheKey: PathCacheKey, path: Vector[] | null): void {
    if (pathCache.size >= PATH_CACHE_MAX_SIZE) {
        // Remove oldest entry (simple eviction - first entry)
        const firstKey = pathCache.keys().next().value;
        if (firstKey !== undefined && firstKey !== '') pathCache.delete(firstKey);
    }
    pathCache.set(cacheKey, { path, tick: currentPathTick });
}

/**
 * Find a path from start to goal. The returned array (and the cached copy) is shared
 * and must be treated as read-only by callers.
 */
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
        // Paths are read-only (Vectors are immutable), so the cached array can be shared
        return cachedEntry.path;
    }

    const gridW = getGridW();
    const gridH = getGridH();
    const collisionGrid = gridManager.collisionGrid;

    // Check if goal is blocked - if so, find nearest unblocked tile
    let actualGoalGx = goalGx;
    let actualGoalGy = goalGy;

    if (goalGx >= 0 && goalGx < gridW && goalGy >= 0 && goalGy < gridH) {
        if (collisionGrid[goalGy * gridW + goalGx] === 1) {
            // Find nearest unblocked tile
            let found = false;
            for (let r = 1; r <= 5 && !found; r++) {
                for (let dy = -r; dy <= r && !found; dy++) {
                    for (let dx = -r; dx <= r && !found; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const nx = goalGx + dx;
                        const ny = goalGy + dy;
                        if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                            if (collisionGrid[ny * gridW + nx] === 0) {
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

    const startInGrid = startGx >= 0 && startGx < gridW && startGy >= 0 && startGy < gridH;

    // If start is blocked, return null
    if (startInGrid && collisionGrid[startGy * gridW + startGx] === 1) {
        // We're on a blocked tile - return direct movement to let steering handle it
        return null;
    }

    const dangerGrid = ownerId !== undefined ? gridManager.dangerGrids[ownerId] : null;

    let path: Vector[] | null = null;
    const half = TILE_SIZE / 2;
    if (startInGrid) {
        const cells = astarGrid(startGx, startGy, actualGoalGx, actualGoalGy, gridW, gridH, collisionGrid, dangerGrid);
        if (cells) {
            path = new Array<Vector>(cells.length);
            for (let i = 0; i < cells.length; i++) {
                const k = cells[i];
                const x = k % gridW;
                path[i] = new Vector(x * TILE_SIZE + half, ((k - x) / gridW) * TILE_SIZE + half);
            }
        }
    } else {
        const coords = astarGridOutOfBounds(startGx, startGy, actualGoalGx, actualGoalGy, gridW, gridH, collisionGrid, dangerGrid);
        if (coords) {
            path = [];
            for (let i = 0; i < coords.length; i += 2) {
                path.push(new Vector(coords[i] * TILE_SIZE + half, coords[i + 1] * TILE_SIZE + half));
            }
        }
    }

    if (!path) {
        // No path found - cache the negative result too
        storePathInCache(cacheKey, null);
        return null;
    }

    // Add actual goal position
    path.push(goal);

    // OPTIMIZATION: Skip smoothing for short paths - not worth the hasLineOfSight cost
    // Smooth longer paths - remove intermediate waypoints that are in direct line of sight
    const result = path.length <= 4 ? path : smoothPath(path, entityRadius, ownerId);
    storePathInCache(cacheKey, result);
    return result;
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
    const dangerGrid = ownerId !== undefined ? gridManager.dangerGrids[ownerId] : null;
    const gridW = getGridW();
    const gridH = getGridH();
    const collisionGrid = gridManager.collisionGrid;

    // Points around the line to account for entity radius: center, +x, -x, +y, -y
    const offX0 = 0, offX1 = entityRadius, offX2 = -entityRadius, offX3 = 0, offX4 = 0;
    const offY0 = 0, offY1 = 0, offY2 = 0, offY3 = entityRadius, offY4 = -entityRadius;
    const blockedAt = (px: number, py: number): boolean => {
        const gx = Math.floor(px / TILE_SIZE);
        const gy = Math.floor(py / TILE_SIZE);
        if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
            const idx = gy * gridW + gx;
            if (collisionGrid[idx] === 1) return true;
            if (dangerGrid && dangerGrid[idx] > 0) return true;
        }
        return false;
    };

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t;
        const y = from.y + (to.y - from.y) * t;
        if (
            blockedAt(x + offX0, y + offY0) ||
            blockedAt(x + offX1, y + offY1) ||
            blockedAt(x + offX2, y + offY2) ||
            blockedAt(x + offX3, y + offY3) ||
            blockedAt(x + offX4, y + offY4)
        ) {
            return false;
        }
    }
    return true;
}

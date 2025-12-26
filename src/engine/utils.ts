import { Entity, Vector, TILE_SIZE, GRID_W, GRID_H } from './types.js';
import rules from '../data/rules.json';

const RULES = rules as any;

// Collision grid
export const collisionGrid = new Uint8Array(GRID_W * GRID_H);
// Danger grids for Player 0 and Player 1
export const dangerGrids: Record<number, Uint8Array> = {
    0: new Uint8Array(GRID_W * GRID_H), // Danger FOR Player 0 (contains P1 stuff)
    1: new Uint8Array(GRID_W * GRID_H)  // Danger FOR Player 1 (contains P0 stuff)
};

export function markGrid(x: number, y: number, w: number, h: number, blocked: boolean): void {
    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);
    const gw = Math.ceil(w / TILE_SIZE);
    const gh = Math.ceil(h / TILE_SIZE);

    for (let j = gy; j < gy + gh; j++) {
        for (let i = gx; i < gx + gw; i++) {
            if (i >= 0 && i < GRID_W && j >= 0 && j < GRID_H) {
                collisionGrid[j * GRID_W + i] = blocked ? 1 : 0;
            }
        }
    }
}

export function markDanger(playerId: number, x: number, y: number, radius: number): void {
    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);
    const gr = Math.ceil(radius / TILE_SIZE);

    // This grid represents danger FOR the given playerId.
    // So if P1 building, we mark on dangerGrids[0].
    const grid = dangerGrids[playerId];

    for (let j = gy - gr; j <= gy + gr; j++) {
        for (let i = gx - gr; i <= gx + gr; i++) {
            if (i >= 0 && i < GRID_W && j >= 0 && j < GRID_H) {
                // Circle check with distance
                const dx = i - gx;
                const dy = j - gy;
                const distSq = dx * dx + dy * dy;
                if (distSq <= gr * gr) {
                    // Gradient danger cost: higher closer to the center
                    // Center of danger = 100 cost, edge = 50 cost
                    const distRatio = Math.sqrt(distSq) / gr; // 0 at center, 1 at edge
                    const dangerCost = Math.floor(100 - 50 * distRatio);
                    // Use max in case of overlapping danger zones
                    grid[j * GRID_W + i] = Math.max(grid[j * GRID_W + i], dangerCost);
                }
            }
        }
    }
}

export function refreshCollisionGrid(entities: Record<string, Entity> | Entity[]): void {
    collisionGrid.fill(0);
    dangerGrids[0].fill(0);
    dangerGrids[1].fill(0);

    const list = Array.isArray(entities) ? entities : Object.values(entities);
    for (const e of list) {
        if (e.type === 'BUILDING' && !e.dead) {
            markGrid(e.pos.x - e.w / 2, e.pos.y - e.h / 2, e.w, e.h, true);

            // Mark danger if it's a defensive building
            const data = RULES.buildings[e.key];
            if (data && data.isDefense && e.owner !== -1) {
                // Mark danger on the ENEMY's danger map
                const range = (data.range || 200);
                // If I am P0, I create danger for P1.
                // If I am P1, I create danger for P0.
                if (e.owner === 0) markDanger(1, e.pos.x, e.pos.y, range);
                if (e.owner === 1) markDanger(0, e.pos.x, e.pos.y, range);
            }
        }
        // Optional: Mark resources as blocked? 
        // Ore is small, maybe walkable? 
        // Trees?
    }
}

let nextEntityId = 1;

export function createEntity(x: number, y: number, owner: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE', statsKey: string): Entity {
    const isBuilding = type === 'BUILDING';
    const isResource = type === 'RESOURCE';

    let data: any;
    if (isBuilding) {
        data = RULES.buildings[statsKey];
    } else if (isResource) {
        data = { hp: 1000, w: 25, h: 25 };
    } else {
        data = RULES.units[statsKey];
    }

    if (!data) {
        data = { hp: 100, w: 20, h: 20 };
    }

    const entity: Entity = {
        id: 'e' + (nextEntityId++),
        owner,
        type,
        key: statsKey,
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp: data.hp || 100,
        maxHp: data.hp || 100,
        w: data.w || 20,
        h: data.h || data.w || 20,
        radius: Math.max(data.w || 20, data.h || data.w || 20) / 2,
        dead: false,
        vel: new Vector(0, 0),
        rotation: 0,
        moveTarget: null,
        path: null,
        pathIdx: 0,
        finalDest: null,
        stuckTimer: 0,
        unstuckDir: null,
        unstuckTimer: 0,
        targetId: null,
        lastAttackerId: null,
        cooldown: 0,
        flash: 0,
        cargo: 0,
        resourceTargetId: null,
        baseTargetId: null
    };

    return entity;
}

export function findOpenSpot(x: number, y: number, radius: number, entities: Entity[]): Vector {
    for (let r = radius; r < radius + 200; r += 20) {
        for (let a = 0; a < Math.PI * 2; a += 0.5) {
            const cx = x + Math.cos(a) * r;
            const cy = y + Math.sin(a) * r;
            const gx = Math.floor(cx / TILE_SIZE);
            const gy = Math.floor(cy / TILE_SIZE);

            if (gx >= 0 && gx < GRID_W && gy >= 0 && gy < GRID_H && collisionGrid[gy * GRID_W + gx] === 0) {
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

export function spawnParticle(particles: any[], x: number, y: number, color: string, speed: number): void {
    particles.push({
        pos: new Vector(x, y),
        vel: new Vector((Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed),
        life: 15 + Math.random() * 15,
        color
    });
}

export function spawnFloater(particles: any[], x: number, y: number, text: string, color: string): void {
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
    const power: Record<number, { in: number; out: number }> = {
        0: { in: 0, out: 0 },
        1: { in: 0, out: 0 }
    };

    for (const e of entities) {
        if (e.type === 'BUILDING' && !e.dead && e.owner >= 0) {
            const data = RULES.buildings[e.key];
            if (data) {
                if ('power' in data) power[e.owner].out += data.power;
                if ('drain' in data) power[e.owner].in += data.drain;
            }
        }
    }

    return power;
}

export function isValidMCVSpot(x: number, y: number, selfId: string | null, entities: Entity[]): boolean {
    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);

    if (gx >= 0 && gx + 2 < GRID_W && gy >= 0 && gy + 2 < GRID_H) {
        if (collisionGrid[gy * GRID_W + gx] === 1) return false;
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

    // Check if goal is blocked - if so, find nearest unblocked tile
    let actualGoalGx = goalGx;
    let actualGoalGy = goalGy;

    if (goalGx >= 0 && goalGx < GRID_W && goalGy >= 0 && goalGy < GRID_H) {
        if (collisionGrid[goalGy * GRID_W + goalGx] === 1) {
            // Find nearest unblocked tile
            let found = false;
            for (let r = 1; r <= 5 && !found; r++) {
                for (let dy = -r; dy <= r && !found; dy++) {
                    for (let dx = -r; dx <= r && !found; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const nx = goalGx + dx;
                        const ny = goalGy + dy;
                        if (nx >= 0 && nx < GRID_W && ny >= 0 && ny < GRID_H) {
                            if (collisionGrid[ny * GRID_W + nx] === 0) {
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
    if (startGx >= 0 && startGx < GRID_W && startGy >= 0 && startGy < GRID_H) {
        if (collisionGrid[startGy * GRID_W + startGx] === 1) {
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
            return smoothPath(path, entityRadius, ownerId);
        }

        closedSet.add(currentKey);
        openMap.delete(currentKey);

        for (const dir of directions) {
            const nx = current.x + dir.dx;
            const ny = current.y + dir.dy;
            const neighborKey = `${nx},${ny}`;

            if (nx < 0 || nx >= GRID_W || ny < 0 || ny >= GRID_H) continue;
            if (closedSet.has(neighborKey)) continue;
            if (collisionGrid[ny * GRID_W + nx] === 1) continue;

            // Check diagonal corner cutting
            if (dir.dx !== 0 && dir.dy !== 0) {
                const corner1 = collisionGrid[current.y * GRID_W + nx];
                const corner2 = collisionGrid[ny * GRID_W + current.x];
                if (corner1 === 1 || corner2 === 1) continue; // Don't cut corners
            }

            // Calculate heuristic cost modifier for danger
            let dangerCost = 0;
            if (dangerGrid) {
                dangerCost = dangerGrid[ny * GRID_W + nx];
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

    // No path found
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

            if (gx >= 0 && gx < GRID_W && gy >= 0 && gy < GRID_H) {
                const idx = gy * GRID_W + gx;
                if (collisionGrid[idx] === 1) {
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


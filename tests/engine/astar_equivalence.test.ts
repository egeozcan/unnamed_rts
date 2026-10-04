import { describe, it, expect } from 'vitest';
import { Vector, TILE_SIZE } from '../../src/engine/types';
import {
    findPath, refreshCollisionGrid, setPathCacheTick, markGrid, markDanger,
    collisionGrid, dangerGrids, getGridW, getGridH
} from '../../src/engine/utils';

/**
 * Reference: the original object-based A* + smoothing that findPath replaced with a
 * typed-array implementation. findPath must produce identical paths.
 */
interface RefNode { x: number; y: number; g: number; f: number; parent: RefNode | null; }

function referenceFindPath(start: Vector, goal: Vector, entityRadius: number, ownerId?: number): Vector[] | null {
    const W = getGridW(), H = getGridH();
    const startGx = Math.floor(start.x / TILE_SIZE), startGy = Math.floor(start.y / TILE_SIZE);
    const goalGx = Math.floor(goal.x / TILE_SIZE), goalGy = Math.floor(goal.y / TILE_SIZE);
    let agx = goalGx, agy = goalGy;
    if (goalGx >= 0 && goalGx < W && goalGy >= 0 && goalGy < H && collisionGrid[goalGy * W + goalGx] === 1) {
        let found = false;
        for (let r = 1; r <= 5 && !found; r++) {
            for (let dy = -r; dy <= r && !found; dy++) {
                for (let dx = -r; dx <= r && !found; dx++) {
                    if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                    const nx = goalGx + dx, ny = goalGy + dy;
                    if (nx >= 0 && nx < W && ny >= 0 && ny < H && collisionGrid[ny * W + nx] === 0) {
                        agx = nx; agy = ny; found = true;
                    }
                }
            }
        }
    }
    if (startGx >= 0 && startGx < W && startGy >= 0 && startGy < H && collisionGrid[startGy * W + startGx] === 1) return null;

    const danger = ownerId !== undefined ? dangerGrids[ownerId] : null;
    const heap: RefNode[] = [];
    const push = (n: RefNode) => {
        heap.push(n);
        let i = heap.length - 1;
        while (i > 0) {
            const p = Math.floor((i - 1) / 2);
            if (heap[p].f <= heap[i].f) break;
            [heap[p], heap[i]] = [heap[i], heap[p]];
            i = p;
        }
    };
    const pop = (): RefNode => {
        const min = heap[0];
        const last = heap.pop()!;
        if (heap.length > 0) {
            heap[0] = last;
            let i = 0;
            for (;;) {
                const l = 2 * i + 1, r = 2 * i + 2;
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
    const closed = new Uint8Array(W * H);
    const open = new Map<number, RefNode>();
    const dx0 = Math.abs(agx - startGx), dy0 = Math.abs(agy - startGy);
    const h0 = Math.max(dx0, dy0) + 0.41 * Math.min(dx0, dy0);
    const s: RefNode = { x: startGx, y: startGy, g: 0, f: h0, parent: null };
    push(s);
    open.set(startGy * W + startGx, s);
    const dirs = [[0, -1, 1], [1, -1, 1.41], [1, 0, 1], [1, 1, 1.41], [0, 1, 1], [-1, 1, 1.41], [-1, 0, 1], [-1, -1, 1.41]];
    let it = 0;
    while (heap.length > 0 && it < 4000) {
        it++;
        const c = pop();
        const ck = c.y * W + c.x;
        if (closed[ck] === 1) continue;
        if (c.x === agx && c.y === agy) {
            const cells: RefNode[] = [];
            for (let n: RefNode | null = c; n; n = n.parent) cells.unshift(n);
            const path = cells.map(p => new Vector(p.x * TILE_SIZE + TILE_SIZE / 2, p.y * TILE_SIZE + TILE_SIZE / 2));
            path.push(goal);
            if (path.length <= 4) return path;
            return refSmooth(path, entityRadius, ownerId);
        }
        closed[ck] = 1;
        open.delete(ck);
        for (const [dx, dy, cost] of dirs) {
            const nx = c.x + dx, ny = c.y + dy;
            if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
            const nk = ny * W + nx;
            if (closed[nk] === 1 || collisionGrid[nk] === 1) continue;
            if (dx !== 0 && dy !== 0 && (collisionGrid[c.y * W + nx] === 1 || collisionGrid[ny * W + c.x] === 1)) continue;
            const g = c.g + cost + (danger ? danger[nk] : 0);
            const ex = open.get(nk);
            if (!ex || g < ex.g) {
                const hdx = Math.abs(agx - nx), hdy = Math.abs(agy - ny);
                const h = Math.max(hdx, hdy) + 0.41 * Math.min(hdx, hdy);
                if (!ex) {
                    const n: RefNode = { x: nx, y: ny, g, f: g + h, parent: c };
                    push(n);
                    open.set(nk, n);
                } else {
                    ex.g = g; ex.f = g + h; ex.parent = c;
                }
            }
        }
    }
    return null;
}

function refSmooth(path: Vector[], r: number, ownerId?: number): Vector[] {
    const out = [path[0]];
    let cur = 0;
    while (cur < path.length - 1) {
        let far = cur + 1;
        for (let i = cur + 2; i < path.length; i++) if (refLos(path[cur], path[i], r, ownerId)) far = i;
        out.push(path[far]);
        cur = far;
    }
    return out;
}

function refLos(from: Vector, to: Vector, r: number, ownerId?: number): boolean {
    const W = getGridW(), H = getGridH();
    const steps = Math.ceil(from.dist(to) / (TILE_SIZE / 2));
    const danger = ownerId !== undefined ? dangerGrids[ownerId] : null;
    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + (to.x - from.x) * t, y = from.y + (to.y - from.y) * t;
        for (const [ox, oy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
            const gx = Math.floor((x + ox) / TILE_SIZE), gy = Math.floor((y + oy) / TILE_SIZE);
            if (gx >= 0 && gx < W && gy >= 0 && gy < H) {
                const idx = gy * W + gx;
                if (collisionGrid[idx] === 1) return false;
                if (danger && danger[idx] > 0) return false;
            }
        }
    }
    return true;
}

function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const serialize = (p: Vector[] | null) => (p ? p.map(v => `${v.x},${v.y}`).join(' ') : 'null');

describe('findPath typed-array A* equivalence', () => {
    it('matches the reference A* on random obstacle and danger maps', () => {
        let tick = 100000;
        let compared = 0, found = 0;
        for (let map = 0; map < 12; map++) {
            const rnd = mulberry32(1000 + map);
            const size = 30 + Math.floor(rnd() * 40); // tiles
            refreshCollisionGrid({}, { width: size * TILE_SIZE, height: size * TILE_SIZE }, [0, 1]);
            const blocks = Math.floor(size * size * (0.05 + rnd() * 0.15) / 4);
            for (let b = 0; b < blocks; b++) {
                markGrid(rnd() * size * TILE_SIZE, rnd() * size * TILE_SIZE, (1 + Math.floor(rnd() * 4)) * TILE_SIZE, (1 + Math.floor(rnd() * 4)) * TILE_SIZE, true);
            }
            for (let d = 0; d < 4; d++) {
                markDanger(1, rnd() * size * TILE_SIZE, rnd() * size * TILE_SIZE, 100 + rnd() * 200);
            }
            for (let q = 0; q < 40; q++) {
                // Mostly in-bounds; occasionally out-of-bounds starts/goals
                const coord = () => (rnd() < 0.05 ? -60 - rnd() * 100 : rnd() * size * TILE_SIZE);
                const start = new Vector(coord(), coord());
                const goal = new Vector(coord(), coord());
                for (const owner of [undefined, 0, 1]) {
                    tick += 1000; // expire the path cache between queries
                    setPathCacheTick(tick);
                    const radius = 5 + rnd() * 20;
                    const actual = findPath(start, goal, radius, owner);
                    const expected = referenceFindPath(start, goal, radius, owner);
                    expect(serialize(actual)).toBe(serialize(expected));
                    compared++;
                    if (expected) found++;
                }
            }
        }
        expect(compared).toBeGreaterThan(1000);
        expect(found).toBeGreaterThan(100);
    });

    it('returns the cached path on a repeat query', () => {
        refreshCollisionGrid({}, { width: 40 * TILE_SIZE, height: 40 * TILE_SIZE }, [0]);
        setPathCacheTick(999999);
        const a = findPath(new Vector(50, 50), new Vector(1300, 900), 10, 0);
        const b = findPath(new Vector(50, 50), new Vector(1300, 900), 10, 0);
        expect(a).not.toBeNull();
        expect(serialize(b)).toBe(serialize(a));
    });
});

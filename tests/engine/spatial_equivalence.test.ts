import { describe, it, expect } from 'vitest';
import { Vector, Entity } from '../../src/engine/types.js';
import { SpatialGrid, ownerBit } from '../../src/engine/spatial.js';

/**
 * The spatial grid is on the hottest path of the simulation, so it avoids Sets/strings and
 * de-duplicates multi-cell entities structurally. These tests compare it against a naive
 * brute-force implementation on randomised data to make sure results (including ordering
 * guarantees such as "no duplicates" and "ties go to the first candidate") stay correct.
 */

function mulberry(seed: number) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function makeEntities(count: number, rand: () => number, mapSize = 1000): Entity[] {
    const list: Entity[] = [];
    for (let i = 0; i < count; i++) {
        const x = rand() * mapSize;
        const y = rand() * mapSize;
        // Mix of small units and big footprints that span several 100px cells
        const radius = rand() < 0.15 ? 60 + rand() * 80 : 8 + rand() * 12;
        list.push({
            id: `e${i}`, owner: Math.floor(rand() * 4) - 1, type: rand() < 0.5 ? 'UNIT' : 'BUILDING',
            key: 'test', dead: false, pos: new Vector(x, y), prevPos: new Vector(x, y),
            hp: 1, maxHp: 1, w: radius * 2, h: radius * 2, radius
        } as unknown as Entity);
    }
    return list;
}

describe('SpatialGrid equivalence with brute force', () => {
    const rand = mulberry(12345);
    const entities = makeEntities(300, rand);
    const grid = new SpatialGrid(100);
    grid.rebuild(entities);

    it('queryRadius returns every overlapping entity exactly once', () => {
        for (let q = 0; q < 200; q++) {
            const x = rand() * 1000, y = rand() * 1000, r = 20 + rand() * 300;
            const result = grid.queryRadius(x, y, r);
            const ids = result.map(e => e.id);
            expect(new Set(ids).size).toBe(ids.length); // no duplicates

            // Every entity whose exact circle overlaps must be present
            for (const e of entities) {
                const d = Math.hypot(e.pos.x - x, e.pos.y - y);
                if (d <= r + e.radius) expect(ids).toContain(e.id);
            }
        }
    });

    it('queryRadiusExact matches brute force', () => {
        for (let q = 0; q < 200; q++) {
            const x = rand() * 1000, y = rand() * 1000, r = 20 + rand() * 300;
            const expected = entities
                .filter(e => (e.pos.x - x) ** 2 + (e.pos.y - y) ** 2 <= (r + e.radius) ** 2)
                .map(e => e.id).sort();
            const actual = grid.queryRadiusExact(x, y, r).map(e => e.id).sort();
            expect(actual).toEqual(expected);
        }
    });

    it('findNearest matches brute force (including predicate)', () => {
        const predicate = (e: Entity) => e.owner === 1 || e.owner === 2;
        for (let q = 0; q < 200; q++) {
            const x = rand() * 1000, y = rand() * 1000, r = 50 + rand() * 300;
            let best: Entity | null = null;
            let bestD = Infinity;
            for (const e of entities) {
                const d2 = (e.pos.x - x) ** 2 + (e.pos.y - y) ** 2;
                if (d2 > (r + e.radius) ** 2 || !predicate(e)) continue;
                if (d2 < bestD) { bestD = d2; best = e; }
            }
            const found = grid.findNearest(x, y, r, predicate);
            expect(found?.id).toBe(best?.id);
        }
    });

    it('owner-mask pruning never changes findNearest results', () => {
        const ignored = ownerBit(0) | ownerBit(3);
        const predicate = (e: Entity) => e.owner !== 0 && e.owner !== 3 && e.owner !== -1;
        for (let q = 0; q < 200; q++) {
            const x = rand() * 1000, y = rand() * 1000, r = 50 + rand() * 300;
            expect(grid.findNearest(x, y, r, predicate, ignored)?.id)
                .toBe(grid.findNearest(x, y, r, predicate)?.id);
        }
    });

    it('rebuild fully replaces previous contents (pooled cells are reset)', () => {
        const g = new SpatialGrid(100);
        g.rebuild(makeEntities(50, mulberry(1)));
        const fresh = makeEntities(10, mulberry(2));
        g.rebuild(fresh);
        const all = g.queryRadius(500, 500, 2000);
        expect(all.map(e => e.id).sort()).toEqual(fresh.map(e => e.id).sort());
        // owner masks must be reset too, otherwise pruning would see ghosts
        g.rebuild([]);
        expect(g.findNearest(500, 500, 2000, () => true, 0)).toBeNull();
        expect(g.queryRadius(500, 500, 2000)).toEqual([]);
    });
});

import { describe, it, expect } from 'vitest';
import { INITIAL_STATE } from '../../src/engine/reducer.js';
import type { Entity, GameState } from '../../src/engine/types.js';
import { createEntityCache, getEnemiesOf } from '../../src/engine/perf.js';
import { getTransportPassengers } from '../../src/engine/transport.js';
import {
    createTestBuilding,
    createTestCombatUnit,
    createTestResource,
    createTestRock,
    createTestWell
} from '../../src/engine/test-utils.js';
import {
    getAIEntityIndex,
    getEnemiesOfMemo,
    getOwnedEntities,
    getOwnedUnits,
    getTransportPassengersMemo
} from '../../src/engine/ai/tick_memo.js';
import { OrderedEntityGrid } from '../../src/engine/ai/ordered_grid.js';

function stateWith(entities: Entity[]): GameState {
    const record: Record<string, Entity> = {};
    for (const e of entities) record[e.id] = e;
    return { ...INITIAL_STATE, entities: record } as GameState;
}

/** Deterministic pseudo-random generator so the test is reproducible */
function lcg(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;
    };
}

describe('AI tick memo', () => {
    const apc = createTestCombatUnit({ id: 'apc1', owner: 0, key: 'apc', x: 300, y: 300 });
    const rider = createTestCombatUnit({ id: 'eng1', owner: 0, key: 'engineer', x: 300, y: 300 });
    const riderInApc = { ...rider, movement: { ...rider.movement, transportId: 'apc1' } } as Entity;
    const deadUnit = createTestCombatUnit({ id: 'dead0', owner: 0, dead: true });
    const enemyUnit = createTestCombatUnit({ id: 'enemy1', owner: 1, x: 900, y: 900 });
    const refinery = createTestBuilding({ id: 'ref1', owner: 1, key: 'refinery', x: 800, y: 800 });
    const deadBuilding = { ...createTestBuilding({ id: 'b_dead', owner: 1, key: 'power' }), dead: true } as Entity;
    const ore = createTestResource({ id: 'ore1', x: 100, y: 100 });
    const deadOre = { ...createTestResource({ id: 'ore_dead' }), dead: true } as Entity;
    const rock = createTestRock({ id: 'rock1' });
    const well = createTestWell({ id: 'well1' });
    const all = [apc, riderInApc, deadUnit, enemyUnit, refinery, deadBuilding, ore, deadOre, rock, well];
    const state = stateWith(all);

    it('matches the Object.values scans it replaces, in the same order', () => {
        const values = Object.values(state.entities);
        const index = getAIEntityIndex(state);
        expect(index.all).toEqual(values);
        expect(getOwnedEntities(state, 0)).toEqual(values.filter(e => e.owner === 0));
        expect(getOwnedUnits(state, 0)).toEqual(values.filter(e => e.owner === 0 && e.type === 'UNIT'));
        expect(index.aliveOre).toEqual(values.filter(e => e.type === 'RESOURCE' && !e.dead));
        expect(index.aliveWells).toEqual(values.filter(e => e.type === 'WELL' && !e.dead));
        expect(index.aliveRefineries).toEqual(values.filter(e => e.type === 'BUILDING' && e.key === 'refinery' && !e.dead));
        expect(index.placementObstacles).toEqual(values.filter(e =>
            !e.dead && (e.type === 'BUILDING' || e.type === 'RESOURCE' || e.type === 'ROCK' || e.type === 'WELL')));
    });

    it('keeps transported infantry, unlike the EntityCache', () => {
        expect(getOwnedUnits(state, 0).map(e => e.id)).toContain('eng1');
        expect(getTransportPassengersMemo(state, 'apc1')).toEqual(getTransportPassengers(state.entities, 'apc1'));
        expect(getTransportPassengersMemo(state, 'nope')).toEqual([]);
    });

    it('is rebuilt for a new entities object', () => {
        const first = getAIEntityIndex(state);
        expect(getAIEntityIndex(state)).toBe(first);
        const next = stateWith(all.slice(0, 3));
        expect(getAIEntityIndex(next)).not.toBe(first);
        expect(getAIEntityIndex(next).all).toHaveLength(3);
    });

    it('memoizes getEnemiesOf per cache and player', () => {
        const cache = createEntityCache(state.entities);
        const enemies = getEnemiesOfMemo(cache, 0, state);
        expect(enemies).toEqual(getEnemiesOf(cache, 0, state));
        expect(getEnemiesOfMemo(cache, 0, state)).toBe(enemies);
        expect(getEnemiesOfMemo(cache, 1, state)).toEqual(getEnemiesOf(cache, 1, state));
        expect(getEnemiesOfMemo(createEntityCache(state.entities), 0, state)).not.toBe(enemies);
    });
});

describe('OrderedEntityGrid', () => {
    it('returns exactly the linear box-scan result in source order', () => {
        const rand = lcg(42);
        const items: Entity[] = [];
        for (let i = 0; i < 400; i++) {
            items.push(createTestCombatUnit({ id: `u${i}`, x: rand() * 3000 - 200, y: rand() * 3000 - 200 }));
        }
        const grid = new OrderedEntityGrid(items, 200);
        for (let q = 0; q < 200; q++) {
            const x = rand() * 3000, y = rand() * 3000, r = 30 + rand() * 600;
            const expected = items.filter(e => Math.abs(e.pos.x - x) < r && Math.abs(e.pos.y - y) < r);
            expect(grid.queryBox(x, y, r, []).map(e => e.id)).toEqual(expected.map(e => e.id));
        }
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { update, INITIAL_STATE } from '../../src/engine/reducer.js';
import { createTestWell, createTestResource, addEntityToState, addEntitiesToState, resetTestEntityCounter } from '../../src/engine/test-utils.js';
import { GameState } from '../../src/engine/types.js';

describe('Ore Wells', () => {
    let baseState: GameState;

    beforeEach(() => {
        resetTestEntityCounter();
        baseState = {
            ...INITIAL_STATE,
            running: true,
            config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' }
        };
    });

    describe('ore spawning logic', () => {
        it('should spawn ore when no ores exist and tick reaches nextSpawnTick', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 1 });
            let state = addEntityToState(baseState, well);

            // Initial state should have just the well
            const initialOreCount = Object.values(state.entities).filter(e => e.type === 'RESOURCE').length;
            expect(initialOreCount).toBe(0);

            // Tick to spawn time
            state = update(state, { type: 'TICK' });

            const ores = Object.values(state.entities).filter(e => e.type === 'RESOURCE');
            expect(ores.length).toBe(1);
        });

        it('should NOT spawn ore if existing ore is not full', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 1 });
            const notFullOre = createTestResource({ x: 550, y: 500, hp: 500, maxHp: 1000 });
            let state = addEntitiesToState(baseState, [well, notFullOre]);

            state = update(state, { type: 'TICK' });

            const ores = Object.values(state.entities).filter(e => e.type === 'RESOURCE');
            expect(ores.length).toBe(1); // Should still be 1, no new spawn
        });

        it('should spawn ore if existing ore IS full', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 1 });
            const fullOre = createTestResource({ x: 550, y: 500, hp: 1000, maxHp: 1000 });
            let state = addEntitiesToState(baseState, [well, fullOre]);

            state = update(state, { type: 'TICK' });

            const ores = Object.values(state.entities).filter(e => e.type === 'RESOURCE');
            expect(ores.length).toBe(2); // Should spawn new one
        });
    });

    describe('ore growth logic', () => {
        it('should grow non-full ore', () => {
            const well = createTestWell({ x: 500, y: 500 });
            const ore = createTestResource({ x: 550, y: 500, hp: 200, maxHp: 1000 });
            let state = addEntitiesToState(baseState, [well, ore]);

            state = update(state, { type: 'TICK' });

            const updatedOre = state.entities[ore.id];
            expect(updatedOre.hp).toBeGreaterThan(200);
        });

        it('should grow ONLY ONE ore at a time', () => {
            const well = createTestWell({ x: 500, y: 500 });
            const ore1 = createTestResource({ x: 550, y: 500, hp: 200, maxHp: 1000 });
            const ore2 = createTestResource({ x: 450, y: 500, hp: 200, maxHp: 1000 });

            let state = addEntitiesToState(baseState, [well, ore1, ore2]);
            const nextState = update(state, { type: 'TICK' });

            const nextOre1 = nextState.entities[ore1.id];
            const nextOre2 = nextState.entities[ore2.id];

            // Only one should have grown
            const ore1Grew = nextOre1.hp > 200;
            const ore2Grew = nextOre2.hp > 200;

            expect(ore1Grew !== ore2Grew).toBe(true); // XOR - one grew, other didn't
        });
    });

    describe('ore limit', () => {
        it('should not spawn beyond maxOrePerWell even if all full', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 0 });

            // Add 4 full ores (max is 4)
            const ores = [];
            for (let i = 0; i < 4; i++) {
                ores.push(createTestResource({
                    x: 500 + i * 30,
                    y: 500,
                    hp: 1000,
                    maxHp: 1000
                }));
            }
            let state = addEntitiesToState(baseState, [well, ...ores]);

            state = update(state, { type: 'TICK' });

            const finalOreCount = Object.values(state.entities).filter(e => e.type === 'RESOURCE').length;
            expect(finalOreCount).toBe(4);
        });
    });

    describe('well type guard', () => {
        it('should identify well entities correctly', async () => {
            const { isWell } = await import('../../src/engine/type-guards.js');

            const well = createTestWell();
            const ore = createTestResource();

            expect(isWell(well)).toBe(true);
            expect(isWell(ore)).toBe(false);
        });
    });
});

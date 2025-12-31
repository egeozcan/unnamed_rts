import { describe, it, expect, beforeEach } from 'vitest';
import { update, INITIAL_STATE } from './reducer.js';
import { createTestWell, createTestResource, addEntityToState, addEntitiesToState, resetTestEntityCounter } from './test-utils.js';
import { GameState, WellEntity } from './types.js';

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

    describe('ore spawning', () => {
        it('should spawn ore when tick reaches nextSpawnTick', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 1 });
            let state = addEntityToState(baseState, well);

            // Initial state should have just the well
            const initialOreCount = Object.values(state.entities).filter(e => e.type === 'RESOURCE').length;
            expect(initialOreCount).toBe(0);

            // Tick to spawn time
            state = update(state, { type: 'TICK' });

            const entities = Object.values(state.entities);
            const ores = entities.filter(e => e.type === 'RESOURCE');
            expect(ores.length).toBe(1);

            // Verify ore spawned near well
            const ore = ores[0];
            const distToWell = well.pos.dist(ore.pos);
            expect(distToWell).toBeLessThanOrEqual(120); // oreSpawnRadius from rules
        });

        it('should spawn ore with initial amount from config', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 1 });
            let state = addEntityToState(baseState, well);

            state = update(state, { type: 'TICK' });

            const ores = Object.values(state.entities).filter(e => e.type === 'RESOURCE');
            expect(ores.length).toBe(1);
            // Initial amount is 200, but ore growth (0.5 hp/tick) also happens in the same tick
            expect(ores[0].hp).toBe(200.5); // initialOreAmount (200) + oreGrowthRate (0.5)
            expect(ores[0].maxHp).toBe(1000); // maxOreAmount from rules
        });

        it('should not spawn ore before nextSpawnTick', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 100 });
            let state = addEntityToState(baseState, well);

            // Run 10 ticks (not enough to reach spawn time)
            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }

            const ores = Object.values(state.entities).filter(e => e.type === 'RESOURCE');
            expect(ores.length).toBe(0);
        });

        it('should update nextSpawnTick after spawning ore', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 1 });
            let state = addEntityToState(baseState, well);

            state = update(state, { type: 'TICK' });

            const updatedWell = state.entities[well.id] as WellEntity;
            expect(updatedWell.well.nextSpawnTick).toBeGreaterThan(1);
            // Should be between tick + spawnRateTicksMin and tick + spawnRateTicksMax
            expect(updatedWell.well.nextSpawnTick).toBeGreaterThanOrEqual(1 + 900);
            expect(updatedWell.well.nextSpawnTick).toBeLessThanOrEqual(1 + 1500);
        });

        it('should increment totalSpawned counter', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 1, totalSpawned: 5 });
            let state = addEntityToState(baseState, well);

            state = update(state, { type: 'TICK' });

            const updatedWell = state.entities[well.id] as WellEntity;
            expect(updatedWell.well.totalSpawned).toBe(6);
        });
    });

    describe('ore limit', () => {
        it('should not exceed maxOrePerWell', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 0 });

            // Add 4 ore entities near well (at max from rules)
            const ores = [];
            for (let i = 0; i < 4; i++) {
                const angle = (i / 4) * Math.PI * 2;
                ores.push(createTestResource({
                    x: 500 + Math.cos(angle) * 50,
                    y: 500 + Math.sin(angle) * 50
                }));
            }
            let state = addEntitiesToState(baseState, [well, ...ores]);

            const initialOreCount = Object.values(state.entities).filter(e => e.type === 'RESOURCE').length;
            expect(initialOreCount).toBe(4);

            // Run tick - should NOT spawn more ore
            state = update(state, { type: 'TICK' });

            const finalOreCount = Object.values(state.entities).filter(e => e.type === 'RESOURCE').length;
            expect(finalOreCount).toBe(4);
        });

        it('should spawn ore when below maxOrePerWell', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 1 });

            // Add 2 ore entities near well (below max of 4)
            const ores = [];
            for (let i = 0; i < 2; i++) {
                const angle = (i / 2) * Math.PI * 2;
                ores.push(createTestResource({
                    x: 500 + Math.cos(angle) * 50,
                    y: 500 + Math.sin(angle) * 50
                }));
            }
            let state = addEntitiesToState(baseState, [well, ...ores]);

            state = update(state, { type: 'TICK' });

            const finalOreCount = Object.values(state.entities).filter(e => e.type === 'RESOURCE').length;
            expect(finalOreCount).toBe(3); // 2 + 1 spawned
        });

        it('should track currentOreCount', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 9999 });

            // Add 3 ore entities near well
            const ores = [];
            for (let i = 0; i < 3; i++) {
                ores.push(createTestResource({
                    x: 500 + i * 30,
                    y: 500
                }));
            }
            let state = addEntitiesToState(baseState, [well, ...ores]);

            state = update(state, { type: 'TICK' });

            const updatedWell = state.entities[well.id] as WellEntity;
            expect(updatedWell.well.currentOreCount).toBe(3);
        });
    });

    describe('ore growth', () => {
        it('should grow ore hp over time when near well', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 9999 });
            const ore = createTestResource({ x: 550, y: 500, hp: 200, maxHp: 1000 });
            let state = addEntitiesToState(baseState, [well, ore]);

            // Run several ticks
            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }

            const updatedOre = state.entities[ore.id];
            expect(updatedOre.hp).toBeGreaterThan(200);
            // Growth rate is 0.5 hp/tick from rules
            expect(updatedOre.hp).toBe(200 + 10 * 0.5);
        });

        it('should not grow ore beyond maxHp', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 9999 });
            const ore = createTestResource({ x: 550, y: 500, hp: 995, maxHp: 1000 });
            let state = addEntitiesToState(baseState, [well, ore]);

            // Run several ticks - should cap at maxHp (1000)
            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }

            const updatedOre = state.entities[ore.id];
            expect(updatedOre.hp).toBe(1000);
        });

        it('should not grow ore that is far from wells', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 9999 });
            // Place ore outside the well's radius (120px from rules)
            const ore = createTestResource({ x: 800, y: 500, hp: 200 });
            let state = addEntitiesToState(baseState, [well, ore]);

            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }

            const updatedOre = state.entities[ore.id];
            expect(updatedOre.hp).toBe(200); // No growth
        });
    });

    describe('well type guard', () => {
        it('should identify well entities correctly', async () => {
            const { isWell } = await import('./type-guards.js');

            const well = createTestWell();
            const ore = createTestResource();

            expect(isWell(well)).toBe(true);
            expect(isWell(ore)).toBe(false);
        });
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { update, INITIAL_STATE } from '../../src/engine/reducer.js';
import { createTestWell, createTestResource, createTestBuilding, createTestCombatUnit, addEntityToState, addEntitiesToState, resetTestEntityCounter } from '../../src/engine/test-utils.js';
import { GameState, WellEntity } from '../../src/engine/types.js';

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

    describe('spawn collision avoidance', () => {
        it('should not spawn ore inside a building', () => {
            // Place a well surrounded by dense buildings covering the entire spawn radius (30-120px)
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 0 });
            // Use larger factory buildings (100x100, radius 50) packed densely around the well
            // Spawn radius is 30-120px, so we need to cover that entire ring
            const buildings = [];
            // Inner ring at distance ~60
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 3) {
                buildings.push(createTestBuilding({
                    x: 500 + Math.cos(angle) * 60,
                    y: 500 + Math.sin(angle) * 60,
                    owner: 0,
                    key: 'factory'  // 100x100, radius 50
                }));
            }
            // Outer ring at distance ~100
            for (let angle = Math.PI / 6; angle < Math.PI * 2; angle += Math.PI / 3) {
                buildings.push(createTestBuilding({
                    x: 500 + Math.cos(angle) * 100,
                    y: 500 + Math.sin(angle) * 100,
                    owner: 0,
                    key: 'factory'
                }));
            }
            let state = addEntitiesToState(baseState, [well, ...buildings]);

            // Try to spawn
            state = update(state, { type: 'TICK' });

            // Well should be blocked since there's no valid spawn location
            const updatedWell = state.entities[well.id] as WellEntity;
            expect(updatedWell.well.isBlocked).toBe(true);

            // No ore should have spawned
            const ores = Object.values(state.entities).filter(e => e.type === 'RESOURCE');
            expect(ores.length).toBe(0);
        });

        it('should not spawn ore inside a unit', () => {
            // Similar test with units surrounding the well
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 0 });
            // Densely pack units around well
            const units = [];
            for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                for (let dist = 40; dist <= 100; dist += 30) {
                    units.push(createTestCombatUnit({
                        x: 500 + Math.cos(angle) * dist,
                        y: 500 + Math.sin(angle) * dist,
                        owner: 0,
                        key: 'heavy'
                    }));
                }
            }
            let state = addEntitiesToState(baseState, [well, ...units]);

            state = update(state, { type: 'TICK' });

            const updatedWell = state.entities[well.id] as WellEntity;
            expect(updatedWell.well.isBlocked).toBe(true);
        });

        it('should spawn ore when there is an opening between blockers', () => {
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 0 });
            // Only place buildings on one side, leaving the other side open
            const buildings = [
                createTestBuilding({ x: 550, y: 500, owner: 0, key: 'power' }),
                createTestBuilding({ x: 550, y: 550, owner: 0, key: 'power' }),
            ];
            let state = addEntitiesToState(baseState, [well, ...buildings]);

            state = update(state, { type: 'TICK' });

            // Should have spawned somewhere
            const ores = Object.values(state.entities).filter(e => e.type === 'RESOURCE');
            expect(ores.length).toBe(1);

            // Well should not be blocked
            const updatedWell = state.entities[well.id] as WellEntity;
            expect(updatedWell.well.isBlocked).toBe(false);
        });

        it('should become unblocked when blockers move away', () => {
            // Start with a blocked well
            const well = createTestWell({ x: 500, y: 500, nextSpawnTick: 0, isBlocked: true });
            let state = addEntityToState(baseState, well);

            // No blockers, so it should spawn and become unblocked
            state = update(state, { type: 'TICK' });

            const updatedWell = state.entities[well.id] as WellEntity;
            expect(updatedWell.well.isBlocked).toBe(false);
        });

        it('should reset isBlocked when growing ore (not spawning)', () => {
            // Well with non-full ore should be actively growing
            const well = createTestWell({ x: 500, y: 500, isBlocked: true });
            const notFullOre = createTestResource({ x: 550, y: 500, hp: 500, maxHp: 1000 });
            let state = addEntitiesToState(baseState, [well, notFullOre]);

            state = update(state, { type: 'TICK' });

            // Well is growing ore, so should not be blocked
            const updatedWell = state.entities[well.id] as WellEntity;
            expect(updatedWell.well.isBlocked).toBe(false);
        });
    });
});

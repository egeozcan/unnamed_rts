import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from '../../src/engine/reducer';
import { createFogGrid, updateFogOfWar } from '../../src/engine/reducers/fog';
import { createTestCombatUnit, createTestBuilding } from '../../src/engine/test-utils';
import { GameState, Vector, TILE_SIZE } from '../../src/engine/types';

describe('Fog of War', () => {
    // ---- INITIAL_STATE ----

    it('INITIAL_STATE includes fogOfWar: {}', () => {
        expect(INITIAL_STATE.fogOfWar).toEqual({});
    });

    // ---- createFogGrid ----

    describe('createFogGrid', () => {
        it('creates correctly sized Uint8Array for 3000x3000 map', () => {
            const grid = createFogGrid(3000, 3000);
            // 3000 / 40 = 75 tiles per axis
            expect(grid).toBeInstanceOf(Uint8Array);
            expect(grid.length).toBe(75 * 75);
        });

        it('handles non-evenly-divisible map sizes (ceil)', () => {
            // 2010 / 40 = 50.25 => ceil = 51
            // 1990 / 40 = 49.75 => ceil = 50
            const grid = createFogGrid(2010, 1990);
            expect(grid.length).toBe(51 * 50);
        });

        it('initializes all tiles to 0 (unseen)', () => {
            const grid = createFogGrid(400, 400); // 10x10
            for (let i = 0; i < grid.length; i++) {
                expect(grid[i]).toBe(0);
            }
        });
    });

    // ---- updateFogOfWar ----

    describe('updateFogOfWar', () => {
        function makeTestState(overrides: Partial<GameState> = {}): GameState {
            return {
                ...INITIAL_STATE,
                config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
                ...overrides
            };
        }

        it('reveals tiles around a unit with sightRange', () => {
            // rifle has sightRange: 200 => 200/40 = 5 tiles
            const unit = createTestCombatUnit({
                owner: 0,
                key: 'rifle',
                x: 500,
                y: 500
            });

            const fogGrid = createFogGrid(3000, 3000);
            const state = makeTestState({
                entities: { [unit.id]: unit },
                fogOfWar: { 0: fogGrid }
            });

            const result = updateFogOfWar(state);
            const grid = result[0];

            // Unit is at pixel (500, 500) => tile (12, 12)
            const centerTX = Math.floor(500 / TILE_SIZE); // 12
            const centerTY = Math.floor(500 / TILE_SIZE); // 12
            const gridW = Math.ceil(3000 / TILE_SIZE); // 75

            // Center tile should be revealed
            expect(grid[centerTY * gridW + centerTX]).toBe(1);

            // Tile 3 tiles away (within range) should be revealed
            expect(grid[centerTY * gridW + (centerTX + 3)]).toBe(1);

            // Tile at exactly sightRange distance (5 tiles) should be revealed
            // dx=5, dy=0 => 25 <= 25 (sightTilesSq)
            expect(grid[centerTY * gridW + (centerTX + 5)]).toBe(1);

            // Tiles far away should remain unseen
            expect(grid[0]).toBe(0); // top-left corner
        });

        it('does not create fog for AI players', () => {
            // Only player IDs with entries in fogOfWar get processed
            // If we only have player 0's fog grid, player 1 entities won't create a grid
            const unit0 = createTestCombatUnit({
                id: 'u0', owner: 0, key: 'rifle', x: 500, y: 500
            });
            const unit1 = createTestCombatUnit({
                id: 'u1', owner: 1, key: 'rifle', x: 500, y: 500
            });

            const fogGrid = createFogGrid(3000, 3000);
            const state = makeTestState({
                entities: { [unit0.id]: unit0, [unit1.id]: unit1 },
                fogOfWar: { 0: fogGrid } // Only player 0 has fog
            });

            const result = updateFogOfWar(state);

            // Player 0 should have updated fog
            expect(result[0]).toBeDefined();
            // Player 1 should NOT have a fog grid
            expect(result[1]).toBeUndefined();
        });

        it('permanently reveals tiles (never un-fogs)', () => {
            const unit = createTestCombatUnit({
                id: 'u1', owner: 0, key: 'rifle', x: 500, y: 500
            });

            const fogGrid = createFogGrid(3000, 3000);
            const state = makeTestState({
                entities: { [unit.id]: unit },
                fogOfWar: { 0: fogGrid }
            });

            // First update: reveals around (500, 500)
            const result1 = updateFogOfWar(state);

            const centerTX = Math.floor(500 / TILE_SIZE);
            const centerTY = Math.floor(500 / TILE_SIZE);
            const gridW = Math.ceil(3000 / TILE_SIZE);
            expect(result1[0][centerTY * gridW + centerTX]).toBe(1);

            // Move the unit far away and update again
            const movedUnit = {
                ...unit,
                pos: new Vector(2000, 2000)
            } as typeof unit;

            const state2 = makeTestState({
                entities: { [movedUnit.id]: movedUnit },
                fogOfWar: { 0: result1[0] }
            });

            const result2 = updateFogOfWar(state2);

            // Old position should still be revealed
            expect(result2[0][centerTY * gridW + centerTX]).toBe(1);

            // New position should also be revealed
            const newCenterTX = Math.floor(2000 / TILE_SIZE);
            const newCenterTY = Math.floor(2000 / TILE_SIZE);
            expect(result2[0][newCenterTY * gridW + newCenterTX]).toBe(1);
        });

        it('returns same reference if nothing changed', () => {
            // All tiles already revealed around unit
            const unit = createTestCombatUnit({
                id: 'u1', owner: 0, key: 'rifle', x: 500, y: 500
            });

            const fogGrid = createFogGrid(3000, 3000);
            const state = makeTestState({
                entities: { [unit.id]: unit },
                fogOfWar: { 0: fogGrid }
            });

            // First update reveals tiles
            const result1 = updateFogOfWar(state);

            // Second update with same unit position and already-revealed grid
            const state2 = makeTestState({
                entities: { [unit.id]: unit },
                fogOfWar: result1
            });

            const result2 = updateFogOfWar(state2);

            // Should return the exact same object reference since nothing changed
            expect(result2).toBe(result1);
        });

        it('skips fog update when fogOfWar is empty (demo mode)', () => {
            const unit = createTestCombatUnit({
                id: 'u1', owner: 0, key: 'rifle', x: 500, y: 500
            });

            const state = makeTestState({
                entities: { [unit.id]: unit },
                fogOfWar: {} // Demo mode: no fog grids
            });

            const result = updateFogOfWar(state);

            // Should return the same empty object
            expect(result).toBe(state.fogOfWar);
            expect(Object.keys(result).length).toBe(0);
        });

        it('reveals circular area, not square (corner of bounding box should NOT be revealed)', () => {
            // rifle sightRange = 200 => sightTiles = ceil(200/40) = 5
            // sightTilesSq = (200/40)^2 = 25
            // Corner at (5, 5) from center: dx*dx + dy*dy = 50 > 25 => NOT revealed
            const unit = createTestCombatUnit({
                id: 'u1', owner: 0, key: 'rifle', x: 500, y: 500
            });

            const fogGrid = createFogGrid(3000, 3000);
            const state = makeTestState({
                entities: { [unit.id]: unit },
                fogOfWar: { 0: fogGrid }
            });

            const result = updateFogOfWar(state);
            const grid = result[0];

            const centerTX = Math.floor(500 / TILE_SIZE); // 12
            const centerTY = Math.floor(500 / TILE_SIZE); // 12
            const gridW = Math.ceil(3000 / TILE_SIZE); // 75

            // Bounding box corner at (+5, +5) should NOT be revealed
            // distance^2 = 25 + 25 = 50 > 25
            const cornerTX = centerTX + 5;
            const cornerTY = centerTY + 5;
            expect(grid[cornerTY * gridW + cornerTX]).toBe(0);

            // But a tile on the axis at (+5, 0) should be revealed
            // distance^2 = 25 + 0 = 25 <= 25
            expect(grid[centerTY * gridW + (centerTX + 5)]).toBe(1);

            // And a diagonal tile at (+3, +3) should be revealed
            // distance^2 = 9 + 9 = 18 <= 25
            expect(grid[(centerTY + 3) * gridW + (centerTX + 3)]).toBe(1);

            // But a tile at (+4, +4) should NOT be revealed
            // distance^2 = 16 + 16 = 32 > 25
            expect(grid[(centerTY + 4) * gridW + (centerTX + 4)]).toBe(0);
        });

        it('skips dead entities', () => {
            const unit = createTestCombatUnit({
                id: 'u1', owner: 0, key: 'rifle', x: 500, y: 500, dead: true
            });

            const fogGrid = createFogGrid(3000, 3000);
            const state = makeTestState({
                entities: { [unit.id]: unit },
                fogOfWar: { 0: fogGrid }
            });

            const result = updateFogOfWar(state);

            // Should return same reference since dead unit reveals nothing
            expect(result).toBe(state.fogOfWar);
        });

        it('handles buildings with sightRange', () => {
            const building = createTestBuilding({
                id: 'b1', owner: 0, key: 'turret', x: 500, y: 500
            });

            const fogGrid = createFogGrid(3000, 3000);
            const state = makeTestState({
                entities: { [building.id]: building },
                fogOfWar: { 0: fogGrid }
            });

            const result = updateFogOfWar(state);
            const grid = result[0];

            const centerTX = Math.floor(500 / TILE_SIZE);
            const centerTY = Math.floor(500 / TILE_SIZE);
            const gridW = Math.ceil(3000 / TILE_SIZE);

            // Turret has sightRange in rules.json, center tile should be revealed
            expect(grid[centerTY * gridW + centerTX]).toBe(1);
        });

        it('handles multiple players with separate fog grids', () => {
            const unit0 = createTestCombatUnit({
                id: 'u0', owner: 0, key: 'rifle', x: 200, y: 200
            });
            const unit2 = createTestCombatUnit({
                id: 'u2', owner: 2, key: 'rifle', x: 1000, y: 1000
            });

            const fogGrid0 = createFogGrid(3000, 3000);
            const fogGrid2 = createFogGrid(3000, 3000);
            const state = makeTestState({
                entities: { [unit0.id]: unit0, [unit2.id]: unit2 },
                fogOfWar: { 0: fogGrid0, 2: fogGrid2 }
            });

            const result = updateFogOfWar(state);
            const gridW = Math.ceil(3000 / TILE_SIZE);

            // Player 0's unit at (200, 200) => tile (5, 5)
            const p0CenterTX = Math.floor(200 / TILE_SIZE);
            const p0CenterTY = Math.floor(200 / TILE_SIZE);
            expect(result[0][p0CenterTY * gridW + p0CenterTX]).toBe(1);

            // Player 2's unit at (1000, 1000) => tile (25, 25)
            const p2CenterTX = Math.floor(1000 / TILE_SIZE);
            const p2CenterTY = Math.floor(1000 / TILE_SIZE);
            expect(result[2][p2CenterTY * gridW + p2CenterTX]).toBe(1);

            // Player 0 should NOT see player 2's unit area
            expect(result[0][p2CenterTY * gridW + p2CenterTX]).toBe(0);

            // Player 2 should NOT see player 0's unit area
            expect(result[2][p0CenterTY * gridW + p0CenterTX]).toBe(0);
        });
    });
});

describe('Fog of War - Game Loop Integration', () => {
    it('should update fog on each tick', () => {
        const fogGrid = createFogGrid(3000, 3000);
        const unit = createTestCombatUnit({ owner: 0, x: 200, y: 200, key: 'rifle' });
        const state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
            fogOfWar: { 0: fogGrid },
            entities: { [unit.id]: unit },
            players: {
                0: { ...INITIAL_STATE.players[0], isAi: false },
                1: { ...INITIAL_STATE.players[1], isAi: true }
            }
        };

        const nextState = update(state, { type: 'TICK' });

        // Fog should have been updated - tile at unit position should be revealed
        const grid = nextState.fogOfWar[0];
        const tileX = Math.floor(200 / 40); // 5
        const tileY = Math.floor(200 / 40); // 5
        expect(grid[tileY * 75 + tileX]).toBe(1);
    });
});

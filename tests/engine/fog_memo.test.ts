import { describe, it, expect } from 'vitest';
import { INITIAL_STATE } from '../../src/engine/reducer';
import { createFogGrid, updateFogOfWar } from '../../src/engine/reducers/fog';
import { createTestCombatUnit } from '../../src/engine/test-utils';
import { GameState } from '../../src/engine/types';

/**
 * updateFogOfWar remembers, per grid, the tile each entity last revealed from and skips it while it
 * stays put. The memo must never change the result: compare against a reference that has no memo
 * (a brand-new Uint8Array each tick starts with an empty memo).
 */
describe('fog of war reveal memo', () => {
    const config = { width: 1200, height: 1200, resourceDensity: 'medium', rockDensity: 'medium' } as GameState['config'];

    it('matches a memo-less reference over a moving / stationary / off-map sequence', () => {
        const memoGrid = createFogGrid(config.width, config.height);
        let reference = createFogGrid(config.width, config.height);

        for (let step = 0; step < 60; step++) {
            const entities: GameState['entities'] = {};
            // Mover sweeps across the map and briefly leaves it
            const mover = createTestCombatUnit({ id: 'mover', owner: 0, key: 'rifle', x: -80 + step * 25, y: 200 + (step % 7) * 20 });
            // Stationary unit appears at step 10 and keeps its tile
            entities[mover.id] = mover;
            if (step >= 10) {
                const still = createTestCombatUnit({ id: 'still', owner: 0, key: 'rifle', x: 900, y: 900 });
                entities[still.id] = still;
            }
            // Off-map unit that could alias a real tile key
            const ghost = createTestCombatUnit({ id: 'ghost', owner: 0, key: 'rifle', x: -30, y: 5 + step * 3 });
            entities[ghost.id] = ghost;

            const state: GameState = { ...INITIAL_STATE, config, entities, fogOfWar: { 0: memoGrid } };
            updateFogOfWar(state);

            const refCopy = new Uint8Array(reference);
            updateFogOfWar({ ...state, fogOfWar: { 0: refCopy } });
            reference = refCopy;

            expect(Array.from(memoGrid)).toEqual(Array.from(reference));
        }
        expect(memoGrid.some(v => v === 1)).toBe(true);
    });

    it('still reveals when a unit returns to a tile after the grid was replaced', () => {
        const unit = createTestCombatUnit({ id: 'u', owner: 0, key: 'rifle', x: 400, y: 400 });
        const state: GameState = { ...INITIAL_STATE, config, entities: { u: unit }, fogOfWar: { 0: createFogGrid(1200, 1200) } };
        updateFogOfWar(state);
        const fresh = createFogGrid(1200, 1200);
        const next = updateFogOfWar({ ...state, fogOfWar: { 0: fresh } });
        expect(next[0].some(v => v === 1)).toBe(true);
    });
});

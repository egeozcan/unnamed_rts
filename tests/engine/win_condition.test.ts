import { describe, it, expect } from 'vitest';
import { GameState } from '../../src/engine/types.js';
import { update, INITIAL_STATE } from '../../src/engine/reducer.js';
import { createTestBuilding, createTestCombatUnit } from '../../src/engine/test-utils.js';

describe('Win Condition', () => {
    it('should declare a winner when one player has no buildings left', () => {
        const p1Building = createTestBuilding({ id: 'p1_conyard', owner: 0, key: 'conyard' });
        const p2Building = createTestBuilding({ id: 'p2_conyard', owner: 1, key: 'conyard' });

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            entities: {
                'p1_conyard': p1Building,
                'p2_conyard': p2Building
            }
        };

        // Initially no winner
        expect(state.winner).toBeNull();
        expect(state.running).toBe(true);

        // Tick once to ensure logic runs
        state = update(state, { type: 'TICK' });
        expect(state.winner).toBeNull();
        expect(state.running).toBe(true);

        // Destroy player 2's building
        state = {
            ...state,
            entities: {
                ...state.entities,
                'p2_conyard': { ...state.entities['p2_conyard'], hp: 0, dead: true }
            }
        };

        // Tick again
        state = update(state, { type: 'TICK' });

        // Player 1 should win (owner 0)
        expect(state.winner).toBe(0);
        expect(state.running).toBe(false);
    });

    it('should declare a draw when both players lose all buildings in the same tick', () => {
        const p1Building = createTestBuilding({ id: 'p1_conyard', owner: 0, key: 'conyard' });
        const p2Building = createTestBuilding({ id: 'p2_conyard', owner: 1, key: 'conyard' });

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            entities: {
                'p1_conyard': p1Building,
                'p2_conyard': p2Building
            }
        };

        // Destroy both buildings
        state = {
            ...state,
            entities: {
                ...state.entities,
                'p1_conyard': { ...state.entities['p1_conyard'], hp: 0, dead: true },
                'p2_conyard': { ...state.entities['p2_conyard'], hp: 0, dead: true }
            }
        };

        // Tick
        state = update(state, { type: 'TICK' });

        // Should be a draw (-1)
        expect(state.winner).toBe(-1);
        expect(state.running).toBe(false);
    });

    it('should not declare a winner if a player has no buildings but has an MCV', () => {
        const p1Building = createTestBuilding({ id: 'p1_conyard', owner: 0, key: 'conyard' });
        const p2MCV = createTestCombatUnit({ id: 'p2_mcv', owner: 1, key: 'mcv' });

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            entities: {
                'p1_conyard': p1Building,
                'p2_mcv': p2MCV
            }
        };

        // Initially no winner
        expect(state.winner).toBeNull();
        expect(state.running).toBe(true);

        // Tick
        state = update(state, { type: 'TICK' });

        // Still no winner because P2 has an MCV
        expect(state.winner).toBeNull();
        expect(state.running).toBe(true);

        // Destroy P1's conyard
        state = {
            ...state,
            entities: {
                ...state.entities,
                'p1_conyard': { ...state.entities['p1_conyard'], hp: 0, dead: true }
            }
        };

        // Tick
        state = update(state, { type: 'TICK' });

        // Player 2 wins because P1 has nothing left
        expect(state.winner).toBe(1);
        expect(state.running).toBe(false);
    });
});


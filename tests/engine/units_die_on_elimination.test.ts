import { describe, it, expect } from 'vitest';
import { GameState } from '../../src/engine/types.js';
import { update, INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { createTestBuilding, createTestCombatUnit } from '../../src/engine/test-utils.js';

describe('Units Die on Elimination', () => {
    const createBuilding = (id: string, owner: number, key: string = 'conyard') =>
        createTestBuilding({ id, owner, key: key as any, x: owner * 500, y: 100 });

    const createUnit = (id: string, owner: number, key: string = 'light') =>
        createTestCombatUnit({ id, owner, key: key as any, x: owner * 500 + 50, y: 150 });

    const createMCV = (id: string, owner: number) =>
        createTestCombatUnit({ id, owner, key: 'mcv', x: owner * 500 + 50, y: 150 });

    it('should kill all units when a player loses their last building (no MCV)', () => {
        // 3-player game: P0, P1, P2
        // P1 has only units, no buildings or MCVs -> units should die
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            players: {
                0: createPlayerState(0, false),
                1: createPlayerState(1, true),
                2: createPlayerState(2, true)
            },
            entities: {
                'p0_conyard': createBuilding('p0_conyard', 0),
                'p1_tank1': createUnit('p1_tank1', 1),
                'p1_tank2': createUnit('p1_tank2', 1),
                'p1_infantry': createUnit('p1_infantry', 1, 'rifle'),
                'p2_conyard': createBuilding('p2_conyard', 2)
            }
        };

        // P1 has no buildings or MCVs, only units
        // After tick, P1 should be eliminated and their units should die
        state = update(state, { type: 'TICK' });

        // P1's units should be dead
        expect(state.entities['p1_tank1']?.dead).toBe(true);
        expect(state.entities['p1_tank2']?.dead).toBe(true);
        expect(state.entities['p1_infantry']?.dead).toBe(true);

        // Game should still be running (P0 and P2 still alive)
        expect(state.running).toBe(true);
        expect(state.winner).toBeNull();
    });

    it('should not kill units if player still has an MCV', () => {
        // P1 has no buildings but has an MCV -> units should NOT die
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            players: {
                0: createPlayerState(0, false),
                1: createPlayerState(1, true)
            },
            entities: {
                'p0_conyard': createBuilding('p0_conyard', 0),
                'p1_mcv': createMCV('p1_mcv', 1),
                'p1_tank': createUnit('p1_tank', 1)
            }
        };

        state = update(state, { type: 'TICK' });

        // P1's units should still be alive (they have an MCV)
        expect(state.entities['p1_mcv']?.dead).toBe(false);
        expect(state.entities['p1_tank']?.dead).toBe(false);
        expect(state.running).toBe(true);
    });

    it('should not kill units if player still has buildings', () => {
        // P1 has a building -> units should NOT die
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            players: {
                0: createPlayerState(0, false),
                1: createPlayerState(1, true)
            },
            entities: {
                'p0_conyard': createBuilding('p0_conyard', 0),
                'p1_conyard': createBuilding('p1_conyard', 1),
                'p1_tank': createUnit('p1_tank', 1)
            }
        };

        state = update(state, { type: 'TICK' });

        // P1's units should still be alive
        expect(state.entities['p1_tank']?.dead).toBe(false);
        expect(state.running).toBe(true);
    });

    it('should kill units when last building is destroyed mid-game', () => {
        // P1 starts with a building and units
        // Building gets destroyed -> units should die
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            players: {
                0: createPlayerState(0, false),
                1: createPlayerState(1, true),
                2: createPlayerState(2, true)
            },
            entities: {
                'p0_conyard': createBuilding('p0_conyard', 0),
                'p1_conyard': createBuilding('p1_conyard', 1),
                'p1_tank': createUnit('p1_tank', 1),
                'p2_conyard': createBuilding('p2_conyard', 2)
            }
        };

        // Initially all alive
        state = update(state, { type: 'TICK' });
        expect(state.entities['p1_tank']?.dead).toBe(false);

        // Destroy P1's building
        state = {
            ...state,
            entities: {
                ...state.entities,
                'p1_conyard': { ...state.entities['p1_conyard'], hp: 0, dead: true }
            }
        };

        // After tick, P1's units should die
        state = update(state, { type: 'TICK' });
        expect(state.entities['p1_tank']?.dead).toBe(true);

        // Game still running (P0 and P2 alive)
        expect(state.running).toBe(true);
        expect(state.winner).toBeNull();
    });

    it('should kill units when last MCV is destroyed', () => {
        // P1 has only an MCV and units
        // MCV gets destroyed -> units should die
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            players: {
                0: createPlayerState(0, false),
                1: createPlayerState(1, true),
                2: createPlayerState(2, true)
            },
            entities: {
                'p0_conyard': createBuilding('p0_conyard', 0),
                'p1_mcv': createMCV('p1_mcv', 1),
                'p1_tank': createUnit('p1_tank', 1),
                'p2_conyard': createBuilding('p2_conyard', 2)
            }
        };

        // Initially alive
        state = update(state, { type: 'TICK' });
        expect(state.entities['p1_tank']?.dead).toBe(false);

        // Destroy P1's MCV
        state = {
            ...state,
            entities: {
                ...state.entities,
                'p1_mcv': { ...state.entities['p1_mcv'], hp: 0, dead: true }
            }
        };

        // After tick, P1's units should die
        state = update(state, { type: 'TICK' });
        expect(state.entities['p1_tank']?.dead).toBe(true);

        // Game still running
        expect(state.running).toBe(true);
    });
});

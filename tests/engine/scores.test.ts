import { describe, it, expect, beforeEach } from 'vitest';
import { calculatePlayerScores, clearScoreCache } from '../../src/engine/scores';
import { GameState } from '../../src/engine/types';
import {
    createTestBuilding,
    createTestCombatUnit,
    createTestHarvester,
    addEntitiesToState
} from '../../src/engine/test-utils';
import { INITIAL_STATE } from '../../src/engine/reducer';

// Helper to get fresh state
const getInitialState = (): GameState => JSON.parse(JSON.stringify(INITIAL_STATE));

describe('Player Scores', () => {
    beforeEach(() => {
        clearScoreCache();
    });

    it('should return empty array for state with no players', () => {
        const state = { ...getInitialState(), players: {} };
        const scores = calculatePlayerScores(state);
        expect(scores).toEqual([]);
    });

    it('should include player credits in economy score', () => {
        const state = getInitialState();
        // Player 0 has 3000 credits by default
        const scores = calculatePlayerScores(state);
        const player0 = scores.find(s => s.playerId === 0);

        expect(player0).toBeDefined();
        expect(player0!.economy).toBeGreaterThanOrEqual(3000);
    });

    it('should calculate military score from combat units', () => {
        let state = getInitialState();
        // Add a light tank (cost: 800)
        const tank = createTestCombatUnit({ id: 'tank1', owner: 0, key: 'light', x: 500, y: 500 });
        state = addEntitiesToState(state, [tank]);

        clearScoreCache();
        const scores = calculatePlayerScores(state);
        const player0 = scores.find(s => s.playerId === 0);

        expect(player0).toBeDefined();
        expect(player0!.military).toBe(800); // Full HP = full cost
    });

    it('should apply HP ratio to damaged entities', () => {
        let state = getInitialState();
        // Add a light tank at 50% HP (cost: 800, should contribute 400)
        const tank = createTestCombatUnit({ id: 'tank1', owner: 0, key: 'light', x: 500, y: 500 });
        state = addEntitiesToState(state, [tank]);
        // Damage the tank to 50%
        state = {
            ...state,
            entities: {
                ...state.entities,
                'tank1': { ...state.entities['tank1'], hp: 200, maxHp: 400 }
            }
        };

        clearScoreCache();
        const scores = calculatePlayerScores(state);
        const player0 = scores.find(s => s.playerId === 0);

        expect(player0).toBeDefined();
        expect(player0!.military).toBe(400); // 50% HP = 50% value
    });

    it('should calculate economy score from buildings', () => {
        let state = getInitialState();
        // Reset credits to isolate building contribution
        state = {
            ...state,
            players: {
                ...state.players,
                0: { ...state.players[0], credits: 0 }
            }
        };

        // Add a power plant (cost: 300)
        const power = createTestBuilding({ id: 'power1', owner: 0, key: 'power', x: 500, y: 500 });
        state = addEntitiesToState(state, [power]);

        clearScoreCache();
        const scores = calculatePlayerScores(state);
        const player0 = scores.find(s => s.playerId === 0);

        expect(player0).toBeDefined();
        expect(player0!.economy).toBe(300);
    });

    it('should add harvester cargo to economy score', () => {
        let state = getInitialState();
        // Reset credits
        state = {
            ...state,
            players: {
                ...state.players,
                0: { ...state.players[0], credits: 0 }
            }
        };

        // Add a harvester with cargo (cost: 1400, cargo: 300)
        const harvester = createTestHarvester({ id: 'harv1', owner: 0, x: 500, y: 500 });
        state = addEntitiesToState(state, [harvester]);
        // Add cargo
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv1': {
                    ...state.entities['harv1'],
                    harvester: { ...(state.entities['harv1'] as any).harvester, cargo: 300 }
                }
            }
        };

        clearScoreCache();
        const scores = calculatePlayerScores(state);
        const player0 = scores.find(s => s.playerId === 0);

        expect(player0).toBeDefined();
        // 1400 (harvester cost) + 300 (cargo) = 1700
        expect(player0!.economy).toBe(1700);
    });

    it('should calculate military score from defensive buildings', () => {
        let state = getInitialState();
        // Add a turret (cost: 800)
        const turret = createTestBuilding({ id: 'turret1', owner: 0, key: 'turret', x: 500, y: 500 });
        state = addEntitiesToState(state, [turret]);

        clearScoreCache();
        const scores = calculatePlayerScores(state);
        const player0 = scores.find(s => s.playerId === 0);

        expect(player0).toBeDefined();
        expect(player0!.military).toBe(800);
    });

    it('should calculate total score as sum of military and economy', () => {
        let state = getInitialState();
        // Start with 1000 credits
        state = {
            ...state,
            players: {
                ...state.players,
                0: { ...state.players[0], credits: 1000 }
            }
        };

        // Add a light tank (800) and power plant (300)
        const tank = createTestCombatUnit({ id: 'tank1', owner: 0, key: 'light', x: 500, y: 500 });
        const power = createTestBuilding({ id: 'power1', owner: 0, key: 'power', x: 600, y: 500 });
        state = addEntitiesToState(state, [tank, power]);

        clearScoreCache();
        const scores = calculatePlayerScores(state);
        const player0 = scores.find(s => s.playerId === 0);

        expect(player0).toBeDefined();
        expect(player0!.military).toBe(800);
        expect(player0!.economy).toBe(1300); // 1000 credits + 300 power plant
        expect(player0!.total).toBe(2100);
    });

    it('should cache scores per tick', () => {
        let state = getInitialState();
        const tank = createTestCombatUnit({ id: 'tank1', owner: 0, key: 'light', x: 500, y: 500 });
        state = addEntitiesToState(state, [tank]);

        // First call
        const scores1 = calculatePlayerScores(state);

        // Modify state without changing tick (simulating same frame)
        state = {
            ...state,
            entities: {
                ...state.entities,
                'tank2': createTestCombatUnit({ id: 'tank2', owner: 0, key: 'heavy', x: 600, y: 500 })
            }
        };

        // Second call should return cached result
        const scores2 = calculatePlayerScores(state);
        expect(scores2).toBe(scores1); // Same reference = cached

        // Change tick
        state = { ...state, tick: state.tick + 1 };
        const scores3 = calculatePlayerScores(state);
        expect(scores3).not.toBe(scores1); // Different reference = recalculated
    });

    it('should sort players by total score descending', () => {
        let state = getInitialState();
        // Give player 1 more assets
        const tank0 = createTestCombatUnit({ id: 'tank0', owner: 0, key: 'light', x: 500, y: 500 });
        const tank1 = createTestCombatUnit({ id: 'tank1', owner: 1, key: 'mammoth', x: 800, y: 500 });
        state = addEntitiesToState(state, [tank0, tank1]);

        clearScoreCache();
        const scores = calculatePlayerScores(state);

        // Player 1 should be first (mammoth costs 2500 vs light tank 800)
        expect(scores[0].playerId).toBe(1);
        expect(scores[1].playerId).toBe(0);
    });

    it('should not count dead entities', () => {
        let state = getInitialState();
        const tank = createTestCombatUnit({ id: 'tank1', owner: 0, key: 'light', x: 500, y: 500 });
        state = addEntitiesToState(state, [tank]);
        // Mark as dead
        state = {
            ...state,
            entities: {
                ...state.entities,
                'tank1': { ...state.entities['tank1'], dead: true }
            }
        };

        clearScoreCache();
        const scores = calculatePlayerScores(state);
        const player0 = scores.find(s => s.playerId === 0);

        expect(player0).toBeDefined();
        expect(player0!.military).toBe(0);
    });
});

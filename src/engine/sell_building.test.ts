import { describe, it, expect } from 'vitest';
import { update, INITIAL_STATE } from './reducer';
import { GameState, Vector, Entity } from './types.js';
import { _testUtils as aiTestUtils, resetAIState } from './ai';

const getInitialState = (): GameState => JSON.parse(JSON.stringify(INITIAL_STATE));

describe('Building Selling', () => {
    it('should sell undamaged building for 50% refund', () => {
        let state = getInitialState();
        const building = {
            id: 'b1', owner: 0, type: 'BUILDING', key: 'power',
            pos: new Vector(100, 100), hp: 800, maxHp: 800, radius: 30, dead: false
        } as Entity;
        state.entities['b1'] = building;
        state.players[0] = { ...state.players[0], credits: 1000 };

        const action = { type: 'SELL_BUILDING', payload: { buildingId: 'b1', playerId: 0 } } as any;
        const nextState = update(state, action);

        expect(nextState.entities['b1']).toBeUndefined();
        // Power plant cost is 300, 50% refund is 150. 1000 + 150 = 1150
        expect(nextState.players[0].credits).toBe(1150);
    });

    it('should sell damaged building for proportional refund', () => {
        let state = getInitialState();
        const building = {
            id: 'b1', owner: 0, type: 'BUILDING', key: 'power',
            pos: new Vector(100, 100), hp: 400, maxHp: 800, radius: 30, dead: false
        } as Entity;
        state.entities['b1'] = building;
        state.players[0] = { ...state.players[0], credits: 1000 };

        const action = { type: 'SELL_BUILDING', payload: { buildingId: 'b1', playerId: 0 } } as any;
        const nextState = update(state, action);

        // Power plant cost is 300, 50% base is 150. 50% damaged means 50% of 150 = 75. 1000 + 75 = 1075.
        expect(nextState.players[0].credits).toBe(1075);
    });

    it('should remove sold building from selection', () => {
        let state = getInitialState();
        state.entities['b1'] = { id: 'b1', owner: 0, type: 'BUILDING', key: 'power', pos: new Vector(0, 0), hp: 800, maxHp: 800, dead: false } as Entity;
        state = { ...state, selection: ['b1'] };

        const action = { type: 'SELL_BUILDING', payload: { buildingId: 'b1', playerId: 0 } } as any;
        const nextState = update(state, action);

        expect(nextState.selection).not.toContain('b1');
    });

    it('should not sell building owned by another player', () => {
        let state = getInitialState();
        state.entities['b1'] = { id: 'b1', owner: 1, type: 'BUILDING', key: 'power', pos: new Vector(0, 0), hp: 800, maxHp: 800, dead: false } as Entity;
        const initialCredits = state.players[0].credits;

        const action = { type: 'SELL_BUILDING', payload: { buildingId: 'b1', playerId: 0 } } as any;
        const nextState = update(state, action);

        expect(nextState.entities['b1']).toBeDefined();
        expect(nextState.players[0].credits).toBe(initialCredits);
    });

    it('should toggle sell mode', () => {
        let state = getInitialState();
        expect(state.sellMode).toBe(false);

        state = update(state, { type: 'TOGGLE_SELL_MODE' } as any);
        expect(state.sellMode).toBe(true);

        state = update(state, { type: 'TOGGLE_SELL_MODE' } as any);
        expect(state.sellMode).toBe(false);
    });
});

describe('AI Emergency Selling', () => {
    it('should sell building when low on credits and under attack', () => {
        resetAIState(1);
        const state = getInitialState();
        const building = {
            id: 'b_ai', owner: 1, type: 'BUILDING', key: 'power',
            pos: new Vector(2000, 2000), hp: 400, maxHp: 800, dead: false, radius: 30
        } as Entity;

        const aiPlayer = { ...state.players[1], credits: 10 };
        const aiState = aiTestUtils.getAIState(1);
        aiState.threatsNearBase = ['enemy_unit'];

        const actions = aiTestUtils.handleEmergencySell(state, 1, [building], aiPlayer, aiState);

        expect(actions.length).toBe(1);
        expect(actions[0].type).toBe('SELL_BUILDING');
        expect(actions[0].payload.buildingId).toBe('b_ai');
    });

    it('should NOT sell buildings when credits are healthy', () => {
        resetAIState(1);
        const state = getInitialState();
        const building = { id: 'b_ai', owner: 1, type: 'BUILDING', key: 'power', hp: 800, maxHp: 800, dead: false } as Entity;
        const aiPlayer = { ...state.players[1], credits: 1000 };
        const aiState = aiTestUtils.getAIState(1);

        const actions = aiTestUtils.handleEmergencySell(state, 1, [building], aiPlayer, aiState);
        expect(actions.length).toBe(0);
    });
});

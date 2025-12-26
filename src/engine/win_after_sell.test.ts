
import { describe, it, expect } from 'vitest';
import { update, INITIAL_STATE } from './reducer';
import { GameState, Entity, Vector } from './types.js';

const getInitialState = (): GameState => JSON.parse(JSON.stringify(INITIAL_STATE));

describe('Win Condition - Sell Building', () => {
    it('should trigger loss when last building is sold', () => {
        let state = getInitialState();
        state = { ...state, mode: 'game', running: true }; // Ensure game mode for win check

        // Player 0 has 1 building and no MCV
        const building = {
            id: 'b1', owner: 0, type: 'BUILDING', key: 'power',
            pos: new Vector(100, 100), hp: 800, maxHp: 800, radius: 30, dead: false,
            vel: new Vector(0, 0), rotation: 0, cooldown: 0, flash: 0
        } as Entity;

        // Player 1 has existing buildings
        const enemyBuilding = {
            id: 'e1', owner: 1, type: 'BUILDING', key: 'power',
            pos: new Vector(2000, 2000), hp: 800, maxHp: 800, radius: 30, dead: false,
            vel: new Vector(0, 0), rotation: 0, cooldown: 0, flash: 0
        } as Entity;

        state = {
            ...state,
            entities: { 'b1': building, 'e1': enemyBuilding }
        };

        // Verify initial state
        let tickState = update(state, { type: 'TICK' });
        expect(tickState.winner).toBeNull();
        expect(tickState.running).toBe(true);

        // Sell the last building
        const action = { type: 'SELL_BUILDING', payload: { buildingId: 'b1', playerId: 0 } } as any;
        let nextState = update(tickState, action);

        // Verify win condition immediately after sell
        expect(nextState.running).toBe(false);
        expect(nextState.winner).toBe(1); // Player 1 should win
    });
});

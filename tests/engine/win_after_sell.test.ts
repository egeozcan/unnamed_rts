import { describe, it, expect } from 'vitest';
import { update, INITIAL_STATE } from '../../src/engine/reducer';
import { GameState, Vector, Action } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit } from '../../src/engine/test-utils.js';

const getInitialState = (): GameState => JSON.parse(JSON.stringify(INITIAL_STATE));

describe('Win Condition - Sell Building', () => {
    it('should trigger loss when last building is sold', () => {
        let state = getInitialState();
        state = { ...state, mode: 'game', running: true };

        // Player 0 has 1 building and no MCV
        const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100 });

        // Player 1 has existing buildings
        const enemyBuilding = createTestBuilding({ id: 'e1', owner: 1, key: 'power', x: 2000, y: 2000 });

        state = {
            ...state,
            entities: { 'b1': building, 'e1': enemyBuilding }
        };

        // Verify initial state
        let tickState = update(state, { type: 'TICK' });
        expect(tickState.winner).toBeNull();
        expect(tickState.running).toBe(true);

        // Sell the last building
        const action: Action = { type: 'SELL_BUILDING', payload: { buildingId: 'b1', playerId: 0 } };
        let nextState = update(tickState, action);

        // Verify win condition immediately after sell
        expect(nextState.running).toBe(false);
        expect(nextState.winner).toBe(1); // Player 1 should win

        // Verify that Player 0's units are destroyed
        // Add a unit for Player 0 to simulate this
        const unit = createTestCombatUnit({ id: 'u1', owner: 0, key: 'rifle', x: 150, y: 150 });

        // Re-run the update with the unit present
        state = {
            ...state,
            entities: { 'b1': building, 'e1': enemyBuilding, 'u1': unit }
        };
        tickState = update(state, { type: 'TICK' });

        const actionWithUnit: Action = { type: 'SELL_BUILDING', payload: { buildingId: 'b1', playerId: 0 } };
        nextState = update(tickState, actionWithUnit);

        const deadUnit = nextState.entities['u1'];
        expect(deadUnit.dead).toBe(true);
        expect(deadUnit.hp).toBe(0);
    });

    it('should trigger loss and cleanup when last building is destroyed', () => {
        let state = getInitialState();
        state = { ...state, mode: 'game', running: true };

        // Player 0 has 1 building (Power Plant) with low HP
        const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100, hp: 10 });

        // Player 0 has a unit
        const unit = createTestCombatUnit({ id: 'u1', owner: 0, key: 'rifle', x: 150, y: 150 });

        // Player 1 has a building (to win)
        const enemyBuilding = createTestBuilding({ id: 'e1', owner: 1, key: 'power', x: 2000, y: 2000 });

        // Player 1 has a projectile hitting Player 0's building
        const projectile = {
            ownerId: 'e_unit', pos: new Vector(100, 100), vel: new Vector(0, 0),
            targetId: 'b1', speed: 100, damage: 100, splash: 0, type: 'bullet', dead: false
        };

        state = {
            ...state,
            entities: { 'b1': building, 'e1': enemyBuilding, 'u1': unit },
            projectiles: [projectile]
        };

        // Tick should process projectile -> destroy building -> trigger win condition -> cleanup units
        const nextState = update(state, { type: 'TICK' });

        expect(nextState.running).toBe(false);
        expect(nextState.winner).toBe(1);

        const deadUnit = nextState.entities['u1'];
        expect(deadUnit.dead).toBe(true);
        expect(deadUnit.hp).toBe(0);
    });
});

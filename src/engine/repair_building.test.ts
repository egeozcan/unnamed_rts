import { describe, it, expect, beforeEach } from 'vitest';
import { update, INITIAL_STATE } from './reducer';
import { GameState, BuildingEntity } from './types.js';
import { createTestBuilding } from './test-utils.js';

const getInitialState = (): GameState => JSON.parse(JSON.stringify(INITIAL_STATE));

describe('Building Repair', () => {
    let state: GameState;

    beforeEach(() => {
        state = {
            ...getInitialState(),
            running: true,
            players: {
                ...getInitialState().players,
                0: { ...getInitialState().players[0], credits: 1000 }
            }
        };
    });

    describe('Repair Mode Toggle', () => {
        it('should toggle repair mode on and off', () => {
            expect(state.repairMode).toBe(false);

            state = update(state, { type: 'TOGGLE_REPAIR_MODE' });
            expect(state.repairMode).toBe(true);

            state = update(state, { type: 'TOGGLE_REPAIR_MODE' });
            expect(state.repairMode).toBe(false);
        });

        it('should deactivate sell mode when repair mode is activated', () => {
            state = update(state, { type: 'TOGGLE_SELL_MODE' });
            expect(state.sellMode).toBe(true);
            expect(state.repairMode).toBe(false);

            state = update(state, { type: 'TOGGLE_REPAIR_MODE' });
            expect(state.sellMode).toBe(false);
            expect(state.repairMode).toBe(true);
        });

        it('should deactivate repair mode when sell mode is activated', () => {
            state = update(state, { type: 'TOGGLE_REPAIR_MODE' });
            expect(state.repairMode).toBe(true);

            state = update(state, { type: 'TOGGLE_SELL_MODE' });
            expect(state.repairMode).toBe(false);
            expect(state.sellMode).toBe(true);
        });
    });

    describe('Start Repair', () => {
        it('should start repair on damaged building', () => {
            const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100, hp: 400 });
            state = { ...state, entities: { 'b1': building } };

            state = update(state, { type: 'START_REPAIR', payload: { buildingId: 'b1', playerId: 0 } });

            expect((state.entities['b1'] as BuildingEntity).building.isRepairing).toBe(true);
        });

        it('should not start repair on full health building', () => {
            const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100 });
            state = { ...state, entities: { 'b1': building } };

            state = update(state, { type: 'START_REPAIR', payload: { buildingId: 'b1', playerId: 0 } });

            expect((state.entities['b1'] as BuildingEntity).building.isRepairing).toBeFalsy();
        });

        it('should not start repair on enemy building', () => {
            const building = createTestBuilding({ id: 'b1', owner: 1, key: 'power', x: 100, y: 100, hp: 400 });
            state = { ...state, entities: { 'b1': building } };

            state = update(state, { type: 'START_REPAIR', payload: { buildingId: 'b1', playerId: 0 } });

            expect((state.entities['b1'] as BuildingEntity).building.isRepairing).toBeFalsy();
        });

        it('should not start repair with zero credits', () => {
            state.players[0] = { ...state.players[0], credits: 0 };
            const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100, hp: 400 });
            state = { ...state, entities: { 'b1': building } };

            state = update(state, { type: 'START_REPAIR', payload: { buildingId: 'b1', playerId: 0 } });

            expect((state.entities['b1'] as BuildingEntity).building.isRepairing).toBeFalsy();
        });
    });

    describe('Stop Repair', () => {
        it('should stop repair on building', () => {
            const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100, hp: 400, isRepairing: true });
            state = { ...state, entities: { 'b1': building } };

            state = update(state, { type: 'STOP_REPAIR', payload: { buildingId: 'b1', playerId: 0 } });

            expect((state.entities['b1'] as BuildingEntity).building.isRepairing).toBe(false);
        });

        it('should toggle repair off when START_REPAIR on already repairing building', () => {
            const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100, hp: 400, isRepairing: true });
            state = { ...state, entities: { 'b1': building } };

            state = update(state, { type: 'START_REPAIR', payload: { buildingId: 'b1', playerId: 0 } });

            expect((state.entities['b1'] as BuildingEntity).building.isRepairing).toBe(false);
        });
    });

    describe('Repair Tick Processing', () => {
        it('should heal building and deduct credits on tick', () => {
            const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100, hp: 400, isRepairing: true });
            state = { ...state, entities: { 'b1': building } };
            const initialCredits = state.players[0].credits;
            const initialHp = building.hp;

            state = update(state, { type: 'TICK' });

            expect(state.entities['b1'].hp).toBeGreaterThan(initialHp);
            expect(state.players[0].credits).toBeLessThan(initialCredits);
        });

        it('should auto-stop repair when building reaches full HP', () => {
            const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100, hp: 799, isRepairing: true });
            state = { ...state, entities: { 'b1': building } };

            // Tick once should be enough to max it out
            state = update(state, { type: 'TICK' });

            expect(state.entities['b1'].hp).toBe(800);
            expect((state.entities['b1'] as BuildingEntity).building.isRepairing).toBe(false);
        });

        it('should auto-stop repair when credits run out', () => {
            state.players[0] = { ...state.players[0], credits: 0.01 }; // Very low credits
            const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100, hp: 400, isRepairing: true });
            state = { ...state, entities: { 'b1': building } };
            const initialHp = building.hp;

            state = update(state, { type: 'TICK' });

            // Should have stopped repairing due to no credits
            expect((state.entities['b1'] as BuildingEntity).building.isRepairing).toBe(false);
            expect(state.entities['b1'].hp).toBe(initialHp); // HP unchanged
        });

        it('should repair at 30% of building cost', () => {
            // Power plant costs 300, so full repair cost is 90 (30%)
            const building = createTestBuilding({ id: 'b1', owner: 0, key: 'power', x: 100, y: 100, hp: 0, isRepairing: true });
            state.players[0] = { ...state.players[0], credits: 1000 };
            state = { ...state, entities: { 'b1': building } };

            // Run 600 ticks (full repair duration)
            for (let i = 0; i < 600; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Building should be fully repaired
            expect(state.entities['b1'].hp).toBe(800);

            // Should have spent approximately 90 credits (30% of 300)
            // Allow some tolerance for floating point
            expect(state.players[0].credits).toBeCloseTo(1000 - 90, 0);
        });
    });
});

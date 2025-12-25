import { describe, it, expect } from 'vitest';
import { update, INITIAL_STATE } from './reducer';
import { GameState } from './types';

// Helper to get fresh state to avoid shared mutation across tests
const getInitialState = (): GameState => JSON.parse(JSON.stringify(INITIAL_STATE));

describe('Reducer', () => {
    it('should handle START_BUILD', () => {
        const action = { type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId: 0 } } as any;
        const state = update(getInitialState(), action);
        expect(state.players[0].queues.building.current).toBe('power');
        // Initial state credit check. Since we use getInitialState(), credits are consistently reset.
        expect(state.players[0].credits).toBe(getInitialState().players[0].credits);
    });

    it('should increment progress on TICK', () => {
        let state = { ...getInitialState(), running: true };
        state = update(state, { type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId: 0 } } as any);

        const nextState = update(state, { type: 'TICK' } as any);

        expect(nextState.tick).toBe(1);
        expect(nextState.players[0].queues.building.progress).toBeGreaterThan(0);
        expect(nextState.players[0].credits).toBeLessThan(getInitialState().players[0].credits);
    });

    it('should complete building production', () => {
        let state = { ...getInitialState(), running: true };
        const p0 = state.players[0] as any; // Cast to allow writing to readonly
        // Directly set progress to near completion
        p0.queues.building = { current: 'power', progress: 99.9 };

        const nextState = update(state, { type: 'TICK' } as any);

        expect(nextState.players[0].queues.building.current).toBeNull();
        expect(nextState.players[0].readyToPlace).toBe('power');
    });

    it('should PLACE_BUILDING and create entity', () => {
        let state = { ...getInitialState(), running: true };
        const p0 = state.players[0] as any;
        p0.readyToPlace = 'power';
        state.placingBuilding = 'power';

        const action = { type: 'PLACE_BUILDING', payload: { key: 'power', x: 100, y: 100, playerId: 0 } } as any;
        const nextState = update(state, action);

        expect(nextState.players[0].readyToPlace).toBeNull();
        expect(nextState.placingBuilding).toBeNull();

        const entities = Object.values(nextState.entities);
        expect(entities.length).toBe(1);
        expect(entities[0].key).toBe('power');
        expect(entities[0].pos.x).toBe(100);
    });

    it('should CANCEL_BUILD and refund', () => {
        let state = { ...getInitialState(), running: true };
        const p0 = state.players[0] as any;
        p0.queues.building = { current: 'power', progress: 50 };
        const initialCredits = state.players[0].credits;

        const action = { type: 'CANCEL_BUILD', payload: { category: 'building', playerId: 0 } } as any;
        const nextState = update(state, action);

        expect(nextState.players[0].queues.building.current).toBeNull();
        expect(nextState.players[0].credits).toBeGreaterThan(initialCredits);
    });
});

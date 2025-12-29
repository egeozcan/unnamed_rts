import { describe, it, expect } from 'vitest';
import { update, INITIAL_STATE } from './reducer';
import { GameState, Vector } from './types';

// Helper to get fresh state to avoid shared mutation across tests
const getInitialState = (): GameState => JSON.parse(JSON.stringify(INITIAL_STATE));

// Helper to create a minimal valid entity for testing
function createTestEntity(id: string, owner: number, type: 'BUILDING' | 'UNIT', key: string, x: number = 500, y: number = 500) {
    return {
        id,
        owner,
        type,
        key,
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp: 3000,
        maxHp: 3000,
        w: 90,
        h: 90,
        radius: 45,
        dead: false,
        vel: new Vector(0, 0),
        rotation: 0,
        moveTarget: null,
        path: null,
        pathIdx: 0,
        finalDest: null,
        stuckTimer: 0,
        unstuckDir: null,
        unstuckTimer: 0,
        targetId: null,
        lastAttackerId: null,
        cooldown: 0,
        flash: 0,
        turretAngle: 0,
        cargo: 0,
        resourceTargetId: null,
        baseTargetId: null
    };
}

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
        // Add a conyard for player 0 so production can work (eliminated players can't produce)
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        state = {
            ...state,
            entities: {
                ...state.entities,
                [conyard.id]: conyard as any
            }
        };
        state = update(state, { type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId: 0 } } as any);

        const nextState = update(state, { type: 'TICK' } as any);

        expect(nextState.tick).toBe(1);
        expect(nextState.players[0].queues.building.progress).toBeGreaterThan(0);
        expect(nextState.players[0].credits).toBeLessThan(getInitialState().players[0].credits);
    });

    it('should complete building production', () => {
        let state = { ...getInitialState(), running: true };
        // Add a conyard for player 0 so production can work (eliminated players can't produce)
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        state = {
            ...state,
            entities: {
                ...state.entities,
                [conyard.id]: conyard as any
            }
        };
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

    it('should cancel all production for eliminated players (no buildings, no MCVs)', () => {
        let state = { ...getInitialState(), running: true };

        // Player 0 has no buildings and no MCVs (eliminated)
        // But has production in queues (this shouldn't happen normally, but edge case)
        const p0 = state.players[0] as any;
        p0.queues.building = { current: 'barracks', progress: 50 };
        p0.queues.vehicle = { current: 'light', progress: 75 };
        p0.queues.infantry = { current: 'rifle', progress: 25 };
        p0.readyToPlace = 'power';

        // Tick should cancel all production for eliminated player
        const nextState = update(state, { type: 'TICK' } as any);

        // All queues should be cleared
        expect(nextState.players[0].queues.building.current).toBeNull();
        expect(nextState.players[0].queues.building.progress).toBe(0);
        expect(nextState.players[0].queues.vehicle.current).toBeNull();
        expect(nextState.players[0].queues.vehicle.progress).toBe(0);
        expect(nextState.players[0].queues.infantry.current).toBeNull();
        expect(nextState.players[0].queues.infantry.progress).toBe(0);
        expect(nextState.players[0].readyToPlace).toBeNull();
    });
});

import { describe, it, expect } from 'vitest';
import { update, INITIAL_STATE } from '../../src/engine/reducer';
import { GameState, BuildingKey, Entity } from '../../src/engine/types';
import { createTestBuilding, createTestCombatUnit, addEntityToState, addEntitiesToState } from '../../src/engine/test-utils';

// Helper to get fresh state to avoid shared mutation across tests
const getInitialState = (): GameState => JSON.parse(JSON.stringify(INITIAL_STATE));

// Wrapper function for backwards compatibility with existing tests
function createTestEntity(id: string, owner: number, type: 'BUILDING' | 'UNIT', key: string, x: number = 500, y: number = 500): Entity {
    if (type === 'BUILDING') {
        return createTestBuilding({ id, owner, key: key as BuildingKey, x, y });
    } else {
        return createTestCombatUnit({ id, owner, key: key as Exclude<import('../../src/engine/types').UnitKey, 'harvester'>, x, y });
    }
}

describe('Reducer', () => {
    it('should handle START_BUILD', () => {
        // Need a conyard to build buildings (prerequisite check)
        let state = getInitialState();
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        state = addEntityToState(state, conyard);

        const action = { type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId: 0 } } as const;
        state = update(state, action);
        expect(state.players[0].queues.building.current).toBe('power');
        // Initial state credit check. Since we use getInitialState(), credits are consistently reset.
        expect(state.players[0].credits).toBe(getInitialState().players[0].credits);
    });

    it('should increment progress on TICK', () => {
        let state = { ...getInitialState(), running: true };
        // Add a conyard for player 0 so production can work (eliminated players can't produce)
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        state = addEntityToState(state, conyard);
        state = update(state, { type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId: 0 } } as const);

        const nextState = update(state, { type: 'TICK' });

        expect(nextState.tick).toBe(1);
        expect(nextState.players[0].queues.building.progress).toBeGreaterThan(0);
        expect(nextState.players[0].credits).toBeLessThan(getInitialState().players[0].credits);
    });

    it('should complete building production', () => {
        let state = { ...getInitialState(), running: true };
        // Add a conyard for player 0 so production can work (eliminated players can't produce)
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        state = addEntityToState(state, conyard);
        // Directly set progress to near completion - requires mutable state for tests
        state = {
            ...state,
            players: {
                ...state.players,
                0: {
                    ...state.players[0],
                    queues: {
                        ...state.players[0].queues,
                        building: { current: 'power', progress: 99.9, invested: 300, queued: [] }
                    }
                }
            }
        };

        const nextState = update(state, { type: 'TICK' });

        expect(nextState.players[0].queues.building.current).toBeNull();
        expect(nextState.players[0].readyToPlace).toBe('power');
    });

    it('should PLACE_BUILDING and create entity', () => {
        let state = {
            ...getInitialState(),
            running: true,
            placingBuilding: 'power',
            players: {
                ...getInitialState().players,
                0: { ...getInitialState().players[0], readyToPlace: 'power' }
            }
        };

        const action = { type: 'PLACE_BUILDING', payload: { key: 'power', x: 100, y: 100, playerId: 0 } } as const;
        const nextState = update(state, action);

        expect(nextState.players[0].readyToPlace).toBeNull();
        expect(nextState.placingBuilding).toBeNull();

        const entities = Object.values(nextState.entities);
        expect(entities.length).toBe(1);
        expect(entities[0].key).toBe('power');
        expect(entities[0].pos.x).toBe(100);
    });

    it('should CANCEL_BUILD and refund', () => {
        const baseState = getInitialState();
        let state = {
            ...baseState,
            running: true,
            players: {
                ...baseState.players,
                0: {
                    ...baseState.players[0],
                    queues: {
                        ...baseState.players[0].queues,
                        building: { current: 'power', progress: 50, invested: 150, queued: [] }
                    }
                }
            }
        };
        const initialCredits = state.players[0].credits;

        const action = { type: 'CANCEL_BUILD', payload: { category: 'building', playerId: 0 } } as const;
        const nextState = update(state, action);

        expect(nextState.players[0].queues.building.current).toBeNull();
        expect(nextState.players[0].credits).toBeGreaterThan(initialCredits);
    });

    it('should cancel all production for eliminated players (no buildings, no MCVs)', () => {
        const baseState = getInitialState();
        // Player 0 has no buildings and no MCVs (eliminated)
        // But has production in queues (this shouldn't happen normally, but edge case)
        let state = {
            ...baseState,
            running: true,
            players: {
                ...baseState.players,
                0: {
                    ...baseState.players[0],
                    readyToPlace: 'power',
                    queues: {
                        building: { current: 'barracks', progress: 50, invested: 250, queued: [] },
                        vehicle: { current: 'light', progress: 75, invested: 600, queued: [] },
                        infantry: { current: 'rifle', progress: 25, invested: 25, queued: [] },
                        air: { current: null, progress: 0, invested: 0, queued: [] }
                    }
                }
            }
        };

        // Tick should cancel all production for eliminated player
        const nextState = update(state, { type: 'TICK' });

        // All queues should be cleared
        expect(nextState.players[0].queues.building.current).toBeNull();
        expect(nextState.players[0].queues.building.progress).toBe(0);
        expect(nextState.players[0].queues.vehicle.current).toBeNull();
        expect(nextState.players[0].queues.vehicle.progress).toBe(0);
        expect(nextState.players[0].queues.infantry.current).toBeNull();
        expect(nextState.players[0].queues.infantry.progress).toBe(0);
        expect(nextState.players[0].readyToPlace).toBeNull();
    });

    it('should NOT allow infantry production without barracks', () => {
        let state = getInitialState();
        // Add conyard only - no barracks
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        state = addEntityToState(state, conyard);

        const action = { type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId: 0 } } as const;
        const nextState = update(state, action);

        // Should be rejected - infantry queue should remain empty
        expect(nextState.players[0].queues.infantry.current).toBeNull();
    });

    it('should allow infantry production WITH barracks', () => {
        let state = getInitialState();
        // Add conyard and barracks
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        const barracks = createTestEntity('bar_test', 0, 'BUILDING', 'barracks', 600, 500);
        state = addEntitiesToState(state, [conyard, barracks]);

        const action = { type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId: 0 } } as const;
        const nextState = update(state, action);

        // Should be allowed
        expect(nextState.players[0].queues.infantry.current).toBe('rifle');
    });

    it('should NOT allow vehicle production without factory', () => {
        let state = getInitialState();
        // Add conyard and barracks, but no factory
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        const barracks = createTestEntity('bar_test', 0, 'BUILDING', 'barracks', 600, 500);
        state = addEntitiesToState(state, [conyard, barracks]);

        const action = { type: 'START_BUILD', payload: { category: 'vehicle', key: 'light', playerId: 0 } } as const;
        const nextState = update(state, action);

        // Should be rejected
        expect(nextState.players[0].queues.vehicle.current).toBeNull();
    });

    it('should allow vehicle production WITH factory', () => {
        let state = getInitialState();
        // Add conyard, barracks, refinery, and factory (factory requires barracks and refinery)
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        const barracks = createTestEntity('bar_test', 0, 'BUILDING', 'barracks', 600, 500);
        const refinery = createTestEntity('ref_test', 0, 'BUILDING', 'refinery', 700, 500);
        const factory = createTestEntity('fac_test', 0, 'BUILDING', 'factory', 800, 500);
        state = addEntitiesToState(state, [conyard, barracks, refinery, factory]);

        const action = { type: 'START_BUILD', payload: { category: 'vehicle', key: 'light', playerId: 0 } } as const;
        const nextState = update(state, action);

        // Should be allowed
        expect(nextState.players[0].queues.vehicle.current).toBe('light');
    });

    it('should NOT allow building production without conyard', () => {
        let state = getInitialState();
        // No buildings at all

        const action = { type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId: 0 } } as const;
        const nextState = update(state, action);

        // Should be rejected
        expect(nextState.players[0].queues.building.current).toBeNull();
    });

    it('should NOT allow advanced units without tech center', () => {
        let state = getInitialState();
        // Add full base but no tech center
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        const barracks = createTestEntity('bar_test', 0, 'BUILDING', 'barracks', 600, 500);
        const refinery = createTestEntity('ref_test', 0, 'BUILDING', 'refinery', 700, 500);
        const factory = createTestEntity('fac_test', 0, 'BUILDING', 'factory', 800, 500);
        state = addEntitiesToState(state, [conyard, barracks, refinery, factory]);

        // Mammoth tank requires tech center
        const action = { type: 'START_BUILD', payload: { category: 'vehicle', key: 'mammoth', playerId: 0 } } as const;
        const nextState = update(state, action);

        // Should be rejected - mammoth requires tech center
        expect(nextState.players[0].queues.vehicle.current).toBeNull();
    });

    it('should allow advanced units WITH tech center', () => {
        let state = getInitialState();
        // Add full base with tech center
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        const barracks = createTestEntity('bar_test', 0, 'BUILDING', 'barracks', 600, 500);
        const refinery = createTestEntity('ref_test', 0, 'BUILDING', 'refinery', 700, 500);
        const factory = createTestEntity('fac_test', 0, 'BUILDING', 'factory', 800, 500);
        const tech = createTestEntity('tech_test', 0, 'BUILDING', 'tech', 900, 500);
        state = addEntitiesToState(state, [conyard, barracks, refinery, factory, tech]);

        // Mammoth tank requires tech center
        const action = { type: 'START_BUILD', payload: { category: 'vehicle', key: 'mammoth', playerId: 0 } } as const;
        const nextState = update(state, action);

        // Should be allowed now
        expect(nextState.players[0].queues.vehicle.current).toBe('mammoth');
    });

    it('should cancel infantry production and refund if barracks is destroyed mid-production', () => {
        let state = { ...getInitialState(), running: true };
        // Add conyard and barracks
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        const barracks = createTestEntity('bar_test', 0, 'BUILDING', 'barracks', 600, 500);
        state = addEntitiesToState(state, [conyard, barracks]);

        // Start infantry production
        state = update(state, { type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId: 0 } } as const);
        expect(state.players[0].queues.infantry.current).toBe('rifle');

        // Simulate some ticks to invest credits
        for (let i = 0; i < 10; i++) {
            state = update(state, { type: 'TICK' });
        }
        const investedCredits = state.players[0].queues.infantry.invested;
        const creditsBeforeDestruction = state.players[0].credits;
        expect(investedCredits).toBeGreaterThan(0);

        // Destroy the barracks
        state = {
            ...state,
            entities: {
                ...state.entities,
                [barracks.id]: { ...state.entities[barracks.id], dead: true }
            }
        };

        // Next tick should cancel production and refund
        state = update(state, { type: 'TICK' });

        expect(state.players[0].queues.infantry.current).toBeNull();
        expect(state.players[0].queues.infantry.progress).toBe(0);
        // Credits should be refunded
        expect(state.players[0].credits).toBeGreaterThan(creditsBeforeDestruction);
    });

    it('should cancel vehicle production if factory is destroyed mid-production', () => {
        let state = { ...getInitialState(), running: true };
        // Add full base
        const conyard = createTestEntity('cy_test', 0, 'BUILDING', 'conyard');
        const barracks = createTestEntity('bar_test', 0, 'BUILDING', 'barracks', 600, 500);
        const refinery = createTestEntity('ref_test', 0, 'BUILDING', 'refinery', 700, 500);
        const factory = createTestEntity('fac_test', 0, 'BUILDING', 'factory', 800, 500);
        state = addEntitiesToState(state, [conyard, barracks, refinery, factory]);

        // Start vehicle production
        state = update(state, { type: 'START_BUILD', payload: { category: 'vehicle', key: 'light', playerId: 0 } } as const);
        expect(state.players[0].queues.vehicle.current).toBe('light');

        // Destroy the factory
        state = {
            ...state,
            entities: {
                ...state.entities,
                [factory.id]: { ...state.entities[factory.id], dead: true }
            }
        };

        // Next tick should cancel production
        state = update(state, { type: 'TICK' });

        expect(state.players[0].queues.vehicle.current).toBeNull();
    });
});

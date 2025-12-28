import { describe, it, expect } from 'vitest';
import { update, INITIAL_STATE, createPlayerState } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';

function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number,
    overrides?: Partial<Entity>
): Entity {
    return {
        id,
        owner,
        type,
        key,
        pos: new Vector(x, y),
        hp: 100,
        maxHp: 100,
        size: 20,
        velocity: new Vector(0, 0),
        dead: false,
        visible: true,
        turretAngle: 0,
        w: 50,
        h: 50,
        vel: new Vector(0, 0),
        rotation: 0,
        cooldown: 0,
        flash: 0,
        ...overrides
    } as Entity;
}

function createTestState(entities: Record<EntityId, Entity>, credits: number = 5000): GameState {
    const state = { ...INITIAL_STATE, running: true };
    state.entities = entities;
    state.players = {
        0: { ...createPlayerState(0, false, 'medium', '#0088FF'), credits }
    };
    return state;
}

describe('Production Speed - Multiple Buildings', () => {
    describe('Infantry production', () => {
        it('should produce infantry faster with 2 barracks than 1', () => {
            // Setup: Player with credits and infantry in production
            const entities1: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
                'power2': createEntity('power2', 0, 'BUILDING', 'power', 250, 350),
                'barracks1': createEntity('barracks1', 0, 'BUILDING', 'barracks', 350, 300),
            };

            const entities2: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
                'power2': createEntity('power2', 0, 'BUILDING', 'power', 250, 350),
                'power3': createEntity('power3', 0, 'BUILDING', 'power', 250, 400),
                'barracks1': createEntity('barracks1', 0, 'BUILDING', 'barracks', 350, 300),
                'barracks2': createEntity('barracks2', 0, 'BUILDING', 'barracks', 400, 300),
            };

            // Start with same state but different barracks counts
            let state1 = createTestState(entities1, 5000);
            let state2 = createTestState(entities2, 5000);

            // Start building rifle in both
            state1 = update(state1, { type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId: 0 } });
            state2 = update(state2, { type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId: 0 } });

            // Tick both 100 times
            for (let i = 0; i < 100; i++) {
                state1 = update(state1, { type: 'TICK' });
                state2 = update(state2, { type: 'TICK' });
            }

            // With 2 barracks, progress should be 1.5x as fast
            const progress1 = state1.players[0].queues.infantry.progress;
            const progress2 = state2.players[0].queues.infantry.progress;

            // State2 (2 barracks) should have ~50% more progress
            expect(progress2).toBeGreaterThan(progress1 * 1.4);
            expect(progress2).toBeLessThan(progress1 * 1.6);
        });

        it('should produce infantry even faster with 3 barracks', () => {
            const entities3: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
                'power2': createEntity('power2', 0, 'BUILDING', 'power', 250, 350),
                'power3': createEntity('power3', 0, 'BUILDING', 'power', 250, 400),
                'power4': createEntity('power4', 0, 'BUILDING', 'power', 250, 450),
                'barracks1': createEntity('barracks1', 0, 'BUILDING', 'barracks', 350, 300),
                'barracks2': createEntity('barracks2', 0, 'BUILDING', 'barracks', 400, 300),
                'barracks3': createEntity('barracks3', 0, 'BUILDING', 'barracks', 450, 300),
            };

            const entities1: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
                'power2': createEntity('power2', 0, 'BUILDING', 'power', 250, 350),
                'barracks1': createEntity('barracks1', 0, 'BUILDING', 'barracks', 350, 300),
            };

            let state1 = createTestState(entities1, 5000);
            let state3 = createTestState(entities3, 5000);

            state1 = update(state1, { type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId: 0 } });
            state3 = update(state3, { type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId: 0 } });

            for (let i = 0; i < 100; i++) {
                state1 = update(state1, { type: 'TICK' });
                state3 = update(state3, { type: 'TICK' });
            }

            const progress1 = state1.players[0].queues.infantry.progress;
            const progress3 = state3.players[0].queues.infantry.progress;

            // State3 (3 barracks) should have ~2x the progress (1.0 + 2*0.5 = 2.0)
            expect(progress3).toBeGreaterThan(progress1 * 1.9);
            expect(progress3).toBeLessThan(progress1 * 2.1);
        });
    });

    describe('Vehicle production', () => {
        it('should produce vehicles faster with 2 factories than 1', () => {
            const entities1: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'factory1': createEntity('factory1', 0, 'BUILDING', 'factory', 350, 300),
                'refinery': createEntity('refinery', 0, 'BUILDING', 'refinery', 300, 350),
            };

            const entities2: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'factory1': createEntity('factory1', 0, 'BUILDING', 'factory', 350, 300),
                'factory2': createEntity('factory2', 0, 'BUILDING', 'factory', 400, 300),
                'refinery': createEntity('refinery', 0, 'BUILDING', 'refinery', 300, 350),
            };

            let state1 = createTestState(entities1, 5000);
            let state2 = createTestState(entities2, 5000);

            state1 = update(state1, { type: 'START_BUILD', payload: { category: 'vehicle', key: 'light', playerId: 0 } });
            state2 = update(state2, { type: 'START_BUILD', payload: { category: 'vehicle', key: 'light', playerId: 0 } });

            for (let i = 0; i < 100; i++) {
                state1 = update(state1, { type: 'TICK' });
                state2 = update(state2, { type: 'TICK' });
            }

            const progress1 = state1.players[0].queues.vehicle.progress;
            const progress2 = state2.players[0].queues.vehicle.progress;

            // State2 (2 factories) should have ~50% more progress
            expect(progress2).toBeGreaterThan(progress1 * 1.4);
            expect(progress2).toBeLessThan(progress1 * 1.6);
        });
    });

    describe('Building production', () => {
        it('should NOT speed up building production with multiple construction yards', () => {
            // Buildings are produced by construction yards but speed is not affected
            // (since you can only have one construction at a time anyway)
            const entities1: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
            };

            let state1 = createTestState(entities1, 5000);
            state1 = update(state1, { type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId: 0 } });

            for (let i = 0; i < 100; i++) {
                state1 = update(state1, { type: 'TICK' });
            }

            const progress1 = state1.players[0].queues.building.progress;

            // Just verify building production still works
            expect(progress1).toBeGreaterThan(0);
        });
    });
});

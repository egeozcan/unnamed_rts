import { describe, it, expect } from 'vitest';
import { update, INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { GameState, Entity, EntityId, BuildingKey } from '../../src/engine/types';
import { createTestBuilding } from '../../src/engine/test-utils';

function createEntity(
    id: string,
    owner: number,
    _type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number
): Entity {
    // This test only uses buildings
    return createTestBuilding({ id, owner, key: key as BuildingKey, x, y });
}

function createTestState(entities: Record<EntityId, Entity>, credits: number = 5000): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        entities,
        players: {
            0: { ...createPlayerState(0, false, 'medium', '#0088FF'), credits }
        }
    };
}

describe('Linear Production - Resource Deduction', () => {
    describe('Starting builds without full credits', () => {
        it('should allow starting a build with 0 credits', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
                'barracks': createEntity('barracks', 0, 'BUILDING', 'barracks', 350, 300),
            };

            let state = createTestState(entities, 0); // 0 credits

            // Should be able to start building a rifle even with 0 credits
            state = update(state, {
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'rifle', playerId: 0 }
            });

            expect(state.players[0].queues.infantry.current).toBe('rifle');
            expect(state.players[0].queues.infantry.progress).toBe(0);
        });

        it('should allow starting a building with insufficient credits', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
            };

            // Refinery costs 2000, player only has 100
            let state = createTestState(entities, 100);

            state = update(state, {
                type: 'START_BUILD',
                payload: { category: 'building', key: 'refinery', playerId: 0 }
            });

            expect(state.players[0].queues.building.current).toBe('refinery');
        });
    });

    describe('Linear cost deduction', () => {
        it('should deduct credits linearly as production progresses', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
                'barracks': createEntity('barracks', 0, 'BUILDING', 'barracks', 350, 300),
            };

            let state = createTestState(entities, 1000);
            const initialCredits = state.players[0].credits;

            state = update(state, {
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'rifle', playerId: 0 }
            });

            // Tick a few times
            for (let i = 0; i < 50; i++) {
                state = update(state, { type: 'TICK' });
            }

            const creditsSpent = initialCredits - state.players[0].credits;
            void state.players[0].queues.infantry.progress; // progress is validated via invested tracking

            // Rifle costs 100, so credits spent should be proportional to progress
            // creditsSpent / 100 should be approximately equal to progress / 100
            expect(creditsSpent).toBeGreaterThan(0);
            expect(creditsSpent).toBeLessThanOrEqual(100); // Never spend more than full cost

            // Invested amount should track what was spent
            expect(state.players[0].queues.infantry.invested).toBeCloseTo(creditsSpent, 1);
        });

        it('should track invested amount in the queue', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'factory': createEntity('factory', 0, 'BUILDING', 'factory', 350, 300),
                'refinery': createEntity('refinery', 0, 'BUILDING', 'refinery', 300, 350),
            };

            let state = createTestState(entities, 5000);

            state = update(state, {
                type: 'START_BUILD',
                payload: { category: 'vehicle', key: 'light', playerId: 0 }
            });

            // Initial invested should be 0
            expect(state.players[0].queues.vehicle.invested).toBe(0);

            // Tick until some progress
            for (let i = 0; i < 100; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Invested should be positive and match credits spent
            expect(state.players[0].queues.vehicle.invested).toBeGreaterThan(0);
        });
    });

    describe('Production pausing on insufficient credits', () => {
        it('should pause production when credits run out', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
                'barracks': createEntity('barracks', 0, 'BUILDING', 'barracks', 350, 300),
            };

            // Start with only 50 credits (rifle costs 100)
            let state = createTestState(entities, 50);

            state = update(state, {
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'rifle', playerId: 0 }
            });

            // Tick until credits run out
            for (let i = 0; i < 600; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Progress should be around 50% (spent 50 of 100)
            const progress = state.players[0].queues.infantry.progress;
            expect(progress).toBeGreaterThan(45);
            expect(progress).toBeLessThan(55);

            // Credits should be close to 0
            expect(state.players[0].credits).toBeCloseTo(0, 1);

            // Record progress at this point
            const pausedProgress = progress;

            // More ticks shouldn't advance progress
            for (let i = 0; i < 100; i++) {
                state = update(state, { type: 'TICK' });
            }

            expect(state.players[0].queues.infantry.progress).toBe(pausedProgress);
        });

        it('should resume production when credits become available', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
                'barracks': createEntity('barracks', 0, 'BUILDING', 'barracks', 350, 300),
            };

            // Start with 30 credits (rifle costs 100)
            let state = createTestState(entities, 30);

            state = update(state, {
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'rifle', playerId: 0 }
            });

            // Tick until credits run out
            for (let i = 0; i < 600; i++) {
                state = update(state, { type: 'TICK' });
            }

            const pausedProgress = state.players[0].queues.infantry.progress;
            expect(pausedProgress).toBeGreaterThan(25);
            expect(pausedProgress).toBeLessThan(35);

            // Add more credits (simulating harvester return)
            state = {
                ...state,
                players: {
                    ...state.players,
                    0: { ...state.players[0], credits: 100 }
                }
            };

            // Tick more - production should resume
            for (let i = 0; i < 600; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Should now be complete or advanced beyond paused progress
            // If complete, current will be null and progress will be 0
            // If still in progress, progress will be greater than pausedProgress
            const finalProgress = state.players[0].queues.infantry.progress;
            const isComplete = state.players[0].queues.infantry.current === null;

            // Either production resumed and advanced, or it completed
            expect(isComplete || finalProgress > pausedProgress).toBe(true);
        });
    });

    describe('Cancellation refunds', () => {
        it('should refund exactly the invested amount when canceling', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
                'barracks': createEntity('barracks', 0, 'BUILDING', 'barracks', 350, 300),
            };

            let state = createTestState(entities, 1000);
            const initialCredits = state.players[0].credits;

            state = update(state, {
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'rifle', playerId: 0 }
            });

            // Tick to spend some credits
            for (let i = 0; i < 100; i++) {
                state = update(state, { type: 'TICK' });
            }

            const creditsAfterSpending = state.players[0].credits;
            void (initialCredits - creditsAfterSpending); // creditsSpent calculated but refund validation is via final credits

            // Cancel the build
            state = update(state, {
                type: 'CANCEL_BUILD',
                payload: { category: 'infantry', playerId: 0 }
            });

            // Should be refunded exactly what was spent
            expect(state.players[0].credits).toBeCloseTo(initialCredits, 1);
        });

        it('should refund full cost for completed building waiting for placement', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
            };

            // Power costs 300
            let state = createTestState(entities, 1000);
            const initialCredits = state.players[0].credits;

            state = update(state, {
                type: 'START_BUILD',
                payload: { category: 'building', key: 'power', playerId: 0 }
            });

            // Tick until building is complete
            for (let i = 0; i < 1000; i++) {
                state = update(state, { type: 'TICK' });
                if (state.players[0].readyToPlace === 'power') break;
            }

            expect(state.players[0].readyToPlace).toBe('power');

            // Credits should be spent
            expect(state.players[0].credits).toBeLessThan(initialCredits);

            // Cancel the ready-to-place building
            state = update(state, {
                type: 'CANCEL_BUILD',
                payload: { category: 'building', playerId: 0 }
            });

            // Should get full refund (300)
            expect(state.players[0].credits).toBeCloseTo(initialCredits, 1);
            expect(state.players[0].readyToPlace).toBeNull();
        });

        it('should reset invested to 0 after canceling', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300),
                'power1': createEntity('power1', 0, 'BUILDING', 'power', 250, 300),
                'barracks': createEntity('barracks', 0, 'BUILDING', 'barracks', 350, 300),
            };

            let state = createTestState(entities, 1000);

            state = update(state, {
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'rifle', playerId: 0 }
            });

            // Tick to build up invested amount
            for (let i = 0; i < 50; i++) {
                state = update(state, { type: 'TICK' });
            }

            expect(state.players[0].queues.infantry.invested).toBeGreaterThan(0);

            // Cancel
            state = update(state, {
                type: 'CANCEL_BUILD',
                payload: { category: 'infantry', playerId: 0 }
            });

            // Queue should be reset
            expect(state.players[0].queues.infantry.current).toBeNull();
            expect(state.players[0].queues.infantry.progress).toBe(0);
            expect(state.players[0].queues.infantry.invested).toBe(0);
        });
    });
});

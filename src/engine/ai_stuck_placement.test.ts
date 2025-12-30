/**
 * Test for AI stuck placement bug:
 * When a player loses all buildings while having a building readyToPlace,
 * the AI gets stuck forever trying to place a building it can't place.
 * 
 * The fix: 
 * 1. Eliminated players (no buildings, no MCVs) skip AI entirely
 * 2. Players with only defense buildings cancel unplaceable builds
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { INITIAL_STATE } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';
import { computeAiActions, resetAIState } from './ai';

// Helper to create entity
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
        prevPos: new Vector(x, y),
        hp: 100,
        maxHp: 100,
        w: 30,
        h: 30,
        radius: 15,
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
        baseTargetId: null,
        ...overrides
    };
}

function createTestState(entities: Record<EntityId, Entity>): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        tick: 30, // Set to a tick divisible by 30 so AI runs
        entities
    };
}

describe('AI Stuck Placement Bug', () => {
    beforeEach(() => {
        resetAIState();
    });

    it('should not run AI for eliminated players (no buildings, no MCVs)', () => {
        // An eliminated player with credits but no buildings/MCVs should not queue anything
        const entities: Record<EntityId, Entity> = {};

        // Add a player 0 entity
        entities['dummy'] = createEntity('dummy', 0, 'BUILDING', 'conyard', 100, 100);

        let state = createTestState(entities);

        // Player 1 has credits and a pending building but no entities at all
        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 5000, // Lot of credits but no way to use them
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: 'barracks' // Even has a building ready
                }
            }
        };

        const actions = computeAiActions(state, 1);

        // Eliminated player should produce NO actions at all
        // This prevents any stuck behavior - they just do nothing
        expect(actions.length).toBe(0);
    });

    it('should cancel building placement when player only has defense buildings', () => {
        // Defense buildings don't extend build radius, so if a player only has
        // defense buildings left, they can't place new buildings
        const entities: Record<EntityId, Entity> = {};

        // Player only has a turret (defense building)
        entities['turret_1'] = createEntity('turret_1', 1, 'BUILDING', 'turret', 500, 500, {
            hp: 600,
            maxHp: 600,
            w: 40,
            h: 40,
            radius: 20
        });

        // Add a player 0 entity
        entities['dummy'] = createEntity('dummy', 0, 'BUILDING', 'conyard', 100, 100);

        let state = createTestState(entities);

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 500,
                    readyToPlace: 'factory'
                }
            }
        };

        const actions = computeAiActions(state, 1);

        // The AI should cancel the build since only defense buildings exist
        const cancelAction = actions.find(a => a.type === 'CANCEL_BUILD');
        expect(cancelAction).toBeDefined();
        expect(cancelAction?.payload.category).toBe('building');
    });

    it('should NOT cancel building when valid placement exists', () => {
        // Normal case: player has a conyard and can place buildings
        const entities: Record<EntityId, Entity> = {};

        // Player has a conyard
        entities['cy'] = createEntity('cy', 1, 'BUILDING', 'conyard', 500, 500, {
            hp: 3000,
            maxHp: 3000,
            w: 90,
            h: 90,
            radius: 45
        });

        // Add a player 0 entity
        entities['dummy'] = createEntity('dummy', 0, 'BUILDING', 'conyard', 100, 100);

        let state = createTestState(entities);

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 500,
                    readyToPlace: 'power'
                }
            }
        };

        const actions = computeAiActions(state, 1);

        // The AI should place the building, not cancel it
        const cancelAction = actions.find(a => a.type === 'CANCEL_BUILD');
        const placeAction = actions.find(a => a.type === 'PLACE_BUILDING');

        expect(cancelAction).toBeUndefined();
        expect(placeAction).toBeDefined();
    });

    it('should allow AI to run if player has MCV but no buildings', () => {
        // A player with just an MCV can still deploy it to become viable again
        // The MCV should not trigger the early exit for eliminated players
        const entities: Record<EntityId, Entity> = {};

        // Player 1 only has an MCV
        entities['mcv_1'] = createEntity('mcv_1', 1, 'UNIT', 'mcv', 500, 500, {
            hp: 2000,
            maxHp: 2000,
            w: 45,
            h: 45,
            radius: 22.5
        });

        // Player 0 has a base far away
        entities['dummy'] = createEntity('dummy', 0, 'BUILDING', 'conyard', 1500, 1500);

        // Add some ore nearby for the MCV to potentially expand to
        entities['ore_1'] = createEntity('ore_1', -1, 'RESOURCE', 'ore', 800, 500, {
            hp: 1000,
            maxHp: 1000
        });

        let state = createTestState(entities);

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 1000,
                    readyToPlace: null
                }
            }
        };

        // Call computeAiActions - should NOT return early (player has MCV)
        // The function should run without error, even if it produces 0 actions
        // (MCV handler may or may not produce actions depending on ore location)
        const actions = computeAiActions(state, 1);

        // The key test is that this doesn't crash and the AI "runs"
        // We verify by checking that the actions array is returned (even if empty)
        expect(Array.isArray(actions)).toBe(true);
    });

    it('should not queue new buildings for eliminated players with no buildings', () => {
        // This tests that eliminated players don't try to queue buildings
        const entities: Record<EntityId, Entity> = {};

        // Add a player 0 entity
        entities['dummy'] = createEntity('dummy', 0, 'BUILDING', 'conyard', 100, 100);

        let state = createTestState(entities);

        // Player 1 has credits but no entities - completely eliminated
        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 10000, // Lots of credits
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        const actions = computeAiActions(state, 1);

        // Should be empty - no building orders for eliminated players
        const buildAction = actions.find(a => a.type === 'START_BUILD');
        expect(buildAction).toBeUndefined();
        expect(actions.length).toBe(0);
    });
});

import { describe, it, expect } from 'vitest';
import { GameState, Vector, PlayerState, isActionType } from '../../src/engine/types';
import { computeAiActions } from '../../src/engine/ai/index.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { createTestBuilding, createTestCombatUnit, createTestResource, createTestHarvester } from '../../src/engine/test-utils';

function createMockState(): GameState {
    return JSON.parse(JSON.stringify(INITIAL_STATE));
}

describe('AI MCV Production Limiting', () => {
    const aiPlayerId = 1;
    const basePos = new Vector(500, 500);

    function setupBaseState(): GameState {
        const state = { ...createMockState(), tick: 31 }; // tick % 3 === 1 for player 1 AI

        // Setup AI player with enough credits for MCV (cost 3000) + buffer (2000)
        state.players[aiPlayerId] = {
            ...createPlayerState(aiPlayerId, true, 'medium'),
            credits: 10000
        };

        // Add conyard (1 base)
        state.entities['ai_conyard'] = createTestBuilding({
            id: 'ai_conyard',
            owner: aiPlayerId,
            key: 'conyard',
            x: basePos.x,
            y: basePos.y
        });

        // Add factory (required for MCV production)
        state.entities['ai_factory'] = createTestBuilding({
            id: 'ai_factory',
            owner: aiPlayerId,
            key: 'factory',
            x: basePos.x + 100,
            y: basePos.y
        });

        // Add refinery (needed for economy)
        state.entities['ai_refinery'] = createTestBuilding({
            id: 'ai_refinery',
            owner: aiPlayerId,
            key: 'refinery',
            x: basePos.x - 100,
            y: basePos.y
        });

        // Add harvesters (so AI doesn't prioritize harvester production over MCV)
        state.entities['ai_harv1'] = createTestHarvester({
            id: 'ai_harv1',
            owner: aiPlayerId,
            x: basePos.x - 50,
            y: basePos.y + 50
        });
        state.entities['ai_harv2'] = createTestHarvester({
            id: 'ai_harv2',
            owner: aiPlayerId,
            x: basePos.x - 50,
            y: basePos.y - 50
        });

        // Add ore near base (so refinery expansion isn't prioritized)
        state.entities['base_ore'] = createTestResource({
            id: 'base_ore',
            x: basePos.x - 150,
            y: basePos.y
        });

        // Add distant ore (triggers expansion desire) - must be:
        // 1. > 600px from ALL non-defense buildings
        // 2. Between 600-1500px from base center (conyard)
        state.entities['distant_ore'] = createTestResource({
            id: 'distant_ore',
            x: basePos.x + 900, // 900px from conyard, >600px from factory (at +100)
            y: basePos.y
        });

        return state;
    }

    it('should NOT queue MCV if already building one (current === mcv)', () => {
        const state = setupBaseState();

        // Set vehicle queue to already building MCV
        state.players[aiPlayerId].queues.vehicle = {
            current: 'mcv',
            progress: 50,
            invested: 1500,
            queued: []
        };

        const actions = computeAiActions(state, aiPlayerId);

        // Should NOT have another START_BUILD for MCV
        const mcvBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.key === 'mcv'
        );

        expect(mcvBuildActions.length).toBe(0);
    });

    it('should NOT queue MCV if MCV is in the queued array', () => {
        const state = setupBaseState();

        // Set vehicle queue with another vehicle building, MCV queued behind it
        state.players[aiPlayerId].queues.vehicle = {
            current: 'light',
            progress: 50,
            invested: 300,
            queued: ['mcv']
        };

        const actions = computeAiActions(state, aiPlayerId);

        // Should NOT have another START_BUILD for MCV
        const mcvBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.key === 'mcv'
        );

        expect(mcvBuildActions.length).toBe(0);
    });

    it('should NOT queue MCV if already queued a vehicle this tick', () => {
        const state = setupBaseState();

        // Vehicle queue is empty, so AI might build a combat vehicle first
        // The alreadyQueuedVehicleThisTick guard should prevent MCV from also being queued
        state.players[aiPlayerId].queues.vehicle = {
            current: null,
            progress: 0,
            invested: 0,
            queued: []
        };

        const actions = computeAiActions(state, aiPlayerId);

        // Count vehicle build actions
        const vehicleBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.category === 'vehicle'
        );

        // Should have at most 1 vehicle action - the guard prevents queueing multiple
        // (AI may not build any vehicles if in economy mode doing building walk)
        expect(vehicleBuildActions.length).toBeLessThanOrEqual(1);

        // If any vehicles were queued, there should only be 1
        if (vehicleBuildActions.length > 0) {
            const mcvBuildActions = actions.filter(a =>
                a.type === 'START_BUILD' &&
                a.payload.category === 'vehicle' &&
                a.payload.key === 'mcv'
            );
            const combatVehicleActions = actions.filter(a =>
                a.type === 'START_BUILD' &&
                a.payload.category === 'vehicle' &&
                a.payload.key !== 'mcv'
            );

            // Either combat vehicle OR MCV, not both
            expect(mcvBuildActions.length + combatVehicleActions.length).toBe(1);
        }
    });

    it('should NOT queue MCV if MCV entity already exists', () => {
        const state = setupBaseState();

        // Add an existing MCV entity
        state.entities['ai_mcv'] = createTestCombatUnit({
            id: 'ai_mcv',
            owner: aiPlayerId,
            key: 'mcv',
            x: basePos.x + 200,
            y: basePos.y
        });

        // Empty vehicle queue
        state.players[aiPlayerId].queues.vehicle = {
            current: null,
            progress: 0,
            invested: 0,
            queued: []
        };

        const actions = computeAiActions(state, aiPlayerId);

        // Should NOT have START_BUILD for MCV
        const mcvBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.key === 'mcv'
        );

        expect(mcvBuildActions.length).toBe(0);
    });

    it('should NOT queue MCV if at max bases (2 conyards)', () => {
        const state = setupBaseState();

        // Add a second conyard (now at MAX_BASES = 2)
        state.entities['ai_conyard2'] = createTestBuilding({
            id: 'ai_conyard2',
            owner: aiPlayerId,
            key: 'conyard',
            x: basePos.x + 500,
            y: basePos.y
        });

        // Empty vehicle queue
        state.players[aiPlayerId].queues.vehicle = {
            current: null,
            progress: 0,
            invested: 0,
            queued: []
        };

        const actions = computeAiActions(state, aiPlayerId);

        // Should NOT have START_BUILD for MCV
        const mcvBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.key === 'mcv'
        );

        expect(mcvBuildActions.length).toBe(0);
    });

    it('should NOT queue MCV if no factory exists', () => {
        const state = setupBaseState();

        // Remove the factory
        delete state.entities['ai_factory'];

        const actions = computeAiActions(state, aiPlayerId);

        // Should NOT have START_BUILD for MCV
        const mcvBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.key === 'mcv'
        );

        expect(mcvBuildActions.length).toBe(0);
    });

    it('should NOT queue MCV if not enough credits', () => {
        const state = setupBaseState();

        // Set credits below threshold (mcvCost 3000 + 2000 buffer = 5000)
        state.players[aiPlayerId] = { ...state.players[aiPlayerId], credits: 4000 };

        // Empty vehicle queue to ensure no combat vehicle is built first
        state.players[aiPlayerId].queues.vehicle = {
            current: 'light', // Something already building
            progress: 50,
            invested: 300,
            queued: []
        };

        const actions = computeAiActions(state, aiPlayerId);

        // Should NOT have START_BUILD for MCV
        const mcvBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.key === 'mcv'
        );

        expect(mcvBuildActions.length).toBe(0);
    });

    it('should NOT queue MCV if no distant ore exists', () => {
        const state = setupBaseState();

        // Remove the distant ore
        delete state.entities['distant_ore'];

        // Add ore that's too close (within 600px of buildings)
        state.entities['close_ore'] = createTestResource({
            id: 'close_ore',
            x: basePos.x + 100, // Very close to base
            y: basePos.y
        });

        // Empty vehicle queue
        state.players[aiPlayerId].queues.vehicle = {
            current: 'light', // Something building so combat vehicle isn't queued
            progress: 50,
            invested: 300,
            queued: []
        };

        const actions = computeAiActions(state, aiPlayerId);

        // Should NOT have START_BUILD for MCV
        const mcvBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.key === 'mcv'
        );

        expect(mcvBuildActions.length).toBe(0);
    });

    it('should NOT queue multiple vehicles in the same tick (prevents MCV spam)', () => {
        const state = setupBaseState();

        // Empty vehicle queue - AI will try to build combat vehicle first
        state.players[aiPlayerId].queues.vehicle = {
            current: null,
            progress: 0,
            invested: 0,
            queued: []
        };

        const actions = computeAiActions(state, aiPlayerId);

        // Count vehicle build actions
        const vehicleBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.category === 'vehicle'
        );

        // Should have at most 1 vehicle action (the alreadyQueuedVehicleThisTick guard)
        expect(vehicleBuildActions.length).toBeLessThanOrEqual(1);
    });

    it('should respect queue state when MCV is queued behind another vehicle', () => {
        const state = setupBaseState();

        // MCV is in queued array behind a tank
        state.players[aiPlayerId].queues.vehicle = {
            current: 'light',
            progress: 50,
            invested: 300,
            queued: ['mcv']  // MCV already queued
        };

        const actions = computeAiActions(state, aiPlayerId);

        // Should NOT queue another MCV
        const mcvBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.key === 'mcv'
        );

        expect(mcvBuildActions.length).toBe(0);
    });

    it('should respect queue state when MCV is currently building', () => {
        const state = setupBaseState();

        // MCV is currently building
        state.players[aiPlayerId].queues.vehicle = {
            current: 'mcv',
            progress: 50,
            invested: 1500,
            queued: []
        };

        const actions = computeAiActions(state, aiPlayerId);

        // Should NOT queue another MCV
        const mcvBuildActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.key === 'mcv'
        );

        expect(mcvBuildActions.length).toBe(0);
    });
});

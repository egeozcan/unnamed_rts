/**
 * Test: AI should be able to rebuild after losing all buildings
 * 
 * Scenario: An AI player has lost all buildings but has credits, harvesters,
 * and a building ready to place (readyToPlace). The AI should be able to 
 * place that building to start rebuilding their base.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState } from '../../src/engine/ai/index.js';
import { GameState, Entity, EntityId, PlayerState, Vector } from '../../src/engine/types';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { createTestResource } from '../../src/engine/test-utils';

// Helper to create test state
function createTestState(entities: Record<EntityId, Entity>): GameState {
    let state: GameState = {
        ...INITIAL_STATE,
        running: true,
        mode: 'game' as const,
        entities: entities as Record<EntityId, Entity>
    };

    // Initialize 8 players
    const players: Record<number, PlayerState> = {};
    for (let i = 0; i < 8; i++) {
        players[i] = createPlayerState(i, i > 0, 'hard', `#${i}${i}${i}${i}${i}${i}`);
        players[i] = { ...players[i], credits: 5000 };
    }
    state = { ...state, players };
    return state;
}

function createHarvester(id: string, owner: number, x: number, y: number): Entity {
    return {
        id,
        owner,
        type: 'UNIT',
        key: 'harvester',
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp: 200,
        maxHp: 200,
        w: 30,
        h: 30,
        radius: 15,
        dead: false,
        cargo: 0,
        maxCargo: 500
    } as Entity;
}

describe('AI Rebuild After Losing All Buildings', () => {
    beforeEach(() => {
        resetAIState();
    });

    it('should not cancel building when no buildings exist but readyToPlace is set', () => {
        // Setup: AI player 1 with no buildings, but a refinery ready to place
        const entities: Record<EntityId, Entity> = {};

        // Add some harvesters for the AI so it has something
        entities['harv1'] = createHarvester('harv1', 1, 500, 500);
        entities['harv2'] = createHarvester('harv2', 1, 520, 520);

        // Add some ore for the AI to find a refinery placement location
        for (let i = 0; i < 10; i++) {
            entities[`ore_${i}`] = createTestResource({
                id: `ore_${i}`,
                x: 450 + (i % 5) * 25,
                y: 450 + Math.floor(i / 5) * 25,
                hp: 1000
            });
        }

        let state = createTestState(entities);

        // Player 1 has readyToPlace set but NO buildings
        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 10000,
                    readyToPlace: 'refinery' // Building is ready to place!
                }
            }
        };

        // Run AI actions
        const actions = computeAiActions(state, 1);

        // The AI should NOT cancel the building just because there are no buildings
        const cancelActions = actions.filter(a => a.type === 'CANCEL_BUILD');
        expect(cancelActions).toHaveLength(0);
    });

    it('should not immediately cancel power plant when AI has readyToPlace but no buildings', () => {
        // This is the core bug: AI cancels building placement just because it has no buildings
        const entities: Record<EntityId, Entity> = {};

        // Give AI some harvesters
        entities['harv1'] = createHarvester('harv1', 1, 500, 500);

        let state = createTestState(entities);

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 15000,
                    readyToPlace: 'power'  // Power plant ready to place
                }
            }
        };

        // Run AI
        const actions = computeAiActions(state, 1);

        // Should NOT cancel the build
        const cancelActions = actions.filter(a => a.type === 'CANCEL_BUILD');
        expect(cancelActions).toHaveLength(0);
    });

    it('should process building placement even when AI has no buildings', () => {
        // Key test: The AI should reach handleBuildingPlacement even with no buildings
        const entities: Record<EntityId, Entity> = {};

        // Add some harvesters for the AI
        entities['harv1'] = createHarvester('harv1', 1, 300, 300);
        entities['harv2'] = createHarvester('harv2', 1, 350, 350);

        let state = createTestState(entities);

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 10000,
                    readyToPlace: 'conyard'  // Construction yard ready to place
                }
            }
        };

        // Run AI and check it doesn't exit early
        const actions = computeAiActions(state, 1);

        // The critical check: AI should not cancel the conyard placement
        // because that would doom the player to never rebuild
        const cancelActions = actions.filter(a => a.type === 'CANCEL_BUILD');
        expect(cancelActions).toHaveLength(0);
    });

    it('should allow AI to place first building near its units when it has no buildings', () => {
        // Scenario: AI lost all buildings but has harvesters and a building ready
        // It should be able to place the building near its units' location
        const entities: Record<EntityId, Entity> = {};

        // AI's harvesters are clustered around position (800, 800)
        entities['harv1'] = createHarvester('harv1', 1, 780, 780);
        entities['harv2'] = createHarvester('harv2', 1, 820, 820);
        entities['harv3'] = createHarvester('harv3', 1, 800, 800);

        // Add ore nearby for the harvesters
        for (let i = 0; i < 5; i++) {
            entities[`ore_${i}`] = createTestResource({
                id: `ore_${i}`,
                x: 750 + i * 30,
                y: 750,
                hp: 1000
            });
        }

        let state = createTestState(entities);

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 12000,
                    readyToPlace: 'refinery'
                }
            }
        };

        const actions = computeAiActions(state, 1);

        // The AI should NOT cancel the building
        const cancelActions = actions.filter(a => a.type === 'CANCEL_BUILD');
        expect(cancelActions).toHaveLength(0);

        // Ideally it would try to place the building (though placement might fail if no valid spot)
        // The key thing is it shouldn't give up just because there are no existing buildings
    });
});

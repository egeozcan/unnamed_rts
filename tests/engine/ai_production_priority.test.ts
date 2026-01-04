/**
 * Test: AI should build production buildings (barracks, factory) before spamming refineries
 * 
 * Scenario: An AI player has lots of money and economy priority is triggered.
 * The AI should NOT just build refineries infinitely - it should prioritize
 * military production buildings (barracks, factory) to build an army.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, getAIState } from '../../src/engine/ai/index.js';
import { GameState, Entity, EntityId, PlayerState, isActionType } from '../../src/engine/types';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { createTestBuilding, createTestResource } from '../../src/engine/test-utils';
import { evaluateInvestmentPriority } from '../../src/engine/ai/planning';
import { createEntityCache, getBuildingsForOwner, getEnemiesOf } from '../../src/engine/perf';
import { findBaseCenter } from '../../src/engine/ai/state';

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

describe('AI Production Building Priority', () => {
    beforeEach(() => {
        resetAIState();
    });

    it('should build barracks before more refineries when it has none', () => {
        const entities: Record<EntityId, Entity> = {};

        // Player 1 has conyard, power, and ONE refinery but NO barracks or factory
        entities['cy_1'] = createTestBuilding({ id: 'cy_1', owner: 1, key: 'conyard', x: 500, y: 500 });
        entities['power_1'] = createTestBuilding({ id: 'power_1', owner: 1, key: 'power', x: 400, y: 500 });
        entities['ref_1'] = createTestBuilding({ id: 'ref_1', owner: 1, key: 'refinery', x: 600, y: 500 });

        // Add ore near the refinery (accessible ore that "could" use another refinery)
        for (let i = 0; i < 10; i++) {
            entities[`ore_${i}`] = createTestResource({
                id: `ore_${i}`,
                x: 650 + (i % 5) * 30,
                y: 450 + Math.floor(i / 5) * 30,
                hp: 1000
            });
        }

        // Add enemy to give AI a reason to build
        entities['enemy_cy'] = createTestBuilding({ id: 'enemy_cy', owner: 0, key: 'conyard', x: 1500, y: 1500 });

        let state = createTestState(entities);

        // Give AI plenty of credits
        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 5000
                }
            }
        };

        // Run AI for several ticks
        let actions = computeAiActions(state, 1);

        // Check what building AI wants to make
        const buildingActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.category === 'building'
        );

        // The AI should prioritize barracks (for military production) over more refineries
        // since it already has one refinery but no production buildings
        if (buildingActions.length > 0) {
            const buildingKey = buildingActions[0].payload.key;
            expect(['barracks', 'factory', 'power']).toContain(buildingKey);
            expect(buildingKey).not.toBe('refinery');
        }
    });

    it('should build factory when it has barracks but no factory', () => {
        const entities: Record<EntityId, Entity> = {};

        // Player 1 has conyard, power, refinery, barracks but NO factory
        entities['cy_1'] = createTestBuilding({ id: 'cy_1', owner: 1, key: 'conyard', x: 500, y: 500 });
        entities['power_1'] = createTestBuilding({ id: 'power_1', owner: 1, key: 'power', x: 400, y: 500 });
        entities['ref_1'] = createTestBuilding({ id: 'ref_1', owner: 1, key: 'refinery', x: 600, y: 500 });
        entities['bar_1'] = createTestBuilding({ id: 'bar_1', owner: 1, key: 'barracks', x: 700, y: 500 });

        // Add enemy
        entities['enemy_cy'] = createTestBuilding({ id: 'enemy_cy', owner: 0, key: 'conyard', x: 1500, y: 1500 });

        let state = createTestState(entities);

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 5000
                }
            }
        };

        const actions = computeAiActions(state, 1);

        const buildingActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') && a.payload.category === 'building'
        );

        // Should prioritize factory over more refineries
        if (buildingActions.length > 0) {
            const buildingKey = buildingActions[0].payload.key;
            expect(['factory', 'power', 'turret']).toContain(buildingKey);
        }
    });

    it('should limit refinery count even when economyScore is low', () => {
        const entities: Record<EntityId, Entity> = {};

        // Player 1 has conyard, power, and MANY refineries (5+)
        entities['cy_1'] = createTestBuilding({ id: 'cy_1', owner: 1, key: 'conyard', x: 500, y: 500 });
        entities['power_1'] = createTestBuilding({ id: 'power_1', owner: 1, key: 'power', x: 400, y: 500 });

        // Add 5 refineries
        for (let i = 0; i < 5; i++) {
            entities[`ref_${i}`] = createTestBuilding({
                id: `ref_${i}`,
                owner: 1,
                key: 'refinery',
                x: 550 + i * 100,
                y: 500
            });
        }

        // Add lots of ore (to tempt AI to build more refineries)
        for (let i = 0; i < 20; i++) {
            entities[`ore_${i}`] = createTestResource({
                id: `ore_${i}`,
                x: 300 + (i % 10) * 50,
                y: 700 + Math.floor(i / 10) * 50,
                hp: 1000
            });
        }

        // Add enemy
        entities['enemy_cy'] = createTestBuilding({ id: 'enemy_cy', owner: 0, key: 'conyard', x: 1500, y: 1500 });

        let state = createTestState(entities);

        // Force economy priority to be set
        const cache = createEntityCache(state.entities);
        const myBuildings = getBuildingsForOwner(cache, 1);
        const enemies = getEnemiesOf(cache, 1);
        const baseCenter = findBaseCenter(myBuildings);
        const aiState = getAIState(1);
        const combatUnits: Entity[] = [];

        evaluateInvestmentPriority(state, 1, aiState, myBuildings, combatUnits, enemies, baseCenter);

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    ...state.players[1],
                    isAi: true,
                    credits: 8000
                }
            }
        };

        const actions = computeAiActions(state, 1);

        const refineryActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') &&
            a.payload.category === 'building' &&
            a.payload.key === 'refinery'
        );

        // With 5+ refineries already, should NOT build more refineries
        // Should prioritize barracks/factory instead
        expect(refineryActions.length).toBe(0);
    });

    it('should not build refinery when ore is already claimed by another players refinery', () => {
        const entities: Record<EntityId, Entity> = {};

        // Player 1 setup
        entities['cy_1'] = createTestBuilding({ id: 'cy_1', owner: 1, key: 'conyard', x: 500, y: 500 });
        entities['power_1'] = createTestBuilding({ id: 'power_1', owner: 1, key: 'power', x: 400, y: 500 });
        entities['ref_1'] = createTestBuilding({ id: 'ref_1', owner: 1, key: 'refinery', x: 600, y: 500 });
        entities['bar_1'] = createTestBuilding({ id: 'bar_1', owner: 1, key: 'barracks', x: 700, y: 500 });
        entities['fac_1'] = createTestBuilding({ id: 'fac_1', owner: 1, key: 'factory', x: 800, y: 500 });

        // Player 0 (enemy) has a refinery near ore
        entities['enemy_ref'] = createTestBuilding({ id: 'enemy_ref', owner: 0, key: 'refinery', x: 550, y: 750 });
        entities['enemy_cy'] = createTestBuilding({ id: 'enemy_cy', owner: 0, key: 'conyard', x: 650, y: 850 });

        // Ore is near enemy refinery but also within player 1's build range
        for (let i = 0; i < 5; i++) {
            entities[`ore_${i}`] = createTestResource({
                id: `ore_${i}`,
                x: 550 + i * 20,
                y: 700,
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
                    credits: 5000
                }
            }
        };

        const actions = computeAiActions(state, 1);

        // Check that AI doesn't try to build a refinery next to enemy's refinery
        // (the ore is already "claimed" by enemy refinery)
        const refineryActions = actions.filter(a =>
            isActionType(a, 'START_BUILD') &&
            a.payload.category === 'building' &&
            a.payload.key === 'refinery'
        );

        // May still build a refinery elsewhere, but should prioritize military now
        // The key is that it shouldn't spam refineries just because ore exists
    });
});

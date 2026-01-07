import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, getAIState, resetAIState } from '../../src/engine/ai/index.js';
import { GameState, Entity, EntityId, UnitKey, BuildingKey, PlayerState, isActionType, Action } from '../../src/engine/types';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { createTestBuilding, createTestCombatUnit, createTestResource, createTestHarvester } from '../../src/engine/test-utils';

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

// Helper to create entity using test-utils
function createEntity(
    id: string,
    owner: number,
    type: 'BUILDING' | 'UNIT' | 'RESOURCE',
    key: string,
    x: number,
    y: number,
    overrides?: { hp?: number; maxHp?: number; }
): Entity {
    if (type === 'BUILDING') {
        return createTestBuilding({
            id, owner, key: key as BuildingKey, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp
        });
    } else if (type === 'RESOURCE') {
        return createTestResource({ id, x, y, hp: overrides?.hp });
    } else if (key === 'harvester') {
        return createTestHarvester({
            id, owner, x, y,
            hp: overrides?.hp
        });
    } else {
        return createTestCombatUnit({
            id, owner, key: key as Exclude<UnitKey, 'harvester' | 'harrier'>, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp
        });
    }
}

describe('AI Prerequisites', () => {
    beforeEach(() => {
        resetAIState();
    });

    describe('Infantry Production Prerequisites', () => {
        it('should NOT build infantry without barracks', () => {
            const entities: Record<EntityId, Entity> = {};

            // Player 1 has conyard and factory but NO barracks
            entities['cy_1'] = createEntity('cy_1', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory_1'] = createEntity('factory_1', 1, 'BUILDING', 'factory', 600, 500);
            entities['power_1'] = createEntity('power_1', 1, 'BUILDING', 'power', 400, 500);
            entities['refinery_1'] = createEntity('refinery_1', 1, 'BUILDING', 'refinery', 700, 500);

            // Add enemy so AI has reason to build units
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 1500, 1500);

            let state = createTestState(entities);
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        credits: 5000, // Plenty of money
                        queues: {
                            building: { current: null, progress: 0, invested: 0 },
                            infantry: { current: null, progress: 0, invested: 0 },
                            vehicle: { current: null, progress: 0, invested: 0 },
                            air: { current: null, progress: 0, invested: 0 }
                        }
                    }
                }
            };

            const actions = computeAiActions(state, 1);

            // Should NOT have any infantry START_BUILD actions
            const infantryBuildActions = actions.filter(a =>
                isActionType(a, 'START_BUILD') && a.payload.category === 'infantry'
            );

            expect(infantryBuildActions.length).toBe(0);
        });

        it('should build infantry WITH barracks', () => {
            const entities: Record<EntityId, Entity> = {};

            // Player 1 has conyard, power, and barracks
            entities['cy_1'] = createEntity('cy_1', 1, 'BUILDING', 'conyard', 500, 500);
            entities['power_1'] = createEntity('power_1', 1, 'BUILDING', 'power', 400, 500);
            entities['barracks_1'] = createEntity('barracks_1', 1, 'BUILDING', 'barracks', 600, 500);

            // Add enemy so AI has reason to build units
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 1500, 1500);

            let state = createTestState(entities);
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        credits: 5000,
                        queues: {
                            building: { current: null, progress: 0, invested: 0 },
                            infantry: { current: null, progress: 0, invested: 0 },
                            vehicle: { current: null, progress: 0, invested: 0 },
                            air: { current: null, progress: 0, invested: 0 }
                        }
                    }
                }
            };

            // Run several ticks to let AI decide to build
            let actions: Action[] = [];
            for (let i = 0; i < 5; i++) {
                actions = computeAiActions(state, 1);
                if (actions.some(a => isActionType(a, 'START_BUILD') && a.payload.category === 'infantry')) {
                    break;
                }
            }

            // Should have infantry production action (rifle or rocket)
            const infantryBuildActions = actions.filter(a =>
                isActionType(a, 'START_BUILD') && a.payload.category === 'infantry'
            );

            expect(infantryBuildActions.length).toBeGreaterThan(0);
        });
    });

    describe('Vehicle Production Prerequisites', () => {
        it('should NOT build vehicles without factory', () => {
            const entities: Record<EntityId, Entity> = {};

            // Player 1 has conyard, power, barracks but NO factory
            entities['cy_1'] = createEntity('cy_1', 1, 'BUILDING', 'conyard', 500, 500);
            entities['power_1'] = createEntity('power_1', 1, 'BUILDING', 'power', 400, 500);
            entities['barracks_1'] = createEntity('barracks_1', 1, 'BUILDING', 'barracks', 600, 500);
            entities['refinery_1'] = createEntity('refinery_1', 1, 'BUILDING', 'refinery', 700, 500);

            // Add enemy so AI has reason to build units
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 1500, 1500);

            let state = createTestState(entities);
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        credits: 5000,
                        queues: {
                            building: { current: null, progress: 0, invested: 0 },
                            infantry: { current: null, progress: 0, invested: 0 },
                            vehicle: { current: null, progress: 0, invested: 0 },
                            air: { current: null, progress: 0, invested: 0 }
                        }
                    }
                }
            };

            const actions = computeAiActions(state, 1);

            // Should NOT have any vehicle START_BUILD actions
            const vehicleBuildActions = actions.filter(a =>
                isActionType(a, 'START_BUILD') && a.payload.category === 'vehicle'
            );

            expect(vehicleBuildActions.length).toBe(0);
        });

        it('should build vehicles WITH factory', () => {
            const entities: Record<EntityId, Entity> = {};

            // Player 1 has full base including factory
            entities['cy_1'] = createEntity('cy_1', 1, 'BUILDING', 'conyard', 500, 500);
            entities['power_1'] = createEntity('power_1', 1, 'BUILDING', 'power', 400, 500);
            entities['barracks_1'] = createEntity('barracks_1', 1, 'BUILDING', 'barracks', 600, 500);
            entities['refinery_1'] = createEntity('refinery_1', 1, 'BUILDING', 'refinery', 700, 500);
            entities['factory_1'] = createEntity('factory_1', 1, 'BUILDING', 'factory', 800, 500);

            // Add enemy so AI has reason to build units
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 1500, 1500);

            let state = createTestState(entities);
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        credits: 5000,
                        queues: {
                            building: { current: null, progress: 0, invested: 0 },
                            infantry: { current: null, progress: 0, invested: 0 },
                            vehicle: { current: null, progress: 0, invested: 0 },
                            air: { current: null, progress: 0, invested: 0 }
                        }
                    }
                }
            };

            // Run several ticks to trigger vehicle production
            let actions: Action[] = [];
            for (let i = 0; i < 5; i++) {
                actions = computeAiActions(state, 1);
                if (actions.some(a => isActionType(a, 'START_BUILD') && a.payload.category === 'vehicle')) {
                    break;
                }
                // Simulate AI alternating - set lastProductionType to infantry
                const aiState = getAIState(1);
                aiState.lastProductionType = 'infantry';
            }

            // Should have vehicle production action
            const vehicleBuildActions = actions.filter(a =>
                isActionType(a, 'START_BUILD') && a.payload.category === 'vehicle'
            );

            expect(vehicleBuildActions.length).toBeGreaterThan(0);
        });
    });

    describe('Production Fallback Logic', () => {
        it('should fall back to infantry when vehicles are too expensive', () => {
            const entities: Record<EntityId, Entity> = {};

            // Player 1 has full base
            entities['cy_1'] = createEntity('cy_1', 1, 'BUILDING', 'conyard', 500, 500);
            entities['power_1'] = createEntity('power_1', 1, 'BUILDING', 'power', 400, 500);
            entities['barracks_1'] = createEntity('barracks_1', 1, 'BUILDING', 'barracks', 600, 500);
            entities['refinery_1'] = createEntity('refinery_1', 1, 'BUILDING', 'refinery', 700, 500);
            entities['factory_1'] = createEntity('factory_1', 1, 'BUILDING', 'factory', 800, 500);
            // Add enough harvesters to satisfy all personalities (3 for turtle's 2.5 ratio)
            entities['harv_1'] = createEntity('harv_1', 1, 'UNIT', 'harvester', 750, 550);
            entities['harv_2'] = createEntity('harv_2', 1, 'UNIT', 'harvester', 750, 600);
            entities['harv_3'] = createEntity('harv_3', 1, 'UNIT', 'harvester', 750, 650);

            // Add enemy so AI has reason to build units
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 1500, 1500);

            let state = createTestState(entities);

            // Set credits to trigger fallback (personality-based credit buffer):
            // - Light tank costs 800, Rifle costs 100
            // - With 850 credits:
            //   - Rusher (buffer=200, threshold=600): can afford infantry, can't afford vehicle ✓
            //   - Balanced (buffer=400, threshold=800): can afford infantry, can't afford vehicle ✓
            //   - Turtle (buffer=600, threshold=1000): below threshold, won't build anything
            // The key test is: IF units are built, they should be infantry (not vehicles)
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        credits: 850,
                        queues: {
                            building: { current: null, progress: 0, invested: 0 },
                            infantry: { current: null, progress: 0, invested: 0 },
                            vehicle: { current: null, progress: 0, invested: 0 },
                            air: { current: null, progress: 0, invested: 0 }
                        }
                    }
                }
            };

            // Set AI to want to build vehicles (simulate alternating)
            const aiState = getAIState(1);
            aiState.lastProductionType = 'infantry';  // This makes AI want to build vehicle next

            const actions = computeAiActions(state, 1);

            // The AI should NOT build vehicles (too expensive for all personalities)
            const vehicleBuildActions = actions.filter(a =>
                isActionType(a, 'START_BUILD') && a.payload.category === 'vehicle'
            );

            const infantryBuildActions = actions.filter(a =>
                isActionType(a, 'START_BUILD') && a.payload.category === 'infantry'
            );

            // Key assertion: vehicles should NOT be built (too expensive)
            expect(vehicleBuildActions.length).toBe(0);
            // Infantry might be built (depends on personality threshold being met)
            // At least for rusher and balanced, infantry should be built
            // For turtle (1/3 chance), no units built due to threshold
        });

        it('should build vehicles when affordable (no fallback needed)', () => {
            const entities: Record<EntityId, Entity> = {};

            // Player 1 has full base
            entities['cy_1'] = createEntity('cy_1', 1, 'BUILDING', 'conyard', 500, 500);
            entities['power_1'] = createEntity('power_1', 1, 'BUILDING', 'power', 400, 500);
            entities['barracks_1'] = createEntity('barracks_1', 1, 'BUILDING', 'barracks', 600, 500);
            entities['refinery_1'] = createEntity('refinery_1', 1, 'BUILDING', 'refinery', 700, 500);
            entities['factory_1'] = createEntity('factory_1', 1, 'BUILDING', 'factory', 800, 500);

            // Add enemy so AI has reason to build units
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 1500, 1500);

            let state = createTestState(entities);

            // Give plenty of credits
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        credits: 5000,
                        queues: {
                            building: { current: null, progress: 0, invested: 0 },
                            infantry: { current: null, progress: 0, invested: 0 },
                            vehicle: { current: null, progress: 0, invested: 0 },
                            air: { current: null, progress: 0, invested: 0 }
                        }
                    }
                }
            };

            // Set AI to want to build vehicles
            const aiState = getAIState(1);
            aiState.lastProductionType = 'infantry';

            const actions = computeAiActions(state, 1);

            const vehicleBuildActions = actions.filter(a =>
                isActionType(a, 'START_BUILD') && a.payload.category === 'vehicle'
            );

            // Should be able to build vehicles when affordable
            expect(vehicleBuildActions.length).toBeGreaterThan(0);
        });
    });

    describe('Harvester Prerequisites', () => {
        it('should NOT build harvesters without refinery', () => {
            const entities: Record<EntityId, Entity> = {};

            // Player 1 has conyard and factory but NO refinery
            entities['cy_1'] = createEntity('cy_1', 1, 'BUILDING', 'conyard', 500, 500);
            entities['power_1'] = createEntity('power_1', 1, 'BUILDING', 'power', 400, 500);
            entities['barracks_1'] = createEntity('barracks_1', 1, 'BUILDING', 'barracks', 600, 500);
            entities['factory_1'] = createEntity('factory_1', 1, 'BUILDING', 'factory', 800, 500);

            // Add ore nearby
            entities['ore_1'] = createEntity('ore_1', -1, 'RESOURCE', 'ore', 600, 600, { hp: 5000, maxHp: 5000 });

            let state = createTestState(entities);
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        credits: 5000,
                        queues: {
                            building: { current: null, progress: 0, invested: 0 },
                            infantry: { current: null, progress: 0, invested: 0 },
                            vehicle: { current: null, progress: 0, invested: 0 },
                            air: { current: null, progress: 0, invested: 0 }
                        }
                    }
                }
            };

            const actions = computeAiActions(state, 1);

            // Should NOT queue harvester production
            const harvesterActions = actions.filter(a =>
                isActionType(a, 'START_BUILD') && a.payload.key === 'harvester'
            );

            expect(harvesterActions.length).toBe(0);
        });
    });
});

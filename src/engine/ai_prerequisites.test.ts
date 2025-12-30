import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, getAIState, resetAIState } from './ai';
import { GameState, Entity, EntityId, Vector } from './types';
import { INITIAL_STATE } from './reducer';

// Helper to create test state
function createTestState(entities: Record<EntityId, Entity>): GameState {
    let state: GameState = {
        ...INITIAL_STATE,
        running: true,
        mode: 'game' as const,
        entities: entities as Record<EntityId, Entity>
    };

    // Initialize 8 players
    const players: Record<number, any> = {};
    for (let i = 0; i < 8; i++) {
        players[i] = {
            id: i,
            isAi: i > 0,
            difficulty: 'hard' as const,
            color: `#${i}${i}${i}${i}${i}${i}`,
            credits: 5000,
            maxPower: 100,
            usedPower: 0,
            queues: {
                building: { current: null, progress: 0, invested: 0 },
                infantry: { current: null, progress: 0, invested: 0 },
                vehicle: { current: null, progress: 0, invested: 0 },
                air: { current: null, progress: 0, invested: 0 }
            },
            readyToPlace: null
        };
    }
    state = { ...state, players };
    return state;
}

// Helper to create minimal entity
function createEntity(
    id: string,
    owner: number,
    type: 'BUILDING' | 'UNIT' | 'RESOURCE',
    key: string,
    x: number,
    y: number,
    overrides: Partial<Entity> = {}
): Entity {
    return {
        id,
        owner,
        type,
        key,
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp: 1000,
        maxHp: 1000,
        w: 50,
        h: 50,
        radius: 25,
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
    } as Entity;
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
                a.type === 'START_BUILD' &&
                (a as any).payload.category === 'infantry'
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
            let actions: any[] = [];
            for (let i = 0; i < 5; i++) {
                actions = computeAiActions(state, 1);
                if (actions.some(a => a.type === 'START_BUILD' && (a as any).payload.category === 'infantry')) {
                    break;
                }
            }

            // Should have infantry production action (rifle or rocket)
            const infantryBuildActions = actions.filter(a =>
                a.type === 'START_BUILD' &&
                (a as any).payload.category === 'infantry'
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
                a.type === 'START_BUILD' &&
                (a as any).payload.category === 'vehicle'
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
            let actions: any[] = [];
            for (let i = 0; i < 5; i++) {
                actions = computeAiActions(state, 1);
                if (actions.some(a => a.type === 'START_BUILD' && (a as any).payload.category === 'vehicle')) {
                    break;
                }
                // Simulate AI alternating - set lastProductionType to infantry
                const aiState = getAIState(1);
                aiState.lastProductionType = 'infantry';
            }

            // Should have vehicle production action
            const vehicleBuildActions = actions.filter(a =>
                a.type === 'START_BUILD' &&
                (a as any).payload.category === 'vehicle'
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

            // Add enemy so AI has reason to build units
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 1500, 1500);

            let state = createTestState(entities);

            // Set credits to trigger fallback:
            // - creditThreshold = 800 (for buildup strategy) - need credits > 800 to build
            // - creditBuffer = 500
            // - Light tank costs 800, so need 800 + 500 = 1300 to build vehicle
            // - Rifle costs 100, so need 100 + 500 = 600 to build infantry
            // Set credits to 1000: > 800 (threshold), < 1300 (vehicle+buffer), >= 600 (infantry+buffer)
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        credits: 1000,
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

            // The AI should fall back to infantry since vehicles are too expensive
            const infantryBuildActions = actions.filter(a =>
                a.type === 'START_BUILD' &&
                (a as any).payload.category === 'infantry'
            );

            const vehicleBuildActions = actions.filter(a =>
                a.type === 'START_BUILD' &&
                (a as any).payload.category === 'vehicle'
            );

            // Should have infantry (fallback) but NOT vehicles
            expect(vehicleBuildActions.length).toBe(0);
            expect(infantryBuildActions.length).toBeGreaterThan(0);
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
                a.type === 'START_BUILD' &&
                (a as any).payload.category === 'vehicle'
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
                a.type === 'START_BUILD' &&
                (a as any).payload.key === 'harvester'
            );

            expect(harvesterActions.length).toBe(0);
        });
    });
});

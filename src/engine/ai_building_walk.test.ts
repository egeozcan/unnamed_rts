import { describe, it, expect, beforeEach } from 'vitest';
import { GameState, Vector, PlayerState, ProductionQueue } from './types.js';
import { computeAiActions, resetAIState, _testUtils } from './ai.js';
import { createTestBuilding, createTestResource } from './test-utils.js';

const { getAIState } = _testUtils;

// Helper to create a minimal game state
function createMinimalState(overrides: Partial<GameState> = {}): GameState {
    const defaultQueue: ProductionQueue = { current: null, progress: 0, invested: 0 };
    const defaultPlayer: Partial<PlayerState> = {
        credits: 2000,
        readyToPlace: null,
        queues: {
            building: { ...defaultQueue },
            infantry: { ...defaultQueue },
            vehicle: { ...defaultQueue },
            air: { ...defaultQueue }
        }
    };

    return {
        running: true,
        mode: 'demo',
        sellMode: false,
        repairMode: false,
        difficulty: 'easy',
        tick: 1000,
        camera: new Vector(0, 0),
        zoom: 1,
        entities: {},
        projectiles: [],
        particles: [],
        selection: [],
        placingBuilding: null,
        players: {
            0: { ...defaultPlayer } as PlayerState,
            1: { ...defaultPlayer } as PlayerState
        },
        winner: null,
        config: { width: 2000, height: 2000, resourceDensity: 'medium', rockDensity: 'medium' },
        debugMode: false,
        showMinimap: false,
        ...overrides
    };
}

function createDefaultPlayerState(overrides: Partial<PlayerState> = {}): PlayerState {
    const defaultQueue: ProductionQueue = { current: null, progress: 0, invested: 0 };
    return {
        id: 0,
        isAi: true,
        difficulty: 'easy',
        color: '#ff0000',
        credits: 2000,
        maxPower: 100,
        usedPower: 0,
        readyToPlace: null,
        queues: {
            building: { ...defaultQueue },
            infantry: { ...defaultQueue },
            vehicle: { ...defaultQueue },
            air: { ...defaultQueue }
        },
        ...overrides
    } as PlayerState;
}

describe('AI Building Walk Limits', () => {
    beforeEach(() => {
        resetAIState();
    });

    it('should NOT keep building power plants once ore is within build range', () => {
        // Setup: AI base at (350, 350)
        // Ore patch at (700, 600) - ~450 units away (triggers building walk)
        // AI has already built power plants extending to (650, 550) - now ore is within build range!

        const state = createMinimalState({
            entities: {
                // AI base
                'cy_p1': createTestBuilding({ id: 'cy_p1', key: 'conyard', owner: 1, x: 350, y: 350 }),
                'barracks_p1': createTestBuilding({ id: 'barracks_p1', key: 'barracks', owner: 1, x: 450, y: 350 }),
                'factory_p1': createTestBuilding({ id: 'factory_p1', key: 'factory', owner: 1, x: 300, y: 450 }),

                // Power plants already built toward ore (building walk)
                'power_1': createTestBuilding({ id: 'power_1', key: 'power', owner: 1, x: 500, y: 500 }),
                'power_2': createTestBuilding({ id: 'power_2', key: 'power', owner: 1, x: 600, y: 550 }), // This one is close to ore!

                // Ore patch (now within BUILD_RADIUS of power_2)
                'ore_1': createTestResource({ id: 'ore_1', x: 700, y: 600 }),
                'ore_2': createTestResource({ id: 'ore_2', x: 720, y: 580 }),
                'ore_3': createTestResource({ id: 'ore_3', x: 680, y: 620 }),

                // Enemy conyard (to prevent weird state changes)
                'cy_p0': createTestBuilding({ id: 'cy_p0', key: 'conyard', owner: 0, x: 1600, y: 1600 }),
            },
            players: {
                0: createDefaultPlayerState({ id: 0 }),
                1: createDefaultPlayerState({ id: 1, credits: 2000 })
            }
        });

        // Run AI for player 1 multiple times
        const actions = computeAiActions(state, 1);

        // The AI should NOT try to build another power plant since ore is already reachable
        const powerBuildActions = actions.filter(a =>
            a.type === 'START_BUILD' &&
            a.payload.key === 'power'
        );

        expect(powerBuildActions.length).toBe(0);
    });

    it('should NOT build power plants when ore is within build range even with economy priority', () => {
        // AI has successfully built power plants to reach ore
        // Now it should NOT build more power plants

        const state = createMinimalState({
            entities: {
                // AI base
                'cy_p1': createTestBuilding({ id: 'cy_p1', key: 'conyard', owner: 1, x: 350, y: 350 }),
                'barracks_p1': createTestBuilding({ id: 'barracks_p1', key: 'barracks', owner: 1, x: 450, y: 350 }),
                'factory_p1': createTestBuilding({ id: 'factory_p1', key: 'factory', owner: 1, x: 300, y: 450 }),

                // Power plants reaching toward ore
                'power_1': createTestBuilding({ id: 'power_1', key: 'power', owner: 1, x: 500, y: 500 }),
                'power_2': createTestBuilding({ id: 'power_2', key: 'power', owner: 1, x: 650, y: 600 }), // Close to ore

                // Ore patch - within BUILD_RADIUS (400) of power_2
                'ore_1': createTestResource({ id: 'ore_1', x: 800, y: 650 }),
                'ore_2': createTestResource({ id: 'ore_2', x: 820, y: 630 }),
                'ore_3': createTestResource({ id: 'ore_3', x: 780, y: 670 }),

                // Enemy
                'cy_p0': createTestBuilding({ id: 'cy_p0', key: 'conyard', owner: 0, x: 1600, y: 1600 }),
            },
            players: {
                0: createDefaultPlayerState({ id: 0 }),
                1: createDefaultPlayerState({ id: 1, credits: 3000 })
            }
        });

        // Force economy priority
        const aiState = getAIState(1);
        aiState.investmentPriority = 'economy';
        aiState.expansionTarget = new Vector(800, 650); // The ore location

        const actions = computeAiActions(state, 1);

        // The key assertion: NO more power plants should be built since ore is reachable
        const powerBuildActions = actions.filter(a =>
            a.type === 'START_BUILD' &&
            a.payload.key === 'power'
        );

        expect(powerBuildActions.length).toBe(0);
    });

    it('should NOT build power plants beyond the ore', () => {
        // AI has ore at (700, 600)
        // Power plant at (750, 650) - already past the ore!
        // Should not build more power plants in this direction

        const state = createMinimalState({
            entities: {
                // AI base at bottom-right
                'cy_p1': createTestBuilding({ id: 'cy_p1', key: 'conyard', owner: 1, x: 1600, y: 1600 }),
                'barracks_p1': createTestBuilding({ id: 'barracks_p1', key: 'barracks', owner: 1, x: 1500, y: 1600 }),
                'factory_p1': createTestBuilding({ id: 'factory_p1', key: 'factory', owner: 1, x: 1600, y: 1500 }),

                // Power plants going toward ore (top-left direction)
                'power_1': createTestBuilding({ id: 'power_1', key: 'power', owner: 1, x: 1400, y: 1400 }),
                'power_2': createTestBuilding({ id: 'power_2', key: 'power', owner: 1, x: 1200, y: 1200 }),
                'power_3': createTestBuilding({ id: 'power_3', key: 'power', owner: 1, x: 1000, y: 1000 }), // Already past ore

                // Ore patch - now behind the power_3 (between base and power_3)
                'ore_1': createTestResource({ id: 'ore_1', x: 1150, y: 1150 }),
                'ore_2': createTestResource({ id: 'ore_2', x: 1130, y: 1170 }),
                'ore_3': createTestResource({ id: 'ore_3', x: 1170, y: 1130 }),

                // Enemy
                'cy_p0': createTestBuilding({ id: 'cy_p0', key: 'conyard', owner: 0, x: 350, y: 350 }),
            },
            players: {
                0: createDefaultPlayerState({ id: 0 }),
                1: createDefaultPlayerState({ id: 1, credits: 2000 })
            }
        });

        // Force economy priority
        const aiState = getAIState(1);
        aiState.investmentPriority = 'economy';

        const actions = computeAiActions(state, 1);

        // Should NOT build more power plants - ore is already reachable
        const powerBuildActions = actions.filter(a =>
            a.type === 'START_BUILD' &&
            a.payload.key === 'power'
        );

        expect(powerBuildActions.length).toBe(0);
    });

    it('should stop building walk when ore target becomes reachable', () => {
        // Scenario from the bug report: AI keeps building power plants even after
        // the expansion target is within build range

        const state = createMinimalState({
            entities: {
                // AI base
                'cy_p1': createTestBuilding({ id: 'cy_p1', key: 'conyard', owner: 1, x: 350, y: 350 }),
                'barracks_p1': createTestBuilding({ id: 'barracks_p1', key: 'barracks', owner: 1, x: 470, y: 300 }),
                'factory_p1': createTestBuilding({ id: 'factory_p1', key: 'factory', owner: 1, x: 300, y: 470 }),

                // Power plants forming a chain
                'power_1': createTestBuilding({ id: 'power_1', key: 'power', owner: 1, x: 469, y: 550 }),
                'power_2': createTestBuilding({ id: 'power_2', key: 'power', owner: 1, x: 759, y: 460 }),

                // Ore patch - within 400 units of power_2
                'ore_1': createTestResource({ id: 'ore_1', x: 640, y: 584 }),
                'ore_2': createTestResource({ id: 'ore_2', x: 598, y: 558 }),
                'ore_3': createTestResource({ id: 'ore_3', x: 549, y: 582 }),

                // Enemy
                'cy_p0': createTestBuilding({ id: 'cy_p0', key: 'conyard', owner: 0, x: 1650, y: 1650 }),
            },
            players: {
                0: createDefaultPlayerState({ id: 0 }),
                1: createDefaultPlayerState({ id: 1, credits: 2000 })
            }
        });

        // Force economy priority with an expansion target
        const aiState = getAIState(1);
        aiState.investmentPriority = 'economy';
        aiState.expansionTarget = new Vector(600, 570); // The ore location

        const actions = computeAiActions(state, 1);

        // AI should recognize ore is already reachable and NOT build more power plants
        const powerBuildActions = actions.filter(a =>
            a.type === 'START_BUILD' &&
            a.payload.key === 'power'
        );

        expect(powerBuildActions.length).toBe(0);
    });
});

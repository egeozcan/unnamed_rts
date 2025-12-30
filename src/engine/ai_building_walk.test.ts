import { describe, it, expect, beforeEach } from 'vitest';
import { GameState, Entity, Vector, PlayerState, ProductionQueue } from './types.js';
import { computeAiActions, resetAIState, _testUtils } from './ai.js';

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

// Helper to create a building entity
function createBuilding(id: string, key: string, owner: number, pos: Vector): Entity {
    return {
        id,
        owner,
        key,
        type: 'BUILDING',
        pos: pos,
        prevPos: pos,
        hp: 100,
        maxHp: 100,
        w: 60,
        h: 60,
        radius: 30,
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
        baseTargetId: null
    };
}

// Helper to create a resource entity
function createResource(id: string, pos: Vector, hp: number = 1000): Entity {
    return {
        id,
        owner: -1,
        key: 'ore',
        type: 'RESOURCE',
        pos: pos,
        prevPos: pos,
        hp,
        maxHp: 1000,
        w: 25,
        h: 25,
        radius: 12,
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
        baseTargetId: null
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
                'cy_p1': createBuilding('cy_p1', 'conyard', 1, new Vector(350, 350)),
                'barracks_p1': createBuilding('barracks_p1', 'barracks', 1, new Vector(450, 350)),
                'factory_p1': createBuilding('factory_p1', 'factory', 1, new Vector(300, 450)),

                // Power plants already built toward ore (building walk)
                'power_1': createBuilding('power_1', 'power', 1, new Vector(500, 500)),
                'power_2': createBuilding('power_2', 'power', 1, new Vector(600, 550)), // This one is close to ore!

                // Ore patch (now within BUILD_RADIUS of power_2)
                'ore_1': createResource('ore_1', new Vector(700, 600)),
                'ore_2': createResource('ore_2', new Vector(720, 580)),
                'ore_3': createResource('ore_3', new Vector(680, 620)),

                // Enemy conyard (to prevent weird state changes)
                'cy_p0': createBuilding('cy_p0', 'conyard', 0, new Vector(1600, 1600)),
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
                'cy_p1': createBuilding('cy_p1', 'conyard', 1, new Vector(350, 350)),
                'barracks_p1': createBuilding('barracks_p1', 'barracks', 1, new Vector(450, 350)),
                'factory_p1': createBuilding('factory_p1', 'factory', 1, new Vector(300, 450)),

                // Power plants reaching toward ore
                'power_1': createBuilding('power_1', 'power', 1, new Vector(500, 500)),
                'power_2': createBuilding('power_2', 'power', 1, new Vector(650, 600)), // Close to ore

                // Ore patch - within BUILD_RADIUS (400) of power_2
                'ore_1': createResource('ore_1', new Vector(800, 650)),
                'ore_2': createResource('ore_2', new Vector(820, 630)),
                'ore_3': createResource('ore_3', new Vector(780, 670)),

                // Enemy
                'cy_p0': createBuilding('cy_p0', 'conyard', 0, new Vector(1600, 1600)),
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
                'cy_p1': createBuilding('cy_p1', 'conyard', 1, new Vector(1600, 1600)),
                'barracks_p1': createBuilding('barracks_p1', 'barracks', 1, new Vector(1500, 1600)),
                'factory_p1': createBuilding('factory_p1', 'factory', 1, new Vector(1600, 1500)),

                // Power plants going toward ore (top-left direction)
                'power_1': createBuilding('power_1', 'power', 1, new Vector(1400, 1400)),
                'power_2': createBuilding('power_2', 'power', 1, new Vector(1200, 1200)),
                'power_3': createBuilding('power_3', 'power', 1, new Vector(1000, 1000)), // Already past ore

                // Ore patch - now behind the power_3 (between base and power_3)
                'ore_1': createResource('ore_1', new Vector(1150, 1150)),
                'ore_2': createResource('ore_2', new Vector(1130, 1170)),
                'ore_3': createResource('ore_3', new Vector(1170, 1130)),

                // Enemy
                'cy_p0': createBuilding('cy_p0', 'conyard', 0, new Vector(350, 350)),
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
                'cy_p1': createBuilding('cy_p1', 'conyard', 1, new Vector(350, 350)),
                'barracks_p1': createBuilding('barracks_p1', 'barracks', 1, new Vector(470, 300)),
                'factory_p1': createBuilding('factory_p1', 'factory', 1, new Vector(300, 470)),

                // Power plants forming a chain
                'power_1': createBuilding('power_1', 'power', 1, new Vector(469, 550)),
                'power_2': createBuilding('power_2', 'power', 1, new Vector(759, 460)),

                // Ore patch - within 400 units of power_2
                'ore_1': createResource('ore_1', new Vector(640, 584)),
                'ore_2': createResource('ore_2', new Vector(598, 558)),
                'ore_3': createResource('ore_3', new Vector(549, 582)),

                // Enemy
                'cy_p0': createBuilding('cy_p0', 'conyard', 0, new Vector(1650, 1650)),
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

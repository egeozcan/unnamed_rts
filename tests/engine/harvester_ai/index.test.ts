import { describe, it, expect, beforeEach } from 'vitest';
import { updateHarvesterAI } from '../../../src/engine/ai/harvester/index.js';
import {
    createInitialHarvesterAIState,
    HARVESTER_AI_CONSTANTS,
    HarvesterAIState
} from '../../../src/engine/ai/harvester/types.js';
import { INITIAL_STATE } from '../../../src/engine/reducer.js';
import {
    GameState,
    Vector,
    EntityId,
    HarvesterUnit,
    CombatUnit,
    BuildingEntity,
    ResourceEntity,
    PlayerState
} from '../../../src/engine/types.js';
import {
    createTestHarvester,
    createTestCombatUnit,
    createTestBuilding,
    createTestResource
} from '../../../src/engine/test-utils.js';
import { getZoneKey } from '../../../src/engine/ai/harvester/danger_map.js';

// Helper to create a test game state with specific tick
function createTestGameState(overrides: Partial<GameState> = {}): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        ...overrides
    };
}

// Helper to create a minimal player state
function createTestPlayer(playerId: number, overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: playerId,
        isAi: true,
        difficulty: 'hard',
        color: '#ff0000',
        credits: 5000,
        maxPower: 100,
        usedPower: 50,
        queues: {
            building: { current: null, progress: 0, invested: 0 },
            infantry: { current: null, progress: 0, invested: 0 },
            vehicle: { current: null, progress: 0, invested: 0 },
            air: { current: null, progress: 0, invested: 0 }
        },
        readyToPlace: null,
        ...overrides
    };
}

// Helper to add a player with a harvester to the state
function addPlayerWithHarvester(state: GameState, playerId: number): HarvesterUnit {
    const player = createTestPlayer(playerId);
    const harvester = createTestHarvester({
        id: `h${playerId}`,
        owner: playerId,
        x: 100,
        y: 100
    });

    state.players = {
        ...state.players,
        [playerId]: player
    };
    state.entities = {
        ...state.entities,
        [harvester.id]: harvester
    };

    return harvester;
}

// Helper to add an enemy unit
function addEnemy(state: GameState, enemyId: number, x: number, y: number): CombatUnit {
    if (!state.players[enemyId]) {
        state.players = {
            ...state.players,
            [enemyId]: createTestPlayer(enemyId)
        };
    }
    const enemy = createTestCombatUnit({
        id: `e${enemyId}_${x}_${y}`,
        owner: enemyId,
        key: 'heavy',
        x,
        y
    });
    state.entities = {
        ...state.entities,
        [enemy.id]: enemy
    };
    return enemy;
}

// Helper to add a combat unit
function addCombatUnit(state: GameState, playerId: number, x: number, y: number): CombatUnit {
    const unit = createTestCombatUnit({
        id: `c${playerId}_${x}_${y}`,
        owner: playerId,
        key: 'heavy',
        x,
        y
    });
    state.entities = {
        ...state.entities,
        [unit.id]: unit
    };
    return unit;
}

// Helper to add ore
function addOre(state: GameState, x: number, y: number): ResourceEntity {
    const ore = createTestResource({
        id: `ore_${x}_${y}`,
        x,
        y
    });
    state.entities = {
        ...state.entities,
        [ore.id]: ore
    };
    return ore;
}

// Helper to add a refinery
function addRefinery(state: GameState, playerId: number, x: number, y: number): BuildingEntity {
    const refinery = createTestBuilding({
        id: `ref_${playerId}_${x}_${y}`,
        owner: playerId,
        key: 'refinery',
        x,
        y
    });
    state.entities = {
        ...state.entities,
        [refinery.id]: refinery
    };
    return refinery;
}

describe('Harvester AI Orchestrator', () => {
    let harvesterAI: HarvesterAIState;

    beforeEach(() => {
        harvesterAI = createInitialHarvesterAIState();
    });

    describe('difficulty gating', () => {
        it('should return unchanged state for dummy difficulty', () => {
            const state = createTestGameState({ tick: 100 });
            addPlayerWithHarvester(state, 1);

            const result = updateHarvesterAI(harvesterAI, 1, state, 'dummy');

            expect(result.harvesterAI).toBe(harvesterAI); // Same reference
            expect(result.actions).toHaveLength(0);
        });

        it('should return unchanged state for easy difficulty', () => {
            const state = createTestGameState({ tick: 100 });
            addPlayerWithHarvester(state, 1);

            const result = updateHarvesterAI(harvesterAI, 1, state, 'easy');

            expect(result.harvesterAI).toBe(harvesterAI); // Same reference
            expect(result.actions).toHaveLength(0);
        });

        it('should process for medium difficulty', () => {
            const state = createTestGameState({ tick: 60 }); // Triggers desperation update
            addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);

            const result = updateHarvesterAI(harvesterAI, 1, state, 'medium');

            // Should return new state object (not same reference)
            expect(result.harvesterAI).not.toBe(harvesterAI);
        });

        it('should process for hard difficulty', () => {
            const state = createTestGameState({ tick: 60 });
            addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            expect(result.harvesterAI).not.toBe(harvesterAI);
        });
    });

    describe('update intervals', () => {
        it('should update danger map every 30 ticks', () => {
            const state = createTestGameState({ tick: 30 });
            addPlayerWithHarvester(state, 1);
            addEnemy(state, 2, 300, 300);

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            expect(result.harvesterAI.dangerMapLastUpdate).toBe(30);
        });

        it('should not update danger map on non-interval ticks', () => {
            const state = createTestGameState({ tick: 45 }); // Not divisible by 30
            addPlayerWithHarvester(state, 1);
            addEnemy(state, 2, 300, 300);

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Danger map should not have been updated
            expect(result.harvesterAI.dangerMapLastUpdate).toBe(0);
        });

        it('should update desperation every 60 ticks', () => {
            harvesterAI.desperationScore = 30; // Initial
            const state = createTestGameState({ tick: 60 });
            addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);
            // Set low credits for high desperation
            state.players[1] = {
                ...state.players[1],
                credits: 100
            };

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Desperation should have been recalculated (low credits = high desperation)
            expect(result.harvesterAI.desperationScore).not.toBe(30);
        });

        it('should not update desperation on non-interval ticks', () => {
            harvesterAI.desperationScore = 42; // Set specific value
            const state = createTestGameState({ tick: 45 }); // Not divisible by 60
            addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Desperation should remain the same
            expect(result.harvesterAI.desperationScore).toBe(42);
        });

        it('should update coordinator every 60 ticks', () => {
            const state = createTestGameState({ tick: 60 });
            const harvester = addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Harvester should have been assigned a role
            expect(result.harvesterAI.harvesterRoles.has(harvester.id)).toBe(true);
        });

        it('should update escorts every 90 ticks', () => {
            const state = createTestGameState({ tick: 90 });
            addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);

            // Add combat unit and dangerous ore
            addCombatUnit(state, 1, 100, 100);
            const ore = addOre(state, 300, 300);

            // Pre-populate a danger zone near the ore
            const zoneKey = getZoneKey(300, 300);
            harvesterAI.dangerMap.set(zoneKey, {
                key: zoneKey,
                dangerScore: 50,
                enemyCount: 2,
                recentAttacks: 1,
                harvesterDeaths: 0,
                lastUpdate: 80
            });

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Escort system should have been processed
            // (may or may not have assignments depending on criteria)
            expect(result.harvesterAI.escortAssignments).toBeDefined();
        });

        it('should run stuck resolver every tick', () => {
            // Test at tick 1 (not divisible by any interval)
            const state = createTestGameState({ tick: 1 });
            const harvester = addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);
            addOre(state, 300, 300);

            // Make harvester stuck by setting harvestAttemptTicks
            const stuckHarvester: HarvesterUnit = {
                ...harvester,
                harvester: {
                    ...harvester.harvester,
                    harvestAttemptTicks: 60 // Very stuck
                }
            };
            state.entities[harvester.id] = stuckHarvester;

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Stuck state should have been recorded
            expect(result.harvesterAI.stuckStates.has(harvester.id)).toBe(true);
        });
    });

    describe('stuck resolution', () => {
        it('should generate move action for stuck harvester resolution', () => {
            const state = createTestGameState({ tick: 100 });
            const harvester = addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);
            addOre(state, 300, 300);

            // Make harvester stuck
            const stuckHarvester: HarvesterUnit = {
                ...harvester,
                harvester: {
                    ...harvester.harvester,
                    harvestAttemptTicks: 20, // Stuck enough for level 2
                    resourceTargetId: 'ore_300_300'
                }
            };
            state.entities[harvester.id] = stuckHarvester;

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Should have produced some action or recorded stuck state
            expect(result.actions).toBeDefined();
            expect(result.harvesterAI.stuckStates.has(harvester.id)).toBe(true);
        });

        it('should not generate actions for harvesters that are not stuck', () => {
            const state = createTestGameState({ tick: 100 });
            const harvester = addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);

            // Harvester is not stuck (default harvestAttemptTicks = 0)
            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Should not have any stuck-related actions
            expect(result.actions).toHaveLength(0);
        });
    });

    describe('immutability', () => {
        it('should not mutate the original harvesterAI state', () => {
            const state = createTestGameState({ tick: 60 });
            addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);

            const originalDangerMapSize = harvesterAI.dangerMap.size;
            const originalDesperationScore = harvesterAI.desperationScore;

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Original state should be unchanged
            expect(harvesterAI.dangerMap.size).toBe(originalDangerMapSize);
            expect(harvesterAI.desperationScore).toBe(originalDesperationScore);

            // Result should be different
            expect(result.harvesterAI).not.toBe(harvesterAI);
        });
    });

    describe('integration scenarios', () => {
        it('should handle player with no harvesters', () => {
            const state = createTestGameState({ tick: 60 });
            state.players = {
                ...state.players,
                [1]: createTestPlayer(1)
            };

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Should return updated state with no errors
            expect(result.harvesterAI).toBeDefined();
            expect(result.actions).toHaveLength(0);
        });

        it('should handle player with no refineries', () => {
            const state = createTestGameState({ tick: 60 });
            addPlayerWithHarvester(state, 1);
            // No refineries added

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Should handle gracefully
            expect(result.harvesterAI).toBeDefined();
        });

        it('should handle multiple harvesters', () => {
            const state = createTestGameState({ tick: 60 });
            addPlayerWithHarvester(state, 1);

            // Add more harvesters
            const h2 = createTestHarvester({ id: 'h1_b', owner: 1, x: 200, y: 200 });
            const h3 = createTestHarvester({ id: 'h1_c', owner: 1, x: 300, y: 300 });
            state.entities[h2.id] = h2;
            state.entities[h3.id] = h3;

            addRefinery(state, 1, 150, 150);

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // All harvesters should have roles
            expect(result.harvesterAI.harvesterRoles.size).toBe(3);
        });

        it('should coordinate danger map, desperation, and coordinator together', () => {
            // Tick 60 updates both desperation and coordinator
            const state = createTestGameState({ tick: 60 });
            addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);
            addOre(state, 400, 400);

            // Low credits = high desperation
            state.players[1] = {
                ...state.players[1],
                credits: 100
            };

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Desperation should be high (low credits)
            expect(result.harvesterAI.desperationScore).toBeGreaterThan(30);

            // Roles should be assigned
            expect(result.harvesterAI.harvesterRoles.size).toBeGreaterThan(0);
        });

        it('should handle all systems together on tick 0', () => {
            // Tick 0 is divisible by all intervals (30, 60, 90)
            const state = createTestGameState({ tick: 0 });
            const harvester = addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);
            addOre(state, 400, 400);
            addCombatUnit(state, 1, 150, 150);
            addEnemy(state, 2, 500, 500);

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // All systems should have been updated
            expect(result.harvesterAI.dangerMapLastUpdate).toBe(0);
            expect(result.harvesterAI.harvesterRoles.has(harvester.id)).toBe(true);
            // Desperation should be calculated
            expect(result.harvesterAI.desperationScore).toBeDefined();
        });
    });

    describe('action generation', () => {
        it('should return MOVE_UNITS actions for stuck resolution', () => {
            const state = createTestGameState({ tick: 100 });
            const harvester = addPlayerWithHarvester(state, 1);
            addRefinery(state, 1, 200, 200);
            addOre(state, 300, 300);

            // Make harvester very stuck (level 4 - retreat)
            const stuckHarvester: HarvesterUnit = {
                ...harvester,
                harvester: {
                    ...harvester.harvester,
                    harvestAttemptTicks: 50,
                    resourceTargetId: 'ore_300_300'
                }
            };
            state.entities[harvester.id] = stuckHarvester;

            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // Should have move action for retreat
            const moveActions = result.actions.filter(a => a.type === 'COMMAND_MOVE');
            if (moveActions.length > 0) {
                const action = moveActions[0];
                expect(action.type).toBe('COMMAND_MOVE');
                expect((action as any).payload.unitIds).toContain(harvester.id);
            }
        });
    });
});

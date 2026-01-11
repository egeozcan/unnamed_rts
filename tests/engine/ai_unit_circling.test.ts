/**
 * Test for AI unit circling bug.
 *
 * Root cause: AI repeatedly issues COMMAND_MOVE to the same rally point,
 * causing formation positions to recalculate each tick. Combined with
 * collision avoidance, units circle trying to reach constantly-shifting targets.
 *
 * The fix: Skip units that already have a move target near the rally point.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE, update, createPlayerState } from '../../src/engine/reducer';
import { GameState, Vector, Entity, EntityId, UnitEntity } from '../../src/engine/types';
import { createTestCombatUnit, createTestBuilding } from '../../src/engine/test-utils';

const { getAIState } = _testUtils;

describe('AI Unit Circling Bug', () => {
    beforeEach(() => { resetAIState(); });

    it('should not re-issue move commands to units already heading to rally point', () => {
        // Setup: Create units that already have moveTarget set to rally point
        const rallyPoint = new Vector(800, 500); // Expected rally point (base + 300 toward map center)

        const entities: Record<EntityId, Entity> = {};

        // AI base at (500, 500)
        entities['conyard'] = createTestBuilding({ id: 'conyard', owner: 1, key: 'conyard', x: 500, y: 500 });
        entities['factory'] = createTestBuilding({ id: 'factory', owner: 1, key: 'factory', x: 600, y: 500 });

        // Create units ALREADY moving toward rally point (simulating previous command)
        for (let i = 0; i < 5; i++) {
            const unit = createTestCombatUnit({
                id: `unit${i}`,
                owner: 1,
                key: 'rifle',
                x: 650 + i * 20,
                y: 550
            });
            // Set moveTarget to the rally area (within 100 units of rally point)
            const offsetTarget = new Vector(rallyPoint.x + (Math.random() - 0.5) * 50, rallyPoint.y + (Math.random() - 0.5) * 50);
            entities[`unit${i}`] = {
                ...unit,
                movement: {
                    ...unit.movement,
                    moveTarget: offsetTarget
                }
            };
        }

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            tick: 31, // tick % 3 === 1 for player 1 AI
            entities,
            config: { ...INITIAL_STATE.config, width: 4000, height: 4000 }
        };

        // Ensure player exists
        state = {
            ...state,
            players: {
                ...state.players,
                [1]: {
                    ...createPlayerState(1, true, 'medium'),
                    credits: 5000
                }
            }
        };

        // Setup AI state for buildup (which triggers rally)
        const aiState = getAIState(1);
        aiState.strategy = 'buildup';

        // Run AI actions
        const actions = computeAiActions(state, 1);

        // Check for move commands to rally point
        const moveCommands = actions.filter(a => a.type === 'COMMAND_MOVE');

        // Key assertion: Units already moving to rally area should NOT receive new move commands
        // Find any move command that includes units that already had moveTarget set
        const unitsAlreadyMoving = ['unit0', 'unit1', 'unit2', 'unit3', 'unit4'];

        for (const cmd of moveCommands) {
            const reissuedUnits = cmd.payload.unitIds.filter((id: EntityId) => unitsAlreadyMoving.includes(id));
            // If fix is working, no units already moving to rally should be re-commanded
            expect(reissuedUnits.length).toBe(0);
        }
    });

    it('should issue commands to newly spawned idle units', () => {
        // Setup: Mix of units - some already moving, some idle
        const entities: Record<EntityId, Entity> = {};

        entities['conyard'] = createTestBuilding({ id: 'conyard', owner: 1, key: 'conyard', x: 500, y: 500 });
        entities['factory'] = createTestBuilding({ id: 'factory', owner: 1, key: 'factory', x: 600, y: 500 });

        // Unit already moving to rally (should NOT be re-commanded)
        const movingUnit = createTestCombatUnit({
            id: 'moving_unit',
            owner: 1,
            key: 'rifle',
            x: 650,
            y: 550
        });
        entities['moving_unit'] = {
            ...movingUnit,
            movement: {
                ...movingUnit.movement,
                moveTarget: new Vector(800, 500) // Already heading to rally
            }
        };

        // Newly spawned idle unit far from rally (SHOULD be commanded)
        const idleUnit = createTestCombatUnit({
            id: 'idle_unit',
            owner: 1,
            key: 'rifle',
            x: 600,
            y: 560
        });
        entities['idle_unit'] = idleUnit; // No moveTarget

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            tick: 31,
            entities,
            config: { ...INITIAL_STATE.config, width: 4000, height: 4000 }
        };

        state = {
            ...state,
            players: {
                ...state.players,
                [1]: {
                    ...createPlayerState(1, true, 'medium'),
                    credits: 5000
                }
            }
        };

        const aiState = getAIState(1);
        aiState.strategy = 'buildup';

        const actions = computeAiActions(state, 1);

        // Find move commands
        const moveCommands = actions.filter(a => a.type === 'COMMAND_MOVE');

        // The idle unit should receive a command (it has no moveTarget)
        const idleUnitCommanded = moveCommands.some(cmd =>
            cmd.payload.unitIds.includes('idle_unit')
        );

        // The moving unit should NOT receive a command (already heading to rally)
        const movingUnitRecommanded = moveCommands.some(cmd =>
            cmd.payload.unitIds.includes('moving_unit')
        );

        expect(idleUnitCommanded).toBe(true);
        expect(movingUnitRecommanded).toBe(false);
    });

    it('should not cause circling when many units cluster at rally point', () => {
        // Simulation test: Many units at same position, run multiple ticks
        // Without fix: Units get repeated commands causing formation recalc → circling
        // With fix: Units stop receiving commands once near destination → no circling

        const entities: Record<EntityId, Entity> = {};

        entities['conyard'] = createTestBuilding({ id: 'conyard', owner: 1, key: 'conyard', x: 500, y: 500 });
        entities['factory'] = createTestBuilding({ id: 'factory', owner: 1, key: 'factory', x: 600, y: 500 });

        // 10 units clustered at rally point
        for (let i = 0; i < 10; i++) {
            const unit = createTestCombatUnit({
                id: `unit${i}`,
                owner: 1,
                key: 'rifle',
                x: 800 + (Math.random() - 0.5) * 30,
                y: 500 + (Math.random() - 0.5) * 30
            });
            entities[`unit${i}`] = unit;
        }

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            tick: 31,
            entities,
            config: { ...INITIAL_STATE.config, width: 4000, height: 4000 }
        };

        state = {
            ...state,
            players: {
                ...state.players,
                [1]: {
                    ...createPlayerState(1, true, 'medium'),
                    credits: 5000
                }
            }
        };

        const aiState = getAIState(1);
        aiState.strategy = 'buildup';

        // Run multiple AI ticks and count move commands
        let totalMoveCommands = 0;
        let totalUnitsCommanded = 0;

        for (let tick = 0; tick < 10; tick++) {
            // Simulate AI tick
            state = { ...state, tick: 31 + tick * 3 }; // AI runs every 3 ticks for player 1
            const actions = computeAiActions(state, 1);

            const moveCommands = actions.filter(a => a.type === 'COMMAND_MOVE');
            totalMoveCommands += moveCommands.length;
            for (const cmd of moveCommands) {
                totalUnitsCommanded += cmd.payload.unitIds.length;
            }

            // Apply move targets to units (simulate reducer)
            for (const action of moveCommands) {
                for (const unitId of action.payload.unitIds) {
                    const entity = state.entities[unitId];
                    if (entity && entity.type === 'UNIT') {
                        const unit = entity as UnitEntity;
                        const nextEntities = { ...state.entities };
                        nextEntities[unitId] = {
                            ...unit,
                            movement: {
                                ...unit.movement,
                                moveTarget: new Vector(action.payload.x, action.payload.y)
                            }
                        } as UnitEntity;
                        state = { ...state, entities: nextEntities };
                    }
                }
            }
        }

        // With the fix: After the first tick, units should stop receiving commands
        // because they already have moveTarget set to rally area
        // Without fix: Every tick would command all 10 units = 100 total
        // With fix: First tick commands idle units, subsequent ticks command 0 = ~10 total
        expect(totalUnitsCommanded).toBeLessThan(30); // Should be much less than 100
    });
});

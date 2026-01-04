import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update, createPlayerState } from '../../src/engine/reducer.js';
import { GameState, Vector, UnitEntity, HarvesterUnit } from '../../src/engine/types.js';
import { createTestCombatUnit, createTestBuilding, createTestHarvester, createTestResource } from '../../src/engine/test-utils.js';

describe('Unit Control', () => {
    // Helper to create a minimal game state
    function createTestState(): GameState {
        return {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            config: { width: 2000, height: 2000, resourceDensity: 'medium', rockDensity: 'medium' },
            players: {
                0: createPlayerState(0, false, 'medium'),
                1: createPlayerState(1, true, 'medium')
            },
            entities: {}
        };
    }

    // Helper to create units
    function createUnit(id: string, owner: number, pos: Vector, key: string = 'light') {
        return createTestCombatUnit({ id, owner, key: key as Exclude<import('../../src/engine/types').UnitKey, 'harvester'>, x: pos.x, y: pos.y });
    }

    // Helper to create a building (needed to prevent game from ending due to win condition)
    function createBuilding(id: string, owner: number, pos: Vector, key: string = 'conyard') {
        return createTestBuilding({ id, owner, key: key as import('../../src/engine/types').BuildingKey, x: pos.x, y: pos.y });
    }

    describe('Pulling back auto-attacking units', () => {
        it('should allow a unit to be pulled back while auto-attacking', () => {
            let state = createTestState();

            // Create a friendly tank and an enemy tank nearby (within auto-attack range)
            // Also create buildings for both players to prevent win condition
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'cy0': createBuilding('cy0', 0, new Vector(100, 500)),
                    'cy1': createBuilding('cy1', 1, new Vector(900, 500)),
                    'tank1': createUnit('tank1', 0, new Vector(500, 500), 'light'),
                    'enemy1': createUnit('enemy1', 1, new Vector(550, 500), 'light')
                }
            };

            // Let the unit auto-acquire the target
            state = update(state, { type: 'TICK' });

            // Tank should have acquired enemy as target
            expect((state.entities['tank1'] as UnitEntity).combat.targetId).toBe('enemy1');

            // Player issues a move command to pull back
            state = update(state, {
                type: 'COMMAND_MOVE',
                payload: { unitIds: ['tank1'], x: 200, y: 500 }
            });

            // Unit should now be moving away, not attacking
            expect((state.entities['tank1'] as UnitEntity).movement.moveTarget).not.toBeNull();
            expect((state.entities['tank1'] as UnitEntity).combat.targetId).toBeNull();

            // Run several ticks - the unit should continue moving away
            // even though enemy is still in range
            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Unit should NOT have re-acquired the target while it has a moveTarget
            const tank = state.entities['tank1'] as UnitEntity;
            expect(tank.movement.moveTarget).not.toBeNull();
            expect(tank.combat.targetId).toBeNull();

            // Unit should be moving toward the move target (200, 500), not toward enemy
            expect(tank.pos.x).toBeLessThan(500);
        });

        it('should resume auto-attack after reaching move destination', () => {
            let state = createTestState();

            // Create a friendly tank and an enemy tank nearby
            // Also create buildings for both players to prevent win condition
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'cy0': createBuilding('cy0', 0, new Vector(100, 500)),
                    'cy1': createBuilding('cy1', 1, new Vector(900, 500)),
                    'tank1': createUnit('tank1', 0, new Vector(500, 500), 'light'),
                    'enemy1': createUnit('enemy1', 1, new Vector(520, 500), 'light')
                }
            };

            // Issue a move command to a nearby location
            state = update(state, {
                type: 'COMMAND_MOVE',
                payload: { unitIds: ['tank1'], x: 490, y: 500 } // Very close move
            });

            expect((state.entities['tank1'] as UnitEntity).movement.moveTarget).not.toBeNull();

            // Run ticks until unit reaches destination
            for (let i = 0; i < 20; i++) {
                state = update(state, { type: 'TICK' });
            }

            // After reaching destination, moveTarget should be cleared
            // and if enemy is in range, unit should auto-acquire target
            const tank = state.entities['tank1'] as UnitEntity;
            expect(tank.movement.moveTarget).toBeNull();
            expect(tank.combat.targetId).toBe('enemy1');
        });
    });

    describe('Harvester manual control', () => {
        function createHarvester(id: string, owner: number, pos: Vector, cargo: number = 0) {
            return createTestHarvester({ id, owner, x: pos.x, y: pos.y, cargo });
        }

        function createRefinery(id: string, owner: number, pos: Vector) {
            return createTestBuilding({ id, owner, key: 'refinery', x: pos.x, y: pos.y });
        }

        function createOre(id: string, pos: Vector) {
            return createTestResource({ id, x: pos.x, y: pos.y });
        }

        it('freshly spawned harvester should not auto-move to ore', () => {
            let state = createTestState();

            // Create harvester and nearby ore
            // Also include buildings for both players to prevent win condition
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'cy0': createBuilding('cy0', 0, new Vector(100, 500)),
                    'cy1': createBuilding('cy1', 1, new Vector(900, 500)),
                    'harv1': createHarvester('harv1', 0, new Vector(500, 500), 0),
                    'ore1': createOre('ore1', new Vector(600, 500))
                }
            };

            // Save initial position
            const initialPos = state.entities['harv1'].pos;

            // Run several ticks
            for (let i = 0; i < 30; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Harvester should NOT have moved toward the ore automatically
            const harv = state.entities['harv1'] as HarvesterUnit;
            expect(harv.harvester.resourceTargetId).toBeNull();
            // Position should be roughly the same (small movement due to collision is ok)
            expect(harv.pos.dist(initialPos)).toBeLessThan(30);
        });

        it('harvester should start auto-harvesting after right-clicking ore', () => {
            let state = createTestState();

            // Create harvester and ore
            // Also include buildings for both players to prevent win condition
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'cy0': createBuilding('cy0', 0, new Vector(100, 500)),
                    'cy1': createBuilding('cy1', 1, new Vector(900, 500)),
                    'harv1': createHarvester('harv1', 0, new Vector(500, 500), 0),
                    'ore1': createOre('ore1', new Vector(600, 500)),
                    'ref1': createRefinery('ref1', 0, new Vector(300, 500))
                }
            };

            // Select harvester and right-click on ore (COMMAND_ATTACK on resource)
            state = { ...state, selection: ['harv1'] };
            state = update(state, {
                type: 'COMMAND_ATTACK',
                payload: { unitIds: ['harv1'], targetId: 'ore1' }
            });

            // Run ticks to let harvester gather and return
            for (let i = 0; i < 200; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Harvester should have acquired ore and started harvesting
            // After harvesting, it should auto-return to refinery
            const harv = state.entities['harv1'] as HarvesterUnit;
            // Either harvesting or returning to base (has cargo and baseTargetId)
            expect(harv.harvester.cargo > 0 || harv.harvester.resourceTargetId !== null || harv.harvester.baseTargetId !== null).toBe(true);
        });

        it('harvester should start auto-harvesting after right-clicking refinery', () => {
            let state = createTestState();

            // Create harvester with full cargo, refinery, and ore
            // Also include buildings for both players to prevent win condition
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'cy0': createBuilding('cy0', 0, new Vector(100, 500)),
                    'cy1': createBuilding('cy1', 1, new Vector(900, 500)),
                    'harv1': createHarvester('harv1', 0, new Vector(500, 500), 500),
                    'ref1': createRefinery('ref1', 0, new Vector(400, 500)),
                    'ore1': createOre('ore1', new Vector(600, 500))
                }
            };

            // Set harvester to NOT be in auto mode (simulating fresh spawn or pulled back)
            const harvEnt = state.entities['harv1'] as HarvesterUnit;
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'harv1': {
                        ...harvEnt,
                        harvester: {
                            ...harvEnt.harvester,
                            manualMode: true,
                            baseTargetId: null
                        }
                    }
                },
                selection: ['harv1']
            };
            // This should task the harvester to the refinery and enable auto mode
            state = update(state, {
                type: 'COMMAND_ATTACK',
                payload: { unitIds: ['harv1'], targetId: 'ref1' }
            });

            // Run ticks
            for (let i = 0; i < 100; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Harvester should have unloaded and then auto-acquired ore
            const harv = state.entities['harv1'] as HarvesterUnit;
            // Check that manualMode is false (auto-harvesting enabled)
            expect(harv.harvester.manualMode).toBe(false);
            // After right-clicking refinery, harvester should either:
            // - Have unloaded cargo and acquired ore (cargo=0, resourceTargetId set)
            // - Still be in the process of docking/unloading (cargo>0, baseTargetId set)
            // The key test is that it's NOT sitting idle in manual mode
            const isAutoHarvesting = harv.harvester.resourceTargetId !== null || harv.harvester.baseTargetId !== null || harv.harvester.cargo > 0;
            expect(isAutoHarvesting).toBe(true);
        });

        it('harvester should stay still after being pulled back with move command', () => {
            let state = createTestState();

            // Create harvester that was auto-harvesting
            // Also include buildings for both players to prevent win condition
            const baseHarv = createHarvester('harv1', 0, new Vector(500, 500), 100);
            const harv1 = {
                ...baseHarv,
                harvester: { ...baseHarv.harvester, resourceTargetId: 'ore1' }
            } as HarvesterUnit;
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'cy0': createBuilding('cy0', 0, new Vector(100, 500)),
                    'cy1': createBuilding('cy1', 1, new Vector(900, 500)),
                    'harv1': harv1,
                    'ore1': createOre('ore1', new Vector(600, 500)),
                    'ref1': createRefinery('ref1', 0, new Vector(300, 500))
                }
            };

            // Player issues a move command to pull back the harvester
            state = update(state, {
                type: 'COMMAND_MOVE',
                payload: { unitIds: ['harv1'], x: 400, y: 500 }
            });

            // Run ticks until it reaches destination
            for (let i = 0; i < 50; i++) {
                state = update(state, { type: 'TICK' });
            }

            // After reaching destination, harvester should NOT auto-acquire new ore
            const harv = state.entities['harv1'] as HarvesterUnit;
            expect(harv.movement.moveTarget).toBeNull();
            expect(harv.harvester.resourceTargetId).toBeNull();
            expect(harv.harvester.baseTargetId).toBeNull();
        });
    });
});

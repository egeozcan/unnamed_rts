import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update, createPlayerState } from '../../src/engine/reducer.js';
import { GameState, Vector, UnitEntity, CombatUnit } from '../../src/engine/types.js';
import { createTestCombatUnit, createTestBuilding } from '../../src/engine/test-utils.js';

describe('Collision Resolution - Unit Shaking', () => {
    // Helper to create a minimal game state
    function createTestState(): GameState {
        return {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
            players: {
                0: createPlayerState(0, false, 'medium'),
                1: createPlayerState(1, true, 'medium')
            },
            entities: {}
        };
    }

    function createUnit(id: string, owner: number, pos: Vector, key: string = 'rocket') {
        return createTestCombatUnit({
            id,
            owner,
            key: key as Exclude<import('../../src/engine/types').UnitKey, 'harvester'>,
            x: pos.x,
            y: pos.y
        });
    }

    function createBuilding(id: string, owner: number, pos: Vector, key: string = 'conyard') {
        return createTestBuilding({
            id,
            owner,
            key: key as import('../../src/engine/types').BuildingKey,
            x: pos.x,
            y: pos.y
        });
    }

    describe('Multiple units attacking same target', () => {
        it('should not cause excessive position oscillation when units converge on a target', () => {
            let state = createTestState();

            // Create a target (enemy heavy tank) and multiple attacking units
            // This simulates the scenario from the bug report
            state = {
                ...state,
                entities: {
                    'cy0': createBuilding('cy0', 0, new Vector(100, 100)),
                    'cy1': createBuilding('cy1', 1, new Vector(2900, 2900)),
                    // Enemy heavy tank at center
                    'target': createUnit('target', 1, new Vector(1500, 1500), 'heavy'),
                    // Multiple friendly units attacking the same target
                    'attacker1': createUnit('attacker1', 0, new Vector(1450, 1450), 'rocket'),
                    'attacker2': createUnit('attacker2', 0, new Vector(1550, 1450), 'rocket'),
                    'attacker3': createUnit('attacker3', 0, new Vector(1450, 1550), 'rocket'),
                    'attacker4': createUnit('attacker4', 0, new Vector(1550, 1550), 'rocket'),
                    'attacker5': createUnit('attacker5', 0, new Vector(1500, 1420), 'rocket'),
                    'attacker6': createUnit('attacker6', 0, new Vector(1500, 1580), 'rocket')
                }
            };

            // Command all attackers to attack the target
            state = update(state, {
                type: 'COMMAND_ATTACK',
                payload: {
                    unitIds: ['attacker1', 'attacker2', 'attacker3', 'attacker4', 'attacker5', 'attacker6'],
                    targetId: 'target'
                }
            });

            // Run several ticks to let units converge
            for (let i = 0; i < 60; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Now measure position stability over the next 30 ticks
            // Units should be mostly stable, not oscillating wildly
            const positionHistory: Record<string, Vector[]> = {};
            const attackerIds = ['attacker1', 'attacker2', 'attacker3', 'attacker4', 'attacker5', 'attacker6'];

            for (const id of attackerIds) {
                positionHistory[id] = [];
            }

            // Record positions for 30 ticks
            for (let i = 0; i < 30; i++) {
                for (const id of attackerIds) {
                    const unit = state.entities[id];
                    if (unit) {
                        positionHistory[id].push(unit.pos);
                    }
                }
                state = update(state, { type: 'TICK' });
            }

            // Calculate oscillation for each unit
            // Oscillation is detected by checking if the unit frequently changes direction
            for (const id of attackerIds) {
                const positions = positionHistory[id];
                if (positions.length < 3) continue;

                let directionChanges = 0;
                let totalMovement = 0;

                for (let i = 2; i < positions.length; i++) {
                    const prev = positions[i - 1].sub(positions[i - 2]);
                    const curr = positions[i].sub(positions[i - 1]);

                    totalMovement += curr.mag();

                    // Check if direction changed significantly (dot product negative = opposite direction)
                    const dot = prev.x * curr.x + prev.y * curr.y;
                    const prevMag = prev.mag();
                    const currMag = curr.mag();

                    // Only count as direction change if both movements are significant
                    if (prevMag > 0.5 && currMag > 0.5 && dot < 0) {
                        directionChanges++;
                    }
                }

                // A unit should not change direction more than ~30% of the time
                // (some direction changes are normal when navigating)
                const changeRatio = directionChanges / (positions.length - 2);
                expect(changeRatio).toBeLessThan(0.4);
            }
        });

        it('should treat units in attack range as stationary for collision purposes', () => {
            let state = createTestState();

            // Create two friendly units very close together, both attacking the same target
            // They should not push each other aggressively when both are in attack range
            state = {
                ...state,
                entities: {
                    'cy0': createBuilding('cy0', 0, new Vector(100, 100)),
                    'cy1': createBuilding('cy1', 1, new Vector(2900, 2900)),
                    // Enemy at a distance
                    'target': createUnit('target', 1, new Vector(1500, 1500), 'heavy'),
                    // Two friendly units close together
                    'unit1': createUnit('unit1', 0, new Vector(1450, 1500), 'rocket'),
                    'unit2': createUnit('unit2', 0, new Vector(1460, 1500), 'rocket')
                }
            };

            // Set up units with targetId but low avgVel (simulating stationary attacking)
            // Manually set their state to simulate being in attack position
            const unit1 = state.entities['unit1'] as CombatUnit;
            const unit2 = state.entities['unit2'] as CombatUnit;

            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'unit1': {
                        ...unit1,
                        combat: { ...unit1.combat, targetId: 'target' },
                        movement: {
                            ...unit1.movement,
                            moveTarget: null,
                            path: null,
                            avgVel: { x: 0.1, y: 0.1 } // Low velocity - unit is mostly stationary
                        }
                    } as CombatUnit,
                    'unit2': {
                        ...unit2,
                        combat: { ...unit2.combat, targetId: 'target' },
                        movement: {
                            ...unit2.movement,
                            moveTarget: null,
                            path: null,
                            avgVel: { x: -0.1, y: 0.1 } // Low velocity - unit is mostly stationary
                        }
                    } as CombatUnit
                }
            };

            // Record initial positions
            const initialPos1 = state.entities['unit1'].pos;
            const initialPos2 = state.entities['unit2'].pos;

            // Run 10 ticks
            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Units should not have moved dramatically (only gentle collision push)
            const finalPos1 = state.entities['unit1'].pos;
            const finalPos2 = state.entities['unit2'].pos;

            // Movement should be minimal (less than 30 units over 10 ticks)
            expect(initialPos1.dist(finalPos1)).toBeLessThan(30);
            expect(initialPos2.dist(finalPos2)).toBeLessThan(30);
        });

        it('should allow moving units to push through stationary units', () => {
            let state = createTestState();

            // Create a stationary unit and a moving unit
            state = {
                ...state,
                entities: {
                    'cy0': createBuilding('cy0', 0, new Vector(100, 100)),
                    'cy1': createBuilding('cy1', 1, new Vector(2900, 2900)),
                    // Stationary unit (no target, no move command)
                    'stationary': createUnit('stationary', 0, new Vector(1500, 1500), 'rocket'),
                    // Moving unit that needs to pass by
                    'moving': createUnit('moving', 0, new Vector(1500, 1400), 'light')
                }
            };

            // Command the moving unit to go past the stationary one
            state = update(state, {
                type: 'COMMAND_MOVE',
                payload: { unitIds: ['moving'], x: 1500, y: 1600 }
            });

            const initialMovingPos = state.entities['moving'].pos;

            // Run 60 ticks
            for (let i = 0; i < 60; i++) {
                state = update(state, { type: 'TICK' });
            }

            // The moving unit should have made progress toward its destination
            const finalMovingPos = state.entities['moving'].pos;
            expect(finalMovingPos.y).toBeGreaterThan(initialMovingPos.y + 50);

            // The stationary unit should not have moved much
            const stationaryPos = state.entities['stationary'].pos;
            expect(stationaryPos.dist(new Vector(1500, 1500))).toBeLessThan(40);
        });
    });

    describe('Collision resolution moving detection', () => {
        it('should not consider units with only targetId as moving', () => {
            let state = createTestState();

            // Create units that have targetId but are in attack range (stationary)
            state = {
                ...state,
                entities: {
                    'cy0': createBuilding('cy0', 0, new Vector(100, 100)),
                    'cy1': createBuilding('cy1', 1, new Vector(2900, 2900)),
                    'target': createUnit('target', 1, new Vector(1500, 1500), 'heavy'),
                    'attacker': createUnit('attacker', 0, new Vector(1450, 1500), 'rocket')
                }
            };

            // Set attacker to have targetId but no moveTarget (in attack range)
            const attacker = state.entities['attacker'] as CombatUnit;
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'attacker': {
                        ...attacker,
                        combat: { ...attacker.combat, targetId: 'target' },
                        movement: {
                            ...attacker.movement,
                            moveTarget: null,
                            path: null,
                            finalDest: new Vector(1500, 1500),
                            avgVel: { x: 0, y: 0 }
                        }
                    } as CombatUnit
                }
            };

            const initialPos = state.entities['attacker'].pos;

            // Run ticks - unit should be stable since it's "stationary" (in attack range)
            for (let i = 0; i < 20; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Position should be very stable (only minor collision adjustments)
            const finalPos = state.entities['attacker'].pos;
            expect(initialPos.dist(finalPos)).toBeLessThan(20);
        });

        it('should consider units with active path and high avgVel as moving', () => {
            let state = createTestState();

            // Create a unit that is actively moving (has path and velocity)
            state = {
                ...state,
                entities: {
                    'cy0': createBuilding('cy0', 0, new Vector(100, 100)),
                    'cy1': createBuilding('cy1', 1, new Vector(2900, 2900)),
                    'blocker': createUnit('blocker', 0, new Vector(1500, 1500), 'heavy'),
                    'mover': createUnit('mover', 0, new Vector(1400, 1500), 'light')
                }
            };

            // Command mover to move past blocker
            state = update(state, {
                type: 'COMMAND_MOVE',
                payload: { unitIds: ['mover'], x: 1600, y: 1500 }
            });

            // Run a few ticks to build up avgVel
            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            const mover = state.entities['mover'] as CombatUnit;

            // Mover should have significant avgVel (actively moving)
            const avgVelMag = Math.sqrt(
                mover.movement.avgVel.x ** 2 + mover.movement.avgVel.y ** 2
            );
            expect(avgVelMag).toBeGreaterThan(0.5);

            // Mover should have an active path
            expect(mover.movement.moveTarget !== null ||
                   (mover.movement.path !== null && mover.movement.pathIdx < mover.movement.path.length)
            ).toBe(true);
        });
    });
});

import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update, createPlayerState } from './reducer.js';
import { GameState, Vector, Entity } from './types.js';

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
    function createUnit(id: string, owner: number, pos: Vector, key: string = 'light'): Entity {
        return {
            id,
            owner,
            type: 'UNIT',
            key,
            pos,
            prevPos: pos,
            hp: 500,
            maxHp: 500,
            w: 30,
            h: 30,
            radius: 15,
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
        } as Entity;
    }

    // Helper to create a building (needed to prevent game from ending due to win condition)
    function createBuilding(id: string, owner: number, pos: Vector, key: string = 'conyard'): Entity {
        return {
            id,
            owner,
            type: 'BUILDING',
            key,
            pos,
            prevPos: pos,
            hp: 3000,
            maxHp: 3000,
            w: 90,
            h: 90,
            radius: 45,
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
        } as Entity;
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
            expect(state.entities['tank1'].targetId).toBe('enemy1');

            // Player issues a move command to pull back
            state = update(state, {
                type: 'COMMAND_MOVE',
                payload: { unitIds: ['tank1'], x: 200, y: 500 }
            });

            // Unit should now be moving away, not attacking
            expect(state.entities['tank1'].moveTarget).not.toBeNull();
            expect(state.entities['tank1'].targetId).toBeNull();

            // Run several ticks - the unit should continue moving away
            // even though enemy is still in range
            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Unit should NOT have re-acquired the target while it has a moveTarget
            const tank = state.entities['tank1'];
            expect(tank.moveTarget).not.toBeNull();
            expect(tank.targetId).toBeNull();

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

            expect(state.entities['tank1'].moveTarget).not.toBeNull();

            // Run ticks until unit reaches destination
            for (let i = 0; i < 20; i++) {
                state = update(state, { type: 'TICK' });
            }

            // After reaching destination, moveTarget should be cleared
            // and if enemy is in range, unit should auto-acquire target
            const tank = state.entities['tank1'];
            expect(tank.moveTarget).toBeNull();
            expect(tank.targetId).toBe('enemy1');
        });
    });

    describe('Harvester manual control', () => {
        function createHarvester(id: string, owner: number, pos: Vector, cargo: number = 0): Entity {
            return {
                ...createUnit(id, owner, pos, 'harvester'),
                cargo,
                hp: 1000,
                maxHp: 1000
            } as Entity;
        }

        function createRefinery(id: string, owner: number, pos: Vector): Entity {
            return {
                id,
                owner,
                type: 'BUILDING',
                key: 'refinery',
                pos,
                prevPos: pos,
                hp: 2000,
                maxHp: 2000,
                w: 90,
                h: 90,
                radius: 45,
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
            } as Entity;
        }

        function createOre(id: string, pos: Vector): Entity {
            return {
                id,
                owner: -1,
                type: 'RESOURCE',
                key: 'ore',
                pos,
                prevPos: pos,
                hp: 1000,
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
            } as Entity;
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
            const harv = state.entities['harv1'];
            expect(harv.resourceTargetId).toBeNull();
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
            const harv = state.entities['harv1'];
            // Either harvesting or returning to base (has cargo and baseTargetId)
            expect(harv.cargo > 0 || harv.resourceTargetId !== null || harv.baseTargetId !== null).toBe(true);
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
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'harv1': {
                        ...state.entities['harv1'],
                        manualMode: true,
                        baseTargetId: null
                    } as Entity
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
            const harv = state.entities['harv1'];
            // Check that manualMode is false (auto-harvesting enabled)
            expect((harv as any).manualMode).toBe(false);
            // After right-clicking refinery, harvester should either:
            // - Have unloaded cargo and acquired ore (cargo=0, resourceTargetId set)
            // - Still be in the process of docking/unloading (cargo>0, baseTargetId set)
            // The key test is that it's NOT sitting idle in manual mode
            const isAutoHarvesting = harv.resourceTargetId !== null || harv.baseTargetId !== null || harv.cargo > 0;
            expect(isAutoHarvesting).toBe(true);
        });

        it('harvester should stay still after being pulled back with move command', () => {
            let state = createTestState();

            // Create harvester that was auto-harvesting
            // Also include buildings for both players to prevent win condition
            const harv1 = createHarvester('harv1', 0, new Vector(500, 500), 100);
            (harv1 as any).resourceTargetId = 'ore1';
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
            const harv = state.entities['harv1'];
            expect(harv.moveTarget).toBeNull();
            expect(harv.resourceTargetId).toBeNull();
            expect(harv.baseTargetId).toBeNull();
        });
    });
});

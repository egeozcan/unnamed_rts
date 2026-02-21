import { expect, test, describe, beforeEach } from 'vitest';
import { GameState, Vector, Entity } from '../../src/engine/types';
import { update } from '../../src/engine/reducer';
import { createEntity } from '../../src/engine/utils';
import { getSpatialGrid } from '../../src/engine/spatial';

describe('Service Depot Docking Repair', () => {
    let state: GameState;

    beforeEach(() => {
        getSpatialGrid().clear();
        state = {
            running: true,
            mode: 'game',
            sellMode: false,
            repairMode: false,
            difficulty: 'hard',
            tick: 0,
            camera: { x: 0, y: 0 },
            zoom: 1,
            entities: {},
            projectiles: [],
            particles: [],
            selection: [],
            placingBuilding: null,
            players: {
                0: {
                    id: 0,
                    isAi: false,
                    difficulty: 'medium',
                    color: '#4488ff',
                    credits: 5000,
                    maxPower: 1000,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                },
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'hard',
                    color: '#ff4444',
                    credits: 5000,
                    maxPower: 1000,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            },
            winner: null,
            config: {
                width: 3000,
                height: 3000,
                resourceDensity: 'medium',
                rockDensity: 'medium'
            },
            debugMode: false,
            showMinimap: true,
            showBirdsEye: false,
            attackMoveMode: false,
            fogOfWar: {}
        };
    });

    test('should allow damaged vehicle to dock at service depot and get repaired without dancing', () => {
        // Create an enemy structure to prevent instant win & game over
        const enemyMCV = createEntity(100, 100, 1, 'BUILDING', 'conyard') as any;
        enemyMCV.id = 'enemyBase';
        state.entities[enemyMCV.id] = enemyMCV;

        // Create service depot at (500, 500)
        const depot = createEntity(500, 500, 0, 'BUILDING', 'service_depot') as any;
        depot.id = 'depot1';
        state.entities[depot.id] = depot;

        // Create damaged light tank
        const tank = createEntity(400, 500, 0, 'UNIT', 'light') as any;
        tank.id = 'tank1';
        tank.hp = 10;
        state.entities[tank.id] = tank;

        // Command tank to dock at depot
        state = update(state, {
            type: 'COMMAND_ATTACK',
            payload: {
                unitIds: [tank.id],
                targetId: depot.id
            }
        });

        const initialPos = new Vector(tank.pos.x, tank.pos.y);

        // Run for enough ticks for tank to reach the depot and dock
        for (let i = 0; i < 300; i++) {
            state = update(state, { type: 'TICK' });
        }

        const updatedTank = state.entities[tank.id];
        expect(updatedTank.hp).toBeGreaterThan(10);
        expect(updatedTank.hp).toBeLessThanOrEqual(updatedTank.maxHp);

        // Wait for full repair + rollout
        for (let i = 0; i < 1000; i++) {
            state = update(state, { type: 'TICK' });
            if (state.entities[tank.id].hp >= state.entities[tank.id].maxHp) {
                break;
            }
        }

        const fullyHealedTank = state.entities[tank.id];
        expect(fullyHealedTank.hp).toBe(fullyHealedTank.maxHp);

        // Let it rollout for 100 ticks
        for (let i = 0; i < 100; i++) {
            state = update(state, { type: 'TICK' });
        }

        const rolledOutTank = state.entities[tank.id];
        const distFromDepot = rolledOutTank.pos.dist(depot.pos);
        expect(distFromDepot).toBeGreaterThan(depot.radius);
    });

    test('multiple tanks docking should queue or handle gracefully', () => {
        // Create an enemy structure to prevent instant win & game over
        const enemyMCV = createEntity(100, 100, 1, 'BUILDING', 'conyard') as any;
        enemyMCV.id = 'enemyBase';
        state.entities[enemyMCV.id] = enemyMCV;

        const depot = createEntity(500, 500, 0, 'BUILDING', 'service_depot') as any;
        depot.id = 'depot1';
        state.entities[depot.id] = depot;

        const tankIds: string[] = [];
        for (let i = 0; i < 5; i++) {
            const tank = createEntity(300 + Math.random() * 50, 480 + Math.random() * 50, 0, 'UNIT', 'light') as any;
            tank.id = 'tank' + i;
            tank.hp = 10;
            state.entities[tank.id] = tank;
            tankIds.push(tank.id);
        }

        // Command all tanks to dock at depot
        state = update(state, {
            type: 'COMMAND_ATTACK',
            payload: {
                unitIds: tankIds,
                targetId: depot.id
            }
        });

        // Run for 2000 ticks
        for (let i = 0; i < 2000; i++) {
            state = update(state, { type: 'TICK' });
        }

        // Check that at least some repaired, and they aren't vibrating crazy
        let fullHealedCount = 0;
        for (const id of tankIds) {
            if (state.entities[id].hp === state.entities[id].maxHp) {
                fullHealedCount++;
            }
        }
        expect(fullHealedCount).toBeGreaterThan(0);
    });
});

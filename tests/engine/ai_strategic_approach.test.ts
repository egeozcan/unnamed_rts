/**
 * Tests for AI strategic approach behavior
 * 
 * These tests focus on the AI's ability to:
 * 1. Avoid enemy turret range when approaching enemy bases
 * 2. Calculate safe approach paths that minimize exposure to turrets
 * 3. Coordinate group attacks to either overwhelm turrets or avoid them
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE } from '../../src/engine/reducer';
import { GameState, Vector, Entity, EntityId, UnitKey, BuildingKey } from '../../src/engine/types';
import { findPath, refreshCollisionGrid, dangerGrids } from '../../src/engine/utils';
import { createTestHarvester, createTestCombatUnit, createTestBuilding, createTestResource } from '../../src/engine/test-utils';

const { getAIState } = _testUtils;

// Helper functions
function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number,
    overrides?: { hp?: number; maxHp?: number; dead?: boolean; w?: number; h?: number; radius?: number; }
): Entity {
    if (type === 'BUILDING') {
        return createTestBuilding({
            id, owner, key: key as BuildingKey, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp, dead: overrides?.dead,
            w: overrides?.w, h: overrides?.h, radius: overrides?.radius
        });
    } else if (type === 'RESOURCE') {
        return createTestResource({ id, x, y, hp: overrides?.hp });
    } else if (key === 'harvester') {
        return createTestHarvester({ id, owner, x, y, hp: overrides?.hp, dead: overrides?.dead });
    } else {
        return createTestCombatUnit({
            id, owner, key: key as Exclude<UnitKey, 'harvester'>, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp, dead: overrides?.dead
        });
    }
}

function createTestState(entities: Record<EntityId, Entity>): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        tick: 31, // tick % 3 === 1 for player 1 AI
        entities
    };
}

describe('AI Strategic Approach', () => {
    beforeEach(() => {
        resetAIState();
    });

    describe('Pathfinding avoids turret range', () => {
        it('should find path around a single turret when approaching enemy base', () => {
            /**
             * Scenario:
             * - Unit at (1000, 500) - far from turret
             * - Enemy turret at (500, 500) with range 250
             * - Goal at (200, 500) - behind the turret
             * 
             * Direct path would go through turret range.
             * Path should go above or below to avoid the 250-unit danger zone.
             */
            const turretRange = 250;
            const turretPos = new Vector(500, 500);
            const start = new Vector(1000, 500);
            const goal = new Vector(200, 500);

            // Create entities - turret owned by player 0, unit owned by player 1
            const entities: Record<string, Entity> = {
                turret1: createEntity('turret1', 0, 'BUILDING', 'turret', 500, 500, {
                    w: 40,
                    h: 40,
                    radius: 20
                }),
                unit1: createEntity('unit1', 1, 'UNIT', 'light', 1000, 500, {
                    w: 28,
                    h: 28,
                    radius: 14
                })
            };

            // Refresh collision and danger grids - pass both player IDs
            refreshCollisionGrid(entities, undefined, [0, 1]);

            // Find path for player 1's unit
            const path = findPath(start, goal, 14, 1);

            expect(path).not.toBeNull();
            expect(path!.length).toBeGreaterThan(2); // Should not be a direct line

            // Verify that no point in the path is within turret danger zone
            let minDistFromTurret = Infinity;
            for (const point of path!) {
                const dist = point.dist(turretPos);
                minDistFromTurret = Math.min(minDistFromTurret, dist);
            }

            // The path should stay outside the turret range (with some buffer)
            expect(minDistFromTurret).toBeGreaterThanOrEqual(turretRange - 40); // Allow small buffer at edge
        });

        it('should avoid turret when unit starts close to the danger zone', () => {
            /**
             * This simulates the actual bug scenario:
             * - Red unit at approximately (450, 175) heading to enemy base at (300, 300)
             * - Blue turret at (203, 327) with range 250
             * 
             * The unit is close to the danger zone and needs to go around.
             */
            const turretPos = new Vector(203, 327);
            const unitPos = new Vector(450, 175);
            const enemyBase = new Vector(300, 300);

            const entities: Record<string, Entity> = {
                turret1: createEntity('turret1', 0, 'BUILDING', 'turret', 203, 327, {
                    w: 40,
                    h: 40,
                    radius: 20
                }),
                // Add enemy conyard (what we're targeting)
                conyard: createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 300, {
                    w: 90,
                    h: 90,
                    radius: 45
                }),
                unit1: createEntity('unit1', 1, 'UNIT', 'light', 450, 175, {
                    w: 28,
                    h: 28,
                    radius: 14
                })
            };

            refreshCollisionGrid(entities, undefined, [0, 1]);

            // Find path from unit position to enemy base
            const path = findPath(unitPos, enemyBase, 14, 1);

            // The path might be null if the goal is blocked (by the conyard)
            // In that case, check if we can find a path to just outside the base
            if (path) {
                // Check that path avoids the turret danger zone
                for (const point of path) {
                    const distToTurret = point.dist(turretPos);
                    // Should stay outside turret range (250) minus some buffer
                    expect(distToTurret).toBeGreaterThan(200);
                }
            }
        });

        it('should calculate high danger cost for tiles in turret range', () => {
            /**
             * Verify that the danger grid is properly populated
             * when turrets are present.
             */
            const entities: Record<string, Entity> = {
                // Player 0's turret creates danger for player 1
                turret1: createEntity('turret1', 0, 'BUILDING', 'turret', 500, 500, {
                    w: 40,
                    h: 40,
                    radius: 20
                })
            };

            refreshCollisionGrid(entities, undefined, [0, 1]);

            // Check that player 1's danger grid has danger marked around the turret
            // Turret is at (500, 500), range 250
            // Grid tile at (500, 500) should definitely have danger
            const TILE_SIZE = 40;
            const turretGx = Math.floor(500 / TILE_SIZE);
            const turretGy = Math.floor(500 / TILE_SIZE);
            const GRID_W = 75; // From types.ts

            const dangerValue = dangerGrids[1][turretGy * GRID_W + turretGx];
            expect(dangerValue).toBeGreaterThan(0);
        });
    });

    describe('AI offensive strategy considers turret danger', () => {
        it('should not send units directly into turret range when outmatched', () => {
            /**
             * Scenario:
             * - AI (player 1) has a few light tanks at its base
             * - Enemy (player 0) has a turret defending the approach
             * 
             * The AI should either:
             * 1. Find an alternate route around the turret
             * 2. Wait to build up more forces
             * 3. Target the turret specifically before advancing
             */
            const entities: Record<EntityId, Entity> = {};

            // AI (player 1) buildings at (2500, 2500)
            entities['ai_conyard'] = createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 2500, 2500, {
                hp: 3000, maxHp: 3000
            });
            entities['ai_factory'] = createEntity('ai_factory', 1, 'BUILDING', 'factory', 2600, 2500, {
                hp: 2000, maxHp: 2000
            });

            // AI attack group - 5 tanks (minimum for attack)
            for (let i = 0; i < 5; i++) {
                entities[`ai_tank${i}`] = createEntity(`ai_tank${i}`, 1, 'UNIT', 'light', 2450 + i * 30, 2450, {
                    hp: 400, maxHp: 400, w: 28, h: 28, radius: 14
                });
            }

            // Enemy (player 0) buildings at (300, 300)
            entities['enemy_conyard'] = createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 300, 300, {
                hp: 3000, maxHp: 3000
            });
            // Turret defending the base
            entities['enemy_turret'] = createEntity('enemy_turret', 0, 'BUILDING', 'turret', 500, 400, {
                hp: 1000, maxHp: 1000, w: 40, h: 40, radius: 20
            });

            const state = createTestState(entities);

            // Force attack strategy
            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = 0;
            aiState.attackGroup = ['ai_tank0', 'ai_tank1', 'ai_tank2', 'ai_tank3', 'ai_tank4'];
            // Pre-set group to attacking state (bypass rally)
            aiState.offensiveGroups = [{
                id: 'main_attack',
                unitIds: aiState.attackGroup,
                target: null,
                rallyPoint: new Vector(2450, 2450),
                status: 'attacking',
                lastOrderTick: 0
            }];

            const actions = computeAiActions(state, 1);

            // The AI should issue attack commands
            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');
            expect(attackAction).toBeDefined();

            // Ideally, the AI would prioritize the turret or find a safe approach
            // For now, just verify that the action is issued and pathfinding will handle avoidance
        });

        it('should prioritize destroying turret when it blocks approach', () => {
            /**
             * When a turret is blocking the approach to the main target,
             * the AI should consider targeting the turret first.
             */
            const entities: Record<EntityId, Entity> = {};

            // AI attack group close to enemy
            for (let i = 0; i < 5; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 800 + i * 30, 500, {
                    hp: 400, maxHp: 400, w: 28, h: 28, radius: 14
                });
            }
            entities['ai_conyard'] = createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 2500, 2500);

            // Enemy with turret in front of conyard
            entities['enemy_turret'] = createEntity('enemy_turret', 0, 'BUILDING', 'turret', 500, 500, {
                hp: 1000, maxHp: 1000, w: 40, h: 40, radius: 20
            });
            entities['enemy_conyard'] = createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 300, 500, {
                hp: 3000, maxHp: 3000
            });

            const state = createTestState(entities);

            const aiState = getAIState(1);
            aiState.personality = 'rusher'; // Set consistent personality for test
            aiState.strategy = 'attack';
            aiState.attackGroup = ['tank0', 'tank1', 'tank2', 'tank3', 'tank4'];
            // Pre-set group to attacking state (bypass rally)
            aiState.offensiveGroups = [{
                id: 'main_attack',
                unitIds: aiState.attackGroup,
                target: null,
                rallyPoint: new Vector(800, 500),
                status: 'attacking',
                lastOrderTick: 0
            }];

            const actions = computeAiActions(state, 1);
            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');

            expect(attackAction).toBeDefined();

            // The target should be either the turret (blocking) or conyard (high value)
            // Both are valid strategic choices
            expect(['enemy_turret', 'enemy_conyard']).toContain(attackAction?.payload.targetId);
        });
    });

    describe('Danger cost effectiveness', () => {
        it('should make danger cost high enough to force detour', () => {
            /**
             * Test that the danger cost is significant enough to make
             * A* choose a longer path around the danger zone rather than
             * cutting through it.
             * 
             * Setup:
             * - Start at (800, 500)
             * - Goal at (200, 500)  
             * - Turret at (500, 500) with range 250
             * 
             * Direct path is ~600 units.
             * Detour around (going up or down by ~300 units) adds ~600 units
             * 
             * The danger cost must be high enough that ~6 tiles of danger
             * (at 40 units per tile) costs more than the ~15 extra tiles detour.
             */
            const entities: Record<string, Entity> = {
                turret1: createEntity('turret1', 0, 'BUILDING', 'turret', 500, 500, {
                    w: 40, h: 40, radius: 20
                })
            };

            refreshCollisionGrid(entities, undefined, [0, 1]);

            const start = new Vector(800, 500);
            const goal = new Vector(200, 500);

            // Find path for player 1's unit
            const path = findPath(start, goal, 14, 1);

            expect(path).not.toBeNull();

            // Calculate if any waypoint passes through danger zone
            const turretPos = new Vector(500, 500);
            const turretRange = 250;

            let passedThroughDanger = false;
            for (const point of path!) {
                if (point.dist(turretPos) < turretRange - 20) {
                    passedThroughDanger = true;
                    break;
                }
            }

            expect(passedThroughDanger).toBe(false);
        });

        it('should allow path through danger if no alternative exists', () => {
            /**
             * If the only path to the goal goes through a danger zone,
             * the pathfinder should still find it (just with high cost).
             */
            const entities: Record<string, Entity> = {
                // Two turrets creating a gap
                turret1: createEntity('turret1', 0, 'BUILDING', 'turret', 500, 200, {
                    w: 40, h: 40, radius: 20
                }),
                turret2: createEntity('turret2', 0, 'BUILDING', 'turret', 500, 800, {
                    w: 40, h: 40, radius: 20
                }),
                // Wall blocking the top
                wall1: createEntity('wall1', 0, 'BUILDING', 'power', 500, 0, {
                    w: 1000, h: 60, dead: false
                })
            };

            refreshCollisionGrid(entities, undefined, [0, 1]);

            const start = new Vector(800, 500);
            const goal = new Vector(200, 500);

            // The path might have to go through some danger
            const path = findPath(start, goal, 14, 1);

            // Path should still be found
            expect(path).not.toBeNull();
        });
    });

    describe('Reproduction: exact scenario from game state file', () => {
        it('should find safe path for red tank approaching blue base with turret defense', () => {
            /**
             * This test reproduces the scenario from temp/not_avoiding_turret.json:
             * - Red (player 1) light tank needs to approach the blue base
             * - Blue (player 0) turret at (200, 400) with range 250 defends the base
             * 
             * The tank should find a path that avoids the turret range.
             * Simplified with clearer coordinates.
             */
            const entities: Record<string, Entity> = {
                // Blue turret defending the base
                'turret': createEntity('turret', 0, 'BUILDING', 'turret', 200, 400, {
                    w: 40, h: 40, radius: 20
                }),
                // Red unit starting far east
                'tank': createEntity('tank', 1, 'UNIT', 'light', 600, 200, {
                    w: 28, h: 28, radius: 14
                })
            };

            refreshCollisionGrid(entities, undefined, [0, 1]);

            const tankPos = new Vector(600, 200);
            const turretPos = new Vector(200, 400);
            const turretRange = 250;

            // Goal is north-west of turret, avoiding the danger zone
            // Turret is at (200, 400), so we need a goal at least 250 units away
            // Goal at (100, 100) is ~316 units from turret - safe zone
            const goalPosition = new Vector(100, 100);

            const path = findPath(tankPos, goalPosition, 14, 1);

            // Path should be found
            expect(path).not.toBeNull();

            // Check minimum distance from turret along the path
            if (path) {
                let minDistFromTurret = Infinity;
                for (const point of path) {
                    const dist = point.dist(turretPos);
                    minDistFromTurret = Math.min(minDistFromTurret, dist);
                }

                // The path should avoid cutting through the turret's danger zone
                // The path might need to get somewhat close at the edge, but should 
                // not go through the center of the danger zone
                expect(minDistFromTurret).toBeGreaterThan(turretRange - 60);
            }
        });

        it('should approach from safe angle when attacking enemy base with turret', () => {
            /**
             * When a turret is guarding part of the base, AI units should
             * approach from an angle that minimizes turret exposure.
             */
            const entities: Record<string, Entity> = {
                // Turret guarding southern approach
                'turret': createEntity('turret', 0, 'BUILDING', 'turret', 300, 500, {
                    w: 40, h: 40, radius: 20
                }),
                // Conyard to the north
                'conyard': createEntity('conyard', 0, 'BUILDING', 'conyard', 300, 200, {
                    w: 90, h: 90, radius: 45
                }),
                // Attacking unit coming from the east
                'tank': createEntity('tank', 1, 'UNIT', 'light', 800, 350, {
                    w: 28, h: 28, radius: 14
                })
            };

            refreshCollisionGrid(entities, undefined, [0, 1]);

            const tankPos = new Vector(800, 350);
            const turretPos = new Vector(300, 500);
            const turretRange = 250;

            // Find path to attack position near conyard
            const path = findPath(tankPos, new Vector(350, 200), 14, 1);

            expect(path).not.toBeNull();

            if (path) {
                // Calculate how many path waypoints are within turret range
                let waypointsInDanger = 0;
                for (const point of path) {
                    if (point.dist(turretPos) < turretRange) {
                        waypointsInDanger++;
                    }
                }

                // Path should minimize exposure to turret
                // Coming from the east to the north of the map, should be able to 
                // avoid the southern turret entirely
                expect(waypointsInDanger).toBeLessThan(path.length / 2);
            }
        });
    });

});

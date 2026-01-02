import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from '../../src/engine/reducer';
import { GameState, Vector, Entity, EntityId, HarvesterUnit } from '../../src/engine/types';
import {
    createTestCombatUnit,
    createTestHarvester,
    createTestBuilding,
    createTestResource,
    addEntityToState
} from '../../src/engine/test-utils';

describe('Pathfinding Issues', () => {

    // Helper to spawn units using test-utils
    function spawnUnit(state: GameState, x: number, y: number, id: string, owner: number = 0, key: string = 'rifle'): GameState {
        if (key === 'harvester') {
            const harvester = createTestHarvester({ id, owner, x, y });
            return addEntityToState(state, harvester);
        } else {
            const unit = createTestCombatUnit({
                id,
                owner,
                x,
                y,
                key: key as Exclude<import('../../src/engine/types').UnitKey, 'harvester'>
            });
            return addEntityToState(state, unit);
        }
    }

    // Helper to spawn buildings using test-utils
    function spawnBuilding(state: GameState, x: number, y: number, w: number, h: number, id: string, owner: number = 0, key: string = 'conyard'): GameState {
        const building = createTestBuilding({
            id,
            owner,
            key: key as import('../../src/engine/types').BuildingKey,
            x,
            y,
            w,
            h
        });
        return addEntityToState(state, building);
    }

    // Helper to spawn resources using test-utils
    function spawnResource(state: GameState, x: number, y: number, id: string): GameState {
        const resource = createTestResource({ id, x, y });
        return addEntityToState(state, resource);
    }

    describe('Erratic Movement', () => {
        it('should have minimal direction changes when pathing to a clear destination', () => {
            // A unit moving straight should not jitter/zigzag
            let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

            state = spawnUnit(state, 100, 500, 'scout');

            // Command straight line movement
            state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: ['scout'], x: 800, y: 500 } });

            // Track direction changes
            let directionChanges = 0;
            let lastDir: Vector | null = null;
            const directionThreshold = 0.3; // radians - about 17 degrees

            for (let i = 0; i < 200; i++) {
                const prevPos = state.entities['scout'].pos;
                state = update(state, { type: 'TICK' });
                const currPos = state.entities['scout'].pos;

                const movement = currPos.sub(prevPos);
                if (movement.mag() > 0.1) {
                    const currentDir = movement.norm();
                    if (lastDir) {
                        // Calculate angle between directions
                        const dot = lastDir.dot(currentDir);
                        const clampedDot = Math.max(-1, Math.min(1, dot));
                        const angle = Math.acos(clampedDot);
                        if (angle > directionThreshold) {
                            directionChanges++;
                        }
                    }
                    lastDir = currentDir;
                }
            }

            // For a straight path, we expect very few direction changes (maybe 0-2 for rotation smoothing)
            // Current buggy behavior may have many jitters
            expect(directionChanges).toBeLessThan(5);
        });

        it('should not rapidly oscillate when navigating around a simple obstacle', () => {
            let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

            // Place a wall blocking direct path
            state = spawnBuilding(state, 400, 500, 100, 100, 'wall');
            state = spawnUnit(state, 200, 500, 'unit1');

            // Command to position on other side of wall
            state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: ['unit1'], x: 600, y: 500 } });

            // Track how many times unit reverses direction
            let reversals = 0;
            let lastDirSign = 0; // 1 = moving right, -1 = moving left

            for (let i = 0; i < 300; i++) {
                const prevX = state.entities['unit1'].pos.x;
                state = update(state, { type: 'TICK' });
                const currX = state.entities['unit1'].pos.x;

                const diff = currX - prevX;
                if (Math.abs(diff) > 0.1) {
                    const sign = diff > 0 ? 1 : -1;
                    if (lastDirSign !== 0 && sign !== lastDirSign) {
                        reversals++;
                    }
                    lastDirSign = sign;
                }
            }

            // A well-pathed unit should go around the obstacle smoothly
            // Not keep reversing direction
            expect(reversals).toBeLessThan(10);
        });
    });

    describe('Unnecessary Shoving', () => {
        it('should not displace stationary units when pathing around them', () => {
            let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

            // Place a group of stationary units
            const stationaryIds = ['s1', 's2', 's3', 's4'];
            state = spawnUnit(state, 500, 480, 's1');
            state = spawnUnit(state, 500, 520, 's2');
            state = spawnUnit(state, 520, 500, 's3');
            state = spawnUnit(state, 480, 500, 's4');

            // Record initial positions
            const initialPositions: Record<string, Vector> = {};
            for (const id of stationaryIds) {
                initialPositions[id] = state.entities[id].pos;
            }

            // Moving unit passes through the area
            state = spawnUnit(state, 200, 500, 'mover');
            state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: ['mover'], x: 800, y: 500 } });

            for (let i = 0; i < 400; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Check how much stationary units were displaced
            let totalDisplacement = 0;
            for (const id of stationaryIds) {
                const displacement = state.entities[id].pos.dist(initialPositions[id]);
                totalDisplacement += displacement;
            }

            // Stationary units should not be pushed much (allow some minor adjustment)
            // With excessive shoving, displacement could be 50+ each
            expect(totalDisplacement).toBeLessThan(50); // Less than 12.5 pixels average per unit
        });

        it('harvesters waiting at refinery should not push each other excessively', () => {
            let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

            // Spawn refinery
            state = spawnBuilding(state, 500, 500, 100, 80, 'refinery1', 0, 'refinery');

            // NO ore nearby - harvesters will stay idle after docking

            // Spawn 3 harvesters near the refinery dock point
            const dockY = 500 + 60; // Refinery dock offset
            const h1 = createTestHarvester({ id: 'h1', owner: 0, x: 480, y: dockY - 30, cargo: 500, baseTargetId: 'refinery1' });
            const h2 = createTestHarvester({ id: 'h2', owner: 0, x: 500, y: dockY - 30, cargo: 500, baseTargetId: 'refinery1' });
            const h3 = createTestHarvester({ id: 'h3', owner: 0, x: 520, y: dockY - 30, cargo: 500, baseTargetId: 'refinery1' });

            state = addEntityToState(state, h1);
            state = addEntityToState(state, h2);
            state = addEntityToState(state, h3);

            // Track total movement distance during docking phase
            let totalMovement = 0;
            const trackIds = ['h1', 'h2', 'h3'];

            // Run just enough ticks for all 3 harvesters to dock (should take ~50 ticks max)
            for (let i = 0; i < 100; i++) {
                const prevPos: Record<string, Vector> = {};
                for (const id of trackIds) {
                    prevPos[id] = state.entities[id].pos;
                }

                state = update(state, { type: 'TICK' });

                for (const id of trackIds) {
                    if (state.entities[id]) {
                        totalMovement += state.entities[id].pos.dist(prevPos[id]);
                    }
                }
            }

            // Efficient waiting behavior = minimal movement
            // Each harvester needs to move ~30px to dock: 3*30 = 90px minimum
            // With proper queueing, they take turns and wait: ~150px total expected
            // Excessive shoving would cause 500+ pixels
            // Allow up to 250px for some movement while waiting
            expect(totalMovement).toBeLessThan(250);
        });
    });

    describe('Slow Pathfinding', () => {
        it('should find a path around an obstacle quickly', () => {
            let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

            // Create an L-shaped wall that blocks direct path
            state = spawnBuilding(state, 400, 400, 200, 50, 'wall1');
            state = spawnBuilding(state, 500, 500, 50, 200, 'wall2');

            state = spawnUnit(state, 200, 500, 'pathfinder');

            // Target is blocked by the L-wall
            state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: ['pathfinder'], x: 600, y: 300 } });

            const target = new Vector(600, 300);
            const startPos = state.entities['pathfinder'].pos;
            const directDist = startPos.dist(target);

            // Time how many ticks to get within 50 pixels of target
            let ticksToArrive = 0;
            const maxTicks = 800;

            for (let i = 0; i < maxTicks; i++) {
                state = update(state, { type: 'TICK' });
                ticksToArrive++;

                if (state.entities['pathfinder'].pos.dist(target) < 50) {
                    break;
                }
            }

            // Calculate expected optimal ticks (direct distance / speed)
            const speed = 2; // rifle speed
            const optimalTicks = directDist / speed;

            // With good pathfinding, should arrive within 2x optimal time
            // With bad pathfinding, may take 3-4x or never arrive
            expect(ticksToArrive).toBeLessThan(optimalTicks * 2.5);
            expect(state.entities['pathfinder'].pos.dist(target)).toBeLessThan(50);
        });

        it('harvester should reach ore field without excessive delay', () => {
            let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

            // Refinery and harvester
            state = spawnBuilding(state, 300, 300, 100, 80, 'refinery1', 0, 'refinery');
            const harvester = createTestHarvester({
                id: 'harv1',
                owner: 0,
                x: 350,
                y: 400,
                resourceTargetId: 'ore1',
                manualMode: false
            });
            state = addEntityToState(state, harvester);

            // Ore is 400 pixels away
            state = spawnResource(state, 700, 400, 'ore1');

            const target = state.entities['ore1'].pos;
            const startPos = state.entities['harv1'].pos;
            const distance = startPos.dist(target);
            const speed = 1.5; // harvester speed
            const optimalTicks = distance / speed;

            let ticksToArrive = 0;
            const maxTicks = 500;

            for (let i = 0; i < maxTicks; i++) {
                state = update(state, { type: 'TICK' });
                ticksToArrive++;

                if (state.entities['harv1'].pos.dist(target) < 40) { // harvest distance
                    break;
                }
            }

            // Should arrive within 1.5x optimal time (some tolerance for steering)
            expect(ticksToArrive).toBeLessThan(optimalTicks * 1.5);
        });
    });

    describe('Harvester Specific Issues', () => {
        it('multiple harvesters should not form a traffic jam at ore patch', () => {
            let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

            // Refinery
            state = spawnBuilding(state, 300, 500, 100, 80, 'refinery1', 0, 'refinery');

            // Single ore patch
            state = spawnResource(state, 700, 500, 'ore1');

            // 4 harvesters all heading to same ore with manualMode: false
            const h1 = createTestHarvester({ id: 'h1', owner: 0, x: 350, y: 450, resourceTargetId: 'ore1', manualMode: false });
            const h2 = createTestHarvester({ id: 'h2', owner: 0, x: 350, y: 500, resourceTargetId: 'ore1', manualMode: false });
            const h3 = createTestHarvester({ id: 'h3', owner: 0, x: 350, y: 550, resourceTargetId: 'ore1', manualMode: false });
            const h4 = createTestHarvester({ id: 'h4', owner: 0, x: 400, y: 500, resourceTargetId: 'ore1', manualMode: false });

            state = addEntityToState(state, h1);
            state = addEntityToState(state, h2);
            state = addEntityToState(state, h3);
            state = addEntityToState(state, h4);

            // Run simulation and count how many harvesters successfully harvest
            let harvestEvents = 0;

            for (let i = 0; i < 600; i++) {
                const preState = state;
                state = update(state, { type: 'TICK' });

                // Count cargo increases - access cargo via harvester component
                for (const id of ['h1', 'h2', 'h3', 'h4']) {
                    const curr = state.entities[id] as HarvesterUnit;
                    const prev = preState.entities[id] as HarvesterUnit;
                    if (curr && prev && curr.harvester.cargo > prev.harvester.cargo) {
                        harvestEvents++;
                    }
                }
            }

            // All 4 harvesters should have harvested at least once
            // If they're stuck in a traffic jam, only 1-2 might harvest
            expect(harvestEvents).toBeGreaterThan(8); // At least 2 harvest cycles per harvester
        });

        it('harvester should navigate between refinery and ore without getting stuck', () => {
            let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

            // Setup refinery and ore
            state = spawnBuilding(state, 300, 500, 100, 80, 'refinery1', 0, 'refinery');
            state = spawnResource(state, 600, 500, 'ore1');

            // Enable auto-harvesting for this harvester
            const harvester = createTestHarvester({
                id: 'harv1',
                owner: 0,
                x: 350,
                y: 560,
                manualMode: false
            });
            state = addEntityToState(state, harvester);

            // Track complete harvest cycles (go to ore, fill up, return, unload)
            let cycles = 0;
            let lastCargo = 0;

            for (let i = 0; i < 2000; i++) {
                state = update(state, { type: 'TICK' });

                const harv = state.entities['harv1'] as HarvesterUnit;
                if (!harv) continue;

                // Detect unload event (cargo goes from 500 to 0) - access via harvester component
                if (lastCargo >= 400 && harv.harvester.cargo === 0) {
                    cycles++;
                }
                lastCargo = harv.harvester.cargo;
            }

            // In 2000 ticks, a harvester should complete at least 2 full cycles
            // Distance is ~300 each way, speed 1.5, so ~400 ticks per cycle
            // With loading time (~20 harvests * 30 cooldown = 600 ticks), ~1000 ticks per cycle
            // Expect at least 1 cycle, ideally 2
            expect(cycles).toBeGreaterThanOrEqual(1);
        });
    });
});

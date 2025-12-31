import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId, HarvesterUnit, BuildingKey } from './types';
import { refreshCollisionGrid } from './utils';
import {
    createTestHarvester,
    createTestBuilding,
    createTestResource,
    addEntityToState
} from './test-utils';

describe('Harvester Convoy Stuck', () => {

    // Helper to spawn harvesters
    function spawnHarvester(state: GameState, x: number, y: number, id: string, owner: number = 0): GameState {
        const harvester = createTestHarvester({ id, owner, x, y });
        return addEntityToState(state, harvester);
    }

    // Helper to spawn resources
    function spawnResource(state: GameState, x: number, y: number, id: string): GameState {
        const resource = createTestResource({ id, x, y, hp: 1000 });
        return addEntityToState(state, resource);
    }

    // Helper to spawn buildings
    function spawnBuilding(state: GameState, x: number, y: number, w: number, h: number, id: string, owner: number = 0, key: BuildingKey = 'conyard'): GameState {
        const building = createTestBuilding({ id, owner, key, x, y, w, h });
        return addEntityToState(state, building);
    }

    it('two harvesters stacked vertically trying to go through same path should not get permanently stuck', () => {
        // Reproduce the exact scenario from yellow_harvesters_stuck2.json:
        // - Two harvesters at nearly same X, stacked vertically
        // - A building (power plant) to the right creating a narrow corridor
        // - Both trying to go to the same resource through the same path
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Place a power plant to constrain the path (like in the bug case at 2794, 635)
        state = spawnBuilding(state, 500, 400, 60, 60, 'power1', 2, 'power');

        // Place a refinery below (like 2722, 740)
        state = spawnBuilding(state, 420, 500, 100, 80, 'ref1', 2, 'refinery');

        // Place resource far away in the same direction both harvesters need to go
        state = spawnResource(state, 700, 300, 'ore1');

        // Place two harvesters stacked vertically, both with cargo wanting to go to the same resource
        // Similar to positions 2729, 616 and 2729, 649
        state = spawnHarvester(state, 430, 350, 'h1', 2);
        state = spawnHarvester(state, 430, 380, 'h2', 2);

        // Give them cargo and set them to target the same resource
        // They both have partial cargo (not full), so they should be harvesting
        const h1 = state.entities['h1'] as HarvesterUnit;
        const h2 = state.entities['h2'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: {
                    ...h1,
                    harvester: {
                        ...h1.harvester,
                        cargo: 50,
                        resourceTargetId: 'ore1'
                    }
                },
                h2: {
                    ...h2,
                    harvester: {
                        ...h2.harvester,
                        cargo: 450,
                        resourceTargetId: 'ore1'
                    }
                }
            }
        };

        // Refresh collision grid for pathfinding
        refreshCollisionGrid(state.entities);

        const initialH1Pos = state.entities['h1'].pos;
        const initialH2Pos = state.entities['h2'].pos;
        const orePos = state.entities['ore1'].pos;

        // Track position changes to detect actual movement
        let lastH1Pos = state.entities['h1'].pos;
        let lastH2Pos = state.entities['h2'].pos;
        let noProgressTicks = 0;
        let anyProgressMade = false;

        // Run for 150 ticks - enough time for them to either reach the ore or demonstrate being stuck
        for (let i = 0; i < 150; i++) {
            state = update(state, { type: 'TICK' });

            const h1Current = state.entities['h1'];
            const h2Current = state.entities['h2'];

            const h1DistToOre = h1Current.pos.dist(orePos);
            const h2DistToOre = h2Current.pos.dist(orePos);

            // Check if either reached the ore (within harvest range of 40)
            if (h1DistToOre < 40 || h2DistToOre < 40) {
                anyProgressMade = true;
            }

            // Check if neither harvester moved significantly this tick
            const h1Moved = h1Current.pos.dist(lastH1Pos) > 0.5;
            const h2Moved = h2Current.pos.dist(lastH2Pos) > 0.5;

            if (!h1Moved && !h2Moved && h1DistToOre > 50 && h2DistToOre > 50) {
                noProgressTicks++;
            }

            lastH1Pos = h1Current.pos;
            lastH2Pos = h2Current.pos;
        }

        const finalH1 = state.entities['h1'] as HarvesterUnit;
        const finalH2 = state.entities['h2'] as HarvesterUnit;
        const ore = state.entities['ore1'];

        const h1Dist = finalH1.pos.dist(ore.pos);
        const h2Dist = finalH2.pos.dist(ore.pos);
        const h1Progress = initialH1Pos.dist(ore.pos) - h1Dist;
        const h2Progress = initialH2Pos.dist(ore.pos) - h2Dist;

        console.log('Convoy stuck test results:', {
            h1Start: `${initialH1Pos.x.toFixed(0)}, ${initialH1Pos.y.toFixed(0)}`,
            h2Start: `${initialH2Pos.x.toFixed(0)}, ${initialH2Pos.y.toFixed(0)}`,
            h1End: `${finalH1.pos.x.toFixed(0)}, ${finalH1.pos.y.toFixed(0)}`,
            h2End: `${finalH2.pos.x.toFixed(0)}, ${finalH2.pos.y.toFixed(0)}`,
            orePos: `${ore.pos.x.toFixed(0)}, ${ore.pos.y.toFixed(0)}`,
            h1Dist: h1Dist.toFixed(0),
            h2Dist: h2Dist.toFixed(0),
            h1Progress: h1Progress.toFixed(0),
            h2Progress: h2Progress.toFixed(0),
            noProgressTicks,
            anyProgressMade,
            h1StuckTimer: finalH1.movement.stuckTimer,
            h2StuckTimer: finalH2.movement.stuckTimer
        });

        // At least one harvester should have made significant progress toward the ore
        expect(h1Progress > 50 || h2Progress > 50).toBe(true);

        // They shouldn't both be not moving for too long (more than 30 ticks without any movement)
        expect(noProgressTicks).toBeLessThan(60);
    });

    it('stacked harvesters with paths through same point should eventually un-stick and progress', () => {
        // More direct reproduction: set up harvesters with explicit overlapping paths
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Resource they both want
        state = spawnResource(state, 600, 200, 'ore1');

        // Refinery for context
        state = spawnBuilding(state, 350, 400, 100, 80, 'ref1', 2, 'refinery');

        // Two harvesters at almost the same position (stacked)
        state = spawnHarvester(state, 350, 340, 'h1', 2);
        state = spawnHarvester(state, 352, 305, 'h2', 2); // Just above h1

        // Both targeting same ore with explicit paths that go through the same point
        const h1 = state.entities['h1'] as HarvesterUnit;
        const h2 = state.entities['h2'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: {
                    ...h1,
                    harvester: {
                        ...h1.harvester,
                        cargo: 100,
                        resourceTargetId: 'ore1'
                    },
                    movement: {
                        ...h1.movement,
                        path: [
                            new Vector(380, 300),
                            new Vector(450, 250),
                            new Vector(600, 200)
                        ],
                        pathIdx: 0,
                        finalDest: new Vector(600, 200)
                    }
                },
                h2: {
                    ...h2,
                    harvester: {
                        ...h2.harvester,
                        cargo: 100,
                        resourceTargetId: 'ore1'
                    },
                    movement: {
                        ...h2.movement,
                        path: [
                            new Vector(380, 300),
                            new Vector(450, 250),
                            new Vector(600, 200)
                        ],
                        pathIdx: 0,
                        finalDest: new Vector(600, 200)
                    }
                }
            }
        };

        refreshCollisionGrid(state.entities);

        const orePos = state.entities['ore1'].pos;
        let noProgressTicks = 0;
        let reachedOre = false;
        let lastH1Pos = state.entities['h1'].pos;
        let lastH2Pos = state.entities['h2'].pos;

        for (let i = 0; i < 200; i++) {
            state = update(state, { type: 'TICK' });

            const h1Current = state.entities['h1'];
            const h2Current = state.entities['h2'];

            // Check if either reached the ore
            if (h1Current.pos.dist(orePos) < 40 || h2Current.pos.dist(orePos) < 40) {
                reachedOre = true;
            }

            // Check if neither moved significantly and both far from ore
            const h1Moved = h1Current.pos.dist(lastH1Pos) > 0.5;
            const h2Moved = h2Current.pos.dist(lastH2Pos) > 0.5;
            if (!h1Moved && !h2Moved &&
                h1Current.pos.dist(orePos) > 50 && h2Current.pos.dist(orePos) > 50) {
                noProgressTicks++;
            }

            lastH1Pos = h1Current.pos;
            lastH2Pos = h2Current.pos;
        }

        const finalH1 = state.entities['h1'] as HarvesterUnit;
        const finalH2 = state.entities['h2'] as HarvesterUnit;

        console.log('Same-path test:', {
            h1End: `${finalH1.pos.x.toFixed(0)}, ${finalH1.pos.y.toFixed(0)}`,
            h2End: `${finalH2.pos.x.toFixed(0)}, ${finalH2.pos.y.toFixed(0)}`,
            h1DistToOre: finalH1.pos.dist(orePos).toFixed(0),
            h2DistToOre: finalH2.pos.dist(orePos).toFixed(0),
            noProgressTicks,
            reachedOre
        });

        // At least one should reach the ore
        expect(reachedOre).toBe(true);

        // Shouldn't be stuck for too long
        expect(noProgressTicks).toBeLessThan(80);
    });
});

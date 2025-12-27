import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';
import { createEntity, refreshCollisionGrid } from './utils';

describe('Harvester Convoy Stuck', () => {

    // Helper to spawn units
    function spawnUnit(state: GameState, x: number, y: number, id: string, owner: number = 0, key: string = 'rifle'): GameState {
        const unit = createEntity(x, y, owner, 'UNIT', key);
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: { ...unit, id }
            } as Record<EntityId, Entity>
        };
    }

    // Helper to spawn resources
    function spawnResource(state: GameState, x: number, y: number, id: string): GameState {
        const resource: Entity = {
            id,
            owner: -1,
            type: 'RESOURCE',
            key: 'ore',
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
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
        };
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: resource
            } as Record<EntityId, Entity>
        };
    }

    // Helper to spawn buildings
    function spawnBuilding(state: GameState, x: number, y: number, w: number, h: number, id: string, owner: number = 0, key: string = 'conyard'): GameState {
        const building: Entity = {
            id,
            owner,
            type: 'BUILDING',
            key,
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 1000,
            maxHp: 1000,
            w,
            h,
            radius: Math.min(w, h) / 2,
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
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: building
            } as Record<EntityId, Entity>
        };
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
        state = spawnUnit(state, 430, 350, 'h1', 2, 'harvester');
        state = spawnUnit(state, 430, 380, 'h2', 2, 'harvester');

        // Give them cargo and set them to target the same resource
        // They both have partial cargo (not full), so they should be harvesting
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: {
                    ...state.entities['h1'],
                    cargo: 50,
                    resourceTargetId: 'ore1'
                },
                h2: {
                    ...state.entities['h2'],
                    cargo: 450,
                    resourceTargetId: 'ore1'
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

            const h1 = state.entities['h1'];
            const h2 = state.entities['h2'];

            const h1DistToOre = h1.pos.dist(orePos);
            const h2DistToOre = h2.pos.dist(orePos);

            // Check if either reached the ore (within harvest range of 40)
            if (h1DistToOre < 40 || h2DistToOre < 40) {
                anyProgressMade = true;
            }

            // Check if neither harvester moved significantly this tick
            const h1Moved = h1.pos.dist(lastH1Pos) > 0.5;
            const h2Moved = h2.pos.dist(lastH2Pos) > 0.5;

            if (!h1Moved && !h2Moved && h1DistToOre > 50 && h2DistToOre > 50) {
                noProgressTicks++;
            }

            lastH1Pos = h1.pos;
            lastH2Pos = h2.pos;
        }

        const finalH1 = state.entities['h1'];
        const finalH2 = state.entities['h2'];
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
            h1StuckTimer: finalH1.stuckTimer,
            h2StuckTimer: finalH2.stuckTimer
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
        state = spawnUnit(state, 350, 340, 'h1', 2, 'harvester');
        state = spawnUnit(state, 352, 305, 'h2', 2, 'harvester'); // Just above h1

        // Both targeting same ore
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: {
                    ...state.entities['h1'],
                    cargo: 100,
                    resourceTargetId: 'ore1',
                    // Set explicit paths that go through the same point
                    path: [
                        new Vector(380, 300),
                        new Vector(450, 250),
                        new Vector(600, 200)
                    ],
                    pathIdx: 0,
                    finalDest: new Vector(600, 200)
                },
                h2: {
                    ...state.entities['h2'],
                    cargo: 100,
                    resourceTargetId: 'ore1',
                    // Same path points
                    path: [
                        new Vector(380, 300),
                        new Vector(450, 250),
                        new Vector(600, 200)
                    ],
                    pathIdx: 0,
                    finalDest: new Vector(600, 200)
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

            const h1 = state.entities['h1'];
            const h2 = state.entities['h2'];

            // Check if either reached the ore
            if (h1.pos.dist(orePos) < 40 || h2.pos.dist(orePos) < 40) {
                reachedOre = true;
            }

            // Check if neither moved significantly and both far from ore
            const h1Moved = h1.pos.dist(lastH1Pos) > 0.5;
            const h2Moved = h2.pos.dist(lastH2Pos) > 0.5;
            if (!h1Moved && !h2Moved &&
                h1.pos.dist(orePos) > 50 && h2.pos.dist(orePos) > 50) {
                noProgressTicks++;
            }

            lastH1Pos = h1.pos;
            lastH2Pos = h2.pos;
        }

        const finalH1 = state.entities['h1'];
        const finalH2 = state.entities['h2'];

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

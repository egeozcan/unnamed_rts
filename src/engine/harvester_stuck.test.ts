import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';
import { createEntity } from './utils';

describe('Harvester Stuck at Ore', () => {

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

    it('two harvesters targeting same ore should not get stuck blocking each other', () => {
        // Reproduce the scenario from stuck_red_harvesters.json
        // Two AI harvesters (owner=1) trying to harvest the same ore
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Spawn ore at the position from the bug report
        state = spawnResource(state, 500, 500, 'ore1');

        // Spawn two harvesters some distance from the ore, approaching from different directions
        // Similar to harv_p1 at (2440, 2573) and e_1230_7061 at (2372, 2635) targeting ore at (2438, 2637)
        state = spawnUnit(state, 550, 430, 'h1', 1, 'harvester'); // Coming from above-right
        state = spawnUnit(state, 430, 550, 'h2', 1, 'harvester'); // Coming from below-left

        // Set both harvesters to have empty cargo and target the same ore
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: { ...state.entities['h1'], cargo: 0, resourceTargetId: 'ore1' },
                h2: { ...state.entities['h2'], cargo: 0, resourceTargetId: 'ore1' }
            }
        };

        // Track harvester movement

        let stuckCount = 0;
        let harvestingCount = 0;

        // Run for enough ticks that they should reach the ore
        for (let i = 0; i < 200; i++) {
            state = update(state, { type: 'TICK' });

            const h1 = state.entities['h1'];
            const h2 = state.entities['h2'];
            const ore = state.entities['ore1'];

            // Check if either is harvesting (cargo increased or at ore)
            if (h1.cargo > 0 || h2.cargo > 0) {
                harvestingCount++;
            }

            // Check if both have zero velocity and are not at ore (stuck!)
            const h1AtOre = h1.pos.dist(ore.pos) < 40;
            const h2AtOre = h2.pos.dist(ore.pos) < 40;
            const h1Stopped = h1.vel.mag() < 0.1;
            const h2Stopped = h2.vel.mag() < 0.1;

            if (!h1AtOre && !h2AtOre && h1Stopped && h2Stopped) {
                stuckCount++;
            }
        }

        const finalH1 = state.entities['h1'];
        const finalH2 = state.entities['h2'];
        const ore = state.entities['ore1'];

        const finalDistH1 = finalH1.pos.dist(ore.pos);
        const finalDistH2 = finalH2.pos.dist(ore.pos);

        // At least one harvester should have reached the ore (within 40px harvest range)
        const h1Reached = finalDistH1 < 40;
        const h2Reached = finalDistH2 < 40;

        console.log('Final state:', {
            h1Pos: `${finalH1.pos.x.toFixed(1)}, ${finalH1.pos.y.toFixed(1)}`,
            h2Pos: `${finalH2.pos.x.toFixed(1)}, ${finalH2.pos.y.toFixed(1)}`,
            orePos: `${ore.pos.x}, ${ore.pos.y}`,
            h1Dist: finalDistH1.toFixed(1),
            h2Dist: finalDistH2.toFixed(1),
            h1Cargo: finalH1.cargo,
            h2Cargo: finalH2.cargo,
            stuckCount,
            harvestingCount
        });

        // EXPECTATION: At least one should reach the ore
        expect(h1Reached || h2Reached).toBe(true);

        // They shouldn't be stuck for too many ticks (more than 50 would indicate a problem)
        expect(stuckCount).toBeLessThan(50);
    });

    it('harvesters should take turns harvesting when at same ore', () => {
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Spawn ore
        state = spawnResource(state, 500, 500, 'ore1');

        // Spawn a refinery for them to return to
        state = spawnBuilding(state, 500, 200, 100, 80, 'ref1', 1, 'refinery');

        // Spawn two harvesters very close together, both targeting same ore
        state = spawnUnit(state, 510, 460, 'h1', 1, 'harvester');
        state = spawnUnit(state, 490, 460, 'h2', 1, 'harvester');

        // Both have empty cargo and target ore
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: { ...state.entities['h1'], cargo: 0, resourceTargetId: 'ore1' },
                h2: { ...state.entities['h2'], cargo: 0, resourceTargetId: 'ore1' }
            }
        };

        // Track cargo accumulation
        let totalCargoGained = 0;

        for (let i = 0; i < 300; i++) {
            const prevCargo = (state.entities['h1'].cargo || 0) + (state.entities['h2'].cargo || 0);
            state = update(state, { type: 'TICK' });
            const newCargo = (state.entities['h1'].cargo || 0) + (state.entities['h2'].cargo || 0);
            totalCargoGained += Math.max(0, newCargo - prevCargo);
        }

        console.log('Total cargo gained:', totalCargoGained);

        // Over 300 ticks, they should have gained significant cargo
        // If stuck, cargo would be very low
        expect(totalCargoGained).toBeGreaterThan(100);
    });

    it('harvester should give up and find new ore if target ore is blocked by building', () => {
        // This reproduces the bug from stuck_red_harvesters.json where a turret was placed on ore
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Spawn the ore
        state = spawnResource(state, 500, 500, 'blocked_ore');

        // Spawn a building RIGHT ON TOP of the ore (turret at same position as ore)
        state = spawnBuilding(state, 500, 500, 60, 60, 'turret1', 1, 'turret');

        // Spawn an alternative ore far away
        state = spawnResource(state, 200, 200, 'free_ore');

        // Spawn a refinery for the harvester
        state = spawnBuilding(state, 500, 300, 100, 80, 'ref1', 1, 'refinery');

        // Spawn harvester and target the blocked ore
        state = spawnUnit(state, 400, 400, 'h1', 1, 'harvester');
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: { ...state.entities['h1'], cargo: 0, resourceTargetId: 'blocked_ore' }
            }
        };

        // Run simulation
        let stuckTicks = 0;
        let foundNewResource = false;

        for (let i = 0; i < 300; i++) {

            state = update(state, { type: 'TICK' });
            const h1After = state.entities['h1'];

            // Check if still targeting blocked ore with no progress
            const blockedOre = state.entities['blocked_ore'];
            const dist = h1After.pos.dist(blockedOre.pos);

            // Can't reach within 40px due to building
            if (dist > 50 && h1After.vel.mag() < 0.1 && h1After.resourceTargetId === 'blocked_ore') {
                stuckTicks++;
            }

            // Did harvester switch to a different resource?
            if (h1After.resourceTargetId === 'free_ore') {
                foundNewResource = true;
            }
        }

        const finalH1 = state.entities['h1'];

        console.log('Blocked ore test:', {
            finalResourceTarget: finalH1.resourceTargetId,
            stuckTicks,
            foundNewResource,
            cargo: finalH1.cargo,
            pos: `${finalH1.pos.x.toFixed(0)}, ${finalH1.pos.y.toFixed(0)}`,
            stuckTimer: finalH1.stuckTimer,
            harvestAttemptTicks: (finalH1 as any).harvestAttemptTicks,
            lastDistToOre: (finalH1 as any).lastDistToOre?.toFixed(1),
            bestDistToOre: (finalH1 as any).bestDistToOre?.toFixed(1)
        });

        // The harvester should either:
        // 1. Have given up on the blocked ore and found the free one
        // 2. Not be stuck forever (give up after ~200 ticks)
        // It takes ~200 ticks to detect unreachable ore, so stuckTicks could be up to ~200
        // But once it finds free_ore, it should stop being stuck
        expect(foundNewResource).toBe(true); // Main success criteria - found new ore
        expect(stuckTicks).toBeLessThan(220); // Should have given up before 220 ticks
    });

    it('harvester using direct movement (no path) should detect stuck when blocked', () => {
        // Scenario: Harvester has no path (failed A* or cleared), trying direct move
        // But blocked by a wall, so velocity is zero
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        state = spawnResource(state, 500, 500, 'ore_direct');
        // Wall blocking direct path (use valid building key)
        state = spawnBuilding(state, 300, 300, 100, 20, 'wall', 1, 'power');

        // Spawn harvester
        state = spawnUnit(state, 250, 250, 'h_direct', 1, 'harvester');
        state = {
            ...state,
            entities: {
                ...state.entities,
                h_direct: {
                    ...state.entities['h_direct'],
                    id: 'h_direct',
                    cargo: 0,
                    resourceTargetId: 'ore_direct',
                    path: null, // Force direct movement
                    finalDest: new Vector(500, 500)
                }
            }
        };

        // Run simulation
        let stuckDetected = false;

        for (let i = 0; i < 50; i++) {
            state = update(state, { type: 'TICK' });
            const h = state.entities['h_direct'];

            // Movement logic should detect low velocity and increment stuckTimer
            if (h.stuckTimer > 0) {
                stuckDetected = true;
                break;
            }
        }

        expect(stuckDetected).toBe(true);
    });
});


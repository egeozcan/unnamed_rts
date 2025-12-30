/**
 * Test for harvesters going in circles bug.
 * 
 * Root cause: When harvesters flee, they get a moveTarget set by AI.
 * They can only clear moveTarget when within 10 units of it.
 * When multiple harvesters flee to similar areas, they collide and
 * can't reach their targets, causing them to circle endlessly.
 * 
 * The fix is to:
 * 1. Increase the clear distance for harvester moveTargets (from 10 to 30)
 * 2. Add a timeout mechanism to clear stale flee commands
 */
import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from './reducer.js';
import { GameState, Vector, Entity, EntityId } from './types.js';

function createTestHarvester(id: string, owner: number, pos: Vector, cargo: number = 0, moveTarget: Vector | null = null): Entity {
    return {
        id,
        owner,
        type: 'UNIT',
        key: 'harvester',
        pos,
        prevPos: pos,
        hp: 1000,
        maxHp: 1000,
        w: 35,
        h: 35,
        radius: 17,
        dead: false,
        vel: new Vector(0, 0),
        rotation: 0,
        moveTarget,
        path: null,
        pathIdx: 0,
        finalDest: moveTarget,
        stuckTimer: 0,
        unstuckDir: null,
        unstuckTimer: 0,
        targetId: null,
        lastAttackerId: null,
        cooldown: 0,
        flash: 0,
        turretAngle: 0,
        cargo,
        resourceTargetId: null,
        baseTargetId: null,
    };
}

function createTestOre(id: string, pos: Vector): Entity {
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
        baseTargetId: null,
    };
}

function createTestRefinery(id: string, owner: number, pos: Vector): Entity {
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
        baseTargetId: null,
    };
}

describe('Harvester Circling Bug', () => {
    it('should clear harvester moveTarget at a larger distance when blocked', () => {
        // Setup: Harvester with moveTarget at (500, 500)
        // But there's another harvester at (500, 500) blocking it
        const moveTarget = new Vector(500, 500);
        const harv1 = createTestHarvester('harv1', 0, new Vector(520, 520), 0, moveTarget);
        const harv2 = createTestHarvester('harv2', 0, new Vector(500, 500), 0, null); // Blocking
        const ore = createTestOre('ore1', new Vector(600, 600));
        const refinery = createTestRefinery('ref1', 0, new Vector(400, 400));

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            entities: {
                harv1,
                harv2,
                ore1: ore,
                ref1: refinery,
            } as Record<EntityId, Entity>
        };

        // harv1 is ~28 units from moveTarget, blocked by harv2
        const distToTarget = harv1.pos.dist(moveTarget);
        expect(distToTarget).toBeGreaterThan(25);
        expect(distToTarget).toBeLessThan(35);

        // Run several ticks
        for (let i = 0; i < 50; i++) {
            state = update(state, { type: 'TICK' });
        }

        // harv1 should have cleared its moveTarget (can't reach it due to blocking)
        // and should now be targeting ore instead of circling
        const finalHarv1 = state.entities['harv1'] as Entity;

        // Either moveTarget was cleared OR harvester found a new resource target
        const stoppedCircling = finalHarv1.moveTarget === null || finalHarv1.resourceTargetId !== null;
        expect(stoppedCircling).toBe(true);
    });

    it('should clear stale flee commands after timeout', () => {
        // Setup: Harvester with moveTarget (from a flee command) but no threat nearby
        const moveTarget = new Vector(500, 500);
        const harv = createTestHarvester('harv1', 0, new Vector(550, 550), 0, moveTarget);

        const ore = createTestOre('ore1', new Vector(600, 600));
        const refinery = createTestRefinery('ref1', 0, new Vector(400, 400));

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            entities: {
                harv1: harv,
                ore1: ore,
                ref1: refinery,
            } as Record<EntityId, Entity>
        };

        // Run many ticks - harvester should eventually timeout and clear moveTarget
        for (let i = 0; i < 100; i++) {
            state = update(state, { type: 'TICK' });
        }

        const finalHarv = state.entities['harv1'] as Entity;

        // Either it reached the target and started harvesting, or it timed out
        const isHarvesting = finalHarv.resourceTargetId !== null || finalHarv.baseTargetId !== null;
        const clearedMoveTarget = finalHarv.moveTarget === null;

        expect(isHarvesting || clearedMoveTarget).toBe(true);
    });

    it('should not get stuck circling when multiple harvesters flee to same area', () => {
        // This is the main bug scenario: multiple harvesters fleeing to same area
        const fleeTarget = new Vector(500, 500);

        // 4 harvesters all trying to reach the same flee point
        const harv1 = createTestHarvester('harv1', 0, new Vector(520, 480), 100, fleeTarget);
        const harv2 = createTestHarvester('harv2', 0, new Vector(480, 520), 50, fleeTarget);
        const harv3 = createTestHarvester('harv3', 0, new Vector(530, 530), 75, fleeTarget);
        const harv4 = createTestHarvester('harv4', 0, new Vector(470, 470), 25, fleeTarget);

        const ore = createTestOre('ore1', new Vector(700, 700));
        const refinery = createTestRefinery('ref1', 0, new Vector(300, 300));

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            entities: {
                harv1,
                harv2,
                harv3,
                harv4,
                ore1: ore,
                ref1: refinery,
            } as Record<EntityId, Entity>
        };

        // Run 200 ticks
        for (let i = 0; i < 200; i++) {
            state = update(state, { type: 'TICK' });
        }

        // Check that harvesters are not circling (should be harvesting or at refinery)
        let harvestingCount = 0;
        let clearedMoveTargetCount = 0;

        for (const id of ['harv1', 'harv2', 'harv3', 'harv4']) {
            const h = state.entities[id] as Entity;
            if (h) {
                if (h.resourceTargetId !== null || h.baseTargetId !== null) {
                    harvestingCount++;
                }
                if (h.moveTarget === null) {
                    clearedMoveTargetCount++;
                }
            }
        }

        // At least 3/4 harvesters should have cleared their moveTarget or be harvesting
        expect(clearedMoveTargetCount + harvestingCount).toBeGreaterThanOrEqual(3);
    });

    it('should clear moveTarget when harvester is close enough (within 30 units)', () => {
        // Harvester at 25 units from target should clear moveTarget
        const moveTarget = new Vector(500, 500);
        const harv = createTestHarvester('harv1', 0, new Vector(520, 515), 0, moveTarget);
        const ore = createTestOre('ore1', new Vector(600, 600));
        const refinery = createTestRefinery('ref1', 0, new Vector(400, 400));

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            entities: {
                harv1: harv,
                ore1: ore,
                ref1: refinery,
            } as Record<EntityId, Entity>
        };

        // Distance is ~25 units
        expect(harv.pos.dist(moveTarget)).toBeLessThan(30);

        // Run a few ticks
        for (let i = 0; i < 10; i++) {
            state = update(state, { type: 'TICK' });
        }

        const finalHarv = state.entities['harv1'] as Entity;

        // Harvester should have cleared moveTarget and started looking for ore
        expect(finalHarv.moveTarget).toBeNull();
    });
});

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
import { GameState, Vector, Entity, EntityId, HarvesterUnit } from './types.js';
import { createTestHarvester, createTestResource, createTestBuilding } from './test-utils.js';

describe('Harvester Circling Bug', () => {
    it('should clear harvester moveTarget at a larger distance when blocked', () => {
        // Setup: Harvester with moveTarget at (500, 500)
        // But there's another harvester at (500, 500) blocking it
        const moveTarget = new Vector(500, 500);
        const harv1 = createTestHarvester({
            id: 'harv1',
            owner: 0,
            x: 520,
            y: 520,
            cargo: 0,
            moveTarget
        });
        const harv2 = createTestHarvester({
            id: 'harv2',
            owner: 0,
            x: 500,
            y: 500,
            cargo: 0,
            moveTarget: null
        }); // Blocking
        const ore = createTestResource({ id: 'ore1', x: 600, y: 600 });
        const refinery = createTestBuilding({ id: 'ref1', owner: 0, key: 'refinery', x: 400, y: 400 });

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
        const finalHarv1 = state.entities['harv1'] as HarvesterUnit;

        // Either moveTarget was cleared OR harvester found a new resource target
        const stoppedCircling = finalHarv1.movement.moveTarget === null || finalHarv1.harvester.resourceTargetId !== null;
        expect(stoppedCircling).toBe(true);
    });

    it('should clear stale flee commands after timeout', () => {
        // Setup: Harvester with moveTarget (from a flee command) but no threat nearby
        const moveTarget = new Vector(500, 500);
        const harv = createTestHarvester({
            id: 'harv1',
            owner: 0,
            x: 550,
            y: 550,
            cargo: 0,
            moveTarget
        });

        const ore = createTestResource({ id: 'ore1', x: 600, y: 600 });
        const refinery = createTestBuilding({ id: 'ref1', owner: 0, key: 'refinery', x: 400, y: 400 });

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

        const finalHarv = state.entities['harv1'] as HarvesterUnit;

        // Either it reached the target and started harvesting, or it timed out
        const isHarvesting = finalHarv.harvester.resourceTargetId !== null || finalHarv.harvester.baseTargetId !== null;
        const clearedMoveTarget = finalHarv.movement.moveTarget === null;

        expect(isHarvesting || clearedMoveTarget).toBe(true);
    });

    it('should not get stuck circling when multiple harvesters flee to same area', () => {
        // This is the main bug scenario: multiple harvesters fleeing to same area
        const fleeTarget = new Vector(500, 500);

        // 4 harvesters all trying to reach the same flee point
        const harv1 = createTestHarvester({ id: 'harv1', owner: 0, x: 520, y: 480, cargo: 100, moveTarget: fleeTarget });
        const harv2 = createTestHarvester({ id: 'harv2', owner: 0, x: 480, y: 520, cargo: 50, moveTarget: fleeTarget });
        const harv3 = createTestHarvester({ id: 'harv3', owner: 0, x: 530, y: 530, cargo: 75, moveTarget: fleeTarget });
        const harv4 = createTestHarvester({ id: 'harv4', owner: 0, x: 470, y: 470, cargo: 25, moveTarget: fleeTarget });

        const ore = createTestResource({ id: 'ore1', x: 700, y: 700 });
        const refinery = createTestBuilding({ id: 'ref1', owner: 0, key: 'refinery', x: 300, y: 300 });

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
            const h = state.entities[id] as HarvesterUnit;
            if (h) {
                if (h.harvester.resourceTargetId !== null || h.harvester.baseTargetId !== null) {
                    harvestingCount++;
                }
                if (h.movement.moveTarget === null) {
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
        const harv = createTestHarvester({
            id: 'harv1',
            owner: 0,
            x: 520,
            y: 515,
            cargo: 0,
            moveTarget
        });
        const ore = createTestResource({ id: 'ore1', x: 600, y: 600 });
        const refinery = createTestBuilding({ id: 'ref1', owner: 0, key: 'refinery', x: 400, y: 400 });

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

        const finalHarv = state.entities['harv1'] as HarvesterUnit;

        // Harvester should have cleared moveTarget and started looking for ore
        expect(finalHarv.movement.moveTarget).toBeNull();
    });
});

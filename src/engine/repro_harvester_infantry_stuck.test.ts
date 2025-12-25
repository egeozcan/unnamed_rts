
import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { Vector, Entity, EntityId } from './types';
import { createEntity } from './utils';

describe('Harvester and Infantry Stuck Reproduction', () => {

    it('should resolve heavy overlap between moving harvester and infantry', () => {
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Data from red_harvester_stuck_to_infantry.json
        const harvId = 'harv_p1';
        const rifleId = 'e_35789_81532';

        const harvPos = new Vector(2200, 2580);
        const harvTarget = new Vector(2100, 2500);
        const harvRadius = 17;

        const riflePos = new Vector(2210, 2575); // Heavily overlapping
        const rifleTarget = new Vector(2300, 2600);
        const rifleRadius = 7.5;

        // Radii: 17 + 7.5 = 24.5
        // Current distance: sqrt(10^2 + 5^2) = sqrt(125) = 11.18
        // Overlap: 24.5 - 11.18 = 13.32

        const harv: Entity = {
            ...createEntity(harvPos.x, harvPos.y, 1, 'UNIT', 'harvester'),
            id: harvId,
            radius: harvRadius,
            moveTarget: harvTarget, // Emulate harvester moving toward resource
            path: [harvTarget],
            pathIdx: 0,
            finalDest: harvTarget
        };

        const rifle: Entity = {
            ...createEntity(riflePos.x, riflePos.y, 1, 'UNIT', 'rifle'),
            id: rifleId,
            radius: rifleRadius,
            moveTarget: rifleTarget,
            path: [rifleTarget],
            pathIdx: 0,
            finalDest: rifleTarget
        };

        state.entities[harvId] = harv;
        state.entities[rifleId] = rifle;

        // Run simulation for 20 ticks
        for (let i = 0; i < 20; i++) {
            state = update(state, { type: 'TICK' });
        }

        const h = state.entities[harvId];
        const r = state.entities[rifleId];
        const finalDist = h.pos.dist(r.pos);
        const minDist = h.radius + r.radius;
        const softOverlap = 2;

        // With the fix, it should resolve the overlap within 20 ticks
        expect(finalDist).toBeGreaterThanOrEqual(minDist - softOverlap);
    });
});

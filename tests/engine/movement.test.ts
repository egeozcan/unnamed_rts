import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from '../../src/engine/reducer';
import { GameState, Vector, Entity, EntityId } from '../../src/engine/types';
import { createEntity } from '../../src/engine/utils';

describe('Movement & Pathfinding', () => {

    // Helper to spawn units
    function spawnUnit(state: GameState, x: number, y: number, id: string): GameState {
        const unit = createEntity(x, y, 0, 'UNIT', 'rifle');
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: { ...unit, id }
            } as Record<EntityId, Entity>
        };
    }

    it('should handle crowding without getting permanently stuck', () => {
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };
        const unitIds: string[] = [];

        // Spawn 10 units in a cluster
        for (let i = 0; i < 10; i++) {
            const id = 'u' + i;
            unitIds.push(id);
            state = spawnUnit(state, 100 + (i % 3) * 20, 100 + Math.floor(i / 3) * 20, id);
        }

        // Command them all to the same point
        state = update(state, {
            type: 'COMMAND_MOVE',
            payload: { unitIds, x: 500, y: 500 }
        });

        // Run for 400 ticks (long enough to travel dist ~565 at speed ~1.5)
        for (let i = 0; i < 400; i++) {
            state = update(state, { type: 'TICK' });
        }

        // Check if they are near target
        const center = new Vector(500, 500);
        let nearCount = 0;
        for (const id of unitIds) {
            const ent = state.entities[id];
            if (ent && ent.pos.dist(center) < 100) {
                nearCount++;
            }
        }

        // Expect most to be near
        expect(nearCount).toBeGreaterThan(8);
    });

    it('should handle two groups crossing paths', () => {
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };
        const groupA = ['a1', 'a2', 'a3'];
        const groupB = ['b1', 'b2', 'b3'];

        // Spawn A at left, B at right
        state = spawnUnit(state, 100, 300, 'a1');
        state = spawnUnit(state, 100, 320, 'a2');
        state = spawnUnit(state, 100, 340, 'a3');

        state = spawnUnit(state, 700, 300, 'b1');
        state = spawnUnit(state, 700, 320, 'b2');
        state = spawnUnit(state, 700, 340, 'b3');

        // Command Cross
        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: groupA, x: 700, y: 320 } });
        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: groupB, x: 100, y: 320 } });

        // Run simulation (800 ticks for crossing dist ~600)
        for (let i = 0; i < 800; i++) {
            state = update(state, { type: 'TICK' });
        }

        // Check if they swapped sides approximately
        const destA = new Vector(700, 320);
        const destB = new Vector(100, 320);

        let aSuccess = 0;
        for (const id of groupA) {
            const ent = state.entities[id];
            if (ent && ent.pos.dist(destA) < 100) aSuccess++;
        }

        let bSuccess = 0;
        for (const id of groupB) {
            const ent = state.entities[id];
            if (ent && ent.pos.dist(destB) < 100) bSuccess++;
        }

        expect(aSuccess).toBe(3);
        expect(bSuccess).toBe(3);
    });
});

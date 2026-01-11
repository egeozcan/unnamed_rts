
import { describe, it, expect } from 'vitest';
import { commandMove } from '../../src/engine/reducers/units';
import { moveToward } from '../../src/engine/reducers/movement';
import { INITIAL_STATE } from '../../src/engine/reducer';
import { GameState, Entity, UnitEntity, Vector, EntityId } from '../../src/engine/types';
import { createTestCombatUnit } from '../../src/engine/test-utils';

describe('Formation Stability', () => {
    it('should assign stable targets to units in formation (prevents circling)', () => {
        const entities: Record<EntityId, Entity> = {};
        // Create 5 units in a tight cluster
        const center = new Vector(500, 500);
        const unitIds: EntityId[] = [];
        for (let i = 0; i < 5; i++) {
            const id = `unit${i}`;
            const offset = new Vector((Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10);
            const pos = center.add(offset);
            entities[id] = createTestCombatUnit({
                id,
                owner: 1,
                key: 'light',
                x: pos.x,
                y: pos.y
            });
            unitIds.push(id);
        }

        let state = { ...INITIAL_STATE, entities };

        // Simulation loop
        for (let tick = 0; tick < 200; tick++) {
            // Command move to FIXED center
            // This forces recalculation of formation slots every time
            state = commandMove(state, { unitIds, x: 500, y: 500 });

            // Update units (physics/movement)
            const nextEntities = { ...state.entities };
            for (const id of unitIds) {
                const unit = nextEntities[id] as UnitEntity;
                if (unit.movement.moveTarget) {
                    const allEntitiesList = Object.values(state.entities);
                    const moved = moveToward(unit, unit.movement.moveTarget, allEntitiesList);
                    nextEntities[id] = moved;
                }
            }
            state = { ...state, entities: nextEntities };
        }

        // Verify that target assignments are stable and correct
        // For a deterministic sort (by ID) and 5 units, unit4 should always target the same slot.
        // Expected positions for 5 units at (500,500) with radius 10 (spacing ~25 in grid):
        // The formation logic fills slots mostly deterministically based on count.

        const unit4 = state.entities['unit4'] as UnitEntity;
        const target4 = unit4.movement.moveTarget;

        if (!target4) throw new Error('Unit 4 lost target');

        // Check stability: The target should be one of the valid formation slots.
        // We confirmed in previous runs that for this setup, one slot is (500, 512.5).
        // Since we sort by ID ("unit0", "unit1", "unit2", "unit3", "unit4"), 
        // unit4 should effectively be the last one and get the last slot.
        const expectedX = 500;
        const expectedY = 512.5;

        expect(target4.x).toBeCloseTo(expectedX, 0.1);
        expect(target4.y).toBeCloseTo(expectedY, 0.1);

        // Also check that the unit is actually close to its target (not circling far away)
        const dist = unit4.pos.dist(target4);
        expect(dist).toBeLessThan(20);
    });
});

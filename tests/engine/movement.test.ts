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

    it('should clamp units to map boundaries', () => {
        // Test with a smaller map to make boundary testing easier
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
            config: { ...INITIAL_STATE.config, width: 500, height: 500 }
        };

        // Spawn a unit near the bottom-right corner
        state = spawnUnit(state, 480, 480, 'corner_unit');
        const unitRadius = state.entities['corner_unit'].radius;

        // Command it to move far outside the map (to the bottom-right)
        state = update(state, {
            type: 'COMMAND_MOVE',
            payload: { unitIds: ['corner_unit'], x: 1000, y: 1000 }
        });

        // Run simulation - unit should try to move toward target but be clamped
        for (let i = 0; i < 100; i++) {
            state = update(state, { type: 'TICK' });
        }

        const ent = state.entities['corner_unit'];
        expect(ent).toBeDefined();

        // Unit should be at map boundary (accounting for radius)
        expect(ent.pos.x).toBeLessThanOrEqual(500 - unitRadius + 0.1);
        expect(ent.pos.y).toBeLessThanOrEqual(500 - unitRadius + 0.1);
        expect(ent.pos.x).toBeGreaterThanOrEqual(unitRadius - 0.1);
        expect(ent.pos.y).toBeGreaterThanOrEqual(unitRadius - 0.1);
    });

    it('should prevent units from crossing top-left boundary', () => {
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
            config: { ...INITIAL_STATE.config, width: 500, height: 500 }
        };

        // Spawn a unit near the top-left corner
        state = spawnUnit(state, 20, 20, 'tl_unit');
        const unitRadius = state.entities['tl_unit'].radius;

        // Command it to move far outside the map (to the top-left)
        state = update(state, {
            type: 'COMMAND_MOVE',
            payload: { unitIds: ['tl_unit'], x: -500, y: -500 }
        });

        // Run simulation
        for (let i = 0; i < 100; i++) {
            state = update(state, { type: 'TICK' });
        }

        const ent = state.entities['tl_unit'];
        expect(ent).toBeDefined();

        // Unit should be at map boundary (accounting for radius)
        expect(ent.pos.x).toBeGreaterThanOrEqual(unitRadius - 0.1);
        expect(ent.pos.y).toBeGreaterThanOrEqual(unitRadius - 0.1);
    });

    it('should handle movement vectors as plain objects from JSON deserialization', () => {
        // This test simulates loading a game state from JSON where Vector 
        // instances are deserialized as plain {x, y} objects
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
        };

        // Spawn a unit
        state = spawnUnit(state, 100, 100, 'json_unit');

        // Manually set movement with plain object vectors (simulating JSON parse)
        const unit = state.entities['json_unit'];
        if (unit && unit.type === 'UNIT') {
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    'json_unit': {
                        ...unit,
                        movement: {
                            ...unit.movement,
                            moveTarget: new Vector(400, 400),
                            // Simulate JSON deserialization - all vectors are plain objects
                            finalDest: { x: 200, y: 200 } as unknown as Vector,
                            path: [
                                { x: 150, y: 150 } as unknown as Vector,
                                { x: 200, y: 200 } as unknown as Vector,
                                { x: 300, y: 300 } as unknown as Vector
                            ],
                            pathIdx: 1,
                            unstuckDir: { x: 1, y: 0 } as unknown as Vector
                        }
                    }
                }
            };
        }

        // Run simulation - should NOT throw any ".sub is not a function" or ".dist is not a function" errors
        expect(() => {
            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }
        }).not.toThrow();

        // Unit should still exist and be moving
        const ent = state.entities['json_unit'];
        expect(ent).toBeDefined();
    });

    it('should not falsely detect stuck during direction reversals with negative avgVel', () => {
        // This tests the specific bug where avgVel pointing backward (from recent direction change)
        // caused isBeingPushedBack to trigger even when lastVel shows forward movement.
        // The artillery unit at tick 33692 had:
        // - avgVel: {x: -0.144, y: -0.266} (pointing backward due to 90% retention)
        // - lastVel: {x: 1.2, y: -0.007} (pointing forward toward target)
        // This caused false "being pushed back" detection and oscillation.

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
        };

        // Spawn a unit at a position and simulate the problematic state
        const unit = createEntity(500, 500, 1, 'UNIT', 'medium');
        state = {
            ...state,
            entities: {
                [unit.id]: {
                    ...unit,
                    movement: {
                        ...unit.movement,
                        moveTarget: new Vector(700, 500), // Target to the right
                        // Simulate avgVel pointing backward (left) due to recent direction reversal
                        avgVel: new Vector(-0.5, -0.2),
                        // But lastVel shows we're currently moving forward (right) at speed
                        lastVel: new Vector(1.8, 0.1),
                        stuckTimer: 0,
                        unstuckTimer: 0,
                        unstuckDir: null,
                        path: [new Vector(520, 500), new Vector(700, 500)],
                        pathIdx: 0,
                        finalDest: new Vector(700, 500)
                    }
                }
            } as Record<EntityId, Entity>
        };

        // Run a few ticks - stuckTimer should NOT increase significantly
        // because lastVel shows we're making forward progress
        let maxStuckTimer = 0;
        for (let i = 0; i < 30; i++) {
            state = update(state, { type: 'TICK' });
            const ent = state.entities[unit.id] as any;
            if (ent && ent.movement.stuckTimer > maxStuckTimer) {
                maxStuckTimer = ent.movement.stuckTimer;
            }
        }

        // stuckTimer should stay low (below unstuck trigger threshold of 20)
        // because lastVel shows forward movement, preventing false stuck detection
        expect(maxStuckTimer).toBeLessThan(15);
    });
});

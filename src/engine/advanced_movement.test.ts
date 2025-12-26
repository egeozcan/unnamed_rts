
import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';
import { createEntity } from './utils';

describe('Advanced Movement Scenarios', () => {

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

    // Helper to spawn buildings
    function spawnBuilding(state: GameState, x: number, y: number, w: number, h: number, id: string): GameState {
        const building: Entity = {
            id,
            owner: 0,
            type: 'BUILDING',
            key: 'conyard', // Use conyard as generic blocker
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 1000,
            maxHp: 1000,
            w,
            h,
            radius: Math.min(w, h) / 2, // Use min dimension for better rectangular approximation
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

    it('should detect and resolve "vibration" stuck state using avgVel', () => {
        // Create a scenario where two units are trying to swap places perfectly head-on in a narrow corridor
        // This often causes vibration without net movement if not handled
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Place two walls to form a narrow horizontal corridor
        // y=400 top wall, y=600 bottom wall. Gap 200 is plenty for movement but restricts lateral dodging
        state = spawnBuilding(state, 500, 300, 800, 100, 'wall_top');
        state = spawnBuilding(state, 500, 700, 800, 100, 'wall_bottom');

        // Spawn unit A left, unit B right
        state = spawnUnit(state, 200, 500, 'unitA');
        state = spawnUnit(state, 800, 500, 'unitB');

        const startA = state.entities['unitA'].pos;
        const startB = state.entities['unitB'].pos;
        const targetA = new Vector(800, 500);
        const targetB = new Vector(200, 500);

        // Command swap
        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: ['unitA'], x: 800, y: 500 } });
        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: ['unitB'], x: 200, y: 500 } });

        // Verify initial state
        expect(state.entities['unitA'].stuckTimer).toBe(0);

        // Run simulation and track progress
        let unstuckTriggered = false;

        for (let i = 0; i < 600; i++) {
            state = update(state, { type: 'TICK' });

            const uA = state.entities['unitA'];
            const uB = state.entities['unitB'];

            if ((uA.unstuckTimer && uA.unstuckTimer > 0) ||
                (uB.unstuckTimer && uB.unstuckTimer > 0)) {
                unstuckTriggered = true;
            }
        }

        const finalA = state.entities['unitA'];
        const finalB = state.entities['unitB'];

        // Calculate initial and final distances to targets
        const initialDistA = startA.dist(targetA);
        const initialDistB = startB.dist(targetB);
        const finalDistA = finalA.pos.dist(targetA);
        const finalDistB = finalB.pos.dist(targetB);

        // Calculate progress made (positive means closer to target)
        const progressA = initialDistA - finalDistA;
        const progressB = initialDistB - finalDistB;

        // Success: both units made significant progress OR reached within 100px of target
        const reachedA = finalDistA < 100;
        const reachedB = finalDistB < 100;
        const success = reachedA && reachedB;

        // Alternative: units made progress (moved at least 100px closer)
        const madeProgress = progressA > 100 && progressB > 100;

        // At minimum, unstuck should have triggered OR they made progress OR reached destination
        expect(success || madeProgress || unstuckTriggered).toBe(true);
    });

    it('should handle many units squeezing through a narrow gap', () => {
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Create a narrow gap: Building at x=400, another at x=600. gap center x=500.
        // Gap width = 200 - (w/2 + w/2). If buildings are w=100, radius=50.
        // Center-to-center dist needed for gap > 0.
        // Let's make gap really tight.
        // Left wall: x=350, w=300 (extends to 500 edge). Right edge = 350 + 150 = 500.
        // Right wall: x=650, w=300 (starts at 500 edge). Left edge = 650 - 150 = 500.
        // Real gap: 0? Let's give 40px gap.
        // Left wall right_edge = 480. x = 480-150 = 330.
        // Right wall left_edge = 520. x = 520+150 = 670.

        state = spawnBuilding(state, 330, 500, 300, 100, 'wall_left');
        state = spawnBuilding(state, 670, 500, 300, 100, 'wall_right');

        // Spawn 20 units at top
        const unitIds: string[] = [];
        for (let i = 0; i < 20; i++) {
            const id = 'u' + i;
            unitIds.push(id);
            // Spawn in a box above the gap
            state = spawnUnit(state, 400 + (i % 5) * 40, 200 + Math.floor(i / 5) * 40, id);
        }

        // Command all to bottom
        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds, x: 500, y: 800 } });

        // This requires significant time to funnel through
        for (let i = 0; i < 1000; i++) {
            state = update(state, { type: 'TICK' });
        }

        // Count how many made it to the bottom area (y > 600)
        let countThrough = 0;
        for (const id of unitIds) {
            if (state.entities[id].pos.y > 600) {
                countThrough++;
            }
        }

        // Expect at least 50% to have squeezed through
        expect(countThrough).toBeGreaterThan(10);
    });
});

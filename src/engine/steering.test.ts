
import { describe, it, expect, beforeEach } from 'vitest';
import { createEntity } from './reducer'; // Ensure this is exported
import { GameState, Vector } from './types';
import { INITIAL_STATE, update } from './reducer';

describe('Unit Steering & Smoothing', () => {
    let state: GameState;

    beforeEach(() => {
        state = { ...INITIAL_STATE, running: true, mode: 'game' };
    });

    it('should move smoothly in open space without zigzagging', () => {
        const unit = createEntity(100, 100, 1, 'UNIT', 'light', state);
        state.entities[unit.id] = unit;

        // Move to (500, 100) - straight line right
        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: [unit.id], x: 500, y: 100 } });

        // Track velocity direction changes
        let prevVelStart = new Vector(0, 0);
        let directionChanges = 0;

        // Run for a bit
        for (let i = 0; i < 30; i++) {
            state = update(state, { type: 'TICK' });
            const u = state.entities[unit.id];
            if (u.vel.mag() > 0.1) {
                const navDir = u.vel.norm();
                if (prevVelStart.mag() > 0.1) {
                    // Check angle change
                    const dot = navDir.x * prevVelStart.x + navDir.y * prevVelStart.y;
                    // If dot < 0.9, significant direction change
                    if (dot < 0.98) { // Strict check for straight line
                        directionChanges++;
                        // console.log(`Tick ${i}: Direction changed. Dot: ${dot}`);
                    }
                }
                prevVelStart = navDir;
            }
        }

        // In open space, it should be 0 or very low (acceleration phase only)
        expect(directionChanges).toBeLessThan(3);
    });

    it('should not oscillate wildly near obstacles', () => {
        // Place wall
        const wall = createEntity(300, 120, 0, 'BUILDING', 'conyard', state);
        state.entities[wall.id] = { ...wall, pos: new Vector(300, 110), w: 90, h: 90, radius: 45 };

        const unit = createEntity(100, 100, 1, 'UNIT', 'light', state);
        state.entities[unit.id] = unit;

        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: [unit.id], x: 500, y: 100 } });

        let zigzags = 0;
        let prevDir = new Vector(1, 0); // Moving East initially

        for (let i = 0; i < 100; i++) {
            state = update(state, { type: 'TICK' });
            const u = state.entities[unit.id];

            // Check for y-velocity flips (zigzagging up and down)
            if (u.vel.mag() > 0.5) {
                const currentDir = u.vel.norm();

                // Detect sign flip in Y component (crossing x-axis repeatedly)
                if (Math.sign(currentDir.y) !== Math.sign(prevDir.y) && Math.abs(currentDir.y) > 0.1) {
                    zigzags++;
                    // console.log(`Tick ${i}: Zigzag detected. Y flipped from ${prevDir.y} to ${currentDir.y}`);
                }
                prevDir = currentDir;
            }
        }

        console.log(`Obstacle Avoidance Zigzags: ${zigzags}`);
        expect(zigzags).toBeLessThan(5);
    });

    it('should handle crowding without excessive jitter', () => {
        // Create 5 units close together
        const units: string[] = [];
        for (let i = 0; i < 5; i++) {
            const u = createEntity(100, 100 + i * 30, 1, 'UNIT', 'light', state);
            state.entities[u.id] = u;
            units.push(u.id);
        }

        // Move them all to a single point (convergence)
        // This usually causes jitter as they fight for the spot
        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: units, x: 500, y: 150 } });

        let totalDirectionChanges = 0;
        let prevDirs: Record<string, Vector> = {};

        for (let i = 0; i < 100; i++) {
            state = update(state, { type: 'TICK' });

            for (const id of units) {
                const u = state.entities[id];
                if (u && u.vel.mag() > 0.1) {
                    const dir = u.vel.norm();
                    if (prevDirs[id]) {
                        const dot = dir.dot(prevDirs[id]);
                        if (dot < 0.6) totalDirectionChanges++; // Sudden turn
                    }
                    prevDirs[id] = dir;
                }
            }
        }

        console.log(`Crowd Direction Changes: ${totalDirectionChanges}`);
        // With 5 units for 100 ticks, we expect SOME adjustments (< 50)
        // If it's zigzagging constantly, this will be high
        expect(totalDirectionChanges).toBeLessThan(50);
    });

    it('should keep rotation normalized within [-PI, PI] after many movements', () => {
        const unit = createEntity(100, 100, 1, 'UNIT', 'light', state);
        state.entities[unit.id] = unit;

        // Move in a circle to accumulate many rotation changes
        const destinations = [
            { x: 500, y: 100 },  // East
            { x: 500, y: 500 },  // South
            { x: 100, y: 500 },  // West
            { x: 100, y: 100 },  // North
        ];

        for (let round = 0; round < 5; round++) {
            for (const dest of destinations) {
                state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: [unit.id], x: dest.x, y: dest.y } });

                // Run for a bit
                for (let i = 0; i < 50; i++) {
                    state = update(state, { type: 'TICK' });
                }
            }
        }

        const finalUnit = state.entities[unit.id];

        // Rotation should be normalized to [-PI, PI]
        expect(finalUnit.rotation).toBeGreaterThanOrEqual(-Math.PI);
        expect(finalUnit.rotation).toBeLessThanOrEqual(Math.PI);
    });
});

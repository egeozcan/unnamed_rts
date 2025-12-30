import { describe, it, expect } from 'vitest';
import { update } from './reducer';
import { GameState, Vector } from './types';
import { createEntity } from './utils';

describe('Unit Stuck Pathing Priority', () => {
    // Helper to create test state
    function createTestState(): GameState {
        return {
            running: true,
            tick: 0,
            mode: 'game',
            entities: {},
            players: {
                0: {
                    id: 0,
                    credits: 1000,
                    isAi: false,
                    color: 'blue',
                    difficulty: 'medium',
                    maxPower: 100,
                    usedPower: 0,
                    readyToPlace: null,
                    queues: { building: { current: null, progress: 0, invested: 0 }, infantry: { current: null, progress: 0, invested: 0 }, vehicle: { current: null, progress: 0, invested: 0 }, air: { current: null, progress: 0, invested: 0 } }
                } as any
            },
            selection: [],
            projectiles: [],
            particles: [],
            camera: { x: 0, y: 0 },
            zoom: 1,
            config: { width: 1000, height: 1000, resourceDensity: 'medium', rockDensity: 'medium' },
            showMinimap: false,
            debugMode: false,
            sellMode: false,
            repairMode: false,
            difficulty: 'easy',
            placingBuilding: null,
            winner: null
        };
    }

    it('should trigger unstuck maneuver BEFORE re-pathing reset when stuck', () => {
        let state = createTestState();

        // Create a unit sandwiched between obstacles
        const unit = createEntity(100, 100, 0, 'UNIT', 'harvester');
        (unit as any).id = 'stuck_unit';
        // Mock stuck timer close to the threshold where it currently fails (30)
        (unit as any).stuckTimer = 28;
        (unit as any).moveTarget = new Vector(500, 500); // Far away
        (unit as any).avgVel = new Vector(0.01, 0.01); // Basically not moving
        (unit as any).path = [new Vector(100, 100), new Vector(500, 500)]; // Fake path
        (unit as any).pathIdx = 1;

        state.entities['stuck_unit'] = unit;

        // Advance 5 ticks
        // Tick 29 -> stuckTimer 29
        // Tick 30 -> stuckTimer 30
        // Tick 31 -> stuckTimer 31 -> Currently logic triggers Re-path (Reset Timer to 0)
        // We WANT Unstuck to trigger potentially sooner or for Unstuck to take precedence?
        // Or at least for Unstuck to happen eventually.

        // If we change logic so Unstuck happens at 20, and Re-path at 30.
        // Then at 28 (start), it's already > 20. So it should Unstuck immediately.

        for (let i = 0; i < 5; i++) {
            state = update(state, { type: 'TICK' });
        }

        const updatedUnit = state.entities['stuck_unit'];

        // Check if unstuck maneuver activated
        // If active, unstuckTimer > 0
        expect(updatedUnit.unstuckTimer).toBeGreaterThan(0);

        // Check if stuckTimer reset
        expect(updatedUnit.stuckTimer).toBe(0);
    });
});

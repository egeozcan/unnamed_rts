import { describe, it, expect } from 'vitest';
import { update } from '../../src/engine/reducer';
import { GameState, Vector, UnitEntity } from '../../src/engine/types';
import { createEntity } from '../../src/engine/utils';

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
                    difficulty: 'medium' as const,
                    maxPower: 100,
                    usedPower: 0,
                    readyToPlace: null,
                    queues: { building: { current: null, progress: 0, invested: 0 }, infantry: { current: null, progress: 0, invested: 0 }, vehicle: { current: null, progress: 0, invested: 0 }, air: { current: null, progress: 0, invested: 0 } }
                }
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
            winner: null,
            fogOfWar: {}
        };
    }

    it('should trigger unstuck maneuver BEFORE re-pathing reset when stuck', () => {
        let state = createTestState();

        // Create a unit sandwiched between obstacles
        const baseUnit = createEntity(100, 100, 0, 'UNIT', 'harvester') as UnitEntity;
        // Mock stuck timer close to the threshold where it currently fails (30)
        const unit: UnitEntity = {
            ...baseUnit,
            id: 'stuck_unit',
            movement: {
                ...baseUnit.movement,
                stuckTimer: 28,
                moveTarget: new Vector(500, 500), // Far away
                avgVel: new Vector(0.01, 0.01), // Basically not moving
                path: [new Vector(100, 100), new Vector(500, 500)], // Fake path
                pathIdx: 1
            }
        };

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

        const updatedUnit = state.entities['stuck_unit'] as UnitEntity;

        // Check if unstuck maneuver activated
        // If active, unstuckTimer > 0
        expect(updatedUnit.movement.unstuckTimer).toBeGreaterThan(0);

        // Check if stuckTimer reset
        expect(updatedUnit.movement.stuckTimer).toBe(0);
    });
});

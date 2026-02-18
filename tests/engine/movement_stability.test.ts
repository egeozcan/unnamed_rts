import { describe, it, expect } from 'vitest';
import { GameState, Vector, UnitEntity } from '../../src/engine/types';
import { tick } from '../../src/engine/reducers/game_loop';
import { createEntity } from '../../src/engine/reducers/helpers';
import { commandMove } from '../../src/engine/reducers/units';

describe('Movement Stability', () => {
    it('should not cause units to dance/oscillate when clumped in large groups', () => {
        let state: GameState = {
            running: true,
            mode: 'game',
            sellMode: false,
            repairMode: false,
            difficulty: 'hard',
            tick: 0,
            camera: { x: 0, y: 0 },
            zoom: 1,
            entities: {},
            projectiles: [],
            particles: [],
            selection: [],
            placingBuilding: null,
            players: {
                0: {
                    id: 0, isAi: false, difficulty: 'hard', color: 'blue', credits: 1000,
                    maxPower: 100, usedPower: 0, queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            },
            winner: null,
            config: { width: 5000, height: 5000, resourceDensity: 'medium', rockDensity: 'medium' },
            debugMode: false,
            showMinimap: false,
            showBirdsEye: false,
            attackMoveMode: false,
            fogOfWar: {}
        };

        // Create a extreme clump of 40 heavy tanks
        const unitIds: string[] = [];
        for (let i = 0; i < 40; i++) {
            const unit = createEntity(100, 100, 0, 'UNIT', 'heavy', state);
            state.entities[unit.id] = unit;
            unitIds.push(unit.id);
        }

        // Command them to move to a nearby spot
        state = commandMove(state, { unitIds, x: 500, y: 500 });

        // Run for many ticks and track positions
        const trackId = unitIds[0];
        const positions: Vector[] = [];

        for (let i = 0; i < 200; i++) {
            // Simulate AI re-commanding periodically
            if (i % 30 === 0) {
                state = commandMove(state, { unitIds, x: 500, y: 500 });
            }

            state = tick(state);
            const unit = state.entities[trackId] as UnitEntity;
            positions.push(unit.pos);
        }

        // Check for oscillations (dancing)
        // We look for significant angle changes in movement direction
        let reversals = 0;
        for (let i = 2; i < positions.length; i++) {
            const v1 = positions[i - 1].sub(positions[i - 2]);
            const v2 = positions[i].sub(positions[i - 1]);
            if (v1.mag() > 0.1 && v2.mag() > 0.1) {
                const dot = v1.norm().dot(v2.norm());
                if (dot < 0.5) { // Angle change > 60 degrees
                    reversals++;
                }
            }
        }

        console.log('Reversals detected:', reversals);
        // A high number of reversals indicates dancing/shaking
        expect(reversals).toBeLessThan(15);
    });
});


import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from '../../src/engine/reducer';
import { GameState, Vector, Entity, EntityId, HarvesterUnit } from '../../src/engine/types';
import {
    createTestHarvester,
    createTestBuilding,
    addEntityToState
} from '../../src/engine/test-utils';

describe('Harvester Collision Loop', () => {

    // Helper to spawn harvesters
    function spawnHarvester(state: GameState, x: number, y: number, id: string, owner: number = 0): GameState {
        const harvester = createTestHarvester({ id, owner, x, y });
        return addEntityToState(state, harvester);
    }

    // Helper to spawn buildings
    function spawnBuilding(state: GameState, x: number, y: number, w: number, h: number, id: string, owner: number = 0, key: string = 'refinery'): GameState {
        const building = createTestBuilding({
            id,
            owner,
            key: key as import('../../src/engine/types').BuildingKey,
            x,
            y,
            w,
            h
        });
        return addEntityToState(state, building);
    }

    it('should stop trying to move to unreachable target inside a refinery', () => {
        // Reproduce the scenario: Right-click move to center of refinery
        // This sets manualMode: true and moveTarget: refinery.pos
        // Refinery radius is 50, Harvester radius is 17.5

        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Spawn a refinery
        const refPos = new Vector(500, 500);
        state = spawnBuilding(state, refPos.x, refPos.y, 100, 80, 'ref1', 0, 'refinery');

        // Spawn a harvester just outside the refinery (within collision range)
        // Harvester at 560, 500. Distance = 60. MinDist = 50 + 17.5 = 67.5.
        // It is colliding.
        state = spawnHarvester(state, 545, 500, 'h1', 0); // 45 units away from center. Collision depth ~22.5

        // Manually set the move target to the CENTER of the refinery
        const h1 = state.entities['h1'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: {
                    ...h1,
                    movement: {
                        ...h1.movement,
                        moveTarget: refPos, // Impossible target
                        path: null,
                        stuckTimer: 0
                    },
                    harvester: {
                        ...h1.harvester,
                        manualMode: true, // User command
                        cargo: 300 // Non-empty cargo
                    }
                }
            }
        };

        // Run simulation for a few ticks
        for (let i = 0; i < 10; i++) {
            state = update(state, { type: 'TICK' });
        }

        const h1After = state.entities['h1'] as HarvesterUnit;

        // Expectation 1: The move target should be cleared
        expect(h1After.movement.moveTarget).toBeNull();

        // Expectation 2: manualMode should be FALSE (cleared because it was blocked by building)
        // This allows the harvester to resume auto-behavior (like returning cargo)
        expect(h1After.harvester.manualMode).toBe(false);

        // Expectation 3: Velocity should be zero (stopped)
        // Note: The physics engine might still have residual push-out velocity, effectively < 0.1 checks "stopped intention"
        // or check that it's not trying to move to target anymore
    });



});

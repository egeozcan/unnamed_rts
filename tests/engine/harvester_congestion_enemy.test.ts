
import { describe, it, expect } from 'vitest';
import { update, INITIAL_STATE } from '../../src/engine/reducer';
import { GameState, Entity, EntityId, HarvesterUnit, Vector } from '../../src/engine/types';
import { createTestHarvester, createTestResource } from '../../src/engine/test-utils';

function createTestState(): GameState {
    return {
        ...INITIAL_STATE,
        entities: {},
        running: true
    };
}

describe('Harvester Enemy Congestion', () => {
    it('should avoid ore that is being harvested by an enemy', () => {
        let state = createTestState();

        // Create two ores
        state = {
            ...state,
            entities: {
                ...state.entities,
                'ore1': createTestResource({ id: 'ore1', x: 500, y: 500 }),
                'ore2': createTestResource({ id: 'ore2', x: 800, y: 500 }) // Farther away
            } as Record<EntityId, Entity>
        };

        // Enemy harvester already at ore1
        const enemyHarv = createTestHarvester({ id: 'enemy_harv', owner: 1, x: 500, y: 540 });
        state = {
            ...state,
            entities: {
                ...state.entities,
                'enemy_harv': {
                    ...enemyHarv,
                    harvester: { ...enemyHarv.harvester, resourceTargetId: 'ore1' }
                }
            }
        };

        // Our harvester starts closer to ore1 than ore2
        const myHarv = createTestHarvester({ id: 'my_harv', owner: 0, x: 400, y: 500, manualMode: false });
        state = {
            ...state,
            entities: {
                ...state.entities,
                'my_harv': myHarv
            }
        };

        // Run one tick to let logic run
        const newState = update(state, { type: 'TICK' });
        const myHarvUpdated = newState.entities['my_harv'] as HarvesterUnit;

        // Desired behavior: counts enemy as congestion, sees ore1 is occupied, chooses ore2
        expect(myHarvUpdated.harvester.resourceTargetId).toBe('ore2');
    });

    it('should switch target if blocked by an enemy harvester', () => {
        let state = createTestState();

        // Single ore
        state = {
            ...state,
            entities: {
                ...state.entities,
                'ore1': createTestResource({ id: 'ore1', x: 500, y: 500 }),
                'ore2': createTestResource({ id: 'ore2', x: 500, y: 600 }) // Nearby alternative
            } as Record<EntityId, Entity>
        };

        // Enemy harvester blocking the way to ore1
        const enemyHarv = createTestHarvester({ id: 'enemy_harv', owner: 1, x: 500, y: 530 }); // blocking position
        state = {
            ...state,
            entities: {
                ...state.entities,
                'enemy_harv': {
                    ...enemyHarv,
                    harvester: { ...enemyHarv.harvester, resourceTargetId: 'ore1' },
                    movement: { ...enemyHarv.movement, vel: new Vector(0, 0) } // Stationary
                }
            }
        };

        // Our harvester trying to get to ore1
        // We set harvestAttemptTicks high to simulate being stuck for a while
        const myHarv = createTestHarvester({ id: 'my_harv', owner: 0, x: 500, y: 560, manualMode: false });
        state = {
            ...state,
            entities: {
                ...state.entities,
                'my_harv': {
                    ...myHarv,
                    harvester: {
                        ...myHarv.harvester,
                        resourceTargetId: 'ore1',
                        harvestAttemptTicks: 16, // > 15 triggers switch check
                        lastDistToOre: 60,
                        bestDistToOre: 60
                    }
                }
            }
        };

        // Run tick
        const newState = update(state, { type: 'TICK' });
        const myHarvUpdated = newState.entities['my_harv'] as HarvesterUnit;

        // Should switch to ore2 because blocked by enemy
        expect(myHarvUpdated.harvester.resourceTargetId).toBe('ore2');
    });
});

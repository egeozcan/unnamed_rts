
import { describe, it, expect } from 'vitest';
import { GameState, Vector, isActionType } from '../../src/engine/types';
import { computeAiActions } from '../../src/engine/ai/index.js';
import { INITIAL_STATE } from '../../src/engine/reducer';
import { createTestHarvester, createTestCombatUnit, createTestBuilding, createTestResource } from '../../src/engine/test-utils';

function createMockState(): GameState {
    return JSON.parse(JSON.stringify(INITIAL_STATE));
}

describe('AI Harvester Fleeing', () => {
    it('should flee to a safe resource/refinery if current location is threatened', () => {
        const state = { ...createMockState(), tick: 31 }; // tick % 3 === 1 for player 1 AI

        const aiId = 1;

        // Setup Map
        // Zone A (Threatened): Base 1
        const refinery1Pos = new Vector(500, 500);
        const resource1Pos = new Vector(500, 600);

        // Zone B (Safe): Base 2 (Expansion)
        const refinery2Pos = new Vector(2000, 2000);
        const resource2Pos = new Vector(2000, 2100);

        // Add Entities
        state.entities['ref1'] = createTestBuilding({ id: 'ref1', owner: aiId, key: 'refinery', x: refinery1Pos.x, y: refinery1Pos.y });
        state.entities['res1'] = createTestResource({ id: 'res1', x: resource1Pos.x, y: resource1Pos.y });

        state.entities['ref2'] = createTestBuilding({ id: 'ref2', owner: aiId, key: 'refinery', x: refinery2Pos.x, y: refinery2Pos.y });
        state.entities['res2'] = createTestResource({ id: 'res2', x: resource2Pos.x, y: resource2Pos.y });

        // Harvester at Zone A
        const harv = createTestHarvester({ id: 'harv1', owner: aiId, x: resource1Pos.x, y: resource1Pos.y });
        state.entities['harv1'] = harv;

        // Enemy at Zone A (Threatening Harvester)
        state.entities['enemy1'] = createTestCombatUnit({ id: 'enemy1', owner: 0, key: 'heavy', x: resource1Pos.x - 50, y: resource1Pos.y });

        // Run AI
        const actions = computeAiActions(state, aiId);

        // Expectation:
        // Harvester should receive a MOVE command.
        // The target should be closer to Zone B (Safe) than Zone A.
        // Specifically, it should ideally target Resource 2 or Refinery 2 area.

        const moveAction = actions.find(a =>
            isActionType(a, 'COMMAND_MOVE') &&
            a.payload.unitIds.includes(harv.id)
        );

        expect(moveAction).toBeDefined();

        if (moveAction && isActionType(moveAction, 'COMMAND_MOVE')) {
            const dest = new Vector(moveAction.payload.x, moveAction.payload.y);
            const distToSafe = dest.dist(resource2Pos);
            const distToUnsafe = dest.dist(resource1Pos);

            // It should be moving towards the safe zone
            expect(distToSafe).toBeLessThan(distToUnsafe);
            // And significantly closer to safe zone (it shouldn't just run 100px away)
            expect(distToSafe).toBeLessThan(500);
        }
    });
});

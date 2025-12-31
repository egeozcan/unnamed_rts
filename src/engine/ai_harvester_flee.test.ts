
import { describe, it, expect } from 'vitest';
import { GameState, Vector, isActionType } from './types';
import { computeAiActions } from './ai';
import { INITIAL_STATE } from './reducer';

// Mock helpers from previous tests
function createMockState(): GameState {
    return JSON.parse(JSON.stringify(INITIAL_STATE));
}

function addEntity(state: GameState, entity: any) {
    state.entities[entity.id] = entity;
    return entity;
}

function makeEntity(id: string, owner: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE', key: string, x: number, y: number): any {
    return {
        id,
        owner,
        type,
        key,
        pos: new Vector(x, y),
        vel: new Vector(0, 0),
        hp: 100,
        maxHp: 100,
        radius: 10,
        dead: false
    };
}

describe('AI Harvester Fleeing', () => {
    it('should flee to a safe resource/refinery if current location is threatened', () => {
        const state = createMockState();
        (state as any).tick = 30;

        const aiId = 1;

        // Setup Map
        // Zone A (Threatened): Base 1
        const refinery1Pos = new Vector(500, 500);
        const resource1Pos = new Vector(500, 600);

        // Zone B (Safe): Base 2 (Expansion)
        const refinery2Pos = new Vector(2000, 2000);
        const resource2Pos = new Vector(2000, 2100);

        // Add Entities
        addEntity(state, makeEntity('ref1', aiId, 'BUILDING', 'refinery', refinery1Pos.x, refinery1Pos.y));
        addEntity(state, makeEntity('res1', -1, 'RESOURCE', 'gold', resource1Pos.x, resource1Pos.y));

        addEntity(state, makeEntity('ref2', aiId, 'BUILDING', 'refinery', refinery2Pos.x, refinery2Pos.y));
        addEntity(state, makeEntity('res2', -1, 'RESOURCE', 'gold', resource2Pos.x, resource2Pos.y));

        // Harvester at Zone A
        const harv = makeEntity('harv1', aiId, 'UNIT', 'harvester', resource1Pos.x, resource1Pos.y);
        addEntity(state, harv);

        // Enemy at Zone A (Threatening Harvester)
        const enemy = makeEntity('enemy1', 0, 'UNIT', 'tank', resource1Pos.x - 50, resource1Pos.y);
        addEntity(state, enemy);

        // Harvester knows it's being attacked (or threat is detected nearby)
        // harv.lastAttackerId = enemy.id; // Optional if detection works by proximity

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

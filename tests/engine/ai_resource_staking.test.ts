
import { describe, it, expect } from 'vitest';
import { GameState, Vector, isActionType } from '../../src/engine/types';
import { computeAiActions } from '../../src/engine/ai';
import { INITIAL_STATE } from '../../src/engine/reducer';

// Mock helpers
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
        w: 40,
        h: 40,
        dead: false
    };
}

describe('AI Resource Staking', () => {
    it('should NOT build a refinery near a resource that already has an ENEMY refinery', () => {
        const state = createMockState();
        (state as any).tick = 30; // Force AI run

        const aiId = 1;
        const enemyId = 0;

        // Setup Map
        // Conyard
        const conyard = makeEntity('ai_conyard', aiId, 'BUILDING', 'conyard', 500, 500);
        addEntity(state, conyard);

        // Resource A (Near base, but TAKEN by enemy)
        const resA = makeEntity('resA', -1, 'RESOURCE', 'gold', 600, 500);
        addEntity(state, resA);
        // Enemy Refinery at A
        addEntity(state, makeEntity('enemy_ref', enemyId, 'BUILDING', 'refinery', 600, 560));

        // Resource B (Far from base, but FREE)
        const resB = makeEntity('resB', -1, 'RESOURCE', 'gold', 1000, 500);
        addEntity(state, resB);

        // Give AI credits and setup player state
        (state.players[aiId] as any).credits = 2000;
        (state.players[aiId] as any).readyToPlace = 'refinery'; // AI is deciding WHERE to place

        // Run AI - it should generate a PLACE_BUILDING action
        // Since readyToPlace is set, handleBuildingPlacement is called
        const actions = computeAiActions(state, aiId);

        const placeAction = actions.find(a => isActionType(a, 'PLACE_BUILDING') && a.payload.key === 'refinery');

        expect(placeAction).toBeDefined();
        if (placeAction && isActionType(placeAction, 'PLACE_BUILDING')) {
            const placePos = new Vector(placeAction.payload.x, placeAction.payload.y);
            const distToA = placePos.dist(resA.pos);
            const distToB = placePos.dist(resB.pos);

            // Should be closer to B than A
            expect(distToB).toBeLessThan(distToA);
        }
    });
});

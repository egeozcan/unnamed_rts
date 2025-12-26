
import { describe, it, expect } from 'vitest';
import { GameState, Vector } from './types'; // Adjust imports as needed
import { computeAiActions } from './ai'; // You might need to export internal functions or just test public API
import { INITIAL_STATE } from './reducer';

// Mock helpers
function createMockState(): GameState {
    return JSON.parse(JSON.stringify(INITIAL_STATE));
}

function addEntity(state: GameState, entity: any) {
    state.entities[entity.id] = entity;
    return entity;
}

function makeEntity(id: string, owner: number, type: 'UNIT' | 'BUILDING', key: string, x: number, y: number): any {
    return {
        id,
        owner,
        type,
        key,
        pos: new Vector(x, y),
        vel: new Vector(0, 0),
        hp: 100,
        maxHp: 100,
        dealDamage: 10,
        dead: false,
        cooldown: 0,
        rotation: 0,
        radius: 10,
        targetId: null
    };
}

describe('AI Harvester Defense', () => {
    it('should detect when a harvester is under attack and dispatch defenders', () => {
        const state = createMockState();
        (state as any).tick = 30; // Force AI run

        // Setup AI player (1)
        const aiPlayerId = 1;
        const basePos = new Vector(2000, 2000);

        // Add AI buildings to establish base
        // Add AI buildings to establish base
        addEntity(state, makeEntity('ai_conyard', aiPlayerId, 'BUILDING', 'conyard', basePos.x, basePos.y));
        addEntity(state, makeEntity('ai_fact', aiPlayerId, 'BUILDING', 'factory', basePos.x + 50, basePos.y));

        // Add AI Harvester FAR away from base
        const harvester = makeEntity('ai_harv', aiPlayerId, 'UNIT', 'harvester', basePos.x - 1000, basePos.y);
        addEntity(state, harvester);

        // Add AI Combat Unit (defender) near base - but should travel
        const tank = makeEntity('ai_tank', aiPlayerId, 'UNIT', 'light', basePos.x - 50, basePos.y);
        addEntity(state, tank);

        // Add Enemy Unit attacking harvester
        const enemyId = 'enemy_tank';
        const enemy = makeEntity(enemyId, 0, 'UNIT', 'light', harvester.pos.x - 50, harvester.pos.y);
        addEntity(state, enemy);

        // Simulate harvester taking damage from enemy
        harvester.lastAttackerId = enemyId;
        harvester.hp = 80;

        // Run AI
        const actions = computeAiActions(state, aiPlayerId);

        // Check for COMMAND_ATTACK action targeting the enemy
        const attackAction = actions.find(a =>
            a.type === 'COMMAND_ATTACK' &&
            a.payload.targetId === enemyId &&
            a.payload.unitIds.includes(tank.id)
        );

        expect(attackAction).toBeDefined();
    });

    it('should not distract key defenders if threat is minor? (Optional refinement)', () => {
        // This is a placeholder for more advanced logic tests
        expect(true).toBe(true);
    });
});

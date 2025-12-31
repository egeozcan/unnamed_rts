
import { describe, it, expect } from 'vitest';
import { GameState, Vector } from './types';
import { computeAiActions } from './ai';
import { INITIAL_STATE } from './reducer';
import { createTestHarvester, createTestCombatUnit, createTestBuilding } from './test-utils';

function createMockState(): GameState {
    return JSON.parse(JSON.stringify(INITIAL_STATE));
}

describe('AI Harvester Defense', () => {
    it('should detect when a harvester is under attack and dispatch defenders', () => {
        const state = createMockState();
        (state as any).tick = 30; // Force AI run

        // Setup AI player (1)
        const aiPlayerId = 1;
        const basePos = new Vector(2000, 2000);

        // Add AI buildings to establish base
        state.entities['ai_conyard'] = createTestBuilding({ id: 'ai_conyard', owner: aiPlayerId, key: 'conyard', x: basePos.x, y: basePos.y });
        state.entities['ai_fact'] = createTestBuilding({ id: 'ai_fact', owner: aiPlayerId, key: 'factory', x: basePos.x + 50, y: basePos.y });

        // Add AI Harvester FAR away from base, under attack
        const enemyId = 'enemy_tank';
        const harvester = createTestHarvester({
            id: 'ai_harv',
            owner: aiPlayerId,
            x: basePos.x - 1000,
            y: basePos.y,
            hp: 80,
            lastAttackerId: enemyId
        });
        state.entities['ai_harv'] = harvester;

        // Add AI Combat Unit (defender) near base - but should travel
        state.entities['ai_tank'] = createTestCombatUnit({
            id: 'ai_tank',
            owner: aiPlayerId,
            key: 'light',
            x: basePos.x - 50,
            y: basePos.y
        });

        // Add Enemy Unit attacking harvester
        state.entities[enemyId] = createTestCombatUnit({
            id: enemyId,
            owner: 0,
            key: 'light',
            x: harvester.pos.x - 50,
            y: harvester.pos.y
        });

        // Run AI
        const actions = computeAiActions(state, aiPlayerId);

        // Check for COMMAND_ATTACK action targeting the enemy
        const attackAction = actions.find(a =>
            a.type === 'COMMAND_ATTACK' &&
            a.payload.targetId === enemyId &&
            a.payload.unitIds.includes('ai_tank')
        );

        expect(attackAction).toBeDefined();
    });

    it('should not distract key defenders if threat is minor? (Optional refinement)', () => {
        // This is a placeholder for more advanced logic tests
        expect(true).toBe(true);
    });
});

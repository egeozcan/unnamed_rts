import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState } from '../../src/engine/ai';
import { GameState, Entity, HarvesterUnit, Vector } from '../../src/engine/types';
import * as fs from 'fs';
import * as path from 'path';

// Helper to recursively convert {x, y} objects to Vector instances
function convertVectors(obj: any): any {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    // Check if this is a Vector-like object (has x and y, nothing else except maybe inherited)
    if (typeof obj.x === 'number' && typeof obj.y === 'number' && !Array.isArray(obj)) {
        const keys = Object.keys(obj);
        if (keys.length === 2 && keys.includes('x') && keys.includes('y')) {
            return new Vector(obj.x, obj.y);
        }
    }

    // Recursively process object properties
    if (Array.isArray(obj)) {
        return obj.map(convertVectors);
    }

    const result: any = {};
    for (const key of Object.keys(obj)) {
        result[key] = convertVectors(obj[key]);
    }
    return result;
}

describe('Harvester Turret Flee - Real Game State', () => {
    let state: GameState;

    beforeEach(() => {
        resetAIState();
        // Load actual game state
        const statePath = path.join(__dirname, '../fixtures/harvester_flee_turret_scenario.json');
        const stateJson = fs.readFileSync(statePath, 'utf-8');
        const rawState = JSON.parse(stateJson);

        // Convert all {x, y} objects to Vector instances
        state = convertVectors(rawState) as GameState;
    });

    it('should produce flee action for harv_p6 being attacked by turret', () => {
        const harvester = state.entities['harv_p6'] as HarvesterUnit;
        const turret = state.entities['e_8404_24995'] as Entity;

        console.log('=== Initial State ===');
        console.log('Tick:', state.tick);
        console.log('Harvester harv_p6:', {
            hp: harvester.hp,
            maxHp: harvester.maxHp,
            hpPercent: (harvester.hp / harvester.maxHp * 100).toFixed(1) + '%',
            pos: `(${harvester.pos.x.toFixed(0)}, ${harvester.pos.y.toFixed(0)})`,
            vel: harvester.movement.vel,
            moveTarget: harvester.movement.moveTarget,
            lastAttackerId: harvester.combat.lastAttackerId,
            lastDamageTick: harvester.combat.lastDamageTick,
            ticksSinceDamage: state.tick - (harvester.combat.lastDamageTick || 0),
            cargo: harvester.harvester.cargo
        });

        console.log('Turret e_8404_24995:', {
            key: turret.key,
            owner: turret.owner,
            pos: `(${turret.pos.x.toFixed(0)}, ${turret.pos.y.toFixed(0)})`,
            targetId: (turret as any).combat?.targetId,
            dead: turret.dead
        });

        // Calculate distance
        const dist = harvester.pos.dist(turret.pos);
        console.log('Distance harvester to turret:', dist.toFixed(0));

        // Check player 6
        const player6 = state.players[6];
        console.log('Player 6:', {
            credits: player6.credits,
            difficulty: player6.difficulty,
            isAi: player6.isAi
        });

        // Run AI for player 6
        const actions = computeAiActions(state, 6);

        console.log('\n=== AI Actions for Player 6 ===');
        console.log('Total actions:', actions.length);

        // Filter for harvester-related actions
        const harvesterActions = actions.filter(a => {
            if (a.type === 'COMMAND_MOVE' || a.type === 'COMMAND_ATTACK') {
                const payload = a.payload as any;
                return payload.unitIds?.includes('harv_p6');
            }
            return false;
        });

        console.log('Actions involving harv_p6:', harvesterActions);

        // Also check all COMMAND_MOVE actions
        const moveActions = actions.filter(a => a.type === 'COMMAND_MOVE');
        console.log('All COMMAND_MOVE actions:', moveActions.map(a => ({
            type: a.type,
            unitIds: (a.payload as any).unitIds,
            x: (a.payload as any).x?.toFixed?.(0) || (a.payload as any).x,
            y: (a.payload as any).y?.toFixed?.(0) || (a.payload as any).y
        })));

        // The harvester should have a flee command
        expect(harvesterActions.length).toBeGreaterThan(0);
        expect(harvesterActions[0].type).toBe('COMMAND_MOVE');
    });
});

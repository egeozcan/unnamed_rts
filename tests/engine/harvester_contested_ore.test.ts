import { describe, it, expect } from 'vitest';
import { GameState, Vector } from '../../src/engine/types';
import { HarvesterUnit } from '../../src/engine/entity_types';
import { tick, INITIAL_STATE } from '../../src/engine/reducer';
import { createTestHarvester, createTestBuilding } from '../../src/engine/test-utils';

function createTestState(): GameState {
    const state: GameState = JSON.parse(JSON.stringify(INITIAL_STATE));
    state.running = true;
    (state as any).tick = 100;

    // Ensure player 2 exists for enemy detection
    if (!state.players[2]) {
        state.players[2] = {
            credits: 1000,
            power: { produced: 100, consumed: 0 },
            buildingQueue: [],
            infantryQueue: [],
            vehicleQueue: [],
            airQueue: [],
        };
    }

    // Player 1's conyard (needed for AI)
    state.entities['cy_p1'] = createTestBuilding({
        id: 'cy_p1',
        owner: 1,
        key: 'conyard',
        x: 200,
        y: 200,
    });

    // Player 2's conyard
    state.entities['cy_p2'] = createTestBuilding({
        id: 'cy_p2',
        owner: 2,
        key: 'conyard',
        x: 800,
        y: 800,
    });

    // Player 1's refinery (for safe spot)
    state.entities['ref_p1'] = createTestBuilding({
        id: 'ref_p1',
        owner: 1,
        key: 'refinery',
        x: 250,
        y: 200,
    });

    // Contested ore at position (500, 500)
    state.entities['ore_contested'] = {
        id: 'ore_contested',
        owner: -1,
        type: 'RESOURCE',
        key: 'ore',
        pos: new Vector(500, 500),
        prevPos: new Vector(500, 500),
        hp: 1000,
        maxHp: 1000,
        w: 25,
        h: 25,
        radius: 12,
        dead: false,
    };

    // Safe ore near player 1's base
    state.entities['ore_safe'] = {
        id: 'ore_safe',
        owner: -1,
        type: 'RESOURCE',
        key: 'ore',
        pos: new Vector(300, 250),
        prevPos: new Vector(300, 250),
        hp: 1000,
        maxHp: 1000,
        w: 25,
        h: 25,
        radius: 12,
        dead: false,
    };

    // Player 1's harvester - low HP, near contested ore, has been trying to harvest
    state.entities['harv_p1'] = createTestHarvester({
        id: 'harv_p1',
        owner: 1,
        x: 510,
        y: 510,
        hp: 280, // 28% HP - below 30% threshold
        lastAttackerId: 'harv_p2', // Was attacked by enemy harvester
        lastDamageTick: 95, // Recently damaged (5 ticks ago from tick 100)
        resourceTargetId: 'ore_contested',
        harvestAttemptTicks: 5, // Has been trying to harvest for 5 ticks
    });

    // Player 2's harvester - also targeting the contested ore
    state.entities['harv_p2'] = createTestHarvester({
        id: 'harv_p2',
        owner: 2,
        x: 490,
        y: 490,
        hp: 800,
        resourceTargetId: 'ore_contested',
    });

    return state;
}

describe('Harvester Contested Ore', () => {
    it('should mark ore as contested when taking damage near it (Layer 1)', () => {
        let state = createTestState();

        // Advance a few ticks - the contested ore detection should trigger
        for (let i = 0; i < 10; i++) {
            state = tick(state);
        }

        const harv = state.entities['harv_p1'] as HarvesterUnit;

        // The harvester should have marked the ore as blocked due to damage
        expect(harv.harvester.blockedOreId).toBe('ore_contested');
        expect(harv.harvester.blockedOreTimer).toBeGreaterThan(0);
        // Should have found a new ore target (the safe ore) or be looking for one
        // The key is that it's NOT targeting the contested ore anymore
        expect(harv.harvester.resourceTargetId).not.toBe('ore_contested');
    });

    it('should stop targeting contested ore after blocking it', () => {
        let state = createTestState();

        // Verify initial state - targeting contested ore
        let harv = state.entities['harv_p1'] as HarvesterUnit;
        expect(harv.harvester.resourceTargetId).toBe('ore_contested');

        // Advance ticks to trigger contested ore detection
        for (let i = 0; i < 10; i++) {
            state = tick(state);
        }

        harv = state.entities['harv_p1'] as HarvesterUnit;

        // The harvester should no longer target the contested ore
        expect(harv.harvester.resourceTargetId).not.toBe('ore_contested');
        // The contested ore should be in the blocked list
        expect(harv.harvester.blockedOreId).toBe('ore_contested');
    });
});

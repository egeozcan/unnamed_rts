import { describe, it, expect } from 'vitest';
import { GameState, Vector } from '../../src/engine/types';
import { HarvesterUnit } from '../../src/engine/entity_types';
import { tick, INITIAL_STATE } from '../../src/engine/reducer';
import { createTestHarvester, createTestBuilding } from '../../src/engine/test-utils';

function createTestState(): GameState {
    const baseState: GameState = JSON.parse(JSON.stringify(INITIAL_STATE));
    const state = { ...baseState, running: true, tick: 100 };

    // Ensure player 1 exists
    if (!state.players[1]) {
        state.players[1] = {
            credits: 1000,
            power: { produced: 100, consumed: 0 },
            buildingQueue: [],
            infantryQueue: [],
            vehicleQueue: [],
            airQueue: [],
        };
    }

    // Ensure player 2 exists (for enemy harvesters)
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

    // Player 1's conyard
    state.entities['cy_p1'] = createTestBuilding({
        id: 'cy_p1',
        owner: 1,
        key: 'conyard',
        x: 200,
        y: 200,
    });

    // Player 1's refinery
    state.entities['ref_p1'] = createTestBuilding({
        id: 'ref_p1',
        owner: 1,
        key: 'refinery',
        x: 250,
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

    return state;
}

describe('Harvester All Contested Ore Fallback', () => {
    it('should find least contested ore when all ore has 2+ harvesters', () => {
        let state = createTestState();

        // Create 3 ore patches
        state.entities['ore1'] = {
            id: 'ore1',
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

        state.entities['ore2'] = {
            id: 'ore2',
            owner: -1,
            type: 'RESOURCE',
            key: 'ore',
            pos: new Vector(600, 500),
            prevPos: new Vector(600, 500),
            hp: 1000,
            maxHp: 1000,
            w: 25,
            h: 25,
            radius: 12,
            dead: false,
        };

        state.entities['ore3'] = {
            id: 'ore3',
            owner: -1,
            type: 'RESOURCE',
            key: 'ore',
            pos: new Vector(700, 500), // Closest to our test harvester
            prevPos: new Vector(700, 500),
            hp: 1000,
            maxHp: 1000,
            w: 25,
            h: 25,
            radius: 12,
            dead: false,
        };

        // Create 2 harvesters targeting ore1 (MAX_HARVESTERS_PER_ORE = 2)
        state.entities['harv_a1'] = createTestHarvester({
            id: 'harv_a1',
            owner: 2,
            x: 490,
            y: 500,
            resourceTargetId: 'ore1',
        });
        state.entities['harv_a2'] = createTestHarvester({
            id: 'harv_a2',
            owner: 2,
            x: 510,
            y: 500,
            resourceTargetId: 'ore1',
        });

        // Create 2 harvesters targeting ore2
        state.entities['harv_b1'] = createTestHarvester({
            id: 'harv_b1',
            owner: 2,
            x: 590,
            y: 500,
            resourceTargetId: 'ore2',
        });
        state.entities['harv_b2'] = createTestHarvester({
            id: 'harv_b2',
            owner: 2,
            x: 610,
            y: 500,
            resourceTargetId: 'ore2',
        });

        // Create 2 harvesters targeting ore3
        state.entities['harv_c1'] = createTestHarvester({
            id: 'harv_c1',
            owner: 2,
            x: 690,
            y: 500,
            resourceTargetId: 'ore3',
        });
        state.entities['harv_c2'] = createTestHarvester({
            id: 'harv_c2',
            owner: 2,
            x: 710,
            y: 500,
            resourceTargetId: 'ore3',
        });

        // Our test harvester - no target, needs to find one
        // All 3 ore patches have 2 harvesters each (at the limit)
        state.entities['harv_test'] = createTestHarvester({
            id: 'harv_test',
            owner: 1,
            x: 750,
            y: 500,
            resourceTargetId: null, // No target
            cargo: 0,
        });

        // Run a few ticks
        for (let i = 0; i < 5; i++) {
            state = tick(state);
        }

        const harv = state.entities['harv_test'] as HarvesterUnit;

        // Should have found a target despite all ore being "contested"
        // The fallback should pick one of the ore patches (all have 2 harvesters)
        expect(harv.harvester.resourceTargetId).not.toBeNull();
        expect(['ore1', 'ore2', 'ore3']).toContain(harv.harvester.resourceTargetId);
    });

    it('should prefer ore with fewer harvesters in fallback', () => {
        let state = createTestState();

        // Create 2 ore patches
        state.entities['ore_busy'] = {
            id: 'ore_busy',
            owner: -1,
            type: 'RESOURCE',
            key: 'ore',
            pos: new Vector(500, 500), // Closer to test harvester
            prevPos: new Vector(500, 500),
            hp: 1000,
            maxHp: 1000,
            w: 25,
            h: 25,
            radius: 12,
            dead: false,
        };

        state.entities['ore_less_busy'] = {
            id: 'ore_less_busy',
            owner: -1,
            type: 'RESOURCE',
            key: 'ore',
            pos: new Vector(800, 500), // Further from test harvester
            prevPos: new Vector(800, 500),
            hp: 1000,
            maxHp: 1000,
            w: 25,
            h: 25,
            radius: 12,
            dead: false,
        };

        // 3 harvesters targeting ore_busy (heavily contested)
        state.entities['harv_a1'] = createTestHarvester({
            id: 'harv_a1',
            owner: 2,
            x: 490,
            y: 500,
            resourceTargetId: 'ore_busy',
        });
        state.entities['harv_a2'] = createTestHarvester({
            id: 'harv_a2',
            owner: 2,
            x: 510,
            y: 500,
            resourceTargetId: 'ore_busy',
        });
        state.entities['harv_a3'] = createTestHarvester({
            id: 'harv_a3',
            owner: 2,
            x: 500,
            y: 510,
            resourceTargetId: 'ore_busy',
        });

        // Only 2 harvesters targeting ore_less_busy
        state.entities['harv_b1'] = createTestHarvester({
            id: 'harv_b1',
            owner: 2,
            x: 790,
            y: 500,
            resourceTargetId: 'ore_less_busy',
        });
        state.entities['harv_b2'] = createTestHarvester({
            id: 'harv_b2',
            owner: 2,
            x: 810,
            y: 500,
            resourceTargetId: 'ore_less_busy',
        });

        // Test harvester near ore_busy but should prefer ore_less_busy
        state.entities['harv_test'] = createTestHarvester({
            id: 'harv_test',
            owner: 1,
            x: 520,
            y: 500,
            resourceTargetId: null,
            cargo: 0,
        });

        for (let i = 0; i < 5; i++) {
            state = tick(state);
        }

        const harv = state.entities['harv_test'] as HarvesterUnit;

        // Should prefer ore_less_busy (2 harvesters) over ore_busy (3 harvesters)
        // even though ore_busy is closer
        expect(harv.harvester.resourceTargetId).toBe('ore_less_busy');
    });

    it('should reset harvestAttemptTicks when finding new target', () => {
        let state = createTestState();

        // Single ore patch
        state.entities['ore1'] = {
            id: 'ore1',
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

        // Harvester with stale harvestAttemptTicks from previous target
        state.entities['harv_test'] = createTestHarvester({
            id: 'harv_test',
            owner: 1,
            x: 400,
            y: 500,
            resourceTargetId: null, // No current target
            cargo: 0,
            harvestAttemptTicks: 25, // Stale value from previous target
        });

        // Single tick should find ore and reset harvestAttemptTicks
        state = tick(state);

        const harv = state.entities['harv_test'] as HarvesterUnit;

        // Should have found the ore
        expect(harv.harvester.resourceTargetId).toBe('ore1');
        // harvestAttemptTicks should be reset (0 or very low from the tick)
        expect(harv.harvester.harvestAttemptTicks).toBeLessThanOrEqual(1);
    });

    it('should not freeze when damaged near ore with stale harvestAttemptTicks', () => {
        let state = createTestState();

        // Ore very close to harvester
        state.entities['ore1'] = {
            id: 'ore1',
            owner: -1,
            type: 'RESOURCE',
            key: 'ore',
            pos: new Vector(510, 500), // Only 10px from harvester
            prevPos: new Vector(510, 500),
            hp: 1000,
            maxHp: 1000,
            w: 25,
            h: 25,
            radius: 12,
            dead: false,
        };

        // Another ore patch further away
        state.entities['ore2'] = {
            id: 'ore2',
            owner: -1,
            type: 'RESOURCE',
            key: 'ore',
            pos: new Vector(700, 500),
            prevPos: new Vector(700, 500),
            hp: 1000,
            maxHp: 1000,
            w: 25,
            h: 25,
            radius: 12,
            dead: false,
        };

        // Harvester that was recently damaged, very close to ore,
        // with stale harvestAttemptTicks (simulating the bug scenario)
        state.entities['harv_test'] = createTestHarvester({
            id: 'harv_test',
            owner: 1,
            x: 500,
            y: 500,
            resourceTargetId: null, // Lost target
            cargo: 0,
            harvestAttemptTicks: 15, // Stale value
            lastDamageTick: 95, // Recently damaged (5 ticks ago)
            lastAttackerId: 'enemy',
        });

        // Run several ticks
        let foundTarget = false;
        let harvestedSomething = false;
        const initialCargo = 0;

        for (let i = 0; i < 60; i++) {
            state = tick(state);
            const harv = state.entities['harv_test'] as HarvesterUnit;

            if (harv.harvester.resourceTargetId) {
                foundTarget = true;
            }
            if (harv.harvester.cargo > initialCargo) {
                harvestedSomething = true;
                break;
            }
        }

        // The harvester should eventually find ore and harvest
        // (not stay frozen due to stale harvestAttemptTicks triggering contested logic)
        expect(foundTarget).toBe(true);
        expect(harvestedSomething).toBe(true);
    });

    it('should return to base with partial cargo when no ore is available', () => {
        let state = createTestState();

        // Player 1's refinery (needed to return cargo)
        state.entities['ref_p1'] = createTestBuilding({
            id: 'ref_p1',
            owner: 1,
            key: 'refinery',
            x: 300,
            y: 200,
        });

        // Harvester with partial cargo but no ore anywhere
        state.entities['harv_test'] = createTestHarvester({
            id: 'harv_test',
            owner: 1,
            x: 500,
            y: 500,
            resourceTargetId: null,
            cargo: 200, // Partial cargo (> 50)
            manualMode: false, // Auto-harvest mode
        });

        // No ore in the game - harvester should return to base with partial cargo

        // Run several ticks
        for (let i = 0; i < 10; i++) {
            state = tick(state);
        }

        const harv = state.entities['harv_test'] as HarvesterUnit;

        // Should be heading to refinery with partial cargo
        expect(harv.harvester.baseTargetId).toBe('ref_p1');
    });

    it('should NOT return to base with partial cargo if in manual mode', () => {
        let state = createTestState();

        state.entities['ref_p1'] = createTestBuilding({
            id: 'ref_p1',
            owner: 1,
            key: 'refinery',
            x: 300,
            y: 200,
        });

        // Harvester with partial cargo but in manual mode (player commanded move)
        state.entities['harv_test'] = createTestHarvester({
            id: 'harv_test',
            owner: 1,
            x: 500,
            y: 500,
            resourceTargetId: null,
            cargo: 200,
            manualMode: true, // Player issued move command
        });

        // Run several ticks
        for (let i = 0; i < 10; i++) {
            state = tick(state);
        }

        const harv = state.entities['harv_test'] as HarvesterUnit;

        // Should NOT be heading to refinery because manual mode is on
        expect(harv.harvester.baseTargetId).toBeNull();
    });
});

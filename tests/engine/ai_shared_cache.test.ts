import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { computeAiActions } from '../../src/engine/ai/index.js';
import { resetAIState } from '../../src/engine/ai/state.js';
import { createEntityCache } from '../../src/engine/perf.js';
import { createInitialHarvesterAIState, updateHarvesterAI } from '../../src/engine/ai/harvester/index.js';
import { Entity, EntityId, GameState } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit, createTestHarvester, createTestResource } from '../../src/engine/test-utils.js';

function createClassicScenarioState(): GameState {
    const entities: Record<EntityId, Entity> = {
        ai_conyard: createTestBuilding({ id: 'ai_conyard', owner: 1, key: 'conyard', x: 300, y: 300 }),
        ai_power: createTestBuilding({ id: 'ai_power', owner: 1, key: 'power', x: 360, y: 300 }),
        ai_refinery: createTestBuilding({ id: 'ai_refinery', owner: 1, key: 'refinery', x: 310, y: 370 }),
        ai_barracks: createTestBuilding({ id: 'ai_barracks', owner: 1, key: 'barracks', x: 390, y: 350 }),
        ai_factory: createTestBuilding({ id: 'ai_factory', owner: 1, key: 'factory', x: 440, y: 360 }),
        ai_harvester: createTestHarvester({ id: 'ai_harvester', owner: 1, x: 450, y: 450 }),
        enemy_conyard: createTestBuilding({ id: 'enemy_conyard', owner: 0, key: 'conyard', x: 2300, y: 2200 }),
        enemy_tank: createTestCombatUnit({ id: 'enemy_tank', owner: 0, key: 'light', x: 2100, y: 2100 }),
        ore_1: createTestResource({ id: 'ore_1', x: 520, y: 440 })
    };

    return {
        ...INITIAL_STATE,
        running: true,
        tick: 31,
        entities,
        players: {
            0: createPlayerState(0, false, 'medium', '#44aaff'),
            1: {
                ...createPlayerState(1, true, 'hard', '#ff4444'),
                credits: 3000
            }
        }
    };
}

function createHarvesterScenarioState(): GameState {
    const entities: Record<EntityId, Entity> = {
        h1: createTestHarvester({ id: 'h1', owner: 1, x: 140, y: 120 }),
        r1: createTestBuilding({ id: 'r1', owner: 1, key: 'refinery', x: 220, y: 220 }),
        ore_1: createTestResource({ id: 'ore_1', x: 320, y: 280 }),
        enemy_1: createTestCombatUnit({ id: 'enemy_1', owner: 2, key: 'heavy', x: 360, y: 300 })
    };

    return {
        ...INITIAL_STATE,
        running: true,
        tick: 90,
        entities,
        players: {
            1: createPlayerState(1, true, 'hard', '#ff4444'),
            2: createPlayerState(2, true, 'hard', '#44ff88')
        }
    };
}

function snapshotHarvesterState(result: ReturnType<typeof updateHarvesterAI>): object {
    return {
        actions: result.actions,
        dangerMapLastUpdate: result.harvesterAI.dangerMapLastUpdate,
        desperationScore: result.harvesterAI.desperationScore,
        harvesterRoles: Array.from(result.harvesterAI.harvesterRoles.entries()),
        oreFieldClaims: Array.from(result.harvesterAI.oreFieldClaims.entries()),
        refineryQueue: Array.from(result.harvesterAI.refineryQueue.entries()),
        escortAssignments: Array.from(result.harvesterAI.escortAssignments.entries()),
        blacklistedOre: Array.from(result.harvesterAI.blacklistedOre.entries()),
        stuckStates: Array.from(result.harvesterAI.stuckStates.entries()),
        harvesterDeaths: [...result.harvesterAI.harvesterDeaths]
    };
}

describe('AI shared cache parity', () => {
    beforeEach(() => {
        resetAIState();
    });

    it('produces identical actions with shared cache and fallback cache paths', () => {
        const state = createClassicScenarioState();

        resetAIState();
        const fallbackActions = computeAiActions(state, 1);

        resetAIState();
        const sharedActions = computeAiActions(state, 1, createEntityCache(state.entities));

        expect(sharedActions).toEqual(fallbackActions);
    });

    it('keeps harvester orchestrator behavior identical when shared cache is provided', () => {
        const state = createHarvesterScenarioState();
        const baseHarvesterAI = createInitialHarvesterAIState();

        const fallback = updateHarvesterAI(
            createInitialHarvesterAIState(),
            1,
            state,
            'hard'
        );
        const shared = updateHarvesterAI(
            baseHarvesterAI,
            1,
            state,
            'hard',
            createEntityCache(state.entities)
        );

        expect(snapshotHarvesterState(shared)).toEqual(snapshotHarvesterState(fallback));
    });
});

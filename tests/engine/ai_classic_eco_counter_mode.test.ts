import { describe, it, expect, beforeEach } from 'vitest';
import { computeClassicAiActions } from '../../src/engine/ai/implementations/classic/index.js';
import { resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { GameState, Entity, EntityId, UnitKey, BuildingKey, isActionType } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit, createTestHarvester } from '../../src/engine/test-utils.js';

const { getAIState } = _testUtils;

function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING',
    key: string,
    x: number,
    y: number
): Entity {
    if (type === 'BUILDING') {
        return createTestBuilding({ id, owner, key: key as BuildingKey, x, y });
    }

    if (key === 'harvester') {
        return createTestHarvester({ id, owner, x, y });
    }

    return createTestCombatUnit({
        id,
        owner,
        key: key as Exclude<UnitKey, 'harvester' | 'harrier'>,
        x,
        y
    });
}

function createState(): GameState {
    const entities: Record<EntityId, Entity> = {
        ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
        ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 360, 300),
        ai_refinery_1: createEntity('ai_refinery_1', 1, 'BUILDING', 'refinery', 300, 380),
        ai_refinery_2: createEntity('ai_refinery_2', 1, 'BUILDING', 'refinery', 240, 420),
        ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
        ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
        ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 430),
        ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 380, 430),
        enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200),
        enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 2240, 2260),
        enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2200, 2150),
        enemy_harv_1: createEntity('enemy_harv_1', 0, 'UNIT', 'harvester', 2300, 2320),
        enemy_tank: createEntity('enemy_tank', 0, 'UNIT', 'heavy', 2260, 2220)
    };

    return {
        ...INITIAL_STATE,
        running: true,
        tick: 1201,
        entities,
        players: {
            0: createPlayerState(0, true, 'hard', '#4488ff', 'eco_tank_all_in'),
            1: createPlayerState(1, true, 'hard', '#ff4444', 'classic')
        }
    };
}

describe('Classic AI eco counter mode', () => {
    beforeEach(() => {
        resetAIState();
    });

    it('avoids expansion/tech spending when facing eco_tank_all_in', () => {
        const state = createState();
        const actions = computeClassicAiActions(state, 1);

        const forbiddenBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            (
                action.payload.category === 'air' ||
                (action.payload.category === 'vehicle' &&
                    ['mcv', 'induction_rig', 'demo_truck'].includes(action.payload.key)) ||
                (action.payload.category === 'infantry' && action.payload.key === 'engineer') ||
                (action.payload.category === 'building' &&
                    ['airforce_command', 'tech'].includes(action.payload.key))
            )
        );

        expect(forbiddenBuild).toBeUndefined();
    });

    it('forces early pressure when eco all-in has low defenses', () => {
        const state = createState();
        state.tick = 721;
        state.entities.ai_light_1 = createEntity('ai_light_1', 1, 'UNIT', 'light', 470, 420);
        state.entities.ai_light_2 = createEntity('ai_light_2', 1, 'UNIT', 'light', 520, 420);

        const actions = computeClassicAiActions(state, 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).toBe('attack');
        expect(actions.some(action => action.type === 'COMMAND_ATTACK')).toBe(true);
    });
});

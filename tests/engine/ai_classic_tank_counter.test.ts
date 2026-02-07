import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { GameState, Entity, EntityId, UnitKey, BuildingKey, isActionType } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit, createTestHarvester } from '../../src/engine/test-utils.js';

const { getAIState, setPersonalityForPlayer } = _testUtils;

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

function createTestState(entities: Record<EntityId, Entity>, tick: number = 601): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        tick,
        entities,
        players: {
            0: createPlayerState(0, true, 'hard', '#4488ff'),
            1: createPlayerState(1, true, 'hard', '#ff4444', 'classic')
        }
    };
}

describe('Classic AI anti-tank infantry counter', () => {
    beforeEach(() => {
        resetAIState();
        setPersonalityForPlayer(1, 'balanced');
    });

    it('prioritizes rocket infantry when enemy has clear tank advantage', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 350, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 380),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 380, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 460, 440),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 500, 440),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 520, 430),

            enemy_tank_1: createEntity('enemy_tank_1', 0, 'UNIT', 'heavy', 2200, 2200),
            enemy_tank_2: createEntity('enemy_tank_2', 0, 'UNIT', 'heavy', 2240, 2200),
            enemy_tank_3: createEntity('enemy_tank_3', 0, 'UNIT', 'heavy', 2280, 2200),
            enemy_tank_4: createEntity('enemy_tank_4', 0, 'UNIT', 'light', 2200, 2240),
            enemy_tank_5: createEntity('enemy_tank_5', 0, 'UNIT', 'light', 2240, 2240)
        };

        const state = createTestState(entities, 601);
        const aiState = getAIState(1);
        aiState.lastProductionType = 'infantry'; // Would normally prefer vehicle this cycle

        const actions = computeAiActions(state, 1);

        const infantryBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') && action.payload.category === 'infantry'
        );
        expect(infantryBuild).toBeDefined();
        if (infantryBuild && isActionType(infantryBuild, 'START_BUILD')) {
            expect(infantryBuild.payload.key).toBe('rocket');
        }
    });

    it('does not force rocket infantry when tank advantage is not clear', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 350, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 380),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 380, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 460, 440),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 500, 440),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 520, 430),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'heavy', 560, 430),

            enemy_tank_1: createEntity('enemy_tank_1', 0, 'UNIT', 'heavy', 2200, 2200),
            enemy_tank_2: createEntity('enemy_tank_2', 0, 'UNIT', 'heavy', 2240, 2200)
        };

        const state = createTestState(entities, 601);
        const aiState = getAIState(1);
        aiState.lastProductionType = 'infantry'; // Normal staggered logic should pick vehicle

        const actions = computeAiActions(state, 1);

        const rocketInfantryBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'infantry' &&
            action.payload.key === 'rocket'
        );
        const vehicleBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') && action.payload.category === 'vehicle'
        );

        expect(rocketInfantryBuild).toBeUndefined();
        expect(vehicleBuild).toBeDefined();
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { GameState, Entity, EntityId, UnitKey, BuildingKey } from '../../src/engine/types.js';
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

function createTestState(entities: Record<EntityId, Entity>, tick: number = 901): GameState {
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

describe('Classic AI greedy enemy rush', () => {
    beforeEach(() => {
        resetAIState();
        setPersonalityForPlayer(1, 'turtle');
    });

    it('rushes enemies that have no combat units/defenses and are not producing them', () => {
        const entities: Record<EntityId, Entity> = {
            // Classic AI base and small early army
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 340, 360),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 400, 330),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 380),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 470, 430),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 500, 430),
            ai_tank_3: createEntity('ai_tank_3', 1, 'UNIT', 'light', 530, 430),

            // Greedy enemy: eco/production only, no combat and no defenses
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 2240, 2260),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 2180, 2260),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2260, 2200),
            enemy_harv_1: createEntity('enemy_harv_1', 0, 'UNIT', 'harvester', 2300, 2320),
            enemy_harv_2: createEntity('enemy_harv_2', 0, 'UNIT', 'harvester', 2320, 2300)
        };

        const state = createTestState(entities, 901);
        const actions = computeAiActions(state, 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).toBe('attack');
        expect(aiState.attackGroup.length).toBeGreaterThanOrEqual(3);
        expect(aiState.enemyBaseLocation).toBeTruthy();

        const attackIssued = actions.some(a => a.type === 'COMMAND_ATTACK');
        expect(attackIssued).toBe(true);
    });

    it('does not force rush if enemy has static defenses', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 340, 360),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 400, 330),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 380),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 470, 430),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 500, 430),
            ai_tank_3: createEntity('ai_tank_3', 1, 'UNIT', 'light', 530, 430),

            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 2240, 2260),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 2180, 2260),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2260, 2200),
            enemy_turret: createEntity('enemy_turret', 0, 'BUILDING', 'turret', 2190, 2190)
        };

        const state = createTestState(entities, 901);
        computeAiActions(state, 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).not.toBe('attack');
    });

    it('does not force rush if enemy is already producing combat units', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 340, 360),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 400, 330),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 380),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 470, 430),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 500, 430),
            ai_tank_3: createEntity('ai_tank_3', 1, 'UNIT', 'light', 530, 430),

            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 2240, 2260),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 2180, 2260),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2260, 2200)
        };

        const baseState = createTestState(entities, 901);
        const state: GameState = {
            ...baseState,
            players: {
                ...baseState.players,
                0: {
                    ...baseState.players[0],
                    queues: {
                        ...baseState.players[0].queues,
                        vehicle: { current: 'light', progress: 0, invested: 0, queued: [] }
                    }
                }
            }
        };

        computeAiActions(state, 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).not.toBe('attack');
    });
});

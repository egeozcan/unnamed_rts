import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { GameState, Entity, EntityId, UnitKey, BuildingKey } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit, createTestHarvester, createTestResource } from '../../src/engine/test-utils.js';

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

function createTestState(entities: Record<EntityId, Entity>, tick: number = 1201): GameState {
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

describe('Classic AI anti-boom counter-strategy', () => {
    beforeEach(() => {
        resetAIState();
        setPersonalityForPlayer(1, 'turtle');
    });

    it('boom rushes enemy with heavy eco and few combat units', () => {
        const entities: Record<EntityId, Entity> = {
            // Classic AI base and army
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 340, 360),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 400, 330),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 380),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 470, 430),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 500, 430),
            ai_tank_3: createEntity('ai_tank_3', 1, 'UNIT', 'light', 530, 430),
            ai_tank_4: createEntity('ai_tank_4', 1, 'UNIT', 'medium', 560, 430),

            // Booming enemy: 4 refineries, 8 harvesters, 1 combat unit
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200),
            enemy_ref_1: createEntity('enemy_ref_1', 0, 'BUILDING', 'refinery', 2240, 2260),
            enemy_ref_2: createEntity('enemy_ref_2', 0, 'BUILDING', 'refinery', 2180, 2260),
            enemy_ref_3: createEntity('enemy_ref_3', 0, 'BUILDING', 'refinery', 2260, 2200),
            enemy_ref_4: createEntity('enemy_ref_4', 0, 'BUILDING', 'refinery', 2300, 2200),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 2150, 2200),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2200, 2150),
            enemy_harv_1: createEntity('enemy_harv_1', 0, 'UNIT', 'harvester', 2300, 2320),
            enemy_harv_2: createEntity('enemy_harv_2', 0, 'UNIT', 'harvester', 2320, 2300),
            enemy_harv_3: createEntity('enemy_harv_3', 0, 'UNIT', 'harvester', 2340, 2320),
            enemy_harv_4: createEntity('enemy_harv_4', 0, 'UNIT', 'harvester', 2360, 2300),
            enemy_harv_5: createEntity('enemy_harv_5', 0, 'UNIT', 'harvester', 2380, 2320),
            enemy_harv_6: createEntity('enemy_harv_6', 0, 'UNIT', 'harvester', 2400, 2300),
            enemy_harv_7: createEntity('enemy_harv_7', 0, 'UNIT', 'harvester', 2420, 2320),
            enemy_harv_8: createEntity('enemy_harv_8', 0, 'UNIT', 'harvester', 2440, 2300),
            // Only 1 combat unit - we outnumber them
            enemy_tank_1: createEntity('enemy_tank_1', 0, 'UNIT', 'light', 2200, 2280)
        };

        const state = createTestState(entities, 1201);
        const actions = computeAiActions(state, 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).toBe('attack');
        expect(aiState.attackGroup.length).toBeGreaterThanOrEqual(3);
        expect(aiState.enemyBaseLocation).toBeTruthy();

        const attackIssued = actions.some(a => a.type === 'COMMAND_ATTACK');
        expect(attackIssued).toBe(true);
    });

    it('does not boom rush when enemy has matching army size', () => {
        const entities: Record<EntityId, Entity> = {
            // Classic AI base and army (4 units)
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 340, 360),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 400, 330),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 380),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 470, 430),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 500, 430),
            ai_tank_3: createEntity('ai_tank_3', 1, 'UNIT', 'light', 530, 430),

            // Booming enemy but with matching army
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200),
            enemy_ref_1: createEntity('enemy_ref_1', 0, 'BUILDING', 'refinery', 2240, 2260),
            enemy_ref_2: createEntity('enemy_ref_2', 0, 'BUILDING', 'refinery', 2180, 2260),
            enemy_ref_3: createEntity('enemy_ref_3', 0, 'BUILDING', 'refinery', 2260, 2200),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 2150, 2200),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2200, 2150),
            enemy_harv_1: createEntity('enemy_harv_1', 0, 'UNIT', 'harvester', 2300, 2320),
            enemy_harv_2: createEntity('enemy_harv_2', 0, 'UNIT', 'harvester', 2320, 2300),
            enemy_harv_3: createEntity('enemy_harv_3', 0, 'UNIT', 'harvester', 2340, 2320),
            enemy_harv_4: createEntity('enemy_harv_4', 0, 'UNIT', 'harvester', 2360, 2300),
            // 3 combat units = matches our army
            enemy_tank_1: createEntity('enemy_tank_1', 0, 'UNIT', 'light', 2200, 2280),
            enemy_tank_2: createEntity('enemy_tank_2', 0, 'UNIT', 'light', 2220, 2280),
            enemy_tank_3: createEntity('enemy_tank_3', 0, 'UNIT', 'light', 2240, 2280)
        };

        const state = createTestState(entities, 1201);
        computeAiActions(state, 1);
        const aiState = getAIState(1);

        // Should not be forced into attack by boom rush
        // (may still attack via normal strategy if thresholds met, but not from boom rush specifically)
        // The key check is that vengeance wasn't boosted by boom rush
        expect(aiState.vengeanceScores[0] || 0).toBeLessThan(200);
    });

    it('does not boom rush when enemy has 2+ defenses', () => {
        const entities: Record<EntityId, Entity> = {
            // Classic AI base and army
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 340, 360),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 400, 330),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 380),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 470, 430),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 500, 430),
            ai_tank_3: createEntity('ai_tank_3', 1, 'UNIT', 'light', 530, 430),

            // Booming enemy with 2 defense buildings
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200),
            enemy_ref_1: createEntity('enemy_ref_1', 0, 'BUILDING', 'refinery', 2240, 2260),
            enemy_ref_2: createEntity('enemy_ref_2', 0, 'BUILDING', 'refinery', 2180, 2260),
            enemy_ref_3: createEntity('enemy_ref_3', 0, 'BUILDING', 'refinery', 2260, 2200),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 2150, 2200),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2200, 2150),
            enemy_turret_1: createEntity('enemy_turret_1', 0, 'BUILDING', 'turret', 2190, 2190),
            enemy_turret_2: createEntity('enemy_turret_2', 0, 'BUILDING', 'turret', 2210, 2190),
            enemy_harv_1: createEntity('enemy_harv_1', 0, 'UNIT', 'harvester', 2300, 2320),
            enemy_harv_2: createEntity('enemy_harv_2', 0, 'UNIT', 'harvester', 2320, 2300),
            enemy_harv_3: createEntity('enemy_harv_3', 0, 'UNIT', 'harvester', 2340, 2320),
            enemy_harv_4: createEntity('enemy_harv_4', 0, 'UNIT', 'harvester', 2360, 2300)
        };

        const state = createTestState(entities, 1201);
        computeAiActions(state, 1);
        const aiState = getAIState(1);

        // Vengeance should not be boosted by boom rush
        expect(aiState.vengeanceScores[0] || 0).toBeLessThan(200);
    });

    it('does not boom rush before tick 1200', () => {
        const entities: Record<EntityId, Entity> = {
            // Classic AI base and army
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 340, 360),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 400, 330),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 380),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 470, 430),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 500, 430),
            ai_tank_3: createEntity('ai_tank_3', 1, 'UNIT', 'light', 530, 430),

            // Booming enemy with 1 combat unit (prevents greedy rush, but boom rush would trigger at tick 1200+)
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200),
            enemy_ref_1: createEntity('enemy_ref_1', 0, 'BUILDING', 'refinery', 2240, 2260),
            enemy_ref_2: createEntity('enemy_ref_2', 0, 'BUILDING', 'refinery', 2180, 2260),
            enemy_ref_3: createEntity('enemy_ref_3', 0, 'BUILDING', 'refinery', 2260, 2200),
            enemy_ref_4: createEntity('enemy_ref_4', 0, 'BUILDING', 'refinery', 2300, 2200),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 2150, 2200),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2200, 2150),
            enemy_harv_1: createEntity('enemy_harv_1', 0, 'UNIT', 'harvester', 2300, 2320),
            enemy_harv_2: createEntity('enemy_harv_2', 0, 'UNIT', 'harvester', 2320, 2300),
            enemy_harv_3: createEntity('enemy_harv_3', 0, 'UNIT', 'harvester', 2340, 2320),
            enemy_harv_4: createEntity('enemy_harv_4', 0, 'UNIT', 'harvester', 2360, 2300),
            enemy_harv_5: createEntity('enemy_harv_5', 0, 'UNIT', 'harvester', 2380, 2320),
            enemy_harv_6: createEntity('enemy_harv_6', 0, 'UNIT', 'harvester', 2400, 2300),
            // 1 combat unit blocks greedy rush but allows boom rush
            enemy_tank_1: createEntity('enemy_tank_1', 0, 'UNIT', 'light', 2200, 2280)
        };

        // Tick 1000: before boom rush threshold (but after greedy rush threshold)
        const state = createTestState(entities, 1000);
        computeAiActions(state, 1);
        const aiState = getAIState(1);

        // Vengeance should not be boosted by boom rush (boom rush needs tick >= 1200)
        expect(aiState.vengeanceScores[0] || 0).toBeLessThan(200);
    });

    it('no false positives against normal balanced play', () => {
        const entities: Record<EntityId, Entity> = {
            // Classic AI base and army
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 340, 360),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 400, 330),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 380),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 470, 430),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 500, 430),
            ai_tank_3: createEntity('ai_tank_3', 1, 'UNIT', 'light', 530, 430),

            // Normal balanced enemy: 2 refineries, 3 harvesters, 4 combat units
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200),
            enemy_ref_1: createEntity('enemy_ref_1', 0, 'BUILDING', 'refinery', 2240, 2260),
            enemy_ref_2: createEntity('enemy_ref_2', 0, 'BUILDING', 'refinery', 2180, 2260),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 2150, 2200),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2200, 2150),
            enemy_harv_1: createEntity('enemy_harv_1', 0, 'UNIT', 'harvester', 2300, 2320),
            enemy_harv_2: createEntity('enemy_harv_2', 0, 'UNIT', 'harvester', 2320, 2300),
            enemy_harv_3: createEntity('enemy_harv_3', 0, 'UNIT', 'harvester', 2340, 2320),
            // 4 combat units - balanced play
            enemy_tank_1: createEntity('enemy_tank_1', 0, 'UNIT', 'light', 2200, 2280),
            enemy_tank_2: createEntity('enemy_tank_2', 0, 'UNIT', 'light', 2220, 2280),
            enemy_tank_3: createEntity('enemy_tank_3', 0, 'UNIT', 'medium', 2240, 2280),
            enemy_tank_4: createEntity('enemy_tank_4', 0, 'UNIT', 'medium', 2260, 2280)
        };

        const state = createTestState(entities, 1201);
        computeAiActions(state, 1);
        const aiState = getAIState(1);

        // boomScore for this enemy: (2-1)*15 + (3-2)*5 - 4*12 - 0*15 = 15 + 5 - 48 = 0 (clamped)
        // Should NOT trigger boom rush
        expect(aiState.vengeanceScores[0] || 0).toBeLessThan(200);
    });

    it('shifts investment priority to warfare when boom detected', () => {
        const entities: Record<EntityId, Entity> = {
            // Classic AI base with decent economy (economyScore > 30) and some army
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 340, 360),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 400, 330),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 380),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 380, 400),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 400, 400),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 470, 430),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 500, 430),
            // Ore near AI refinery for economy score
            ai_ore_1: createTestResource({ id: 'ai_ore_1', x: 360, y: 400 }),
            ai_ore_2: createTestResource({ id: 'ai_ore_2', x: 380, y: 420 }),
            ai_ore_3: createTestResource({ id: 'ai_ore_3', x: 400, y: 400 }),
            ai_ore_4: createTestResource({ id: 'ai_ore_4', x: 420, y: 420 }),
            ai_ore_5: createTestResource({ id: 'ai_ore_5', x: 360, y: 440 }),
            ai_ore_6: createTestResource({ id: 'ai_ore_6', x: 380, y: 440 }),
            ai_ore_7: createTestResource({ id: 'ai_ore_7', x: 400, y: 440 }),
            ai_ore_8: createTestResource({ id: 'ai_ore_8', x: 420, y: 440 }),

            // Booming enemy: high eco, low military
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200),
            enemy_ref_1: createEntity('enemy_ref_1', 0, 'BUILDING', 'refinery', 2240, 2260),
            enemy_ref_2: createEntity('enemy_ref_2', 0, 'BUILDING', 'refinery', 2180, 2260),
            enemy_ref_3: createEntity('enemy_ref_3', 0, 'BUILDING', 'refinery', 2260, 2200),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 2150, 2200),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2200, 2150),
            enemy_harv_1: createEntity('enemy_harv_1', 0, 'UNIT', 'harvester', 2300, 2320),
            enemy_harv_2: createEntity('enemy_harv_2', 0, 'UNIT', 'harvester', 2320, 2300),
            enemy_harv_3: createEntity('enemy_harv_3', 0, 'UNIT', 'harvester', 2340, 2320),
            enemy_harv_4: createEntity('enemy_harv_4', 0, 'UNIT', 'harvester', 2360, 2300),
            enemy_harv_5: createEntity('enemy_harv_5', 0, 'UNIT', 'harvester', 2380, 2320),
            enemy_harv_6: createEntity('enemy_harv_6', 0, 'UNIT', 'harvester', 2400, 2300)
        } as Record<EntityId, Entity>;

        const state = createTestState(entities, 1201);
        computeAiActions(state, 1);
        const aiState = getAIState(1);

        // boomScore: (3-1)*15 + (6-2)*5 - 0*12 = 30 + 20 = 50
        // With boomScore >= 30 and armyRatio < 1.5, investment should shift to warfare
        expect(aiState.investmentPriority).toBe('warfare');
    });
});

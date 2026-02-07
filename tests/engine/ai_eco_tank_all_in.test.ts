import { describe, it, expect, beforeEach } from 'vitest';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { computeAiActionsForPlayer } from '../../src/engine/ai/controller.js';
import { getAIImplementation, getAIImplementationOptions } from '../../src/engine/ai/registry.js';
import { getAIState, resetAIState } from '../../src/engine/ai/state.js';
import { Entity, EntityId, GameState, UnitKey, BuildingKey, isActionType } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit, createTestHarvester, createTestResource } from '../../src/engine/test-utils.js';

const ECO_TANK_ALL_IN_ID = 'eco_tank_all_in';

function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number
): Entity {
    if (type === 'BUILDING') {
        return createTestBuilding({ id, owner, key: key as BuildingKey, x, y });
    }
    if (type === 'RESOURCE') {
        return createTestResource({ id, x, y });
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

function createState(
    entities: Record<EntityId, Entity>,
    tick: number,
    aiCredits: number,
    aiDifficulty: 'dummy' | 'easy' | 'medium' | 'hard' = 'hard'
): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        tick,
        entities,
        players: {
            0: createPlayerState(0, false, 'medium', '#4488ff'),
            1: createPlayerState(1, true, aiDifficulty, '#ff4444', ECO_TANK_ALL_IN_ID)
        }
    } as GameState & { players: Record<number, ReturnType<typeof createPlayerState>> };
}

function withAICredits(state: GameState, credits: number): GameState {
    return {
        ...state,
        players: {
            ...state.players,
            1: {
                ...state.players[1],
                credits
            }
        }
    };
}

function hasDefenseBuildAction(actions: ReturnType<typeof computeAiActionsForPlayer>): boolean {
    const defenseKeys = new Set(['turret', 'pillbox', 'sam_site', 'obelisk']);
    return actions.some(action =>
        isActionType(action, 'START_BUILD') &&
        action.payload.category === 'building' &&
        defenseKeys.has(action.payload.key)
    );
}

describe('Eco Tank All-In AI', () => {
    beforeEach(() => {
        resetAIState();
    });

    it('registers in AI registry with selector option', () => {
        const implementation = getAIImplementation(ECO_TANK_ALL_IN_ID);
        expect(implementation).toBeDefined();
        expect(implementation?.name).toBe('Eco Tank All-In');

        const options = getAIImplementationOptions();
        expect(options.some(option => option.id === ECO_TANK_ALL_IN_ID)).toBe(true);
    });

    it('prioritizes opening economy and avoids proactive static defenses', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 360, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 380),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 380, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 420, 360),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 430, 430),
            ore_1: createEntity('ore_1', -1, 'RESOURCE', 'ore', 520, 420),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2400, 2400)
        };

        const state = withAICredits(createState(entities, 31, 3000), 3000);
        const actions = computeAiActionsForPlayer(state, 1);

        const ecoBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            ((action.payload.category === 'vehicle' && action.payload.key === 'harvester') ||
                (action.payload.category === 'building' && action.payload.key === 'refinery'))
        );

        expect(ecoBuild).toBeDefined();
        expect(hasDefenseBuildAction(actions)).toBe(false);
    });

    it('uses reactive defense when immediate threats are present', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 340, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 410, 340),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'light', 430, 370),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 420),
            enemy_tank: createEntity('enemy_tank', 0, 'UNIT', 'heavy', 390, 350),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200)
        };

        const state = withAICredits(createState(entities, 31, 1800), 1800);
        const actions = computeAiActionsForPlayer(state, 1);

        const defenseAttack = actions.find(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.targetId === 'enemy_tank'
        );
        expect(defenseAttack).toBeDefined();
    });

    it('biases massing production toward tanks', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 360, 300),
            ai_power_2: createEntity('ai_power_2', 1, 'BUILDING', 'power', 420, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_ref_2: createEntity('ai_ref_2', 1, 'BUILDING', 'refinery', 240, 420),
            ai_ref_3: createEntity('ai_ref_3', 1, 'BUILDING', 'refinery', 360, 440),
            ai_ref_4: createEntity('ai_ref_4', 1, 'BUILDING', 'refinery', 460, 420),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 430, 500),
            ai_harv_3: createEntity('ai_harv_3', 1, 'UNIT', 'harvester', 380, 500),
            ai_harv_4: createEntity('ai_harv_4', 1, 'UNIT', 'harvester', 330, 500),
            ai_harv_5: createEntity('ai_harv_5', 1, 'UNIT', 'harvester', 280, 500),
            ai_harv_6: createEntity('ai_harv_6', 1, 'UNIT', 'harvester', 240, 470),
            ai_harv_7: createEntity('ai_harv_7', 1, 'UNIT', 'harvester', 220, 430),
            ai_harv_8: createEntity('ai_harv_8', 1, 'UNIT', 'harvester', 240, 390),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2400, 2400)
        };

        const state = withAICredits(createState(entities, 31, 2200), 2200);
        const actions = computeAiActionsForPlayer(state, 1);

        const tankBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'vehicle' &&
            (action.payload.key === 'heavy' || action.payload.key === 'light')
        );
        expect(tankBuild).toBeDefined();

        const nonTankVehicleBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'vehicle' &&
            !['heavy', 'light', 'harvester'].includes(action.payload.key)
        );
        expect(nonTankVehicleBuild).toBeUndefined();

        const infantryBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') && action.payload.category === 'infantry'
        );
        expect(infantryBuild).toBeUndefined();
    });

    it('does not queue extra barracks once one is already established', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 360, 300),
            ai_power_2: createEntity('ai_power_2', 1, 'BUILDING', 'power', 420, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_ref_2: createEntity('ai_ref_2', 1, 'BUILDING', 'refinery', 240, 420),
            ai_ref_3: createEntity('ai_ref_3', 1, 'BUILDING', 'refinery', 360, 440),
            ai_ref_4: createEntity('ai_ref_4', 1, 'BUILDING', 'refinery', 460, 420),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 430, 500),
            ai_harv_3: createEntity('ai_harv_3', 1, 'UNIT', 'harvester', 380, 500),
            ai_harv_4: createEntity('ai_harv_4', 1, 'UNIT', 'harvester', 330, 500),
            ai_harv_5: createEntity('ai_harv_5', 1, 'UNIT', 'harvester', 280, 500),
            ai_harv_6: createEntity('ai_harv_6', 1, 'UNIT', 'harvester', 240, 470),
            ai_harv_7: createEntity('ai_harv_7', 1, 'UNIT', 'harvester', 220, 430),
            ai_harv_8: createEntity('ai_harv_8', 1, 'UNIT', 'harvester', 240, 390),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2400, 2400)
        };

        const state = withAICredits(createState(entities, 31, 9000), 9000);
        const actions = computeAiActionsForPlayer(state, 1);

        const extraBarracksBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'building' &&
            action.payload.key === 'barracks'
        );
        expect(extraBarracksBuild).toBeUndefined();
    });

    it('enters commit push from threshold trigger and issues attack pressure', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 360, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_ref_2: createEntity('ai_ref_2', 1, 'BUILDING', 'refinery', 240, 420),
            ai_ref_3: createEntity('ai_ref_3', 1, 'BUILDING', 'refinery', 360, 440),
            ai_ref_4: createEntity('ai_ref_4', 1, 'BUILDING', 'refinery', 460, 420),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 430),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 380, 430),
            ai_heavy_1: createEntity('ai_heavy_1', 1, 'UNIT', 'heavy', 500, 500),
            ai_heavy_2: createEntity('ai_heavy_2', 1, 'UNIT', 'heavy', 540, 500),
            ai_heavy_3: createEntity('ai_heavy_3', 1, 'UNIT', 'heavy', 580, 500),
            ai_light_1: createEntity('ai_light_1', 1, 'UNIT', 'light', 500, 540),
            ai_light_2: createEntity('ai_light_2', 1, 'UNIT', 'light', 540, 540),
            ai_light_3: createEntity('ai_light_3', 1, 'UNIT', 'light', 580, 540),
            ai_light_4: createEntity('ai_light_4', 1, 'UNIT', 'light', 620, 540),
            ai_light_5: createEntity('ai_light_5', 1, 'UNIT', 'light', 660, 540),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200)
        };

        const state = withAICredits(createState(entities, 31, 3000), 3000);
        const actions = computeAiActionsForPlayer(state, 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).toBe('attack');
        expect(aiState.allInStartTick).toBe(31);

        const pressureCommand = actions.find(action =>
            action.type === 'COMMAND_ATTACK' || action.type === 'COMMAND_MOVE'
        );
        expect(pressureCommand).toBeDefined();
    });

    it('forces commit push at timer threshold with minimum tanks', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_ref_2: createEntity('ai_ref_2', 1, 'BUILDING', 'refinery', 240, 420),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'heavy', 500, 500),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 540, 500),
            ai_tank_3: createEntity('ai_tank_3', 1, 'UNIT', 'light', 580, 500),
            ai_tank_4: createEntity('ai_tank_4', 1, 'UNIT', 'light', 620, 500),
            ai_tank_5: createEntity('ai_tank_5', 1, 'UNIT', 'light', 660, 500),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200)
        };

        const state = withAICredits(createState(entities, 25201, 2600), 2600);
        computeAiActionsForPlayer(state, 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).toBe('attack');
        expect(aiState.allInStartTick).toBe(25201);
    });

    it('keeps commit production tank-preserving instead of cheap all_in spam', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 360, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 380),
            ai_tank_1: createEntity('ai_tank_1', 1, 'UNIT', 'heavy', 520, 500),
            ai_tank_2: createEntity('ai_tank_2', 1, 'UNIT', 'light', 560, 500),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200)
        };

        const state = withAICredits(createState(entities, 31, 1200), 1200);
        const aiState = getAIState(1);
        aiState.allInStartTick = 1;
        aiState.strategy = 'attack';

        const actions = computeAiActionsForPlayer(state, 1);

        const vehicleBuilds = actions.filter(action =>
            isActionType(action, 'START_BUILD') && action.payload.category === 'vehicle'
        );

        expect(vehicleBuilds.length).toBeGreaterThan(0);
        expect(vehicleBuilds.every(action =>
            action.payload.key === 'heavy' || action.payload.key === 'light'
        )).toBe(true);
    });
});

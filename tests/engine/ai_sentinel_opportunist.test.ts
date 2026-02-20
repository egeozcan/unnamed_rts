import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { computeAiActionsForPlayer } from '../../src/engine/ai/controller.js';
import { getAIImplementation, getAIImplementationOptions } from '../../src/engine/ai/registry.js';
import { getAIState } from '../../src/engine/ai/state.js';
import { getSentinelOpportunistRuntimeState } from '../../src/engine/ai/implementations/sentinel_opportunist/state.js';
import { Entity, EntityId, GameState, BuildingKey, UnitKey, isActionType } from '../../src/engine/types.js';
import {
    createTestBuilding,
    createTestCombatUnit,
    createTestDemoTruck,
    createTestHarvester,
    createTestResource
} from '../../src/engine/test-utils.js';

const SENTINEL_ID = 'sentinel_opportunist';

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
    if (key === 'demo_truck') {
        return createTestDemoTruck({ id, owner, x, y });
    }

    return createTestCombatUnit({
        id,
        owner,
        key: key as Exclude<UnitKey, 'harvester' | 'harrier' | 'demo_truck'>,
        x,
        y
    });
}

function createState(
    entities: Record<EntityId, Entity>,
    tick: number,
    credits: number,
    difficulty: 'dummy' | 'easy' | 'medium' | 'hard' = 'hard'
): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        tick,
        entities,
        players: {
            0: createPlayerState(0, false, 'medium', '#4488ff'),
            1: {
                ...createPlayerState(1, true, difficulty, '#ff4444', SENTINEL_ID),
                credits
            }
        }
    } as GameState & { players: Record<number, ReturnType<typeof createPlayerState>> };
}

function resetSentinelState(): void {
    getAIImplementation(SENTINEL_ID)?.reset?.();
}

describe('Sentinel Opportunist AI', () => {
    beforeEach(() => {
        resetSentinelState();
    });

    it('registers in AI registry and appears in selector options', () => {
        const implementation = getAIImplementation(SENTINEL_ID);
        expect(implementation).toBeDefined();
        expect(implementation?.name).toBe('Sentinel Opportunist');

        const options = getAIImplementationOptions();
        expect(options.some(option => option.id === SENTINEL_ID)).toBe(true);
    });

    it('produces defense-first behavior in early/mid game', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 390, 320),
            ai_power_2: createEntity('ai_power_2', 1, 'BUILDING', 'power', 450, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 390, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 470, 390),
            ai_refinery_1: createEntity('ai_refinery_1', 1, 'BUILDING', 'refinery', 300, 410),
            ai_refinery_2: createEntity('ai_refinery_2', 1, 'BUILDING', 'refinery', 240, 420),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 480),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 470, 480),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 560, 520),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 590, 520),
            ai_rifle_1: createEntity('ai_rifle_1', 1, 'UNIT', 'rifle', 620, 520),
            ore_1: createEntity('ore_1', -1, 'RESOURCE', 'ore', 620, 450),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200)
        };

        computeAiActionsForPlayer(createState(entities, 31, 3200), 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).not.toBe('attack');
        expect(aiState.defenseGroup.length).toBeGreaterThan(0);
    });

    it('applies production pacing when safe', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 390, 320),
            ai_power_2: createEntity('ai_power_2', 1, 'BUILDING', 'power', 450, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 390, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 470, 390),
            ai_refinery_1: createEntity('ai_refinery_1', 1, 'BUILDING', 'refinery', 300, 410),
            ai_refinery_2: createEntity('ai_refinery_2', 1, 'BUILDING', 'refinery', 240, 420),
            ai_turret_1: createEntity('ai_turret_1', 1, 'BUILDING', 'turret', 270, 320),
            ai_turret_2: createEntity('ai_turret_2', 1, 'BUILDING', 'turret', 270, 380),
            ai_turret_3: createEntity('ai_turret_3', 1, 'BUILDING', 'turret', 220, 350),
            ai_turret_4: createEntity('ai_turret_4', 1, 'BUILDING', 'turret', 220, 410),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 480),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 470, 480),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 520, 520),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 540, 520),
            ai_rifle_1: createEntity('ai_rifle_1', 1, 'UNIT', 'rifle', 560, 520),
            ai_rifle_2: createEntity('ai_rifle_2', 1, 'UNIT', 'rifle', 580, 520),
            ai_grenadier_1: createEntity('ai_grenadier_1', 1, 'UNIT', 'grenadier', 520, 550),
            ai_grenadier_2: createEntity('ai_grenadier_2', 1, 'UNIT', 'grenadier', 540, 550),
            ai_heavy_1: createEntity('ai_heavy_1', 1, 'UNIT', 'heavy', 560, 560),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200)
        };

        const baselineActions = computeAiActionsForPlayer(createState(entities, 31, 4500), 1);
        expect(baselineActions.some(action =>
            isActionType(action, 'START_BUILD') &&
            (action.payload.category === 'infantry' || action.payload.category === 'vehicle')
        )).toBe(true);

        const runtime = getSentinelOpportunistRuntimeState(1);
        runtime.lastInfantryStartTick = 33;
        runtime.lastVehicleStartTick = 33;

        const throttledActions = computeAiActionsForPlayer(createState(entities, 34, 4500), 1);
        expect(throttledActions.some(action =>
            isActionType(action, 'START_BUILD') && action.payload.category === 'infantry'
        )).toBe(false);
        expect(throttledActions.some(action =>
            isActionType(action, 'START_BUILD') && action.payload.category === 'vehicle'
        )).toBe(false);
    });

    it('does not force early attacks before push-window conditions', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 390, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 390, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 470, 390),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 410),
            ai_turret_1: createEntity('ai_turret_1', 1, 'BUILDING', 'turret', 270, 320),
            ai_turret_2: createEntity('ai_turret_2', 1, 'BUILDING', 'turret', 270, 380),
            ai_turret_3: createEntity('ai_turret_3', 1, 'BUILDING', 'turret', 220, 350),
            ai_turret_4: createEntity('ai_turret_4', 1, 'BUILDING', 'turret', 220, 410),
            ai_harv: createEntity('ai_harv', 1, 'UNIT', 'harvester', 420, 480),
            ai_heavy_1: createEntity('ai_heavy_1', 1, 'UNIT', 'heavy', 580, 520),
            ai_heavy_2: createEntity('ai_heavy_2', 1, 'UNIT', 'heavy', 620, 520),
            ai_heavy_3: createEntity('ai_heavy_3', 1, 'UNIT', 'heavy', 660, 520),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 560, 560),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 600, 560),
            ai_rocket_3: createEntity('ai_rocket_3', 1, 'UNIT', 'rocket', 640, 560),
            ai_rifle_1: createEntity('ai_rifle_1', 1, 'UNIT', 'rifle', 560, 600),
            ai_rifle_2: createEntity('ai_rifle_2', 1, 'UNIT', 'rifle', 600, 600),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 2080, 2000),
            enemy_heavy_1: createEntity('enemy_heavy_1', 0, 'UNIT', 'heavy', 1900, 1900),
            enemy_heavy_2: createEntity('enemy_heavy_2', 0, 'UNIT', 'heavy', 1940, 1900),
            enemy_heavy_3: createEntity('enemy_heavy_3', 0, 'UNIT', 'heavy', 1980, 1900),
            enemy_rocket_1: createEntity('enemy_rocket_1', 0, 'UNIT', 'rocket', 1900, 1940),
            enemy_rocket_2: createEntity('enemy_rocket_2', 0, 'UNIT', 'rocket', 1940, 1940),
            enemy_rocket_3: createEntity('enemy_rocket_3', 0, 'UNIT', 'rocket', 1980, 1940)
        };

        computeAiActionsForPlayer(createState(entities, 9001, 5000), 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).not.toBe('attack');
    });

    it('forces attacks during active push windows when thresholds are met', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 390, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 390, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 470, 390),
            ai_refinery_1: createEntity('ai_refinery_1', 1, 'BUILDING', 'refinery', 300, 410),
            ai_refinery_2: createEntity('ai_refinery_2', 1, 'BUILDING', 'refinery', 240, 420),
            ai_turret_1: createEntity('ai_turret_1', 1, 'BUILDING', 'turret', 270, 320),
            ai_turret_2: createEntity('ai_turret_2', 1, 'BUILDING', 'turret', 270, 380),
            ai_turret_3: createEntity('ai_turret_3', 1, 'BUILDING', 'turret', 220, 350),
            ai_turret_4: createEntity('ai_turret_4', 1, 'BUILDING', 'turret', 220, 410),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 480),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 470, 480),
            ai_heavy_1: createEntity('ai_heavy_1', 1, 'UNIT', 'heavy', 560, 540),
            ai_heavy_2: createEntity('ai_heavy_2', 1, 'UNIT', 'heavy', 590, 540),
            ai_heavy_3: createEntity('ai_heavy_3', 1, 'UNIT', 'heavy', 620, 540),
            ai_heavy_4: createEntity('ai_heavy_4', 1, 'UNIT', 'heavy', 650, 540),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 560, 570),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 590, 570),
            ai_rocket_3: createEntity('ai_rocket_3', 1, 'UNIT', 'rocket', 620, 570),
            ai_rocket_4: createEntity('ai_rocket_4', 1, 'UNIT', 'rocket', 650, 570),
            ai_rifle_1: createEntity('ai_rifle_1', 1, 'UNIT', 'rifle', 560, 600),
            ai_rifle_2: createEntity('ai_rifle_2', 1, 'UNIT', 'rifle', 590, 600),
            ai_rifle_3: createEntity('ai_rifle_3', 1, 'UNIT', 'rifle', 620, 600),
            ai_grenadier_1: createEntity('ai_grenadier_1', 1, 'UNIT', 'grenadier', 650, 600),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 1800, 1800),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 1880, 1800),
            enemy_heavy_1: createEntity('enemy_heavy_1', 0, 'UNIT', 'heavy', 1760, 1760)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 12100, 6000), 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).toBe('attack');
        expect(aiState.attackGroup.length).toBeGreaterThan(0);
        expect(actions.some(action =>
            action.type === 'COMMAND_ATTACK' || action.type === 'COMMAND_ATTACK_MOVE' || action.type === 'COMMAND_MOVE'
        )).toBe(true);
    });

    it('enforces specialist caps using projected counts', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 390, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 390, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 470, 390),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 410),
            ai_turret_1: createEntity('ai_turret_1', 1, 'BUILDING', 'turret', 270, 320),
            ai_turret_2: createEntity('ai_turret_2', 1, 'BUILDING', 'turret', 270, 380),
            ai_turret_3: createEntity('ai_turret_3', 1, 'BUILDING', 'turret', 220, 350),
            ai_turret_4: createEntity('ai_turret_4', 1, 'BUILDING', 'turret', 220, 410),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 480),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 560, 560),
            ai_hijacker_1: createEntity('ai_hijacker_1', 1, 'UNIT', 'hijacker', 590, 560),
            ai_hijacker_2: createEntity('ai_hijacker_2', 1, 'UNIT', 'hijacker', 620, 560),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 560, 600),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 590, 600),
            ai_rocket_3: createEntity('ai_rocket_3', 1, 'UNIT', 'rocket', 620, 600),
            ai_rocket_4: createEntity('ai_rocket_4', 1, 'UNIT', 'rocket', 650, 600),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 1200, 700),
            enemy_heavy_1: createEntity('enemy_heavy_1', 0, 'UNIT', 'heavy', 1700, 1700),
            enemy_heavy_2: createEntity('enemy_heavy_2', 0, 'UNIT', 'heavy', 1740, 1700),
            enemy_heavy_3: createEntity('enemy_heavy_3', 0, 'UNIT', 'heavy', 1780, 1700),
            enemy_heavy_4: createEntity('enemy_heavy_4', 0, 'UNIT', 'heavy', 1820, 1700)
        };

        const state = createState(entities, 12100, 6000);
        state.players[1].queues.infantry.current = 'hijacker';

        const actions = computeAiActionsForPlayer(state, 1);
        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'infantry' &&
            (action.payload.key === 'engineer' || action.payload.key === 'hijacker')
        )).toBe(false);
    });

    it('queues specialists only when safety and economy gates are satisfied', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 390, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 390, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 470, 390),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 410),
            ai_turret_1: createEntity('ai_turret_1', 1, 'BUILDING', 'turret', 270, 320),
            ai_turret_2: createEntity('ai_turret_2', 1, 'BUILDING', 'turret', 270, 380),
            ai_turret_3: createEntity('ai_turret_3', 1, 'BUILDING', 'turret', 220, 350),
            ai_turret_4: createEntity('ai_turret_4', 1, 'BUILDING', 'turret', 220, 410),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 480),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 560, 560),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 590, 560),
            ai_rocket_3: createEntity('ai_rocket_3', 1, 'UNIT', 'rocket', 620, 560),
            ai_rocket_4: createEntity('ai_rocket_4', 1, 'UNIT', 'rocket', 650, 560),
            ai_rifle_1: createEntity('ai_rifle_1', 1, 'UNIT', 'rifle', 560, 590),
            ai_rifle_2: createEntity('ai_rifle_2', 1, 'UNIT', 'rifle', 590, 590),
            ai_rifle_3: createEntity('ai_rifle_3', 1, 'UNIT', 'rifle', 620, 590),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 1200, 700),
            enemy_heavy_1: createEntity('enemy_heavy_1', 0, 'UNIT', 'heavy', 1800, 1800),
            enemy_heavy_2: createEntity('enemy_heavy_2', 0, 'UNIT', 'heavy', 1840, 1800),
            enemy_heavy_3: createEntity('enemy_heavy_3', 0, 'UNIT', 'heavy', 1880, 1800),
            enemy_heavy_4: createEntity('enemy_heavy_4', 0, 'UNIT', 'heavy', 1920, 1800)
        };

        const unsafeEntities = {
            ...baseEntities,
            enemy_close_heavy: createEntity('enemy_close_heavy', 0, 'UNIT', 'heavy', 430, 430)
        };

        const unsafeActions = computeAiActionsForPlayer(createState(unsafeEntities, 12100, 6000), 1);
        expect(unsafeActions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'infantry' &&
            (action.payload.key === 'engineer' || action.payload.key === 'hijacker')
        )).toBe(false);

        resetSentinelState();
        const safeActions = computeAiActionsForPlayer(createState(baseEntities, 12100, 6000), 1);
        expect(safeActions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'infantry' &&
            (action.payload.key === 'engineer' || action.payload.key === 'hijacker')
        )).toBe(true);
    });

    it('emits engineer capture and hijacker assault commands when opportunities exist', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 390, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 470, 390),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 410),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 560, 560),
            ai_hijacker: createEntity('ai_hijacker', 1, 'UNIT', 'hijacker', 590, 560),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 620, 560),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 650, 560),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 760, 540),
            enemy_heavy: createEntity('enemy_heavy', 0, 'UNIT', 'heavy', 780, 560),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 1900, 1900)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 12100, 5000), 1);

        expect(actions.some(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.unitIds.includes('ai_engineer') &&
            action.payload.targetId === 'enemy_factory'
        )).toBe(true);

        expect(actions.some(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.unitIds.includes('ai_hijacker') &&
            action.payload.targetId === 'enemy_heavy'
        )).toBe(true);
    });

    it('does not emit demo truck production or demo truck assault actions', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 390, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 470, 390),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 410),
            ai_demo: createEntity('ai_demo', 1, 'UNIT', 'demo_truck', 560, 560),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 590, 560),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 620, 560),
            ai_heavy_1: createEntity('ai_heavy_1', 1, 'UNIT', 'heavy', 650, 560),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 760, 560),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 840, 560),
            enemy_heavy: createEntity('enemy_heavy', 0, 'UNIT', 'heavy', 810, 600)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 12100, 6000), 1);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'vehicle' &&
            action.payload.key === 'demo_truck'
        )).toBe(false);

        expect(actions.some(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.unitIds.includes('ai_demo')
        )).toBe(false);
    });

    it('is deterministic after reset for identical state and tick', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 390, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 390, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 470, 390),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 410),
            ai_turret_1: createEntity('ai_turret_1', 1, 'BUILDING', 'turret', 270, 320),
            ai_turret_2: createEntity('ai_turret_2', 1, 'BUILDING', 'turret', 270, 380),
            ai_turret_3: createEntity('ai_turret_3', 1, 'BUILDING', 'turret', 220, 350),
            ai_turret_4: createEntity('ai_turret_4', 1, 'BUILDING', 'turret', 220, 410),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 480),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 560, 560),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 590, 560),
            ai_heavy_1: createEntity('ai_heavy_1', 1, 'UNIT', 'heavy', 620, 560),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 1900, 1900),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 1980, 1900),
            enemy_heavy: createEntity('enemy_heavy', 0, 'UNIT', 'heavy', 1940, 1940)
        };

        const state = createState(entities, 12100, 5500);

        resetSentinelState();
        const first = computeAiActionsForPlayer(state, 1);

        resetSentinelState();
        const second = computeAiActionsForPlayer(state, 1);

        expect(second).toEqual(first);
    });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { computeAiActionsForPlayer } from '../../src/engine/ai/controller.js';
import { getAIImplementation, getAIImplementationOptions } from '../../src/engine/ai/registry.js';
import { Entity, EntityId, GameState, BuildingKey, UnitKey, isActionType } from '../../src/engine/types.js';
import {
    createTestBuilding,
    createTestCombatUnit,
    createTestDemoTruck,
    createTestHarvester,
    createTestResource
} from '../../src/engine/test-utils.js';

const SABOTEUR_ID = 'saboteur_circus';

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
                ...createPlayerState(1, true, difficulty, '#ff4444', SABOTEUR_ID),
                credits
            }
        }
    } as GameState & { players: Record<number, ReturnType<typeof createPlayerState>> };
}

function resetSaboteurState(): void {
    getAIImplementation(SABOTEUR_ID)?.reset?.();
}

describe('Saboteur Circus AI', () => {
    beforeEach(() => {
        resetSaboteurState();
    });

    it('registers in AI registry and appears in selector options', () => {
        const implementation = getAIImplementation(SABOTEUR_ID);
        expect(implementation).toBeDefined();
        expect(implementation?.name).toBe('Saboteur Circus');

        const options = getAIImplementationOptions();
        expect(options.some(option => option.id === SABOTEUR_ID)).toBe(true);
    });

    it('rewrites conventional production into underused units', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 390, 320),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 320, 400),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 390),
            ai_tech: createEntity('ai_tech', 1, 'BUILDING', 'tech', 560, 390),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 470, 470),
            ore_1: createEntity('ore_1', -1, 'RESOURCE', 'ore', 620, 450),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2100, 2100)
        };

        const underusedKeys = new Set([
            'hijacker', 'medic', 'engineer', 'sniper', 'commando', 'grenadier',
            'apc', 'stealth', 'demo_truck', 'induction_rig', 'light'
        ]);

        const candidateTicks = [31, 34, 37, 40, 43];
        const sawUnderusedBuild = candidateTicks.some(tick => {
            resetSaboteurState();
            const actions = computeAiActionsForPlayer(createState(entities, tick, 7000), 1);
            return actions.some(action =>
                isActionType(action, 'START_BUILD') &&
                underusedKeys.has(action.payload.key)
            );
        });

        expect(sawUnderusedBuild).toBe(true);
    });

    it('enforces specialist caps and skips capped hijacker production', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 390, 320),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 320, 400),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 390),
            ai_tech: createEntity('ai_tech', 1, 'BUILDING', 'tech', 560, 390),
            ai_hijacker_1: createEntity('ai_hijacker_1', 1, 'UNIT', 'hijacker', 470, 500),
            ai_hijacker_2: createEntity('ai_hijacker_2', 1, 'UNIT', 'hijacker', 500, 500),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 470, 470),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2100, 2100)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 1501, 9000), 1);
        const buildActions = actions.filter(action => isActionType(action, 'START_BUILD'));
        expect(buildActions.length).toBeGreaterThan(0);
        expect(buildActions.some(action => action.payload.key === 'hijacker')).toBe(false);
    });

    it('drops proactive defense building starts when safe', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 390, 320),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 320, 400),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 390),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 470, 470),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2300, 2300)
        };

        const defenseKeys = new Set(['turret', 'pillbox', 'sam_site', 'obelisk']);
        const actions = computeAiActionsForPlayer(createState(entities, 31, 6000), 1);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'building' &&
            defenseKeys.has(action.payload.key)
        )).toBe(false);
    });

    it('issues hijacker assault commands against enemy vehicles', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 390),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 320, 400),
            ai_hijacker: createEntity('ai_hijacker', 1, 'UNIT', 'hijacker', 520, 520),
            ai_rifle: createEntity('ai_rifle', 1, 'UNIT', 'rifle', 500, 520),
            enemy_heavy: createEntity('enemy_heavy', 0, 'UNIT', 'heavy', 760, 520),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200)
        };

        // Advance stunt rotation once, then validate hijack phase + always-on hook.
        computeAiActionsForPlayer(createState(entities, 900, 3500), 1);
        const actions = computeAiActionsForPlayer(createState(entities, 1800, 3500), 1);

        expect(actions.some(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.unitIds.includes('ai_hijacker') &&
            action.payload.targetId === 'enemy_heavy'
        )).toBe(true);
    });

    it('issues engineer capture commands for capturable enemy buildings', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 390),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 320, 400),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 520, 520),
            ai_rifle: createEntity('ai_rifle', 1, 'UNIT', 'rifle', 500, 520),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 760, 520),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 900, 3500), 1);
        expect(actions.some(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.unitIds.includes('ai_engineer') &&
            action.payload.targetId === 'enemy_factory'
        )).toBe(true);
    });

    it('issues demo truck assault commands against high-value targets', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 390),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 320, 400),
            ai_demo: createEntity('ai_demo', 1, 'UNIT', 'demo_truck', 520, 520),
            ai_light: createEntity('ai_light', 1, 'UNIT', 'light', 480, 500),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 760, 520),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 800, 520)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 2700, 4500), 1);
        expect(actions.some(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.unitIds.includes('ai_demo')
        )).toBe(true);
    });

    it('is deterministic after reset for identical state/tick', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 390, 320),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 320, 400),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 390),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 390),
            ai_tech: createEntity('ai_tech', 1, 'BUILDING', 'tech', 560, 390),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 420, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 470, 470),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2300, 2300)
        };

        const state = createState(entities, 1501, 8000);

        resetSaboteurState();
        const first = computeAiActionsForPlayer(state, 1);

        resetSaboteurState();
        const second = computeAiActionsForPlayer(state, 1);

        expect(second).toEqual(first);
    });
});

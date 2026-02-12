import { describe, it, expect, beforeEach } from 'vitest';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { computeAiActionsForPlayer } from '../../src/engine/ai/controller.js';
import { getAIImplementation, getAIImplementationOptions } from '../../src/engine/ai/registry.js';
import { getAIState, resetAIState } from '../../src/engine/ai/state.js';
import { Entity, EntityId, GameState, UnitKey, BuildingKey, isActionType } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit, createTestHarvester, createTestResource, createTestDemoTruck } from '../../src/engine/test-utils.js';

const INFANTRY_FORTRESS_ID = 'infantry_fortress';

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
            1: createPlayerState(1, true, aiDifficulty, '#ff4444', INFANTRY_FORTRESS_ID)
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

describe('Infantry Fortress AI', () => {
    beforeEach(() => {
        resetAIState();
    });

    it('registers in AI registry with selector option', () => {
        const implementation = getAIImplementation(INFANTRY_FORTRESS_ID);
        expect(implementation).toBeDefined();
        expect(implementation?.name).toBe('Infantry Fortress');

        const options = getAIImplementationOptions();
        expect(options.some(option => option.id === INFANTRY_FORTRESS_ID)).toBe(true);
    });

    it('uses both infantry and vehicle queues for production', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 360, 300),
            ai_power_2: createEntity('ai_power_2', 1, 'BUILDING', 'power', 420, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_ref_2: createEntity('ai_ref_2', 1, 'BUILDING', 'refinery', 240, 420),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 430, 500),
            ai_harv_3: createEntity('ai_harv_3', 1, 'UNIT', 'harvester', 380, 500),
            ai_harv_4: createEntity('ai_harv_4', 1, 'UNIT', 'harvester', 330, 500),
            ore_1: createEntity('ore_1', -1, 'RESOURCE', 'ore', 520, 420),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2400, 2400)
        };

        // Run multiple ticks and collect production types
        const categories = new Set<string>();
        for (let tick = 1; tick < 30; tick += 3) {
            resetAIState();
            const state = withAICredits(createState(entities, tick, 3000), 3000);
            const actions = computeAiActionsForPlayer(state, 1);
            for (const action of actions) {
                if (isActionType(action, 'START_BUILD') &&
                    (action.payload.category === 'infantry' || action.payload.category === 'vehicle')) {
                    categories.add(action.payload.category);
                }
            }
        }

        // Should produce from both infantry and vehicle queues
        expect(categories.has('infantry')).toBe(true);
        expect(categories.has('vehicle')).toBe(true);
    });

    it('proactively queues defense buildings even without surplus credits', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 360, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_barracks2: createEntity('ai_barracks2', 1, 'BUILDING', 'barracks', 420, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 300, 420),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 430, 500),
            ore_1: createEntity('ore_1', -1, 'RESOURCE', 'ore', 520, 420),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2400, 2400)
        };

        // Moderate credits - enough for a pillbox (400) but not surplus (5000)
        // 2 barracks and factory pre-built so ensureExtraBarracks/ensureTechChain don't compete
        const state = withAICredits(createState(entities, 31, 1500), 1500);
        const actions = computeAiActionsForPlayer(state, 1);

        const defenseBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'building' &&
            ['turret', 'pillbox', 'sam_site', 'obelisk'].includes(action.payload.key)
        );
        expect(defenseBuild).toBeDefined();
    });

    it('queues extra barracks even in fortify phase (target=2)', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 360, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 430, 500),
            ore_1: createEntity('ore_1', -1, 'RESOURCE', 'ore', 520, 420),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2400, 2400)
        };

        // Enough for a barracks, in fortify phase (no infantry/defenses)
        const state = withAICredits(createState(entities, 31, 2000), 2000);
        const actions = computeAiActionsForPlayer(state, 1);

        const barracksBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'building' &&
            action.payload.key === 'barracks'
        );
        expect(barracksBuild).toBeDefined();
    });

    it('sends hijackers at enemy vehicles', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_hijacker: createEntity('ai_hijacker', 1, 'UNIT', 'hijacker', 500, 500),
            ai_rifle_1: createEntity('ai_rifle_1', 1, 'UNIT', 'rifle', 400, 400),
            enemy_heavy: createEntity('enemy_heavy', 0, 'UNIT', 'heavy', 700, 500),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2400, 2400)
        };

        const state = withAICredits(createState(entities, 31, 2000), 2000);
        const actions = computeAiActionsForPlayer(state, 1);

        const hijackAttack = actions.find(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.unitIds.includes('ai_hijacker') &&
            action.payload.targetId === 'enemy_heavy'
        );
        expect(hijackAttack).toBeDefined();
    });

    it('invokes demo truck handler for enemy targets', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_demo: createEntity('ai_demo', 1, 'UNIT', 'demo_truck', 500, 500),
            ai_rifle_1: createEntity('ai_rifle_1', 1, 'UNIT', 'rifle', 400, 400),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 700, 700),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 740, 700)
        };

        const state = withAICredits(createState(entities, 31, 2000), 2000);
        const actions = computeAiActionsForPlayer(state, 1);

        const demoAttack = actions.find(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.unitIds.includes('ai_demo')
        );
        expect(demoAttack).toBeDefined();
    });

    it('produces combat vehicles from factory alongside infantry', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 360, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_ref_2: createEntity('ai_ref_2', 1, 'BUILDING', 'refinery', 240, 420),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 430, 500),
            ai_harv_3: createEntity('ai_harv_3', 1, 'UNIT', 'harvester', 380, 500),
            ai_harv_4: createEntity('ai_harv_4', 1, 'UNIT', 'harvester', 330, 500),
            ai_harv_5: createEntity('ai_harv_5', 1, 'UNIT', 'harvester', 280, 500),
            ore_1: createEntity('ore_1', -1, 'RESOURCE', 'ore', 520, 420),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2400, 2400)
        };

        // Enough credits for vehicles + infantry (5 harvesters meets 2.5 ratio with 2 refs)
        const state = withAICredits(createState(entities, 31, 3000), 3000);
        const actions = computeAiActionsForPlayer(state, 1);

        // Should produce a vehicle build (any combat vehicle from the vehicle queue)
        const vehicleBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'vehicle' &&
            action.payload.key !== 'harvester'
        );
        expect(vehicleBuild).toBeDefined();
    });

    it('invokes engineer capture for enemy buildings', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 500, 500),
            ai_rifle_1: createEntity('ai_rifle_1', 1, 'UNIT', 'rifle', 400, 400),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 700, 700)
        };

        const state = withAICredits(createState(entities, 31, 2000), 2000);
        const actions = computeAiActionsForPlayer(state, 1);

        const captureAttack = actions.find(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.unitIds.includes('ai_engineer')
        );
        expect(captureAttack).toBeDefined();
    });

    it('transitions to assault phase with lowered thresholds and forces attack', () => {
        // 10 infantry + 3 defenses + factory = assault phase
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 360, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_pillbox_1: createEntity('ai_pillbox_1', 1, 'BUILDING', 'pillbox', 280, 300),
            ai_turret_1: createEntity('ai_turret_1', 1, 'BUILDING', 'turret', 280, 360),
            ai_pillbox_2: createEntity('ai_pillbox_2', 1, 'BUILDING', 'pillbox', 240, 300),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            // 10 infantry to reach assault phase (lowered from 14)
            ai_rifle_1: createEntity('ai_rifle_1', 1, 'UNIT', 'rifle', 500, 500),
            ai_rifle_2: createEntity('ai_rifle_2', 1, 'UNIT', 'rifle', 520, 500),
            ai_rifle_3: createEntity('ai_rifle_3', 1, 'UNIT', 'rifle', 540, 500),
            ai_rifle_4: createEntity('ai_rifle_4', 1, 'UNIT', 'rifle', 560, 500),
            ai_rifle_5: createEntity('ai_rifle_5', 1, 'UNIT', 'rifle', 580, 500),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 500, 520),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 520, 520),
            ai_rocket_3: createEntity('ai_rocket_3', 1, 'UNIT', 'rocket', 540, 520),
            ai_grenadier_1: createEntity('ai_grenadier_1', 1, 'UNIT', 'grenadier', 560, 520),
            ai_grenadier_2: createEntity('ai_grenadier_2', 1, 'UNIT', 'grenadier', 580, 520),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200)
        };

        const state = withAICredits(createState(entities, 31, 3000), 3000);
        const actions = computeAiActionsForPlayer(state, 1);
        const aiState = getAIState(1);

        expect(aiState.strategy).toBe('attack');

        const pressureCommand = actions.find(action =>
            action.type === 'COMMAND_ATTACK' || action.type === 'COMMAND_MOVE'
        );
        expect(pressureCommand).toBeDefined();
    });

    it('queues infantry production proactively', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 360, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 430, 500),
            ore_1: createEntity('ore_1', -1, 'RESOURCE', 'ore', 520, 420),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2400, 2400)
        };

        const state = withAICredits(createState(entities, 31, 2000), 2000);
        const actions = computeAiActionsForPlayer(state, 1);

        const infantryBuild = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'infantry'
        );
        expect(infantryBuild).toBeDefined();
    });

    it('uses weighted infantry selection to mix unit types', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 360, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 430, 500),
            ore_1: createEntity('ore_1', -1, 'RESOURCE', 'ore', 520, 420),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2400, 2400)
        };

        // Run with different ticks (must be full compute ticks for player 1: tick%3===1)
        const infantryTypes = new Set<string>();
        for (let tick = 1; tick < 60; tick += 3) {
            resetAIState();
            const state = withAICredits(createState(entities, tick, 2000), 2000);
            const actions = computeAiActionsForPlayer(state, 1);
            for (const action of actions) {
                if (isActionType(action, 'START_BUILD') && action.payload.category === 'infantry') {
                    infantryTypes.add(action.payload.key);
                }
            }
        }

        // Should produce at least 2 different infantry types (not just spam rifles)
        expect(infantryTypes.size).toBeGreaterThanOrEqual(2);
    });

    it('sends all units on offense during assault phase (no garrison holdback)', () => {
        // Assault phase with many infantry - all units available for offense
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 360, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 360),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 430, 360),
            ai_ref_1: createEntity('ai_ref_1', 1, 'BUILDING', 'refinery', 300, 380),
            ai_pillbox_1: createEntity('ai_pillbox_1', 1, 'BUILDING', 'pillbox', 280, 300),
            ai_turret_1: createEntity('ai_turret_1', 1, 'BUILDING', 'turret', 280, 360),
            ai_pillbox_2: createEntity('ai_pillbox_2', 1, 'BUILDING', 'pillbox', 240, 300),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 470, 470),
            // 12 infantry near base (assault phase)
            ai_rifle_1: createEntity('ai_rifle_1', 1, 'UNIT', 'rifle', 320, 320),
            ai_rifle_2: createEntity('ai_rifle_2', 1, 'UNIT', 'rifle', 340, 320),
            ai_rifle_3: createEntity('ai_rifle_3', 1, 'UNIT', 'rifle', 360, 320),
            ai_rifle_4: createEntity('ai_rifle_4', 1, 'UNIT', 'rifle', 380, 320),
            ai_rifle_5: createEntity('ai_rifle_5', 1, 'UNIT', 'rifle', 320, 340),
            ai_rifle_6: createEntity('ai_rifle_6', 1, 'UNIT', 'rifle', 340, 340),
            ai_rocket_1: createEntity('ai_rocket_1', 1, 'UNIT', 'rocket', 360, 340),
            ai_rocket_2: createEntity('ai_rocket_2', 1, 'UNIT', 'rocket', 380, 340),
            ai_rocket_3: createEntity('ai_rocket_3', 1, 'UNIT', 'rocket', 320, 360),
            ai_grenadier_1: createEntity('ai_grenadier_1', 1, 'UNIT', 'grenadier', 340, 360),
            ai_grenadier_2: createEntity('ai_grenadier_2', 1, 'UNIT', 'grenadier', 360, 360),
            ai_flamer_1: createEntity('ai_flamer_1', 1, 'UNIT', 'flamer', 380, 360),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2200, 2200)
        };

        const state = withAICredits(createState(entities, 31, 3000), 3000);
        computeAiActionsForPlayer(state, 1);
        const aiState = getAIState(1);

        // Should be in attack mode with large army
        expect(aiState.strategy).toBe('attack');

        // No garrison holdback - defense buildings protect the base
        expect(aiState.defenseGroup.length).toBe(0);
    });
});

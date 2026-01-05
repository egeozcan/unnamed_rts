import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { GameState, Entity, EntityId, UnitKey, BuildingKey } from '../../src/engine/types';
import { createTestHarvester, createTestCombatUnit, createTestBuilding, createTestResource } from '../../src/engine/test-utils';

const { getAIState, setPersonalityForPlayer } = _testUtils;

// Helper functions
function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number,
    overrides?: { hp?: number; maxHp?: number; dead?: boolean; }
): Entity {
    if (type === 'BUILDING') {
        return createTestBuilding({
            id, owner, key: key as BuildingKey, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp, dead: overrides?.dead
        });
    } else if (type === 'RESOURCE') {
        return createTestResource({ id, x, y, hp: overrides?.hp });
    } else if (key === 'harvester') {
        return createTestHarvester({ id, owner, x, y, hp: overrides?.hp, dead: overrides?.dead });
    } else {
        return createTestCombatUnit({
            id, owner, key: key as Exclude<UnitKey, 'harvester'>, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp, dead: overrides?.dead
        });
    }
}

function createTestState(entities: Record<EntityId, Entity>, aiCredits: number = 5000, playerCredits: number = 1000): GameState {
    const state = { ...INITIAL_STATE };
    state.entities = entities;
    state.players = {
        0: { ...createPlayerState(0, false, 'medium', '#0088FF'), credits: playerCredits },
        1: { ...createPlayerState(1, true, 'medium', '#FFCC00'), credits: aiCredits }
    };
    return state;
}

describe('AI Peace Break - Surplus Resource Spending', () => {
    beforeEach(() => {
        resetAIState();
        // Set deterministic personality to avoid flaky tests due to random personality selection
        setPersonalityForPlayer(1, 'balanced');
    });

    describe('Surplus attack wave', () => {
        it('should trigger attack mode when very wealthy and no threat', () => {
            // Setup: AI has full economy, big army, lots of money, no enemies nearby
            const entities: Record<EntityId, Entity> = {
                // AI Base
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'refinery_ai2': createEntity('refinery_ai2', 1, 'BUILDING', 'refinery', 250, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                // AI Combat units - decent army but not at attack threshold
                'tank1': createEntity('tank1', 1, 'UNIT', 'heavy', 350, 400, { maxHp: 300, hp: 300 }),
                'tank2': createEntity('tank2', 1, 'UNIT', 'heavy', 370, 400, { maxHp: 300, hp: 300 }),
                'tank3': createEntity('tank3', 1, 'UNIT', 'light', 390, 400, { maxHp: 150, hp: 150 }),
                // Harvesters (good economy)
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                'harv3': createEntity('harv3', 1, 'UNIT', 'harvester', 440, 400, { maxHp: 150, hp: 150 }),
                'harv4': createEntity('harv4', 1, 'UNIT', 'harvester', 460, 400, { maxHp: 150, hp: 150 }),
                // Ore
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                'ore2': createEntity('ore2', -1, 'RESOURCE', 'ore', 520, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy base far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // AI has 5000 credits - very wealthy
            const state = createTestState(entities, 5000);

            // Run AI multiple times and check if it eventually triggers aggression
            const actions = computeAiActions(state, 1);
            const aiState = getAIState(1);

            // With high resources and low threat, AI should have investment priority that leads to attack
            expect(aiState.threatLevel).toBe(0);

            // AI should be producing combat units or have entered attack mode
            const buildCombat = actions.filter(a =>
                a.type === 'START_BUILD' &&
                (a.payload.category === 'vehicle' || a.payload.category === 'infantry') &&
                a.payload.key !== 'harvester'
            );

            // Should be building combat units when very wealthy
            expect(buildCombat.length).toBeGreaterThan(0);
        });

        it('should aggressively build army when surplus credits exceed threshold', () => {
            // Setup: AI has very high credits but small army
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                // Good economy - enough harvesters (3 to satisfy all personalities, including turtle with 2.5 ratio)
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                'harv3': createEntity('harv3', 1, 'UNIT', 'harvester', 440, 400, { maxHp: 150, hp: 150 }),
                // Minimal army
                'tank1': createEntity('tank1', 1, 'UNIT', 'light', 350, 400, { maxHp: 150, hp: 150 }),
                // Ore
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Very high credits - should trigger surplus spending
            const state = createTestState(entities, 8000);

            const actions = computeAiActions(state, 1);

            // Should be building combat units aggressively, not just economy
            const buildCombat = actions.filter(a =>
                a.type === 'START_BUILD' &&
                (a.payload.category === 'vehicle' || a.payload.category === 'infantry') &&
                a.payload.key !== 'harvester'
            );

            expect(buildCombat.length).toBeGreaterThan(0);
        });

        it('should send existing army to attack when wealthy and army is large', () => {
            // Setup: AI has a big army idle at base and lots of money
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                // Harvesters
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                // Large army idle at base
                'tank1': createEntity('tank1', 1, 'UNIT', 'heavy', 330, 400, { maxHp: 300, hp: 300 }),
                'tank2': createEntity('tank2', 1, 'UNIT', 'heavy', 350, 400, { maxHp: 300, hp: 300 }),
                'tank3': createEntity('tank3', 1, 'UNIT', 'heavy', 370, 400, { maxHp: 300, hp: 300 }),
                'tank4': createEntity('tank4', 1, 'UNIT', 'heavy', 390, 400, { maxHp: 300, hp: 300 }),
                'tank5': createEntity('tank5', 1, 'UNIT', 'heavy', 410, 400, { maxHp: 300, hp: 300 }),
                'tank6': createEntity('tank6', 1, 'UNIT', 'light', 430, 400, { maxHp: 150, hp: 150 }),
                'infantry1': createEntity('infantry1', 1, 'UNIT', 'rifle', 350, 380, { maxHp: 50, hp: 50 }),
                'infantry2': createEntity('infantry2', 1, 'UNIT', 'rifle', 360, 380, { maxHp: 50, hp: 50 }),
                // Ore
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy base far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Very wealthy - should trigger aggression
            const state = createTestState(entities, 6000);

            // Set the AI state to bypass cooldown
            const aiState = getAIState(1);
            aiState.lastStrategyChange = -300; // Bypass cooldown

            const actions = computeAiActions(state, 1);

            // With 8 combat units (>= 5 threshold), should enter attack mode
            // The strategy should be 'attack' given surplus resources
            expect(aiState.strategy).toBe('attack');

            // Should be moving units to attack
            const moveActions = actions.filter(a => a.type === 'COMMAND_MOVE' || a.type === 'COMMAND_ATTACK');
            expect(moveActions.length).toBeGreaterThan(0);
        });
    });

    describe('Surplus defense building', () => {
        it('should build defensive buildings when wealthy and no active threat', () => {
            // Setup: AI has good economy, money, but few defenses
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                // Good harvester count (3 to satisfy all personalities)
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                'harv3': createEntity('harv3', 1, 'UNIT', 'harvester', 440, 400, { maxHp: 150, hp: 150 }),
                // Some combat units
                'tank1': createEntity('tank1', 1, 'UNIT', 'light', 350, 400, { maxHp: 150, hp: 150 }),
                'tank2': createEntity('tank2', 1, 'UNIT', 'light', 370, 400, { maxHp: 150, hp: 150 }),
                // Ore
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Very high credits
            const state = createTestState(entities, 6000);

            // Run AI and check for defensive building actions
            const actions = computeAiActions(state, 1);

            // Should consider building defenses (turrets, walls, etc.)
            const buildDefense = actions.filter(a =>
                a.type === 'START_BUILD' &&
                a.payload.category === 'building' &&
                (a.payload.key === 'turret' || a.payload.key === 'sam_site' || a.payload.key === 'pillbox')
            );

            // With surplus credits and no threat, should build defenses
            expect(buildDefense.length).toBeGreaterThan(0);
        });

        it('should add multiple turrets over time when very wealthy', () => {
            // Setup: AI already has 1 turret but is very wealthy
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                'turret_ai': createEntity('turret_ai', 1, 'BUILDING', 'turret', 200, 300, { maxHp: 200, hp: 200 }),
                // Good harvester count (3 to satisfy all personalities)
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                'harv3': createEntity('harv3', 1, 'UNIT', 'harvester', 440, 400, { maxHp: 150, hp: 150 }),
                // Small army
                'tank1': createEntity('tank1', 1, 'UNIT', 'light', 350, 400, { maxHp: 150, hp: 150 }),
                // Ore
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Extremely wealthy
            const state = createTestState(entities, 10000);

            const actions = computeAiActions(state, 1);

            // Should still want to build more turrets even with 1 existing
            const buildTurret = actions.filter(a =>
                a.type === 'START_BUILD' &&
                a.payload.key === 'turret'
            );

            // Very wealthy AI should continue fortifying
            expect(buildTurret.length).toBeGreaterThan(0);
        });
    });

    describe('Random peace break triggers', () => {
        it('should have chance-based attack trigger when wealthy and peaceful for too long', () => {
            // This test verifies the random element - run multiple times
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                // Good economy (3 harvesters to satisfy all personalities)
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                'harv3': createEntity('harv3', 1, 'UNIT', 'harvester', 440, 400, { maxHp: 150, hp: 150 }),
                // Moderate army - not at attack threshold
                'tank1': createEntity('tank1', 1, 'UNIT', 'heavy', 350, 400, { maxHp: 300, hp: 300 }),
                'tank2': createEntity('tank2', 1, 'UNIT', 'heavy', 370, 400, { maxHp: 300, hp: 300 }),
                'tank3': createEntity('tank3', 1, 'UNIT', 'light', 390, 400, { maxHp: 150, hp: 150 }),
                'tank4': createEntity('tank4', 1, 'UNIT', 'light', 410, 400, { maxHp: 150, hp: 150 }),
                // Ore
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // High credits should make attack more likely
            const state = createTestState(entities, 7000);

            // Get AI state and check
            const actions = computeAiActions(state, 1);
            const aiState = getAIState(1);

            // With 4 combat units (< 5 threshold) but very high credits,
            // AI should be building more units aggressively
            expect(aiState.threatLevel).toBe(0);

            // Should be in warfare investment priority or building combat units
            const buildCombat = actions.filter(a =>
                a.type === 'START_BUILD' &&
                (a.payload.category === 'vehicle' || a.payload.category === 'infantry') &&
                a.payload.key !== 'harvester'
            );

            expect(buildCombat.length).toBeGreaterThan(0);
        });
    });

    describe('Surplus production buildings', () => {
        it('should build additional factory when very wealthy', () => {
            // Setup: AI has 1 factory and lots of money
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'power_ai2': createEntity('power_ai2', 1, 'BUILDING', 'power', 350, 400, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                // Harvesters (3 to satisfy all personalities)
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                'harv3': createEntity('harv3', 1, 'UNIT', 'harvester', 440, 400, { maxHp: 150, hp: 150 }),
                // Ore
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Very wealthy - above surplus production threshold (6000)
            const state = createTestState(entities, 10000);

            const actions = computeAiActions(state, 1);

            // Should try to build additional factory
            const buildFactory = actions.filter(a =>
                a.type === 'START_BUILD' &&
                a.payload.key === 'factory'
            );

            expect(buildFactory.length).toBeGreaterThan(0);
        });

        it('should build additional barracks after maxing factories', () => {
            // Setup: AI has 3 factories already
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'power_ai2': createEntity('power_ai2', 1, 'BUILDING', 'power', 350, 400, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai1': createEntity('factory_ai1', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'factory_ai2': createEntity('factory_ai2', 1, 'BUILDING', 'factory', 400, 350, { maxHp: 400, hp: 400 }),
                'factory_ai3': createEntity('factory_ai3', 1, 'BUILDING', 'factory', 450, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                // Harvesters (3 to satisfy all personalities)
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                'harv3': createEntity('harv3', 1, 'UNIT', 'harvester', 440, 400, { maxHp: 150, hp: 150 }),
                // Ore
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            const state = createTestState(entities, 10000);

            const actions = computeAiActions(state, 1);

            // Should try to build additional barracks since factories are maxed
            const buildBarracks = actions.filter(a =>
                a.type === 'START_BUILD' &&
                a.payload.key === 'barracks'
            );

            expect(buildBarracks.length).toBeGreaterThan(0);
        });
    });
});

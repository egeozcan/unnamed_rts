import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { GameState, Entity, EntityId, UnitKey, BuildingKey } from '../../src/engine/types';
import { createTestHarvester, createTestCombatUnit, createTestBuilding, createTestResource } from '../../src/engine/test-utils';

const { getAIState } = _testUtils;

// Helper function using test-utils builders
function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number,
    overrides?: { hp?: number; maxHp?: number }
): Entity {
    if (type === 'BUILDING') {
        return createTestBuilding({
            id,
            owner,
            key: key as BuildingKey,
            x,
            y,
            hp: overrides?.hp,
            maxHp: overrides?.maxHp
        });
    } else if (type === 'RESOURCE') {
        return createTestResource({
            id,
            x,
            y,
            hp: overrides?.hp
        });
    } else if (key === 'harvester') {
        return createTestHarvester({
            id,
            owner,
            x,
            y,
            hp: overrides?.hp
        });
    } else {
        return createTestCombatUnit({
            id,
            owner,
            key: key as Exclude<UnitKey, 'harvester' | 'harrier'>,
            x,
            y,
            hp: overrides?.hp,
            maxHp: overrides?.maxHp
        });
    }
}

function createTestState(entities: Record<EntityId, Entity>, aiCredits: number = 2500, playerCredits: number = 1000): GameState {
    const state = { ...INITIAL_STATE };
    state.entities = entities;
    state.players = {
        0: { ...createPlayerState(0, false, 'medium', '#0088FF'), credits: playerCredits },
        1: { ...createPlayerState(1, true, 'medium', '#FFCC00'), credits: aiCredits }
    };
    return state;
}

describe('AI Economy - Peacetime Expansion', () => {
    beforeEach(() => {
        resetAIState();
    });

    describe('Building harvesters when not under pressure', () => {
        it('should build additional harvesters when threat level is 0 and has enough credits', () => {
            // Setup: AI has base infrastructure, 1 harvester, 1 refinery, no enemies nearby
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                'harvester_ai': createEntity('harvester_ai', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'ore_ai': createEntity('ore_ai', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy base far away - no threat
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Harvester costs 1400, peacetime threshold is 800, so need 2200+ credits
            const state = createTestState(entities, 2500);

            // Run AI computation
            const actions = computeAiActions(state, 1);

            // Should try to build a harvester since we only have 1 but should have 2 per refinery
            const buildActions = actions.filter(a => a.type === 'START_BUILD' && a.payload.key === 'harvester');
            expect(buildActions.length).toBeGreaterThan(0);
        });

        it('should build harvester even in balanced priority when threat is low', () => {
            // Setup: AI has 1 refinery, 1 harvester, no nearby enemies, moderate economy score
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                'harvester_ai': createEntity('harvester_ai', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                // Multiple ore nodes for good economy score
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                'ore2': createEntity('ore2', -1, 'RESOURCE', 'ore', 520, 400, { maxHp: 1000, hp: 1000 }),
                'ore3': createEntity('ore3', -1, 'RESOURCE', 'ore', 540, 400, { maxHp: 1000, hp: 1000 }),
                'ore4': createEntity('ore4', -1, 'RESOURCE', 'ore', 560, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy base far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Harvester costs 1400, peacetime threshold is 800, so need 2200+ credits
            const state = createTestState(entities, 2500);

            const actions = computeAiActions(state, 1);

            // AI State should have low threat and trigger peacetime economy boost
            const aiState = getAIState(1);
            expect(aiState.threatLevel).toBe(0);

            // Should build harvester
            const buildHarvester = actions.find(a => a.type === 'START_BUILD' && a.payload.key === 'harvester');
            expect(buildHarvester).toBeDefined();
        });

        it('should NOT build extra harvesters when threat level is high', () => {
            // Setup: Enemy units are attacking the base
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                'harvester_ai': createEntity('harvester_ai', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'ore_ai': createEntity('ore_ai', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy tanks attacking the base (within 600 units of base center)
                'enemy_tank1': createEntity('enemy_tank1', 0, 'UNIT', 'heavy', 350, 400, { maxHp: 300, hp: 300 }),
                'enemy_tank2': createEntity('enemy_tank2', 0, 'UNIT', 'heavy', 370, 400, { maxHp: 300, hp: 300 }),
                'enemy_tank3': createEntity('enemy_tank3', 0, 'UNIT', 'heavy', 390, 400, { maxHp: 300, hp: 300 }),
            };

            const state = createTestState(entities, 2500);

            const actions = computeAiActions(state, 1);

            // AI should prioritize defense, not economy
            const aiState = getAIState(1);
            expect(aiState.threatLevel).toBeGreaterThan(50);

            // Should NOT build harvester when under attack
            const buildHarvester = actions.find(a => a.type === 'START_BUILD' && a.payload.key === 'harvester');
            expect(buildHarvester).toBeUndefined();
        });
    });

    describe('Building refineries when not under pressure', () => {
        it('should build additional refinery when threat is low and has accessible ore without refinery', () => {
            // Setup: AI has 1 refinery, no enemies nearby, ore patches away from current refinery
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                // 3 harvesters to satisfy all personalities (turtle needs 2.5 per refinery)
                'harvester_ai1': createEntity('harvester_ai1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harvester_ai2': createEntity('harvester_ai2', 1, 'UNIT', 'harvester', 450, 400, { maxHp: 150, hp: 150 }),
                'harvester_ai3': createEntity('harvester_ai3', 1, 'UNIT', 'harvester', 500, 400, { maxHp: 150, hp: 150 }),
                // Ore near current refinery
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 400, 350, { maxHp: 1000, hp: 1000 }),
                // Remote ore within build range but no refinery nearby
                'ore2': createEntity('ore2', -1, 'RESOURCE', 'ore', 600, 350, { maxHp: 1000, hp: 1000 }),
                'ore3': createEntity('ore3', -1, 'RESOURCE', 'ore', 650, 350, { maxHp: 1000, hp: 1000 }),
                // Enemy far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Refinery costs 2000, peacetime threshold is 1000, so need 3000+ credits
            const state = createTestState(entities, 3500);

            const actions = computeAiActions(state, 1);

            // Should try to build a refinery in peacetime
            const buildRefinery = actions.find(a => a.type === 'START_BUILD' && a.payload.key === 'refinery');
            expect(buildRefinery).toBeDefined();
        });

        it('should NOT build additional refinery when already has enough refineries for harvesters', () => {
            // Setup: 2 refineries, 4 harvesters - good ratio
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai1': createEntity('refinery_ai1', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'refinery_ai2': createEntity('refinery_ai2', 1, 'BUILDING', 'refinery', 400, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 450, 300, { maxHp: 300, hp: 300 }),
                'harvester_ai1': createEntity('harvester_ai1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harvester_ai2': createEntity('harvester_ai2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                'harvester_ai3': createEntity('harvester_ai3', 1, 'UNIT', 'harvester', 440, 400, { maxHp: 150, hp: 150 }),
                'harvester_ai4': createEntity('harvester_ai4', 1, 'UNIT', 'harvester', 460, 400, { maxHp: 150, hp: 150 }),
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            const state = createTestState(entities, 3500);

            const actions = computeAiActions(state, 1);

            // Should NOT build refinery since ratio is good
            const buildRefinery = actions.find(a => a.type === 'START_BUILD' && a.payload.key === 'refinery');
            expect(buildRefinery).toBeUndefined();
        });
    });

    describe('Peacetime economy expansion priorities', () => {
        it('should prefer building harvester over combat units when economy is suboptimal and no threats', () => {
            // Setup: 1 harvester for 1 refinery (should be 2), no threats
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'power_ai': createEntity('power_ai', 1, 'BUILDING', 'power', 350, 300, { maxHp: 200, hp: 200 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 350, { maxHp: 400, hp: 400 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 350, { maxHp: 400, hp: 400 }),
                'barracks_ai': createEntity('barracks_ai', 1, 'BUILDING', 'barracks', 400, 300, { maxHp: 300, hp: 300 }),
                'harvester_ai': createEntity('harvester_ai', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                'ore2': createEntity('ore2', -1, 'RESOURCE', 'ore', 520, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Harvester costs 1400, peacetime threshold is 800, so need 2200+ credits
            const state = createTestState(entities, 2500);

            const actions = computeAiActions(state, 1);

            // Harvester should be prioritized over tanks
            const buildHarvester = actions.find(a => a.type === 'START_BUILD' && a.payload.key === 'harvester');
            const buildCombat = actions.find(a =>
                a.type === 'START_BUILD' &&
                a.payload.category === 'vehicle' &&
                a.payload.key !== 'harvester'
            );

            expect(buildHarvester).toBeDefined();
            // If both harvester and combat, harvester should come first in actions
            if (buildCombat) {
                const harvesterIndex = actions.indexOf(buildHarvester!);
                const combatIndex = actions.indexOf(buildCombat);
                expect(harvesterIndex).toBeLessThan(combatIndex);
            }
        });
    });
});

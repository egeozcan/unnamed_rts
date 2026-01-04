import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { GameState, Entity, EntityId, UnitKey, BuildingKey } from '../../src/engine/types';
import { createTestHarvester, createTestCombatUnit, createTestBuilding, createTestResource } from '../../src/engine/test-utils';

const { getAIState } = _testUtils;

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

function createTestState(entities: Record<EntityId, Entity>, credits: number = 2000): GameState {
    const basePlayer = createPlayerState(1, true, 'medium');
    return {
        ...INITIAL_STATE,
        running: true,
        tick: 30,
        entities,
        players: {
            1: { ...basePlayer, credits }
        }
    };
}

describe('Staggered Unit Production', () => {
    beforeEach(() => { resetAIState(); });

    describe('Alternating Production', () => {
        it('should build vehicle first when both factories are available', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['barracks'] = createEntity('barracks', 1, 'BUILDING', 'barracks', 600, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 700, 500);

            const state = createTestState(entities, 2000);
            const aiState = getAIState(1);
            aiState.lastProductionType = null; // Never produced before

            const actions = computeAiActions(state, 1);

            const vehicleBuild = actions.find(a =>
                a.type === 'START_BUILD' && a.payload.category === 'vehicle'
            );
            const infantryBuild = actions.find(a =>
                a.type === 'START_BUILD' && a.payload.category === 'infantry'
            );

            // First production should be vehicle (stronger), not infantry
            expect(vehicleBuild).toBeDefined();
            // Should NOT build both at once (staggered)
            expect(infantryBuild).toBeUndefined();
        });

        it('should alternate to infantry after building vehicle', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['barracks'] = createEntity('barracks', 1, 'BUILDING', 'barracks', 600, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 700, 500);

            const state = createTestState(entities, 2000);
            const aiState = getAIState(1);
            aiState.lastProductionType = 'vehicle'; // Just built a vehicle

            const actions = computeAiActions(state, 1);

            const infantryBuild = actions.find(a =>
                a.type === 'START_BUILD' && a.payload.category === 'infantry'
            );

            // After vehicle, should build infantry
            expect(infantryBuild).toBeDefined();
            expect(aiState.lastProductionType).toBe('infantry');
        });

        it('should alternate to vehicle after building infantry', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['barracks'] = createEntity('barracks', 1, 'BUILDING', 'barracks', 600, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 700, 500);

            const state = createTestState(entities, 2000);
            const aiState = getAIState(1);
            aiState.lastProductionType = 'infantry'; // Just built infantry

            const actions = computeAiActions(state, 1);

            const vehicleBuild = actions.find(a =>
                a.type === 'START_BUILD' && a.payload.category === 'vehicle'
            );

            // After infantry, should build vehicle
            expect(vehicleBuild).toBeDefined();
            expect(aiState.lastProductionType).toBe('vehicle');
        });
    });

    describe('Strategy-Based Credit Thresholds', () => {
        it('should not build units when credits are below threshold', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            // Credits at 400 - below all thresholds
            const state = createTestState(entities, 400);
            const aiState = getAIState(1);
            aiState.lastProductionType = null;

            const actions = computeAiActions(state, 1);

            const buildAction = actions.find(a =>
                a.type === 'START_BUILD' &&
                (a.payload.category === 'vehicle' || a.payload.category === 'infantry')
            );
            // Below threshold, should NOT build units
            expect(buildAction).toBeUndefined();
        });

        it('should build units when credits are above threshold', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['barracks'] = createEntity('barracks', 1, 'BUILDING', 'barracks', 600, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 700, 500);

            // Credits at 2000 - well above all thresholds
            const state = createTestState(entities, 2000);
            const aiState = getAIState(1);
            aiState.lastProductionType = null;

            const actions = computeAiActions(state, 1);

            const buildAction = actions.find(a =>
                a.type === 'START_BUILD' &&
                (a.payload.category === 'vehicle' || a.payload.category === 'infantry')
            );
            // Above threshold, should build units
            expect(buildAction).toBeDefined();
        });
    });

    describe('Credit Buffer', () => {
        it('should not drop below credit buffer when building', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            // Credits just above attack threshold but building would drop below buffer
            // Attack mode: threshold 500, buffer 300
            // Light tank costs ~500, so with 600 credits, 600-500=100 < 300 buffer
            const state = createTestState(entities, 600);
            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.lastProductionType = null;

            const actions = computeAiActions(state, 1);

            const buildAction = actions.find(a =>
                a.type === 'START_BUILD' && a.payload.category === 'vehicle'
            );
            // Should not build because it would drop below buffer
            expect(buildAction).toBeUndefined();
        });

        it('should build when credit buffer is maintained', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['barracks'] = createEntity('barracks', 1, 'BUILDING', 'barracks', 600, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 700, 500);
            // Add refinery and harvester so economy score isn't 0 (which triggers economy priority)
            entities['refinery'] = createEntity('refinery', 1, 'BUILDING', 'refinery', 800, 500);
            entities['harvester'] = createEntity('harvester', 1, 'UNIT', 'harvester', 850, 500);
            // Add combat units to meet attack threshold
            for (let i = 0; i < 6; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'rifle', 600 + i * 20, 600);
            }
            // Add enemy so attack strategy is maintained
            entities['enemy'] = createEntity('enemy', 0, 'UNIT', 'rifle', 2000, 2000);

            // Attack mode: threshold 500, buffer 300
            // Rifle costs ~100, so with 600 credits, 600-100=500 > 300 buffer
            const state = createTestState(entities, 600);
            const aiState = getAIState(1);
            aiState.personality = 'rusher'; // Set consistent personality for test
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = 0; // Prevent immediate strategy re-evaluation
            aiState.lastProductionType = 'vehicle'; // Set to vehicle so next should be infantry

            const actions = computeAiActions(state, 1);

            const buildAction = actions.find(a =>
                a.type === 'START_BUILD' && a.payload.category === 'infantry'
            );
            // Should build infantry because it maintains buffer
            expect(buildAction).toBeDefined();
        });
    });

    describe('Single-Factory Production', () => {
        it('should build infantry when only barracks available', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['barracks'] = createEntity('barracks', 1, 'BUILDING', 'barracks', 600, 500);
            // No factory

            const state = createTestState(entities, 2000);
            const aiState = getAIState(1);
            aiState.lastProductionType = 'vehicle'; // Would normally build vehicle

            const actions = computeAiActions(state, 1);

            const infantryBuild = actions.find(a =>
                a.type === 'START_BUILD' && a.payload.category === 'infantry'
            );
            const vehicleBuild = actions.find(a =>
                a.type === 'START_BUILD' && a.payload.category === 'vehicle'
            );

            expect(infantryBuild).toBeDefined();
            expect(vehicleBuild).toBeUndefined();
        });

        it('should build vehicle when only factory available', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);
            // No barracks

            const state = createTestState(entities, 2000);
            const aiState = getAIState(1);
            aiState.lastProductionType = 'infantry'; // Would normally build infantry

            const actions = computeAiActions(state, 1);

            const vehicleBuild = actions.find(a =>
                a.type === 'START_BUILD' && a.payload.category === 'vehicle'
            );
            const infantryBuild = actions.find(a =>
                a.type === 'START_BUILD' && a.payload.category === 'infantry'
            );

            expect(vehicleBuild).toBeDefined();
            expect(infantryBuild).toBeUndefined();
        });
    });
});

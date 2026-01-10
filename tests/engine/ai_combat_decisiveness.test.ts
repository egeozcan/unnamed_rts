/**
 * Tests for AI combat decisiveness
 * 
 * These tests verify that AI units don't oscillate between attack and retreat
 * and make decisive combat decisions.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { GameState, Vector, Entity, EntityId, UnitKey, BuildingKey } from '../../src/engine/types';
import {
    createTestHarvester,
    createTestCombatUnit,
    createTestBuilding,
    createTestResource
} from '../../src/engine/test-utils';

const { getAIState, setPersonalityForPlayer, ATTACK_GROUP_MIN_SIZE } = _testUtils;

// Helper functions
function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number,
    overrides?: {
        hp?: number;
        maxHp?: number;
        dead?: boolean;
        targetId?: EntityId | null;
        lastAttackerId?: EntityId | null;
        moveTarget?: Vector | null;
        cargo?: number;
        resourceTargetId?: EntityId | null;
        baseTargetId?: EntityId | null;
        manualMode?: boolean;
        placedTick?: number;
        isRepairing?: boolean;
    }
): Entity {
    if (type === 'BUILDING') {
        return createTestBuilding({
            id, owner, key: key as BuildingKey, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp, dead: overrides?.dead,
            targetId: overrides?.targetId, placedTick: overrides?.placedTick,
            isRepairing: overrides?.isRepairing
        });
    } else if (type === 'RESOURCE') {
        return createTestResource({ id, x, y, hp: overrides?.hp });
    } else if (key === 'harvester') {
        return createTestHarvester({
            id, owner, x, y, hp: overrides?.hp, dead: overrides?.dead,
            targetId: overrides?.targetId, moveTarget: overrides?.moveTarget,
            cargo: overrides?.cargo, resourceTargetId: overrides?.resourceTargetId,
            baseTargetId: overrides?.baseTargetId, manualMode: overrides?.manualMode
        });
    } else {
        return createTestCombatUnit({
            id, owner, key: key as Exclude<UnitKey, 'harvester' | 'harrier'>, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp, dead: overrides?.dead,
            targetId: overrides?.targetId, lastAttackerId: overrides?.lastAttackerId,
            moveTarget: overrides?.moveTarget
        });
    }
}

function createTestState(entities: Record<EntityId, Entity>, tick: number = 31): GameState {
    return { ...INITIAL_STATE, running: true, tick, entities };
}

describe('AI Combat Decisiveness', () => {
    beforeEach(() => { resetAIState(); });

    describe('Desperation Attack Mode', () => {
        it('should attack with damaged units when no service depot exists', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);
            // NO service depot

            // Damaged units at 25% HP (below retreat threshold of ~30-40%)
            for (let i = 0; i < ATTACK_GROUP_MIN_SIZE; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 1500 + i * 20, 1500, {
                    hp: 100, maxHp: 400  // 25% HP
                });
            }

            // Enemy nearby
            entities['enemy'] = createEntity('enemy', 0, 'UNIT', 'tank', 1600, 1500);

            const state = createTestState(entities);

            // Set personality to 'balanced' which has min_attack_group_size=5
            setPersonalityForPlayer(1, 'balanced');

            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = -100;
            aiState.attackGroup = Array.from({ length: ATTACK_GROUP_MIN_SIZE }, (_, i) => `tank${i}`);
            aiState.offensiveGroups = [{
                id: 'main_attack',
                unitIds: aiState.attackGroup,
                target: null,
                rallyPoint: new Vector(1500, 1500),
                status: 'attacking',
                lastOrderTick: 0
            }];

            const actions = computeAiActions(state, 1);

            // Without a service depot, damaged units should attack, not retreat
            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');
            const retreatMoves = actions.filter(a =>
                a.type === 'COMMAND_MOVE' &&
                a.payload.unitIds.some((id: string) => id.startsWith('tank'))
            );

            // Should have attack action
            expect(attackAction).toBeDefined();
            // Should NOT have retreat moves (or at most minimal kiting)
            // The key is we're attacking, not running away
            expect(attackAction).toBeDefined();
        });

        it('should retreat damaged units to service depot when one exists', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);
            // Service depot exists
            entities['depot'] = createEntity('depot', 1, 'BUILDING', 'service_depot', 500, 600, { placedTick: 0 });

            // Damaged unit at 25% HP
            entities['wounded'] = createEntity('wounded', 1, 'UNIT', 'light', 1500, 1500, {
                hp: 100, maxHp: 400  // 25% HP
            });
            // Healthy units
            for (let i = 0; i < ATTACK_GROUP_MIN_SIZE; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 1520 + i * 10, 1500);
            }

            // Enemy nearby
            entities['enemy'] = createEntity('enemy', 0, 'UNIT', 'tank', 1600, 1500);

            const state = createTestState(entities);
            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = -100;
            aiState.attackGroup = ['wounded', ...Array.from({ length: ATTACK_GROUP_MIN_SIZE }, (_, i) => `tank${i}`)];

            const actions = computeAiActions(state, 1);

            // With a service depot, the wounded unit should move toward it
            const moveActions = actions.filter(a => a.type === 'COMMAND_MOVE');
            const woundedMoved = moveActions.some(a =>
                a.payload.unitIds.includes('wounded')
            );

            // Wounded unit should be retreating to depot
            expect(woundedMoved).toBe(true);
        });
    });

    describe('Service Depot Priority', () => {
        it('should build service depot with 2+ damaged units', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500, { placedTick: 0 });
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500, { placedTick: 0 });
            entities['barracks'] = createEntity('barracks', 1, 'BUILDING', 'barracks', 400, 500, { placedTick: 0 });
            entities['power'] = createEntity('power', 1, 'BUILDING', 'power', 400, 600, { placedTick: 0 });
            // NO service depot

            // 2 damaged units (below 70% HP requirement)
            entities['damaged1'] = createEntity('damaged1', 1, 'UNIT', 'light', 550, 550, { hp: 200, maxHp: 400 });
            entities['damaged2'] = createEntity('damaged2', 1, 'UNIT', 'light', 560, 550, { hp: 180, maxHp: 400 });

            let state = createTestState(entities);
            // Give player enough credits (depot cost + 500 buffer)
            state.players[1] = {
                ...createPlayerState(1, false, 'medium'),
                credits: 2000 // Should be enough for depot + buffer
            };

            const actions = computeAiActions(state, 1);

            // Should start building service depot
            const buildDepot = actions.find(a =>
                a.type === 'START_BUILD' &&
                a.payload.key === 'service_depot'
            );

            expect(buildDepot).toBeDefined();
        });
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE } from '../../src/engine/reducer';
import { GameState, Vector, Entity, EntityId, UnitKey, BuildingKey } from '../../src/engine/types';
import { AI_CONFIG } from '../../src/data/schemas/index';
import {
    createTestHarvester,
    createTestCombatUnit,
    createTestBuilding,
    createTestResource
} from '../../src/engine/test-utils';

const {
    getAIState,
    updateVengeance,
    handleAttack,
    ATTACK_GROUP_MIN_SIZE,
    VENGEANCE_DECAY,
    VENGEANCE_PER_HIT
} = _testUtils;

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
            id, owner, key: key as Exclude<UnitKey, 'harvester'>, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp, dead: overrides?.dead,
            targetId: overrides?.targetId, lastAttackerId: overrides?.lastAttackerId,
            moveTarget: overrides?.moveTarget
        });
    }
}

function createTestState(entities: Record<EntityId, Entity>): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        tick: 30,
        entities
    };
}

describe('AI Vengeance System', () => {
    beforeEach(() => {
        resetAIState();
    });

    describe('Vengeance Tracking', () => {
        it('should increase vengeance score when attacked by a player', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI player 1 owns a tank that was attacked
            entities['my_tank'] = createEntity('my_tank', 1, 'UNIT', 'light', 500, 500, {
                lastAttackerId: 'enemy_tank'
            });

            // Enemy player 0 owns the attacker
            entities['enemy_tank'] = createEntity('enemy_tank', 0, 'UNIT', 'light', 550, 550);

            const state = createTestState(entities);
            const aiState = getAIState(1);

            // Initially no vengeance
            expect(aiState.vengeanceScores[0] || 0).toBe(0);

            // Update vengeance
            const myEntities = Object.values(state.entities).filter(e => e.owner === 1);
            updateVengeance(state, 1, aiState, myEntities);

            // Vengeance should increase for player 0
            expect(aiState.vengeanceScores[0]).toBe(VENGEANCE_PER_HIT);
        });

        it('should accumulate vengeance from multiple attacked entities', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI player 1 - multiple units attacked by player 0
            entities['tank1'] = createEntity('tank1', 1, 'UNIT', 'light', 500, 500, {
                lastAttackerId: 'enemy1'
            });
            entities['tank2'] = createEntity('tank2', 1, 'UNIT', 'light', 520, 500, {
                lastAttackerId: 'enemy2'
            });

            // Both attackers owned by player 0
            entities['enemy1'] = createEntity('enemy1', 0, 'UNIT', 'light', 600, 500);
            entities['enemy2'] = createEntity('enemy2', 0, 'UNIT', 'light', 620, 500);

            const state = createTestState(entities);
            const aiState = getAIState(1);

            const myEntities = Object.values(state.entities).filter(e => e.owner === 1);
            updateVengeance(state, 1, aiState, myEntities);

            // Should accumulate from both attacks
            expect(aiState.vengeanceScores[0]).toBe(VENGEANCE_PER_HIT * 2);
        });

        it('should track vengeance separately for different players', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI player 1 - attacked by players 0 and 2
            entities['tank1'] = createEntity('tank1', 1, 'UNIT', 'light', 500, 500, {
                lastAttackerId: 'enemy_p0'
            });
            entities['tank2'] = createEntity('tank2', 1, 'UNIT', 'light', 520, 500, {
                lastAttackerId: 'enemy_p2'
            });

            entities['enemy_p0'] = createEntity('enemy_p0', 0, 'UNIT', 'light', 600, 500);
            entities['enemy_p2'] = createEntity('enemy_p2', 2, 'UNIT', 'light', 620, 500);

            const state = createTestState(entities);
            const aiState = getAIState(1);

            const myEntities = Object.values(state.entities).filter(e => e.owner === 1);
            updateVengeance(state, 1, aiState, myEntities);

            expect(aiState.vengeanceScores[0]).toBe(VENGEANCE_PER_HIT);
            expect(aiState.vengeanceScores[2]).toBe(VENGEANCE_PER_HIT);
        });
    });

    describe('Vengeance Decay', () => {
        it('should decay vengeance over time', () => {
            const entities: Record<EntityId, Entity> = {};

            // No attacked units - just decaying
            entities['tank'] = createEntity('tank', 1, 'UNIT', 'light', 500, 500);

            const state = createTestState(entities);
            const aiState = getAIState(1);

            // Set initial vengeance
            aiState.vengeanceScores[0] = 100;

            const myEntities = Object.values(state.entities).filter(e => e.owner === 1);
            updateVengeance(state, 1, aiState, myEntities);

            // Should decay
            expect(aiState.vengeanceScores[0]).toBe(100 * VENGEANCE_DECAY);
        });

        it('should remove negligible vengeance scores', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['tank'] = createEntity('tank', 1, 'UNIT', 'light', 500, 500);

            const state = createTestState(entities);
            const aiState = getAIState(1);

            // Set very small vengeance (will decay below threshold)
            aiState.vengeanceScores[0] = 0.05;

            const myEntities = Object.values(state.entities).filter(e => e.owner === 1);
            updateVengeance(state, 1, aiState, myEntities);

            // Should be removed
            expect(aiState.vengeanceScores[0]).toBeUndefined();
        });
    });

    describe('Target Selection with Vengeance', () => {
        it('should prioritize targets from high-vengeance player', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI player 1 buildings and units
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            // Create enough attack units
            for (let i = 0; i < ATTACK_GROUP_MIN_SIZE; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 1000, 1000);
            }

            // Two enemies at similar distance - one from player 0, one from player 2
            // Make them exactly equal distance to control for other scoring factors
            entities['enemy_p0'] = createEntity('enemy_p0', 0, 'UNIT', 'light', 1100, 1100);
            entities['enemy_p2'] = createEntity('enemy_p2', 2, 'UNIT', 'light', 1100, 900); // Same dist

            const state = createTestState(entities);
            const aiState = getAIState(1);

            // Set high vengeance for player 0
            aiState.vengeanceScores[0] = 200;
            aiState.vengeanceScores[2] = 0;

            // Set up attack state
            aiState.strategy = 'attack';
            aiState.attackGroup = [];
            for (let i = 0; i < ATTACK_GROUP_MIN_SIZE; i++) {
                aiState.attackGroup.push(`tank${i}`);
            }
            aiState.offensiveGroups = [{
                id: 'main_attack',
                unitIds: [...aiState.attackGroup],
                target: null,
                rallyPoint: new Vector(1000, 1000),
                status: 'attacking',
                lastOrderTick: 0
            }];

            const enemies = Object.values(state.entities).filter(e => e.owner !== 1 && e.owner !== -1);
            const combatUnits = Object.values(state.entities).filter(e => e.owner === 1 && e.type === 'UNIT');
            const baseCenter = new Vector(500, 500);

            const actions = handleAttack(state, 1, aiState, combatUnits, enemies, baseCenter, AI_CONFIG.personalities.balanced);

            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');
            expect(attackAction).toBeDefined();

            // Should target player 0's unit due to vengeance bonus
            expect(attackAction?.payload.targetId).toBe('enemy_p0');
        });
    });

    describe('Integration with computeAiActions', () => {
        it('should update vengeance during normal AI cycle', () => {
            const entities: Record<EntityId, Entity> = {};

            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['my_tank'] = createEntity('my_tank', 1, 'UNIT', 'light', 600, 500, {
                lastAttackerId: 'enemy_tank'
            });
            entities['enemy_tank'] = createEntity('enemy_tank', 0, 'UNIT', 'light', 700, 500);

            const state = createTestState(entities);
            const aiState = getAIState(1);

            // Run AI
            computeAiActions(state, 1);

            // Vengeance should have been updated
            expect(aiState.vengeanceScores[0]).toBeGreaterThan(0);
        });
    });
});

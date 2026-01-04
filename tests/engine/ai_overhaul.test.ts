import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { INITIAL_STATE } from '../../src/engine/reducer';
import { GameState, Vector, Entity, EntityId, isActionType, UnitKey, BuildingKey } from '../../src/engine/types';
import {
    createTestHarvester,
    createTestCombatUnit,
    createTestBuilding,
    createTestResource
} from '../../src/engine/test-utils';

const { getAIState, handleEmergencySell, updateEnemyIntelligence, handleMCVOperations } = _testUtils;

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
        finalDest?: Vector | null;
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
            moveTarget: overrides?.moveTarget, finalDest: overrides?.finalDest
        });
    }
}

function createTestState(entities: Record<EntityId, Entity>, tick: number = 601): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        tick, // Default to 601 to be past grace periods and tick % 3 === 1 for player 1 AI
        entities
    };
}

describe('AI Overhaul Tests', () => {
    beforeEach(() => {
        resetAIState();
    });

    // ===== ISSUE #1: BUILD-THEN-SELL LOOP PREVENTION =====
    describe('Issue #1: Building Age Grace Period', () => {
        it('should NOT sell newly placed buildings (within grace period)', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 100, 100, { placedTick: 0, hp: 3000, maxHp: 3000 });
            // Building placed at tick 550 - only 50 ticks old at tick 600
            entities['new_power'] = createEntity('new_power', 1, 'BUILDING', 'power', 200, 100, { placedTick: 550 });

            let state = createTestState(entities, 600);
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 10 } } };

            const aiState = getAIState(1);
            aiState.threatsNearBase = ['enemy'];
            aiState.lastSellTick = 0; // Not on cooldown

            const actions = handleEmergencySell(state, 1, [entities['new_power']], state.players[1], aiState);

            // Should NOT sell - building is too new (50 ticks < 300 grace period)
            expect(actions.length).toBe(0);
        });

        it('should sell mature buildings (past grace period)', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 100, 100, { placedTick: 0, hp: 3000, maxHp: 3000 });
            // Building placed at tick 0 - 600 ticks old at tick 600
            // Use 'tech' instead of 'power' - power is now protected under normal pressure
            entities['old_tech'] = createEntity('old_tech', 1, 'BUILDING', 'tech', 200, 100, { placedTick: 0 });

            let state = createTestState(entities, 600);
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 10 } } };

            const aiState = getAIState(1);
            aiState.threatsNearBase = ['enemy'];
            aiState.lastSellTick = 0; // Not on cooldown

            const actions = handleEmergencySell(state, 1, [entities['old_tech']], state.players[1], aiState);

            // Should sell - building is mature (600 ticks > 300 grace period)
            expect(actions.length).toBe(1);
            expect(actions[0].type).toBe('SELL_BUILDING');
        });
    });

    // ===== ISSUE #2: SELL COOLDOWN =====
    // Use 'tech' instead of 'power' - power is now protected under normal pressure
    describe('Issue #2: Sell Cooldown', () => {
        it('should NOT sell if cooldown is active', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['tech'] = createEntity('tech', 1, 'BUILDING', 'tech', 200, 100, { placedTick: 0 });

            let state = createTestState(entities, 600);
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 10 } } };

            const aiState = getAIState(1);
            aiState.threatsNearBase = ['enemy'];
            aiState.lastSellTick = 550; // Sold 50 ticks ago (< 120 cooldown)

            const actions = handleEmergencySell(state, 1, [entities['tech']], state.players[1], aiState);

            // Should NOT sell - still on cooldown
            expect(actions.length).toBe(0);
        });

        it('should sell when cooldown has expired', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['tech'] = createEntity('tech', 1, 'BUILDING', 'tech', 200, 100, { placedTick: 0 });

            let state = createTestState(entities, 600);
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 10 } } };

            const aiState = getAIState(1);
            aiState.threatsNearBase = ['enemy'];
            aiState.lastSellTick = 400; // Sold 200 ticks ago (> 120 cooldown)

            const actions = handleEmergencySell(state, 1, [entities['tech']], state.players[1], aiState);

            // Should sell - cooldown expired
            expect(actions.length).toBe(1);
        });

        it('should update lastSellTick when selling', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['tech'] = createEntity('tech', 1, 'BUILDING', 'tech', 200, 100, { placedTick: 0 });

            let state = createTestState(entities, 600);
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 10 } } };

            const aiState = getAIState(1);
            aiState.threatsNearBase = ['enemy'];
            aiState.lastSellTick = 0;

            handleEmergencySell(state, 1, [entities['tech']], state.players[1], aiState);

            // lastSellTick should be updated to current tick
            expect(aiState.lastSellTick).toBe(600);
        });
    });

    // ===== ISSUE #3: PROACTIVE USELESS REFINERY SELLING =====
    describe('Issue #3: Proactive Useless Refinery Selling', () => {
        it('should proactively sell useless refinery when AI has multiple refineries', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 100, 100, { placedTick: 0, hp: 3000, maxHp: 3000 });
            // Useful refinery near ore
            entities['ref_useful'] = createEntity('ref_useful', 1, 'BUILDING', 'refinery', 200, 100, { placedTick: 0 });
            entities['ore'] = createEntity('ore', -1, 'RESOURCE', 'ore', 250, 100);
            // Useless refinery far from ore
            entities['ref_useless'] = createEntity('ref_useless', 1, 'BUILDING', 'refinery', 2000, 2000, { placedTick: 0 });

            let state = createTestState(entities, 600);
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 5000 } } };

            const aiState = getAIState(1);
            aiState.lastSellTick = 0;

            const buildings = [entities['conyard'], entities['ref_useful'], entities['ref_useless']];
            const actions = handleEmergencySell(state, 1, buildings, state.players[1], aiState);

            // Should sell the useless refinery
            expect(actions.length).toBe(1);
            const sellAction = actions[0];
            if (isActionType(sellAction, 'SELL_BUILDING')) {
                expect(sellAction.payload.buildingId).toBe('ref_useless');
            }
        });

        it('should NOT sell the only refinery even if useless', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 100, 100, { placedTick: 0 });
            // Only one refinery - far from ore
            entities['ref_only'] = createEntity('ref_only', 1, 'BUILDING', 'refinery', 2000, 2000, { placedTick: 0 });

            let state = createTestState(entities, 600);
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 5000 } } };

            const aiState = getAIState(1);
            aiState.lastSellTick = 0;

            const buildings = [entities['conyard'], entities['ref_only']];
            const actions = handleEmergencySell(state, 1, buildings, state.players[1], aiState);

            // Should NOT sell the only refinery
            expect(actions.length).toBe(0);
        });
    });

    // ===== ISSUE #4: CHASE LEASH DISTANCE =====
    describe('Issue #4: Chase Leash Distance', () => {
        it('should prefer closer targets over distant ones', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500, { hp: 3000, maxHp: 3000 });
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            // Attack group at 1000, 1000
            for (let i = 0; i < 6; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 1000 + i * 10, 1000);
            }

            // Close enemy (200 units away)
            entities['close_enemy'] = createEntity('close_enemy', 0, 'UNIT', 'tank', 1200, 1000);
            // Far enemy (1000+ units away - beyond leash)
            entities['far_enemy'] = createEntity('far_enemy', 0, 'BUILDING', 'conyard', 2500, 2500, { hp: 3000, maxHp: 3000 });

            // Use tick 601 so player 1 runs full AI compute (tick % 3 === 1)
            let state = createTestState(entities, 601);

            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = 0;
            aiState.attackGroup = ['tank0', 'tank1', 'tank2', 'tank3', 'tank4', 'tank5'];
            aiState.offensiveGroups = [{
                id: 'main_attack',
                unitIds: aiState.attackGroup,
                target: null,
                rallyPoint: new Vector(1000, 1000),
                status: 'attacking',
                lastOrderTick: 0
            }];

            const actions = computeAiActions(state, 1);
            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');

            // Should attack the closer enemy, not chase far conyard
            expect(attackAction).toBeDefined();
            expect(attackAction?.payload.targetId).toBe('close_enemy');
        });
    });

    // ===== ISSUE #5: FOCUS FIRE IMPROVEMENTS =====
    describe('Issue #5: Focus Fire', () => {
        it('should prioritize low HP targets', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            for (let i = 0; i < 6; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 1000, 1000);
            }

            // Full HP enemy
            entities['full_hp'] = createEntity('full_hp', 0, 'UNIT', 'tank', 1100, 1100, { hp: 100, maxHp: 100 });
            // Low HP enemy (same distance)
            entities['low_hp'] = createEntity('low_hp', 0, 'UNIT', 'tank', 1100, 1050, { hp: 15, maxHp: 100 });

            // Use tick 601 so player 1 runs full AI compute (tick % 3 === 1)
            let state = createTestState(entities, 601);

            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.attackGroup = ['tank0', 'tank1', 'tank2', 'tank3', 'tank4', 'tank5'];
            aiState.offensiveGroups = [{
                id: 'main_attack',
                unitIds: aiState.attackGroup,
                target: null,
                rallyPoint: new Vector(1000, 1000),
                status: 'attacking',
                lastOrderTick: 0
            }];

            const actions = computeAiActions(state, 1);
            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');

            // Should prioritize the low HP target
            expect(attackAction).toBeDefined();
            expect(attackAction?.payload.targetId).toBe('low_hp');
        });

        it('should focus on targets that allies are already attacking', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            // Some units already targeting enemy1
            entities['tank0'] = createEntity('tank0', 1, 'UNIT', 'light', 1000, 1000, { targetId: 'enemy1' as EntityId });
            entities['tank1'] = createEntity('tank1', 1, 'UNIT', 'light', 1010, 1000, { targetId: 'enemy1' as EntityId });
            entities['tank2'] = createEntity('tank2', 1, 'UNIT', 'light', 1020, 1000, { targetId: 'enemy1' as EntityId });
            // Idle units
            entities['tank3'] = createEntity('tank3', 1, 'UNIT', 'light', 1030, 1000);
            entities['tank4'] = createEntity('tank4', 1, 'UNIT', 'light', 1040, 1000);

            // Two enemies at similar distance
            entities['enemy1'] = createEntity('enemy1', 0, 'UNIT', 'tank', 1100, 1100);
            entities['enemy2'] = createEntity('enemy2', 0, 'UNIT', 'tank', 1100, 900);

            // Use tick 601 so player 1 runs full AI compute (tick % 3 === 1)
            let state = createTestState(entities, 601);

            const aiState = getAIState(1);
            aiState.personality = 'rusher'; // Set consistent personality for test
            aiState.strategy = 'attack';
            aiState.attackGroup = ['tank0', 'tank1', 'tank2', 'tank3', 'tank4'];
            aiState.offensiveGroups = [{
                id: 'main_attack',
                unitIds: aiState.attackGroup,
                target: null,
                rallyPoint: new Vector(1000, 1000),
                status: 'attacking',
                lastOrderTick: 0
            }];

            const actions = computeAiActions(state, 1);
            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');

            // Should focus fire on enemy1 (3 allies already attacking)
            expect(attackAction).toBeDefined();
            expect(attackAction?.payload.targetId).toBe('enemy1');
        });
    });

    // ===== ISSUE #6: HARVESTER MINIMUM SAFE DISTANCE =====
    describe('Issue #6: Harvester Minimum Safe Distance', () => {
        it('should flee from very close threats even under economic pressure', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['ore'] = createEntity('ore', -1, 'RESOURCE', 'ore', 700, 700);
            // Harvester with cargo under economic pressure, but enemy is VERY close (< 80 units)
            entities['harv'] = createEntity('harv', 1, 'UNIT', 'harvester', 700, 700, { cargo: 400 });
            // Enemy only 50 units away - should trigger flee even with economic pressure
            entities['enemy'] = createEntity('enemy', 0, 'UNIT', 'tank', 750, 700);

            let state = createTestState(entities, 600);
            // Very low credits - normally would trigger economic pressure
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 50 } } };

            const actions = computeAiActions(state, 1);
            const fleeAction = actions.find(a =>
                isActionType(a, 'COMMAND_MOVE') &&
                a.payload.unitIds?.includes('harv')
            );

            // Should flee - enemy is within minimum safe distance (80 units)
            expect(fleeAction).toBeDefined();
        });

        it('should NOT flee from moderate threats under economic pressure with cargo', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['ore'] = createEntity('ore', -1, 'RESOURCE', 'ore', 700, 700);
            // Harvester with significant cargo
            entities['harv'] = createEntity('harv', 1, 'UNIT', 'harvester', 700, 700, { cargo: 400 });
            // Enemy 150 units away - beyond minimum safe distance
            entities['enemy'] = createEntity('enemy', 0, 'UNIT', 'tank', 850, 700);

            let state = createTestState(entities, 600);
            // Credits below 100 - triggers economic pressure with cargo
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 50 } } };

            const actions = computeAiActions(state, 1);
            const fleeAction = actions.find(a =>
                isActionType(a, 'COMMAND_MOVE') &&
                a.payload.unitIds?.includes('harv')
            );

            // Should NOT flee - under economic pressure and threat is beyond minimum safe distance
            expect(fleeAction).toBeUndefined();
        });
    });

    // ===== ISSUE #9 & #10: ENEMY INTELLIGENCE TRACKING =====
    describe('Issue #9 & #10: Enemy Intelligence', () => {
        it('should track enemy unit composition', () => {
            const enemies: Entity[] = [
                createEntity('e1', 0, 'UNIT', 'heavy', 1000, 1000),
                createEntity('e2', 0, 'UNIT', 'heavy', 1100, 1000),
                createEntity('e3', 0, 'UNIT', 'heavy', 1200, 1000),
                createEntity('e4', 0, 'UNIT', 'light', 1300, 1000),
            ];

            const aiState = getAIState(1);
            aiState.enemyIntelligence.lastUpdate = 0;

            updateEnemyIntelligence(aiState, enemies, 300);

            expect(aiState.enemyIntelligence.unitCounts['heavy']).toBe(3);
            expect(aiState.enemyIntelligence.unitCounts['light']).toBe(1);
        });

        it('should identify dominant armor type', () => {
            // Heavy-dominant enemy
            const heavyEnemies: Entity[] = [
                createEntity('e1', 0, 'UNIT', 'heavy', 1000, 1000),
                createEntity('e2', 0, 'UNIT', 'heavy', 1100, 1000),
                createEntity('e3', 0, 'UNIT', 'heavy', 1200, 1000),
                createEntity('e4', 0, 'UNIT', 'light', 1300, 1000),
                createEntity('e5', 0, 'UNIT', 'rifle', 1400, 1000),
            ];

            const aiState = getAIState(1);
            aiState.enemyIntelligence.lastUpdate = 0;

            updateEnemyIntelligence(aiState, heavyEnemies, 300);

            // Heavy should dominate (3 out of 5 units)
            expect(aiState.enemyIntelligence.dominantArmor).toBe('heavy');
        });

        it('should respect update cooldown', () => {
            const enemies: Entity[] = [
                createEntity('e1', 0, 'UNIT', 'heavy', 1000, 1000),
            ];

            const aiState = getAIState(1);
            aiState.enemyIntelligence.lastUpdate = 100;

            // Try to update at tick 200 (only 100 ticks since last - less than 300 cooldown)
            updateEnemyIntelligence(aiState, enemies, 200);

            // Should not have updated counts
            expect(aiState.enemyIntelligence.unitCounts['heavy']).toBeUndefined();
        });
    });

    // ===== ISSUE #11: DETERMINISTIC PEACE BREAK =====
    describe('Issue #11: Deterministic Peace Break', () => {
        it('should attack after 20 seconds of peace with surplus', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500, { hp: 3000, maxHp: 3000 });
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            // Minimum army for peace break
            for (let i = 0; i < 4; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 550 + i * 20, 550);
            }

            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 2000, 2000);

            // Use tick 3601 so player 1 runs full AI compute (tick % 3 === 1)
            let state = createTestState(entities, 3601);
            // High credits (surplus)
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 6000 } } };

            const aiState = getAIState(1);
            aiState.personality = 'rusher'; // Set consistent personality for test
            aiState.lastStrategyChange = 0;
            aiState.peaceTicks = 1200; // 20 seconds at peace
            aiState.threatLevel = 0;

            computeAiActions(state, 1);

            // Should force attack after 20 seconds of peace
            expect(aiState.strategy).toBe('attack');
        });
    });

    // ===== ISSUE #12: COMBAT BUILDING PRIORITY =====
    describe('Issue #12: Skip Economic Buildings During Combat', () => {
        it('should skip power/refinery during attack strategy with low funds', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500, { hp: 3000, maxHp: 3000 });
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            for (let i = 0; i < 6; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 550 + i * 20, 550);
            }

            entities['enemy'] = createEntity('enemy', 0, 'BUILDING', 'conyard', 2000, 2000);

            let state = createTestState(entities, 600);
            // Credits below 3000 threshold for skipping economic buildings
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 2000 } } };

            const aiState = getAIState(1);
            aiState.personality = 'rusher'; // Set consistent personality for test
            aiState.strategy = 'attack';
            aiState.attackGroup = ['tank0', 'tank1', 'tank2', 'tank3', 'tank4', 'tank5'];

            const actions = computeAiActions(state, 1);

            // Should NOT build power or refinery during attack with low credits
            const ecoBuilds = actions.filter(a =>
                a.type === 'START_BUILD' &&
                a.payload.category === 'building' &&
                ['power', 'refinery'].includes(a.payload.key)
            );

            expect(ecoBuilds.length).toBe(0);
        });

        it('should still build economic buildings during attack if wealthy', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500, { hp: 3000, maxHp: 3000 });

            entities['enemy'] = createEntity('enemy', 0, 'BUILDING', 'conyard', 2000, 2000);

            // Use tick 601 so player 1 runs full AI compute (tick % 3 === 1)
            let state = createTestState(entities, 601);
            // Very high credits - should still build economy
            state = { ...state, players: { ...state.players, 1: { ...state.players[1], credits: 10000 } } };

            const aiState = getAIState(1);
            aiState.strategy = 'attack';

            const actions = computeAiActions(state, 1);

            // With very high credits, should still try to build power plant
            const powerBuild = actions.find(a =>
                a.type === 'START_BUILD' &&
                a.payload.key === 'power'
            );

            expect(powerBuild).toBeDefined();
        });
    });

    // ===== ISSUE #7: MCV OPERATIONS =====
    describe('Issue #7: MCV Operations', () => {
        it('should move MCV toward uncovered ore', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            // Idle MCV
            entities['mcv'] = createEntity('mcv', 1, 'UNIT', 'mcv', 550, 550);
            // Distant ore patch (beyond build range)
            entities['distant_ore'] = createEntity('distant_ore', -1, 'RESOURCE', 'ore', 1200, 1200);

            const state = createTestState(entities, 600);
            const aiState = getAIState(1);

            const actions = handleMCVOperations(state, 1, aiState, [entities['conyard']], [entities['mcv']]);

            // MCV should receive move command toward distant ore
            const moveAction = actions.find(a =>
                isActionType(a, 'COMMAND_MOVE') &&
                a.payload.unitIds?.includes('mcv')
            );

            expect(moveAction).toBeDefined();
        });

        it('should NOT move MCV if already has a destination', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            // MCV already moving
            entities['mcv'] = createEntity('mcv', 1, 'UNIT', 'mcv', 550, 550, {
                moveTarget: new Vector(1000, 1000),
                finalDest: new Vector(1200, 1200)
            });
            entities['ore'] = createEntity('ore', -1, 'RESOURCE', 'ore', 1200, 1200);

            const state = createTestState(entities, 600);
            const aiState = getAIState(1);

            const actions = handleMCVOperations(state, 1, aiState, [entities['conyard']], [entities['mcv']]);

            // MCV should NOT receive new move command
            const moveAction = actions.find(a =>
                isActionType(a, 'COMMAND_MOVE') &&
                a.payload.unitIds?.includes('mcv')
            );

            expect(moveAction).toBeUndefined();
        });
    });

    // ===== ISSUE #8: DEFENSE PLACEMENT SPACING =====
    describe('Issue #8: Defense Building Spacing', () => {
        it('should NOT place defenses too close together', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500, { hp: 3000, maxHp: 3000 });
            // Existing turret
            entities['turret1'] = createEntity('turret1', 1, 'BUILDING', 'turret', 600, 500);

            let state = createTestState(entities, 600);
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: { ...state.players[1], credits: 5000, readyToPlace: 'turret' }
                }
            };

            const actions = computeAiActions(state, 1);
            const placeAction = actions.find(a => a.type === 'PLACE_BUILDING');

            if (placeAction) {
                const newX = placeAction.payload.x;
                const newY = placeAction.payload.y;
                const existingTurretPos = entities['turret1'].pos;
                const distance = Math.sqrt(
                    (newX - existingTurretPos.x) ** 2 + (newY - existingTurretPos.y) ** 2
                );

                // New turret should be at least 100 units away (strict spacing)
                expect(distance).toBeGreaterThanOrEqual(100);
            }
        });
    });
});

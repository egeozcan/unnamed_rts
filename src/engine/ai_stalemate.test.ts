import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from './ai';
import { INITIAL_STATE, createPlayerState } from './reducer';
import { GameState, Entity, EntityId, UnitKey, BuildingKey } from './types';
import { createTestHarvester, createTestCombatUnit, createTestBuilding, createTestResource } from './test-utils';

const { getAIState } = _testUtils;

// Helper function that delegates to test-utils builders
function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number,
    overrides?: { hp?: number; maxHp?: number }
): Entity {
    if (type === 'UNIT') {
        if (key === 'harvester') {
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
                key: key as Exclude<UnitKey, 'harvester'>,
                x,
                y,
                hp: overrides?.hp,
                maxHp: overrides?.maxHp
            });
        }
    } else if (type === 'BUILDING') {
        return createTestBuilding({
            id,
            owner,
            key: key as BuildingKey,
            x,
            y,
            hp: overrides?.hp,
            maxHp: overrides?.maxHp
        });
    } else {
        // RESOURCE
        return createTestResource({
            id,
            x,
            y,
            hp: overrides?.hp
        });
    }
}

function createTestState(entities: Record<EntityId, Entity>, tick: number, aiCredits: number = 500): GameState {
    const state = { ...INITIAL_STATE };
    state.tick = tick;
    state.entities = entities;
    state.players = {
        0: { ...createPlayerState(0, false, 'medium', '#0088FF'), credits: 1000 },
        1: { ...createPlayerState(1, true, 'hard', '#FFCC00'), credits: aiCredits }
    };
    return state;
}

describe('AI Stalemate Detection and Tiebreaker', () => {
    beforeEach(() => {
        resetAIState();
    });

    describe('Desperation tracking', () => {
        it('should increase desperation when stuck without combat units for a long time', () => {
            // Setup: AI has no combat units, only harvesters, game is late
            const entities: Record<EntityId, Entity> = {
                // AI Base
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'refinery_ai': createEntity('refinery_ai', 1, 'BUILDING', 'refinery', 300, 400, { maxHp: 400, hp: 400 }),
                // AI Harvesters only (no combat units)
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                'harv3': createEntity('harv3', 1, 'UNIT', 'harvester', 440, 400, { maxHp: 150, hp: 150 }),
                // Ore
                'ore1': createEntity('ore1', -1, 'RESOURCE', 'ore', 500, 400, { maxHp: 1000, hp: 1000 }),
                // Enemy base far away
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Game tick is well past the stalemate detection threshold (18000)
            // and past STALEMATE_NO_COMBAT_THRESHOLD (6000)
            const tick = 30000; // 8+ minutes into game
            const state = createTestState(entities, tick, 200);

            // Run AI several times to let it detect stalemate
            for (let i = 0; i < 5; i++) {
                computeAiActions(state, 1);
            }

            const aiState = getAIState(1);
            // Should have non-zero desperation since no combat for a long time
            expect(aiState.stalemateDesperation).toBeGreaterThan(0);
        });

        it('should reset desperation when threats are detected AND we have defenders', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                // We have a combat unit to defend with
                'tank1': createEntity('tank1', 1, 'UNIT', 'heavy', 380, 380, { maxHp: 300, hp: 300 }),
                // Enemy unit near base (threat)
                'enemy_tank': createEntity('enemy_tank', 0, 'UNIT', 'heavy', 350, 350, { maxHp: 300, hp: 300 }),
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            const tick = 30000;
            const state = createTestState(entities, tick, 200);

            // Manually set high desperation
            const aiState = getAIState(1);
            aiState.stalemateDesperation = 80;
            aiState.lastCombatTick = 0;

            // Run AI - should detect threat and reset desperation (since we can defend)
            computeAiActions(state, 1);

            // Desperation should be reset since there's a threat AND we have defenders
            expect(aiState.stalemateDesperation).toBe(0);
            // lastCombatTick should be updated
            expect(aiState.lastCombatTick).toBe(tick);
        });

        it('should INCREASE desperation when under attack with no defenders', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                // NO combat units - only harvesters!
                // Enemy unit near base (threat)
                'enemy_tank': createEntity('enemy_tank', 0, 'UNIT', 'heavy', 350, 350, { maxHp: 300, hp: 300 }),
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            const tick = 30000;
            const state = createTestState(entities, tick, 200);

            // Start with moderate desperation
            const aiState = getAIState(1);
            aiState.stalemateDesperation = 50;
            aiState.lastCombatTick = 0;

            // Run AI - should detect threat but INCREASE desperation (no defenders!)
            computeAiActions(state, 1);

            // Desperation should INCREASE since we're under attack with no army
            expect(aiState.stalemateDesperation).toBeGreaterThan(50);
        });
    });

    describe('Desperate attack behavior', () => {
        it('should switch to all_in strategy when desperation is high', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 300, { maxHp: 400, hp: 400 }),
                // Just 1 combat unit (below normal attack threshold)
                'tank1': createEntity('tank1', 1, 'UNIT', 'heavy', 400, 400, { maxHp: 300, hp: 300 }),
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            const tick = 30000;
            const state = createTestState(entities, tick, 200);

            // Manually set high desperation
            const aiState = getAIState(1);
            aiState.stalemateDesperation = 60;
            aiState.lastCombatTick = tick - 10000; // 10000 ticks since last combat
            aiState.strategy = 'buildup';
            aiState.lastStrategyChange = tick - 1000;

            computeAiActions(state, 1);

            // Should switch to all_in despite having only 1 unit
            expect(aiState.strategy).toBe('all_in');
        });
    });

    describe('Harvester suicide attack', () => {
        it('should send harvesters to attack when extremely desperate and no combat units', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                // Only harvesters, no combat units
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 420, 400, { maxHp: 150, hp: 150 }),
                'harv3': createEntity('harv3', 1, 'UNIT', 'harvester', 440, 400, { maxHp: 150, hp: 150 }),
                // Enemy building
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Tick past the desperate attack threshold (36000 = 10 minutes)
            // NOTE: Must be a multiple of 30 since AI only runs every 30 ticks
            const tick = 39990;
            const state = createTestState(entities, tick, 200);

            // Set up extreme desperation
            const aiState = getAIState(1);
            aiState.stalemateDesperation = 90;
            aiState.lastCombatTick = 0;
            aiState.strategy = 'all_in';
            aiState.lastStrategyChange = tick - 1000;

            const actions = computeAiActions(state, 1);

            // Check AI state after computation
            const finalAiState = getAIState(1);

            // Should be in all_in strategy
            expect(finalAiState.strategy).toBe('all_in');

            // Should have COMMAND_ATTACK action for harvesters targeting enemy
            const attackActions = actions.filter(a => a.type === 'COMMAND_ATTACK');

            // At least one attack action should be issued for harvesters
            expect(attackActions.length).toBeGreaterThan(0);

            // Check that harvesters are in the action targeting enemy conyard
            const harvAttackAction = attackActions.find(a =>
                a.payload.unitIds &&
                (a.payload.unitIds.includes('harv1') ||
                    a.payload.unitIds.includes('harv2') ||
                    a.payload.unitIds.includes('harv3')) &&
                a.payload.targetId === 'enemy_conyard'
            );
            expect(harvAttackAction).toBeDefined();
        });

        it('should NOT send harvesters to attack if there are combat units', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'factory_ai': createEntity('factory_ai', 1, 'BUILDING', 'factory', 350, 300, { maxHp: 400, hp: 400 }),
                // Has combat units
                'tank1': createEntity('tank1', 1, 'UNIT', 'heavy', 400, 400, { maxHp: 300, hp: 300 }),
                // And harvesters
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 450, 400, { maxHp: 150, hp: 150 }),
                'harv2': createEntity('harv2', 1, 'UNIT', 'harvester', 470, 400, { maxHp: 150, hp: 150 }),
                'harv3': createEntity('harv3', 1, 'UNIT', 'harvester', 490, 400, { maxHp: 150, hp: 150 }),
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // NOTE: Must be a multiple of 30 since AI only runs every 30 ticks
            const tick = 39990;
            const state = createTestState(entities, tick, 200);

            const aiState = getAIState(1);
            aiState.stalemateDesperation = 90;
            aiState.lastCombatTick = 0;
            aiState.strategy = 'all_in';

            const actions = computeAiActions(state, 1);

            // Should NOT have harvester attack action (use combat units instead)
            const attackActions = actions.filter(a => a.type === 'COMMAND_ATTACK');
            const harvInAttack = attackActions.some(a =>
                a.payload.unitIds &&
                (a.payload.unitIds.includes('harv1') ||
                    a.payload.unitIds.includes('harv2') ||
                    a.payload.unitIds.includes('harv3'))
            );
            expect(harvInAttack).toBe(false);
        });
    });

    describe('Stalemate constants', () => {
        it('should only start stalemate detection after STALEMATE_DETECTION_TICK', () => {
            const entities: Record<EntityId, Entity> = {
                'conyard_ai': createEntity('conyard_ai', 1, 'BUILDING', 'conyard', 300, 300, { maxHp: 500, hp: 500 }),
                'harv1': createEntity('harv1', 1, 'UNIT', 'harvester', 400, 400, { maxHp: 150, hp: 150 }),
                'enemy_conyard': createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 2000, 2000, { maxHp: 500, hp: 500 }),
            };

            // Early game - before stalemate detection kicks in
            // NOTE: Must be a multiple of 30 since AI only runs every 30 ticks
            const earlyTick = 5010; // About 1.5 minutes
            const state = createTestState(entities, earlyTick, 200);

            const aiState = getAIState(1);
            aiState.lastCombatTick = 0; // No combat ever

            computeAiActions(state, 1);

            // Should NOT have built up desperation in early game
            expect(aiState.stalemateDesperation).toBe(0);
        });
    });
});

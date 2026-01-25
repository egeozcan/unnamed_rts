import { describe, it, expect, beforeEach } from 'vitest';
import { parseTrigger, evaluateTrigger, Trigger, TriggerOperator } from '../../../src/scripts/debug/triggers.js';
import { GameState, Vector, Entity } from '../../../src/engine/types.js';
import { resetAIState, getAIState } from '../../../src/engine/ai/state.js';
import {
    createTestCombatUnit,
    createTestBuilding,
    createTestHarvester
} from '../../../src/engine/test-utils.js';

// ============================================================================
// Test State Helper
// ============================================================================

function createTestState(overrides: Partial<GameState> = {}): GameState {
    return {
        running: true,
        mode: 'game',
        sellMode: false,
        repairMode: false,
        difficulty: 'easy',
        tick: 1000,
        camera: { x: 0, y: 0 },
        zoom: 1,
        entities: {},
        projectiles: [],
        particles: [],
        selection: [],
        placingBuilding: null,
        players: {},
        winner: null,
        config: {
            width: 3000,
            height: 3000,
            resourceDensity: 'medium',
            rockDensity: 'medium'
        },
        debugMode: false,
        showMinimap: true,
        showBirdsEye: false,
        attackMoveMode: false,
        ...overrides
    };
}

function createTestPlayer(id: number, credits: number = 5000) {
    return {
        id,
        isAi: id !== 0,
        difficulty: 'medium' as const,
        color: '#ff0000',
        credits,
        maxPower: 100,
        usedPower: 50,
        queues: {
            building: { current: null, progress: 0, invested: 0 },
            infantry: { current: null, progress: 0, invested: 0 },
            vehicle: { current: null, progress: 0, invested: 0 },
            air: { current: null, progress: 0, invested: 0 }
        },
        readyToPlace: null
    };
}

// ============================================================================
// Tests
// ============================================================================

describe('parseTrigger', () => {
    describe('dead trigger', () => {
        it('parses "dead <id>" format', () => {
            const trigger = parseTrigger('dead e_1234');
            expect(trigger).toEqual({ type: 'dead', entityId: 'e_1234' });
        });

        it('parses dead trigger with complex entity IDs', () => {
            const trigger = parseTrigger('dead unit_test_123');
            expect(trigger).toEqual({ type: 'dead', entityId: 'unit_test_123' });
        });
    });

    describe('hp trigger', () => {
        it('parses "hp <id> < <percent>%" format', () => {
            const trigger = parseTrigger('hp e_1234 < 50%');
            expect(trigger).toEqual({
                type: 'hp',
                entityId: 'e_1234',
                operator: '<',
                value: 50
            });
        });

        it('parses hp trigger with different operators', () => {
            expect(parseTrigger('hp e_1 > 25%')).toEqual({
                type: 'hp', entityId: 'e_1', operator: '>', value: 25
            });
            expect(parseTrigger('hp e_1 <= 75%')).toEqual({
                type: 'hp', entityId: 'e_1', operator: '<=', value: 75
            });
            expect(parseTrigger('hp e_1 >= 10%')).toEqual({
                type: 'hp', entityId: 'e_1', operator: '>=', value: 10
            });
            expect(parseTrigger('hp e_1 == 100%')).toEqual({
                type: 'hp', entityId: 'e_1', operator: '==', value: 100
            });
        });
    });

    describe('tick trigger', () => {
        it('parses "tick > <n>" format', () => {
            const trigger = parseTrigger('tick > 5000');
            expect(trigger).toEqual({
                type: 'tick',
                operator: '>',
                value: 5000
            });
        });

        it('parses tick trigger with different operators', () => {
            expect(parseTrigger('tick < 1000')).toEqual({
                type: 'tick', operator: '<', value: 1000
            });
            expect(parseTrigger('tick >= 2500')).toEqual({
                type: 'tick', operator: '>=', value: 2500
            });
            expect(parseTrigger('tick == 3000')).toEqual({
                type: 'tick', operator: '==', value: 3000
            });
        });
    });

    describe('credits trigger', () => {
        it('parses "credits <player> < <amount>" format', () => {
            const trigger = parseTrigger('credits 1 < 500');
            expect(trigger).toEqual({
                type: 'credits',
                playerId: 1,
                operator: '<',
                value: 500
            });
        });

        it('parses credits trigger with different operators', () => {
            expect(parseTrigger('credits 0 > 10000')).toEqual({
                type: 'credits', playerId: 0, operator: '>', value: 10000
            });
            expect(parseTrigger('credits 2 >= 1500')).toEqual({
                type: 'credits', playerId: 2, operator: '>=', value: 1500
            });
        });
    });

    describe('strategy trigger', () => {
        it('parses "strategy <player> == <strategy>" format', () => {
            const trigger = parseTrigger('strategy 1 == attack');
            expect(trigger).toEqual({
                type: 'strategy',
                playerId: 1,
                operator: '==',
                value: 'attack'
            });
        });

        it('parses strategy trigger with different strategies', () => {
            expect(parseTrigger('strategy 2 == buildup')).toEqual({
                type: 'strategy', playerId: 2, operator: '==', value: 'buildup'
            });
            expect(parseTrigger('strategy 0 == defend')).toEqual({
                type: 'strategy', playerId: 0, operator: '==', value: 'defend'
            });
            expect(parseTrigger('strategy 1 == all_in')).toEqual({
                type: 'strategy', playerId: 1, operator: '==', value: 'all_in'
            });
        });
    });

    describe('count trigger', () => {
        it('parses "count <player> <type> >= <n>" format', () => {
            const trigger = parseTrigger('count 1 UNIT >= 5');
            expect(trigger).toEqual({
                type: 'count',
                playerId: 1,
                entityType: 'UNIT',
                operator: '>=',
                value: 5
            });
        });

        it('parses count trigger for specific entity keys', () => {
            expect(parseTrigger('count 0 harvester >= 3')).toEqual({
                type: 'count', playerId: 0, entityType: 'harvester', operator: '>=', value: 3
            });
            expect(parseTrigger('count 1 refinery == 2')).toEqual({
                type: 'count', playerId: 1, entityType: 'refinery', operator: '==', value: 2
            });
        });

        it('parses count trigger for BUILDING type', () => {
            const trigger = parseTrigger('count 1 BUILDING > 10');
            expect(trigger).toEqual({
                type: 'count',
                playerId: 1,
                entityType: 'BUILDING',
                operator: '>',
                value: 10
            });
        });
    });

    describe('player-dead trigger', () => {
        it('parses "player <id> dead" format', () => {
            const trigger = parseTrigger('player 1 dead');
            expect(trigger).toEqual({
                type: 'player-dead',
                playerId: 1
            });
        });

        it('parses player-dead trigger for different player IDs', () => {
            expect(parseTrigger('player 0 dead')).toEqual({
                type: 'player-dead', playerId: 0
            });
            expect(parseTrigger('player 7 dead')).toEqual({
                type: 'player-dead', playerId: 7
            });
        });
    });

    describe('threat trigger', () => {
        it('parses "threat <player> > <level>" format', () => {
            const trigger = parseTrigger('threat 1 > 50');
            expect(trigger).toEqual({
                type: 'threat',
                playerId: 1,
                operator: '>',
                value: 50
            });
        });

        it('parses threat trigger with different operators', () => {
            expect(parseTrigger('threat 0 >= 75')).toEqual({
                type: 'threat', playerId: 0, operator: '>=', value: 75
            });
            expect(parseTrigger('threat 2 < 25')).toEqual({
                type: 'threat', playerId: 2, operator: '<', value: 25
            });
        });
    });

    describe('area trigger', () => {
        it('parses "area <x>,<y>,<radius> has <id>" format', () => {
            const trigger = parseTrigger('area 100,200,50 has e_1234');
            expect(trigger).toEqual({
                type: 'area',
                x: 100,
                y: 200,
                radius: 50,
                entityId: 'e_1234'
            });
        });

        it('parses area trigger with different coordinates', () => {
            const trigger = parseTrigger('area 500,600,100 has unit_test_1');
            expect(trigger).toEqual({
                type: 'area',
                x: 500,
                y: 600,
                radius: 100,
                entityId: 'unit_test_1'
            });
        });
    });

    describe('OR conditions', () => {
        it('parses "a or b" format', () => {
            const trigger = parseTrigger('dead e_1234 or tick > 5000');
            expect(trigger).toEqual({
                type: 'or',
                conditions: [
                    { type: 'dead', entityId: 'e_1234' },
                    { type: 'tick', operator: '>', value: 5000 }
                ]
            });
        });

        it('parses multiple OR conditions', () => {
            const trigger = parseTrigger('dead e_1 or dead e_2 or tick > 1000');
            expect(trigger).toEqual({
                type: 'or',
                conditions: [
                    { type: 'dead', entityId: 'e_1' },
                    { type: 'dead', entityId: 'e_2' },
                    { type: 'tick', operator: '>', value: 1000 }
                ]
            });
        });

        it('parses OR with mixed trigger types', () => {
            const trigger = parseTrigger('hp e_1 < 25% or credits 1 < 100');
            expect(trigger).toEqual({
                type: 'or',
                conditions: [
                    { type: 'hp', entityId: 'e_1', operator: '<', value: 25 },
                    { type: 'credits', playerId: 1, operator: '<', value: 100 }
                ]
            });
        });
    });

    describe('error handling', () => {
        it('throws on invalid trigger format', () => {
            expect(() => parseTrigger('invalid input')).toThrow();
        });

        it('throws on empty string', () => {
            expect(() => parseTrigger('')).toThrow();
        });

        it('throws on unknown trigger type', () => {
            expect(() => parseTrigger('unknown e_1234')).toThrow();
        });
    });
});

describe('evaluateTrigger', () => {
    beforeEach(() => {
        resetAIState();
    });

    describe('dead trigger', () => {
        it('returns true when entity does not exist', () => {
            const state = createTestState({ entities: {} });
            const trigger: Trigger = { type: 'dead', entityId: 'e_nonexistent' };

            expect(evaluateTrigger(trigger, state)).toBe(true);
        });

        it('returns true when entity.dead is true', () => {
            const unit = createTestCombatUnit({ id: 'e_1', dead: true });
            const state = createTestState({ entities: { 'e_1': unit } });
            const trigger: Trigger = { type: 'dead', entityId: 'e_1' };

            expect(evaluateTrigger(trigger, state)).toBe(true);
        });

        it('returns false when entity exists and is alive', () => {
            const unit = createTestCombatUnit({ id: 'e_1', dead: false });
            const state = createTestState({ entities: { 'e_1': unit } });
            const trigger: Trigger = { type: 'dead', entityId: 'e_1' };

            expect(evaluateTrigger(trigger, state)).toBe(false);
        });
    });

    describe('hp trigger', () => {
        it('evaluates < operator correctly', () => {
            const unit = createTestCombatUnit({ id: 'e_1', hp: 40, maxHp: 100 });
            const state = createTestState({ entities: { 'e_1': unit } });

            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '<', value: 50 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '<', value: 40 }, state)).toBe(false);
            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '<', value: 30 }, state)).toBe(false);
        });

        it('evaluates > operator correctly', () => {
            const unit = createTestCombatUnit({ id: 'e_1', hp: 60, maxHp: 100 });
            const state = createTestState({ entities: { 'e_1': unit } });

            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '>', value: 50 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '>', value: 60 }, state)).toBe(false);
        });

        it('evaluates <= operator correctly', () => {
            const unit = createTestCombatUnit({ id: 'e_1', hp: 50, maxHp: 100 });
            const state = createTestState({ entities: { 'e_1': unit } });

            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '<=', value: 50 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '<=', value: 49 }, state)).toBe(false);
        });

        it('evaluates >= operator correctly', () => {
            const unit = createTestCombatUnit({ id: 'e_1', hp: 75, maxHp: 100 });
            const state = createTestState({ entities: { 'e_1': unit } });

            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '>=', value: 75 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '>=', value: 76 }, state)).toBe(false);
        });

        it('evaluates == operator correctly', () => {
            const unit = createTestCombatUnit({ id: 'e_1', hp: 100, maxHp: 100 });
            const state = createTestState({ entities: { 'e_1': unit } });

            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '==', value: 100 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'hp', entityId: 'e_1', operator: '==', value: 99 }, state)).toBe(false);
        });

        it('returns false when entity does not exist', () => {
            const state = createTestState({ entities: {} });
            const trigger: Trigger = { type: 'hp', entityId: 'e_nonexistent', operator: '<', value: 50 };

            expect(evaluateTrigger(trigger, state)).toBe(false);
        });
    });

    describe('tick trigger', () => {
        it('evaluates > operator correctly', () => {
            const state = createTestState({ tick: 5000 });

            expect(evaluateTrigger({ type: 'tick', operator: '>', value: 4000 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'tick', operator: '>', value: 5000 }, state)).toBe(false);
        });

        it('evaluates < operator correctly', () => {
            const state = createTestState({ tick: 3000 });

            expect(evaluateTrigger({ type: 'tick', operator: '<', value: 4000 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'tick', operator: '<', value: 3000 }, state)).toBe(false);
        });

        it('evaluates == operator correctly', () => {
            const state = createTestState({ tick: 2500 });

            expect(evaluateTrigger({ type: 'tick', operator: '==', value: 2500 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'tick', operator: '==', value: 2501 }, state)).toBe(false);
        });
    });

    describe('credits trigger', () => {
        it('evaluates < operator correctly', () => {
            const state = createTestState({
                players: { 1: createTestPlayer(1, 400) }
            });

            expect(evaluateTrigger({ type: 'credits', playerId: 1, operator: '<', value: 500 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'credits', playerId: 1, operator: '<', value: 400 }, state)).toBe(false);
        });

        it('evaluates > operator correctly', () => {
            const state = createTestState({
                players: { 1: createTestPlayer(1, 10000) }
            });

            expect(evaluateTrigger({ type: 'credits', playerId: 1, operator: '>', value: 5000 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'credits', playerId: 1, operator: '>', value: 10000 }, state)).toBe(false);
        });

        it('returns false when player does not exist', () => {
            const state = createTestState({ players: {} });
            const trigger: Trigger = { type: 'credits', playerId: 99, operator: '<', value: 500 };

            expect(evaluateTrigger(trigger, state)).toBe(false);
        });
    });

    describe('strategy trigger', () => {
        it('returns true when AI strategy matches', () => {
            const state = createTestState({
                players: { 1: createTestPlayer(1) }
            });

            // Set up AI state with strategy
            const aiState = getAIState(1);
            aiState.strategy = 'attack';

            const trigger: Trigger = { type: 'strategy', playerId: 1, operator: '==', value: 'attack' };
            expect(evaluateTrigger(trigger, state)).toBe(true);
        });

        it('returns false when AI strategy does not match', () => {
            const state = createTestState({
                players: { 1: createTestPlayer(1) }
            });

            const aiState = getAIState(1);
            aiState.strategy = 'buildup';

            const trigger: Trigger = { type: 'strategy', playerId: 1, operator: '==', value: 'attack' };
            expect(evaluateTrigger(trigger, state)).toBe(false);
        });

        it('works with different strategy values', () => {
            const state = createTestState({
                players: { 2: createTestPlayer(2) }
            });

            const aiState = getAIState(2);
            aiState.strategy = 'all_in';

            expect(evaluateTrigger({ type: 'strategy', playerId: 2, operator: '==', value: 'all_in' }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'strategy', playerId: 2, operator: '==', value: 'defend' }, state)).toBe(false);
        });
    });

    describe('count trigger', () => {
        it('counts entities by type (UNIT)', () => {
            const unit1 = createTestCombatUnit({ id: 'u1', owner: 1 });
            const unit2 = createTestCombatUnit({ id: 'u2', owner: 1 });
            const unit3 = createTestCombatUnit({ id: 'u3', owner: 1 });
            const building = createTestBuilding({ id: 'b1', owner: 1 });
            const state = createTestState({
                entities: { 'u1': unit1, 'u2': unit2, 'u3': unit3, 'b1': building }
            });

            expect(evaluateTrigger({ type: 'count', playerId: 1, entityType: 'UNIT', operator: '>=', value: 3 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'count', playerId: 1, entityType: 'UNIT', operator: '>=', value: 4 }, state)).toBe(false);
        });

        it('counts entities by type (BUILDING)', () => {
            const building1 = createTestBuilding({ id: 'b1', owner: 1 });
            const building2 = createTestBuilding({ id: 'b2', owner: 1 });
            const unit = createTestCombatUnit({ id: 'u1', owner: 1 });
            const state = createTestState({
                entities: { 'b1': building1, 'b2': building2, 'u1': unit }
            });

            expect(evaluateTrigger({ type: 'count', playerId: 1, entityType: 'BUILDING', operator: '==', value: 2 }, state)).toBe(true);
        });

        it('counts entities by key (harvester)', () => {
            const harv1 = createTestHarvester({ id: 'h1', owner: 0 });
            const harv2 = createTestHarvester({ id: 'h2', owner: 0 });
            const tank = createTestCombatUnit({ id: 't1', owner: 0, key: 'heavy' });
            const state = createTestState({
                entities: { 'h1': harv1, 'h2': harv2, 't1': tank }
            });

            expect(evaluateTrigger({ type: 'count', playerId: 0, entityType: 'harvester', operator: '>=', value: 2 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'count', playerId: 0, entityType: 'harvester', operator: '>=', value: 3 }, state)).toBe(false);
        });

        it('counts entities by key (refinery)', () => {
            const ref1 = createTestBuilding({ id: 'r1', owner: 1, key: 'refinery' });
            const ref2 = createTestBuilding({ id: 'r2', owner: 1, key: 'refinery' });
            const factory = createTestBuilding({ id: 'f1', owner: 1, key: 'factory' });
            const state = createTestState({
                entities: { 'r1': ref1, 'r2': ref2, 'f1': factory }
            });

            expect(evaluateTrigger({ type: 'count', playerId: 1, entityType: 'refinery', operator: '==', value: 2 }, state)).toBe(true);
        });

        it('only counts non-dead entities', () => {
            const unit1 = createTestCombatUnit({ id: 'u1', owner: 1, dead: false });
            const unit2 = createTestCombatUnit({ id: 'u2', owner: 1, dead: true });
            const unit3 = createTestCombatUnit({ id: 'u3', owner: 1, dead: false });
            const state = createTestState({
                entities: { 'u1': unit1, 'u2': unit2, 'u3': unit3 }
            });

            expect(evaluateTrigger({ type: 'count', playerId: 1, entityType: 'UNIT', operator: '==', value: 2 }, state)).toBe(true);
        });

        it('only counts entities for specified player', () => {
            const unit1 = createTestCombatUnit({ id: 'u1', owner: 1 });
            const unit2 = createTestCombatUnit({ id: 'u2', owner: 2 });
            const state = createTestState({
                entities: { 'u1': unit1, 'u2': unit2 }
            });

            expect(evaluateTrigger({ type: 'count', playerId: 1, entityType: 'UNIT', operator: '==', value: 1 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'count', playerId: 2, entityType: 'UNIT', operator: '==', value: 1 }, state)).toBe(true);
        });
    });

    describe('player-dead trigger', () => {
        it('returns true when player has no buildings or units', () => {
            const state = createTestState({ entities: {} });
            const trigger: Trigger = { type: 'player-dead', playerId: 1 };

            expect(evaluateTrigger(trigger, state)).toBe(true);
        });

        it('returns false when player has at least one building', () => {
            const building = createTestBuilding({ id: 'b1', owner: 1, dead: false });
            const state = createTestState({ entities: { 'b1': building } });
            const trigger: Trigger = { type: 'player-dead', playerId: 1 };

            expect(evaluateTrigger(trigger, state)).toBe(false);
        });

        it('returns false when player has at least one unit', () => {
            const unit = createTestCombatUnit({ id: 'u1', owner: 1, dead: false });
            const state = createTestState({ entities: { 'u1': unit } });
            const trigger: Trigger = { type: 'player-dead', playerId: 1 };

            expect(evaluateTrigger(trigger, state)).toBe(false);
        });

        it('returns true when all player entities are dead', () => {
            const building = createTestBuilding({ id: 'b1', owner: 1, dead: true });
            const unit = createTestCombatUnit({ id: 'u1', owner: 1, dead: true });
            const state = createTestState({ entities: { 'b1': building, 'u1': unit } });
            const trigger: Trigger = { type: 'player-dead', playerId: 1 };

            expect(evaluateTrigger(trigger, state)).toBe(true);
        });

        it('ignores entities owned by other players', () => {
            const building = createTestBuilding({ id: 'b1', owner: 2, dead: false });
            const state = createTestState({ entities: { 'b1': building } });
            const trigger: Trigger = { type: 'player-dead', playerId: 1 };

            expect(evaluateTrigger(trigger, state)).toBe(true);
        });
    });

    describe('threat trigger', () => {
        it('evaluates > operator correctly', () => {
            const state = createTestState({
                players: { 1: createTestPlayer(1) }
            });

            const aiState = getAIState(1);
            aiState.threatLevel = 60;

            expect(evaluateTrigger({ type: 'threat', playerId: 1, operator: '>', value: 50 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'threat', playerId: 1, operator: '>', value: 60 }, state)).toBe(false);
        });

        it('evaluates >= operator correctly', () => {
            const state = createTestState({
                players: { 1: createTestPlayer(1) }
            });

            const aiState = getAIState(1);
            aiState.threatLevel = 75;

            expect(evaluateTrigger({ type: 'threat', playerId: 1, operator: '>=', value: 75 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'threat', playerId: 1, operator: '>=', value: 76 }, state)).toBe(false);
        });

        it('evaluates < operator correctly', () => {
            const state = createTestState({
                players: { 1: createTestPlayer(1) }
            });

            const aiState = getAIState(1);
            aiState.threatLevel = 20;

            expect(evaluateTrigger({ type: 'threat', playerId: 1, operator: '<', value: 25 }, state)).toBe(true);
            expect(evaluateTrigger({ type: 'threat', playerId: 1, operator: '<', value: 20 }, state)).toBe(false);
        });
    });

    describe('area trigger', () => {
        it('returns true when entity is within radius', () => {
            const unit = createTestCombatUnit({ id: 'u1', x: 110, y: 200 });
            const state = createTestState({ entities: { 'u1': unit } });
            const trigger: Trigger = { type: 'area', x: 100, y: 200, radius: 50, entityId: 'u1' };

            expect(evaluateTrigger(trigger, state)).toBe(true);
        });

        it('returns false when entity is outside radius', () => {
            const unit = createTestCombatUnit({ id: 'u1', x: 200, y: 200 });
            const state = createTestState({ entities: { 'u1': unit } });
            const trigger: Trigger = { type: 'area', x: 100, y: 200, radius: 50, entityId: 'u1' };

            expect(evaluateTrigger(trigger, state)).toBe(false);
        });

        it('returns false when entity does not exist', () => {
            const state = createTestState({ entities: {} });
            const trigger: Trigger = { type: 'area', x: 100, y: 200, radius: 50, entityId: 'u_nonexistent' };

            expect(evaluateTrigger(trigger, state)).toBe(false);
        });

        it('calculates Euclidean distance correctly', () => {
            // Entity at (130, 240), center at (100, 200)
            // Distance = sqrt((130-100)^2 + (240-200)^2) = sqrt(900 + 1600) = sqrt(2500) = 50
            const unit = createTestCombatUnit({ id: 'u1', x: 130, y: 240 });
            const state = createTestState({ entities: { 'u1': unit } });

            // Exactly at radius boundary (50) - should be included (<=)
            expect(evaluateTrigger({ type: 'area', x: 100, y: 200, radius: 50, entityId: 'u1' }, state)).toBe(true);
            // Just outside radius
            expect(evaluateTrigger({ type: 'area', x: 100, y: 200, radius: 49, entityId: 'u1' }, state)).toBe(false);
        });
    });

    describe('OR trigger', () => {
        it('returns true when first condition is true', () => {
            const state = createTestState({ tick: 6000, entities: {} });
            const trigger: Trigger = {
                type: 'or',
                conditions: [
                    { type: 'tick', operator: '>', value: 5000 },
                    { type: 'dead', entityId: 'e_nonexistent' }
                ]
            };

            expect(evaluateTrigger(trigger, state)).toBe(true);
        });

        it('returns true when second condition is true', () => {
            const state = createTestState({ tick: 4000, entities: {} });
            const trigger: Trigger = {
                type: 'or',
                conditions: [
                    { type: 'tick', operator: '>', value: 5000 },
                    { type: 'dead', entityId: 'e_nonexistent' }
                ]
            };

            expect(evaluateTrigger(trigger, state)).toBe(true);
        });

        it('returns false when no conditions are true', () => {
            const unit = createTestCombatUnit({ id: 'e_1', dead: false });
            const state = createTestState({
                tick: 4000,
                entities: { 'e_1': unit }
            });
            const trigger: Trigger = {
                type: 'or',
                conditions: [
                    { type: 'tick', operator: '>', value: 5000 },
                    { type: 'dead', entityId: 'e_1' }
                ]
            };

            expect(evaluateTrigger(trigger, state)).toBe(false);
        });

        it('returns true when any of multiple conditions is true', () => {
            const state = createTestState({
                tick: 4000,
                players: { 1: createTestPlayer(1, 50) }
            });
            const trigger: Trigger = {
                type: 'or',
                conditions: [
                    { type: 'tick', operator: '>', value: 5000 },
                    { type: 'dead', entityId: 'e_1' },
                    { type: 'credits', playerId: 1, operator: '<', value: 100 }
                ]
            };

            expect(evaluateTrigger(trigger, state)).toBe(true);
        });

        it('handles empty conditions array', () => {
            const state = createTestState();
            const trigger: Trigger = {
                type: 'or',
                conditions: []
            };

            expect(evaluateTrigger(trigger, state)).toBe(false);
        });
    });
});

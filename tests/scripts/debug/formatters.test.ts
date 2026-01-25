import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    formatStatus,
    formatUnit,
    formatFind,
    formatGroups,
    formatEvent,
    formatEvents
} from '../../../src/scripts/debug/formatters.js';
import { GameState, Vector } from '../../../src/engine/types.js';
import { INITIAL_STATE, createPlayerState } from '../../../src/engine/reducer.js';
import {
    createTestCombatUnit,
    createTestHarvester,
    createTestBuilding,
    createTestResource,
    resetTestEntityCounter
} from '../../../src/engine/test-utils.js';
import { getAIState, resetAIState, setPersonalityForPlayer } from '../../../src/engine/ai/state.js';
import type {
    DebugEvent,
    CommandEvent,
    DecisionEvent,
    StateChangeEvent,
    GroupEvent,
    EconomyEvent,
    ProductionEvent,
    ThreatEvent
} from '../../../src/engine/debug/schemas.js';

describe('formatStatus', () => {
    let state: GameState;

    beforeEach(() => {
        resetTestEntityCounter();
        resetAIState();
        state = {
            ...INITIAL_STATE,
            tick: 1000,
            running: true,
            players: {
                0: createPlayerState(0, false, 'medium', '#0088FF'),
                1: createPlayerState(1, true, 'hard', '#FF4444')
            },
            entities: {}
        };
    });

    afterEach(() => {
        resetAIState();
    });

    it('displays player info for human player', () => {
        const output = formatStatus(state, 0);

        expect(output).toContain('Player 0');
        expect(output).toContain('Human');
        expect(output).toMatch(/Credits:\s*3000/);
    });

    it('displays player info for AI player', () => {
        const output = formatStatus(state, 1);

        expect(output).toContain('Player 1');
        expect(output).toContain('AI');
        expect(output).toContain('hard');
    });

    it('displays AI strategy information', () => {
        const aiState = getAIState(1);
        aiState.strategy = 'attack';
        aiState.lastStrategyChange = 500;

        const output = formatStatus(state, 1);

        expect(output).toContain('Strategy: attack');
        expect(output).toContain('500'); // lastStrategyChange
    });

    it('displays power information', () => {
        // Add power plant
        state = {
            ...state,
            players: {
                ...state.players,
                1: { ...state.players[1], maxPower: 200, usedPower: 50 }
            }
        };

        const output = formatStatus(state, 1);

        expect(output).toMatch(/Power:\s*50\s*\/\s*200/);
    });

    it('displays threat and economy scores', () => {
        const aiState = getAIState(1);
        aiState.threatLevel = 45;
        aiState.economyScore = 78;
        aiState.stalemateDesperation = 25;
        aiState.isDoomed = false;
        aiState.investmentPriority = 'warfare';

        const output = formatStatus(state, 1);

        expect(output).toContain('Threat: 45');
        expect(output).toContain('Economy: 78');
        expect(output).toContain('Desperation: 25');
        expect(output).toContain('Doomed: false');
        expect(output).toContain('Investment: warfare');
    });

    it('displays entity counts', () => {
        const unit1 = createTestCombatUnit({ owner: 1, key: 'rifle' });
        const unit2 = createTestCombatUnit({ owner: 1, key: 'heavy' });
        const harvester = createTestHarvester({ owner: 1 });
        const building = createTestBuilding({ owner: 1, key: 'conyard' });

        state = {
            ...state,
            entities: {
                [unit1.id]: unit1,
                [unit2.id]: unit2,
                [harvester.id]: harvester,
                [building.id]: building
            }
        };

        const output = formatStatus(state, 1);

        expect(output).toContain('Units: 3');
        expect(output).toContain('Buildings: 1');
        expect(output).toContain('Harvesters: 1');
    });

    it('displays offensive groups', () => {
        const aiState = getAIState(1);
        aiState.offensiveGroups = [
            {
                id: 'group-1',
                unitIds: ['u1', 'u2', 'u3'],
                target: null,
                rallyPoint: null,
                status: 'rallying',
                lastOrderTick: 900,
                lastHealthCheck: 900,
                avgHealthPercent: 85,
                moveTarget: null,
                lastRegroupTick: 0,
                engagedEnemies: [],
                preEngageTarget: null,
                needsReinforcements: false,
                reinforcementIds: []
            },
            {
                id: 'group-2',
                unitIds: ['u4', 'u5'],
                target: 'enemy-base',
                rallyPoint: null,
                status: 'attacking',
                lastOrderTick: 800,
                lastHealthCheck: 800,
                avgHealthPercent: 45,
                moveTarget: null,
                lastRegroupTick: 0,
                engagedEnemies: [],
                preEngageTarget: null,
                needsReinforcements: true,
                reinforcementIds: []
            }
        ];

        const output = formatStatus(state, 1);

        expect(output).toContain('group-1');
        expect(output).toContain('3 units');
        expect(output).toContain('rallying');
        expect(output).toContain('group-2');
        expect(output).toContain('2 units');
        expect(output).toContain('attacking');
    });

    it('displays vengeance scores above threshold', () => {
        const aiState = getAIState(1);
        aiState.vengeanceScores = { 0: 5.5, 2: 0.5 }; // 0.5 should be hidden (< 1)

        const output = formatStatus(state, 1);

        expect(output).toContain('Vengeance');
        expect(output).toContain('Player 0: 5.5');
        expect(output).not.toContain('Player 2');
    });

    it('handles missing player gracefully', () => {
        const output = formatStatus(state, 99);

        expect(output).toContain('Player 99');
        expect(output).toContain('not found');
    });
});

describe('formatUnit', () => {
    let state: GameState;

    beforeEach(() => {
        resetTestEntityCounter();
        resetAIState();
        state = {
            ...INITIAL_STATE,
            tick: 1000,
            running: true,
            entities: {}
        };
    });

    afterEach(() => {
        resetAIState();
    });

    it('displays basic unit information', () => {
        const unit = createTestCombatUnit({
            id: 'unit-1',
            owner: 1,
            key: 'rifle',
            hp: 80,
            maxHp: 100,
            x: 500,
            y: 600
        });
        state = { ...state, entities: { [unit.id]: unit } };

        const output = formatUnit(state, 'unit-1');

        expect(output).toContain('unit-1');
        expect(output).toContain('rifle');
        expect(output).toContain('Owner: 1');
        expect(output).toContain('HP: 80/100');
        expect(output).toContain('80%');
        expect(output).toContain('Position: (500, 600)');
        expect(output).toContain('Dead: false');
    });

    it('displays movement information', () => {
        const unit = createTestCombatUnit({
            id: 'unit-1',
            owner: 1,
            moveTarget: new Vector(800, 900),
            rotation: 1.57,
            stuckTimer: 5
        });
        state = { ...state, entities: { [unit.id]: unit } };

        const output = formatUnit(state, 'unit-1');

        expect(output).toContain('Rotation:');
        expect(output).toContain('Move Target: (800, 900)');
        expect(output).toContain('Stuck Timer: 5');
    });

    it('displays combat target', () => {
        const unit = createTestCombatUnit({
            id: 'unit-1',
            owner: 1,
            targetId: 'enemy-1'
        });
        state = { ...state, entities: { [unit.id]: unit } };

        const output = formatUnit(state, 'unit-1');

        expect(output).toContain('Attack Target: enemy-1');
    });

    it('displays harvester-specific information', () => {
        const harvester = createTestHarvester({
            id: 'harv-1',
            owner: 0,
            cargo: 500,
            resourceTargetId: 'ore-1',
            baseTargetId: 'refinery-1'
        });
        state = { ...state, entities: { [harvester.id]: harvester } };

        const output = formatUnit(state, 'harv-1');

        expect(output).toContain('Cargo: 500');
        expect(output).toContain('Resource Target: ore-1');
        expect(output).toContain('Base Target: refinery-1');
    });

    it('displays group membership from AI state', () => {
        const unit = createTestCombatUnit({ id: 'unit-1', owner: 1 });
        state = { ...state, entities: { [unit.id]: unit } };

        const aiState = getAIState(1);
        aiState.attackGroup = ['unit-1', 'unit-2'];
        aiState.defenseGroup = [];
        aiState.offensiveGroups = [
            {
                id: 'og-1',
                unitIds: ['unit-1', 'unit-3'],
                target: null,
                rallyPoint: null,
                status: 'rallying',
                lastOrderTick: 0,
                lastHealthCheck: 0,
                avgHealthPercent: 100,
                moveTarget: null,
                lastRegroupTick: 0,
                engagedEnemies: [],
                preEngageTarget: null,
                needsReinforcements: false,
                reinforcementIds: []
            }
        ];

        const output = formatUnit(state, 'unit-1');

        expect(output).toContain('Groups:');
        expect(output).toContain('attackGroup');
        expect(output).toContain('og-1');
    });

    it('handles missing entity gracefully', () => {
        const output = formatUnit(state, 'nonexistent');

        expect(output).toContain('nonexistent');
        expect(output).toContain('not found');
    });

    it('displays building information', () => {
        const building = createTestBuilding({
            id: 'bld-1',
            owner: 0,
            key: 'refinery',
            hp: 1000,
            maxHp: 1200,
            x: 400,
            y: 400
        });
        state = { ...state, entities: { [building.id]: building } };

        const output = formatUnit(state, 'bld-1');

        expect(output).toContain('bld-1');
        expect(output).toContain('refinery');
        expect(output).toContain('BUILDING');
    });
});

describe('formatFind', () => {
    let state: GameState;

    beforeEach(() => {
        resetTestEntityCounter();
        state = {
            ...INITIAL_STATE,
            tick: 1000,
            running: true,
            entities: {}
        };
    });

    it('finds entities by type', () => {
        const unit = createTestCombatUnit({ id: 'u1', owner: 0 });
        const building = createTestBuilding({ id: 'b1', owner: 0 });
        state = {
            ...state,
            entities: { [unit.id]: unit, [building.id]: building }
        };

        const output = formatFind(state, 'type=unit');

        expect(output).toContain('u1');
        expect(output).not.toContain('b1');
    });

    it('finds entities by owner', () => {
        const unit1 = createTestCombatUnit({ id: 'u1', owner: 0 });
        const unit2 = createTestCombatUnit({ id: 'u2', owner: 1 });
        state = {
            ...state,
            entities: { [unit1.id]: unit1, [unit2.id]: unit2 }
        };

        const output = formatFind(state, 'owner=1');

        expect(output).toContain('u2');
        expect(output).not.toContain('u1');
    });

    it('finds entities by key', () => {
        const rifle = createTestCombatUnit({ id: 'u1', owner: 0, key: 'rifle' });
        const heavy = createTestCombatUnit({ id: 'u2', owner: 0, key: 'heavy' });
        state = {
            ...state,
            entities: { [rifle.id]: rifle, [heavy.id]: heavy }
        };

        const output = formatFind(state, 'key=rifle');

        expect(output).toContain('u1');
        expect(output).not.toContain('u2');
    });

    it('combines multiple filters', () => {
        const rifle1 = createTestCombatUnit({ id: 'u1', owner: 0, key: 'rifle' });
        const rifle2 = createTestCombatUnit({ id: 'u2', owner: 1, key: 'rifle' });
        const heavy = createTestCombatUnit({ id: 'u3', owner: 1, key: 'heavy' });
        state = {
            ...state,
            entities: {
                [rifle1.id]: rifle1,
                [rifle2.id]: rifle2,
                [heavy.id]: heavy
            }
        };

        const output = formatFind(state, 'owner=1,key=rifle');

        expect(output).toContain('u2');
        expect(output).not.toContain('u1');
        expect(output).not.toContain('u3');
    });

    it('excludes dead entities', () => {
        const alive = createTestCombatUnit({ id: 'u1', owner: 0, dead: false });
        const dead = createTestCombatUnit({ id: 'u2', owner: 0, dead: true });
        state = {
            ...state,
            entities: { [alive.id]: alive, [dead.id]: dead }
        };

        const output = formatFind(state, 'owner=0');

        expect(output).toContain('u1');
        expect(output).not.toContain('u2');
    });

    it('shows entity details in results', () => {
        const unit = createTestCombatUnit({
            id: 'u1',
            owner: 0,
            key: 'rifle',
            hp: 80,
            maxHp: 100,
            x: 500,
            y: 600
        });
        state = { ...state, entities: { [unit.id]: unit } };

        const output = formatFind(state, 'type=unit');

        expect(output).toContain('u1');
        expect(output).toContain('rifle');
        expect(output).toContain('0'); // owner
        expect(output).toContain('80%'); // hp percentage
        expect(output).toContain('500'); // x position
    });

    it('truncates to 20 results and shows count', () => {
        const entities: Record<string, any> = {};
        for (let i = 0; i < 25; i++) {
            const unit = createTestCombatUnit({ id: `u${i}`, owner: 0 });
            entities[unit.id] = unit;
        }
        state = { ...state, entities };

        const output = formatFind(state, 'type=unit');

        // Should show 20 results
        const lines = output.split('\n').filter(l => l.includes('rifle'));
        expect(lines.length).toBeLessThanOrEqual(20);

        // Should indicate more results
        expect(output).toContain('5 more');
    });

    it('handles no matches', () => {
        state = { ...state, entities: {} };

        const output = formatFind(state, 'type=unit');

        expect(output).toContain('No entities found');
    });

    it('handles case-insensitive type matching', () => {
        const unit = createTestCombatUnit({ id: 'u1', owner: 0 });
        state = { ...state, entities: { [unit.id]: unit } };

        const output = formatFind(state, 'type=UNIT');

        expect(output).toContain('u1');
    });
});

describe('formatGroups', () => {
    beforeEach(() => {
        resetAIState();
    });

    afterEach(() => {
        resetAIState();
    });

    it('displays attack group', () => {
        const aiState = getAIState(1);
        aiState.attackGroup = ['u1', 'u2', 'u3', 'u4', 'u5', 'u6'];

        const output = formatGroups(1);

        expect(output).toContain('Attack Group');
        expect(output).toContain('6 units');
        expect(output).toContain('u1');
        expect(output).toContain('u5');
    });

    it('displays harass group', () => {
        const aiState = getAIState(1);
        aiState.harassGroup = ['h1', 'h2'];

        const output = formatGroups(1);

        expect(output).toContain('Harass Group');
        expect(output).toContain('2 units');
    });

    it('displays defense group', () => {
        const aiState = getAIState(1);
        aiState.defenseGroup = ['d1', 'd2', 'd3'];

        const output = formatGroups(1);

        expect(output).toContain('Defense Group');
        expect(output).toContain('3 units');
    });

    it('displays offensive groups with details', () => {
        const aiState = getAIState(1);
        aiState.offensiveGroups = [
            {
                id: 'og-1',
                unitIds: ['u1', 'u2'],
                target: 'enemy-conyard',
                rallyPoint: new Vector(800, 900),
                status: 'attacking',
                lastOrderTick: 500,
                lastHealthCheck: 500,
                avgHealthPercent: 65,
                moveTarget: null,
                lastRegroupTick: 0,
                engagedEnemies: [],
                preEngageTarget: null,
                needsReinforcements: true,
                reinforcementIds: []
            }
        ];

        const output = formatGroups(1);

        expect(output).toContain('og-1');
        expect(output).toContain('attacking');
        expect(output).toContain('Units: 2');
        expect(output).toContain('enemy-conyard');
        expect(output).toContain('(800, 900)');
        expect(output).toContain('65%');
    });

    it('shows no active groups message when empty', () => {
        const aiState = getAIState(1);
        aiState.attackGroup = [];
        aiState.harassGroup = [];
        aiState.defenseGroup = [];
        aiState.offensiveGroups = [];

        const output = formatGroups(1);

        expect(output).toContain('No active groups');
    });
});

describe('formatEvent', () => {
    it('formats command event', () => {
        const event: CommandEvent = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                command: 'move',
                source: 'ai',
                destination: { x: 500, y: 600 }
            }
        };

        const output = formatEvent(event);

        expect(output).toContain('[100]');
        expect(output).toContain('command');
        expect(output).toContain('unit-1');
        expect(output).toContain('move');
        expect(output).toContain('ai');
        expect(output).toContain('(500, 600)');
    });

    it('formats decision event', () => {
        const event: DecisionEvent = {
            type: 'decision',
            tick: 200,
            playerId: 1,
            data: {
                category: 'strategy',
                action: 'attack',
                reason: 'enemy weak'
            }
        };

        const output = formatEvent(event);

        expect(output).toContain('[200]');
        expect(output).toContain('decision');
        expect(output).toContain('strategy');
        expect(output).toContain('attack');
        expect(output).toContain('enemy weak');
    });

    it('formats state-change event', () => {
        const event: StateChangeEvent = {
            type: 'state-change',
            tick: 300,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                subject: 'unit',
                field: 'hp',
                from: 100,
                to: 50,
                cause: 'combat damage'
            }
        };

        const output = formatEvent(event);

        expect(output).toContain('[300]');
        expect(output).toContain('state-change');
        expect(output).toContain('unit-1');
        expect(output).toContain('hp');
        expect(output).toContain('100');
        expect(output).toContain('50');
    });

    it('formats group event', () => {
        const event: GroupEvent = {
            type: 'group',
            tick: 400,
            playerId: 1,
            data: {
                groupId: 'og-1',
                action: 'created',
                unitIds: ['u1', 'u2'],
                reason: 'attack preparation'
            }
        };

        const output = formatEvent(event);

        expect(output).toContain('[400]');
        expect(output).toContain('group');
        expect(output).toContain('og-1');
        expect(output).toContain('created');
    });

    it('formats economy event', () => {
        const event: EconomyEvent = {
            type: 'economy',
            tick: 500,
            playerId: 1,
            data: {
                credits: 5000,
                delta: 200,
                source: 'harvest'
            }
        };

        const output = formatEvent(event);

        expect(output).toContain('[500]');
        expect(output).toContain('economy');
        expect(output).toContain('5000');
        expect(output).toContain('+200');
        expect(output).toContain('harvest');
    });

    it('formats production event', () => {
        const event: ProductionEvent = {
            type: 'production',
            tick: 600,
            playerId: 1,
            data: {
                action: 'completed',
                category: 'vehicle',
                key: 'heavy'
            }
        };

        const output = formatEvent(event);

        expect(output).toContain('[600]');
        expect(output).toContain('production');
        expect(output).toContain('completed');
        expect(output).toContain('heavy');
    });

    it('formats threat event', () => {
        const event: ThreatEvent = {
            type: 'threat',
            tick: 700,
            playerId: 1,
            data: {
                threatLevel: 75,
                economyScore: 50,
                desperation: 30,
                isDoomed: false,
                threatsNearBase: ['e1', 'e2'],
                vengeanceScores: { 0: 5 }
            }
        };

        const output = formatEvent(event);

        expect(output).toContain('[700]');
        expect(output).toContain('threat');
        expect(output).toContain('75');
        expect(output).toContain('50');
        expect(output).toContain('30');
    });
});

describe('formatEvents', () => {
    it('formats multiple events', () => {
        const events: DebugEvent[] = [
            {
                type: 'command',
                tick: 100,
                playerId: 1,
                entityId: 'u1',
                data: { command: 'move', source: 'ai' }
            },
            {
                type: 'economy',
                tick: 200,
                playerId: 1,
                data: { credits: 1000, delta: 100, source: 'harvest' }
            }
        ];

        const output = formatEvents(events);

        expect(output).toContain('[100]');
        expect(output).toContain('[200]');
        expect(output).toContain('command');
        expect(output).toContain('economy');
    });

    it('limits to specified count', () => {
        const events: DebugEvent[] = [];
        for (let i = 0; i < 50; i++) {
            events.push({
                type: 'command',
                tick: i * 10,
                playerId: 1,
                entityId: `u${i}`,
                data: { command: 'move', source: 'ai' }
            });
        }

        const output = formatEvents(events, 10);
        const lines = output.split('\n').filter(l => l.trim().length > 0);

        expect(lines.length).toBe(10);
    });

    it('defaults to 20 events', () => {
        const events: DebugEvent[] = [];
        for (let i = 0; i < 50; i++) {
            events.push({
                type: 'command',
                tick: i * 10,
                playerId: 1,
                entityId: `u${i}`,
                data: { command: 'move', source: 'ai' }
            });
        }

        const output = formatEvents(events);
        const lines = output.split('\n').filter(l => l.trim().length > 0);

        expect(lines.length).toBe(20);
    });

    it('returns all events if fewer than count', () => {
        const events: DebugEvent[] = [
            {
                type: 'command',
                tick: 100,
                playerId: 1,
                entityId: 'u1',
                data: { command: 'move', source: 'ai' }
            }
        ];

        const output = formatEvents(events, 20);
        const lines = output.split('\n').filter(l => l.trim().length > 0);

        expect(lines.length).toBe(1);
    });

    it('returns empty string for empty events', () => {
        const output = formatEvents([]);

        expect(output).toBe('');
    });

    it('shows last N events (most recent)', () => {
        const events: DebugEvent[] = [];
        for (let i = 0; i < 30; i++) {
            events.push({
                type: 'command',
                tick: i * 10,
                playerId: 1,
                entityId: `u${i}`,
                data: { command: 'move', source: 'ai' }
            });
        }

        const output = formatEvents(events, 5);

        // Should show ticks 250, 260, 270, 280, 290 (last 5)
        expect(output).toContain('[250]');
        expect(output).toContain('[290]');
        expect(output).not.toContain('[100]');
    });
});

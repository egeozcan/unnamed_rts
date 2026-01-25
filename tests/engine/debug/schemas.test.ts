import { describe, it, expect } from 'vitest';
import {
    VectorSchema,
    CommandEventSchema,
    DecisionEventSchema,
    StateChangeEventSchema,
    GroupEventSchema,
    EconomyEventSchema,
    ProductionEventSchema,
    ThreatEventSchema,
    DebugEventSchema,
    MetaLineSchema,
    type CommandEvent,
    type DecisionEvent,
    type StateChangeEvent,
    type GroupEvent,
    type EconomyEvent,
    type ProductionEvent,
    type ThreatEvent,
    type DebugEvent,
    type MetaLine
} from '../../../src/engine/debug/schemas.js';

describe('VectorSchema', () => {
    it('validates correct vector data', () => {
        const result = VectorSchema.safeParse({ x: 100, y: 200 });
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data).toEqual({ x: 100, y: 200 });
        }
    });

    it('validates negative coordinates', () => {
        const result = VectorSchema.safeParse({ x: -50, y: -100 });
        expect(result.success).toBe(true);
    });

    it('validates decimal coordinates', () => {
        const result = VectorSchema.safeParse({ x: 100.5, y: 200.75 });
        expect(result.success).toBe(true);
    });

    it('rejects missing x coordinate', () => {
        const result = VectorSchema.safeParse({ y: 200 });
        expect(result.success).toBe(false);
    });

    it('rejects missing y coordinate', () => {
        const result = VectorSchema.safeParse({ x: 100 });
        expect(result.success).toBe(false);
    });

    it('rejects non-number values', () => {
        const result = VectorSchema.safeParse({ x: '100', y: 200 });
        expect(result.success).toBe(false);
    });
});

describe('CommandEventSchema', () => {
    it('validates a move command from player', () => {
        const event = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                command: 'move',
                source: 'player',
                destination: { x: 500, y: 600 }
            }
        };
        const result = CommandEventSchema.safeParse(event);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('command');
            expect(result.data.data.command).toBe('move');
        }
    });

    it('validates an attack command from AI', () => {
        const event = {
            type: 'command',
            tick: 200,
            playerId: 2,
            entityId: 'unit-2',
            data: {
                command: 'attack',
                source: 'ai',
                target: 'enemy-1',
                reason: 'Defending base'
            }
        };
        const result = CommandEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates attack-move command', () => {
        const event = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                command: 'attack-move',
                source: 'player',
                destination: { x: 300, y: 400 }
            }
        };
        const result = CommandEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates stop command', () => {
        const event = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                command: 'stop',
                source: 'player'
            }
        };
        const result = CommandEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates deploy command', () => {
        const event = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                command: 'deploy',
                source: 'ai',
                reason: 'Deploying MCV'
            }
        };
        const result = CommandEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('rejects invalid command type', () => {
        const event = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                command: 'invalid-command',
                source: 'player'
            }
        };
        const result = CommandEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });

    it('rejects invalid source type', () => {
        const event = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                command: 'move',
                source: 'unknown'
            }
        };
        const result = CommandEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });

    it('rejects missing required fields', () => {
        const event = {
            type: 'command',
            tick: 100,
            playerId: 1,
            // missing entityId
            data: {
                command: 'move',
                source: 'player'
            }
        };
        const result = CommandEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });
});

describe('DecisionEventSchema', () => {
    it('validates a strategy decision', () => {
        const event = {
            type: 'decision',
            tick: 100,
            playerId: 1,
            data: {
                category: 'strategy',
                action: 'switch-to-attack',
                reason: 'Military strength sufficient',
                scores: { buildup: 10, attack: 25, defend: 5 },
                alternatives: ['defend', 'harass']
            }
        };
        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates a combat decision with entityId', () => {
        const event = {
            type: 'decision',
            tick: 150,
            playerId: 2,
            entityId: 'tank-1',
            data: {
                category: 'combat',
                action: 'engage-target',
                reason: 'Enemy in range'
            }
        };
        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates economy decision', () => {
        const event = {
            type: 'decision',
            tick: 100,
            playerId: 1,
            data: {
                category: 'economy',
                action: 'build-harvester',
                reason: 'Need more income'
            }
        };
        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates production decision', () => {
        const event = {
            type: 'decision',
            tick: 100,
            playerId: 1,
            data: {
                category: 'production',
                action: 'queue-tank',
                reason: 'Building army'
            }
        };
        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('rejects invalid category', () => {
        const event = {
            type: 'decision',
            tick: 100,
            playerId: 1,
            data: {
                category: 'invalid',
                action: 'some-action',
                reason: 'Some reason'
            }
        };
        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });

    it('rejects missing required fields in data', () => {
        const event = {
            type: 'decision',
            tick: 100,
            playerId: 1,
            data: {
                category: 'strategy',
                action: 'some-action'
                // missing reason
            }
        };
        const result = DecisionEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });
});

describe('StateChangeEventSchema', () => {
    it('validates unit state change', () => {
        const event = {
            type: 'state-change',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                subject: 'unit',
                field: 'hp',
                from: 100,
                to: 75,
                cause: 'Took damage from enemy-tank'
            }
        };
        const result = StateChangeEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates building state change', () => {
        const event = {
            type: 'state-change',
            tick: 100,
            entityId: 'building-1',
            data: {
                subject: 'building',
                field: 'isRepairing',
                from: false,
                to: true
            }
        };
        const result = StateChangeEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates AI state change', () => {
        const event = {
            type: 'state-change',
            tick: 100,
            playerId: 2,
            data: {
                subject: 'ai',
                field: 'strategy',
                from: 'buildup',
                to: 'attack',
                cause: 'Reached attack threshold'
            }
        };
        const result = StateChangeEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates group state change', () => {
        const event = {
            type: 'state-change',
            tick: 100,
            playerId: 1,
            data: {
                subject: 'group',
                field: 'status',
                from: 'idle',
                to: 'attacking'
            }
        };
        const result = StateChangeEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates state change with complex from/to values', () => {
        const event = {
            type: 'state-change',
            tick: 100,
            entityId: 'unit-1',
            data: {
                subject: 'unit',
                field: 'position',
                from: { x: 100, y: 100 },
                to: { x: 200, y: 200 }
            }
        };
        const result = StateChangeEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates state change with null values', () => {
        const event = {
            type: 'state-change',
            tick: 100,
            entityId: 'unit-1',
            data: {
                subject: 'unit',
                field: 'targetId',
                from: 'enemy-1',
                to: null
            }
        };
        const result = StateChangeEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('rejects invalid subject', () => {
        const event = {
            type: 'state-change',
            tick: 100,
            data: {
                subject: 'invalid',
                field: 'hp',
                from: 100,
                to: 50
            }
        };
        const result = StateChangeEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });
});

describe('GroupEventSchema', () => {
    it('validates group created event', () => {
        const event = {
            type: 'group',
            tick: 100,
            playerId: 1,
            data: {
                groupId: 'attack-group-1',
                action: 'created',
                unitIds: ['tank-1', 'tank-2', 'infantry-1'],
                status: 'forming'
            }
        };
        const result = GroupEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates group dissolved event', () => {
        const event = {
            type: 'group',
            tick: 200,
            playerId: 1,
            data: {
                groupId: 'attack-group-1',
                action: 'dissolved',
                reason: 'All units destroyed'
            }
        };
        const result = GroupEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates member-added event', () => {
        const event = {
            type: 'group',
            tick: 150,
            playerId: 1,
            data: {
                groupId: 'attack-group-1',
                action: 'member-added',
                unitIds: ['tank-3']
            }
        };
        const result = GroupEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates member-removed event', () => {
        const event = {
            type: 'group',
            tick: 175,
            playerId: 1,
            data: {
                groupId: 'attack-group-1',
                action: 'member-removed',
                unitIds: ['tank-1'],
                reason: 'Unit destroyed'
            }
        };
        const result = GroupEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates status-changed event', () => {
        const event = {
            type: 'group',
            tick: 180,
            playerId: 1,
            data: {
                groupId: 'attack-group-1',
                action: 'status-changed',
                status: 'attacking'
            }
        };
        const result = GroupEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('rejects invalid action', () => {
        const event = {
            type: 'group',
            tick: 100,
            playerId: 1,
            data: {
                groupId: 'group-1',
                action: 'invalid-action'
            }
        };
        const result = GroupEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });

    it('rejects missing playerId', () => {
        const event = {
            type: 'group',
            tick: 100,
            data: {
                groupId: 'group-1',
                action: 'created'
            }
        };
        const result = GroupEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });
});

describe('EconomyEventSchema', () => {
    it('validates harvest event', () => {
        const event = {
            type: 'economy',
            tick: 100,
            playerId: 1,
            data: {
                credits: 1500,
                delta: 200,
                source: 'harvest',
                entityId: 'harvester-1'
            }
        };
        const result = EconomyEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates sell event', () => {
        const event = {
            type: 'economy',
            tick: 150,
            playerId: 1,
            data: {
                credits: 1800,
                delta: 300,
                source: 'sell',
                entityId: 'building-1'
            }
        };
        const result = EconomyEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates spend event', () => {
        const event = {
            type: 'economy',
            tick: 200,
            playerId: 1,
            data: {
                credits: 800,
                delta: -500,
                source: 'spend'
            }
        };
        const result = EconomyEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates induction-rig event', () => {
        const event = {
            type: 'economy',
            tick: 250,
            playerId: 2,
            data: {
                credits: 2500,
                delta: 100,
                source: 'induction-rig',
                entityId: 'induction-rig-1'
            }
        };
        const result = EconomyEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('rejects invalid source', () => {
        const event = {
            type: 'economy',
            tick: 100,
            playerId: 1,
            data: {
                credits: 1000,
                delta: 100,
                source: 'cheat'
            }
        };
        const result = EconomyEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });

    it('rejects missing playerId', () => {
        const event = {
            type: 'economy',
            tick: 100,
            data: {
                credits: 1000,
                delta: 100,
                source: 'harvest'
            }
        };
        const result = EconomyEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });
});

describe('ProductionEventSchema', () => {
    it('validates queue-add event', () => {
        const event = {
            type: 'production',
            tick: 100,
            playerId: 1,
            data: {
                action: 'queue-add',
                category: 'vehicle',
                key: 'tank',
                queueLength: 1
            }
        };
        const result = ProductionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates queue-remove event', () => {
        const event = {
            type: 'production',
            tick: 150,
            playerId: 1,
            data: {
                action: 'queue-remove',
                category: 'infantry',
                key: 'rifleman',
                queueLength: 0
            }
        };
        const result = ProductionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates started event', () => {
        const event = {
            type: 'production',
            tick: 100,
            playerId: 1,
            data: {
                action: 'started',
                category: 'building',
                key: 'refinery'
            }
        };
        const result = ProductionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates completed event', () => {
        const event = {
            type: 'production',
            tick: 200,
            playerId: 1,
            data: {
                action: 'completed',
                category: 'air',
                key: 'harrier'
            }
        };
        const result = ProductionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates cancelled event', () => {
        const event = {
            type: 'production',
            tick: 180,
            playerId: 1,
            data: {
                action: 'cancelled',
                category: 'vehicle',
                key: 'tank',
                queueLength: 0
            }
        };
        const result = ProductionEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('rejects invalid action', () => {
        const event = {
            type: 'production',
            tick: 100,
            playerId: 1,
            data: {
                action: 'invalid',
                category: 'vehicle',
                key: 'tank'
            }
        };
        const result = ProductionEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });

    it('rejects invalid category', () => {
        const event = {
            type: 'production',
            tick: 100,
            playerId: 1,
            data: {
                action: 'started',
                category: 'naval',
                key: 'ship'
            }
        };
        const result = ProductionEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });
});

describe('ThreatEventSchema', () => {
    it('validates a complete threat event', () => {
        const event = {
            type: 'threat',
            tick: 100,
            playerId: 1,
            data: {
                threatLevel: 50,
                economyScore: 1500,
                desperation: 0.3,
                isDoomed: false,
                threatsNearBase: ['enemy-tank-1', 'enemy-infantry-2'],
                vengeanceScores: { 2: 100, 3: 50 }
            }
        };
        const result = ThreatEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates threat event with empty arrays', () => {
        const event = {
            type: 'threat',
            tick: 100,
            playerId: 1,
            data: {
                threatLevel: 0,
                economyScore: 2000,
                desperation: 0,
                isDoomed: false,
                threatsNearBase: [],
                vengeanceScores: {}
            }
        };
        const result = ThreatEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('validates threat event with isDoomed true', () => {
        const event = {
            type: 'threat',
            tick: 500,
            playerId: 2,
            data: {
                threatLevel: 200,
                economyScore: 0,
                desperation: 1.0,
                isDoomed: true,
                threatsNearBase: ['enemy-1', 'enemy-2', 'enemy-3'],
                vengeanceScores: { 1: 500 }
            }
        };
        const result = ThreatEventSchema.safeParse(event);
        expect(result.success).toBe(true);
    });

    it('rejects missing required fields', () => {
        const event = {
            type: 'threat',
            tick: 100,
            playerId: 1,
            data: {
                threatLevel: 50,
                economyScore: 1500
                // missing desperation, isDoomed, threatsNearBase, vengeanceScores
            }
        };
        const result = ThreatEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });

    it('rejects missing playerId', () => {
        const event = {
            type: 'threat',
            tick: 100,
            data: {
                threatLevel: 50,
                economyScore: 1500,
                desperation: 0.3,
                isDoomed: false,
                threatsNearBase: [],
                vengeanceScores: {}
            }
        };
        const result = ThreatEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });
});

describe('DebugEventSchema (discriminated union)', () => {
    it('correctly parses command events', () => {
        const event = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                command: 'move',
                source: 'player',
                destination: { x: 100, y: 200 }
            }
        };
        const result = DebugEventSchema.safeParse(event);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('command');
        }
    });

    it('correctly parses decision events', () => {
        const event = {
            type: 'decision',
            tick: 100,
            playerId: 1,
            data: {
                category: 'strategy',
                action: 'attack',
                reason: 'Time to attack'
            }
        };
        const result = DebugEventSchema.safeParse(event);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('decision');
        }
    });

    it('correctly parses state-change events', () => {
        const event = {
            type: 'state-change',
            tick: 100,
            entityId: 'unit-1',
            data: {
                subject: 'unit',
                field: 'hp',
                from: 100,
                to: 50
            }
        };
        const result = DebugEventSchema.safeParse(event);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('state-change');
        }
    });

    it('correctly parses group events', () => {
        const event = {
            type: 'group',
            tick: 100,
            playerId: 1,
            data: {
                groupId: 'group-1',
                action: 'created'
            }
        };
        const result = DebugEventSchema.safeParse(event);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('group');
        }
    });

    it('correctly parses economy events', () => {
        const event = {
            type: 'economy',
            tick: 100,
            playerId: 1,
            data: {
                credits: 1000,
                delta: 100,
                source: 'harvest'
            }
        };
        const result = DebugEventSchema.safeParse(event);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('economy');
        }
    });

    it('correctly parses production events', () => {
        const event = {
            type: 'production',
            tick: 100,
            playerId: 1,
            data: {
                action: 'started',
                category: 'vehicle',
                key: 'tank'
            }
        };
        const result = DebugEventSchema.safeParse(event);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('production');
        }
    });

    it('correctly parses threat events', () => {
        const event = {
            type: 'threat',
            tick: 100,
            playerId: 1,
            data: {
                threatLevel: 50,
                economyScore: 1000,
                desperation: 0.5,
                isDoomed: false,
                threatsNearBase: [],
                vengeanceScores: {}
            }
        };
        const result = DebugEventSchema.safeParse(event);
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.type).toBe('threat');
        }
    });

    it('rejects unknown event types', () => {
        const event = {
            type: 'unknown',
            tick: 100,
            data: {}
        };
        const result = DebugEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });

    it('rejects events with wrong data structure for type', () => {
        // Command event with decision data
        const event = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                category: 'strategy',
                action: 'attack',
                reason: 'Test'
            }
        };
        const result = DebugEventSchema.safeParse(event);
        expect(result.success).toBe(false);
    });
});

describe('MetaLineSchema', () => {
    it('validates a complete meta line', () => {
        const meta = {
            _meta: true,
            version: '1.0.0',
            startTick: 0,
            endTick: 5000,
            filters: {
                categories: ['command', 'decision'],
                trackedEntities: ['unit-1', 'unit-2'],
                trackedPlayers: [1, 2],
                thresholds: { minThreatLevel: 10 }
            },
            recordedAt: '2024-01-25T10:30:00.000Z'
        };
        const result = MetaLineSchema.safeParse(meta);
        expect(result.success).toBe(true);
    });

    it('validates meta line with empty filters', () => {
        const meta = {
            _meta: true,
            version: '1.0.0',
            startTick: 100,
            endTick: 200,
            filters: {
                categories: [],
                trackedEntities: [],
                trackedPlayers: [],
                thresholds: {}
            },
            recordedAt: '2024-01-25T10:30:00.000Z'
        };
        const result = MetaLineSchema.safeParse(meta);
        expect(result.success).toBe(true);
    });

    it('rejects meta line with _meta: false', () => {
        const meta = {
            _meta: false,
            version: '1.0.0',
            startTick: 0,
            endTick: 100,
            filters: {
                categories: [],
                trackedEntities: [],
                trackedPlayers: [],
                thresholds: {}
            },
            recordedAt: '2024-01-25T10:30:00.000Z'
        };
        const result = MetaLineSchema.safeParse(meta);
        expect(result.success).toBe(false);
    });

    it('rejects meta line with missing required fields', () => {
        const meta = {
            _meta: true,
            version: '1.0.0'
            // missing startTick, endTick, filters, recordedAt
        };
        const result = MetaLineSchema.safeParse(meta);
        expect(result.success).toBe(false);
    });

    it('rejects meta line with invalid filter structure', () => {
        const meta = {
            _meta: true,
            version: '1.0.0',
            startTick: 0,
            endTick: 100,
            filters: {
                categories: 'not-an-array'  // should be array
            },
            recordedAt: '2024-01-25T10:30:00.000Z'
        };
        const result = MetaLineSchema.safeParse(meta);
        expect(result.success).toBe(false);
    });
});

describe('Type inference', () => {
    it('CommandEvent type works correctly', () => {
        const event: CommandEvent = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                command: 'move',
                source: 'player',
                destination: { x: 100, y: 200 }
            }
        };
        expect(event.type).toBe('command');
    });

    it('DecisionEvent type works correctly', () => {
        const event: DecisionEvent = {
            type: 'decision',
            tick: 100,
            playerId: 1,
            data: {
                category: 'strategy',
                action: 'attack',
                reason: 'Time to strike'
            }
        };
        expect(event.type).toBe('decision');
    });

    it('StateChangeEvent type works correctly', () => {
        const event: StateChangeEvent = {
            type: 'state-change',
            tick: 100,
            data: {
                subject: 'unit',
                field: 'hp',
                from: 100,
                to: 50
            }
        };
        expect(event.type).toBe('state-change');
    });

    it('GroupEvent type works correctly', () => {
        const event: GroupEvent = {
            type: 'group',
            tick: 100,
            playerId: 1,
            data: {
                groupId: 'group-1',
                action: 'created'
            }
        };
        expect(event.type).toBe('group');
    });

    it('EconomyEvent type works correctly', () => {
        const event: EconomyEvent = {
            type: 'economy',
            tick: 100,
            playerId: 1,
            data: {
                credits: 1000,
                delta: 100,
                source: 'harvest'
            }
        };
        expect(event.type).toBe('economy');
    });

    it('ProductionEvent type works correctly', () => {
        const event: ProductionEvent = {
            type: 'production',
            tick: 100,
            playerId: 1,
            data: {
                action: 'started',
                category: 'vehicle',
                key: 'tank'
            }
        };
        expect(event.type).toBe('production');
    });

    it('ThreatEvent type works correctly', () => {
        const event: ThreatEvent = {
            type: 'threat',
            tick: 100,
            playerId: 1,
            data: {
                threatLevel: 50,
                economyScore: 1000,
                desperation: 0.5,
                isDoomed: false,
                threatsNearBase: [],
                vengeanceScores: {}
            }
        };
        expect(event.type).toBe('threat');
    });

    it('DebugEvent union type works with narrowing', () => {
        const event: DebugEvent = {
            type: 'command',
            tick: 100,
            playerId: 1,
            entityId: 'unit-1',
            data: {
                command: 'move',
                source: 'player'
            }
        };

        if (event.type === 'command') {
            // TypeScript should narrow to CommandEvent
            expect(event.data.command).toBe('move');
        }
    });

    it('MetaLine type works correctly', () => {
        const meta: MetaLine = {
            _meta: true,
            version: '1.0.0',
            startTick: 0,
            endTick: 100,
            filters: {
                categories: [],
                trackedEntities: [],
                trackedPlayers: [],
                thresholds: {}
            },
            recordedAt: '2024-01-25T10:30:00.000Z'
        };
        expect(meta._meta).toBe(true);
    });
});

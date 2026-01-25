import { describe, it, expect, beforeEach } from 'vitest';
import {
    FilterConfig,
    createDefaultFilterConfig,
    DebugCollector
} from '../../../src/scripts/debug/collector.js';
import type {
    DebugEvent,
    CommandEvent,
    EconomyEvent,
    ThreatEvent,
    DecisionEvent
} from '../../../src/engine/debug/schemas.js';

describe('createDefaultFilterConfig', () => {
    it('returns config with all categories enabled', () => {
        const config = createDefaultFilterConfig();

        expect(config.categories.command).toBe(true);
        expect(config.categories.decision).toBe(true);
        expect(config.categories['state-change']).toBe(true);
        expect(config.categories.group).toBe(true);
        expect(config.categories.economy).toBe(true);
        expect(config.categories.production).toBe(true);
        expect(config.categories.threat).toBe(true);
    });

    it('returns config with empty entity whitelist', () => {
        const config = createDefaultFilterConfig();
        expect(config.trackedEntities.size).toBe(0);
    });

    it('returns config with empty player whitelist', () => {
        const config = createDefaultFilterConfig();
        expect(config.trackedPlayers.size).toBe(0);
    });

    it('returns config with economy and threat changeOnly enabled', () => {
        const config = createDefaultFilterConfig();
        expect(config.changeOnly.economy).toBe(true);
        expect(config.changeOnly.threat).toBe(true);
        expect(config.changeOnly.strategy).toBe(false);
    });

    it('returns config with snapshotInterval of 100', () => {
        const config = createDefaultFilterConfig();
        expect(config.snapshotInterval).toBe(100);
    });

    it('returns config with empty thresholds', () => {
        const config = createDefaultFilterConfig();
        expect(config.thresholds.hpBelow).toBeUndefined();
        expect(config.thresholds.creditsBelow).toBeUndefined();
        expect(config.thresholds.threatAbove).toBeUndefined();
        expect(config.thresholds.economyDelta).toBeUndefined();
    });
});

describe('DebugCollector', () => {
    let collector: DebugCollector;
    let defaultConfig: FilterConfig;

    beforeEach(() => {
        collector = new DebugCollector();
        defaultConfig = createDefaultFilterConfig();
    });

    // Helper to create test events
    const createCommandEvent = (overrides: Partial<CommandEvent> = {}): CommandEvent => ({
        type: 'command',
        tick: 100,
        playerId: 1,
        entityId: 'unit-1',
        data: {
            command: 'move',
            source: 'ai',
            destination: { x: 100, y: 200 }
        },
        ...overrides
    });

    const createEconomyEvent = (overrides: Partial<EconomyEvent> = {}): EconomyEvent => ({
        type: 'economy',
        tick: 100,
        playerId: 1,
        data: {
            credits: 1000,
            delta: 100,
            source: 'harvest'
        },
        ...overrides
    });

    const createThreatEvent = (overrides: Partial<ThreatEvent> = {}): ThreatEvent => ({
        type: 'threat',
        tick: 100,
        playerId: 1,
        data: {
            threatLevel: 5,
            economyScore: 100,
            desperation: 0.2,
            isDoomed: false,
            threatsNearBase: [],
            vengeanceScores: {}
        },
        ...overrides
    });

    const createDecisionEvent = (overrides: Partial<DecisionEvent> = {}): DecisionEvent => ({
        type: 'decision',
        tick: 100,
        playerId: 1,
        data: {
            category: 'strategy',
            action: 'attack',
            reason: 'enemy weak'
        },
        ...overrides
    });

    describe('basic collection', () => {
        it('stores events when collected', () => {
            const event = createCommandEvent();
            collector.collect(event);

            const events = collector.getEvents();
            expect(events).toHaveLength(1);
            expect(events[0]).toEqual(event);
        });

        it('stores multiple events in order', () => {
            const event1 = createCommandEvent({ tick: 100 });
            const event2 = createCommandEvent({ tick: 200 });
            const event3 = createCommandEvent({ tick: 300 });

            collector.collect(event1);
            collector.collect(event2);
            collector.collect(event3);

            const events = collector.getEvents();
            expect(events).toHaveLength(3);
            expect(events[0].tick).toBe(100);
            expect(events[1].tick).toBe(200);
            expect(events[2].tick).toBe(300);
        });

        it('clears all events when clear() is called', () => {
            collector.collect(createCommandEvent());
            collector.collect(createCommandEvent());

            collector.clear();

            expect(collector.getEvents()).toHaveLength(0);
        });

        it('returns a copy of events array', () => {
            collector.collect(createCommandEvent());
            const events1 = collector.getEvents();
            const events2 = collector.getEvents();

            expect(events1).not.toBe(events2);
            expect(events1).toEqual(events2);
        });
    });

    describe('config management', () => {
        it('uses default config when not explicitly set', () => {
            const config = collector.getConfig();
            expect(config.categories.command).toBe(true);
        });

        it('allows setting custom config', () => {
            const customConfig = createDefaultFilterConfig();
            customConfig.categories.command = false;

            collector.setConfig(customConfig);

            expect(collector.getConfig().categories.command).toBe(false);
        });
    });

    describe('category filtering', () => {
        it('collects events when category is enabled', () => {
            const event = createCommandEvent();
            collector.collect(event);

            expect(collector.getEvents()).toHaveLength(1);
        });

        it('filters out events when category is disabled', () => {
            const config = createDefaultFilterConfig();
            config.categories.command = false;
            collector.setConfig(config);

            collector.collect(createCommandEvent());

            expect(collector.getEvents()).toHaveLength(0);
        });

        it('filters economy events when economy category disabled', () => {
            const config = createDefaultFilterConfig();
            config.categories.economy = false;
            // Disable changeOnly to test category filtering alone
            config.changeOnly.economy = false;
            collector.setConfig(config);

            collector.collect(createEconomyEvent());

            expect(collector.getEvents()).toHaveLength(0);
        });

        it('filters threat events when threat category disabled', () => {
            const config = createDefaultFilterConfig();
            config.categories.threat = false;
            config.changeOnly.threat = false;
            collector.setConfig(config);

            collector.collect(createThreatEvent());

            expect(collector.getEvents()).toHaveLength(0);
        });
    });

    describe('entity whitelist filtering', () => {
        it('collects all entities when whitelist is empty', () => {
            collector.collect(createCommandEvent({ entityId: 'unit-1' }));
            collector.collect(createCommandEvent({ entityId: 'unit-2' }));

            expect(collector.getEvents()).toHaveLength(2);
        });

        it('only collects whitelisted entities when whitelist is non-empty', () => {
            const config = createDefaultFilterConfig();
            config.trackedEntities = new Set(['unit-1']);
            collector.setConfig(config);

            collector.collect(createCommandEvent({ entityId: 'unit-1' }));
            collector.collect(createCommandEvent({ entityId: 'unit-2' }));

            expect(collector.getEvents()).toHaveLength(1);
            expect(collector.getEvents()[0].entityId).toBe('unit-1');
        });

        it('collects events without entityId when whitelist is non-empty', () => {
            const config = createDefaultFilterConfig();
            config.trackedEntities = new Set(['unit-1']);
            collector.setConfig(config);

            // Decision events may not have entityId
            const decisionEvent = createDecisionEvent();
            delete (decisionEvent as { entityId?: string }).entityId;
            collector.collect(decisionEvent);

            // Events without entityId should pass through
            expect(collector.getEvents()).toHaveLength(1);
        });
    });

    describe('player filtering', () => {
        it('collects all players when whitelist is empty', () => {
            collector.collect(createCommandEvent({ playerId: 1 }));
            collector.collect(createCommandEvent({ playerId: 2 }));

            expect(collector.getEvents()).toHaveLength(2);
        });

        it('only collects whitelisted players when whitelist is non-empty', () => {
            const config = createDefaultFilterConfig();
            config.trackedPlayers = new Set([1]);
            collector.setConfig(config);

            collector.collect(createCommandEvent({ playerId: 1 }));
            collector.collect(createCommandEvent({ playerId: 2 }));

            expect(collector.getEvents()).toHaveLength(1);
            expect(collector.getEvents()[0].playerId).toBe(1);
        });

        it('filters out events with undefined playerId when whitelist is non-empty', () => {
            const config = createDefaultFilterConfig();
            config.trackedPlayers = new Set([1]);
            collector.setConfig(config);

            // Some events like state-change may not have playerId
            const event: DebugEvent = {
                type: 'state-change',
                tick: 100,
                data: {
                    subject: 'unit',
                    field: 'hp',
                    from: 100,
                    to: 50
                }
            };
            collector.collect(event);

            expect(collector.getEvents()).toHaveLength(0);
        });
    });

    describe('change-only filtering for economy', () => {
        it('collects first economy event', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = true;
            collector.setConfig(config);

            collector.collect(createEconomyEvent({ data: { credits: 1000, delta: 100, source: 'harvest' } }));

            expect(collector.getEvents()).toHaveLength(1);
        });

        it('skips economy events with same credits as last', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = true;
            collector.setConfig(config);

            collector.collect(createEconomyEvent({
                playerId: 1,
                data: { credits: 1000, delta: 100, source: 'harvest' }
            }));
            collector.collect(createEconomyEvent({
                playerId: 1,
                data: { credits: 1000, delta: 0, source: 'harvest' }
            }));

            expect(collector.getEvents()).toHaveLength(1);
        });

        it('collects economy events when credits change', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = true;
            collector.setConfig(config);

            collector.collect(createEconomyEvent({
                playerId: 1,
                data: { credits: 1000, delta: 100, source: 'harvest' }
            }));
            collector.collect(createEconomyEvent({
                playerId: 1,
                data: { credits: 1100, delta: 100, source: 'harvest' }
            }));

            expect(collector.getEvents()).toHaveLength(2);
        });

        it('tracks credits per player separately', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = true;
            collector.setConfig(config);

            collector.collect(createEconomyEvent({
                playerId: 1,
                data: { credits: 1000, delta: 100, source: 'harvest' }
            }));
            collector.collect(createEconomyEvent({
                playerId: 2,
                data: { credits: 1000, delta: 100, source: 'harvest' }
            }));

            // Both should be collected since they're for different players
            expect(collector.getEvents()).toHaveLength(2);
        });

        it('collects all economy events when changeOnly.economy is false', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = false;
            collector.setConfig(config);

            collector.collect(createEconomyEvent({
                playerId: 1,
                data: { credits: 1000, delta: 100, source: 'harvest' }
            }));
            collector.collect(createEconomyEvent({
                playerId: 1,
                data: { credits: 1000, delta: 0, source: 'harvest' }
            }));

            expect(collector.getEvents()).toHaveLength(2);
        });
    });

    describe('change-only filtering for threat', () => {
        it('collects first threat event', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.threat = true;
            collector.setConfig(config);

            collector.collect(createThreatEvent({ data: { threatLevel: 5, economyScore: 100, desperation: 0.2, isDoomed: false, threatsNearBase: [], vengeanceScores: {} } }));

            expect(collector.getEvents()).toHaveLength(1);
        });

        it('skips threat events with same threatLevel as last', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.threat = true;
            collector.setConfig(config);

            collector.collect(createThreatEvent({
                playerId: 1,
                data: { threatLevel: 5, economyScore: 100, desperation: 0.2, isDoomed: false, threatsNearBase: [], vengeanceScores: {} }
            }));
            collector.collect(createThreatEvent({
                playerId: 1,
                data: { threatLevel: 5, economyScore: 200, desperation: 0.3, isDoomed: false, threatsNearBase: [], vengeanceScores: {} }
            }));

            expect(collector.getEvents()).toHaveLength(1);
        });

        it('collects threat events when threatLevel changes', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.threat = true;
            collector.setConfig(config);

            collector.collect(createThreatEvent({
                playerId: 1,
                data: { threatLevel: 5, economyScore: 100, desperation: 0.2, isDoomed: false, threatsNearBase: [], vengeanceScores: {} }
            }));
            collector.collect(createThreatEvent({
                playerId: 1,
                data: { threatLevel: 8, economyScore: 100, desperation: 0.2, isDoomed: false, threatsNearBase: [], vengeanceScores: {} }
            }));

            expect(collector.getEvents()).toHaveLength(2);
        });
    });

    describe('threshold filtering for economyDelta', () => {
        it('collects economy events when delta exceeds threshold', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = false;
            config.thresholds.economyDelta = 50;
            collector.setConfig(config);

            collector.collect(createEconomyEvent({
                data: { credits: 1000, delta: 100, source: 'harvest' }
            }));

            expect(collector.getEvents()).toHaveLength(1);
        });

        it('filters economy events when delta is below threshold', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = false;
            config.thresholds.economyDelta = 50;
            collector.setConfig(config);

            collector.collect(createEconomyEvent({
                data: { credits: 1000, delta: 30, source: 'harvest' }
            }));

            expect(collector.getEvents()).toHaveLength(0);
        });

        it('filters economy events when negative delta magnitude is below threshold', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = false;
            config.thresholds.economyDelta = 50;
            collector.setConfig(config);

            collector.collect(createEconomyEvent({
                data: { credits: 1000, delta: -30, source: 'spend' }
            }));

            expect(collector.getEvents()).toHaveLength(0);
        });

        it('collects economy events when negative delta magnitude exceeds threshold', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = false;
            config.thresholds.economyDelta = 50;
            collector.setConfig(config);

            collector.collect(createEconomyEvent({
                data: { credits: 1000, delta: -100, source: 'spend' }
            }));

            expect(collector.getEvents()).toHaveLength(1);
        });

        it('collects economy events when threshold not set', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = false;
            // No threshold set
            collector.setConfig(config);

            collector.collect(createEconomyEvent({
                data: { credits: 1000, delta: 10, source: 'harvest' }
            }));

            expect(collector.getEvents()).toHaveLength(1);
        });
    });

    describe('threshold filtering for threatAbove', () => {
        it('collects threat events when threatLevel exceeds threshold', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.threat = false;
            config.thresholds.threatAbove = 3;
            collector.setConfig(config);

            collector.collect(createThreatEvent({
                data: { threatLevel: 5, economyScore: 100, desperation: 0.2, isDoomed: false, threatsNearBase: [], vengeanceScores: {} }
            }));

            expect(collector.getEvents()).toHaveLength(1);
        });

        it('filters threat events when threatLevel is at or below threshold', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.threat = false;
            config.thresholds.threatAbove = 5;
            collector.setConfig(config);

            collector.collect(createThreatEvent({
                data: { threatLevel: 5, economyScore: 100, desperation: 0.2, isDoomed: false, threatsNearBase: [], vengeanceScores: {} }
            }));

            expect(collector.getEvents()).toHaveLength(0);
        });

        it('filters threat events when threatLevel is below threshold', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.threat = false;
            config.thresholds.threatAbove = 5;
            collector.setConfig(config);

            collector.collect(createThreatEvent({
                data: { threatLevel: 3, economyScore: 100, desperation: 0.2, isDoomed: false, threatsNearBase: [], vengeanceScores: {} }
            }));

            expect(collector.getEvents()).toHaveLength(0);
        });
    });

    describe('clear() resets lastValues tracking', () => {
        it('resets economy change tracking on clear', () => {
            const config = createDefaultFilterConfig();
            config.changeOnly.economy = true;
            collector.setConfig(config);

            collector.collect(createEconomyEvent({
                playerId: 1,
                data: { credits: 1000, delta: 100, source: 'harvest' }
            }));
            collector.clear();

            // After clear, should collect again even with same credits
            collector.collect(createEconomyEvent({
                playerId: 1,
                data: { credits: 1000, delta: 100, source: 'harvest' }
            }));

            expect(collector.getEvents()).toHaveLength(1);
        });
    });

    describe('exportToJsonl', () => {
        it('exports events within tick range as JSONL', () => {
            collector.collect(createCommandEvent({ tick: 50 }));
            collector.collect(createCommandEvent({ tick: 100 }));
            collector.collect(createCommandEvent({ tick: 150 }));
            collector.collect(createCommandEvent({ tick: 200 }));

            const jsonl = collector.exportToJsonl(100, 150);
            const lines = jsonl.trim().split('\n');

            // First line is meta, then 2 events (ticks 100 and 150)
            expect(lines).toHaveLength(3);
        });

        it('includes meta line as first line', () => {
            collector.collect(createCommandEvent({ tick: 100 }));

            const jsonl = collector.exportToJsonl(0, 200);
            const lines = jsonl.split('\n');
            const meta = JSON.parse(lines[0]);

            expect(meta._meta).toBe(true);
            expect(meta.version).toBeDefined();
            expect(meta.startTick).toBe(0);
            expect(meta.endTick).toBe(200);
            expect(meta.filters).toBeDefined();
            expect(meta.recordedAt).toBeDefined();
        });

        it('includes enabled categories in meta', () => {
            const config = createDefaultFilterConfig();
            config.categories.command = false;
            config.categories.economy = false;
            collector.setConfig(config);

            collector.collect(createDecisionEvent({ tick: 100 }));

            const jsonl = collector.exportToJsonl(0, 200);
            const meta = JSON.parse(jsonl.split('\n')[0]);

            expect(meta.filters.categories).toContain('decision');
            expect(meta.filters.categories).not.toContain('command');
            expect(meta.filters.categories).not.toContain('economy');
        });

        it('includes tracked entities in meta', () => {
            const config = createDefaultFilterConfig();
            config.trackedEntities = new Set(['unit-1', 'unit-2']);
            collector.setConfig(config);

            const jsonl = collector.exportToJsonl(0, 200);
            const meta = JSON.parse(jsonl.split('\n')[0]);

            expect(meta.filters.trackedEntities).toContain('unit-1');
            expect(meta.filters.trackedEntities).toContain('unit-2');
        });

        it('includes tracked players in meta', () => {
            const config = createDefaultFilterConfig();
            config.trackedPlayers = new Set([1, 2]);
            collector.setConfig(config);

            const jsonl = collector.exportToJsonl(0, 200);
            const meta = JSON.parse(jsonl.split('\n')[0]);

            expect(meta.filters.trackedPlayers).toContain(1);
            expect(meta.filters.trackedPlayers).toContain(2);
        });

        it('includes thresholds in meta', () => {
            const config = createDefaultFilterConfig();
            config.thresholds.economyDelta = 50;
            config.thresholds.threatAbove = 3;
            collector.setConfig(config);

            const jsonl = collector.exportToJsonl(0, 200);
            const meta = JSON.parse(jsonl.split('\n')[0]);

            expect(meta.filters.thresholds.economyDelta).toBe(50);
            expect(meta.filters.thresholds.threatAbove).toBe(3);
        });

        it('serializes each event as valid JSON', () => {
            collector.collect(createCommandEvent({ tick: 100 }));
            collector.collect(createEconomyEvent({ tick: 110 }));

            const jsonl = collector.exportToJsonl(0, 200);
            const lines = jsonl.trim().split('\n');

            // Skip meta line, parse event lines
            const event1 = JSON.parse(lines[1]);
            const event2 = JSON.parse(lines[2]);

            expect(event1.type).toBe('command');
            expect(event2.type).toBe('economy');
        });

        it('ends with trailing newline', () => {
            collector.collect(createCommandEvent({ tick: 100 }));

            const jsonl = collector.exportToJsonl(0, 200);

            expect(jsonl.endsWith('\n')).toBe(true);
        });

        it('returns only meta line when no events in range', () => {
            collector.collect(createCommandEvent({ tick: 50 }));

            const jsonl = collector.exportToJsonl(100, 200);
            const lines = jsonl.trim().split('\n');

            expect(lines).toHaveLength(1);
            expect(JSON.parse(lines[0])._meta).toBe(true);
        });

        it('includes events exactly at start and end ticks', () => {
            collector.collect(createCommandEvent({ tick: 100 }));
            collector.collect(createCommandEvent({ tick: 200 }));

            const jsonl = collector.exportToJsonl(100, 200);
            const lines = jsonl.trim().split('\n');

            // Meta + 2 events
            expect(lines).toHaveLength(3);
        });
    });
});

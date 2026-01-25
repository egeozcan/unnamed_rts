import { describe, it, expect } from 'vitest';
import {
    CliArgs,
    parseArgs,
    buildFilterConfig,
    printHelp
} from '../../../src/scripts/debug/cli.js';
import type { FilterConfig } from '../../../src/scripts/debug/collector.js';

describe('parseArgs', () => {
    describe('default values', () => {
        it('returns defaults when no arguments provided', () => {
            const args = parseArgs([]);

            expect(args.input).toBeNull();
            expect(args.output).toBeNull();
            expect(args.export).toBeNull();
            expect(args.advance).toBe(0);
            expect(args.advanceUntil).toBeNull();
            expect(args.maxTicks).toBe(100000);
            expect(args.repl).toBe(false);
            expect(args.status).toBeNull();
            expect(args.unit).toBeNull();
            expect(args.find).toBeNull();
            expect(args.listGroups).toBeNull();
            expect(args.track).toEqual([]);
            expect(args.player).toEqual([]);
            expect(args.category).toEqual([]);
            expect(args.noCategory).toEqual([]);
            expect(args.changeOnly).toEqual([]);
            expect(args.threshold).toEqual({});
            expect(args.snapshotInterval).toBe(100);
        });
    });

    describe('file arguments', () => {
        it('parses --input flag', () => {
            const args = parseArgs(['--input', 'state.json']);
            expect(args.input).toBe('state.json');
        });

        it('parses --output flag', () => {
            const args = parseArgs(['--output', 'output.json']);
            expect(args.output).toBe('output.json');
        });

        it('parses --export flag', () => {
            const args = parseArgs(['--export', 'events.jsonl']);
            expect(args.export).toBe('events.jsonl');
        });
    });

    describe('simulation arguments', () => {
        it('parses --advance flag', () => {
            const args = parseArgs(['--advance', '500']);
            expect(args.advance).toBe(500);
        });

        it('parses --advance-until flag', () => {
            const args = parseArgs(['--advance-until', 'dead unit-1']);
            expect(args.advanceUntil).toBe('dead unit-1');
        });

        it('parses --max-ticks flag', () => {
            const args = parseArgs(['--max-ticks', '50000']);
            expect(args.maxTicks).toBe(50000);
        });

        it('parses --repl flag', () => {
            const args = parseArgs(['--repl']);
            expect(args.repl).toBe(true);
        });
    });

    describe('query arguments', () => {
        it('parses --status flag', () => {
            const args = parseArgs(['--status', '1']);
            expect(args.status).toBe(1);
        });

        it('parses --unit flag', () => {
            const args = parseArgs(['--unit', 'unit-123']);
            expect(args.unit).toBe('unit-123');
        });

        it('parses --find flag', () => {
            const args = parseArgs(['--find', 'harvester owner:1']);
            expect(args.find).toBe('harvester owner:1');
        });

        it('parses --list-groups flag', () => {
            const args = parseArgs(['--list-groups', '2']);
            expect(args.listGroups).toBe(2);
        });
    });

    describe('filter arguments', () => {
        it('parses single --track flag', () => {
            const args = parseArgs(['--track', 'unit-1']);
            expect(args.track).toEqual(['unit-1']);
        });

        it('parses multiple --track flags', () => {
            const args = parseArgs(['--track', 'unit-1', '--track', 'unit-2']);
            expect(args.track).toEqual(['unit-1', 'unit-2']);
        });

        it('parses single --player flag', () => {
            const args = parseArgs(['--player', '1']);
            expect(args.player).toEqual([1]);
        });

        it('parses multiple --player flags', () => {
            const args = parseArgs(['--player', '1', '--player', '2']);
            expect(args.player).toEqual([1, 2]);
        });

        it('parses --category flag with comma-separated values', () => {
            const args = parseArgs(['--category', 'command,decision,economy']);
            expect(args.category).toEqual(['command', 'decision', 'economy']);
        });

        it('parses --no-category flag with comma-separated values', () => {
            const args = parseArgs(['--no-category', 'threat,production']);
            expect(args.noCategory).toEqual(['threat', 'production']);
        });

        it('parses --change-only flag with comma-separated values', () => {
            const args = parseArgs(['--change-only', 'economy,threat']);
            expect(args.changeOnly).toEqual(['economy', 'threat']);
        });

        it('parses --snapshot-interval flag', () => {
            const args = parseArgs(['--snapshot-interval', '250']);
            expect(args.snapshotInterval).toBe(250);
        });
    });

    describe('threshold arguments', () => {
        it('parses single --threshold flag', () => {
            const args = parseArgs(['--threshold', 'hp-below=50']);
            expect(args.threshold).toEqual({ 'hp-below': 50 });
        });

        it('parses multiple --threshold flags', () => {
            const args = parseArgs([
                '--threshold', 'hp-below=50',
                '--threshold', 'credits-below=1000'
            ]);
            expect(args.threshold).toEqual({
                'hp-below': 50,
                'credits-below': 1000
            });
        });

        it('parses all threshold types', () => {
            const args = parseArgs([
                '--threshold', 'hp-below=25',
                '--threshold', 'credits-below=500',
                '--threshold', 'threat-above=3',
                '--threshold', 'economy-delta=100'
            ]);
            expect(args.threshold).toEqual({
                'hp-below': 25,
                'credits-below': 500,
                'threat-above': 3,
                'economy-delta': 100
            });
        });
    });

    describe('combined arguments', () => {
        it('parses multiple different arguments', () => {
            const args = parseArgs([
                '--input', 'state.json',
                '--output', 'out.json',
                '--advance', '1000',
                '--player', '1',
                '--player', '2',
                '--category', 'command,decision',
                '--threshold', 'hp-below=50'
            ]);

            expect(args.input).toBe('state.json');
            expect(args.output).toBe('out.json');
            expect(args.advance).toBe(1000);
            expect(args.player).toEqual([1, 2]);
            expect(args.category).toEqual(['command', 'decision']);
            expect(args.threshold).toEqual({ 'hp-below': 50 });
        });
    });

    describe('error handling', () => {
        it('throws error for unknown flag', () => {
            expect(() => parseArgs(['--unknown-flag', 'value']))
                .toThrow('Unknown argument: --unknown-flag');
        });

        it('throws error when --input has no value', () => {
            expect(() => parseArgs(['--input']))
                .toThrow('Missing value for --input');
        });

        it('throws error when --advance has non-numeric value', () => {
            expect(() => parseArgs(['--advance', 'abc']))
                .toThrow('Invalid number for --advance: abc');
        });

        it('throws error when --status has non-numeric value', () => {
            expect(() => parseArgs(['--status', 'abc']))
                .toThrow('Invalid number for --status: abc');
        });

        it('throws error when --threshold has invalid format', () => {
            expect(() => parseArgs(['--threshold', 'invalid']))
                .toThrow('Invalid threshold format: invalid (expected name=value)');
        });
    });
});

describe('buildFilterConfig', () => {
    const createDefaultArgs = (): CliArgs => ({
        input: null,
        output: null,
        export: null,
        advance: 0,
        advanceUntil: null,
        maxTicks: 100000,
        repl: false,
        status: null,
        unit: null,
        find: null,
        listGroups: null,
        track: [],
        player: [],
        category: [],
        noCategory: [],
        changeOnly: [],
        threshold: {},
        snapshotInterval: 100
    });

    it('returns config with all categories enabled when no category args', () => {
        const args = createDefaultArgs();
        const config = buildFilterConfig(args);

        expect(config.categories.command).toBe(true);
        expect(config.categories.decision).toBe(true);
        expect(config.categories['state-change']).toBe(true);
        expect(config.categories.group).toBe(true);
        expect(config.categories.economy).toBe(true);
        expect(config.categories.production).toBe(true);
        expect(config.categories.threat).toBe(true);
    });

    it('enables only specified categories when --category is used', () => {
        const args = createDefaultArgs();
        args.category = ['command', 'decision'];
        const config = buildFilterConfig(args);

        expect(config.categories.command).toBe(true);
        expect(config.categories.decision).toBe(true);
        expect(config.categories['state-change']).toBe(false);
        expect(config.categories.group).toBe(false);
        expect(config.categories.economy).toBe(false);
        expect(config.categories.production).toBe(false);
        expect(config.categories.threat).toBe(false);
    });

    it('disables specified categories when --no-category is used', () => {
        const args = createDefaultArgs();
        args.noCategory = ['threat', 'production'];
        const config = buildFilterConfig(args);

        expect(config.categories.command).toBe(true);
        expect(config.categories.decision).toBe(true);
        expect(config.categories['state-change']).toBe(true);
        expect(config.categories.group).toBe(true);
        expect(config.categories.economy).toBe(true);
        expect(config.categories.production).toBe(false);
        expect(config.categories.threat).toBe(false);
    });

    it('populates trackedEntities from --track args', () => {
        const args = createDefaultArgs();
        args.track = ['unit-1', 'unit-2', 'building-3'];
        const config = buildFilterConfig(args);

        expect(config.trackedEntities.size).toBe(3);
        expect(config.trackedEntities.has('unit-1')).toBe(true);
        expect(config.trackedEntities.has('unit-2')).toBe(true);
        expect(config.trackedEntities.has('building-3')).toBe(true);
    });

    it('populates trackedPlayers from --player args', () => {
        const args = createDefaultArgs();
        args.player = [1, 2, 3];
        const config = buildFilterConfig(args);

        expect(config.trackedPlayers.size).toBe(3);
        expect(config.trackedPlayers.has(1)).toBe(true);
        expect(config.trackedPlayers.has(2)).toBe(true);
        expect(config.trackedPlayers.has(3)).toBe(true);
    });

    it('sets changeOnly flags from --change-only args', () => {
        const args = createDefaultArgs();
        args.changeOnly = ['economy', 'threat'];
        const config = buildFilterConfig(args);

        expect(config.changeOnly.economy).toBe(true);
        expect(config.changeOnly.threat).toBe(true);
        expect(config.changeOnly.strategy).toBe(false);
    });

    it('enables strategy change-only when specified', () => {
        const args = createDefaultArgs();
        args.changeOnly = ['strategy'];
        const config = buildFilterConfig(args);

        expect(config.changeOnly.economy).toBe(false);
        expect(config.changeOnly.threat).toBe(false);
        expect(config.changeOnly.strategy).toBe(true);
    });

    it('enables all changeOnly flags when all specified', () => {
        const args = createDefaultArgs();
        args.changeOnly = ['economy', 'threat', 'strategy'];
        const config = buildFilterConfig(args);

        expect(config.changeOnly.economy).toBe(true);
        expect(config.changeOnly.threat).toBe(true);
        expect(config.changeOnly.strategy).toBe(true);
    });

    it('disables all changeOnly when empty array specified', () => {
        const args = createDefaultArgs();
        args.changeOnly = [];
        const config = buildFilterConfig(args);

        // Default behavior - all false unless explicit
        expect(config.changeOnly.economy).toBe(false);
        expect(config.changeOnly.threat).toBe(false);
        expect(config.changeOnly.strategy).toBe(false);
    });

    it('maps thresholds correctly', () => {
        const args = createDefaultArgs();
        args.threshold = {
            'hp-below': 50,
            'credits-below': 1000,
            'threat-above': 3,
            'economy-delta': 100
        };
        const config = buildFilterConfig(args);

        expect(config.thresholds.hpBelow).toBe(50);
        expect(config.thresholds.creditsBelow).toBe(1000);
        expect(config.thresholds.threatAbove).toBe(3);
        expect(config.thresholds.economyDelta).toBe(100);
    });

    it('sets snapshotInterval from args', () => {
        const args = createDefaultArgs();
        args.snapshotInterval = 250;
        const config = buildFilterConfig(args);

        expect(config.snapshotInterval).toBe(250);
    });

    it('handles combined category and no-category (category takes precedence)', () => {
        const args = createDefaultArgs();
        args.category = ['command', 'decision', 'threat'];
        args.noCategory = ['threat']; // Should be ignored when category is specified
        const config = buildFilterConfig(args);

        // When --category is specified, only those categories are enabled
        expect(config.categories.command).toBe(true);
        expect(config.categories.decision).toBe(true);
        expect(config.categories.threat).toBe(true);
        expect(config.categories.economy).toBe(false);
    });
});

describe('printHelp', () => {
    it('does not throw when called', () => {
        // Just verify it doesn't throw - actual output is to console
        expect(() => printHelp()).not.toThrow();
    });
});

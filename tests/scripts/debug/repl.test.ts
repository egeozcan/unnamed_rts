/**
 * Tests for the Interactive REPL.
 *
 * Focuses on testable helper functions since full readline testing is complex.
 * Note: advanceState and advanceUntil are tested via integration tests with
 * real game state files, not synthetic state fixtures.
 */

import { describe, it, expect } from 'vitest';
import { type GameState } from '../../../src/engine/types.js';
import { INITIAL_STATE } from '../../../src/engine/reducer.js';
import { DebugCollector } from '../../../src/scripts/debug/collector.js';
import {
    parseCommand,
    type ReplContext
} from '../../../src/scripts/debug/repl.js';

// ============================================================================
// Test Fixtures
// ============================================================================

function createMinimalTestState(tick: number = 100): GameState {
    // Note: This state cannot be used with advanceState/advanceUntil
    // as those require a full valid game state
    return { ...INITIAL_STATE, tick };
}

// ============================================================================
// parseCommand Tests
// ============================================================================

describe('parseCommand', () => {
    it('parses command with no arguments', () => {
        const result = parseCommand('help');
        expect(result).toEqual({ cmd: 'help', args: [] });
    });

    it('parses command with single argument', () => {
        const result = parseCommand('load game_state.json');
        expect(result).toEqual({ cmd: 'load', args: ['game_state.json'] });
    });

    it('parses command with multiple arguments', () => {
        const result = parseCommand('threshold hp-below 50');
        expect(result).toEqual({ cmd: 'threshold', args: ['hp-below', '50'] });
    });

    it('handles extra whitespace', () => {
        const result = parseCommand('   advance   100   ');
        expect(result).toEqual({ cmd: 'advance', args: ['100'] });
    });

    it('returns empty cmd for empty input', () => {
        const result = parseCommand('');
        expect(result).toEqual({ cmd: '', args: [] });
    });

    it('handles tabs and multiple spaces', () => {
        const result = parseCommand('find\towner=1,type=unit');
        expect(result).toEqual({ cmd: 'find', args: ['owner=1,type=unit'] });
    });

    it('converts command to lowercase', () => {
        const result = parseCommand('HELP');
        expect(result).toEqual({ cmd: 'help', args: [] });
    });

    it('preserves argument case', () => {
        const result = parseCommand('load MyFile.JSON');
        expect(result).toEqual({ cmd: 'load', args: ['MyFile.JSON'] });
    });

    it('handles command with many arguments', () => {
        const result = parseCommand('advance-until tick >= 1000');
        expect(result).toEqual({ cmd: 'advance-until', args: ['tick', '>=', '1000'] });
    });

    it('handles whitespace-only input', () => {
        const result = parseCommand('   ');
        expect(result).toEqual({ cmd: '', args: [] });
    });
});

// ============================================================================
// ReplContext Tests
// ============================================================================

describe('ReplContext', () => {
    it('should be constructable with null state', () => {
        const context: ReplContext = {
            state: null,
            collector: new DebugCollector(),
            startTick: 0
        };
        expect(context.state).toBeNull();
    });

    it('should be constructable with valid state', () => {
        const state = createMinimalTestState(500);
        const context: ReplContext = {
            state,
            collector: new DebugCollector(),
            startTick: 500
        };
        expect(context.state).not.toBeNull();
        expect(context.startTick).toBe(500);
    });

    it('should allow state to be updated', () => {
        const context: ReplContext = {
            state: createMinimalTestState(100),
            collector: new DebugCollector(),
            startTick: 100
        };

        // Update state
        context.state = createMinimalTestState(200);
        expect(context.state?.tick).toBe(200);
    });
});

// ============================================================================
// Integration Notes
// ============================================================================
//
// The advanceState and advanceUntil functions require a fully valid GameState
// with all properties, spatial grids, collision data, etc. These are better
// tested through integration tests using real game state files.
//
// For example, you can test manually with:
//   npm run debug -- --input game_state.json --advance 100
//
// Or in REPL mode:
//   npm run debug -- --input game_state.json --repl
//   > advance 100
//   > advance-until tick >= 500

#!/usr/bin/env node
/**
 * Debug Tool - RTS Game State Debugger
 *
 * Main entry point for the CLI debugging tool.
 * Provides functionality for:
 * - Loading/saving game state
 * - Advancing simulation with trigger conditions
 * - Querying AI status and entity information
 * - Interactive REPL mode
 * - Event collection and export
 */

import { parseArgs, buildFilterConfig, CliArgs } from './cli.js';
import { loadState, saveState } from './state-loader.js';
import { DebugCollector } from './collector.js';
import { DebugEvents, DebugEvent } from '../../engine/debug/events.js';
import { parseTrigger, evaluateTrigger, Trigger } from './triggers.js';
import { update } from '../../engine/reducer.js';
import { computeAiActions, resetAIState } from '../../engine/ai/index.js';
import { formatStatus, formatUnit, formatFind, formatGroups } from './formatters.js';
import fs from 'node:fs';
import { GameState } from '../../engine/types.js';

// ============================================================================
// Stub Functions (to be implemented in later tasks)
// ============================================================================

// TODO: implement in Task 8
async function startRepl(
    _state: GameState | null,
    _collector: DebugCollector,
    _args: CliArgs
): Promise<void> {
    console.log('TODO: startRepl not yet implemented');
}

// ============================================================================
// Main Entry Point
// ============================================================================

async function main(): Promise<void> {
    // Parse command line arguments
    const args = parseArgs(process.argv.slice(2));

    // Create collector and configure
    const collector = new DebugCollector();
    const filterConfig = buildFilterConfig(args);
    collector.setConfig(filterConfig);

    // Connect collector to debug events
    // Cast is needed because DebugEvent from events.ts has generic data,
    // while collector expects the zod-typed DebugEvent with specific data shapes
    DebugEvents.setCollector((event: DebugEvent) => collector.collect(event as any));

    // Load state if provided
    let state: GameState | null = null;
    let startTick = 0;

    if (args.input) {
        try {
            state = loadState(args.input);
            startTick = state.tick;
            console.log(`Loaded state from ${args.input} (tick ${state.tick})`);
        } catch (err) {
            console.error(`Error loading state: ${(err as Error).message}`);
            process.exit(1);
        }
    }

    // Handle REPL mode
    if (args.repl) {
        await startRepl(state, collector, args);
        cleanup(collector);
        return;
    }

    // Handle query commands (no state modification needed)
    if (args.status !== null) {
        if (!state) {
            console.error('Error: --status requires --input');
            process.exit(1);
        }
        console.log(formatStatus(state, args.status));
        cleanup(collector);
        return;
    }

    if (args.unit !== null) {
        if (!state) {
            console.error('Error: --unit requires --input');
            process.exit(1);
        }
        console.log(formatUnit(state, args.unit));
        cleanup(collector);
        return;
    }

    if (args.find !== null) {
        if (!state) {
            console.error('Error: --find requires --input');
            process.exit(1);
        }
        console.log(formatFind(state, args.find));
        cleanup(collector);
        return;
    }

    if (args.listGroups !== null) {
        console.log(formatGroups(args.listGroups));
        cleanup(collector);
        return;
    }

    // Handle advance/advance-until
    if (args.advance > 0 || args.advanceUntil) {
        if (!state) {
            console.error('Error: --advance/--advance-until requires --input');
            process.exit(1);
        }

        state = runSimulation(state, args);
    }

    // Save output if requested
    if (args.output && state) {
        try {
            saveState(state, args.output);
            console.log(`Saved state to ${args.output} (tick ${state.tick})`);
        } catch (err) {
            console.error(`Error saving state: ${(err as Error).message}`);
            process.exit(1);
        }
    }

    // Export events if requested
    if (args.export && state) {
        try {
            const jsonl = collector.exportToJsonl(startTick, state.tick);
            fs.writeFileSync(args.export, jsonl, 'utf8');
            const eventCount = collector.getEvents().length;
            console.log(`Exported ${eventCount} events to ${args.export}`);
        } catch (err) {
            console.error(`Error exporting events: ${(err as Error).message}`);
            process.exit(1);
        }
    }

    // Cleanup
    cleanup(collector);
}

// ============================================================================
// Simulation Runner
// ============================================================================

/**
 * Run the game simulation based on CLI arguments.
 */
function runSimulation(state: GameState, args: CliArgs): GameState {
    // Reset AI state for all AI players
    for (const [playerIdStr, player] of Object.entries(state.players)) {
        if (player.isAi) {
            const playerId = parseInt(playerIdStr, 10);
            resetAIState(playerId);
        }
    }

    // Parse trigger if advance-until is specified
    let trigger: Trigger | null = null;
    if (args.advanceUntil) {
        try {
            trigger = parseTrigger(args.advanceUntil);
        } catch (err) {
            console.error(`Error parsing trigger: ${(err as Error).message}`);
            process.exit(1);
        }
    }

    // Determine how many ticks to run
    const targetTicks = args.advance > 0 ? args.advance : args.maxTicks;
    const startTick = state.tick;
    let ticksRun = 0;

    console.log(`Starting simulation at tick ${startTick}...`);

    // Main simulation loop
    while (ticksRun < targetTicks) {
        // Compute AI actions for all AI players
        for (const [playerIdStr, player] of Object.entries(state.players)) {
            if (player.isAi) {
                const playerId = parseInt(playerIdStr, 10);
                const actions = computeAiActions(state, playerId);
                for (const action of actions) {
                    state = update(state, action);
                }
            }
        }

        // Run game tick
        state = update(state, { type: 'TICK' });
        ticksRun++;

        // Check trigger condition
        if (trigger && evaluateTrigger(trigger, state)) {
            console.log(`Trigger condition met at tick ${state.tick}`);
            break;
        }

        // Progress indicator every 1000 ticks
        if (ticksRun % 1000 === 0) {
            console.log(`  ... tick ${state.tick} (${ticksRun} ticks simulated)`);
        }
    }

    // Summary
    if (ticksRun >= args.maxTicks && trigger) {
        console.log(`Reached max ticks (${args.maxTicks}) without trigger condition`);
    }

    console.log(`Simulation complete: ${ticksRun} ticks (${startTick} -> ${state.tick})`);

    return state;
}

// ============================================================================
// Cleanup
// ============================================================================

/**
 * Clean up resources before exit.
 */
function cleanup(collector: DebugCollector): void {
    // Clear collector
    collector.clear();

    // Disconnect from debug events
    DebugEvents.setCollector(null);
}

// ============================================================================
// Run Main
// ============================================================================

main().catch((err) => {
    console.error('Unexpected error:', err);
    process.exit(1);
});

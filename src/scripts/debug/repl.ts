/**
 * Interactive REPL for debugging game state.
 *
 * Provides an interactive command-line interface for:
 * - Loading/saving game state
 * - Advancing simulation with triggers
 * - Querying AI status and entity information
 * - Managing event collection and filtering
 */

import * as readline from 'node:readline';
import fs from 'node:fs';
import { GameState } from '../../engine/types.js';
import { DebugCollector, createDefaultFilterConfig, FilterConfig } from './collector.js';
// DebugEvents is connected in index.ts; we just use the collector here
import { loadState, saveState } from './state-loader.js';
import { parseTrigger, evaluateTrigger, Trigger } from './triggers.js';
import { update } from '../../engine/reducer.js';
import { computeAiActions, resetAIState } from '../../engine/ai/index.js';
import { formatStatus, formatUnit, formatFind, formatGroups, formatEvents } from './formatters.js';
import { CliArgs } from './cli.js';

// ============================================================================
// Types
// ============================================================================

export interface ReplContext {
    state: GameState | null;
    collector: DebugCollector;
    startTick: number;
}

export interface ParsedCommand {
    cmd: string;
    args: string[];
}

export interface AdvanceUntilResult {
    state: GameState;
    reason: 'trigger' | 'max-ticks' | 'error';
    error?: string;
}

// ============================================================================
// Command Parsing
// ============================================================================

/**
 * Parse a command line into command and arguments.
 */
export function parseCommand(input: string): ParsedCommand {
    const trimmed = input.trim();
    if (!trimmed) {
        return { cmd: '', args: [] };
    }

    const parts = trimmed.split(/\s+/);
    return {
        cmd: parts[0].toLowerCase(),
        args: parts.slice(1)
    };
}

// ============================================================================
// State Advancement Helpers
// ============================================================================

/**
 * Advance game state by a specified number of ticks.
 * Runs AI actions for all AI players each tick.
 */
export function advanceState(
    state: GameState,
    ticks: number,
    _collector: DebugCollector
): GameState {
    let currentState = state;

    for (let i = 0; i < ticks; i++) {
        // Compute AI actions for all AI players
        for (const [playerIdStr, player] of Object.entries(currentState.players)) {
            if (player.isAi) {
                const playerId = parseInt(playerIdStr, 10);
                const actions = computeAiActions(currentState, playerId);
                for (const action of actions) {
                    currentState = update(currentState, action);
                }
            }
        }

        // Run game tick
        currentState = update(currentState, { type: 'TICK' });
    }

    return currentState;
}

/**
 * Advance game state until a trigger condition is met or max ticks reached.
 */
export function advanceUntil(
    state: GameState,
    triggerStr: string,
    maxTicks: number,
    _collector: DebugCollector
): AdvanceUntilResult {
    // Parse trigger
    let trigger: Trigger;
    try {
        trigger = parseTrigger(triggerStr);
    } catch (err) {
        return {
            state,
            reason: 'error',
            error: (err as Error).message
        };
    }

    // Check if trigger is already true
    if (evaluateTrigger(trigger, state)) {
        return { state, reason: 'trigger' };
    }

    let currentState = state;
    let ticksRun = 0;

    while (ticksRun < maxTicks) {
        // Compute AI actions for all AI players
        for (const [playerIdStr, player] of Object.entries(currentState.players)) {
            if (player.isAi) {
                const playerId = parseInt(playerIdStr, 10);
                const actions = computeAiActions(currentState, playerId);
                for (const action of actions) {
                    currentState = update(currentState, action);
                }
            }
        }

        // Run game tick
        currentState = update(currentState, { type: 'TICK' });
        ticksRun++;

        // Check trigger
        if (evaluateTrigger(trigger, currentState)) {
            return { state: currentState, reason: 'trigger' };
        }
    }

    return { state: currentState, reason: 'max-ticks' };
}

// ============================================================================
// Help System
// ============================================================================

const COMMAND_HELP: Record<string, { usage: string; description: string }> = {
    load: {
        usage: 'load <file>',
        description: 'Load game state from a JSON file. Resets AI state for AI players.'
    },
    save: {
        usage: 'save <file>',
        description: 'Save current game state to a JSON file.'
    },
    export: {
        usage: 'export <file>',
        description: 'Export collected events to a JSONL file.'
    },
    advance: {
        usage: 'advance [ticks]',
        description: 'Advance simulation by N ticks (default: 100).'
    },
    'advance-until': {
        usage: 'advance-until <condition>',
        description: 'Advance until trigger condition is met (max 100000 ticks).\nConditions: dead <id>, hp <id> <op> <n>%, tick <op> <n>, credits <player> <op> <n>, etc.'
    },
    track: {
        usage: 'track <entity-id>',
        description: 'Add entity to tracked entities filter.'
    },
    untrack: {
        usage: 'untrack <entity-id>',
        description: 'Remove entity from tracked entities filter.'
    },
    'track-player': {
        usage: 'track-player <player-id>',
        description: 'Add player to tracked players filter.'
    },
    'untrack-player': {
        usage: 'untrack-player <player-id>',
        description: 'Remove player from tracked players filter.'
    },
    filter: {
        usage: 'filter <category> on|off',
        description: 'Enable or disable an event category.\nCategories: command, decision, state-change, group, economy, production, threat'
    },
    threshold: {
        usage: 'threshold <name> <value>',
        description: 'Set a threshold value.\nNames: hp-below, credits-below, threat-above, economy-delta'
    },
    'clear-filters': {
        usage: 'clear-filters',
        description: 'Reset all filters to default configuration.'
    },
    status: {
        usage: 'status [player-id]',
        description: 'Show AI status for a player (default: first player).'
    },
    unit: {
        usage: 'unit <entity-id>',
        description: 'Show detailed information about a unit.'
    },
    groups: {
        usage: 'groups [player-id]',
        description: 'Show attack groups for a player.'
    },
    group: {
        usage: 'group [player-id]',
        description: 'Alias for groups command.'
    },
    find: {
        usage: 'find <query>',
        description: 'Find entities matching a query.\nFormat: key=value,key=value (e.g., owner=1,type=unit)'
    },
    events: {
        usage: 'events [count]',
        description: 'Show last N collected events (default: 20).'
    },
    'clear-events': {
        usage: 'clear-events',
        description: 'Clear all collected events.'
    },
    config: {
        usage: 'config',
        description: 'Show current filter configuration.'
    },
    help: {
        usage: 'help [command]',
        description: 'Show help for all commands or a specific command.'
    },
    quit: {
        usage: 'quit',
        description: 'Exit the REPL.'
    },
    exit: {
        usage: 'exit',
        description: 'Exit the REPL.'
    }
};

/**
 * Print help for all commands or a specific command.
 */
function printHelp(command?: string): void {
    if (command && COMMAND_HELP[command]) {
        const help = COMMAND_HELP[command];
        console.log(`\n${help.usage}`);
        console.log(`  ${help.description.replace(/\n/g, '\n  ')}`);
        console.log('');
    } else if (command) {
        console.log(`Unknown command: ${command}`);
        console.log('Type "help" to see all available commands.');
    } else {
        console.log('\nAvailable commands:\n');
        console.log('File Operations:');
        console.log('  load <file>              Load state from file');
        console.log('  save <file>              Save current state');
        console.log('  export <file>            Export events to JSONL');
        console.log('');
        console.log('Simulation:');
        console.log('  advance [ticks]          Advance N ticks (default: 100)');
        console.log('  advance-until <cond>     Advance until trigger fires');
        console.log('');
        console.log('Tracking:');
        console.log('  track <entity-id>        Add to tracked entities');
        console.log('  untrack <entity-id>      Remove from tracked');
        console.log('  track-player <id>        Add to tracked players');
        console.log('  untrack-player <id>      Remove from tracked players');
        console.log('');
        console.log('Filtering:');
        console.log('  filter <cat> on|off      Enable/disable category');
        console.log('  threshold <name> <val>   Set threshold');
        console.log('  clear-filters            Reset to defaults');
        console.log('');
        console.log('Queries:');
        console.log('  status [player-id]       Show AI status');
        console.log('  unit <entity-id>         Show unit details');
        console.log('  groups [player-id]       Show groups');
        console.log('  find <query>             Find entities');
        console.log('');
        console.log('Events:');
        console.log('  events [count]           Show last N events');
        console.log('  clear-events             Clear event log');
        console.log('');
        console.log('Meta:');
        console.log('  config                   Show current config');
        console.log('  help [command]           Show help');
        console.log('  quit / exit              Exit REPL');
        console.log('');
    }
}

// ============================================================================
// Command Handler
// ============================================================================

/**
 * Handle a single REPL command.
 * Returns true if the REPL should continue, false if it should exit.
 */
async function handleCommand(ctx: ReplContext, input: string): Promise<boolean> {
    const { cmd, args } = parseCommand(input);

    if (!cmd) {
        return true;
    }

    switch (cmd) {
        // ====================================================================
        // File Operations
        // ====================================================================
        case 'load': {
            if (args.length === 0) {
                console.log('Usage: load <file>');
                return true;
            }
            try {
                ctx.state = loadState(args[0]);
                ctx.startTick = ctx.state.tick;
                // Reset AI state for AI players
                for (const [playerIdStr, player] of Object.entries(ctx.state.players)) {
                    if (player.isAi) {
                        resetAIState(parseInt(playerIdStr, 10));
                    }
                }
                console.log(`Loaded state from ${args[0]} (tick ${ctx.state.tick})`);
            } catch (err) {
                console.log(`Error: ${(err as Error).message}`);
            }
            return true;
        }

        case 'save': {
            if (args.length === 0) {
                console.log('Usage: save <file>');
                return true;
            }
            if (!ctx.state) {
                console.log('Error: No state loaded');
                return true;
            }
            try {
                saveState(ctx.state, args[0]);
                console.log(`Saved state to ${args[0]} (tick ${ctx.state.tick})`);
            } catch (err) {
                console.log(`Error: ${(err as Error).message}`);
            }
            return true;
        }

        case 'export': {
            if (args.length === 0) {
                console.log('Usage: export <file>');
                return true;
            }
            if (!ctx.state) {
                console.log('Error: No state loaded');
                return true;
            }
            try {
                const jsonl = ctx.collector.exportToJsonl(ctx.startTick, ctx.state.tick);
                fs.writeFileSync(args[0], jsonl, 'utf8');
                const eventCount = ctx.collector.getEvents().length;
                console.log(`Exported ${eventCount} events to ${args[0]}`);
            } catch (err) {
                console.log(`Error: ${(err as Error).message}`);
            }
            return true;
        }

        // ====================================================================
        // Simulation
        // ====================================================================
        case 'advance': {
            if (!ctx.state) {
                console.log('Error: No state loaded');
                return true;
            }
            const ticks = args.length > 0 ? parseInt(args[0], 10) : 100;
            if (isNaN(ticks) || ticks < 0) {
                console.log('Error: Invalid tick count');
                return true;
            }
            const startTick = ctx.state.tick;
            console.log(`Advancing ${ticks} ticks from tick ${startTick}...`);
            ctx.state = advanceState(ctx.state, ticks, ctx.collector);
            console.log(`Advanced to tick ${ctx.state.tick}`);
            return true;
        }

        case 'advance-until': {
            if (!ctx.state) {
                console.log('Error: No state loaded');
                return true;
            }
            if (args.length === 0) {
                console.log('Usage: advance-until <condition>');
                return true;
            }
            const condition = args.join(' ');
            const startTick = ctx.state.tick;
            console.log(`Advancing until "${condition}"...`);
            const result = advanceUntil(ctx.state, condition, 100000, ctx.collector);
            ctx.state = result.state;

            if (result.reason === 'trigger') {
                console.log(`Trigger fired at tick ${ctx.state.tick} (${ctx.state.tick - startTick} ticks)`);
            } else if (result.reason === 'max-ticks') {
                console.log(`Reached max ticks (100000) without trigger at tick ${ctx.state.tick}`);
            } else {
                console.log(`Error: ${result.error}`);
            }
            return true;
        }

        // ====================================================================
        // Tracking
        // ====================================================================
        case 'track': {
            if (args.length === 0) {
                console.log('Usage: track <entity-id>');
                return true;
            }
            const config = ctx.collector.getConfig();
            config.trackedEntities.add(args[0]);
            ctx.collector.setConfig(config);
            console.log(`Now tracking entity: ${args[0]}`);
            return true;
        }

        case 'untrack': {
            if (args.length === 0) {
                console.log('Usage: untrack <entity-id>');
                return true;
            }
            const config = ctx.collector.getConfig();
            config.trackedEntities.delete(args[0]);
            ctx.collector.setConfig(config);
            console.log(`Stopped tracking entity: ${args[0]}`);
            return true;
        }

        case 'track-player': {
            if (args.length === 0) {
                console.log('Usage: track-player <player-id>');
                return true;
            }
            const playerId = parseInt(args[0], 10);
            if (isNaN(playerId)) {
                console.log('Error: Invalid player ID');
                return true;
            }
            const config = ctx.collector.getConfig();
            config.trackedPlayers.add(playerId);
            ctx.collector.setConfig(config);
            console.log(`Now tracking player: ${playerId}`);
            return true;
        }

        case 'untrack-player': {
            if (args.length === 0) {
                console.log('Usage: untrack-player <player-id>');
                return true;
            }
            const playerId = parseInt(args[0], 10);
            if (isNaN(playerId)) {
                console.log('Error: Invalid player ID');
                return true;
            }
            const config = ctx.collector.getConfig();
            config.trackedPlayers.delete(playerId);
            ctx.collector.setConfig(config);
            console.log(`Stopped tracking player: ${playerId}`);
            return true;
        }

        // ====================================================================
        // Filtering
        // ====================================================================
        case 'filter': {
            if (args.length < 2) {
                console.log('Usage: filter <category> on|off');
                return true;
            }
            const category = args[0] as keyof FilterConfig['categories'];
            const onOff = args[1].toLowerCase();

            const config = ctx.collector.getConfig();
            if (!(category in config.categories)) {
                console.log(`Unknown category: ${category}`);
                console.log('Valid categories: command, decision, state-change, group, economy, production, threat');
                return true;
            }

            if (onOff === 'on') {
                config.categories[category] = true;
                console.log(`Enabled category: ${category}`);
            } else if (onOff === 'off') {
                config.categories[category] = false;
                console.log(`Disabled category: ${category}`);
            } else {
                console.log('Error: Use "on" or "off"');
            }
            ctx.collector.setConfig(config);
            return true;
        }

        case 'threshold': {
            if (args.length < 2) {
                console.log('Usage: threshold <name> <value>');
                return true;
            }
            const name = args[0];
            const value = parseInt(args[1], 10);
            if (isNaN(value)) {
                console.log('Error: Invalid value');
                return true;
            }

            const config = ctx.collector.getConfig();
            switch (name) {
                case 'hp-below':
                    config.thresholds.hpBelow = value;
                    break;
                case 'credits-below':
                    config.thresholds.creditsBelow = value;
                    break;
                case 'threat-above':
                    config.thresholds.threatAbove = value;
                    break;
                case 'economy-delta':
                    config.thresholds.economyDelta = value;
                    break;
                default:
                    console.log(`Unknown threshold: ${name}`);
                    console.log('Valid thresholds: hp-below, credits-below, threat-above, economy-delta');
                    return true;
            }
            ctx.collector.setConfig(config);
            console.log(`Set ${name} = ${value}`);
            return true;
        }

        case 'clear-filters': {
            const defaultConfig = createDefaultFilterConfig();
            ctx.collector.setConfig(defaultConfig);
            console.log('Reset filters to defaults');
            return true;
        }

        // ====================================================================
        // Queries
        // ====================================================================
        case 'status': {
            if (!ctx.state) {
                console.log('Error: No state loaded');
                return true;
            }
            // Default to first player
            let playerId = 1;
            if (args.length > 0) {
                playerId = parseInt(args[0], 10);
                if (isNaN(playerId)) {
                    console.log('Error: Invalid player ID');
                    return true;
                }
            } else {
                // Find first player
                const playerIds = Object.keys(ctx.state.players).map(id => parseInt(id, 10));
                if (playerIds.length > 0) {
                    playerId = Math.min(...playerIds);
                }
            }
            console.log(formatStatus(ctx.state, playerId));
            return true;
        }

        case 'unit': {
            if (!ctx.state) {
                console.log('Error: No state loaded');
                return true;
            }
            if (args.length === 0) {
                console.log('Usage: unit <entity-id>');
                return true;
            }
            console.log(formatUnit(ctx.state, args[0]));
            return true;
        }

        case 'groups':
        case 'group': {
            if (!ctx.state) {
                console.log('Error: No state loaded');
                return true;
            }
            let playerId = 1;
            if (args.length > 0) {
                playerId = parseInt(args[0], 10);
                if (isNaN(playerId)) {
                    console.log('Error: Invalid player ID');
                    return true;
                }
            } else {
                // Find first AI player
                for (const [id, player] of Object.entries(ctx.state.players)) {
                    if (player.isAi) {
                        playerId = parseInt(id, 10);
                        break;
                    }
                }
            }
            console.log(formatGroups(playerId));
            return true;
        }

        case 'find': {
            if (!ctx.state) {
                console.log('Error: No state loaded');
                return true;
            }
            if (args.length === 0) {
                console.log('Usage: find <query>');
                console.log('Example: find owner=1,type=unit');
                return true;
            }
            console.log(formatFind(ctx.state, args.join(' ')));
            return true;
        }

        // ====================================================================
        // Events
        // ====================================================================
        case 'events': {
            const count = args.length > 0 ? parseInt(args[0], 10) : 20;
            if (isNaN(count) || count < 1) {
                console.log('Error: Invalid count');
                return true;
            }
            const events = ctx.collector.getEvents();
            if (events.length === 0) {
                console.log('No events collected');
            } else {
                console.log(formatEvents(events, count));
            }
            return true;
        }

        case 'clear-events': {
            ctx.collector.clear();
            console.log('Cleared all events');
            return true;
        }

        // ====================================================================
        // Meta
        // ====================================================================
        case 'config': {
            const config = ctx.collector.getConfig();
            console.log('\nCurrent Filter Configuration:\n');

            // Categories
            console.log('Categories:');
            for (const [cat, enabled] of Object.entries(config.categories)) {
                console.log(`  ${cat}: ${enabled ? 'on' : 'off'}`);
            }

            // Tracked entities
            console.log('\nTracked Entities:');
            if (config.trackedEntities.size === 0) {
                console.log('  (all)');
            } else {
                for (const id of config.trackedEntities) {
                    console.log(`  ${id}`);
                }
            }

            // Tracked players
            console.log('\nTracked Players:');
            if (config.trackedPlayers.size === 0) {
                console.log('  (all)');
            } else {
                for (const id of config.trackedPlayers) {
                    console.log(`  ${id}`);
                }
            }

            // Thresholds
            console.log('\nThresholds:');
            if (config.thresholds.hpBelow !== undefined) {
                console.log(`  hp-below: ${config.thresholds.hpBelow}%`);
            }
            if (config.thresholds.creditsBelow !== undefined) {
                console.log(`  credits-below: ${config.thresholds.creditsBelow}`);
            }
            if (config.thresholds.threatAbove !== undefined) {
                console.log(`  threat-above: ${config.thresholds.threatAbove}`);
            }
            if (config.thresholds.economyDelta !== undefined) {
                console.log(`  economy-delta: ${config.thresholds.economyDelta}`);
            }
            if (Object.values(config.thresholds).every(v => v === undefined)) {
                console.log('  (none)');
            }

            console.log(`\nSnapshot Interval: ${config.snapshotInterval}`);
            console.log('');
            return true;
        }

        case 'help': {
            printHelp(args[0]);
            return true;
        }

        case 'quit':
        case 'exit': {
            console.log('Goodbye!');
            return false;
        }

        default: {
            console.log(`Unknown command: ${cmd}`);
            console.log('Type "help" for a list of commands.');
            return true;
        }
    }
}

// ============================================================================
// REPL Entry Point
// ============================================================================

/**
 * Start the interactive REPL.
 */
export async function startRepl(
    initialState: GameState | null,
    collector: DebugCollector,
    _args: CliArgs
): Promise<void> {
    const ctx: ReplContext = {
        state: initialState,
        collector,
        startTick: initialState?.tick ?? 0
    };

    // Reset AI state for AI players in initial state
    if (ctx.state) {
        for (const [playerIdStr, player] of Object.entries(ctx.state.players)) {
            if (player.isAi) {
                resetAIState(parseInt(playerIdStr, 10));
            }
        }
    }

    console.log('Debug REPL started. Type "help" for commands.');
    if (ctx.state) {
        console.log(`State loaded at tick ${ctx.state.tick}`);
    } else {
        console.log('No state loaded. Use "load <file>" to load a state.');
    }
    console.log('');

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: 'debug> '
    });

    rl.prompt();

    return new Promise<void>((resolve) => {
        rl.on('line', async (line) => {
            const shouldContinue = await handleCommand(ctx, line);
            if (!shouldContinue) {
                rl.close();
            } else {
                rl.prompt();
            }
        });

        rl.on('close', () => {
            resolve();
        });
    });
}

/**
 * CLI argument parsing for the debug tool.
 *
 * Parses command line arguments and builds filter configurations
 * for the debug collector.
 */

import { FilterConfig, createDefaultFilterConfig } from './collector.js';

// ============================================================================
// Type Definitions
// ============================================================================

export interface CliArgs {
    input: string | null;
    output: string | null;
    export: string | null;
    advance: number;
    advanceUntil: string | null;
    maxTicks: number;
    repl: boolean;
    // Query flags
    status: number | null;
    unit: string | null;
    find: string | null;
    listGroups: number | null;
    // Filter configuration
    track: string[];
    player: number[];
    category: string[];
    noCategory: string[];
    changeOnly: string[];
    threshold: Record<string, number>;
    snapshotInterval: number;
}

// ============================================================================
// Argument Parser
// ============================================================================

/**
 * Parse command line arguments into a CliArgs object.
 *
 * @param argv - Command line arguments (without node and script path)
 * @returns Parsed CLI arguments
 * @throws Error if invalid arguments are provided
 */
export function parseArgs(argv: string[]): CliArgs {
    const args: CliArgs = {
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
    };

    let i = 0;
    while (i < argv.length) {
        const arg = argv[i];

        switch (arg) {
            // File arguments
            case '--input':
                args.input = requireStringValue(argv, i, '--input');
                i += 2;
                break;

            case '--output':
                args.output = requireStringValue(argv, i, '--output');
                i += 2;
                break;

            case '--export':
                args.export = requireStringValue(argv, i, '--export');
                i += 2;
                break;

            // Simulation arguments
            case '--advance':
                args.advance = requireNumberValue(argv, i, '--advance');
                i += 2;
                break;

            case '--advance-until':
                args.advanceUntil = requireStringValue(argv, i, '--advance-until');
                i += 2;
                break;

            case '--max-ticks':
                args.maxTicks = requireNumberValue(argv, i, '--max-ticks');
                i += 2;
                break;

            case '--repl':
                args.repl = true;
                i += 1;
                break;

            // Query arguments
            case '--status':
                args.status = requireNumberValue(argv, i, '--status');
                i += 2;
                break;

            case '--unit':
                args.unit = requireStringValue(argv, i, '--unit');
                i += 2;
                break;

            case '--find':
                args.find = requireStringValue(argv, i, '--find');
                i += 2;
                break;

            case '--list-groups':
                args.listGroups = requireNumberValue(argv, i, '--list-groups');
                i += 2;
                break;

            // Filter arguments (repeatable)
            case '--track':
                args.track.push(requireStringValue(argv, i, '--track'));
                i += 2;
                break;

            case '--player':
                args.player.push(requireNumberValue(argv, i, '--player'));
                i += 2;
                break;

            // Filter arguments (comma-separated)
            case '--category':
                args.category = parseCommaSeparated(requireStringValue(argv, i, '--category'));
                i += 2;
                break;

            case '--no-category':
                args.noCategory = parseCommaSeparated(requireStringValue(argv, i, '--no-category'));
                i += 2;
                break;

            case '--change-only':
                args.changeOnly = parseCommaSeparated(requireStringValue(argv, i, '--change-only'));
                i += 2;
                break;

            // Threshold arguments
            case '--threshold':
                parseThreshold(requireStringValue(argv, i, '--threshold'), args.threshold);
                i += 2;
                break;

            case '--snapshot-interval':
                args.snapshotInterval = requireNumberValue(argv, i, '--snapshot-interval');
                i += 2;
                break;

            case '--help':
                printHelp();
                process.exit(0);
                break;

            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return args;
}

/**
 * Get required string value for an argument.
 */
function requireStringValue(argv: string[], index: number, argName: string): string {
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) {
        throw new Error(`Missing value for ${argName}`);
    }
    return argv[index + 1];
}

/**
 * Get required number value for an argument.
 */
function requireNumberValue(argv: string[], index: number, argName: string): number {
    const str = requireStringValue(argv, index, argName);
    const num = parseInt(str, 10);
    if (isNaN(num)) {
        throw new Error(`Invalid number for ${argName}: ${str}`);
    }
    return num;
}

/**
 * Parse comma-separated values into an array.
 */
function parseCommaSeparated(value: string): string[] {
    return value.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

/**
 * Parse threshold argument (name=value format) into thresholds object.
 */
function parseThreshold(value: string, thresholds: Record<string, number>): void {
    const match = value.match(/^([a-z-]+)=(\d+)$/);
    if (!match) {
        throw new Error(`Invalid threshold format: ${value} (expected name=value)`);
    }
    thresholds[match[1]] = parseInt(match[2], 10);
}

// ============================================================================
// Filter Config Builder
// ============================================================================

/**
 * Convert CLI arguments to a FilterConfig for the DebugCollector.
 *
 * @param args - Parsed CLI arguments
 * @returns FilterConfig for the collector
 */
export function buildFilterConfig(args: CliArgs): FilterConfig {
    const config = createDefaultFilterConfig();

    // Handle categories
    if (args.category.length > 0) {
        // If --category is specified, disable all categories first
        for (const key of Object.keys(config.categories)) {
            config.categories[key as keyof typeof config.categories] = false;
        }
        // Then enable only the specified categories
        for (const cat of args.category) {
            if (cat in config.categories) {
                config.categories[cat as keyof typeof config.categories] = true;
            }
        }
    } else if (args.noCategory.length > 0) {
        // If only --no-category is specified, disable those categories
        for (const cat of args.noCategory) {
            if (cat in config.categories) {
                config.categories[cat as keyof typeof config.categories] = false;
            }
        }
    }

    // Tracked entities
    if (args.track.length > 0) {
        config.trackedEntities = new Set(args.track);
    }

    // Tracked players
    if (args.player.length > 0) {
        config.trackedPlayers = new Set(args.player);
    }

    // Change-only configuration
    // Reset all to false first, then enable specified ones
    config.changeOnly.economy = false;
    config.changeOnly.threat = false;
    config.changeOnly.strategy = false;

    for (const item of args.changeOnly) {
        if (item === 'economy') {
            config.changeOnly.economy = true;
        } else if (item === 'threat') {
            config.changeOnly.threat = true;
        } else if (item === 'strategy') {
            config.changeOnly.strategy = true;
        }
    }

    // Thresholds
    if (args.threshold['hp-below'] !== undefined) {
        config.thresholds.hpBelow = args.threshold['hp-below'];
    }
    if (args.threshold['credits-below'] !== undefined) {
        config.thresholds.creditsBelow = args.threshold['credits-below'];
    }
    if (args.threshold['threat-above'] !== undefined) {
        config.thresholds.threatAbove = args.threshold['threat-above'];
    }
    if (args.threshold['economy-delta'] !== undefined) {
        config.thresholds.economyDelta = args.threshold['economy-delta'];
    }

    // Snapshot interval
    config.snapshotInterval = args.snapshotInterval;

    return config;
}

// ============================================================================
// Help
// ============================================================================

/**
 * Print usage help to console.
 */
export function printHelp(): void {
    console.log(`
Debug Tool - RTS Game State Debugger

USAGE:
  npm run debug -- [OPTIONS]

FILE OPTIONS:
  --input <file>          Load game state from JSON file
  --output <file>         Save game state to JSON file after simulation
  --export <file>         Export collected events to JSONL file

SIMULATION OPTIONS:
  --advance <ticks>       Advance simulation by N ticks
  --advance-until <cond>  Advance until condition is met
  --max-ticks <n>         Safety limit for advance-until (default: 100000)
  --repl                  Start interactive REPL mode

QUERY OPTIONS:
  --status <player-id>    Show AI status for player
  --unit <entity-id>      Show detailed unit information
  --find <query>          Find entities matching query
  --list-groups <player>  List attack groups for player

FILTER OPTIONS:
  --track <entity-id>     Track specific entity (repeatable)
  --player <player-id>    Track specific player (repeatable)
  --category <cat,...>    Enable only these categories (comma-separated)
  --no-category <cat,...> Disable these categories (comma-separated)
  --change-only <cat,...> Only log when value changes
  --threshold <n>=<v>     Set threshold (repeatable)
  --snapshot-interval <n> Ticks between snapshots (default: 100)

CATEGORIES:
  command, decision, state-change, group, economy, production, threat

THRESHOLDS:
  hp-below=<percent>      Log HP changes below threshold
  credits-below=<amount>  Log credits below threshold
  threat-above=<level>    Log threat above threshold
  economy-delta=<amount>  Minimum economy change to log

TRIGGER CONDITIONS (for --advance-until):
  dead <entity-id>                    Entity is dead
  hp <entity-id> <op> <percent>%      HP comparison (e.g., "hp unit-1 < 50%")
  tick <op> <n>                       Tick comparison (e.g., "tick >= 1000")
  credits <player> <op> <amount>      Credits comparison
  strategy <player> == <strategy>     AI strategy match
  count <player> <type> <op> <n>      Entity count comparison
  player <id> dead                    Player eliminated
  threat <player> <op> <level>        Threat level comparison
  area <x>,<y>,<r> has <entity-id>    Entity within radius of point

  Operators: <, >, <=, >=, ==
  Multiple conditions can be combined with "or"

EXAMPLES:
  # Load state and show AI status
  npm run debug -- --input state.json --status 1

  # Advance simulation by 1000 ticks
  npm run debug -- --input state.json --advance 1000 --output out.json

  # Advance until unit dies, tracking specific entities
  npm run debug -- --input state.json --advance-until "dead unit-123" \\
                   --track unit-123 --export events.jsonl

  # Start REPL for interactive debugging
  npm run debug -- --input state.json --repl
`);
}

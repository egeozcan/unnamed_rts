/**
 * AI vs AI Simulation Script
 * Runs multiple headless games between two AI implementations and reports win rates.
 *
 * Usage:
 *   npx tsx src/scripts/simulate_ai.ts [--games N] [--ai1 id] [--ai2 id] [--difficulty d] [--max-ticks N] [--map-size s] [--legacy-turn-order] [--seed N] [--benchmark]
 *
 * Defaults:
 *   --games 10 --ai1 classic --ai2 infantry_fortress --difficulty hard --max-ticks 40000 --map-size medium
 */

import { deriveGameSeed, withSeededRandom, createGameState, runGame } from './sim_runner.js';

// Ensure AI implementations are registered
import '../engine/ai/registry.js';

interface SimConfig {
    games: number;
    ai1: string;
    ai2: string;
    difficulty: 'easy' | 'medium' | 'hard';
    maxTicks: number;
    mapSize: 'small' | 'medium' | 'large' | 'huge';
    resourceDensity: 'low' | 'medium' | 'high';
    rockDensity: 'low' | 'medium' | 'high';
    verbose: boolean;
    fairTurnOrder: boolean;
    seed: number | null;
    benchmark: boolean;
    benchmarkRuns: number;
    benchmarkWarmup: number;
}



function parseArgs() {
    const args = process.argv.slice(2);
    const config: SimConfig = {
        games: 10,
        ai1: 'classic',
        ai2: 'infantry_fortress',
        difficulty: 'hard' as 'easy' | 'medium' | 'hard',
        maxTicks: 40000,
        mapSize: 'medium' as 'small' | 'medium' | 'large' | 'huge',
        resourceDensity: 'medium' as 'low' | 'medium' | 'high',
        rockDensity: 'medium' as 'low' | 'medium' | 'high',
        verbose: false,
        fairTurnOrder: true,
        seed: null,
        benchmark: false,
        benchmarkRuns: 8,
        benchmarkWarmup: 2,
    };

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--games') config.games = parseInt(args[++i], 10);
        else if (arg === '--ai1') config.ai1 = args[++i];
        else if (arg === '--ai2') config.ai2 = args[++i];
        else if (arg === '--difficulty') config.difficulty = args[++i] as typeof config.difficulty;
        else if (arg === '--max-ticks') config.maxTicks = parseInt(args[++i], 10);
        else if (arg === '--map-size') config.mapSize = args[++i] as typeof config.mapSize;
        else if (arg === '--resource-density') config.resourceDensity = args[++i] as typeof config.resourceDensity;
        else if (arg === '--rock-density') config.rockDensity = args[++i] as typeof config.rockDensity;
        else if (arg === '--verbose' || arg === '-v') config.verbose = true;
        else if (arg === '--legacy-turn-order') config.fairTurnOrder = false;
        else if (arg === '--seed') config.seed = parseInt(args[++i], 10);
        else if (arg === '--benchmark') config.benchmark = true;
        else if (arg === '--benchmark-runs') config.benchmarkRuns = parseInt(args[++i], 10);
        else if (arg === '--benchmark-warmup') config.benchmarkWarmup = parseInt(args[++i], 10);
        else if (arg === '--help') {
            console.log(`
AI vs AI Simulation

Usage:
  --games <N>              Number of games to simulate (default: 10)
  --ai1 <id>               First AI implementation ID (default: classic)
  --ai2 <id>               Second AI implementation ID (default: infantry_fortress)
  --difficulty <d>          AI difficulty: easy, medium, hard (default: hard)
  --max-ticks <N>           Max ticks per game before draw (default: 40000)
  --map-size <s>            Map size: small, medium, large, huge (default: medium)
  --resource-density <d>    Resource density: low, medium, high (default: medium)
  --rock-density <d>        Rock density: low, medium, high (default: medium)
  --seed <N>                Deterministic RNG seed (default: random)
  --benchmark               Run deterministic performance benchmark mode
  --benchmark-runs <N>      Measured benchmark runs (default: 8)
  --benchmark-warmup <N>    Warmup runs before timing (default: 2)
  --legacy-turn-order       Use old sequential action order (higher bias)
  --verbose, -v             Print per-tick progress
`);
            process.exit(0);
        }
    }
    return config;
}



interface SimulationSummary {
    ai1Wins: number;
    ai2Wins: number;
    draws: number;
    tickCounts: number[];
    elapsedMs: number;
}



function runSimulationSeries(config: SimConfig, printPerGame: boolean): SimulationSummary {
    let ai1Wins = 0;
    let ai2Wins = 0;
    let draws = 0;
    const tickCounts: number[] = [];
    const seriesStartNs = process.hrtime.bigint();

    for (let game = 0; game < config.games; game++) {
        const runOneGame = () => {
            const state = createGameState(
                config.ai1, config.ai2,
                config.difficulty, config.mapSize,
                config.resourceDensity, config.rockDensity
            );
            const gameStartNs = process.hrtime.bigint();
            const result = runGame(state, config.maxTicks, config.verbose, game, config.fairTurnOrder);
            const elapsedMs = Number(process.hrtime.bigint() - gameStartNs) / 1_000_000;
            return { result, elapsedMs };
        };

        const gameSeed = config.seed === null ? null : deriveGameSeed(config.seed, game);
        const { result, elapsedMs } = gameSeed === null
            ? runOneGame()
            : withSeededRandom(gameSeed, runOneGame);

        tickCounts.push(result.ticks);

        if (result.winner === 0) {
            ai1Wins++;
            if (printPerGame) {
                console.log(`Game ${game + 1}: ${config.ai1} wins at tick ${result.ticks} (${(elapsedMs / 1000).toFixed(1)}s)`);
            }
        } else if (result.winner === 1) {
            ai2Wins++;
            if (printPerGame) {
                console.log(`Game ${game + 1}: ${config.ai2} wins at tick ${result.ticks} (${(elapsedMs / 1000).toFixed(1)}s)`);
            }
        } else {
            draws++;
            if (printPerGame) {
                console.log(`Game ${game + 1}: ${result.reason} at tick ${result.ticks} (${(elapsedMs / 1000).toFixed(1)}s)`);
            }
        }
    }

    const elapsedMs = Number(process.hrtime.bigint() - seriesStartNs) / 1_000_000;
    return { ai1Wins, ai2Wins, draws, tickCounts, elapsedMs };
}

function mean(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return (sorted[mid - 1] + sorted[mid]) / 2;
    }
    return sorted[mid];
}

function stddev(values: number[]): number {
    if (values.length <= 1) return 0;
    const avg = mean(values);
    const variance = mean(values.map(v => (v - avg) ** 2));
    return Math.sqrt(variance);
}

function main() {
    const config = parseArgs();
    const effectiveSeed = config.seed ?? (config.benchmark ? 1337 : null);
    const runConfig: SimConfig = {
        ...config,
        seed: effectiveSeed
    };

    console.log(`\nAI vs AI Simulation`);
    console.log(`==================`);
    console.log(`AI 1 (Player 0): ${runConfig.ai1}`);
    console.log(`AI 2 (Player 1): ${runConfig.ai2}`);
    console.log(`Difficulty: ${runConfig.difficulty}`);
    console.log(`Games: ${runConfig.games}`);
    console.log(`Max ticks: ${runConfig.maxTicks}`);
    console.log(`Map: ${runConfig.mapSize}, resources: ${runConfig.resourceDensity}, rocks: ${runConfig.rockDensity}`);
    console.log(`Turn order: ${runConfig.fairTurnOrder ? 'fair (interleaved + rotating)' : 'legacy (sequential)'}`);
    if (runConfig.seed !== null) {
        console.log(`Seed: ${runConfig.seed}${config.seed === null && config.benchmark ? ' (benchmark default)' : ''}`);
    }
    console.log(`---`);

    if (runConfig.benchmark) {
        const warmupRuns = Math.max(0, runConfig.benchmarkWarmup);
        const measuredRuns = Math.max(1, runConfig.benchmarkRuns);
        const totalTicksPerSeries = runConfig.games * runConfig.maxTicks;
        console.log(`Benchmark: ${warmupRuns} warmup + ${measuredRuns} measured run(s)`);

        for (let i = 0; i < warmupRuns; i++) {
            runSimulationSeries(runConfig, false);
            console.log(`Warmup ${i + 1}/${warmupRuns} complete`);
        }

        const runTimesMs: number[] = [];
        const runTicksPerSec: number[] = [];

        for (let i = 0; i < measuredRuns; i++) {
            const summary = runSimulationSeries(runConfig, false);
            const ticks = summary.tickCounts.reduce((a, b) => a + b, 0);
            const ticksPerSec = ticks / (summary.elapsedMs / 1000);
            runTimesMs.push(summary.elapsedMs);
            runTicksPerSec.push(ticksPerSec);
            console.log(`Run ${i + 1}/${measuredRuns}: ${(summary.elapsedMs / 1000).toFixed(3)}s, ${ticksPerSec.toFixed(0)} ticks/s`);
        }

        console.log(`\n==================`);
        console.log(`Benchmark Results:`);
        console.log(`  Mean time: ${(mean(runTimesMs) / 1000).toFixed(3)}s`);
        console.log(`  Median time: ${(median(runTimesMs) / 1000).toFixed(3)}s`);
        console.log(`  Std dev: ${(stddev(runTimesMs) / 1000).toFixed(3)}s`);
        console.log(`  Mean throughput: ${mean(runTicksPerSec).toFixed(0)} ticks/s`);
        console.log(`  Median throughput: ${median(runTicksPerSec).toFixed(0)} ticks/s`);
        console.log(`  Workload size: up to ${totalTicksPerSeries} ticks/run`);
        console.log();
        return;
    }

    const summary = runSimulationSeries(runConfig, true);
    const { ai1Wins, ai2Wins, draws, tickCounts } = summary;

    console.log(`\n==================`);
    console.log(`Results:`);
    console.log(`  ${runConfig.ai1}: ${ai1Wins} wins (${(ai1Wins / runConfig.games * 100).toFixed(1)}%)`);
    console.log(`  ${runConfig.ai2}: ${ai2Wins} wins (${(ai2Wins / runConfig.games * 100).toFixed(1)}%)`);
    console.log(`  Draws/Timeouts: ${draws} (${(draws / runConfig.games * 100).toFixed(1)}%)`);

    const avgTicks = tickCounts.reduce((a, b) => a + b, 0) / tickCounts.length;
    console.log(`  Avg game length: ${Math.round(avgTicks)} ticks`);
    console.log();
}

main();

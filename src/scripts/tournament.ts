import { getAIImplementations } from '../engine/ai/registry.js';
import { exec } from 'child_process';
import util from 'util';
import os from 'os';

const execPromise = util.promisify(exec);

interface TournamentConfig {
    gamesPerMatchup: number;
    maxTicks: number;
    mapSize: 'small' | 'medium' | 'large' | 'huge';
    difficulty: 'easy' | 'medium' | 'hard';
    seed: number | null;
}

function parseArgs(): TournamentConfig {
    const args = process.argv.slice(2);
    const config: TournamentConfig = {
        gamesPerMatchup: 2, // 2 games per side per matchup (4 total for each pair)
        maxTicks: 40000,
        mapSize: 'medium',
        difficulty: 'hard',
        seed: null,
    };
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--games-per-matchup') config.gamesPerMatchup = parseInt(args[++i], 10);
        else if (arg === '--max-ticks') config.maxTicks = parseInt(args[++i], 10);
        else if (arg === '--seed') config.seed = parseInt(args[++i], 10);
    }
    return config;
}

function getEloExpected(ratingA: number, ratingB: number): number {
    return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

function updateElo(ratingA: number, ratingB: number, scoreA: number): [number, number] {
    const k = 32;
    const expectedA = getEloExpected(ratingA, ratingB);
    const expectedB = getEloExpected(ratingB, ratingA);
    const newRatingA = ratingA + k * (scoreA - expectedA);
    const newRatingB = ratingB + k * ((1 - scoreA) - expectedB);
    return [newRatingA, newRatingB];
}

async function main() {
    const config = parseArgs();
    const implementations = getAIImplementations();
    const elos: Record<string, number> = {};
    const stats: Record<string, { wins: number, losses: number, draws: number }> = {};

    for (const ai of implementations) {
        elos[ai.id] = 1200;
        stats[ai.id] = { wins: 0, losses: 0, draws: 0 };
    }

    console.log(`Starting AI Tournament...`);
    console.log(`Participants: ${implementations.map(a => a.id).join(', ')}`);
    console.log(`Games per Matchup (each side): ${config.gamesPerMatchup}`);
    console.log(`Max ticks: ${config.maxTicks}`);
    console.log(`==========================================`);

    const pairs: [string, string][] = [];
    for (let i = 0; i < implementations.length; i++) {
        for (let j = i + 1; j < implementations.length; j++) {
            pairs.push([implementations[i].id, implementations[j].id]);
        }
    }

    let gameCounter = 0;
    const effectiveSeed = config.seed ?? Math.floor(Math.random() * 1000000);

    const tasks: (() => Promise<void>)[] = [];
    const results: any[] = [];

    for (const [ai1, ai2] of pairs) {
        for (let side = 0; side < 2; side++) {
            const p0_ai = side === 0 ? ai1 : ai2;
            const p1_ai = side === 0 ? ai2 : ai1;

            for (let g = 0; g < config.gamesPerMatchup; g++) {
                gameCounter++;
                const gc = gameCounter;

                tasks.push(async () => {
                    const cmd = `npx tsx src/scripts/run_match.ts ${p0_ai} ${p1_ai} ${config.difficulty} ${config.mapSize} ${config.maxTicks} ${gc} ${effectiveSeed}`;
                    try {
                        const { stdout } = await execPromise(cmd);
                        const lines = stdout.trim().split('\n');
                        const result = JSON.parse(lines[lines.length - 1]);
                        results.push({ p0_ai, p1_ai, gameCounter: gc, result });
                    } catch (e) {
                        console.error(`Failed game ${gc} (${p0_ai} vs ${p1_ai}):`, e);
                    }
                });
            }
        }
    }

    const totalGames = tasks.length;
    const concurrency = Math.max(1, os.cpus().length - 1);
    console.log(`Running ${totalGames} games with concurrency ${concurrency}...`);

    let completed = 0;
    async function worker() {
        while (tasks.length > 0) {
            const task = tasks.shift()!;
            await task();
            completed++;
            process.stdout.write(`\rCompleted ${completed}/${totalGames} games`);
        }
    }

    const workers: Promise<void>[] = [];
    for (let i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);
    console.log(`\n\nCalculating Elo Ratings...`);

    // Sort to ensure deterministic Elo assignments based on original match ordering
    results.sort((a, b) => a.gameCounter - b.gameCounter);

    for (const { p0_ai, p1_ai, gameCounter, result } of results) {
        let score0 = 0.5; // Draw
        let winner = result.winner;
        let isTiebreak = false;

        if (winner === null && result.scores) {
            const scoreA = result.scores[0] || 0;
            const scoreB = result.scores[1] || 0;
            if (scoreA > scoreB) {
                winner = 0;
                isTiebreak = true;
            } else if (scoreB > scoreA) {
                winner = 1;
                isTiebreak = true;
            }
        }

        if (winner === 0) {
            score0 = 1;
            stats[p0_ai].wins++;
            stats[p1_ai].losses++;
        } else if (winner === 1) {
            score0 = 0;
            stats[p0_ai].losses++;
            stats[p1_ai].wins++;
        } else {
            stats[p0_ai].draws++;
            stats[p1_ai].draws++;
        }

        const [newR0, newR1] = updateElo(elos[p0_ai], elos[p1_ai], score0);
        elos[p0_ai] = newR0;
        elos[p1_ai] = newR1;

        const resultStr = winner === 0 ? `${p0_ai} won${isTiebreak ? ' (tiebreak)' : ''}` : winner === 1 ? `${p1_ai} won${isTiebreak ? ' (tiebreak)' : ''}` : 'Draw';
        console.log(`  Game ${gameCounter}: ${resultStr} in ${result.ticks} ticks (Elo: ${p0_ai} ${Math.round(newR0)}, ${p1_ai} ${Math.round(newR1)})`);
    }

    console.log(`\n==========================================`);
    console.log(`Tournament Complete! Final Standings:`);

    const leaderboard = Object.keys(elos).map(id => ({
        id,
        elo: elos[id],
        wins: stats[id].wins,
        losses: stats[id].losses,
        draws: stats[id].draws
    })).sort((a, b) => b.elo - a.elo);

    const padStr = (str: string, length: number) => str + ' '.repeat(Math.max(0, length - str.length));

    console.log(`${padStr("Rank", 6)} ${padStr("Elo", 6)} ${padStr("W-L-D", 10)} AI Implementation`);
    leaderboard.forEach((entry, idx) => {
        const rankStr = `${idx + 1}`;
        const eloStr = `${Math.round(entry.elo)}`;
        const recStr = `${entry.wins}-${entry.losses}-${entry.draws}`;
        console.log(`${padStr(rankStr, 6)} ${padStr(eloStr, 6)} ${padStr(recStr, 10)} ${entry.id}`);
    });
}

main();

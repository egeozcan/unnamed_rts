/**
 * AI vs AI Simulation Script
 * Runs multiple headless games between two AI implementations and reports win rates.
 *
 * Usage:
 *   npx tsx src/scripts/simulate_ai.ts [--games N] [--ai1 id] [--ai2 id] [--difficulty d] [--max-ticks N] [--map-size s] [--legacy-turn-order]
 *
 * Defaults:
 *   --games 10 --ai1 classic --ai2 infantry_fortress --difficulty hard --max-ticks 30000 --map-size medium
 */

import { GameState, Vector, PlayerState, BuildingEntity, HarvesterUnit, Action } from '../engine/types.js';
import { INITIAL_STATE, update, createPlayerState, tick } from '../engine/reducer.js';
import { computeAiActions, resetAIState } from '../engine/ai/index.js';
import { generateMap, getStartingPositions } from '../game-utils.js';

// Ensure AI implementations are registered
import '../engine/ai/registry.js';

function parseArgs() {
    const args = process.argv.slice(2);
    const config = {
        games: 10,
        ai1: 'classic',
        ai2: 'infantry_fortress',
        difficulty: 'hard' as 'easy' | 'medium' | 'hard',
        maxTicks: 30000,
        mapSize: 'medium' as 'small' | 'medium' | 'large' | 'huge',
        resourceDensity: 'medium' as 'low' | 'medium' | 'high',
        rockDensity: 'medium' as 'low' | 'medium' | 'high',
        verbose: false,
        fairTurnOrder: true,
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
        else if (arg === '--help') {
            console.log(`
AI vs AI Simulation

Usage:
  --games <N>              Number of games to simulate (default: 10)
  --ai1 <id>               First AI implementation ID (default: classic)
  --ai2 <id>               Second AI implementation ID (default: infantry_fortress)
  --difficulty <d>          AI difficulty: easy, medium, hard (default: hard)
  --max-ticks <N>           Max ticks per game before draw (default: 30000)
  --map-size <s>            Map size: small, medium, large, huge (default: medium)
  --resource-density <d>    Resource density: low, medium, high (default: medium)
  --rock-density <d>        Rock density: low, medium, high (default: medium)
  --legacy-turn-order       Use old sequential action order (higher bias)
  --verbose, -v             Print per-tick progress
`);
            process.exit(0);
        }
    }
    return config;
}

function createGameState(
    ai1Id: string,
    ai2Id: string,
    difficulty: 'easy' | 'medium' | 'hard',
    mapSize: 'small' | 'medium' | 'large' | 'huge',
    resourceDensity: 'low' | 'medium' | 'high',
    rockDensity: 'low' | 'medium' | 'high'
): GameState {
    const config = {
        players: [
            { slot: 0, type: difficulty as string, color: '#4488ff', aiImplementationId: ai1Id },
            { slot: 1, type: difficulty as string, color: '#ff4444', aiImplementationId: ai2Id },
        ] as any,
        mapSize,
        resourceDensity,
        rockDensity,
    };

    const { entities, mapWidth, mapHeight } = generateMap(config);
    const positions = getStartingPositions(mapWidth, mapHeight, 2);

    // Create players
    const players: Record<number, PlayerState> = {
        0: createPlayerState(0, true, difficulty, '#4488ff', ai1Id),
        1: createPlayerState(1, true, difficulty, '#ff4444', ai2Id),
    };

    // Create base entities for each player (mirroring game.ts startGameWithConfig)
    for (let slot = 0; slot < 2; slot++) {
        const pos = positions[slot];

        // Construction Yard
        const cyId = `cy_p${slot}`;
        const conyardEntity: BuildingEntity = {
            id: cyId, owner: slot, type: 'BUILDING', key: 'conyard',
            pos, prevPos: pos,
            hp: 3000, maxHp: 3000, w: 90, h: 90, radius: 45, dead: false,
            building: { isRepairing: false, placedTick: 0 }
        };
        entities[cyId] = conyardEntity;

        // Harvester
        const harvId = `harv_p${slot}`;
        const harvPos = pos.add(new Vector(80, 50));
        const harvesterEntity: HarvesterUnit = {
            id: harvId, owner: slot, type: 'UNIT', key: 'harvester',
            pos: harvPos, prevPos: harvPos,
            hp: 1000, maxHp: 1000, w: 35, h: 35, radius: 17, dead: false,
            movement: {
                vel: new Vector(0, 0), rotation: 0,
                moveTarget: null, path: null, pathIdx: 0,
                finalDest: null, stuckTimer: 0,
                unstuckDir: null, unstuckTimer: 0
            },
            combat: {
                targetId: null, lastAttackerId: null,
                cooldown: 0, flash: 0, turretAngle: 0
            },
            harvester: {
                cargo: 0, resourceTargetId: null, baseTargetId: null
            }
        };
        entities[harvId] = harvesterEntity;
    }

    return {
        ...INITIAL_STATE,
        running: true,
        mode: 'demo',
        difficulty: 'easy',
        headless: true,
        entities,
        players,
        config: { width: mapWidth, height: mapHeight, resourceDensity, rockDensity },
    };
}

interface GameResult {
    winner: number | null; // 0, 1, or null (draw/timeout)
    ticks: number;
    reason: string;
}

function runGame(
    state: GameState,
    maxTicks: number,
    verbose: boolean,
    gameIndex: number,
    fairTurnOrder: boolean
): GameResult {
    // Pre-compute player IDs to avoid Object.keys() + parseInt() every tick
    const playerIds = Object.keys(state.players).map(s => parseInt(s, 10));

    resetAIState(0);
    resetAIState(1);

    for (let t = 0; t < maxTicks; t++) {
        if (!fairTurnOrder) {
            // Legacy behavior: fixed player order and immediate application.
            for (const pid of playerIds) {
                const player = state.players[pid];
                if (player?.isAi) {
                    const aiActions = computeAiActions(state, pid);
                    for (const action of aiActions) {
                        state = update(state, action);
                    }
                }
            }
        } else {
            // Bias-reduced behavior:
            // 1) All players decide from the same state snapshot.
            // 2) Actions are interleaved in a rotating initiative order.
            const actionListsByPlayer = new Map<number, Action[]>();
            for (const pid of playerIds) {
                const player = state.players[pid];
                if (!player?.isAi) continue;
                actionListsByPlayer.set(pid, computeAiActions(state, pid));
            }

            const activePlayerIds = playerIds.filter(pid => actionListsByPlayer.has(pid));
            if (activePlayerIds.length > 0) {
                const startIdx = (gameIndex + t) % activePlayerIds.length;
                const orderedPlayerIds = activePlayerIds
                    .slice(startIdx)
                    .concat(activePlayerIds.slice(0, startIdx));

                let maxActions = 0;
                for (const pid of orderedPlayerIds) {
                    const count = actionListsByPlayer.get(pid)?.length ?? 0;
                    if (count > maxActions) maxActions = count;
                }

                for (let actionIndex = 0; actionIndex < maxActions; actionIndex++) {
                    for (const pid of orderedPlayerIds) {
                        const actions = actionListsByPlayer.get(pid);
                        if (!actions || actionIndex >= actions.length) continue;
                        state = update(state, actions[actionIndex]);
                    }
                }
            }
        }

        // Tick the game
        state = tick(state);

        if (verbose && t % 1000 === 0 && t > 0) {
            // Single-pass entity counting
            const units = [0, 0];
            const buildings = [0, 0];
            for (const id in state.entities) {
                const e = state.entities[id];
                if (e.dead) continue;
                if (e.owner !== 0 && e.owner !== 1) continue;
                if (e.type === 'UNIT') units[e.owner]++;
                else if (e.type === 'BUILDING') buildings[e.owner]++;
            }
            process.stdout.write(
                `  t=${t}: P0(${state.players[0]?.credits ?? 0}cr,${units[0]}u,${buildings[0]}b) P1(${state.players[1]?.credits ?? 0}cr,${units[1]}u,${buildings[1]}b)\n`
            );
        }

        // Check for winner
        if (state.winner !== null) {
            return {
                winner: state.winner === -1 ? null : state.winner,
                ticks: state.tick,
                reason: state.winner === -1 ? 'draw' : `player ${state.winner} won`
            };
        }

        if (!state.running) {
            return {
                winner: state.winner === -1 ? null : state.winner,
                ticks: state.tick,
                reason: 'game stopped'
            };
        }
    }

    return { winner: null, ticks: maxTicks, reason: 'timeout' };
}

function main() {
    const config = parseArgs();

    console.log(`\nAI vs AI Simulation`);
    console.log(`==================`);
    console.log(`AI 1 (Player 0): ${config.ai1}`);
    console.log(`AI 2 (Player 1): ${config.ai2}`);
    console.log(`Difficulty: ${config.difficulty}`);
    console.log(`Games: ${config.games}`);
    console.log(`Max ticks: ${config.maxTicks}`);
    console.log(`Map: ${config.mapSize}, resources: ${config.resourceDensity}, rocks: ${config.rockDensity}`);
    console.log(`Turn order: ${config.fairTurnOrder ? 'fair (interleaved + rotating)' : 'legacy (sequential)'}`);
    console.log(`---`);

    let ai1Wins = 0;
    let ai2Wins = 0;
    let draws = 0;
    const tickCounts: number[] = [];

    for (let game = 0; game < config.games; game++) {
        const state = createGameState(
            config.ai1, config.ai2,
            config.difficulty, config.mapSize,
            config.resourceDensity, config.rockDensity
        );

        const startTime = Date.now();
        const result = runGame(state, config.maxTicks, config.verbose, game, config.fairTurnOrder);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        tickCounts.push(result.ticks);

        if (result.winner === 0) {
            ai1Wins++;
            console.log(`Game ${game + 1}: ${config.ai1} wins at tick ${result.ticks} (${elapsed}s)`);
        } else if (result.winner === 1) {
            ai2Wins++;
            console.log(`Game ${game + 1}: ${config.ai2} wins at tick ${result.ticks} (${elapsed}s)`);
        } else {
            draws++;
            console.log(`Game ${game + 1}: ${result.reason} at tick ${result.ticks} (${elapsed}s)`);
        }
    }

    console.log(`\n==================`);
    console.log(`Results:`);
    console.log(`  ${config.ai1}: ${ai1Wins} wins (${(ai1Wins / config.games * 100).toFixed(1)}%)`);
    console.log(`  ${config.ai2}: ${ai2Wins} wins (${(ai2Wins / config.games * 100).toFixed(1)}%)`);
    console.log(`  Draws/Timeouts: ${draws} (${(draws / config.games * 100).toFixed(1)}%)`);

    const avgTicks = tickCounts.reduce((a, b) => a + b, 0) / tickCounts.length;
    console.log(`  Avg game length: ${Math.round(avgTicks)} ticks`);
    console.log();
}

main();

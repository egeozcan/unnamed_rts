import { GameState, Vector, PlayerState, BuildingEntity, HarvesterUnit, Action } from '../engine/types.js';
import { INITIAL_STATE, update, createPlayerState, tick } from '../engine/reducer.js';
import { computeAiActions, resetAIState } from '../engine/ai/index.js';
import { createEntityCache } from '../engine/perf.js';
import { generateMap, getStartingPositions } from '../game-utils.js';
import { calculatePlayerScores, clearScoreCache } from '../engine/scores.js';

export function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function withSeededRandom<T>(seed: number, fn: () => T): T {
    const originalRandom = Math.random;
    Math.random = mulberry32(seed);
    try {
        return fn();
    } finally {
        Math.random = originalRandom;
    }
}

export function deriveGameSeed(baseSeed: number, gameIndex: number): number {
    return (baseSeed + Math.imul(gameIndex + 1, 0x9E3779B1)) >>> 0;
}

export function createGameState(
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

    const players: Record<number, PlayerState> = {
        0: createPlayerState(0, true, difficulty, '#4488ff', ai1Id),
        1: createPlayerState(1, true, difficulty, '#ff4444', ai2Id),
    };

    for (let slot = 0; slot < 2; slot++) {
        const pos = positions[slot];

        const cyId = `cy_p${slot}`;
        const conyardEntity: BuildingEntity = {
            id: cyId, owner: slot, type: 'BUILDING', key: 'conyard',
            pos, prevPos: pos,
            hp: 3000, maxHp: 3000, w: 90, h: 90, radius: 45, dead: false,
            building: { isRepairing: false, placedTick: 0 }
        };
        entities[cyId] = conyardEntity;

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

export interface GameResult {
    winner: number | null;
    ticks: number;
    reason: string;
    scores?: Record<number, number>;
}

export function runGame(
    state: GameState,
    maxTicks: number,
    verbose: boolean,
    gameIndex: number,
    fairTurnOrder: boolean
): GameResult {
    const playerIds = Object.keys(state.players).map(s => parseInt(s, 10));
    const aiPlayerIds = playerIds.filter(pid => state.players[pid]?.isAi);
    const actionListsByPlayer: (Action[] | null)[] = new Array(playerIds.length).fill(null);
    const activeIndices: number[] = new Array(playerIds.length).fill(-1);

    for (const pid of aiPlayerIds) {
        resetAIState(pid);
    }
    clearScoreCache();

    for (let t = 0; t < maxTicks; t++) {
        if (!fairTurnOrder) {
            for (const pid of aiPlayerIds) {
                const aiActions = computeAiActions(state, pid);
                for (const action of aiActions) {
                    state = update(state, action);
                }
            }
        } else {
            const sharedEntityCache = createEntityCache(state.entities);
            let activeCount = 0;
            for (let i = 0; i < playerIds.length; i++) {
                const pid = playerIds[i];
                if (!state.players[pid]?.isAi) {
                    actionListsByPlayer[i] = null;
                    continue;
                }
                actionListsByPlayer[i] = computeAiActions(state, pid, sharedEntityCache);
                activeIndices[activeCount++] = i;
            }

            if (activeCount > 0) {
                const startOffset = (gameIndex + t) % activeCount;
                let maxActions = 0;
                for (let i = 0; i < activeCount; i++) {
                    const actionList = actionListsByPlayer[activeIndices[i]];
                    const count = actionList ? actionList.length : 0;
                    if (count > maxActions) maxActions = count;
                }

                for (let actionIndex = 0; actionIndex < maxActions; actionIndex++) {
                    for (let i = 0; i < activeCount; i++) {
                        const orderedActiveIndex = (startOffset + i) % activeCount;
                        const actions = actionListsByPlayer[activeIndices[orderedActiveIndex]];
                        if (!actions || actionIndex >= actions.length) continue;
                        state = update(state, actions[actionIndex]);
                    }
                }
            }
        }

        state = tick(state);

        if (verbose && t % 1000 === 0 && t > 0) {
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

        if (state.winner !== null) {
            const finalScores = calculatePlayerScores(state);
            const scoresMap: Record<number, number> = {};
            for (const s of finalScores) scoresMap[s.playerId] = s.total;
            return {
                winner: state.winner === -1 ? null : state.winner,
                ticks: state.tick,
                reason: state.winner === -1 ? 'draw' : `player ${state.winner} won`,
                scores: scoresMap
            };
        }

        if (!state.running) {
            const finalScores = calculatePlayerScores(state);
            const scoresMap: Record<number, number> = {};
            for (const s of finalScores) scoresMap[s.playerId] = s.total;
            return {
                winner: state.winner === -1 ? null : state.winner,
                ticks: state.tick,
                reason: 'game stopped',
                scores: scoresMap
            };
        }
    }

    const finalScores = calculatePlayerScores(state);
    const scoresMap: Record<number, number> = {};
    for (const s of finalScores) scoresMap[s.playerId] = s.total;
    return { winner: null, ticks: maxTicks, reason: 'timeout', scores: scoresMap };
}

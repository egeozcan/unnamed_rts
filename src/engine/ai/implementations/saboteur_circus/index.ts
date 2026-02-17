import { Action, Entity, GameState, isActionType } from '../../../types.js';
import { createEntityCache, EntityCache, getBuildingsForOwner, getEnemiesOf, getUnitsForOwner } from '../../../perf.js';
import { AIImplementation, AIImplementationDifficulty } from '../../contracts.js';
import { computeClassicAiActions } from '../classic/index.js';
import { checkPrerequisites } from '../../utils.js';
import { findBaseCenter, getAIState, resetAIState, setPersonalityForPlayer } from '../../state.js';
import { handleDemoTruckAssault, handleEngineerCapture, handleHijackerAssault } from '../../action_combat.js';
import { RULES } from '../../../../data/schemas/index.js';
import { getSaboteurCircusRuntimeState, resetSaboteurCircusRuntimeState, SaboteurStuntMode } from './state.js';

type CommandLikeAction = Extract<Action, { type: 'COMMAND_ATTACK' | 'COMMAND_MOVE' | 'COMMAND_ATTACK_MOVE' | 'SET_RALLY_POINT' | 'SET_STANCE' }>;

const UNDERUSED_INFANTRY_CYCLE = ['hijacker', 'medic', 'engineer', 'sniper', 'commando', 'grenadier'] as const;
const UNDERUSED_VEHICLE_CYCLE = ['apc', 'stealth', 'demo_truck', 'induction_rig', 'light'] as const;

const CONVENTIONAL_INFANTRY = new Set(['rifle', 'rocket', 'flamer']);
const CONVENTIONAL_VEHICLES = new Set(['heavy', 'mammoth', 'mlrs', 'artillery', 'flame_tank', 'jeep']);
const STUNT_MODES: SaboteurStuntMode[] = ['capture', 'hijack', 'demo', 'stealth_raid'];
const STEALTH_RAID_TARGET_PRIORITY = ['refinery', 'tech', 'factory', 'conyard', 'power', 'airforce_command'];
const STEALTH_RAID_UNIT_KEYS = new Set(['commando', 'stealth', 'apc', 'light']);

const REFINERY_SOFT_CAP = 2;
const THREAT_GATE = 80;

const SPECIALIST_CAPS: Record<string, number> = {
    commando: 1,
    medic: 2,
    engineer: 1,
    hijacker: 1,
    demo_truck: 1,
    induction_rig: 1,
    stealth: 1,
    apc: 2
};

function incrementCount(map: Map<string, number>, key: string, by: number = 1): void {
    map.set(key, (map.get(key) || 0) + by);
}

function getProjectedCount(
    key: string,
    existing: Map<string, number>,
    queued: Map<string, number>,
    pending: Map<string, number>
): number {
    return (existing.get(key) || 0) + (queued.get(key) || 0) + (pending.get(key) || 0);
}

function countEntitiesByKey(entities: Entity[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const entity of entities) {
        if (entity.dead) continue;
        incrementCount(counts, entity.key);
    }
    return counts;
}

function countQueuedByKey(state: GameState, playerId: number): Map<string, number> {
    const player = state.players[playerId];
    const counts = new Map<string, number>();
    if (!player) return counts;

    const queues = [player.queues.building, player.queues.infantry, player.queues.vehicle, player.queues.air];
    for (const queue of queues) {
        if (queue.current) {
            incrementCount(counts, queue.current);
        }
        for (const key of queue.queued || []) {
            incrementCount(counts, key);
        }
    }

    if (player.readyToPlace) {
        incrementCount(counts, player.readyToPlace);
    }

    return counts;
}

function getBuildCost(category: string, key: string): number {
    if (category === 'building') {
        return RULES.buildings[key]?.cost || 0;
    }
    return RULES.units[key]?.cost || 0;
}

function hasReachedSpecialistCap(
    key: string,
    existing: Map<string, number>,
    queued: Map<string, number>,
    pending: Map<string, number>
): boolean {
    const cap = SPECIALIST_CAPS[key];
    if (!cap) return false;
    return getProjectedCount(key, existing, queued, pending) >= cap;
}

function canUseRewriteCandidate(
    key: string,
    category: 'infantry' | 'vehicle',
    localCredits: number,
    myBuildings: Entity[],
    existing: Map<string, number>,
    queued: Map<string, number>,
    pending: Map<string, number>
): boolean {
    if (!checkPrerequisites(key, myBuildings)) return false;
    if (hasReachedSpecialistCap(key, existing, queued, pending)) return false;
    return getBuildCost(category, key) <= localCredits;
}

function pickReplacementFromCycle(
    cycle: readonly string[],
    category: 'infantry' | 'vehicle',
    state: GameState,
    playerId: number,
    runtime: ReturnType<typeof getSaboteurCircusRuntimeState>,
    localCredits: number,
    myBuildings: Entity[],
    existing: Map<string, number>,
    queued: Map<string, number>,
    pending: Map<string, number>
): string | null {
    if (cycle.length === 0) return null;

    const timeBucket = Math.floor(state.tick / 300);
    const startIndex = (runtime.productionCursor + playerId + timeBucket) % cycle.length;

    for (let offset = 0; offset < cycle.length; offset++) {
        const idx = (startIndex + offset) % cycle.length;
        const candidate = cycle[idx];
        if (!canUseRewriteCandidate(candidate, category, localCredits, myBuildings, existing, queued, pending)) {
            continue;
        }
        runtime.productionCursor = (idx + 1) % cycle.length;
        return candidate;
    }

    return null;
}

function shouldKeepRefineryBuild(
    projectedRefineries: number,
    threatLevel: number,
    harvesterCount: number,
    hasConyard: boolean
): boolean {
    if (projectedRefineries < REFINERY_SOFT_CAP) return true;
    if (threatLevel >= THREAT_GATE) return true;
    if (!hasConyard) return true;
    return harvesterCount <= 1;
}

function rewriteBuildActions(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    myUnits: Entity[],
    runtime: ReturnType<typeof getSaboteurCircusRuntimeState>,
    threatLevel: number
): Action[] {
    const player = state.players[playerId];
    if (!player) return actions;

    const existingCounts = countEntitiesByKey([...myBuildings, ...myUnits]);
    const queuedCounts = countQueuedByKey(state, playerId);
    const pendingCounts = new Map<string, number>();

    const hasConyard = myBuildings.some(building => !building.dead && building.type === 'BUILDING' && building.key === 'conyard');
    const harvesterCount = myUnits.filter(unit => !unit.dead && unit.type === 'UNIT' && unit.key === 'harvester').length;

    let localCredits = player.credits;
    const rewritten: Action[] = [];

    for (const action of actions) {
        if (!isActionType(action, 'START_BUILD')) {
            rewritten.push(action);
            continue;
        }

        const category = action.payload.category;
        const originalKey = action.payload.key;
        let finalKey = originalKey;

        if (category === 'building') {
            const buildingData = RULES.buildings[originalKey];
            if (buildingData?.isDefense && threatLevel < THREAT_GATE) {
                continue;
            }

            if (originalKey === 'refinery') {
                const projectedRefineries = getProjectedCount('refinery', existingCounts, queuedCounts, pendingCounts);
                if (!shouldKeepRefineryBuild(projectedRefineries, threatLevel, harvesterCount, hasConyard)) {
                    continue;
                }
            }
        } else if (category === 'infantry') {
            if (CONVENTIONAL_INFANTRY.has(originalKey)) {
                const replacement = pickReplacementFromCycle(
                    UNDERUSED_INFANTRY_CYCLE,
                    'infantry',
                    state,
                    playerId,
                    runtime,
                    localCredits,
                    myBuildings,
                    existingCounts,
                    queuedCounts,
                    pendingCounts
                );
                if (replacement) {
                    finalKey = replacement;
                }
            }

            if (hasReachedSpecialistCap(finalKey, existingCounts, queuedCounts, pendingCounts)) {
                const fallback = pickReplacementFromCycle(
                    UNDERUSED_INFANTRY_CYCLE,
                    'infantry',
                    state,
                    playerId,
                    runtime,
                    localCredits,
                    myBuildings,
                    existingCounts,
                    queuedCounts,
                    pendingCounts
                );
                if (fallback) {
                    finalKey = fallback;
                } else if (hasReachedSpecialistCap(originalKey, existingCounts, queuedCounts, pendingCounts)) {
                    continue;
                } else {
                    finalKey = originalKey;
                }
            }
        } else if (category === 'vehicle') {
            const preserveVehicle = originalKey === 'harvester' || originalKey === 'mcv';

            if (!preserveVehicle && CONVENTIONAL_VEHICLES.has(originalKey)) {
                const replacement = pickReplacementFromCycle(
                    UNDERUSED_VEHICLE_CYCLE,
                    'vehicle',
                    state,
                    playerId,
                    runtime,
                    localCredits,
                    myBuildings,
                    existingCounts,
                    queuedCounts,
                    pendingCounts
                );
                if (replacement) {
                    finalKey = replacement;
                }
            }

            if (!preserveVehicle && hasReachedSpecialistCap(finalKey, existingCounts, queuedCounts, pendingCounts)) {
                const fallback = pickReplacementFromCycle(
                    UNDERUSED_VEHICLE_CYCLE,
                    'vehicle',
                    state,
                    playerId,
                    runtime,
                    localCredits,
                    myBuildings,
                    existingCounts,
                    queuedCounts,
                    pendingCounts
                );
                if (fallback) {
                    finalKey = fallback;
                } else if (hasReachedSpecialistCap(originalKey, existingCounts, queuedCounts, pendingCounts)) {
                    continue;
                } else {
                    finalKey = originalKey;
                }
            }
        }

        const rewrittenAction = finalKey === originalKey
            ? action
            : {
                type: 'START_BUILD',
                payload: {
                    category,
                    key: finalKey,
                    playerId
                }
            } satisfies Action;

        rewritten.push(rewrittenAction);
        incrementCount(pendingCounts, finalKey);
        localCredits = Math.max(0, localCredits - getBuildCost(category, finalKey));
    }

    return rewritten;
}

function getStuntInterval(difficulty: AIImplementationDifficulty): number {
    switch (difficulty) {
        case 'hard':
            return 1500;
        case 'medium':
            return 1800;
        case 'easy':
        case 'dummy':
        default:
            return 2100;
    }
}

function shouldTriggerStunt(tick: number, lastStuntTick: number, interval: number): boolean {
    return tick > 0 && tick - lastStuntTick >= interval;
}

function createStealthRaidActions(
    myUnits: Entity[],
    enemies: Entity[],
    baseCenter: ReturnType<typeof findBaseCenter>
): Action[] {
    let raidTarget: Entity | null = null;

    for (const key of STEALTH_RAID_TARGET_PRIORITY) {
        const matches = enemies.filter(enemy => enemy.type === 'BUILDING' && !enemy.dead && enemy.key === key);
        if (matches.length === 0) continue;
        raidTarget = matches.reduce((best, cur) => cur.pos.dist(baseCenter) < best.pos.dist(baseCenter) ? cur : best);
        break;
    }

    if (!raidTarget) return [];

    const raidCandidates = myUnits.filter(
        unit => unit.type === 'UNIT' && !unit.dead && STEALTH_RAID_UNIT_KEYS.has(unit.key)
    );
    if (raidCandidates.length === 0) return [];

    const raidSquad = [...raidCandidates]
        .sort((a, b) => {
            const distDiff = a.pos.dist(raidTarget!.pos) - b.pos.dist(raidTarget!.pos);
            if (Math.abs(distDiff) > 0.001) return distDiff;
            return a.id.localeCompare(b.id);
        })
        .slice(0, 4);

    if (raidSquad.length === 0) return [];

    return [
        {
            type: 'COMMAND_ATTACK_MOVE',
            payload: {
                unitIds: raidSquad.map(unit => unit.id),
                x: raidTarget.pos.x,
                y: raidTarget.pos.y
            }
        }
    ];
}

function createRallyFlavorActions(
    state: GameState,
    myBuildings: Entity[],
    enemies: Entity[],
    baseCenter: ReturnType<typeof findBaseCenter>
): Action[] {
    if (state.tick <= 0 || state.tick % 600 !== 0) {
        return [];
    }

    const enemyRefineries = enemies.filter(enemy => enemy.type === 'BUILDING' && !enemy.dead && enemy.key === 'refinery');
    if (enemyRefineries.length === 0) {
        return [];
    }

    const rallyTarget = enemyRefineries.reduce((best, cur) => cur.pos.dist(baseCenter) < best.pos.dist(baseCenter) ? cur : best);
    const productionBuildings = myBuildings.filter(
        building => building.type === 'BUILDING' && !building.dead && (building.key === 'barracks' || building.key === 'factory')
    );

    return productionBuildings.map(building => ({
        type: 'SET_RALLY_POINT',
        payload: {
            buildingId: building.id,
            x: rallyTarget.pos.x,
            y: rallyTarget.pos.y
        }
    } satisfies Action));
}

function createSmallMapChaosActions(
    state: GameState,
    myUnits: Entity[],
    enemies: Entity[]
): Action[] {
    const isSmallMap = state.config.width <= 2200;
    if (!isSmallMap) return [];
    if (state.tick <= 0 || state.tick % 300 !== 0) return [];

    const enemyBuildings = enemies.filter(enemy => enemy.type === 'BUILDING' && !enemy.dead);
    const target = enemyBuildings.find(enemy => enemy.key === 'conyard') || enemyBuildings[0] || enemies[0];
    if (!target) return [];

    const sacrificeUnits = myUnits.filter(unit =>
        unit.type === 'UNIT' &&
        !unit.dead &&
        unit.key !== 'mcv' &&
        unit.key !== 'harrier'
    );

    if (sacrificeUnits.length === 0) return [];

    return [
        {
            type: 'COMMAND_ATTACK_MOVE',
            payload: {
                unitIds: sacrificeUnits.map(unit => unit.id),
                x: target.pos.x,
                y: target.pos.y
            }
        }
    ];
}

function createSmallMapCollapseActions(
    state: GameState,
    playerId: number,
    myBuildings: Entity[]
): Action[] {
    const isSmallMap = state.config.width <= 2200;
    if (!isSmallMap) return [];
    if (state.tick <= 0 || state.tick % 7200 !== 0) return [];

    const sellPriority = ['power', 'tech', 'airforce_command', 'service_depot'];
    const aliveBuildings = myBuildings.filter(building => building.type === 'BUILDING' && !building.dead);

    for (const key of sellPriority) {
        const target = aliveBuildings.find(building => building.key === key);
        if (!target) continue;
        return [
            {
                type: 'SELL_BUILDING',
                payload: {
                    buildingId: target.id,
                    playerId
                }
            }
        ];
    }

    return [];
}

function createSpecialistHookActions(
    state: GameState,
    playerId: number,
    myUnits: Entity[],
    enemies: Entity[],
    aiState: ReturnType<typeof getAIState>,
    baseCenter: ReturnType<typeof findBaseCenter>
): Action[] {
    if (enemies.length === 0) return [];
    if (state.tick % 180 !== 0) return [];

    const engineers = myUnits.filter(unit => unit.type === 'UNIT' && !unit.dead && unit.key === 'engineer');
    const actions: Action[] = [];
    if (engineers.length > 0) {
        actions.push(...handleEngineerCapture(state, playerId, aiState, engineers, enemies, baseCenter));
    }
    actions.push(...handleHijackerAssault(state, playerId, enemies, aiState, baseCenter));
    actions.push(...handleDemoTruckAssault(state, playerId, enemies, aiState));
    return actions;
}

function createStuntActions(
    mode: SaboteurStuntMode,
    state: GameState,
    playerId: number,
    myUnits: Entity[],
    enemies: Entity[],
    aiState: ReturnType<typeof getAIState>,
    baseCenter: ReturnType<typeof findBaseCenter>
): Action[] {
    if (enemies.length === 0) return [];

    const engineers = myUnits.filter(unit => unit.type === 'UNIT' && !unit.dead && unit.key === 'engineer');

    switch (mode) {
        case 'capture':
            if (engineers.length === 0) return [];
            return handleEngineerCapture(state, playerId, aiState, engineers, enemies, baseCenter);
        case 'hijack':
            return handleHijackerAssault(state, playerId, enemies, aiState, baseCenter);
        case 'demo':
            return handleDemoTruckAssault(state, playerId, enemies, aiState);
        case 'stealth_raid':
            return createStealthRaidActions(myUnits, enemies, baseCenter);
        default:
            return [];
    }
}

function isCommandLikeAction(action: Action): action is CommandLikeAction {
    return action.type === 'COMMAND_ATTACK' ||
        action.type === 'COMMAND_MOVE' ||
        action.type === 'COMMAND_ATTACK_MOVE' ||
        action.type === 'SET_RALLY_POINT' ||
        action.type === 'SET_STANCE';
}

function getCommandSignature(action: CommandLikeAction): string {
    if (action.type === 'COMMAND_ATTACK') {
        return `attack:${action.payload.targetId}:${[...action.payload.unitIds].sort().join(',')}`;
    }
    if (action.type === 'COMMAND_MOVE') {
        return `move:${action.payload.x}:${action.payload.y}:${[...action.payload.unitIds].sort().join(',')}`;
    }
    if (action.type === 'COMMAND_ATTACK_MOVE') {
        return `attack_move:${action.payload.x}:${action.payload.y}:${[...action.payload.unitIds].sort().join(',')}`;
    }
    if (action.type === 'SET_RALLY_POINT') {
        return `rally:${action.payload.buildingId}:${action.payload.x}:${action.payload.y}`;
    }
    return `stance:${action.payload.stance}:${[...action.payload.unitIds].sort().join(',')}`;
}

function dedupeCommandActions(actions: Action[]): Action[] {
    const deduped: Action[] = [];
    const seenSignatures = new Set<string>();

    for (const action of actions) {
        if (!isCommandLikeAction(action)) {
            deduped.push(action);
            continue;
        }

        const signature = getCommandSignature(action);
        if (seenSignatures.has(signature)) {
            continue;
        }
        seenSignatures.add(signature);
        deduped.push(action);
    }

    return deduped;
}

export function computeSaboteurCircusAiActions(
    state: GameState,
    playerId: number,
    difficulty: AIImplementationDifficulty,
    sharedCache?: EntityCache
): Action[] {
    const player = state.players[playerId];
    if (!player) return [];

    const cache = sharedCache ?? createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId);
    const baseCenter = findBaseCenter(myBuildings);

    // Keep this implementation deterministic while still reusing classic AI internals.
    setPersonalityForPlayer(playerId, 'balanced');
    const classicActions = computeClassicAiActions(state, playerId, cache);

    const aiState = getAIState(playerId);
    const runtime = getSaboteurCircusRuntimeState(playerId);

    const rewrittenClassicActions = rewriteBuildActions(
        classicActions,
        state,
        playerId,
        myBuildings,
        myUnits,
        runtime,
        aiState.threatLevel
    );

    const injectedActions: Action[] = [];
    injectedActions.push(...createSpecialistHookActions(state, playerId, myUnits, enemies, aiState, baseCenter));
    injectedActions.push(...createRallyFlavorActions(state, myBuildings, enemies, baseCenter));
    injectedActions.push(...createSmallMapChaosActions(state, myUnits, enemies));
    injectedActions.push(...createSmallMapCollapseActions(state, playerId, myBuildings));

    const stuntInterval = getStuntInterval(difficulty);
    if (shouldTriggerStunt(state.tick, runtime.lastStuntTick, stuntInterval)) {
        const stuntMode = STUNT_MODES[runtime.stuntIndex % STUNT_MODES.length];
        injectedActions.push(...createStuntActions(stuntMode, state, playerId, myUnits, enemies, aiState, baseCenter));
        runtime.stuntIndex += 1;
        runtime.lastStuntTick = state.tick;
    }

    return dedupeCommandActions([...rewrittenClassicActions, ...injectedActions]);
}

export const SaboteurCircusAIImplementation: AIImplementation = {
    id: 'saboteur_circus',
    name: 'Saboteur Circus',
    description: 'A playful sabotage AI that favors odd specialist tactics over standard tank play.',
    computeActions: ({ state, playerId, difficulty, entityCache }) => computeSaboteurCircusAiActions(state, playerId, difficulty, entityCache),
    reset: (playerId?: number) => {
        resetSaboteurCircusRuntimeState(playerId);
        resetAIState(playerId);
    }
};

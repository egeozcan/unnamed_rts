import { Action, Entity, GameState, isActionType } from '../../../types.js';
import { createEntityCache, EntityCache, getBuildingsForOwner, getEnemiesOf, getUnitsForOwner } from '../../../perf.js';
import { RULES } from '../../../../data/schemas/index.js';
import { AIImplementation, AIImplementationDifficulty } from '../../contracts.js';
import { computeClassicAiActions } from '../classic/index.js';
import { findBaseCenter, getAIState, setPersonalityForPlayer } from '../../state.js';
import { handleAllInSell } from '../../action_economy.js';
import { checkPrerequisites, hasProductionBuildingFor } from '../../utils.js';

type RuntimeState = {
    forcedAllIn: boolean;
    lastForcedTick: number;
    lastRallyTick: number;
    switchedToBalanced: boolean;
};

const runtimeByPlayer = new Map<number, RuntimeState>();

const EARLY_FORCE_TICK = 4800;
const STALEMATE_FORCE_TICK = 12000;
const MIN_FORCE_COMBAT_UNITS = 3;
const BASE_THREAT_RADIUS = 260;
const RALLY_COOLDOWN = 240;

function isCombatUnit(entity: Entity): boolean {
    return entity.type === 'UNIT' &&
        entity.key !== 'harvester' &&
        entity.key !== 'mcv' &&
        entity.key !== 'engineer' &&
        entity.key !== 'induction_rig' &&
        !entity.dead;
}

function getRuntimeState(playerId: number, tick: number): RuntimeState {
    const existing = runtimeByPlayer.get(playerId);
    if (existing && tick > 0) {
        return existing;
    }

    const created: RuntimeState = {
        forcedAllIn: false,
        lastForcedTick: 0,
        lastRallyTick: 0,
        switchedToBalanced: false
    };
    runtimeByPlayer.set(playerId, created);
    return created;
}

function getEnemyBuildings(enemies: Entity[]): Entity[] {
    return enemies.filter(e => e.type === 'BUILDING' && !e.dead);
}

function pickPrimaryTarget(
    enemyBuildings: Entity[],
    enemies: Entity[],
    baseCenterDistRef: Entity,
    tick: number
): Entity | null {
    if (tick < 9000) {
        const enemyHarvesters = enemies.filter(e => e.type === 'UNIT' && e.key === 'harvester' && !e.dead);
        if (enemyHarvesters.length > 0) {
            let closest = enemyHarvesters[0];
            let closestDist = closest.pos.dist(baseCenterDistRef.pos);
            for (let i = 1; i < enemyHarvesters.length; i++) {
                const dist = enemyHarvesters[i].pos.dist(baseCenterDistRef.pos);
                if (dist < closestDist) {
                    closest = enemyHarvesters[i];
                    closestDist = dist;
                }
            }
            return closest;
        }
    }

    if (enemyBuildings.length > 0) {
        const priorityKeys = tick < 9000 ?
            ['refinery', 'factory', 'conyard', 'power', 'barracks'] :
            ['factory', 'refinery', 'conyard', 'power', 'barracks', 'airforce_command'];
        for (const key of priorityKeys) {
            const matches = enemyBuildings.filter(b => b.key === key);
            if (matches.length > 0) {
                let best = matches[0];
                let bestDist = best.pos.dist(baseCenterDistRef.pos);
                for (let i = 1; i < matches.length; i++) {
                    const dist = matches[i].pos.dist(baseCenterDistRef.pos);
                    if (dist < bestDist) {
                        best = matches[i];
                        bestDist = dist;
                    }
                }
                return best;
            }
        }
        return enemyBuildings[0];
    }

    const enemyCombatUnits = enemies.filter(isCombatUnit);
    if (enemyCombatUnits.length > 0) {
        return enemyCombatUnits[0];
    }
    return enemies.find(e => !e.dead) || null;
}

function hasQueuedBuildOfCategory(actions: Action[], category: 'vehicle' | 'infantry'): boolean {
    return actions.some(action =>
        isActionType(action, 'START_BUILD') &&
        action.payload.category === category
    );
}

function queueFallbackProduction(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[]
): void {
    const player = state.players[playerId];
    if (!player) return;

    if (!player.queues.vehicle.current &&
        hasProductionBuildingFor('vehicle', myBuildings) &&
        !hasQueuedBuildOfCategory(actions, 'vehicle')) {
        const vehicleKey = checkPrerequisites('heavy', myBuildings) ? 'heavy' :
            checkPrerequisites('light', myBuildings) ? 'light' : null;
        if (vehicleKey) {
            const cost = RULES.units[vehicleKey]?.cost ?? 0;
            if (player.credits >= cost) {
                actions.push({
                    type: 'START_BUILD',
                    payload: { category: 'vehicle', key: vehicleKey, playerId }
                });
            }
        }
    }

    if (!player.queues.infantry.current &&
        hasProductionBuildingFor('infantry', myBuildings) &&
        !hasQueuedBuildOfCategory(actions, 'infantry')) {
        const key = checkPrerequisites('rocket', myBuildings) ? 'rocket' : 'rifle';
        const cost = RULES.units[key]?.cost ?? 0;
        if (player.credits >= cost) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'infantry', key, playerId }
            });
        }
    }
}

function tuneBaseActions(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    underThreat: boolean
): Action[] {
    const refineries = myBuildings.filter(b => b.key === 'refinery' && !b.dead).length;
    const canHeavy = checkPrerequisites('heavy', myBuildings);
    const canLight = checkPrerequisites('light', myBuildings);
    const canRocket = checkPrerequisites('rocket', myBuildings);

    const tuned: Action[] = [];
    for (const action of actions) {
        if (!isActionType(action, 'START_BUILD')) {
            tuned.push(action);
            continue;
        }

        const payload = action.payload;
        if (payload.category === 'building') {
            if (state.tick < 18000 &&
                (payload.key === 'tech' || payload.key === 'airforce_command' || payload.key === 'service_depot')) {
                continue;
            }
            if (state.tick < 15000 && payload.key === 'refinery' && refineries >= 2) {
                continue;
            }
            if (!underThreat && state.tick < 7000 && RULES.buildings[payload.key]?.isDefense) {
                continue;
            }
            tuned.push(action);
            continue;
        }

        if (payload.category === 'vehicle') {
            if (payload.key === 'mcv' || payload.key === 'induction_rig' || payload.key === 'demo_truck') {
                continue;
            }
            if (state.tick < 18000 && payload.key !== 'harvester' && payload.key !== 'light' && payload.key !== 'heavy' && payload.key !== 'artillery') {
                if (canHeavy || canLight) {
                    tuned.push({
                        type: 'START_BUILD',
                        payload: {
                            category: 'vehicle',
                            key: canHeavy ? 'heavy' : 'light',
                            playerId
                        }
                    });
                    continue;
                }
            }
            tuned.push(action);
            continue;
        }

        if (payload.category === 'infantry') {
            if (state.tick < 14000 && (payload.key === 'engineer' || payload.key === 'hijacker' || payload.key === 'sniper')) {
                continue;
            }
            if (state.tick < 12000 && payload.key === 'rifle' && canRocket) {
                tuned.push({
                    type: 'START_BUILD',
                    payload: {
                        category: 'infantry',
                        key: 'rocket',
                        playerId
                    }
                });
                continue;
            }
            tuned.push(action);
            continue;
        }

        tuned.push(action);
    }

    return tuned;
}

function maybeSetRallyPoints(
    actions: Action[],
    state: GameState,
    myBuildings: Entity[],
    target: Entity,
    runtime: RuntimeState
): void {
    if (state.tick - runtime.lastRallyTick < RALLY_COOLDOWN) {
        return;
    }
    runtime.lastRallyTick = state.tick;
    for (const building of myBuildings) {
        if (building.key !== 'factory' && building.key !== 'barracks' && building.key !== 'airforce_command') {
            continue;
        }
        actions.push({
            type: 'SET_RALLY_POINT',
            payload: {
                buildingId: building.id,
                x: target.pos.x,
                y: target.pos.y
            }
        });
    }
}

export function computeAuroraSovereignAiActions(
    state: GameState,
    playerId: number,
    difficulty: AIImplementationDifficulty,
    sharedCache?: EntityCache
): Action[] {
    void difficulty;

    const player = state.players[playerId];
    if (!player) return [];

    if (state.tick <= 1) {
        setPersonalityForPlayer(playerId, 'rusher');
    }
    const runtime = getRuntimeState(playerId, state.tick);
    if (state.tick >= 9000 && !runtime.switchedToBalanced) {
        setPersonalityForPlayer(playerId, 'balanced');
        runtime.switchedToBalanced = true;
    }

    const cache = sharedCache ?? createEntityCache(state.entities);
    let actions = computeClassicAiActions(state, playerId, cache);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId);
    const enemyBuildings = getEnemyBuildings(enemies);
    const combatUnits = myUnits.filter(isCombatUnit);
    const harvesters = myUnits.filter(u => u.type === 'UNIT' && u.key === 'harvester' && !u.dead);

    if (myBuildings.length === 0 && myUnits.every(unit => unit.key !== 'mcv')) {
        return actions;
    }

    const baseCenter = findBaseCenter(myBuildings);
    const localThreats = enemies.filter(enemy =>
        enemy.type === 'UNIT' &&
        enemy.key !== 'harvester' &&
        !enemy.dead &&
        enemy.pos.dist(baseCenter) <= BASE_THREAT_RADIUS
    );

    const baseCenterEntity: Entity = myBuildings[0] || myUnits[0];
    if (!baseCenterEntity) {
        return actions;
    }
    const primaryTarget = pickPrimaryTarget(enemyBuildings, enemies, baseCenterEntity, state.tick);
    const aiState = getAIState(playerId);
    const enemyCombatUnits = enemies.filter(isCombatUnit);

    const hasArmyForPush = combatUnits.length >= MIN_FORCE_COMBAT_UNITS;
    const hasCombatEdge = combatUnits.length >= enemyCombatUnits.length + 2;
    const shouldForceByTiming = state.tick >= STALEMATE_FORCE_TICK ||
        (state.tick >= EARLY_FORCE_TICK && hasArmyForPush && enemyBuildings.length > 0);
    const shouldForceAllIn = primaryTarget !== null &&
        (runtime.forcedAllIn || shouldForceByTiming || hasCombatEdge) &&
        (localThreats.length === 0 || hasCombatEdge);

    actions = tuneBaseActions(actions, state, playerId, myBuildings, localThreats.length > 0);

    if (primaryTarget &&
        state.tick >= EARLY_FORCE_TICK &&
        combatUnits.length >= MIN_FORCE_COMBAT_UNITS &&
        (localThreats.length === 0 || hasCombatEdge)) {
        actions.push({
            type: 'COMMAND_ATTACK',
            payload: {
                unitIds: combatUnits.map(unit => unit.id),
                targetId: primaryTarget.id
            }
        });
    }

    if (shouldForceAllIn) {
        runtime.forcedAllIn = true;
        runtime.lastForcedTick = state.tick;
        if (aiState.allInStartTick === 0) {
            aiState.allInStartTick = state.tick;
        }
        aiState.strategy = 'all_in';

        if (combatUnits.length > 0) {
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: {
                    unitIds: combatUnits.map(unit => unit.id),
                    targetId: primaryTarget.id
                }
            });
        }

        if (combatUnits.length >= 6) {
            actions.push({
                type: 'COMMAND_ATTACK_MOVE',
                payload: {
                    unitIds: combatUnits.map(unit => unit.id),
                    x: primaryTarget.pos.x,
                    y: primaryTarget.pos.y
                }
            });
        }

        if (state.tick >= STALEMATE_FORCE_TICK + 1800 && harvesters.length >= 2) {
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: {
                    unitIds: harvesters.slice(0, 2).map(unit => unit.id),
                    targetId: primaryTarget.id
                }
            });
        }

        if (state.tick >= STALEMATE_FORCE_TICK + 5000 && combatUnits.length >= enemyCombatUnits.length + 2) {
            actions.push(...handleAllInSell(state, playerId, myBuildings, aiState));
        }
    }

    queueFallbackProduction(actions, state, playerId, myBuildings);

    if (primaryTarget) {
        maybeSetRallyPoints(actions, state, myBuildings, primaryTarget, runtime);
    }

    return actions;
}

export const AuroraSovereignAIImplementation: AIImplementation = {
    id: 'aurora_sovereign',
    name: 'Aurora Sovereign, Warden of the Ninth Dawn',
    description: 'A relentless strategist that forces decisive timing pushes and anti-stalemate finishers.',
    computeActions: ({ state, playerId, difficulty, entityCache }) =>
        computeAuroraSovereignAiActions(state, playerId, difficulty, entityCache),
    reset: (playerId?: number) => {
        if (playerId === undefined) {
            runtimeByPlayer.clear();
            return;
        }
        runtimeByPlayer.delete(playerId);
    }
};

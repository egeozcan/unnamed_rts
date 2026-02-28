import { Action, Entity, EntityId, GameState, isActionType, PlayerState, UnitEntity } from '../../../types.js';
import { createEntityCache, EntityCache, getBuildingsForOwner, getEnemiesOf, getUnitsForOwner } from '../../../perf.js';
import { AIImplementation } from '../../contracts.js';
import { computeClassicAiActions } from '../classic/index.js';
import { getEngineerConyardRushRuntimeState, resetEngineerConyardRushRuntimeState } from './state.js';

const ENGINEERS_PER_ENEMY_CONYARD = 2;
const MIN_ENGINEER_FORCE = 3;

function isAliveConyard(entity: Entity): boolean {
    return entity.type === 'BUILDING' && entity.key === 'conyard' && !entity.dead;
}

function countQueuedEngineers(player: PlayerState): number {
    const infantryQueue = player.queues.infantry;
    let queuedEngineers = infantryQueue.current === 'engineer' ? 1 : 0;
    for (const queued of infantryQueue.queued ?? []) {
        if (queued === 'engineer') queuedEngineers += 1;
    }
    return queuedEngineers;
}

function hasBarracksBuildPlanned(player: PlayerState, actions: Action[]): boolean {
    if (player.readyToPlace === 'barracks') return true;
    if (player.queues.building.current === 'barracks') return true;
    if ((player.queues.building.queued ?? []).includes('barracks')) return true;

    return actions.some(action =>
        isActionType(action, 'START_BUILD') &&
        action.payload.playerId === player.id &&
        action.payload.category === 'building' &&
        action.payload.key === 'barracks'
    );
}

function enqueueEngineerProduction(
    actions: Action[],
    player: PlayerState,
    myBuildings: Entity[],
    currentEngineerCount: number,
    enemyConyardCount: number
): void {
    const hasBarracks = myBuildings.some(b => b.key === 'barracks' && !b.dead);
    if (!hasBarracks && !hasBarracksBuildPlanned(player, actions)) {
        actions.push({
            type: 'START_BUILD',
            payload: { category: 'building', key: 'barracks', playerId: player.id }
        });
        return;
    }

    const desiredEngineerCount = Math.max(MIN_ENGINEER_FORCE, enemyConyardCount * ENGINEERS_PER_ENEMY_CONYARD);
    const projectedEngineers = currentEngineerCount + countQueuedEngineers(player);
    if (projectedEngineers >= desiredEngineerCount) {
        return;
    }

    actions.push({
        type: 'START_BUILD',
        payload: { category: 'infantry', key: 'engineer', playerId: player.id }
    });
}

function selectEngineerTarget(engineer: UnitEntity, enemyConyards: Entity[], claimedTargets: Set<EntityId>): Entity | null {
    let bestUnclaimed: Entity | null = null;
    let bestUnclaimedDistance = Infinity;
    let bestAny: Entity | null = null;
    let bestAnyDistance = Infinity;

    for (const conyard of enemyConyards) {
        const distance = engineer.pos.dist(conyard.pos);
        if (distance < bestAnyDistance) {
            bestAnyDistance = distance;
            bestAny = conyard;
        }
        if (!claimedTargets.has(conyard.id) && distance < bestUnclaimedDistance) {
            bestUnclaimedDistance = distance;
            bestUnclaimed = conyard;
        }
    }

    return bestUnclaimed ?? bestAny;
}

function getEngineerRushActions(
    state: GameState,
    engineers: UnitEntity[],
    enemyConyards: Entity[],
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>
): Action[] {
    const actions: Action[] = [];
    if (engineers.length === 0 || enemyConyards.length === 0) {
        return actions;
    }

    const conyardsByOwner = new Map<number, Entity[]>();
    for (const conyard of enemyConyards) {
        const bucket = conyardsByOwner.get(conyard.owner);
        if (bucket) {
            bucket.push(conyard);
        } else {
            conyardsByOwner.set(conyard.owner, [conyard]);
        }
    }

    const enemyOwners = Array.from(conyardsByOwner.keys()).sort((a, b) => a - b);
    if (enemyOwners.length === 0) {
        return actions;
    }

    let ownerCursor = runtimeState.enemyOwnerRotationCursor % enemyOwners.length;
    if (ownerCursor < 0) {
        ownerCursor = 0;
    }

    const claimedTargets = new Set<EntityId>();
    for (const engineer of engineers) {
        const currentTargetId = engineer.combat?.targetId ?? null;
        if (currentTargetId) {
            const currentTarget = state.entities[currentTargetId];
            if (currentTarget && isAliveConyard(currentTarget) && currentTarget.owner !== engineer.owner) {
                claimedTargets.add(currentTarget.id);
                continue;
            }
        }

        let assignedTarget: Entity | null = null;
        let selectedOwnerOffset = 0;
        for (let offset = 0; offset < enemyOwners.length; offset++) {
            const ownerId = enemyOwners[(ownerCursor + offset) % enemyOwners.length];
            const ownerConyards = conyardsByOwner.get(ownerId) ?? [];
            const target = selectEngineerTarget(engineer, ownerConyards, claimedTargets);
            if (!target) continue;

            assignedTarget = target;
            selectedOwnerOffset = offset;
            break;
        }

        if (!assignedTarget) continue;

        claimedTargets.add(assignedTarget.id);
        actions.push({
            type: 'COMMAND_ATTACK',
            payload: { unitIds: [engineer.id], targetId: assignedTarget.id }
        });
        ownerCursor = (ownerCursor + selectedOwnerOffset + 1) % enemyOwners.length;
    }

    runtimeState.enemyOwnerRotationCursor = ownerCursor;
    return actions;
}

function trackEnemyConyards(runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>, enemyConyards: Entity[]): void {
    for (const conyard of enemyConyards) {
        runtimeState.trackedEnemyConyardIds.add(conyard.id);
    }
}

function getCapturedConyardSellActions(
    state: GameState,
    playerId: number,
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>
): Action[] {
    const actions: Action[] = [];
    for (const conyardId of Array.from(runtimeState.trackedEnemyConyardIds)) {
        const conyard = state.entities[conyardId];
        if (!conyard || !isAliveConyard(conyard) || runtimeState.initialOwnedConyardIds.has(conyardId)) {
            runtimeState.trackedEnemyConyardIds.delete(conyardId);
            continue;
        }

        if (conyard.owner === playerId) {
            actions.push({
                type: 'SELL_BUILDING',
                payload: { buildingId: conyardId, playerId }
            });
            runtimeState.trackedEnemyConyardIds.delete(conyardId);
        }
    }
    return actions;
}

function initializeRuntimeState(runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>, myBuildings: Entity[]): void {
    if (runtimeState.initialized) return;

    for (const building of myBuildings) {
        if (isAliveConyard(building)) {
            runtimeState.initialOwnedConyardIds.add(building.id);
        }
    }
    runtimeState.initialized = true;
}

export function computeEngineerConyardRushAiActions(
    state: GameState,
    playerId: number,
    sharedCache?: EntityCache
): Action[] {
    const player = state.players[playerId];
    if (!player) {
        return [];
    }

    const actions = computeClassicAiActions(state, playerId, sharedCache);

    const cache = sharedCache ?? createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId);
    const runtimeState = getEngineerConyardRushRuntimeState(playerId);

    initializeRuntimeState(runtimeState, myBuildings);

    const enemyConyards = enemies.filter(entity =>
        isAliveConyard(entity) &&
        !runtimeState.initialOwnedConyardIds.has(entity.id)
    );

    const engineers = myUnits
        .filter(unit => unit.type === 'UNIT' && unit.key === 'engineer' && !unit.dead)
        .map(unit => unit as UnitEntity);

    trackEnemyConyards(runtimeState, enemyConyards);
    enqueueEngineerProduction(actions, player, myBuildings, engineers.length, enemyConyards.length);
    actions.push(...getEngineerRushActions(state, engineers, enemyConyards, runtimeState));
    actions.push(...getCapturedConyardSellActions(state, playerId, runtimeState));

    return actions;
}

export const EngineerConyardRushAIImplementation: AIImplementation = {
    id: 'engineer_conyard_rush',
    name: 'Engineer Conyard Rush',
    description: 'Prioritizes engineer captures on enemy construction yards and instantly sells captured yards.',
    computeActions: ({ state, playerId, entityCache }) => computeEngineerConyardRushAiActions(state, playerId, entityCache),
    reset: resetEngineerConyardRushRuntimeState
};

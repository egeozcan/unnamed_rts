import { Action, Entity, EntityId, GameState, isActionType, PlayerState, UnitEntity } from '../../../types.js';
import { createEntityCache, EntityCache, getBuildingsForOwner, getEnemiesOf, getUnitsForOwner } from '../../../perf.js';
import { getTransportCapacity, getTransportPassengers, isTransportedUnit } from '../../../transport.js';
import { AIImplementation } from '../../contracts.js';
import { computeClassicAiActions } from '../classic/index.js';
import { getEngineerConyardRushRuntimeState, resetEngineerConyardRushRuntimeState } from './state.js';

const ENGINEERS_PER_ENEMY_CONYARD = 2;
const MIN_ENGINEER_FORCE = 3;
const MIN_APC_FORCE = 1;
const DEFAULT_APC_CAPACITY = 5;
const APC_UNLOAD_RANGE = 120;
const APC_KEY = 'apc';

function isAliveConyard(entity: Entity): boolean {
    return entity.type === 'BUILDING' && entity.key === 'conyard' && !entity.dead;
}

function countQueuedByKey(queue: PlayerState['queues'][keyof PlayerState['queues']], key: string): number {
    let queuedCount = queue.current === key ? 1 : 0;
    for (const queued of queue.queued ?? []) {
        if (queued === key) queuedCount += 1;
    }
    return queuedCount;
}

function countQueuedEngineers(player: PlayerState): number {
    return countQueuedByKey(player.queues.infantry, 'engineer');
}

function countQueuedApcs(player: PlayerState): number {
    return countQueuedByKey(player.queues.vehicle, APC_KEY);
}

function hasBuildingBuildPlanned(player: PlayerState, actions: Action[], key: 'barracks' | 'factory'): boolean {
    if (player.readyToPlace === key) return true;
    if (player.queues.building.current === key) return true;
    if ((player.queues.building.queued ?? []).includes(key)) return true;

    return actions.some(action =>
        isActionType(action, 'START_BUILD') &&
        action.payload.playerId === player.id &&
        action.payload.category === 'building' &&
        action.payload.key === key
    );
}

function hasBarracksBuildPlanned(player: PlayerState, actions: Action[]): boolean {
    return hasBuildingBuildPlanned(player, actions, 'barracks');
}

function hasFactoryBuildPlanned(player: PlayerState, actions: Action[]): boolean {
    return hasBuildingBuildPlanned(player, actions, 'factory');
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

function enqueueApcProduction(
    actions: Action[],
    player: PlayerState,
    myBuildings: Entity[],
    currentApcCount: number,
    currentEngineerCount: number,
    enemyConyardCount: number
): void {
    if (enemyConyardCount <= 0) {
        return;
    }

    const hasFactory = myBuildings.some(b => b.key === 'factory' && !b.dead);
    if (!hasFactory && !hasFactoryBuildPlanned(player, actions)) {
        actions.push({
            type: 'START_BUILD',
            payload: { category: 'building', key: 'factory', playerId: player.id }
        });
        return;
    }

    const desiredEngineerCount = Math.max(MIN_ENGINEER_FORCE, enemyConyardCount * ENGINEERS_PER_ENEMY_CONYARD);
    const projectedEngineerCount = Math.max(currentEngineerCount, desiredEngineerCount);
    const desiredApcCount = Math.max(MIN_APC_FORCE, Math.ceil(projectedEngineerCount / DEFAULT_APC_CAPACITY));
    const projectedApcs = currentApcCount + countQueuedApcs(player);

    if (projectedApcs >= desiredApcCount) {
        return;
    }

    actions.push({
        type: 'START_BUILD',
        payload: { category: 'vehicle', key: APC_KEY, playerId: player.id }
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

function selectRotatingConyardTarget(
    unit: UnitEntity,
    enemyConyardsById: Map<EntityId, Entity>,
    conyardsByOwner: Map<number, Entity[]>,
    enemyOwners: number[],
    claimedTargets: Set<EntityId>,
    ownerCursor: number
): { target: Entity | null; ownerCursor: number } {
    const currentTargetId = unit.combat.targetId ?? null;
    if (currentTargetId) {
        const currentTarget = enemyConyardsById.get(currentTargetId);
        if (currentTarget && currentTarget.owner !== unit.owner && !currentTarget.dead) {
            claimedTargets.add(currentTarget.id);
            return { target: currentTarget, ownerCursor };
        }
    }

    let assignedTarget: Entity | null = null;
    let selectedOwnerOffset = 0;
    for (let offset = 0; offset < enemyOwners.length; offset++) {
        const ownerId = enemyOwners[(ownerCursor + offset) % enemyOwners.length];
        const ownerConyards = conyardsByOwner.get(ownerId) ?? [];
        const target = selectEngineerTarget(unit, ownerConyards, claimedTargets);
        if (!target) continue;

        assignedTarget = target;
        selectedOwnerOffset = offset;
        break;
    }

    if (!assignedTarget) {
        return { target: null, ownerCursor };
    }

    const nextCursor = (ownerCursor + selectedOwnerOffset + 1) % enemyOwners.length;
    claimedTargets.add(assignedTarget.id);
    return { target: assignedTarget, ownerCursor: nextCursor };
}

function findNearestAvailableApc(
    engineer: UnitEntity,
    apcs: UnitEntity[],
    seatsByApc: Map<EntityId, number>
): UnitEntity | null {
    let bestApc: UnitEntity | null = null;
    let bestDistance = Infinity;
    for (const apc of apcs) {
        const seats = seatsByApc.get(apc.id) ?? 0;
        if (seats <= 0) continue;

        const distance = engineer.pos.dist(apc.pos);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestApc = apc;
            continue;
        }
        if (distance === bestDistance && bestApc && apc.id.localeCompare(bestApc.id) < 0) {
            bestApc = apc;
        }
    }
    return bestApc;
}

function getEngineerRushActions(
    state: GameState,
    engineers: UnitEntity[],
    apcs: UnitEntity[],
    enemyConyards: Entity[],
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>
): Action[] {
    const actions: Action[] = [];
    if (enemyConyards.length === 0) {
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

    const enemyConyardsById = new Map<EntityId, Entity>();
    for (const conyard of enemyConyards) {
        enemyConyardsById.set(conyard.id, conyard);
    }

    const sortedApcs = [...apcs].sort((a, b) => a.id.localeCompare(b.id));
    const seatsByApc = new Map<EntityId, number>();
    const passengersByApc = new Map<EntityId, UnitEntity[]>();
    for (const apc of sortedApcs) {
        const passengers = getTransportPassengers(state.entities, apc.id)
            .filter(passenger => passenger.owner === apc.owner && !passenger.dead)
            .sort((a, b) => a.id.localeCompare(b.id));
        passengersByApc.set(apc.id, passengers);
        seatsByApc.set(apc.id, Math.max(0, getTransportCapacity(apc) - passengers.length));
    }

    const claimedTargets = new Set<EntityId>();

    for (const apc of sortedApcs) {
        const passengers = passengersByApc.get(apc.id) ?? [];
        if (passengers.length === 0) {
            continue;
        }

        const selectedTarget = selectRotatingConyardTarget(
            apc,
            enemyConyardsById,
            conyardsByOwner,
            enemyOwners,
            claimedTargets,
            ownerCursor
        );
        ownerCursor = selectedTarget.ownerCursor;

        if (!selectedTarget.target) {
            continue;
        }

        const target = selectedTarget.target;
        if (apc.pos.dist(target.pos) <= APC_UNLOAD_RANGE) {
            actions.push({
                type: 'COMMAND_UNGARRISON',
                payload: { unitIds: [apc.id] }
            });

            const passengerEngineers = passengers
                .filter(passenger => passenger.key === 'engineer')
                .map(passenger => passenger.id);
            if (passengerEngineers.length > 0) {
                actions.push({
                    type: 'COMMAND_ATTACK',
                    payload: { unitIds: passengerEngineers, targetId: target.id }
                });
            }
        } else {
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: { unitIds: [apc.id], targetId: target.id }
            });
        }
    }

    const sortedEngineers = [...engineers]
        .filter(engineer => !isTransportedUnit(engineer))
        .sort((a, b) => a.id.localeCompare(b.id));

    for (const engineer of sortedEngineers) {
        const boardingApc = findNearestAvailableApc(engineer, sortedApcs, seatsByApc);
        if (boardingApc) {
            seatsByApc.set(boardingApc.id, Math.max(0, (seatsByApc.get(boardingApc.id) ?? 0) - 1));
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: { unitIds: [engineer.id], targetId: boardingApc.id }
            });
            continue;
        }

        const selectedTarget = selectRotatingConyardTarget(
            engineer,
            enemyConyardsById,
            conyardsByOwner,
            enemyOwners,
            claimedTargets,
            ownerCursor
        );
        ownerCursor = selectedTarget.ownerCursor;
        if (!selectedTarget.target) continue;

        actions.push({
            type: 'COMMAND_ATTACK',
            payload: { unitIds: [engineer.id], targetId: selectedTarget.target.id }
        });
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
    const enemies = getEnemiesOf(cache, playerId, state);
    const runtimeState = getEngineerConyardRushRuntimeState(playerId);

    initializeRuntimeState(runtimeState, myBuildings);

    let allEngineerCount = 0;
    for (const id in state.entities) {
        const entity = state.entities[id];
        if (entity.type === 'UNIT' && entity.owner === playerId && entity.key === 'engineer' && !entity.dead) {
            allEngineerCount += 1;
        }
    }

    const enemyConyards = enemies.filter(entity =>
        isAliveConyard(entity) &&
        !runtimeState.initialOwnedConyardIds.has(entity.id)
    );

    const engineers = myUnits
        .filter(unit => unit.type === 'UNIT' && unit.key === 'engineer' && !unit.dead)
        .map(unit => unit as UnitEntity);
    const apcs = myUnits
        .filter(unit => unit.type === 'UNIT' && unit.key === APC_KEY && !unit.dead)
        .map(unit => unit as UnitEntity);

    trackEnemyConyards(runtimeState, enemyConyards);
    enqueueEngineerProduction(actions, player, myBuildings, allEngineerCount, enemyConyards.length);
    enqueueApcProduction(actions, player, myBuildings, apcs.length, allEngineerCount, enemyConyards.length);
    actions.push(...getEngineerRushActions(state, engineers, apcs, enemyConyards, runtimeState));
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

import { Action, Entity, EntityId, GameState, isActionType, PlayerState, UnitEntity } from '../../../types.js';
import { createEntityCache, EntityCache, getBuildingsForOwner, getEnemiesOf, getUnitsForOwner } from '../../../perf.js';
import { getTransportCapacity, getTransportPassengers, isTransportedUnit } from '../../../transport.js';
import { AIImplementation } from '../../contracts.js';
import { checkPrerequisites } from '../../utils.js';
import { computeClassicAiActions } from '../classic/index.js';
import { getEngineerConyardRushRuntimeState, resetEngineerConyardRushRuntimeState } from './state.js';
import { RULES } from '../../../../data/schemas/index.js';

const ENGINEERS_PER_ENEMY_CONYARD = 2;
const MIN_ENGINEER_FORCE = 3;
const MIN_APC_FORCE = 1;
const DEFAULT_APC_CAPACITY = 5;
const APC_UNLOAD_RANGE = 120;
const APC_KEY = 'apc';
const MIN_DEFENSES_AFTER_CAPTURE = 5;
const DEFENSES_PER_CONYARD = 2;
const MIN_REFINERIES_AFTER_CAPTURE = 2;
const MAX_REFINERIES_AFTER_CAPTURE = 4;
const MIN_HARVESTERS_AFTER_CAPTURE = 4;
const HARVESTERS_PER_REFINERY_AFTER_CAPTURE = 2;
const CRITICAL_POST_CAPTURE_POWER_MARGIN = 0;
const LOW_POST_CAPTURE_POWER_MARGIN = 20;
const POST_CAPTURE_LOW_PRIORITY_BUILDINGS = new Set(['tech', 'airforce_command']);
const DEFENSE_BUILD_ORDER = ['turret', 'sam_site', 'pillbox', 'obelisk'] as const;

type StartBuildAction = Extract<Action, { type: 'START_BUILD' }>;

function isAliveConyard(entity: Entity): boolean {
    return entity.type === 'BUILDING' && entity.key === 'conyard' && !entity.dead;
}

function isAliveRefinery(entity: Entity): boolean {
    return entity.type === 'BUILDING' && entity.key === 'refinery' && !entity.dead;
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

function isStartBuildAction(action: Action): action is StartBuildAction {
    return isActionType(action, 'START_BUILD');
}

function isDefenseBuildingKey(key: string): boolean {
    return Boolean(RULES.buildings[key]?.isDefense);
}

function countStartBuildActions(
    actions: Action[],
    playerId: number,
    category: StartBuildAction['payload']['category'],
    key?: string
): number {
    let count = 0;
    for (const action of actions) {
        if (!isStartBuildAction(action)) continue;
        if (action.payload.playerId !== playerId) continue;
        if (action.payload.category !== category) continue;
        if (key && action.payload.key !== key) continue;
        count += 1;
    }
    return count;
}

function countDefenseStartBuildActions(actions: Action[], playerId: number): number {
    let count = 0;
    for (const action of actions) {
        if (!isStartBuildAction(action)) continue;
        if (action.payload.playerId !== playerId) continue;
        if (action.payload.category !== 'building') continue;
        if (!isDefenseBuildingKey(action.payload.key)) continue;
        count += 1;
    }
    return count;
}

function countQueuedDefenseBuildings(player: PlayerState): number {
    let count = 0;
    if (player.readyToPlace && isDefenseBuildingKey(player.readyToPlace)) {
        count += 1;
    }
    if (player.queues.building.current && isDefenseBuildingKey(player.queues.building.current)) {
        count += 1;
    }
    for (const queued of player.queues.building.queued ?? []) {
        if (isDefenseBuildingKey(queued)) {
            count += 1;
        }
    }
    return count;
}

function countQueuedRefineries(player: PlayerState): number {
    let count = 0;
    if (player.readyToPlace === 'refinery') {
        count += 1;
    }
    if (player.queues.building.current === 'refinery') {
        count += 1;
    }
    for (const queued of player.queues.building.queued ?? []) {
        if (queued === 'refinery') {
            count += 1;
        }
    }
    return count;
}

function hasBuildingLaneResolutionAction(actions: Action[], playerId: number): boolean {
    return actions.some(action =>
        ((isActionType(action, 'PLACE_BUILDING') && action.payload.playerId === playerId) ||
            (isActionType(action, 'CANCEL_BUILD') && action.payload.playerId === playerId))
    );
}

function isBuildingLaneBlocked(player: PlayerState, actions: Action[]): boolean {
    if (player.queues.building.current) return true;
    if (player.readyToPlace && !hasBuildingLaneResolutionAction(actions, player.id)) {
        return true;
    }
    if ((player.queues.building.queued ?? []).length > 0) return true;
    return false;
}

function hasVehicleQueuePlanned(player: PlayerState, actions: Action[]): boolean {
    if (player.queues.vehicle.current) return true;
    if ((player.queues.vehicle.queued ?? []).length > 0) return true;
    return actions.some(action =>
        isStartBuildAction(action) &&
        action.payload.playerId === player.id &&
        action.payload.category === 'vehicle'
    );
}

function upsertBuildingStartAction(
    actions: Action[],
    player: PlayerState,
    key: string,
    myBuildings: Entity[]
): boolean {
    if (!checkPrerequisites(key, myBuildings)) {
        return false;
    }
    const cost = RULES.buildings[key]?.cost;
    if (cost === undefined || player.credits < cost) {
        return false;
    }

    const existingBuildIndex = actions.findIndex(action =>
        isStartBuildAction(action) &&
        action.payload.playerId === player.id &&
        action.payload.category === 'building'
    );

    const nextAction: Action = {
        type: 'START_BUILD',
        payload: { category: 'building', key, playerId: player.id }
    };

    if (existingBuildIndex >= 0) {
        actions[existingBuildIndex] = nextAction;
        return true;
    }

    actions.push(nextAction);
    return true;
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

function trackEnemyRefineries(runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>, enemyRefineries: Entity[]): void {
    for (const refinery of enemyRefineries) {
        runtimeState.trackedEnemyRefineryIds.add(refinery.id);
    }
}

function updateCaptureTracking(
    state: GameState,
    playerId: number,
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>
): void {
    for (const conyardId of Array.from(runtimeState.trackedEnemyConyardIds)) {
        const conyard = state.entities[conyardId];
        if (!conyard || !isAliveConyard(conyard) || runtimeState.initialOwnedConyardIds.has(conyardId)) {
            runtimeState.trackedEnemyConyardIds.delete(conyardId);
            continue;
        }

        if (conyard.owner === playerId) {
            runtimeState.successfulCapturedConyardIds.add(conyardId);
        }
    }
}

function getCapturedRefinerySellActions(
    state: GameState,
    playerId: number,
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>
): Action[] {
    const actions: Action[] = [];
    for (const refineryId of Array.from(runtimeState.trackedEnemyRefineryIds)) {
        const refinery = state.entities[refineryId];
        if (!refinery || !isAliveRefinery(refinery) || runtimeState.initialOwnedRefineryIds.has(refineryId)) {
            runtimeState.trackedEnemyRefineryIds.delete(refineryId);
            continue;
        }

        if (refinery.owner === playerId) {
            actions.push({
                type: 'SELL_BUILDING',
                payload: { buildingId: refineryId, playerId }
            });
            runtimeState.trackedEnemyRefineryIds.delete(refineryId);
        }
    }
    return actions;
}

function removePostCaptureRushBuilds(actions: Action[], playerId: number): Action[] {
    return actions.filter(action => {
        if (!isStartBuildAction(action)) return true;
        if (action.payload.playerId !== playerId) return true;
        if (action.payload.category === 'infantry' && action.payload.key === 'engineer') {
            return false;
        }
        if (action.payload.category === 'vehicle' && action.payload.key === APC_KEY) {
            return false;
        }
        return true;
    });
}

function removeLowPriorityPostCaptureBuildingBuilds(actions: Action[], playerId: number): Action[] {
    return actions.filter(action => {
        if (!isStartBuildAction(action)) return true;
        if (action.payload.playerId !== playerId) return true;
        if (action.payload.category !== 'building') return true;
        return !POST_CAPTURE_LOW_PRIORITY_BUILDINGS.has(action.payload.key);
    });
}

function removeHealthyMarginPostCapturePowerBuilds(
    actions: Action[],
    playerId: number,
    powerMargin: number
): Action[] {
    if (powerMargin <= CRITICAL_POST_CAPTURE_POWER_MARGIN) {
        return actions;
    }

    return actions.filter(action => {
        if (!isStartBuildAction(action)) return true;
        if (action.payload.playerId !== playerId) return true;
        if (action.payload.category !== 'building') return true;
        return action.payload.key !== 'power';
    });
}

function queuePostCaptureBuildingPriority(
    actions: Action[],
    player: PlayerState,
    myBuildings: Entity[],
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>
): void {
    const hasConyard = myBuildings.some(isAliveConyard);
    if (!hasConyard) {
        return;
    }
    if (isBuildingLaneBlocked(player, actions)) {
        return;
    }

    const powerMargin = player.maxPower - player.usedPower;
    if (powerMargin <= CRITICAL_POST_CAPTURE_POWER_MARGIN &&
        upsertBuildingStartAction(actions, player, 'power', myBuildings)) {
        return;
    }

    const hasBarracks = myBuildings.some(building => building.type === 'BUILDING' && building.key === 'barracks' && !building.dead);
    if (!hasBarracks && !hasBarracksBuildPlanned(player, actions) &&
        upsertBuildingStartAction(actions, player, 'barracks', myBuildings)) {
        return;
    }

    const hasFactory = myBuildings.some(building => building.type === 'BUILDING' && building.key === 'factory' && !building.dead);
    if (!hasFactory && !hasFactoryBuildPlanned(player, actions) &&
        upsertBuildingStartAction(actions, player, 'factory', myBuildings)) {
        return;
    }

    const aliveConyards = myBuildings.filter(isAliveConyard);
    const capturedConyards = aliveConyards.filter(conyard => !runtimeState.initialOwnedConyardIds.has(conyard.id));
    const desiredDefenseCount = Math.max(
        MIN_DEFENSES_AFTER_CAPTURE,
        capturedConyards.length * DEFENSES_PER_CONYARD + 3
    );
    const defenseFloor = Math.max(3, capturedConyards.length + 2);
    const currentDefenseCount = myBuildings.filter(building =>
        building.type === 'BUILDING' && !building.dead && isDefenseBuildingKey(building.key)
    ).length;
    const projectedDefenseCount = currentDefenseCount +
        countQueuedDefenseBuildings(player) +
        countDefenseStartBuildActions(actions, player.id);

    const currentRefineryCount = myBuildings.filter(building =>
        building.type === 'BUILDING' && !building.dead && building.key === 'refinery'
    ).length;
    const desiredRefineryCount = Math.min(
        MAX_REFINERIES_AFTER_CAPTURE,
        Math.max(MIN_REFINERIES_AFTER_CAPTURE, capturedConyards.length + 2)
    );
    const projectedRefineryCount = currentRefineryCount +
        countQueuedRefineries(player) +
        countStartBuildActions(actions, player.id, 'building', 'refinery');

    if (projectedDefenseCount < defenseFloor) {
        for (const defenseKey of DEFENSE_BUILD_ORDER) {
            if (upsertBuildingStartAction(actions, player, defenseKey, myBuildings)) {
                return;
            }
        }
    }

    if (projectedRefineryCount < desiredRefineryCount &&
        upsertBuildingStartAction(actions, player, 'refinery', myBuildings)) {
        return;
    }

    if (projectedDefenseCount < desiredDefenseCount) {
        for (const defenseKey of DEFENSE_BUILD_ORDER) {
            if (upsertBuildingStartAction(actions, player, defenseKey, myBuildings)) {
                return;
            }
        }
    }

    if (powerMargin < LOW_POST_CAPTURE_POWER_MARGIN) {
        upsertBuildingStartAction(actions, player, 'power', myBuildings);
    }
}

function enforcePostCaptureHarvesterBias(
    actions: Action[],
    player: PlayerState,
    myBuildings: Entity[],
    myUnits: Entity[],
    successfulCaptureCount: number
): Action[] {
    const hasFactory = myBuildings.some(building => building.type === 'BUILDING' && building.key === 'factory' && !building.dead);
    if (!hasFactory) {
        return actions;
    }

    const refineryCount = myBuildings.filter(building =>
        building.type === 'BUILDING' && building.key === 'refinery' && !building.dead
    ).length;
    if (refineryCount === 0) {
        return actions;
    }

    const desiredHarvesterCount = Math.max(
        MIN_HARVESTERS_AFTER_CAPTURE,
        refineryCount * HARVESTERS_PER_REFINERY_AFTER_CAPTURE + Math.min(successfulCaptureCount, 2)
    );
    const currentHarvesterCount = myUnits.filter(unit => unit.type === 'UNIT' && unit.key === 'harvester' && !unit.dead).length;
    const projectedHarvesterCount = currentHarvesterCount +
        countQueuedByKey(player.queues.vehicle, 'harvester') +
        countStartBuildActions(actions, player.id, 'vehicle', 'harvester');
    if (projectedHarvesterCount >= desiredHarvesterCount) {
        return actions;
    }

    if (!checkPrerequisites('harvester', myBuildings)) {
        return actions;
    }

    const harvesterCost = RULES.units.harvester?.cost ?? 0;
    if (player.credits < harvesterCost) {
        return actions;
    }

    let replacedVehicleBuild = false;
    const remappedActions: Action[] = actions.map(action => {
        if (!isStartBuildAction(action)) {
            return action;
        }
        if (action.payload.playerId !== player.id) {
            return action;
        }
        if (action.payload.category !== 'vehicle') {
            return action;
        }
        if (action.payload.key === 'harvester' || action.payload.key === 'mcv') {
            return action;
        }
        if (replacedVehicleBuild) {
            return action;
        }
        replacedVehicleBuild = true;
        return {
            type: 'START_BUILD',
            payload: { category: 'vehicle', key: 'harvester', playerId: player.id }
        } satisfies Action;
    });

    if (replacedVehicleBuild || hasVehicleQueuePlanned(player, remappedActions)) {
        return remappedActions;
    }

    remappedActions.push({
        type: 'START_BUILD',
        payload: { category: 'vehicle', key: 'harvester', playerId: player.id }
    } satisfies Action);
    return remappedActions;
}

function initializeRuntimeState(runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>, myBuildings: Entity[]): void {
    if (runtimeState.initialized) return;

    for (const building of myBuildings) {
        if (isAliveConyard(building)) {
            runtimeState.initialOwnedConyardIds.add(building.id);
            continue;
        }
        if (isAliveRefinery(building)) {
            runtimeState.initialOwnedRefineryIds.add(building.id);
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

    let actions = computeClassicAiActions(state, playerId, sharedCache);

    const cache = sharedCache ?? createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId, state);
    const runtimeState = getEngineerConyardRushRuntimeState(playerId);

    initializeRuntimeState(runtimeState, myBuildings);

    const enemyConyards = enemies.filter(entity =>
        isAliveConyard(entity) &&
        !runtimeState.initialOwnedConyardIds.has(entity.id)
    );
    const enemyRefineries = enemies.filter(entity =>
        isAliveRefinery(entity) &&
        !runtimeState.initialOwnedRefineryIds.has(entity.id)
    );

    trackEnemyConyards(runtimeState, enemyConyards);
    trackEnemyRefineries(runtimeState, enemyRefineries);
    updateCaptureTracking(state, playerId, runtimeState);

    const hasSuccessfulCapture = runtimeState.successfulCapturedConyardIds.size > 0;
    if (hasSuccessfulCapture) {
        actions = removeLowPriorityPostCaptureBuildingBuilds(actions, playerId);
        actions = removeHealthyMarginPostCapturePowerBuilds(
            actions,
            playerId,
            player.maxPower - player.usedPower
        );
        queuePostCaptureBuildingPriority(actions, player, myBuildings, runtimeState);
        actions = enforcePostCaptureHarvesterBias(
            actions,
            player,
            myBuildings,
            myUnits,
            runtimeState.successfulCapturedConyardIds.size
        );
        if (enemyConyards.length === 0) {
            actions = removePostCaptureRushBuilds(actions, playerId);
        }
    }

    let allEngineerCount = 0;
    for (const id in state.entities) {
        const entity = state.entities[id];
        if (entity.type === 'UNIT' && entity.owner === playerId && entity.key === 'engineer' && !entity.dead) {
            allEngineerCount += 1;
        }
    }

    const engineers = myUnits
        .filter(unit => unit.type === 'UNIT' && unit.key === 'engineer' && !unit.dead)
        .map(unit => unit as UnitEntity);
    const apcs = myUnits
        .filter(unit => unit.type === 'UNIT' && unit.key === APC_KEY && !unit.dead)
        .map(unit => unit as UnitEntity);

    if (enemyConyards.length > 0) {
        enqueueEngineerProduction(actions, player, myBuildings, allEngineerCount, enemyConyards.length);
        enqueueApcProduction(actions, player, myBuildings, apcs.length, allEngineerCount, enemyConyards.length);
        actions.push(...getEngineerRushActions(state, engineers, apcs, enemyConyards, runtimeState));
    }
    actions.push(...getCapturedRefinerySellActions(state, playerId, runtimeState));

    return actions;
}

export const EngineerConyardRushAIImplementation: AIImplementation = {
    id: 'engineer_conyard_rush',
    name: 'Engineer Conyard Rush',
    description: 'Prioritizes enemy conyard captures, then fortifies captured ground and pivots into economic scaling.',
    computeActions: ({ state, playerId, entityCache }) => computeEngineerConyardRushAiActions(state, playerId, entityCache),
    reset: resetEngineerConyardRushRuntimeState
};

import { Action, Entity, EntityId, GameState, isActionType, PlayerState, UnitEntity } from '../../../types.js';
import { createEntityCache, EntityCache, getBuildingsForOwner, getEnemiesOf, getUnitsForOwner } from '../../../perf.js';
import { getTransportCapacity, getTransportPassengers, isTransportedUnit } from '../../../transport.js';
import { AIImplementation } from '../../contracts.js';
import { checkPrerequisites } from '../../utils.js';
import { AuroraSovereignAIImplementation, computeAuroraSovereignAiActions } from '../aurora_sovereign/index.js';
import { getEngineerConyardRushRuntimeState, resetEngineerConyardRushRuntimeState } from './state.js';
import { RULES } from '../../../../data/schemas/index.js';

const ENGINEERS_PER_ENEMY_CONYARD = 2;
const MIN_ENGINEER_FORCE = 2;
const MIN_APC_FORCE = 1;
const DEFAULT_APC_CAPACITY = 5;
const APC_UNLOAD_RANGE = 95;
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
const BASE_CAPTURE_VALUES: Readonly<Record<string, number>> = {
    conyard: 10000,
    barracks: 8500,
    power: 7500,
    factory: 6500,
    refinery: 6000,
    tech: 5500,
    airforce_command: 5000
};
const DEFAULT_BASE_CAPTURE_VALUE = 2500;
const DEFENSE_THREAT_RADIUS = 340;
const MOBILE_THREAT_RADIUS = 220;
const ENGINEER_THREAT_PENALTY = 900;
const APC_THREAT_PENALTY = 500;
const CLAIMED_TARGET_PENALTY = 6000;
const OWNER_ROTATION_BONUS = 450;
const STAGING_BARRACKS_REINFORCEMENT_COUNT = 2;
const RAID_PACKAGE_ENGINEER_COUNT = 2;
const RAID_ESCORT_COUNT = 2;
const RAID_FAILURE_GRACE_TICKS = 120;
const RAID_WAVE_TIMEOUT_TICKS = 2400;
const RAID_RECOVERY_TICKS = 1800;
const STAGING_BARRACKS_DANGER_RADIUS = 320;
const SHUTTLE_STAGING_DISTANCE = 100;
const ENABLE_RUSH_PRODUCTION = true;
const ENABLE_POST_CAPTURE_MACRO_BIAS = false;

type StartBuildAction = Extract<Action, { type: 'START_BUILD' }>;

function isAliveConyard(entity: Entity): boolean {
    return entity.type === 'BUILDING' && entity.key === 'conyard' && !entity.dead;
}

function isCapturableBaseBuilding(entity: Entity): boolean {
    return entity.type === 'BUILDING' &&
        !entity.dead &&
        RULES.buildings[entity.key]?.capturable === true;
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

function getProjectedEngineerCount(actions: Action[], player: PlayerState, currentEngineerCount: number): number {
    return currentEngineerCount +
        countQueuedEngineers(player) +
        countStartBuildActions(actions, player.id, 'infantry', 'engineer');
}

function getProjectedApcCount(actions: Action[], player: PlayerState, currentApcCount: number): number {
    return currentApcCount +
        countQueuedApcs(player) +
        countStartBuildActions(actions, player.id, 'vehicle', APC_KEY);
}

function isRaidEscort(entity: Entity): entity is UnitEntity {
    if (entity.type !== 'UNIT' || entity.dead) return false;
    if (entity.key === 'engineer' || entity.key === APC_KEY || entity.key === 'harvester' || entity.key === 'mcv') {
        return false;
    }
    return (RULES.units[entity.key]?.damage ?? 0) > 0;
}

function isStartBuildAction(action: Action): action is StartBuildAction {
    return isActionType(action, 'START_BUILD');
}

function allOwnedUnits(state: GameState, unitIds: EntityId[], playerId: number): boolean {
    return unitIds.every(unitId => {
        const unit = state.entities[unitId];
        return Boolean(unit && unit.type === 'UNIT' && unit.owner === playerId && !unit.dead);
    });
}

function isOwnedBuilding(state: GameState, buildingId: EntityId, playerId: number): boolean {
    const building = state.entities[buildingId];
    return Boolean(building && building.type === 'BUILDING' && building.owner === playerId && !building.dead);
}

export function sanitizeEngineerConyardRushActions(actions: Action[], state: GameState, playerId: number): Action[] {
    return actions.filter(action => {
        switch (action.type) {
            case 'START_BUILD':
            case 'PLACE_BUILDING':
            case 'CANCEL_BUILD':
                return action.payload.playerId === playerId;
            case 'COMMAND_MOVE':
            case 'COMMAND_ATTACK_MOVE':
            case 'COMMAND_UNGARRISON':
            case 'SET_STANCE':
                return allOwnedUnits(state, action.payload.unitIds, playerId);
            case 'COMMAND_ATTACK':
                return allOwnedUnits(state, action.payload.unitIds, playerId);
            case 'SELL_BUILDING':
            case 'START_REPAIR':
            case 'STOP_REPAIR':
                return action.payload.playerId === playerId &&
                    isOwnedBuilding(state, action.payload.buildingId, playerId);
            case 'SET_RALLY_POINT':
                return isOwnedBuilding(state, action.payload.buildingId, playerId);
            case 'SET_PRIMARY_BUILDING':
                return action.payload.playerId === playerId &&
                    isOwnedBuilding(state, action.payload.buildingId, playerId);
            case 'DEPLOY_MCV':
            case 'DEPLOY_INDUCTION_RIG': {
                const unit = state.entities[action.payload.unitId];
                return Boolean(unit && unit.type === 'UNIT' && unit.owner === playerId && !unit.dead);
            }
            case 'QUEUE_UNIT':
            case 'DEQUEUE_UNIT':
                return action.payload.playerId === playerId;
            case 'TICK':
            case 'CANCEL_PLACEMENT':
            case 'SELECT_UNITS':
            case 'TOGGLE_SELL_MODE':
            case 'TOGGLE_REPAIR_MODE':
            case 'TOGGLE_DEBUG':
            case 'TOGGLE_MINIMAP':
            case 'TOGGLE_BIRDS_EYE':
            case 'TOGGLE_ATTACK_MOVE_MODE':
                return false;
        }
    });
}

function isDefenseBuildingKey(key: string): boolean {
    return Boolean(RULES.buildings[key]?.isDefense);
}

function getBuildingPowerMargin(key: string): number {
    const data = RULES.buildings[key];
    if (!data) return 0;
    return (data.power ?? 0) - (data.drain ?? 0);
}

function calculatePowerMarginFromBuildings(myBuildings: Entity[]): number {
    let margin = 0;
    for (const building of myBuildings) {
        if (building.type !== 'BUILDING' || building.dead) continue;
        margin += getBuildingPowerMargin(building.key);
    }
    return margin;
}

function calculateProjectedPowerMargin(player: PlayerState, myBuildings: Entity[], actions: Action[]): number {
    let margin = calculatePowerMarginFromBuildings(myBuildings);
    if (player.readyToPlace && actions.some(action =>
        isActionType(action, 'PLACE_BUILDING') &&
        action.payload.playerId === player.id &&
        action.payload.key === player.readyToPlace
    )) {
        margin += getBuildingPowerMargin(player.readyToPlace);
    }
    return margin;
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

function upsertRushUnitStartAction(
    actions: Action[],
    player: PlayerState,
    category: 'infantry' | 'vehicle',
    key: string,
    protectedKeys: ReadonlySet<string> = new Set()
): boolean {
    if (player.queues[category].current || (player.queues[category].queued ?? []).length > 0) {
        return false;
    }

    const existingBuildIndex = actions.findIndex(action =>
        isStartBuildAction(action) &&
        action.payload.playerId === player.id &&
        action.payload.category === category
    );
    if (existingBuildIndex >= 0) {
        const existingAction = actions[existingBuildIndex];
        if (isStartBuildAction(existingAction) && protectedKeys.has(existingAction.payload.key)) {
            return false;
        }
        actions[existingBuildIndex] = {
            type: 'START_BUILD',
            payload: { category, key, playerId: player.id }
        };
        return true;
    }

    actions.push({
        type: 'START_BUILD',
        payload: { category, key, playerId: player.id }
    });
    return true;
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

function hasBuildingBuildPlanned(player: PlayerState, actions: Action[], key: string): boolean {
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
    if (!hasBarracks) {
        return;
    }

    const desiredEngineerCount = Math.max(MIN_ENGINEER_FORCE, enemyConyardCount * ENGINEERS_PER_ENEMY_CONYARD);
    const projectedEngineers = getProjectedEngineerCount(actions, player, currentEngineerCount);
    if (projectedEngineers >= desiredEngineerCount) {
        return;
    }

    if (!checkPrerequisites('engineer', myBuildings)) {
        return;
    }
    const engineerCost = RULES.units.engineer?.cost ?? Infinity;
    if (player.credits < engineerCost) {
        return;
    }

    upsertRushUnitStartAction(actions, player, 'infantry', 'engineer');
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
    if (!hasFactory) {
        return;
    }

    const desiredEngineerCount = Math.max(MIN_ENGINEER_FORCE, enemyConyardCount * ENGINEERS_PER_ENEMY_CONYARD);
    const projectedEngineerCount = Math.max(
        getProjectedEngineerCount(actions, player, currentEngineerCount),
        desiredEngineerCount
    );
    const desiredApcCount = Math.max(MIN_APC_FORCE, Math.ceil(projectedEngineerCount / DEFAULT_APC_CAPACITY));
    const projectedApcs = currentApcCount +
        countQueuedApcs(player) +
        countStartBuildActions(actions, player.id, 'vehicle', APC_KEY);

    if (projectedApcs >= desiredApcCount) {
        return;
    }

    if (!checkPrerequisites(APC_KEY, myBuildings)) {
        return;
    }
    const apcCost = RULES.units[APC_KEY]?.cost ?? Infinity;
    if (player.credits < apcCost) {
        return;
    }

    upsertRushUnitStartAction(actions, player, 'vehicle', APC_KEY, new Set(['harvester', 'mcv']));
}

function isEnemyThreat(entity: Entity, target: Entity, actingPlayerId: number): boolean {
    if (entity.dead || entity.owner === actingPlayerId || entity.owner === -1) return false;
    if (entity.type === 'BUILDING') {
        const buildingData = RULES.buildings[entity.key];
        return Boolean(buildingData?.isDefense && entity.pos.dist(target.pos) <= DEFENSE_THREAT_RADIUS);
    }
    if (entity.type === 'UNIT') {
        const unitData = RULES.units[entity.key];
        const range = unitData?.range ?? 0;
        const damage = unitData?.damage ?? 0;
        return damage > 0 && entity.pos.dist(target.pos) <= Math.max(MOBILE_THREAT_RADIUS, range + 80);
    }
    return false;
}

function scoreConyardTarget(
    unit: UnitEntity,
    target: Entity,
    state: GameState,
    claimedTargets: Set<EntityId>,
    preferredOwnerId: number | null,
    isLoadedApc: boolean
): number {
    const distance = unit.pos.dist(target.pos);
    const threatCount = Object.values(state.entities).filter(entity =>
        isEnemyThreat(entity, target, unit.owner)
    ).length;
    const claimPenalty = claimedTargets.has(target.id) ? CLAIMED_TARGET_PENALTY : 0;
    const hpPenalty = target.hp / Math.max(1, target.maxHp) * 250;
    const threatPenalty = threatCount * (isLoadedApc ? APC_THREAT_PENALTY : ENGINEER_THREAT_PENALTY);
    const rotationBonus = preferredOwnerId !== null && target.owner === preferredOwnerId
        ? OWNER_ROTATION_BONUS
        : 0;

    const captureValue = BASE_CAPTURE_VALUES[target.key] ?? DEFAULT_BASE_CAPTURE_VALUE;
    return captureValue + rotationBonus - distance - threatPenalty - claimPenalty - hpPenalty;
}

function selectEngineerTarget(
    unit: UnitEntity,
    enemyConyards: Entity[],
    state: GameState,
    claimedTargets: Set<EntityId>,
    preferredOwnerId: number | null,
    isLoadedApc: boolean
): Entity | null {
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;

    for (const conyard of enemyConyards) {
        const score = scoreConyardTarget(unit, conyard, state, claimedTargets, preferredOwnerId, isLoadedApc);
        if (score > bestScore) {
            bestScore = score;
            bestTarget = conyard;
            continue;
        }
        if (score === bestScore && bestTarget && conyard.id.localeCompare(bestTarget.id) < 0) {
            bestTarget = conyard;
        }
    }

    return bestTarget;
}

function selectRotatingConyardTarget(
    unit: UnitEntity,
    state: GameState,
    enemyConyardsById: Map<EntityId, Entity>,
    conyardsByOwner: Map<number, Entity[]>,
    enemyOwners: number[],
    claimedTargets: Set<EntityId>,
    ownerCursor: number,
    isLoadedApc: boolean
): { target: Entity | null; ownerCursor: number } {
    const currentTargetId = unit.combat.targetId ?? null;
    if (currentTargetId) {
        const currentTarget = enemyConyardsById.get(currentTargetId);
        if (currentTarget && currentTarget.owner !== unit.owner && !currentTarget.dead) {
            claimedTargets.add(currentTarget.id);
            return { target: currentTarget, ownerCursor };
        }
    }

    const allConyards: Entity[] = [];
    for (const ownerId of enemyOwners) {
        allConyards.push(...(conyardsByOwner.get(ownerId) ?? []));
    }

    const preferredOwnerId = enemyOwners.length > 0
        ? enemyOwners[ownerCursor % enemyOwners.length]
        : null;
    const assignedTarget = selectEngineerTarget(
        unit,
        allConyards,
        state,
        claimedTargets,
        preferredOwnerId,
        isLoadedApc
    );

    if (!assignedTarget) {
        return { target: null, ownerCursor };
    }

    const selectedOwnerIndex = enemyOwners.indexOf(assignedTarget.owner);
    const nextCursor = selectedOwnerIndex >= 0
        ? (selectedOwnerIndex + 1) % enemyOwners.length
        : ownerCursor;
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

function getShuttleStagingPoint(
    state: GameState,
    apc: UnitEntity,
    enemies: Entity[],
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>
): { x: number; y: number } {
    const stagingBarracks = runtimeState.stagingBarracksId
        ? state.entities[runtimeState.stagingBarracksId]
        : null;
    if (!stagingBarracks || stagingBarracks.type !== 'BUILDING' || stagingBarracks.dead || stagingBarracks.owner !== apc.owner) {
        return { x: apc.pos.x, y: apc.pos.y };
    }

    const candidates = [
        { x: stagingBarracks.pos.x + SHUTTLE_STAGING_DISTANCE, y: stagingBarracks.pos.y },
        { x: stagingBarracks.pos.x - SHUTTLE_STAGING_DISTANCE, y: stagingBarracks.pos.y },
        { x: stagingBarracks.pos.x, y: stagingBarracks.pos.y + SHUTTLE_STAGING_DISTANCE },
        { x: stagingBarracks.pos.x, y: stagingBarracks.pos.y - SHUTTLE_STAGING_DISTANCE }
    ].map(point => ({
        x: Math.max(apc.radius, Math.min(state.config.width - apc.radius, point.x)),
        y: Math.max(apc.radius, Math.min(state.config.height - apc.radius, point.y))
    }));

    let safest = candidates[0];
    let safestDistance = -Infinity;
    for (const candidate of candidates) {
        let nearestThreatDistance = Infinity;
        for (const enemy of enemies) {
            if (enemy.dead || enemy.owner === -1 || enemy.owner === apc.owner) continue;
            if (enemy.type === 'UNIT' && (RULES.units[enemy.key]?.damage ?? 0) <= 0) continue;
            if (enemy.type === 'BUILDING' && !RULES.buildings[enemy.key]?.isDefense) continue;
            const dx = enemy.pos.x - candidate.x;
            const dy = enemy.pos.y - candidate.y;
            nearestThreatDistance = Math.min(nearestThreatDistance, Math.hypot(dx, dy));
        }
        if (nearestThreatDistance > safestDistance) {
            safest = candidate;
            safestDistance = nearestThreatDistance;
        }
    }
    return safest;
}

function addShuttleHoldActions(
    actions: Action[],
    state: GameState,
    apc: UnitEntity,
    enemies: Entity[],
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>
): void {
    const stagingPoint = getShuttleStagingPoint(state, apc, enemies, runtimeState);
    actions.push({
        type: 'SET_STANCE',
        payload: { unitIds: [apc.id], stance: 'hold_ground' }
    });
    actions.push({
        type: 'COMMAND_MOVE',
        payload: { unitIds: [apc.id], x: stagingPoint.x, y: stagingPoint.y }
    });
}

function getEngineerRushActions(
    state: GameState,
    engineers: UnitEntity[],
    apcs: UnitEntity[],
    escorts: UnitEntity[],
    enemies: Entity[],
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
        const passengerEngineers = passengers.filter(passenger => passenger.key === 'engineer');
        if (passengerEngineers.length < RAID_PACKAGE_ENGINEER_COUNT) {
            addShuttleHoldActions(actions, state, apc, enemies, runtimeState);
            continue;
        }
        if (escorts.length < runtimeState.requiredEscortCount) {
            addShuttleHoldActions(actions, state, apc, enemies, runtimeState);
            continue;
        }

        const selectedTarget = selectRotatingConyardTarget(
            apc,
            state,
            enemyConyardsById,
            conyardsByOwner,
            enemyOwners,
            claimedTargets,
            ownerCursor,
            true
        );
        ownerCursor = selectedTarget.ownerCursor;

        if (!selectedTarget.target) {
            addShuttleHoldActions(actions, state, apc, enemies, runtimeState);
            continue;
        }

        const target = selectedTarget.target;
        if (runtimeState.raidWaveStartTick === null) {
            runtimeState.activeRaidApcId = apc.id;
            runtimeState.activeRaidEngineerIds = new Set(
                passengerEngineers.slice(0, RAID_PACKAGE_ENGINEER_COUNT).map(engineer => engineer.id)
            );
            runtimeState.raidWaveStartTick = state.tick;
            runtimeState.raidWaveCaptureCountAtStart = runtimeState.successfulCapturedBuildingIds.size;
        }
        actions.push({
            type: 'SET_STANCE',
            payload: { unitIds: [apc.id], stance: 'hold_ground' }
        });

        if (runtimeState.activeRaidApcId === apc.id && escorts.length > 0) {
            const screen = [...escorts]
                .sort((a, b) => a.pos.dist(apc.pos) - b.pos.dist(apc.pos))
                .slice(0, RAID_ESCORT_COUNT);
            if (screen.length > 0) {
                actions.push({
                    type: 'COMMAND_ATTACK_MOVE',
                    payload: { unitIds: screen.map(unit => unit.id), x: target.pos.x, y: target.pos.y }
                });
            }
        }

        if (apc.pos.dist(target.pos) <= APC_UNLOAD_RANGE) {
            actions.push({
                type: 'COMMAND_UNGARRISON',
                payload: { unitIds: [apc.id] }
            });

            claimedTargets.delete(target.id);
            for (const passengerEngineer of passengerEngineers) {
                const passengerTarget = selectRotatingConyardTarget(
                    passengerEngineer,
                    state,
                    enemyConyardsById,
                    conyardsByOwner,
                    enemyOwners,
                    claimedTargets,
                    ownerCursor,
                    false
                );
                ownerCursor = passengerTarget.ownerCursor;
                if (!passengerTarget.target) continue;
                actions.push({
                    type: 'COMMAND_ATTACK',
                    payload: { unitIds: [passengerEngineer.id], targetId: passengerTarget.target.id }
                });
            }
        } else {
            actions.push({
                type: 'COMMAND_MOVE',
                payload: { unitIds: [apc.id], x: target.pos.x, y: target.pos.y }
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

        if (sortedApcs.length === 0) {
            actions.push({
                type: 'COMMAND_MOVE',
                payload: { unitIds: [engineer.id], x: engineer.pos.x, y: engineer.pos.y }
            });
            continue;
        }

        const selectedTarget = selectRotatingConyardTarget(
            engineer,
            state,
            enemyConyardsById,
            conyardsByOwner,
            enemyOwners,
            claimedTargets,
            ownerCursor,
            false
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

function trackEnemyBuildings(runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>, enemyBuildings: Entity[]): void {
    for (const building of enemyBuildings) {
        runtimeState.trackedEnemyBuildingIds.add(building.id);
    }
}

function updateCaptureTracking(
    state: GameState,
    playerId: number,
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>
): Action[] {
    const actions: Action[] = [];
    const currentEngineerIds = new Set(
        Object.values(state.entities)
            .filter(entity => entity.type === 'UNIT' && entity.owner === playerId && entity.key === 'engineer' && !entity.dead)
            .map(entity => entity.id)
    );

    if (runtimeState.stagingBarracksId) {
        const stagingBarracks = state.entities[runtimeState.stagingBarracksId];
        if (!stagingBarracks || stagingBarracks.type !== 'BUILDING' || stagingBarracks.dead || stagingBarracks.owner !== playerId) {
            runtimeState.stagingBarracksId = null;
            runtimeState.engineerIdsAtStagingCapture.clear();
            runtimeState.stagingReinforcementEngineerIds.clear();
        } else {
            for (const engineerId of currentEngineerIds) {
                if (!runtimeState.engineerIdsAtStagingCapture.has(engineerId)) {
                    runtimeState.stagingReinforcementEngineerIds.add(engineerId);
                }
            }
        }
    }

    for (const buildingId of Array.from(runtimeState.trackedEnemyBuildingIds)) {
        const building = state.entities[buildingId];
        if (!building || building.type !== 'BUILDING' || building.dead) {
            runtimeState.trackedEnemyBuildingIds.delete(buildingId);
            continue;
        }

        if (building.owner === playerId) {
            if (!runtimeState.successfulCapturedBuildingIds.has(buildingId)) {
                runtimeState.successfulCapturedBuildingIds.add(buildingId);
            }
            if (building.key === 'conyard') {
                runtimeState.successfulCapturedConyardIds.add(buildingId);
            }
            if (building.key === 'barracks' &&
                (!runtimeState.stagingBarracksId || runtimeState.stagingBarracksId === buildingId)) {
                if (!runtimeState.stagingBarracksId) {
                    runtimeState.stagingBarracksId = buildingId;
                    runtimeState.engineerIdsAtStagingCapture = new Set(currentEngineerIds);
                    runtimeState.stagingReinforcementEngineerIds.clear();
                }

                const hpRatio = building.hp / Math.max(1, building.maxHp);
                const nearbyThreatCount = Object.values(state.entities).filter(entity =>
                    isEnemyThreat(entity, building, playerId) &&
                    entity.pos.dist(building.pos) <= STAGING_BARRACKS_DANGER_RADIUS
                ).length;
                const reinforcementCount = runtimeState.stagingReinforcementEngineerIds.size;
                const shouldLiquidateEarly = hpRatio <= 0.25 ||
                    (reinforcementCount >= 1 && (hpRatio <= 0.55 || nearbyThreatCount >= 2));
                if (reinforcementCount < STAGING_BARRACKS_REINFORCEMENT_COUNT && !shouldLiquidateEarly) {
                    actions.push({
                        type: 'SET_PRIMARY_BUILDING',
                        payload: { buildingId, category: 'infantry', playerId }
                    });
                    continue;
                }
            }
            runtimeState.captureRefundReserveActive = true;
            actions.push({
                type: 'SELL_BUILDING',
                payload: { buildingId, playerId }
            });
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

    const powerMargin = calculateProjectedPowerMargin(player, myBuildings, actions);
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

    if (projectedRefineryCount < MIN_REFINERIES_AFTER_CAPTURE &&
        upsertBuildingStartAction(actions, player, 'refinery', myBuildings)) {
        return;
    }

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
        if (building.type !== 'BUILDING' || building.dead) continue;
        runtimeState.initialOwnedBuildingIds.add(building.id);
        if (isAliveConyard(building)) {
            runtimeState.initialOwnedConyardIds.add(building.id);
        }
    }
    runtimeState.initialized = true;
}

function clearActiveRaidWave(runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>): void {
    runtimeState.activeRaidApcId = null;
    runtimeState.activeRaidEngineerIds.clear();
    runtimeState.raidWaveStartTick = null;
    runtimeState.raidWaveCaptureCountAtStart = runtimeState.successfulCapturedBuildingIds.size;
}

function updateRaidWaveState(
    state: GameState,
    playerId: number,
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>
): void {
    if (runtimeState.raidWaveStartTick === null) return;

    if (runtimeState.successfulCapturedBuildingIds.size > runtimeState.raidWaveCaptureCountAtStart) {
        clearActiveRaidWave(runtimeState);
        runtimeState.requiredEscortCount = RAID_ESCORT_COUNT;
        runtimeState.escortRequiredBeforeProduction = false;
        return;
    }

    const waveAge = state.tick - runtimeState.raidWaveStartTick;
    const apc = runtimeState.activeRaidApcId ? state.entities[runtimeState.activeRaidApcId] : null;
    const apcAlive = Boolean(apc && apc.type === 'UNIT' && apc.owner === playerId && !apc.dead);
    const anyEngineerAlive = Array.from(runtimeState.activeRaidEngineerIds).some(engineerId => {
        const engineer = state.entities[engineerId];
        return Boolean(engineer && engineer.type === 'UNIT' && engineer.owner === playerId && !engineer.dead);
    });
    const failed = waveAge >= RAID_WAVE_TIMEOUT_TICKS ||
        (waveAge >= RAID_FAILURE_GRACE_TICKS && (!apcAlive || !anyEngineerAlive));
    if (!failed) return;

    clearActiveRaidWave(runtimeState);
    runtimeState.raidRecoveryUntilTick = state.tick + RAID_RECOVERY_TICKS;
    runtimeState.requiredEscortCount = RAID_ESCORT_COUNT;
    runtimeState.escortRequiredBeforeProduction = true;
}

function reserveCaptureRefundForRaid(
    actions: Action[],
    player: PlayerState,
    runtimeState: ReturnType<typeof getEngineerConyardRushRuntimeState>,
    currentEngineerCount: number,
    currentApcCount: number
): Action[] {
    if (!runtimeState.captureRefundReserveActive) return actions;

    const packageReady = getProjectedEngineerCount(actions, player, currentEngineerCount) >= RAID_PACKAGE_ENGINEER_COUNT &&
        getProjectedApcCount(actions, player, currentApcCount) >= MIN_APC_FORCE;
    if (packageReady) {
        runtimeState.captureRefundReserveActive = false;
        return actions;
    }

    return actions.filter(action =>
        !isStartBuildAction(action) ||
        action.payload.playerId !== player.id ||
        action.payload.category !== 'building'
    );
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

    let actions = computeAuroraSovereignAiActions(state, playerId, player.difficulty, sharedCache);

    const cache = sharedCache ?? createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId, state);
    const runtimeState = getEngineerConyardRushRuntimeState(playerId);

    initializeRuntimeState(runtimeState, myBuildings);

    const enemyBaseBuildings = enemies.filter(entity =>
        isCapturableBaseBuilding(entity) &&
        !runtimeState.initialOwnedBuildingIds.has(entity.id)
    );

    trackEnemyBuildings(runtimeState, enemyBaseBuildings);
    actions.push(...updateCaptureTracking(state, playerId, runtimeState));
    updateRaidWaveState(state, playerId, runtimeState);

    const enemyConyards = enemyBaseBuildings.filter(isAliveConyard);

    const hasSuccessfulCapture = runtimeState.successfulCapturedConyardIds.size > 0;
    if (ENABLE_POST_CAPTURE_MACRO_BIAS && hasSuccessfulCapture) {
        const projectedPowerMargin = calculateProjectedPowerMargin(player, myBuildings, actions);
        actions = removeLowPriorityPostCaptureBuildingBuilds(actions, playerId);
        actions = removeHealthyMarginPostCapturePowerBuilds(
            actions,
            playerId,
            projectedPowerMargin
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
    const escorts = myUnits.filter(isRaidEscort);

    if (enemyBaseBuildings.length > 0) {
        const enemyBaseCount = new Set(enemyBaseBuildings.map(building => building.owner)).size;
        const recoveryComplete = state.tick >= runtimeState.raidRecoveryUntilTick;
        const escortRequirementMet = escorts.length >= runtimeState.requiredEscortCount;
        if (recoveryComplete && escortRequirementMet && runtimeState.requiredEscortCount > 0) {
            runtimeState.requiredEscortCount = 0;
            runtimeState.escortRequiredBeforeProduction = false;
        }
        const canPrepareRaid = recoveryComplete &&
            (!runtimeState.escortRequiredBeforeProduction || escortRequirementMet);
        if (ENABLE_RUSH_PRODUCTION && canPrepareRaid) {
            enqueueEngineerProduction(actions, player, myBuildings, allEngineerCount, enemyBaseCount);
            enqueueApcProduction(actions, player, myBuildings, apcs.length, allEngineerCount, enemyBaseCount);
        }
        actions = reserveCaptureRefundForRaid(
            actions,
            player,
            runtimeState,
            allEngineerCount,
            apcs.length
        );
        actions.push(...getEngineerRushActions(
            state,
            engineers,
            apcs,
            escorts,
            enemies,
            enemyBaseBuildings,
            runtimeState
        ));
    } else {
        runtimeState.captureRefundReserveActive = false;
    }

    return sanitizeEngineerConyardRushActions(actions, state, playerId);
}

export const EngineerConyardRushAIImplementation: AIImplementation = {
    id: 'engineer_conyard_rush',
    name: 'Engineer Conyard Rush',
    description: 'Launches escorted APC raids that seize conyards and barracks, then strip power before selling the base.',
    computeActions: ({ state, playerId, entityCache }) => computeEngineerConyardRushAiActions(state, playerId, entityCache),
    reset: (playerId?: number) => {
        resetEngineerConyardRushRuntimeState(playerId);
        AuroraSovereignAIImplementation.reset?.(playerId);
    }
};

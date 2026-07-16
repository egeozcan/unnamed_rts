import { EntityId } from '../../../types.js';

export interface EngineerConyardRushRuntimeState {
    initialized: boolean;
    lastObservedTick: number;
    initialOwnedBuildingIds: Set<EntityId>;
    initialOwnedConyardIds: Set<EntityId>;
    trackedEnemyBuildingIds: Set<EntityId>;
    successfulCapturedBuildingIds: Set<EntityId>;
    successfulCapturedConyardIds: Set<EntityId>;
    stagingBarracksId: EntityId | null;
    engineerIdsAtStagingCapture: Set<EntityId>;
    stagingReinforcementEngineerIds: Set<EntityId>;
    activeRaidApcId: EntityId | null;
    activeRaidEngineerIds: Set<EntityId>;
    strandedRaidEngineerIds: Set<EntityId>;
    activeRaidEscortIds: Set<EntityId>;
    raidRouteTargetId: EntityId | null;
    raidRouteWaypoints: { x: number; y: number }[];
    raidRouteWaypointIndex: number;
    raidRoutePlannedTick: number;
    raidCompromised: boolean;
    raidWaveStartTick: number | null;
    raidWaveCaptureCountAtStart: number;
    raidRecoveryUntilTick: number;
    captureRefundReserveActive: boolean;
    enemyOwnerRotationCursor: number;
}

const runtimeStateByPlayer = new Map<number, EngineerConyardRushRuntimeState>();

export function getEngineerConyardRushRuntimeState(playerId: number): EngineerConyardRushRuntimeState {
    const existing = runtimeStateByPlayer.get(playerId);
    if (existing) {
        return existing;
    }

    const created: EngineerConyardRushRuntimeState = {
        initialized: false,
        lastObservedTick: -1,
        initialOwnedBuildingIds: new Set<EntityId>(),
        initialOwnedConyardIds: new Set<EntityId>(),
        trackedEnemyBuildingIds: new Set<EntityId>(),
        successfulCapturedBuildingIds: new Set<EntityId>(),
        successfulCapturedConyardIds: new Set<EntityId>(),
        stagingBarracksId: null,
        engineerIdsAtStagingCapture: new Set<EntityId>(),
        stagingReinforcementEngineerIds: new Set<EntityId>(),
        activeRaidApcId: null,
        activeRaidEngineerIds: new Set<EntityId>(),
        strandedRaidEngineerIds: new Set<EntityId>(),
        activeRaidEscortIds: new Set<EntityId>(),
        raidRouteTargetId: null,
        raidRouteWaypoints: [],
        raidRouteWaypointIndex: 0,
        raidRoutePlannedTick: 0,
        raidCompromised: false,
        raidWaveStartTick: null,
        raidWaveCaptureCountAtStart: 0,
        raidRecoveryUntilTick: 0,
        captureRefundReserveActive: false,
        enemyOwnerRotationCursor: 0
    };
    runtimeStateByPlayer.set(playerId, created);
    return created;
}

export function resetEngineerConyardRushRuntimeState(playerId?: number): void {
    if (playerId === undefined) {
        runtimeStateByPlayer.clear();
        return;
    }

    runtimeStateByPlayer.delete(playerId);
}

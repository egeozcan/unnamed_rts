import { EntityId } from '../../../types.js';

export interface EngineerConyardRushRuntimeState {
    initialized: boolean;
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
    raidWaveStartTick: number | null;
    raidWaveCaptureCountAtStart: number;
    raidRecoveryUntilTick: number;
    requiredEscortCount: number;
    escortRequiredBeforeProduction: boolean;
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
        raidWaveStartTick: null,
        raidWaveCaptureCountAtStart: 0,
        raidRecoveryUntilTick: 0,
        requiredEscortCount: 0,
        escortRequiredBeforeProduction: false,
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

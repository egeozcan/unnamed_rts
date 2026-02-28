import { EntityId } from '../../../types.js';

export interface EngineerConyardRushRuntimeState {
    initialized: boolean;
    initialOwnedConyardIds: Set<EntityId>;
    trackedEnemyConyardIds: Set<EntityId>;
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
        initialOwnedConyardIds: new Set<EntityId>(),
        trackedEnemyConyardIds: new Set<EntityId>(),
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

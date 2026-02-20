export interface SentinelOpportunistRuntimeState {
    lastInfantryStartTick: number;
    lastVehicleStartTick: number;
    lastPushActivationTick: number;
    lastPushWindowStartTick: number;
}

const runtimeByPlayer = new Map<number, SentinelOpportunistRuntimeState>();

function createInitialRuntimeState(): SentinelOpportunistRuntimeState {
    return {
        lastInfantryStartTick: Number.NEGATIVE_INFINITY,
        lastVehicleStartTick: Number.NEGATIVE_INFINITY,
        lastPushActivationTick: Number.NEGATIVE_INFINITY,
        lastPushWindowStartTick: Number.NEGATIVE_INFINITY
    };
}

export function getSentinelOpportunistRuntimeState(playerId: number): SentinelOpportunistRuntimeState {
    const existing = runtimeByPlayer.get(playerId);
    if (existing) {
        return existing;
    }

    const created = createInitialRuntimeState();
    runtimeByPlayer.set(playerId, created);
    return created;
}

export function resetSentinelOpportunistRuntimeState(playerId?: number): void {
    if (playerId === undefined) {
        runtimeByPlayer.clear();
        return;
    }
    runtimeByPlayer.delete(playerId);
}

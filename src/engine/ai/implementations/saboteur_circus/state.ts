export type SaboteurStuntMode = 'capture' | 'hijack' | 'demo' | 'stealth_raid';

export interface SaboteurCircusRuntimeState {
    stuntIndex: number;
    lastStuntTick: number;
    productionCursor: number;
}

const runtimeStateByPlayer = new Map<number, SaboteurCircusRuntimeState>();

export function getSaboteurCircusRuntimeState(playerId: number): SaboteurCircusRuntimeState {
    const existing = runtimeStateByPlayer.get(playerId);
    if (existing) {
        return existing;
    }

    const created: SaboteurCircusRuntimeState = {
        stuntIndex: 0,
        lastStuntTick: 0,
        productionCursor: 0
    };
    runtimeStateByPlayer.set(playerId, created);
    return created;
}

export function resetSaboteurCircusRuntimeState(playerId?: number): void {
    if (playerId === undefined) {
        runtimeStateByPlayer.clear();
        return;
    }

    runtimeStateByPlayer.delete(playerId);
}

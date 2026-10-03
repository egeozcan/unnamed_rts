export interface NemesisRuntimeState {
    // Whether the scripted air opening has finished (it never restarts).
    openingDone: boolean;
    // Whether the helicopter wing is currently out striking (vs. massing at home).
    heliStrikeActive: boolean;
}

const runtimeByPlayer = new Map<number, NemesisRuntimeState>();

function createInitialRuntimeState(): NemesisRuntimeState {
    return {
        openingDone: false,
        heliStrikeActive: false
    };
}

export function getNemesisRuntimeState(playerId: number): NemesisRuntimeState {
    const existing = runtimeByPlayer.get(playerId);
    if (existing) return existing;
    const created = createInitialRuntimeState();
    runtimeByPlayer.set(playerId, created);
    return created;
}

export function resetNemesisRuntimeState(playerId?: number): void {
    if (playerId === undefined) {
        runtimeByPlayer.clear();
        return;
    }
    runtimeByPlayer.delete(playerId);
}

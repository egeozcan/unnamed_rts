export interface CadenceUpdateParams {
    currentTick: number;
    currentTimeMs: number;
    lastTick: number;
    lastTimeMs: number;
    minTickDelta: number;
    minTimeDeltaMs: number;
    /**
     * The simulation is not advancing (game over, debug freeze): ticks will not move, so throttle
     * on time alone. Without this the caller would have to bypass the cadence and update every frame.
     */
    ticksFrozen?: boolean;
}

/**
 * Returns whether a tick/time throttled UI update should run.
 * Requires both tick and time deltas, and recovers on tick regression.
 */
export function shouldRunCadencedUpdate(params: CadenceUpdateParams): boolean {
    const {
        currentTick,
        currentTimeMs,
        lastTick,
        lastTimeMs,
        minTickDelta,
        minTimeDeltaMs,
        ticksFrozen
    } = params;

    // First run or reset state.
    if (lastTick < 0 || !Number.isFinite(lastTimeMs)) {
        return true;
    }

    // State loaded/restarted with an earlier tick; allow immediate recovery.
    if (currentTick < lastTick) {
        return true;
    }

    if (ticksFrozen) {
        return (currentTimeMs - lastTimeMs) >= minTimeDeltaMs;
    }

    // No tick progress means no update.
    if (currentTick === lastTick) {
        return false;
    }

    if ((currentTick - lastTick) < minTickDelta) {
        return false;
    }

    if ((currentTimeMs - lastTimeMs) < minTimeDeltaMs) {
        return false;
    }

    return true;
}

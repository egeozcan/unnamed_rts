export interface CadenceUpdateParams {
    currentTick: number;
    currentTimeMs: number;
    lastTick: number;
    lastTimeMs: number;
    minTickDelta: number;
    minTimeDeltaMs: number;
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
        minTimeDeltaMs
    } = params;

    // First run or reset state.
    if (lastTick < 0 || !Number.isFinite(lastTimeMs)) {
        return true;
    }

    // State loaded/restarted with an earlier tick; allow immediate recovery.
    if (currentTick < lastTick) {
        return true;
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

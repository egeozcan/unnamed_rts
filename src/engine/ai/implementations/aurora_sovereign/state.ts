export interface AuroraSovereignAIState {
    initializedAtTick: number;
}

export function createInitialAuroraSovereignAIState(): AuroraSovereignAIState {
    return {
        initializedAtTick: 0
    };
}

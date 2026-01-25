/**
 * Debug event emitter for RTS game debugging.
 *
 * This module provides a lightweight event emitter that gets tree-shaken
 * out of production builds via the import.meta.env.DEV check.
 */

export type DebugEventType =
    | 'command'
    | 'decision'
    | 'state-change'
    | 'group'
    | 'economy'
    | 'production'
    | 'threat';

export interface DebugEvent {
    type: DebugEventType;
    tick: number;
    playerId?: number;
    entityId?: string;
    data: Record<string, unknown>;
}

export type DebugEventPayload = Omit<DebugEvent, 'type'>;

type CollectorFn = (event: DebugEvent) => void;

let collector: CollectorFn | null = null;

/**
 * Debug event emitter singleton.
 *
 * The emit function checks import.meta.env.DEV so that Vite can tree-shake
 * all debug event emissions from production builds.
 */
export const DebugEvents = {
    /**
     * Emit a debug event. Only works in development mode (import.meta.env.DEV)
     * and when a collector has been set.
     */
    emit(type: DebugEventType, payload: DebugEventPayload): void {
        if (import.meta.env.DEV && collector) {
            collector({
                type,
                tick: payload.tick,
                playerId: payload.playerId,
                entityId: payload.entityId,
                data: payload.data
            });
        }
    },

    /**
     * Set or clear the collector function.
     * @param fn - The collector function, or null to stop collecting
     */
    setCollector(fn: CollectorFn | null): void {
        collector = fn;
    }
};

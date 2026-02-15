import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldRunCadencedUpdate } from '../../src/ui/cadence';

describe('shouldRunCadencedUpdate', () => {
    const base = {
        minTickDelta: 10,
        minTimeDeltaMs: 120
    };

    it('allows update when both tick and time thresholds are met', () => {
        const result = shouldRunCadencedUpdate({
            ...base,
            currentTick: 30,
            currentTimeMs: 240,
            lastTick: 20,
            lastTimeMs: 120
        });

        expect(result).toBe(true);
    });

    it('blocks update when only tick threshold is met', () => {
        const result = shouldRunCadencedUpdate({
            ...base,
            currentTick: 30,
            currentTimeMs: 200,
            lastTick: 20,
            lastTimeMs: 120
        });

        expect(result).toBe(false);
    });

    it('blocks update when only time threshold is met', () => {
        const result = shouldRunCadencedUpdate({
            ...base,
            currentTick: 28,
            currentTimeMs: 260,
            lastTick: 20,
            lastTimeMs: 120
        });

        expect(result).toBe(false);
    });

    it('blocks update when tick is unchanged', () => {
        const result = shouldRunCadencedUpdate({
            ...base,
            currentTick: 20,
            currentTimeMs: 260,
            lastTick: 20,
            lastTimeMs: 120
        });

        expect(result).toBe(false);
    });

    it('allows immediate update when tick regresses', () => {
        const result = shouldRunCadencedUpdate({
            ...base,
            currentTick: 7,
            currentTimeMs: 130,
            lastTick: 67,
            lastTimeMs: 120
        });

        expect(result).toBe(true);
    });

    it('caps minimap cadence updates under fake timers', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(0));

        let updates = 0;
        let lastTick = -1;
        let lastTimeMs = -Infinity;
        let tick = 0;

        for (let frame = 0; frame < 120; frame++) {
            const nowMs = Date.now();
            if (shouldRunCadencedUpdate({
                currentTick: tick,
                currentTimeMs: nowMs,
                lastTick,
                lastTimeMs,
                minTickDelta: 2,
                minTimeDeltaMs: 66
            })) {
                updates++;
                lastTick = tick;
                lastTimeMs = nowMs;
            }
            tick += 1;
            vi.advanceTimersByTime(16);
        }

        expect(updates).toBeLessThanOrEqual(30);
    });

    it('caps birds-eye cadence updates under fake timers', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(0));

        let updates = 0;
        let lastTick = -1;
        let lastTimeMs = -Infinity;
        let tick = 0;

        for (let frame = 0; frame < 120; frame++) {
            const nowMs = Date.now();
            if (shouldRunCadencedUpdate({
                currentTick: tick,
                currentTimeMs: nowMs,
                lastTick,
                lastTimeMs,
                minTickDelta: 2,
                minTimeDeltaMs: 83
            })) {
                updates++;
                lastTick = tick;
                lastTimeMs = nowMs;
            }
            tick += 1;
            vi.advanceTimersByTime(16);
        }

        expect(updates).toBeLessThanOrEqual(24);
    });
});

afterEach(() => {
    vi.useRealTimers();
});

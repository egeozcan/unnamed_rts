import { describe, expect, it } from 'vitest';
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
});

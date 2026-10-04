import { describe, it, expect } from 'vitest';
import { syncFogPixels } from '../../src/ui/minimap';

describe('syncFogPixels', () => {
    it('makes unrevealed tiles opaque black and revealed tiles transparent', () => {
        const grid = new Uint8Array([0, 1, 0, 1]);
        const snapshot = new Uint8Array(4).fill(255);
        const data = new Uint8ClampedArray(16);
        expect(syncFogPixels(grid, snapshot, data)).toBe(true);
        expect([data[3], data[7], data[11], data[15]]).toEqual([255, 0, 255, 0]);
        // RGB untouched (black)
        expect(data[0] + data[1] + data[2]).toBe(0);
    });

    it('only reports a change when the grid changed', () => {
        const grid = new Uint8Array([0, 0, 0, 0]);
        const snapshot = new Uint8Array(4).fill(255);
        const data = new Uint8ClampedArray(16);
        syncFogPixels(grid, snapshot, data);
        expect(syncFogPixels(grid, snapshot, data)).toBe(false);

        grid[2] = 1; // revealed in place, as the engine does
        expect(syncFogPixels(grid, snapshot, data)).toBe(true);
        expect(data[11]).toBe(0);
        expect(data[3]).toBe(255);
    });
});

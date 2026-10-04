import { describe, it, expect } from 'vitest';
import { clampCamera, getMinZoom } from '../../src/input/index.js';

describe('clampCamera', () => {
    it('allows panning up to 300 screen px past the map edges', () => {
        // 1000x800 view at zoom 1 on a 3000x3000 map
        expect(clampCamera(-1000, -1000, 1000, 800, 1, 3000, 3000)).toEqual({ x: -300, y: -300 });
        expect(clampCamera(5000, 5000, 1000, 800, 1, 3000, 3000)).toEqual({ x: 2300, y: 2500 });
        expect(clampCamera(100, 200, 1000, 800, 1, 3000, 3000)).toEqual({ x: 100, y: 200 });
    });

    it('centres the map on an axis where it fits in the view', () => {
        // Zoomed out to 0.25: the view is 4000x3200 world px, wider than the 2000x4000 map
        const cam = clampCamera(-1200, 0, 1000, 800, 0.25, 2000, 4000);
        expect(cam.x).toBe(1000 - 2000);
        expect(cam.y).toBe(0);
    });
});

describe('getMinZoom', () => {
    it('is 0.25 when the map already fits at that zoom', () => {
        expect(getMinZoom(1600, 900, 3000, 3000)).toBe(0.25);
    });

    it('zooms out further so the whole of a big map fits in the view', () => {
        // Huge 5000x5000 map in a 1600x900 view: the height is the limiting axis
        const zoom = getMinZoom(1600, 900, 5000, 5000);
        expect(zoom).toBeCloseTo(900 / 5000, 10);
        expect(1600 / zoom).toBeGreaterThanOrEqual(5000);
        expect(900 / zoom).toBeGreaterThanOrEqual(5000 - 1e-6);
    });

    it('falls back to 0.25 for a zero-sized view', () => {
        expect(getMinZoom(0, 0, 5000, 5000)).toBe(0.25);
    });
});

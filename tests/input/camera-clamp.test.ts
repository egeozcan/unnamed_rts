import { describe, it, expect } from 'vitest';
import { clampCamera } from '../../src/input/index.js';

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

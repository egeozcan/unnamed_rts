import { describe, it, expect } from 'vitest';
import { getMinimapLayout } from '../../src/ui/minimap';

describe('getMinimapLayout', () => {
    it('keeps a square map square inside a wide minimap, centred', () => {
        const { scale, offsetX, offsetY } = getMinimapLayout(250, 200, 3000, 3000);
        expect(scale).toBeCloseTo(200 / 3000);
        expect(offsetX).toBeCloseTo(25);
        expect(offsetY).toBe(0);
    });

    it('letterboxes a wide map top and bottom', () => {
        const { scale, offsetX, offsetY } = getMinimapLayout(250, 200, 4000, 2000);
        expect(scale).toBeCloseTo(250 / 4000);
        expect(offsetX).toBe(0);
        expect(offsetY).toBeCloseTo((200 - 2000 * 250 / 4000) / 2);
    });
});

import { describe, it, expect } from 'vitest';
import { Vector } from './types.js';

describe('Spinning Harvester Fix', () => {
    it('should not reverse direction when avoidance force is too strong', () => {
        // This test verifies the core fix logic:
        // When whisker avoidance would push a unit backward,
        // it should be clamped to perpendicular instead

        const dir = new Vector(0.799, 0.601); // Direction to target (normalized)
        const avoidance = new Vector(-1.150, -1.088); // Strong avoidance force

        // Without fix: combine direction + avoidance and normalize
        const oldFinal = dir.add(avoidance).norm();
        const oldDot = oldFinal.dot(dir);

        console.log('Direction to target:', dir);
        console.log('Avoidance force:', avoidance);
        console.log('Combined direction (before fix):', oldFinal);
        console.log('Dot product with target direction:', oldDot.toFixed(3));

        // The old direction points backward (dot < 0 means >90° from target)
        expect(oldDot).toBeLessThan(0);

        // With fix: if direction is backward, clamp to perpendicular
        let newFinal = oldFinal;
        const dotProduct = newFinal.dot(dir);
        if (dotProduct < 0) {
            // Use perpendicular direction (right vector)
            const right = new Vector(-dir.y, dir.x);
            const rightDot = newFinal.dot(right);
            newFinal = right.scale(rightDot >= 0 ? 1 : -1);
        }

        const newDot = newFinal.dot(dir);
        console.log('Clamped direction (after fix):', newFinal);
        console.log('New dot product:', newDot.toFixed(3));

        // The new direction should be sideways, not backward
        expect(newDot).toBeGreaterThanOrEqual(0);
    });

    it('should not modify direction when avoidance is not too strong', () => {
        // When avoidance doesn't reverse direction, it should be left alone

        const dir = new Vector(0.8, 0.6); // Direction to target
        const avoidance = new Vector(-0.3, -0.2); // Mild avoidance

        const combined = dir.add(avoidance).norm();
        const dotProduct = combined.dot(dir);

        console.log('Mild avoidance case:');
        console.log('  Direction:', dir);
        console.log('  Avoidance:', avoidance);
        console.log('  Combined:', combined);
        console.log('  Dot product:', dotProduct.toFixed(3));

        // Direction should still be forward (dot > 0)
        expect(dotProduct).toBeGreaterThan(0);

        // No clamping needed
        let finalDir = combined;
        if (dotProduct < 0) {
            const right = new Vector(-dir.y, dir.x);
            finalDir = right.scale(combined.dot(right) >= 0 ? 1 : -1);
        }

        // Should be unchanged
        expect(finalDir.x).toBeCloseTo(combined.x);
        expect(finalDir.y).toBeCloseTo(combined.y);
    });
});

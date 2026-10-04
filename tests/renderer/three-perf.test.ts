import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { getModelDef } from '../../src/renderer/three/models';
import { TEAM_MIX_ATTRIBUTE } from '../../src/renderer/three/shape';
import { AdaptiveResolution } from '../../src/renderer/three/resolution';
import { InstanceBucket } from '../../src/renderer/three/scene';
import { PLAYER_COLORS } from '../../src/engine/types';
import { RULES } from '../../src/data/schemas/index';

describe('owner-independent model geometry', () => {
    const keys = [...Object.keys(RULES.units), ...Object.keys(RULES.buildings), 'ore', 'well_active', 'well_blocked', 'rock_0'];
    const teams = [...PLAYER_COLORS, '#d4af37', '#888888'].map(style => new THREE.Color(style));

    it.each(keys)('%s: colour + teamMix * team reproduces the per-owner baked colours', key => {
        for (const part of getModelDef(key).parts) {
            const teamless = part.shape.realizeTeamless();
            const color = teamless.getAttribute('color');
            const mix = teamless.getAttribute(TEAM_MIX_ATTRIBUTE);
            expect(mix.count).toBe(color.count);
            for (const team of teams) {
                const baked = part.shape.realize(team);
                const bakedColor = baked.getAttribute('color');
                expect(bakedColor.count).toBe(color.count);
                expect(baked.getAttribute('position').array).toEqual(teamless.getAttribute('position').array);
                for (let v = 0; v < color.count; v++) {
                    const m = mix.getX(v);
                    // Same as the shader, in float32
                    expect(Math.abs(Math.fround(color.getX(v) + m * team.r) - bakedColor.getX(v))).toBeLessThan(1e-6);
                    expect(Math.abs(Math.fround(color.getY(v) + m * team.g) - bakedColor.getY(v))).toBeLessThan(1e-6);
                    expect(Math.abs(Math.fround(color.getZ(v) + m * team.b) - bakedColor.getZ(v))).toBeLessThan(1e-6);
                }
                baked.dispose();
            }
            teamless.dispose();
        }
    });
});

describe('instance buckets', () => {
    function makeBucket(capacity = 4) {
        const scene = new THREE.Scene();
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        const bucket = new InstanceBucket(scene, geometry, new THREE.MeshBasicMaterial(), true, true, capacity);
        return { bucket, geometry };
    }
    const matrixAt = (x: number) => new THREE.Matrix4().makeTranslation(x, 0, 0);
    const red = new THREE.Color(1, 0, 0);

    function frame(bucket: InstanceBucket, xs: number[], team = red): void {
        bucket.reset();
        for (const x of xs) bucket.push(matrixAt(x), 1, 1, 1, team);
        bucket.finish();
    }

    it('uploads only the instances that changed', () => {
        const { bucket, geometry } = makeBucket();
        frame(bucket, [1, 2, 3]);
        const matrices = bucket.mesh.instanceMatrix;
        const version = matrices.version;
        // What three does once uploaded
        for (const attribute of [matrices, bucket.mesh.instanceColor!, geometry.getAttribute('instanceTeam') as THREE.BufferAttribute]) {
            attribute.clearUpdateRanges();
        }

        frame(bucket, [1, 2, 3]);
        expect(matrices.version).toBe(version);
        expect(bucket.mesh.count).toBe(3);

        frame(bucket, [1, 5, 3]);
        expect(matrices.version).toBe(version + 1);
        expect(matrices.updateRanges).toEqual([{ start: 16, count: 16 }]);
        expect(bucket.mesh.instanceColor!.updateRanges).toEqual([{ start: 3, count: 3 }]);
        expect((geometry.getAttribute('instanceTeam') as THREE.BufferAttribute).updateRanges).toEqual([{ start: 3, count: 3 }]);
    });

    it('treats a different team colour as a change', () => {
        const { bucket, geometry } = makeBucket();
        frame(bucket, [1, 2]);
        const team = geometry.getAttribute('instanceTeam') as THREE.BufferAttribute;
        const version = team.version;
        frame(bucket, [1, 2], new THREE.Color(0, 0, 1));
        expect(team.version).toBe(version + 1);
        expect(Array.from(team.array.slice(0, 6))).toEqual([0, 0, 1, 0, 0, 1]);
    });

    it('drops instances without re-uploading the rest', () => {
        const { bucket } = makeBucket();
        frame(bucket, [1, 2, 3]);
        const version = bucket.mesh.instanceMatrix.version;
        frame(bucket, [1]);
        expect(bucket.mesh.count).toBe(1);
        expect(bucket.mesh.instanceMatrix.version).toBe(version);
        frame(bucket, []);
        expect(bucket.mesh.visible).toBe(false);
    });

    it('keeps every instance when it grows', () => {
        const { bucket, geometry } = makeBucket(2);
        frame(bucket, [1, 2, 3, 4, 5]);
        expect(bucket.mesh.count).toBe(5);
        const array = bucket.mesh.instanceMatrix.array;
        expect([0, 1, 2, 3, 4].map(i => array[i * 16 + 12])).toEqual([1, 2, 3, 4, 5]);
        const team = geometry.getAttribute('instanceTeam') as THREE.BufferAttribute;
        expect(team.count).toBeGreaterThanOrEqual(5);
        expect(team.getX(4)).toBe(1);
    });
});

describe('adaptive resolution', () => {
    const BUDGET = 1000 / 60;
    function feed(res: AdaptiveResolution, ms: number | ((ratio: number) => number), samples: number, max = 2): number {
        // As in Scene3D.render: the ratio is read every frame, then the frame time is reported
        for (let i = 0; i < samples; i++) {
            const ratio = res.pixelRatio(max);
            res.sample(typeof ms === 'number' ? ms : ms(ratio));
        }
        return res.pixelRatio(max);
    }

    it('keeps full resolution while frames are on budget', () => {
        const res = new AdaptiveResolution(BUDGET);
        expect(feed(res, BUDGET, 2000)).toBe(2);
    });

    it('steps down while fill-bound, then probes back up when the load goes away', () => {
        const res = new AdaptiveResolution(BUDGET);
        // Frame time scales with the pixel count: 30ms at 2x, ~17ms at 1.5x
        let heavy = true;
        const cost = (ratio: number) => heavy ? 30 * (ratio / 2) ** 2 : BUDGET;
        expect(feed(res, cost, 200)).toBe(1.5);
        expect(feed(res, cost, 2000)).toBe(1.5);
        heavy = false;
        expect(feed(res, cost, 2000)).toBe(2);
    });

    it('does not oscillate: a failed probe up doubles the wait before the next one', () => {
        const res = new AdaptiveResolution(BUDGET);
        const cost = (ratio: number) => 30 * (ratio / 2) ** 2;
        let changes = 0;
        let last = res.pixelRatio(2);
        for (let i = 0; i < 10000; i++) {
            res.sample(cost(res.pixelRatio(2)));
            const now = res.pixelRatio(2);
            if (now !== last) changes++;
            last = now;
        }
        expect(last).toBe(1.5);
        expect(changes).toBeLessThan(12);
    });

    it('undoes a step down that does not help (CPU-bound frames)', () => {
        const res = new AdaptiveResolution(BUDGET);
        expect(feed(res, 30, 50)).toBe(1.5); // steps down once settled...
        expect(feed(res, 30, 60)).toBe(2); // ...but frames stayed slow, so it goes back
        expect(feed(res, 30, 600)).toBe(2); // and doesn't immediately try again
    });

    it('never goes below the device pixel ratio steps, and ignores pauses', () => {
        const res = new AdaptiveResolution(BUDGET);
        expect(feed(res, (ratio: number) => 30 * ratio, 3000, 1)).toBe(1);
        const hidden = new AdaptiveResolution(BUDGET);
        expect(feed(hidden, 5000, 500)).toBe(2);
    });
});

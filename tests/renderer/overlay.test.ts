import { describe, it, expect, vi, afterEach } from 'vitest';

vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock-url') });

import { Renderer, getOwnerRelation, hpBarColor, statusBarWidth, extendsBuildRange } from '../../src/renderer/index';
import { rasterBucket, getAssetBitmap, initGraphics } from '../../src/renderer/assets';
import { INITIAL_STATE } from '../../src/engine/reducer';
import { createPlayerState } from '../../src/engine/reducers/helpers';
import { createTestBuilding, createTestCombatUnit } from '../../src/engine/test-utils';
import { GameState } from '../../src/engine/types';

function stateWithTeams(): GameState {
    return {
        ...INITIAL_STATE,
        players: {
            0: createPlayerState(0, false, 'medium', undefined, 'classic', 'A'),
            1: createPlayerState(1, true, 'medium', undefined, 'classic', 'A'),
            2: createPlayerState(2, true, 'medium', undefined, 'classic', 'B')
        }
    };
}

describe('overlay helpers', () => {
    it('classifies owners relative to the viewer', () => {
        const state = stateWithTeams();
        expect(getOwnerRelation(state, 0, 0)).toBe('own');
        expect(getOwnerRelation(state, 1, 0)).toBe('ally');
        expect(getOwnerRelation(state, 2, 0)).toBe('enemy');
        expect(getOwnerRelation(state, -1, 0)).toBe('neutral');
        // Observers see everyone as neutral (no enemy styling)
        expect(getOwnerRelation(state, 2, null)).toBe('neutral');
    });

    it('HP bar colour steps from green through yellow to red', () => {
        expect(hpBarColor(1)).not.toBe(hpBarColor(0.5));
        expect(hpBarColor(0.5)).not.toBe(hpBarColor(0.1));
        expect(hpBarColor(0.1)).not.toMatch(/^(red|#0f0|#00ff00)$/);
    });

    it('status bars keep a readable on-screen size at any zoom', () => {
        const unit = createTestCombatUnit({ key: 'light' });
        expect(statusBarWidth(unit, 0.25)).toBeGreaterThanOrEqual(22);
        expect(statusBarWidth(unit, 4)).toBeLessThanOrEqual(44);

        const conyard = createTestBuilding({ key: 'conyard' });
        const power = createTestBuilding({ key: 'power' });
        expect(statusBarWidth(conyard, 0.25)).toBeGreaterThanOrEqual(28);
        // Bigger footprints get wider bars
        expect(statusBarWidth(conyard, 1)).toBeGreaterThan(statusBarWidth(power, 1));
        expect(statusBarWidth(conyard, 1)).toBeCloseTo(72);
        expect(statusBarWidth(conyard, 10)).toBeLessThanOrEqual(120);
    });

    it('build-range rings follow the placement rules: allies yes, defenses no', () => {
        const state = stateWithTeams();
        expect(extendsBuildRange(state, createTestBuilding({ key: 'power', owner: 0 }), 0)).toBe(true);
        expect(extendsBuildRange(state, createTestBuilding({ key: 'power', owner: 1 }), 0)).toBe(true);
        expect(extendsBuildRange(state, createTestBuilding({ key: 'power', owner: 2 }), 0)).toBe(false);
        expect(extendsBuildRange(state, createTestBuilding({ key: 'turret', owner: 0 }), 0)).toBe(false);
        expect(extendsBuildRange(state, createTestBuilding({ key: 'power', owner: 0, dead: true }), 0)).toBe(false);
    });
});

describe('sprite raster cache', () => {
    it('buckets target sizes to powers of two within limits', () => {
        expect(rasterBucket(1)).toBe(8);
        expect(rasterBucket(30)).toBe(32);
        expect(rasterBucket(32)).toBe(32);
        expect(rasterBucket(33)).toBe(64);
        expect(rasterBucket(5000)).toBe(1024);
    });

    it('returns nothing until the SVG image has loaded', () => {
        initGraphics();
        expect(getAssetBitmap('conyard', 0, 90, 90, 1)).toBeNull();
        expect(getAssetBitmap('no_such_asset', 0, 90, 90, 1)).toBeNull();
    });
});

describe('Renderer canvas sizing', () => {
    const originalDpr = window.devicePixelRatio;
    afterEach(() => {
        Object.defineProperty(window, 'devicePixelRatio', { value: originalDpr, configurable: true });
        document.body.innerHTML = '';
    });

    it('scales the backing store by devicePixelRatio but reports CSS pixels', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });
        Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
        Object.defineProperty(window, 'innerHeight', { value: 600, configurable: true });
        document.body.innerHTML = '<div id="game-container"><canvas id="c"></canvas></div>';
        const canvas = document.getElementById('c') as HTMLCanvasElement;

        const renderer = new Renderer(canvas);
        const size = renderer.getSize();
        expect(canvas.width).toBe(size.width * 2);
        expect(canvas.height).toBe(size.height * 2);
        expect(canvas.style.width).toBe(`${size.width}px`);
        expect(canvas.style.height).toBe(`${size.height}px`);
        renderer.dispose();
    });
});

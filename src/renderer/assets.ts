import { PLAYER_COLORS } from '../engine/types.js';
import { buildings } from './assets_data/buildings';
import { vehicles } from './assets_data/vehicles';
import { infantry } from './assets_data/infantry';
import { defenses } from './assets_data/defenses';
import { misc } from './assets_data/misc';
import { turrets } from './assets_data/turrets';

// Legacy exports for backward compatibility
export const PLAYER_COLOR = PLAYER_COLORS[0];
export const ENEMY_COLOR = PLAYER_COLORS[1];

const svgs: Record<string, string> = {
    ...buildings,
    ...vehicles,
    ...infantry,
    ...defenses,
    ...misc,
    ...turrets
};

const IMG_CACHE: Record<string, HTMLImageElement> = {};

function createGameImage(color: string, svgContent: string): HTMLImageElement {
    const finalSVG = svgContent.replace(/COL_PRIMARY/g, color);
    const blob = new Blob([finalSVG], { type: 'image/svg+xml' });
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    return img;
}

export function initGraphics(): void {
    for (const key in svgs) {
        // Create assets for all 4 players
        for (let i = 0; i < PLAYER_COLORS.length; i++) {
            IMG_CACHE[key + '_' + i] = createGameImage(PLAYER_COLORS[i], svgs[key]);
        }
        IMG_CACHE[key + '_-1'] = createGameImage('#d4af37', svgs[key]); // Neutral/resources
    }
}

export function getAsset(key: string, owner: number): HTMLImageElement | null {
    const cacheKey = `${key}_${owner}`;
    return IMG_CACHE[cacheKey] || null;
}

/** Smallest and largest edge (device px) of a pre-rasterised sprite. */
const MIN_RASTER_SIZE = 8;
const MAX_RASTER_SIZE = 1024;

/**
 * Power-of-two size bucket for a sprite drawn `targetPx` device pixels wide. Drawing a cached bitmap
 * at most 2x smaller than its bucket keeps it sharp, and a handful of buckets covers every zoom level.
 */
export function rasterBucket(targetPx: number): number {
    const clamped = Math.min(MAX_RASTER_SIZE, Math.max(MIN_RASTER_SIZE, targetPx));
    return Math.min(MAX_RASTER_SIZE, 2 ** Math.ceil(Math.log2(clamped)));
}

// Least-recently-used first (Map keeps insertion order; a hit re-inserts the entry)
const RASTER_CACHE = new Map<string, HTMLCanvasElement>();
// Keep at most ~16M cached pixels (~64MB): zooming around a big game would otherwise grow forever
const RASTER_CACHE_MAX_PIXELS = 16 * 1024 * 1024;
let rasterCachePixels = 0;
// Rasterise only a few sprites per frame-sized window, so crossing a zoom bucket doesn't stall a
// frame redrawing every sprite on screen; the rest use the SVG for a frame or two
const RASTER_BUDGET_PER_WINDOW = 12;
const RASTER_WINDOW_MS = 16;
let rasterWindowStart = 0;
let rasterWindowCount = 0;

/**
 * A sprite ready to draw `w`x`h` world px at `pixelScale` device px per world px (zoom * DPR).
 *
 * PERFORMANCE: browsers re-rasterise an SVG <img> on every scaled drawImage, which halves the
 * classic 2D view's frame rate when zoomed out. Each SVG is rasterised once per (owner, size bucket)
 * into a canvas, and drawing a bitmap is cheap. Falls back to the SVG image when no canvas is
 * available, and returns null until the image has loaded.
 */
export function getAssetBitmap(key: string, owner: number, w: number, h: number, pixelScale: number): CanvasImageSource | null {
    const img = getAsset(key, owner);
    if (!img || !img.complete || img.naturalWidth === 0) return null;
    if (w <= 0 || h <= 0) return img;

    const bucketW = rasterBucket(w * pixelScale);
    const bucketH = Math.max(1, Math.round(bucketW * h / w));
    const cacheKey = `${key}_${owner}_${bucketW}x${bucketH}`;
    const cached = RASTER_CACHE.get(cacheKey);
    if (cached) {
        RASTER_CACHE.delete(cacheKey);
        RASTER_CACHE.set(cacheKey, cached);
        return cached;
    }

    if (typeof document === 'undefined') return img;
    const now = performance.now();
    if (now - rasterWindowStart > RASTER_WINDOW_MS) {
        rasterWindowStart = now;
        rasterWindowCount = 0;
    }
    if (rasterWindowCount >= RASTER_BUDGET_PER_WINDOW) return img;
    rasterWindowCount++;
    const canvas = document.createElement('canvas');
    canvas.width = bucketW;
    canvas.height = bucketH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return img;
    try {
        ctx.drawImage(img, 0, 0, bucketW, bucketH);
    } catch {
        return img;
    }
    RASTER_CACHE.set(cacheKey, canvas);
    rasterCachePixels += bucketW * bucketH;
    for (const [oldKey, oldCanvas] of RASTER_CACHE) {
        if (rasterCachePixels <= RASTER_CACHE_MAX_PIXELS || oldKey === cacheKey) break;
        RASTER_CACHE.delete(oldKey);
        rasterCachePixels -= oldCanvas.width * oldCanvas.height;
    }
    return canvas;
}

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

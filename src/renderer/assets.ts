import { PLAYER_COLORS } from '../engine/types.js';

// Legacy exports for backward compatibility
export const PLAYER_COLOR = PLAYER_COLORS[0];
export const ENEMY_COLOR = PLAYER_COLORS[1];

const RECT_BASE = `<rect x="5" y="5" width="90" height="90" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/>`;
const TANK_TREADS = `<rect x="5" y="5" width="90" height="20" fill="#222"/><rect x="5" y="75" width="90" height="20" fill="#222"/>`;

const svgs: Record<string, string> = {
    'conyard': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${RECT_BASE}<rect x="25" y="25" width="50" height="50" fill="#333" stroke="#fff" stroke-width="2"/><path d="M50 50 L90 10" stroke="#fff" stroke-width="4"/><circle cx="50" cy="50" r="10" fill="#fff"/></svg>`,
    'power': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${RECT_BASE}<path d="M40 10 L60 10 L60 90 L40 90 Z" fill="#222"/><path d="M50 20 L30 50 L50 50 L40 80 L70 40 L50 40 L60 20 Z" fill="#0ff" stroke="#fff"/></svg>`,
    'refinery': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect x="5" y="15" width="90" height="70" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/><rect x="10" y="20" width="30" height="60" fill="#222"/><rect x="50" y="20" width="40" height="40" fill="#555"/><path d="M60 40 L80 40 L70 30 Z" fill="#fa0"/></svg>`,
    'barracks': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${RECT_BASE}<rect x="20" y="20" width="60" height="60" fill="#444"/><rect x="35" y="35" width="30" height="30" fill="#111"/><path d="M10 10 L50 40 L90 10" stroke="#000" stroke-width="2" fill="none"/></svg>`,
    'factory': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect x="5" y="5" width="90" height="90" fill="COL_PRIMARY" stroke="#000"/><rect x="20" y="10" width="60" height="80" fill="#333"/><line x1="20" y1="20" x2="80" y2="20" stroke="#555" stroke-width="2"/><line x1="20" y1="40" x2="80" y2="40" stroke="#555" stroke-width="2"/><line x1="20" y1="60" x2="80" y2="60" stroke="#555" stroke-width="2"/><line x1="20" y1="80" x2="80" y2="80" stroke="#555" stroke-width="2"/></svg>`,
    'turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="45" fill="#333" stroke="#000"/><rect x="30" y="30" width="40" height="40" fill="COL_PRIMARY"/><rect x="40" y="0" width="20" height="50" fill="#888" stroke="#000"/></svg>`,
    'tech': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${RECT_BASE}<circle cx="50" cy="50" r="30" fill="#444" stroke="#fff"/><circle cx="50" cy="50" r="10" fill="#0ff"/><line x1="50" y1="50" x2="90" y2="20" stroke="#fff" stroke-width="2"/></svg>`,
    'rifle': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="COL_PRIMARY" stroke="#000" stroke-width="4"/><line x1="50" y1="50" x2="90" y2="50" stroke="#000" stroke-width="8"/></svg>`,
    'rocket': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="COL_PRIMARY" stroke="#000" stroke-width="4"/><rect x="50" y="40" width="40" height="20" fill="#555"/><rect x="80" y="35" width="10" height="30" fill="#f00"/></svg>`,
    'engineer': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#fff" stroke="COL_PRIMARY" stroke-width="4"/><rect x="40" y="20" width="20" height="60" fill="#f00"/><rect x="20" y="40" width="60" height="20" fill="#f00"/></svg>`,
    'jeep': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect x="10" y="20" width="80" height="60" rx="10" fill="COL_PRIMARY" stroke="#000"/><rect x="50" y="25" width="30" height="50" fill="#222" opacity="0.5"/><line x1="60" y1="50" x2="90" y2="50" stroke="#fff" stroke-width="4"/></svg>`,
    'light': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${TANK_TREADS}<rect x="15" y="20" width="70" height="60" fill="COL_PRIMARY" stroke="#000"/><rect x="40" y="35" width="30" height="30" fill="#333"/><rect x="60" y="45" width="35" height="10" fill="#888"/></svg>`,
    'heavy': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${TANK_TREADS}<rect x="10" y="15" width="80" height="70" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/><rect x="35" y="30" width="40" height="40" fill="#222"/><rect x="65" y="42" width="35" height="16" fill="#888"/><rect x="65" y="42" width="10" height="16" fill="#f00"/></svg>`,
    'artillery': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${TANK_TREADS}<rect x="20" y="25" width="50" height="50" fill="COL_PRIMARY" stroke="#000"/><rect x="40" y="40" width="55" height="20" fill="#111"/></svg>`,
    'harvester': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect x="5" y="20" width="90" height="60" rx="5" fill="COL_PRIMARY" stroke="#000"/><rect x="10" y="25" width="30" height="50" fill="#da0"/><path d="M95 20 L95 80 L80 50 Z" fill="#222"/></svg>`,
    'heli': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect x="20" y="45" width="60" height="10" fill="#555"/><circle cx="50" cy="50" r="25" fill="COL_PRIMARY" stroke="#000"/><rect x="10" y="10" width="80" height="5" fill="#111" opacity="0.8"/><rect x="10" y="85" width="80" height="5" fill="#111" opacity="0.8"/><line x1="50" y1="20" x2="50" y2="80" stroke="#111" stroke-width="2"/></svg>`,
    'mcv': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">${TANK_TREADS}<rect x="10" y="10" width="80" height="80" fill="COL_PRIMARY" stroke="#fff" stroke-width="2"/><rect x="30" y="30" width="40" height="40" fill="#222"/><text x="50" y="60" font-size="20" text-anchor="middle" fill="#fff">MCV</text></svg>`,
    'ore': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="#d4af37"/></svg>`,
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


import { PLAYER_COLORS } from '../engine/types.js';

// Legacy exports for backward compatibility
export const PLAYER_COLOR = PLAYER_COLORS[0];
export const ENEMY_COLOR = PLAYER_COLORS[1];



const TREADS_H = `
    <rect x="2" y="2" width="96" height="22" fill="#111" rx="4"/>
    <rect x="2" y="76" width="96" height="22" fill="#111" rx="4"/>
    <path d="M2 5 L98 5 M2 15 L98 15" stroke="#333" stroke-width="2" stroke-dasharray="4,4"/>
    <path d="M2 85 L98 85 M2 95 L98 95" stroke="#333" stroke-width="2" stroke-dasharray="4,4"/>
`;

// Helper for "Glass" windows
const WINDOW_GRAD = `
    <defs>
        <linearGradient id="winGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#acf;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#48c;stop-opacity:1" />
        </linearGradient>
    </defs>
`;

const svgs: Record<string, string> = {
    // --- BUILDINGS (Large, Clear text/icons) ---

    'conyard': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="5" y="5" width="90" height="90" fill="COL_PRIMARY" stroke="#000" stroke-width="3"/>
        <rect x="20" y="20" width="60" height="60" fill="#333"/>
        <path d="M20 20 L50 45 L80 20" stroke="#555" stroke-width="2"/> 
        <rect x="35" y="35" width="30" height="30" fill="#222" stroke="#fff" stroke-width="2"/>
        <path d="M25 80 L75 80 L60 50 L40 50 Z" fill="#666"/> <!-- Ramp -->
        <rect x="45" y="40" width="10" height="20" fill="#f00"/> <!-- Crane Base -->
        <circle cx="50" cy="40" r="5" fill="#f00"/>
    </svg>`,

    'power': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="10" y="20" width="80" height="70" fill="#333" stroke="#000" stroke-width="2"/>
        <rect x="15" y="10" width="20" height="30" fill="#555" stroke="#000"/>
        <rect x="65" y="10" width="20" height="30" fill="#555" stroke="#000"/>
        <rect x="0" y="80" width="100" height="15" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/>
        <path d="M40 40 L60 40 L50 60 Z" fill="#0ff"/> <!-- Lightning Icon -->
        <path d="M50 30 L50 70" stroke="#0ff" stroke-width="2"/>
    </svg>`,

    'refinery': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="5" y="5" width="60" height="90" fill="COL_PRIMARY" stroke="#000" stroke-width="3"/>
        <rect x="70" y="20" width="25" height="60" fill="#444" stroke="#000" stroke-width="2"/> <!-- Silo -->
        <rect x="20" y="20" width="30" height="40" fill="#222"/> <!-- Funnel Base -->
        <path d="M10 20 L60 20 L50 50 L20 50 Z" fill="#555" opacity="0.5"/>
        <path d="M70 40 L85 20 L95 40 Z" fill="#fa0" stroke="#000"/> <!-- Gold Icon -->
        <line x1="60" y1="50" x2="70" y2="50" stroke="#000" stroke-width="4"/> <!-- Pipe -->
    </svg>`,

    'barracks': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="5" y="5" width="90" height="90" fill="COL_PRIMARY" stroke="#000" stroke-width="3"/>
        <rect x="15" y="15" width="70" height="40" fill="#444" stroke="#000" stroke-width="2"/> <!-- Roof -->
        <rect x="35" y="60" width="30" height="35" fill="#111"/> <!-- Door -->
        <path d="M15 15 L45 0 L85 15" fill="#333"/>
        <circle cx="50" cy="35" r="10" fill="#fff" stroke="#000"/>
        <path d="M45 35 L55 35 M50 30 L50 40" stroke="#f00" stroke-width="3"/> <!-- Cross -->
    </svg>`,

    'factory': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="5" y="10" width="90" height="80" fill="COL_PRIMARY" stroke="#000" stroke-width="3"/>
        <rect x="25" y="30" width="50" height="60" fill="#222" stroke="#000" stroke-width="2"/> <!-- Open Bay -->
        <path d="M5 10 L25 30 L75 30 L95 10" fill="#555"/> <!-- Roof Slope -->
        <rect x="20" y="0" width="15" height="20" fill="#444"/> <!-- Chimney -->
        <rect x="65" y="0" width="15" height="20" fill="#444"/> <!-- Chimney -->
        <line x1="25" y1="30" x2="75" y2="30" stroke="#ff0" stroke-width="2" stroke-dasharray="5,5"/> <!-- Warning Line -->
    </svg>`,

    'tech': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${WINDOW_GRAD}
        <rect x="10" y="10" width="80" height="80" rx="10" fill="COL_PRIMARY" stroke="#000" stroke-width="3"/>
        <path d="M30 10 L50 50 L70 10" fill="#333" opacity="0.3"/>
        <circle cx="50" cy="50" r="25" fill="#222" stroke="#fff" stroke-width="2"/> <!-- Dish Base -->
        <circle cx="50" cy="50" r="15" fill="url(#winGrad)" stroke="#fff"/> <!-- Glow Center -->
        <line x1="50" y1="50" x2="80" y2="20" stroke="#fff" stroke-width="3"/> <!-- Antenna -->
    </svg>`,

    // --- DEFENSE ---

    'turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="25" y="25" width="50" height="50" fill="#444" stroke="#000" stroke-width="2"/> <!-- Base -->
        <circle cx="50" cy="50" r="20" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/>
        <rect x="42" y="5" width="16" height="45" fill="#111" stroke="#000"/> <!-- Barrel -->
    </svg>`,

    'sam_site': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="20" y="50" width="60" height="40" fill="#444" stroke="#000" stroke-width="2"/>
        <rect x="25" y="45" width="50" height="20" fill="COL_PRIMARY"/>
        <!-- Missiles (High contrast white) -->
        <rect x="30" y="10" width="10" height="40" fill="#fff" stroke="#000"/>
        <rect x="60" y="10" width="10" height="40" fill="#fff" stroke="#000"/>
        <polygon points="35,5 30,15 40,15" fill="#f00"/>
        <polygon points="65,5 60,15 70,15" fill="#f00"/>
    </svg>`,

    'pillbox': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="#333" stroke="#000" stroke-width="2"/>
        <circle cx="50" cy="50" r="30" fill="#444"/>
        <rect x="30" y="45" width="40" height="10" fill="#000"/> <!-- Slit -->
        <circle cx="50" cy="50" r="10" fill="COL_PRIMARY"/>
    </svg>`,

    'obelisk': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <path d="M20 90 L80 90 L50 10 Z" fill="#111" stroke="COL_PRIMARY" stroke-width="4"/>
        <circle cx="50" cy="15" r="8" fill="#f00" stroke="#fff" stroke-width="2"/>
    </svg>`,


    // --- UNITS (High Contrast, Simple Shapes) ---
    // Infantry: Large Heads/Icons

    'rifle': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="COL_PRIMARY" stroke="#000" stroke-width="4"/>
        <line x1="50" y1="50" x2="85" y2="50" stroke="#000" stroke-width="8"/> <!-- Gun -->
        <circle cx="50" cy="50" r="15" fill="#ffe0bd"/> <!-- Head -->
    </svg>`,

    'rocket': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="COL_PRIMARY" stroke="#000" stroke-width="4"/>
        <rect x="40" y="20" width="20" height="40" fill="#444"/> <!-- Launcher on back -->
        <circle cx="50" cy="50" r="15" fill="#ffe0bd"/>
    </svg>`,

    'engineer': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="#ffdd00" stroke="#000" stroke-width="4"/>
        <rect x="40" y="30" width="20" height="15" fill="#ffdd00" stroke="#d4a000" stroke-width="2"/> <!-- Hardhat -->
        <circle cx="50" cy="50" r="15" fill="#ffe0bd"/>
    </svg>`,

    'medic': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="#fff" stroke="#000" stroke-width="4"/>
        <rect x="45" y="35" width="10" height="30" fill="#f00"/>
        <rect x="35" y="45" width="30" height="10" fill="#f00"/>
    </svg>`,

    'sniper': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="35" fill="COL_PRIMARY" stroke="#000" stroke-width="3"/>
        <line x1="50" y1="50" x2="95" y2="50" stroke="#000" stroke-width="4"/> <!-- Long Gun -->
        <circle cx="50" cy="50" r="15" fill="#333"/> <!-- Hood -->
    </svg>`,

    'flamer': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="COL_PRIMARY" stroke="#000" stroke-width="4"/>
        <circle cx="35" cy="40" r="10" fill="#f00" stroke="#000"/> <!-- Tank -->
        <circle cx="65" cy="40" r="10" fill="#f00" stroke="#000"/> <!-- Tank -->
        <rect x="45" y="50" width="10" height="40" fill="#111"/> <!-- Nozzle -->
    </svg>`,

    'grenadier': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="38" fill="COL_PRIMARY" stroke="#000" stroke-width="4"/>
        <circle cx="65" cy="35" r="12" fill="#222"/> <!-- Bomb -->
    </svg>`,

    'commando': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="#111" stroke="#fff" stroke-width="2"/>
        <rect x="40" y="30" width="20" height="10" fill="#222"/> <!-- Beret -->
        <circle cx="50" cy="50" r="15" fill="#ffe0bd"/>
    </svg>`,


    // --- VEHICLES (Detailed Treads, Clear Bodies) ---

    'harvester': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="5" y="15" width="90" height="70" rx="10" fill="COL_PRIMARY" stroke="#000" stroke-width="3"/>
        <rect x="20" y="25" width="60" height="50" fill="#aa0" stroke="#000"/> <!-- Yellow Cargo Box -->
        <rect x="85" y="30" width="10" height="40" fill="#222"/> <!-- Mouth -->
        <path d="M10 20 L20 20 L20 80 L10 80 Z" fill="#111"/> <!-- TreadHint -->
    </svg>`,

    'jeep': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="15" y="30" width="70" height="40" rx="5" fill="COL_PRIMARY" stroke="#000" stroke-width="3"/>
        <rect x="50" y="35" width="15" height="30" fill="#222"/> <!-- Open Top -->
        <rect x="15" y="20" width="20" height="10" fill="#111"/> <!-- Wheel -->
        <rect x="65" y="20" width="20" height="10" fill="#111"/> <!-- Wheel -->
        <rect x="15" y="70" width="20" height="10" fill="#111"/> <!-- Wheel -->
        <rect x="65" y="70" width="20" height="10" fill="#111"/> <!-- Wheel -->
        <line x1="60" y1="50" x2="85" y2="50" stroke="#fff" stroke-width="3"/> <!-- Gun -->
    </svg>`,

    'apc': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${TREADS_H}
        <rect x="10" y="20" width="80" height="60" rx="4" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/>
        <rect x="30" y="30" width="40" height="40" fill="#333" stroke="#000"/> <!-- Hatch -->
    </svg>`,

    'light': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${TREADS_H}
        <rect x="25" y="25" width="50" height="50" rx="5" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/>
        <circle cx="45" cy="50" r="12" fill="#222" stroke="#000"/>
        <rect x="45" y="46" width="40" height="8" fill="#111"/> <!-- Gun -->
    </svg>`,

    'heavy': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${TREADS_H}
        <rect x="20" y="20" width="60" height="60" rx="0" fill="COL_PRIMARY" stroke="#000" stroke-width="3"/>
        <rect x="35" y="30" width="30" height="40" fill="#222" stroke="#000"/> <!-- Turret -->
        <rect x="50" y="45" width="40" height="10" fill="#111"/> <!-- Gun -->
        <rect x="50" y="43" width="10" height="14" fill="#444"/> <!-- Gun Base -->
    </svg>`,

    'flame_tank': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${TREADS_H}
        <rect x="20" y="20" width="60" height="60" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/>
        <circle cx="40" cy="50" r="15" fill="#c30" stroke="#000"/> <!-- Tank L -->
        <circle cx="60" cy="50" r="15" fill="#c30" stroke="#000"/> <!-- Tank R -->
        <rect x="70" y="45" width="20" height="10" fill="#111"/>
    </svg>`,

    'stealth': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <polygon points="10,50 40,10 90,50 40,90" fill="#222" stroke="COL_PRIMARY" stroke-width="2"/>
    </svg>`,

    'artillery': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${TREADS_H}
        <rect x="25" y="30" width="40" height="40" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/>
        <rect x="40" y="44" width="55" height="12" fill="#111"/> <!-- Long Gun -->
    </svg>`,

    'mlrs': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${TREADS_H}
        <rect x="20" y="20" width="60" height="60" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/>
        <rect x="30" y="30" width="40" height="40" fill="#eee" stroke="#000"/>
        <circle cx="40" cy="40" r="5" fill="#f00"/>
        <circle cx="60" cy="40" r="5" fill="#f00"/>
        <circle cx="40" cy="60" r="5" fill="#f00"/>
        <circle cx="60" cy="60" r="5" fill="#f00"/>
    </svg>`,

    'mammoth': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="5" y="5" width="90" height="25" fill="#222" rx="5"/>
        <rect x="5" y="70" width="90" height="25" fill="#222" rx="5"/>
        <rect x="15" y="20" width="70" height="60" fill="COL_PRIMARY" stroke="#000" stroke-width="3"/>
        <rect x="40" y="35" width="40" height="30" fill="#333" stroke="#000"/>
        <rect x="70" y="40" width="30" height="6" fill="#111"/>
        <rect x="70" y="54" width="30" height="6" fill="#111"/>
    </svg>`,

    'mcv': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${TREADS_H}
        <rect x="15" y="15" width="70" height="70" fill="COL_PRIMARY" stroke="#fff" stroke-width="3"/>
        <text x="50" y="58" font-family="Arial" font-weight="bold" font-size="24" text-anchor="middle" fill="#fff" stroke="#000" stroke-width="1">MCV</text>
    </svg>`,

    'heli': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <rect x="42" y="5" width="16" height="90" fill="#111" opacity="0.4">
             <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="0.1s" repeatCount="indefinite"/>
        </rect>
        <rect x="5" y="42" width="90" height="16" fill="#111" opacity="0.4">
             <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="0.1s" repeatCount="indefinite"/>
        </rect>
        <ellipse cx="50" cy="50" rx="25" ry="15" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/>
        <line x1="25" y1="50" x2="5" y2="50" stroke="#000" stroke-width="4"/>
    </svg>`,

    'ore': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="#d4af37" stroke="#b8860b" stroke-width="2"/>
        <circle cx="35" cy="35" r="10" fill="#ffe082" opacity="0.8"/>
        <circle cx="65" cy="65" r="5" fill="#ffe082" opacity="0.8"/>
    </svg>`,
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

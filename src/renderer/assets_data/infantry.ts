import { SHARED_DEFS } from './shared';

const SOLDIER_BODY = `
    <!-- Backpack -->
    <rect x="32" y="58" width="36" height="22" rx="5" fill="#2c2f33" stroke="#111" stroke-width="2"/>
    <rect x="38" y="62" width="24" height="14" rx="2" fill="#23272a"/>
    
    <!-- Body/Vest -->
    <ellipse cx="50" cy="50" rx="26" ry="20" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
    <path d="M 32 50 A 26 20 0 0 0 68 50" fill="#000" opacity="0.2"/>
    
    <!-- Shoulders -->
    <circle cx="25" cy="52" r="8" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
    <circle cx="75" cy="52" r="8" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>

    <!-- Helmet -->
    <circle cx="50" cy="44" r="15" fill="#333" stroke="#111" stroke-width="2"/>
    <ellipse cx="50" cy="42" rx="13" ry="11" fill="url(#metalGrad)" opacity="0.8"/>
`;

export const infantry: Record<string, string> = {
    'rifle': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Hands -->
            <ellipse cx="28" cy="62" rx="6" ry="6" fill="#ffe0bd" stroke="#111" stroke-width="1.5"/>
            <ellipse cx="72" cy="62" rx="6" ry="6" fill="#ffe0bd" stroke="#111" stroke-width="1.5"/>
            
            <!-- Assault Rifle -->
            <path d="M 15 62 L 75 62 L 75 58 L 15 58 Z" fill="#222" stroke="#111"/>
            <path d="M 55 62 L 55 75 L 62 75 L 62 62 Z" fill="#222" stroke="#111"/> <!-- Magazine -->
            <path d="M 22 58 L 30 58 L 30 54 L 22 54 Z" fill="#111"/> <!-- Stock -->
            <rect x="68" y="57" width="8" height="2" fill="#555"/> <!-- Barrel detail -->
        </g>
    </svg>`,

    'rocket': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Hands holding launcher -->
            <ellipse cx="68" cy="45" rx="6" ry="6" fill="#ffe0bd" stroke="#111" stroke-width="1.5"/>
            <ellipse cx="68" cy="70" rx="6" ry="6" fill="#ffe0bd" stroke="#111" stroke-width="1.5"/>
            
            <!-- Rocket Launcher -->
            <rect x="62" y="15" width="14" height="70" rx="3" fill="#3a4042" stroke="#111" stroke-width="2"/>
            <rect x="58" y="10" width="22" height="12" rx="2" fill="#222" stroke="#111" stroke-width="2"/> <!-- Muzzle -->
            <rect x="60" y="80" width="18" height="10" rx="1" fill="#222" stroke="#111"/> <!-- Exhaust -->
            <path d="M 58 40 L 62 40 L 62 55 L 58 55 Z" fill="#111"/> <!-- Grip -->
            
            <!-- Targeting sight -->
            <rect x="54" y="30" width="8" height="10" fill="#222" stroke="#111"/>
            <circle cx="58" cy="35" r="2" fill="#f00"/>
        </g>
    </svg>`,

    'engineer': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Yellow Vest Body -->
            <ellipse cx="50" cy="50" rx="26" ry="20" fill="#ffcc00" stroke="#111" stroke-width="2"/>
            <path d="M 35 40 L 65 40 L 65 60 L 35 60 Z" fill="#e6b800" opacity="0.6"/> <!-- Vest Details -->
            
            <!-- Reflective Strips -->
            <rect x="35" y="42" width="6" height="15" fill="#ddd"/>
            <rect x="59" y="42" width="6" height="15" fill="#ddd"/>
            
            <!-- Hard Hat -->
            <circle cx="50" cy="44" r="15" fill="#ffb300" stroke="#8c6300" stroke-width="2"/>
            <path d="M 32 44 A 18 18 0 0 1 68 44" fill="none" stroke="#fff" stroke-width="3" opacity="0.7"/> <!-- Brim -->
            <circle cx="50" cy="44" r="8" fill="#e6a100"/>
            
            <!-- Tool Belt -->
            <path d="M 24 50 Q 50 65 76 50" fill="none" stroke="#634" stroke-width="5"/>
            <rect x="30" y="55" width="8" height="12" fill="#888" stroke="#111"/>
            <rect x="62" y="55" width="10" height="14" fill="#666" stroke="#111"/>
            
            <!-- Tool Case -->
            <rect x="68" y="40" width="24" height="30" rx="3" fill="#a0522d" stroke="#3e2723" stroke-width="2"/>
            <rect x="70" y="42" width="20" height="26" rx="2" fill="#8b4513"/>
            <path d="M 75 40 L 85 40" stroke="#3e2723" stroke-width="4"/> <!-- Handle -->
        </g>
    </svg>`,

    'medic': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- White Uniform -->
            <ellipse cx="50" cy="50" rx="26" ry="20" fill="#f0f0f0" stroke="#999" stroke-width="2"/>
            
            <!-- Medic Badges -->
            <circle cx="35" cy="45" r="5" fill="#fff" stroke="#999"/>
            <path d="M 34 42 L 36 42 L 36 48 L 34 48 Z M 32 44 L 38 44 L 38 46 L 32 46 Z" fill="#d00"/>
            
            <!-- Medical Bag -->
            <rect x="20" y="52" width="24" height="22" rx="4" fill="#fff" stroke="#d00" stroke-width="2"/>
            <path d="M 30 56 L 34 56 L 34 68 L 30 68 Z M 26 60 L 38 60 L 38 64 L 26 64 Z" fill="#d00"/>
            <path d="M 26 52 Q 32 45 38 52" fill="none" stroke="#666" stroke-width="3"/> <!-- Handle -->
            
            <!-- Helmet with Cross -->
            <circle cx="50" cy="44" r="15" fill="#e0e0e0" stroke="#999" stroke-width="2"/>
            <path d="M 48 37 L 52 37 L 52 51 L 48 51 Z M 41 42 L 59 42 L 59 46 L 41 46 Z" fill="#d00"/>
        </g>
    </svg>`,

    'sniper': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Ghillie Suit / Camo base -->
            <path d="M 15 45 Q 50 15 85 45 Q 95 65 75 85 Q 50 95 25 85 Q 5 65 15 45 Z" fill="#3a4b33" stroke="#1d261a" stroke-width="2"/>
            
            <!-- Camo textures -->
            <circle cx="35" cy="35" r="8" fill="#2d3b27"/>
            <circle cx="75" cy="65" r="9" fill="#2d3b27"/>
            <ellipse cx="65" cy="35" rx="10" ry="6" fill="#4d5c44"/>
            <ellipse cx="30" cy="70" rx="12" ry="8" fill="#4d5c44"/>
            
            <!-- Hood overlapping -->
            <circle cx="50" cy="48" r="16" fill="#2d3b27" stroke="#1d261a" stroke-width="2"/>
            <circle cx="50" cy="48" r="7" fill="#111"/> <!-- Dark face area -->
            
            <!-- Sniper Rifle (Long) -->
            <path d="M 25 46 L 95 46 L 95 42 L 25 42 Z" fill="#1a1a1a" stroke="#000" stroke-width="1"/>
            <rect x="42" y="43" width="30" height="10" rx="2" fill="#222" stroke="#111"/> <!-- Scope Base -->
            <rect x="45" y="44" width="24" height="6" fill="#111"/> <!-- Scope Tube -->
            <circle cx="45" cy="47" r="3" fill="url(#glassGrad)"/> <!-- Scope Lens front -->
            <circle cx="69" cy="47" r="3" fill="#000"/> <!-- Scope eye piece -->
            
            <!-- Suppressor -->
            <rect x="85" y="41" width="15" height="6" rx="1" fill="#333"/>
        </g>
    </svg>`,

    'flamer': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Heavy backpack frame -->
            <rect x="25" y="55" width="50" height="28" rx="2" fill="#444" stroke="#111" stroke-width="2"/>
            
            <!-- Fuel Tanks -->
            <rect x="28" y="20" width="20" height="55" rx="10" fill="#cc2222" stroke="#660000" stroke-width="2"/>
            <rect x="52" y="20" width="20" height="55" rx="10" fill="#cc2222" stroke="#660000" stroke-width="2"/>
            <rect x="28" y="30" width="20" height="8" fill="#881111"/>
            <rect x="52" y="30" width="20" height="8" fill="#881111"/>
            
            <!-- Tubes -->
            <path d="M 38 22 Q 45 10 55 58" fill="none" stroke="#222" stroke-width="4"/>
            <path d="M 62 22 Q 80 30 75 55" fill="none" stroke="#333" stroke-width="3"/>
            
            <!-- Flamethrower Gun -->
            <path d="M 65 52 L 95 52 L 95 60 L 65 60 Z" fill="#3a3a3a" stroke="#111" stroke-width="2"/>
            <rect x="88" y="54" width="10" height="4" fill="#222"/> <!-- Nozzle inner -->
            
            <!-- Pilot Light and flame guard -->
            <path d="M 95 48 L 98 48 L 98 64 L 95 64 Z" fill="#666"/>
            <circle cx="98" cy="56" r="3" fill="#ff9900">
                <animate attributeName="opacity" values="0.6;1;0.6" dur="0.1s" repeatCount="indefinite"/>
            </circle>
            <circle cx="98" cy="56" r="1.5" fill="#fff"/>
        </g>
    </svg>`,

    'grenadier': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            
            <!-- Heavy Bandolier / Armor -->
            <path d="M 28 40 Q 50 75 72 40" fill="none" stroke="#2b2b2b" stroke-width="12"/>
            
            <!-- Grenades on vest -->
            <circle cx="35" cy="48" r="5" fill="#4a5d3f" stroke="#111"/>
            <circle cx="48" cy="56" r="5" fill="#4a5d3f" stroke="#111"/>
            <circle cx="61" cy="48" r="5" fill="#4a5d3f" stroke="#111"/>
            <rect x="33" y="44" width="4" height="3" fill="#222"/>
            <rect x="46" y="52" width="4" height="3" fill="#222"/>
            <rect x="59" y="44" width="4" height="3" fill="#222"/>
            
            <!-- Hands -->
            <ellipse cx="50" cy="35" rx="6" ry="6" fill="#ffe0bd" stroke="#111" stroke-width="1.5"/>
            <ellipse cx="65" cy="45" rx="6" ry="6" fill="#ffe0bd" stroke="#111" stroke-width="1.5"/>
            
            <!-- Grenade Launcher (Thick barrel) -->
            <rect x="50" y="32" width="35" height="14" rx="2" fill="#2a2a2a" stroke="#111" stroke-width="2"/>
            <rect x="55" y="30" width="8" height="4" fill="#111"/> <!-- Sight -->
            <ellipse cx="85" cy="39" rx="4" ry="7" fill="#111"/> <!-- Muzzle hole -->
            <rect x="80" y="30" width="6" height="18" fill="#333" rx="1"/> <!-- Muzzle ring -->
        </g>
    </svg>`,

    'commando': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Muscle Body (Sleeveless tank top vibe) -->
            <ellipse cx="50" cy="50" rx="28" ry="24" fill="#222" stroke="#111" stroke-width="2"/>
            <path d="M 28 50 C 35 65 65 65 72 50 Z" fill="#1a1a1a"/>
            
            <!-- Muscular Arms / Shoulders -->
            <ellipse cx="22" cy="50" rx="10" ry="12" fill="#d2a679" stroke="#111" stroke-width="2"/>
            <ellipse cx="78" cy="50" rx="10" ry="12" fill="#d2a679" stroke="#111" stroke-width="2"/>
            
            <!-- Head & Beret -->
            <circle cx="50" cy="45" r="14" fill="#d2a679" stroke="#111" stroke-width="2"/>
            <path d="M 32 45 L 68 45 L 63 32 L 38 32 Z" fill="#990000" stroke="#4a0000" stroke-width="2"/> <!-- Beret base -->
            <path d="M 68 45 Q 75 48 65 52 Q 62 48 68 45" fill="#990000"/> <!-- Beret flop -->
            <circle cx="42" cy="40" r="2" fill="#d4af37"/> <!-- Beret badge -->
            
            <!-- Dual Submachine Guns -->
            <path d="M 75 30 L 95 30 L 95 38 L 75 38 Z" fill="#444" stroke="#111"/>
            <rect x="85" y="36" width="6" height="12" fill="#222"/> <!-- Mag -->
            <path d="M 75 62 L 95 62 L 95 70 L 75 70 Z" fill="#444" stroke="#111"/>
            <rect x="85" y="68" width="6" height="12" fill="#222"/> <!-- Mag -->
            
            <!-- Bandoliers / Straps -->
            <path d="M 30 35 L 70 65" stroke="#5c3a21" stroke-width="6"/>
            <path d="M 70 35 L 30 65" stroke="#5c3a21" stroke-width="6"/>
            <!-- Bullets on straps -->
            <rect x="40" y="42" width="6" height="3" fill="#d4af37" transform="rotate(35 43 43)"/>
            <rect x="48" y="48" width="6" height="3" fill="#d4af37" transform="rotate(35 51 49)"/>
            <rect x="56" y="54" width="6" height="3" fill="#d4af37" transform="rotate(35 59 55)"/>
        </g>
    </svg>`,

    'hijacker': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <defs>
            <linearGradient id="stealthGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" style="stop-color:#2a2a35"/>
                <stop offset="100%" style="stop-color:#0d0d14"/>
            </linearGradient>
            <filter id="glow">
                <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
                <feMerge>
                    <feMergeNode in="coloredBlur"/>
                    <feMergeNode in="SourceGraphic"/>
                </feMerge>
            </filter>
        </defs>
        <g filter="url(#shadow)">
            <!-- Tactical Stealth Suit -->
            <ellipse cx="50" cy="50" rx="25" ry="18" fill="url(#stealthGrad)" stroke="#000" stroke-width="2"/>
            
            <!-- High-tech Harness (subtle purple/blue accents) -->
            <path d="M 30 45 L 35 62 L 65 62 L 70 45" fill="#12121a" stroke="#4a3b69" stroke-width="2"/>
            <rect x="42" y="52" width="16" height="8" rx="2" fill="#0a0a0a" stroke="#222"/>
            
            <!-- Shoulders -->
            <ellipse cx="25" cy="50" rx="7" ry="10" fill="#1a1a24" stroke="#000"/>
            <ellipse cx="75" cy="50" rx="7" ry="10" fill="#1a1a24" stroke="#000"/>
            
            <!-- Balaclava / Helmet -->
            <circle cx="50" cy="40" r="14" fill="#0d0d14" stroke="#000" stroke-width="2"/>
            
            <!-- NVG / Visor Glow -->
            <rect x="38" y="36" width="24" height="8" rx="3" fill="#000"/>
            <ellipse cx="43" cy="40" rx="4" ry="2" fill="#00ffff" filter="url(#glow)"/>
            <ellipse cx="57" cy="40" rx="4" ry="2" fill="#00ffff" filter="url(#glow)"/>
            
            <!-- Hijack Tool / EMP Emitter in Hands -->
            <path d="M 65 30 L 70 25 L 75 30 L 72 70 L 68 70 Z" fill="#333" stroke="#111"/>
            <circle cx="70" cy="27" r="3" fill="#00ffff" filter="url(#glow)"/>
            <circle cx="70" cy="67" r="2" fill="#00ffff"/>
            
            <!-- Tech Device on Back -->
            <rect x="40" y="60" width="20" height="12" rx="2" fill="#111" stroke="#4a3b69"/>
            <circle cx="50" cy="66" r="4" fill="#aa00ff" filter="url(#glow)"/>
        </g>
    </svg>`,
};

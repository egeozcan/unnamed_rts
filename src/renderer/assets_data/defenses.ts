import { SHARED_DEFS } from './shared';

export const defenses: Record<string, string> = {

    'turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Octagonal Heavy Base -->
            <polygon points="30,10 70,10 90,30 90,70 70,90 30,90 10,70 10,30" fill="#333" stroke="#111" stroke-width="2"/>
            <polygon points="35,15 65,15 85,35 85,65 65,85 35,85 15,65 15,35" fill="COL_PRIMARY" opacity="0.4"/>
            <polygon points="40,20 60,20 80,40 80,60 60,80 40,80 20,60 20,40" fill="url(#metalGrad)" stroke="#444" stroke-width="2"/>
            
            <!-- Gun Mount Ring -->
            <circle cx="50" cy="50" r="25" fill="#1a1a1a" stroke="#000" stroke-width="3"/>
            <circle cx="50" cy="50" r="18" fill="#222" stroke="#444" stroke-width="1" id="turretRing"/>
            
            <!-- Barrel Pivot -->
            <rect x="42" y="42" width="16" height="16" rx="3" fill="#333" stroke="#111"/>
            
            <!-- Caution details -->
            <path d="M 40 10 L 60 10 L 50 20 Z" fill="url(#caution)"/>
            <path d="M 40 90 L 60 90 L 50 80 Z" fill="url(#caution)"/>
            <path d="M 10 40 L 10 60 L 20 50 Z" fill="url(#caution)"/>
            <path d="M 90 40 L 90 60 L 80 50 Z" fill="url(#caution)"/>
        </g>
    </svg>`,

    'sam_site': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- X-shaped Platform -->
            <path d="M5 25 L25 5 L50 30 L75 5 L95 25 L70 50 L95 75 L75 95 L50 70 L25 95 L5 75 L30 50 Z" fill="#2a2a2a" stroke="#111" stroke-width="3"/>
            <path d="M5 25 L25 5 L50 30 L75 5 L95 25 L70 50 L95 75 L75 95 L50 70 L25 95 L5 75 L30 50 Z" fill="COL_PRIMARY" opacity="0.3"/>
            
            <!-- Launch Tubes (4x) -->
            <rect x="25" y="25" width="20" height="20" rx="4" fill="#111" stroke="#333" stroke-width="2"/>
            <circle cx="35" cy="35" r="5" fill="#f00"/>
            
            <rect x="55" y="25" width="20" height="20" rx="4" fill="#111" stroke="#333" stroke-width="2"/>
            <circle cx="65" cy="35" r="5" fill="#f00"/>
            
            <rect x="25" y="55" width="20" height="20" rx="4" fill="#111" stroke="#333" stroke-width="2"/>
            <circle cx="35" cy="65" r="5" fill="#f00"/>
            
            <rect x="55" y="55" width="20" height="20" rx="4" fill="#111" stroke="#333" stroke-width="2"/>
            <circle cx="65" cy="65" r="5" fill="#f00"/>
            
            <!-- Central Radar / Control -->
            <circle cx="50" cy="50" r="12" fill="url(#metalGrad)" stroke="#111" stroke-width="2"/>
            <circle cx="50" cy="50" r="4" fill="#0ff" opacity="0.8">
                 <animate attributeName="opacity" values="0.4;1;0.4" dur="1s" repeatCount="indefinite" />
            </circle>
            
            <line x1="50" y1="50" x2="35" y2="35" stroke="#444" stroke-width="2"/>
            <line x1="50" y1="50" x2="65" y2="35" stroke="#444" stroke-width="2"/>
            <line x1="50" y1="50" x2="35" y2="65" stroke="#444" stroke-width="2"/>
            <line x1="50" y1="50" x2="65" y2="65" stroke="#444" stroke-width="2"/>
        </g>
    </svg>`,

    'pillbox': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Outer Camouflage Netting / Sandbags -->
            <path d="M10 50 Q10 10 50 10 Q90 10 90 50 Q90 90 50 90 Q10 90 10 50" fill="#4B5320" stroke="#3A4015" stroke-width="4" stroke-dasharray="10 5"/>
            <path d="M15 50 Q15 15 50 15 Q85 15 85 50 Q85 85 50 85 Q15 85 15 50" fill="#554433" stroke="#4a3b2c" stroke-width="3" stroke-dasharray="8 4"/>
            
            <!-- Concrete Dome -->
            <circle cx="50" cy="50" r="28" fill="#555" stroke="#222" stroke-width="2"/>
            <circle cx="50" cy="50" r="20" fill="url(#metalGrad)" opacity="0.6"/>
            
            <!-- Player Color Banner -->
            <path d="M22 50 A 28 28 0 0 1 78 50 Z" fill="COL_PRIMARY" opacity="0.5"/>
            
            <!-- Dark Firing Slit -->
            <path d="M30 65 L70 65 L65 75 L35 75 Z" fill="#050505" stroke="#111" stroke-width="1"/>
            <rect x="40" y="68" width="20" height="3" fill="#111"/>
            
            <!-- Top Hatch -->
            <circle cx="50" cy="35" r="8" fill="#333" stroke="#111" stroke-width="2"/>
            <line x1="42" y1="35" x2="58" y2="35" stroke="#111" stroke-width="2"/>
        </g>
    </svg>`,

    'obelisk': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Sleek Base Structure -->
            <path d="M20 90 L80 90 L60 60 L40 60 Z" fill="#151515" stroke="#333" stroke-width="2"/>
            <path d="M30 60 L70 60 L60 30 L40 30 Z" fill="#111" stroke="#222" stroke-width="2"/>
            
            <!-- The Needle -->
            <path d="M40 30 L60 30 L50 5 Z" fill="#050505" stroke="#444" stroke-width="1"/>
            
            <!-- Red Energy Vents in Base -->
            <rect x="42" y="70" width="16" height="5" fill="#f00" opacity="0.7">
                <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" repeatCount="indefinite" />
            </rect>
            <rect x="42" y="80" width="16" height="5" fill="#f00" opacity="0.7">
                <animate attributeName="opacity" values="0.4;1;0.4" dur="2s" begin="0.5s" repeatCount="indefinite" />
            </rect>
            
            <!-- Glowing Ruby Crystal Tip -->
            <path d="M45 20 L55 20 L50 5 Z" fill="#f00" stroke="#f55" stroke-width="1" opacity="0.9">
                 <animate attributeName="fill" values="#d00;#f55;#d00" dur="1s" repeatCount="indefinite" />
                 <animate attributeName="opacity" values="0.7;1;0.7" dur="1s" repeatCount="indefinite" />
            </path>
            
            <!-- Crystal Aura -->
            <circle cx="50" cy="10" r="12" fill="#f00" opacity="0.3">
                 <animate attributeName="r" values="8;16;8" dur="1s" repeatCount="indefinite" />
                 <animate attributeName="opacity" values="0.1;0.5;0.1" dur="1s" repeatCount="indefinite" />
            </circle>
            
            <!-- Intense Center Dot -->
            <circle cx="50" cy="15" r="3" fill="#fff" opacity="0.9"/>
            
            <!-- Faction Decals (Red triangles) -->
            <path d="M25 85 L35 85 L30 75 Z" fill="#f00" opacity="0.6"/>
            <path d="M65 85 L75 85 L70 75 Z" fill="#f00" opacity="0.6"/>
        </g>
    </svg>`,
};

import { SHARED_DEFS } from './shared';

export const buildings: Record<string, string> = {
    'conyard': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Base Pavement -->
            <rect x="2" y="2" width="96" height="96" rx="4" fill="#334" stroke="#223" stroke-width="2"/>
            
            <!-- Main Building Structure -->
            <rect x="10" y="15" width="80" height="70" fill="url(#metalGrad)" stroke="#112" stroke-width="1"/>
            
            <!-- Player Color Band -->
            <rect x="10" y="15" width="80" height="60" fill="COL_PRIMARY" opacity="0.65" style="mix-blend-mode: overlay"/>
            <rect x="10" y="15" width="80" height="5" fill="COL_PRIMARY"/>
            
            <!-- Heavy Industrial Details -->
            <rect x="25" y="30" width="50" height="40" fill="url(#darkMetal)" stroke="#000"/>
            <rect x="30" y="35" width="40" height="30" fill="#223"/>
            
            <!-- Crane Arm -->
            <path d="M70 50 L95 20 L98 25 L80 60 Z" fill="#c44" stroke="#000" stroke-width="1"/>
            <circle cx="70" cy="50" r="8" fill="#555" stroke="#222" stroke-width="2"/>
            <circle cx="70" cy="50" r="3" fill="#111"/>
            
            <!-- Lights / Sensors -->
            <circle cx="20" cy="20" r="3" fill="#0f0" opacity="0.8"/>
            <circle cx="80" cy="20" r="3" fill="#f00" opacity="0.8"/>
        </g>
    </svg>`,

    'power': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Base -->
            <rect x="5" y="15" width="90" height="75" rx="4" fill="#333" stroke="#111"/>
            
            <!-- Cooling Towers -->
            <path d="M15 80 L25 20 L45 20 L55 80 Z" fill="url(#metalGrad)" stroke="#222"/>
            <path d="M55 80 L65 20 L85 20 L95 80 Z" fill="url(#metalGrad)" stroke="#222"/>
            
            <!-- Top Vents -->
            <ellipse cx="35" cy="20" rx="10" ry="4" fill="#111"/>
            <ellipse cx="75" cy="20" rx="10" ry="4" fill="#111"/>
            
            <!-- Energy Core -->
            <rect x="30" y="45" width="50" height="40" fill="#222" stroke="#444"/>
            <rect x="35" y="50" width="40" height="30" fill="url(#energyGrad)" opacity="0.9">
                 <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite" />
            </rect>
            
            <!-- Player Color Strip -->
            <rect x="5" y="85" width="90" height="5" fill="COL_PRIMARY"/>
            
            <!-- Lightning Symbol -->
            <path d="M55 55 L50 65 L60 65 L50 80 L55 68 L45 68 Z" fill="#fff" stroke="#000" stroke-width="1"/>
        </g>
    </svg>`,

    'refinery': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Base -->
            <rect x="2" y="5" width="96" height="90" rx="2" fill="#444" stroke="#222"/>
            
            <!-- Main Processing Unit -->
            <rect x="10" y="20" width="50" height="60" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="10" y="20" width="50" height="60" fill="url(#metalGrad)" opacity="0.5" style="mix-blend-mode: multiply"/>
            
            <!-- Large Silo -->
            <rect x="65" y="10" width="30" height="80" rx="2" fill="url(#darkMetal)" stroke="#000"/>
            <rect x="68" y="15" width="24" height="70" fill="url(#goldGrad)" opacity="0.3"/> <!-- Window to see ore -->
            
            <!-- Funnel / Chute -->
            <path d="M20 20 L50 20 L45 40 L25 40 Z" fill="#222"/>
            <rect x="25" y="40" width="20" height="40" fill="#333"/>
            
            <!-- Pipe -->
            <path d="M60 60 L65 60" stroke="#777" stroke-width="6"/>
            <path d="M60 60 L65 60" stroke="#555" stroke-width="4"/>
            
            <!-- Details -->
            <line x1="65" y1="20" x2="95" y2="20" stroke="#222" stroke-width="2"/>
            <line x1="65" y1="40" x2="95" y2="40" stroke="#222" stroke-width="2"/>
            <line x1="65" y1="60" x2="95" y2="60" stroke="#222" stroke-width="2"/>
            <line x1="65" y1="80" x2="95" y2="80" stroke="#222" stroke-width="2"/>
        </g>
    </svg>`,

    'barracks': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Main Building -->
            <rect x="5" y="15" width="90" height="75" fill="COL_PRIMARY" stroke="#222" stroke-width="2"/>
            <rect x="5" y="15" width="90" height="75" fill="url(#metalGrad)" opacity="0.4" style="mix-blend-mode: multiply"/>
            
            <!-- Roof Structure -->
            <path d="M5 15 L20 5 L80 5 L95 15" fill="#333" stroke="#000"/>
            <rect x="15" y="5" width="70" height="10" fill="#445"/>
            
            <!-- Training Yard / Door -->
            <rect x="35" y="50" width="30" height="40" fill="#222"/>
            <path d="M35 50 L65 50 L50 35 Z" fill="#333"/> 
            
            <!-- Windows -->
            <rect x="15" y="30" width="15" height="15" fill="url(#glassGrad)" stroke="#111"/>
            <rect x="70" y="30" width="15" height="15" fill="url(#glassGrad)" stroke="#111"/>
            
            <!-- Flag/Insignia -->
            <rect x="45" y="20" width="10" height="10" fill="#fff"/>
            <path d="M45 25 L55 25 M50 20 L50 30" stroke="#f00" stroke-width="2"/>
        </g>
    </svg>`,

    'factory': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Floor Plate -->
            <rect x="2" y="5" width="96" height="90" fill="#333" stroke="#111"/>
            
            <!-- Structure -->
            <path d="M5 10 L20 25 L80 25 L95 10" fill="url(#metalGrad)" stroke="#000"/>
            <rect x="5" y="10" width="90" height="80" fill="COL_PRIMARY" opacity="0.3"/>
            <rect x="5" y="5" width="90" height="85" fill="none" stroke="COL_PRIMARY" stroke-width="4"/>
            <rect x="20" y="25" width="60" height="75" fill="#1a1a1a" stroke="#444" stroke-width="2"/>
            
            <!-- Hazard Stripes on Floor -->
            <rect x="25" y="80" width="50" height="10" fill="url(#caution)"/>
            
            <!-- Cranes/Vents on Roof -->
            <rect x="10" y="10" width="15" height="15" fill="#444" stroke="#000"/>
            <rect x="75" y="10" width="15" height="15" fill="#444" stroke="#000"/>
            
            <!-- Gear Icon -->
            <circle cx="50" cy="15" r="8" fill="#555" stroke="#222" stroke-width="2"/>
            <circle cx="50" cy="15" r="3" fill="#888"/>
        </g>
    </svg>`,

    'tech': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Main Lab -->
            <rect x="10" y="10" width="80" height="80" rx="10" fill="url(#glassGrad)" stroke="#fff" stroke-width="2"/>
            <rect x="10" y="10" width="80" height="80" rx="10" fill="COL_PRIMARY" opacity="0.3"/>
            
            <!-- Dish Support -->
            <path d="M30 20 L50 50 L70 20" fill="#333" opacity="0.5"/>
            
            <!-- Radar Dish -->
            <circle cx="50" cy="50" r="25" fill="#222" stroke="#aaa" stroke-width="2"/>
            <circle cx="50" cy="50" r="20" fill="#333"/>
            <circle cx="50" cy="50" r="8" fill="#0ff" opacity="0.8">
                 <animate attributeName="opacity" values="0.4;1;0.4" dur="1.5s" repeatCount="indefinite" />
            </circle>
            
            <!-- Antenna -->
            <line x1="50" y1="50" x2="85" y2="15" stroke="#fff" stroke-width="3"/>
            <circle cx="85" cy="15" r="3" fill="#f00">
                 <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
            </circle>
        </g>
    </svg>`,
};

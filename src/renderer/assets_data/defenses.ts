import { SHARED_DEFS } from './shared';

export const defenses: Record<string, string> = {

    'turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Reinforced Concrete Base -->
            <rect x="20" y="20" width="60" height="60" rx="8" fill="#444" stroke="#222" stroke-width="2"/>
            <rect x="25" y="25" width="50" height="50" rx="4" fill="#555" stroke="#333"/>
            
            <!-- Mechanical Ring -->
            <circle cx="50" cy="50" r="22" fill="#222" stroke="#111"/>
            <circle cx="50" cy="50" r="18" fill="#111" stroke="#000" id="turretRing"/>
            
            <!-- Bolts/Details -->
            <circle cx="25" cy="25" r="2" fill="#111"/>
            <circle cx="75" cy="25" r="2" fill="#111"/>
            <circle cx="25" cy="75" r="2" fill="#111"/>
            <circle cx="75" cy="75" r="2" fill="#111"/>
            
            <!-- Hazard Stripes on Corners -->
            <path d="M20 30 L30 20 L35 20 L20 35 Z" fill="#222" opacity="0.5"/>
            <path d="M80 70 L70 80 L65 80 L80 65 Z" fill="#222" opacity="0.5"/>
        </g>
    </svg>`,

    'sam_site': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Hexagonal Heavy Base -->
            <polygon points="50,95 85,75 85,25 50,5 15,25 15,75" fill="#333" stroke="#111" stroke-width="2"/>
            <polygon points="50,85 75,70 75,30 50,15 25,30 25,70" fill="#444" stroke="#222"/>
            
            <!-- Central Mechanism -->
            <circle cx="50" cy="50" r="20" fill="#222" stroke="#000"/>
            <rect x="35" y="35" width="30" height="30" fill="url(#metalGrad)" opacity="0.3"/>
            
            <!-- Safety Markings -->
            <rect x="45" y="10" width="10" height="10" fill="url(#caution)"/>
            <rect x="45" y="80" width="10" height="10" fill="url(#caution)"/>
            
            <!-- Vents -->
            <rect x="20" y="40" width="8" height="20" fill="#111"/>
            <rect x="72" y="40" width="8" height="20" fill="#111"/>
        </g>
    </svg>`,

    'pillbox': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Sandbag Fortification -->
            <circle cx="50" cy="50" r="48" fill="#554433" stroke="#2a1f15" stroke-width="2"/>
            
            <!-- Sandbag Texture Rings -->
            <circle cx="50" cy="50" r="42" fill="none" stroke="#6b5b4a" stroke-width="4" stroke-dasharray="10 2"/>
            <circle cx="50" cy="50" r="36" fill="none" stroke="#6b5b4a" stroke-width="4" stroke-dasharray="10 2" stroke-dashoffset="5"/>
            
            <!-- Bunker Roof/Base -->
            <circle cx="50" cy="50" r="30" fill="#444" stroke="#222"/>
            <circle cx="50" cy="50" r="25" fill="#333"/>
            
            <!-- Entry Hatch (Visual) -->
            <rect x="40" y="70" width="20" height="15" fill="#222"/>
        </g>
    </svg>`,

    'obelisk': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Black Monolith Base -->
            <rect x="20" y="75" width="60" height="20" fill="#050505" stroke="#300" stroke-width="2"/>
            
            <!-- Main Tower Prism -->
            <path d="M25 75 L75 75 L55 5 L45 5 Z" fill="#111" stroke="#500" stroke-width="1"/>
            
            <!-- Pulsing Energy Core -->
            <path d="M40 60 L60 60 L52 20 L48 20 Z" fill="#f00" opacity="0.6">
                 <animate attributeName="opacity" values="0.4;0.9;0.4" dur="2s" repeatCount="indefinite" />
                 <animate attributeName="fill" values="#f00;#f55;#f00" dur="2s" repeatCount="indefinite" />
            </path>
            
            <!-- Charging Effect Lines -->
            <line x1="50" y1="70" x2="50" y2="10" stroke="#f00" stroke-width="2" opacity="0.5">
                <animate attributeName="stroke-dasharray" values="0,20;20,0" dur="0.5s" repeatCount="indefinite" />
            </line>
            
            <!-- Focusing Crystal -->
            <circle cx="50" cy="5" r="6" fill="#f00" stroke="#fff" stroke-width="2"/>
            <circle cx="50" cy="5" r="4" fill="#fff" opacity="0.9">
                 <animate attributeName="opacity" values="0.6;1;0.6" dur="0.2s" repeatCount="indefinite" />
                 <animate attributeName="r" values="3;5;3" dur="0.2s" repeatCount="indefinite" />
            </circle>
            
            <!-- Nod-style trim -->
            <path d="M25 75 L30 65 M75 75 L70 65" stroke="#400" stroke-width="2"/>
        </g>
    </svg>`,
};

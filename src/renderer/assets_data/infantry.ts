import { SHARED_DEFS } from './shared';

const SOLDIER_BODY = `
    <!-- Backpack -->
    <rect x="35" y="60" width="30" height="15" rx="3" fill="#222" stroke="#000"/>
    
    <!-- Body/Vest -->
    <ellipse cx="50" cy="50" rx="25" ry="18" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
    <rect x="35" y="40" width="30" height="20" fill="url(#metalGrad)" opacity="0.4"/> <!-- Armor Plate -->
    
    <!-- Helmet -->
    <circle cx="50" cy="45" r="14" fill="#333" stroke="#000"/>
    <ellipse cx="50" cy="45" rx="14" ry="12" fill="url(#metalGrad)" opacity="0.8"/>
`;

export const infantry: Record<string, string> = {
    'rifle': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Arms -->
            <ellipse cx="30" cy="55" rx="6" ry="6" fill="#ffe0bd" stroke="#000"/>
            <ellipse cx="70" cy="55" rx="6" ry="6" fill="#ffe0bd" stroke="#000"/>
            
            <!-- Rifle -->
            <rect x="25" y="60" width="50" height="6" fill="#111" transform="rotate(-15 50 60)"/>
            <rect x="65" y="55" width="4" height="15" fill="#111" transform="rotate(-15 50 60)"/> <!-- Magazine -->
        </g>
    </svg>`,

    'rocket': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Rocket Launcher Tube -->
            <rect x="60" y="20" width="12" height="60" rx="2" fill="#444" stroke="#000"/>
            <rect x="58" y="15" width="16" height="10" fill="#222"/> <!-- Muzzle -->
            <rect x="58" y="70" width="16" height="10" fill="#222"/> <!-- Exhaust -->
            
            <!-- Arms holding it -->
            <ellipse cx="70" cy="40" rx="6" ry="6" fill="#ffe0bd" stroke="#000"/>
            <ellipse cx="70" cy="65" rx="6" ry="6" fill="#ffe0bd" stroke="#000"/>
        </g>
    </svg>`,

    'engineer': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Yellow Vest Body -->
            <ellipse cx="50" cy="50" rx="25" ry="18" fill="#ffdd00" stroke="#000" stroke-width="2"/>
            <rect x="40" y="40" width="20" height="20" fill="#ccaa00" opacity="0.5"/> <!-- Vest Reflective -->
            
            <!-- Hard Hat -->
            <circle cx="50" cy="45" r="14" fill="#fc0" stroke="#b80"/>
            <path d="M35 45 A15 15 0 0 1 65 45" fill="none" stroke="#fff" stroke-width="2" opacity="0.6"/>
            
            <!-- Tool Case -->
            <rect x="65" y="45" width="20" height="25" fill="#a52" stroke="#421" rx="2"/>
            <path d="M70 45 L80 45" stroke="#210" stroke-width="2"/> <!-- Handle -->
        </g>
    </svg>`,

    'medic': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- White Uniform -->
            <ellipse cx="50" cy="50" rx="25" ry="18" fill="#fff" stroke="#ccc" stroke-width="2"/>
            
            <!-- Medic Bag -->
            <rect x="25" y="55" width="20" height="20" fill="#fdd" stroke="#faa"/>
            <rect x="32" y="60" width="6" height="10" fill="#f00"/>
            <rect x="30" y="62" width="10" height="6" fill="#f00"/>
            
            <!-- Helmet with Cross -->
            <circle cx="50" cy="45" r="14" fill="#eee" stroke="#ccc"/>
            <rect x="47" y="38" width="6" height="14" fill="#f00"/>
            <rect x="43" y="42" width="14" height="6" fill="#f00"/>
        </g>
    </svg>`,

    'sniper': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Ghillie Suit / Camo -->
            <path d="M20 40 Q50 20 80 40 Q90 60 70 80 Q50 90 30 80 Q10 60 20 40" fill="#342" stroke="#121"/>
            <circle cx="30" cy="30" r="5" fill="#231"/> <!-- Leaves -->
            <circle cx="70" cy="70" r="4" fill="#231"/>
            <circle cx="60" cy="30" r="5" fill="#452"/>
            
            <!-- Hood -->
            <circle cx="50" cy="50" r="14" fill="#222"/>
            
            <!-- Long Rifle -->
            <rect x="30" y="48" width="80" height="4" fill="#000" stroke="#111"/>
            <rect x="45" y="46" width="25" height="8" fill="#111"/> <!-- Scope -->
            <circle cx="45" cy="50" r="4" fill="url(#glassGrad)" opacity="0.6"/>
        </g>
    </svg>`,

    'flamer': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Fuel Tanks -->
            <rect x="20" y="25" width="18" height="45" rx="5" fill="#d00" stroke="#500"/>
            <rect x="40" y="25" width="18" height="45" rx="5" fill="#d00" stroke="#500"/>
            <path d="M30 30 L40 70" stroke="#000" opacity="0.3"/> <!-- Straps/Hoses -->
            
            <!-- Flamethrower Gun -->
            <rect x="60" y="55" width="30" height="8" fill="#333"/>
            <rect x="85" y="53" width="6" height="12" fill="#111"/> <!-- Nozzle -->
            <circle cx="90" cy="59" r="2" fill="#f90"/> <!-- Pilot Light -->
        </g>
    </svg>`,

    'grenadier': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Heavy Vest -->
            <path d="M30 40 Q50 70 70 40" fill="none" stroke="#222" stroke-width="10"/>
            <circle cx="35" cy="45" r="4" fill="#333"/> <!-- Grenade on vest -->
            <circle cx="65" cy="45" r="4" fill="#333"/>
            
            <!-- Grenade Launcher -->
            <rect x="60" y="40" width="25" height="12" fill="#222"/>
            <circle cx="85" cy="46" r="6" fill="#111"/> <!-- Barrel opening -->
        </g>
    </svg>`,

    'commando': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Muscle Body (Sleeveless) -->
            <ellipse cx="50" cy="50" rx="28" ry="22" fill="#000" stroke="#fff" stroke-width="1"/>
            <ellipse cx="30" cy="50" rx="8" ry="8" fill="#ffe0bd"/> <!-- Left Shoulder -->
            <ellipse cx="70" cy="50" rx="8" ry="8" fill="#ffe0bd"/> <!-- Right Shoulder -->
            
            <!-- Head -->
            <circle cx="50" cy="50" r="15" fill="#ffe0bd"/>
            <!-- Beret -->
            <path d="M35 45 L65 45 L60 35 L40 35 Z" fill="#900"/>
            
            <!-- Dual Guns -->
            <rect x="75" y="30" width="20" height="6" fill="#ccc" stroke="#000"/>
            <rect x="75" y="65" width="20" height="6" fill="#ccc" stroke="#000"/>
            
            <!-- Bandolier -->
            <line x1="30" y1="30" x2="70" y2="70" stroke="#530" stroke-width="4"/>
        </g>
    </svg>`,
};

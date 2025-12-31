import { SHARED_DEFS } from './shared';

const SOLDIER_BODY = `
    <!-- Shoulders -->
    <ellipse cx="50" cy="50" rx="35" ry="25" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
    <!-- Helmet -->
    <circle cx="50" cy="50" r="18" fill="url(#metalGrad)" stroke="#111"/>
`;

export const infantry: Record<string, string> = {
    'rifle': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Rifle -->
            <rect x="50" y="45" width="45" height="6" fill="#111"/> 
            <rect x="50" y="45" width="15" height="10" fill="#333"/>
            <!-- Hands -->
            <circle cx="30" cy="65" r="8" fill="#ffe0bd" stroke="#000"/>
            <circle cx="70" cy="48" r="8" fill="#ffe0bd" stroke="#000"/>
        </g>
    </svg>`,

    'rocket': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Rocket Launcher -->
            <rect x="40" y="30" width="15" height="50" fill="#444" stroke="#000"/>
            <rect x="35" y="25" width="25" height="10" fill="#222"/> <!-- Muzzle -->
            <circle cx="47" cy="80" r="10" fill="#ffe0bd" stroke="#000"/> <!-- Hand -->
        </g>
    </svg>`,

    'engineer': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Yellow Vest Body -->
            <ellipse cx="50" cy="50" rx="35" ry="25" fill="#ffdd00" stroke="#000" stroke-width="2"/>
            
            <!-- Hard Hat -->
            <path d="M30 50 A20 20 0 0 1 70 50 L70 55 L30 55 Z" fill="#fd0" stroke="#d4a000"/>
            <rect x="25" y="55" width="50" height="5" fill="#fd0" stroke="#d4a000"/>
            
            <!-- Tool Case -->
            <rect x="60" y="40" width="25" height="30" fill="#a52" stroke="#421"/>
        </g>
    </svg>`,

    'medic': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- White Body -->
            <ellipse cx="50" cy="50" rx="35" ry="25" fill="#fff" stroke="#ccc" stroke-width="2"/>
            <circle cx="50" cy="50" r="18" fill="#eee" stroke="#ccc"/>
            
            <!-- Red Cross -->
            <rect x="45" y="35" width="10" height="30" fill="#f00"/>
            <rect x="35" y="45" width="30" height="10" fill="#f00"/>
        </g>
    </svg>`,

    'sniper': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Camo Body -->
            <ellipse cx="50" cy="50" rx="30" ry="20" fill="#343" stroke="#121"/>
            <circle cx="50" cy="50" r="15" fill="#232"/> <!-- Hood -->
            
            <!-- Sniper Rifle -->
            <rect x="40" y="48" width="60" height="4" fill="#000"/>
            <rect x="50" y="46" width="20" height="8" fill="#111"/> <!-- Scope -->
        </g>
    </svg>`,

    'flamer': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Tanks -->
            <rect x="25" y="30" width="15" height="40" rx="5" fill="#d00" stroke="#500"/>
            
            <!-- Flamer -->
            <rect x="50" y="45" width="35" height="10" fill="#333"/>
            <circle cx="85" cy="50" r="3" fill="#f90"/>
        </g>
    </svg>`,

    'grenadier': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${SOLDIER_BODY}
            <!-- Vest -->
            <path d="M30 40 Q50 70 70 40" fill="none" stroke="#222" stroke-width="8"/>
            
            <!-- Grenade in hand -->
            <circle cx="75" cy="35" r="8" fill="#242" stroke="#000"/>
            <line x1="75" y1="35" x2="75" y2="28" stroke="#111" stroke-width="2"/>
        </g>
    </svg>`,

    'commando': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Muscle Body -->
            <ellipse cx="50" cy="50" rx="38" ry="28" fill="#000" stroke="#fff" stroke-width="1"/>
            <circle cx="50" cy="50" r="18" fill="#ffe0bd"/>
            
            <!-- Beret -->
            <path d="M30 45 L70 45 L65 30 L40 30 Z" fill="#222"/>
            
            <!-- Dual Guns -->
            <rect x="70" y="40" width="20" height="6" fill="#fff"/>
            <rect x="70" y="60" width="20" height="6" fill="#fff"/>
        </g>
    </svg>`,
};

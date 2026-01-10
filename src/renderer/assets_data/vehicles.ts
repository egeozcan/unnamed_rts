import { SHARED_DEFS, TREADS_H } from './shared';

export const vehicles: Record<string, string> = {
    'harvester': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Chassis -->
            <rect x="10" y="15" width="80" height="70" rx="8" fill="COL_PRIMARY" stroke="#000" stroke-width="2"/>
            
            <!-- Treads -->
            <rect x="2" y="15" width="10" height="70" fill="url(#treadsPat)" stroke="#111"/>
            <rect x="88" y="15" width="10" height="70" fill="url(#treadsPat)" stroke="#111"/>
            
            <!-- Cargo Container -->
            <rect x="20" y="25" width="60" height="50" fill="#b8860b" stroke="#333" stroke-width="2"/>
            <rect x="20" y="25" width="60" height="50" fill="url(#caution)" opacity="0.1"/>
            
            <!-- Harvester Head/Mouth -->
            <path d="M20 75 L80 75 L70 95 L30 95 Z" fill="#222" stroke="#000"/>
            <rect x="35" y="80" width="30" height="15" fill="#111"/>
            
            <!-- Cab -->
            <rect x="35" y="5" width="30" height="15" rx="2" fill="#333"/>
            <rect x="38" y="8" width="24" height="8" fill="#acf"/>
        </g>
    </svg>`,

    'jeep': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Body -->
            <rect x="15" y="25" width="70" height="50" rx="5" fill="COL_PRIMARY" stroke="#111"/>
            
            <!-- Wheels -->
            <rect x="10" y="25" width="10" height="15" fill="#111" rx="2"/>
            <rect x="10" y="60" width="10" height="15" fill="#111" rx="2"/>
            <rect x="80" y="25" width="10" height="15" fill="#111" rx="2"/>
            <rect x="80" y="60" width="10" height="15" fill="#111" rx="2"/>
            
            <!-- Interior -->
            <rect x="50" y="30" width="30" height="40" fill="#222" rx="2"/>
            <rect x="55" y="35" width="20" height="10" fill="#444"/> <!-- Seat -->
            <rect x="55" y="55" width="20" height="10" fill="#444"/> <!-- Seat -->
        </g>
    </svg>`,

    'apc': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <rect x="10" y="15" width="80" height="70" rx="5" fill="COL_PRIMARY" stroke="#222" stroke-width="2"/>
            <rect x="10" y="15" width="80" height="70" fill="url(#metalGrad)" opacity="0.3" style="mix-blend-mode: overlay"/>
            
            <!-- Hatch -->
            <rect x="30" y="30" width="40" height="40" rx="2" fill="#333" stroke="#111"/>
            <line x1="50" y1="30" x2="50" y2="70" stroke="#111" stroke-width="2"/>
            
            <!-- Front Window -->
            <rect x="75" y="35" width="10" height="30" fill="#246"/>
        </g>
    </svg>`,

    'light': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Hull -->
            <rect x="15" y="20" width="70" height="60" rx="4" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
        </g>
    </svg>`,

    'heavy': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Heavy Armor Hull -->
            <rect x="10" y="15" width="80" height="70" rx="2" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="12" y="17" width="76" height="66" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-width="2"/>
            
            <!-- Vents -->
            <rect x="60" y="20" width="10" height="20" fill="#222"/>
            <rect x="60" y="60" width="10" height="20" fill="#222"/>
        </g>
    </svg>`,

    'flame_tank': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Armored Hull -->
            <rect x="15" y="20" width="70" height="60" rx="2" fill="COL_PRIMARY" stroke="#111"/>
            
            <!-- Flame Tanks -->
            <rect x="25" y="25" width="50" height="20" rx="10" fill="#b22" stroke="#500"/>
            <rect x="25" y="55" width="50" height="20" rx="10" fill="#b22" stroke="#500"/>
        </g>
    </svg>`,

    'stealth': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Stealth Shape -->
            <path d="M10 50 L40 10 L85 50 L40 90 Z" fill="#222" stroke="COL_PRIMARY" stroke-width="2"/>
            
            <!-- Cockpit -->
            <path d="M40 35 L60 50 L40 65" fill="#111" opacity="0.8"/>
            
            <!-- Engine Glow -->
            <path d="M15 45 L10 50 L15 55" fill="#f00" opacity="0.6">
                 <animate attributeName="opacity" values="0.4;0.8;0.4" dur="0.2s" repeatCount="indefinite" />
            </path>
        </g>
    </svg>`,

    'artillery': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Hull -->
            <rect x="15" y="20" width="60" height="60" rx="2" fill="COL_PRIMARY" stroke="#111"/>
        </g>
    </svg>`,

    'mlrs': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Hull -->
            <rect x="15" y="20" width="70" height="60" rx="2" fill="COL_PRIMARY" stroke="#111"/>
            
            <!-- Rocket Box -->
            <rect x="25" y="25" width="50" height="50" rx="2" fill="#eee" stroke="#222"/>
            
            <!-- Rocket Holes -->
            <circle cx="35" cy="35" r="5" fill="#222"/>
            <circle cx="65" cy="35" r="5" fill="#222"/>
            <circle cx="35" cy="65" r="5" fill="#222"/>
            <circle cx="65" cy="65" r="5" fill="#222"/>
            <circle cx="50" cy="50" r="5" fill="#222"/>
        </g>
    </svg>`,

    'mammoth': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Extra Wide Treads -->
            <rect x="2" y="5" width="96" height="25" fill="url(#treadsPat)" rx="4" stroke="#000"/>
            <rect x="2" y="70" width="96" height="25" fill="url(#treadsPat)" rx="4" stroke="#000"/>
            
            <!-- Massive Hull -->
            <rect x="15" y="20" width="70" height="60" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="15" y="20" width="70" height="60" fill="url(#metalGrad)" opacity="0.3" style="mix-blend-mode: multiply"/>
        </g>
    </svg>`,

    'mcv': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Cab -->
            <rect x="75" y="20" width="20" height="60" fill="COL_PRIMARY" stroke="#111"/>
            <rect x="80" y="25" width="10" height="50" fill="#acf"/> <!-- Windshield -->
            
            <!-- Packed Base -->
            <rect x="10" y="15" width="60" height="70" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <path d="M15 20 L65 20 L60 80 L20 80 Z" fill="url(#metalGrad)" opacity="0.5"/>
            
            <!-- Folded Crane -->
            <rect x="25" y="45" width="40" height="10" fill="#c44" stroke="#222"/>
            <circle cx="25" cy="50" r="5" fill="#444"/>
            
            <text x="40" y="80" font-family="Arial" font-weight="bold" font-size="20" fill="#fff" opacity="0.5">MCV</text>
        </g>
    </svg>`,

    'heli': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Shadow of Rotor (Static) -->
            <circle cx="50" cy="50" r="45" fill="#000" opacity="0.2"/>

            <!-- Body -->
            <ellipse cx="50" cy="50" rx="25" ry="15" fill="COL_PRIMARY" stroke="#000"/>
            <path d="M40 38 L60 38 L60 62 L40 62" fill="none" stroke="#222"/>

            <!-- Tail -->
            <rect x="10" y="48" width="20" height="4" fill="COL_PRIMARY" stroke="#000"/>

            <!-- Cockpit -->
            <path d="M65 42 Q75 50 65 58" fill="#acf" stroke="#345"/>

            <!-- Rotor Blades Animation -->
            <g>
                <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="0.1s" repeatCount="indefinite"/>
                <rect x="42" y="5" width="16" height="90" fill="#111" opacity="0.6"/>
                <rect x="5" y="42" width="90" height="16" fill="#111" opacity="0.6"/>
                <circle cx="50" cy="50" r="5" fill="#333"/>
            </g>
        </g>
    </svg>`,

    'harrier': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Shadow below aircraft (altitude indicator) -->
            <ellipse cx="50" cy="55" rx="30" ry="10" fill="#000" opacity="0.3"/>

            <!-- Delta Wing Shape - main body pointing right (facing direction) -->
            <path d="M85 50 L35 25 L20 50 L35 75 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>

            <!-- Fuselage center line -->
            <path d="M85 50 L20 50" fill="none" stroke="#333" stroke-width="3"/>

            <!-- Canopy/Cockpit -->
            <path d="M65 47 L75 50 L65 53 Q60 50 65 47" fill="#acf" stroke="#345"/>

            <!-- Wing detail lines -->
            <path d="M55 40 L40 32" fill="none" stroke="#222" stroke-width="1"/>
            <path d="M55 60 L40 68" fill="none" stroke="#222" stroke-width="1"/>

            <!-- Tail fins -->
            <path d="M25 42 L20 50 L25 58" fill="none" stroke="COL_PRIMARY" stroke-width="4"/>

            <!-- Afterburner/Engine glow -->
            <ellipse cx="15" cy="50" rx="5" ry="4" fill="#f80" opacity="0.8">
                <animate attributeName="opacity" values="0.6;1;0.6" dur="0.15s" repeatCount="indefinite"/>
            </ellipse>

            <!-- Missile hardpoint indicators -->
            <circle cx="45" cy="38" r="3" fill="#222"/>
            <circle cx="45" cy="62" r="3" fill="#222"/>
        </g>
    </svg>`,

    'induction_rig': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Base Platform -->
            <rect x="15" y="25" width="70" height="50" rx="4" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="15" y="25" width="70" height="50" fill="url(#metalGrad)" opacity="0.3" style="mix-blend-mode: overlay"/>

            <!-- Induction Core (top-heavy drilling apparatus) -->
            <rect x="35" y="8" width="30" height="40" rx="2" fill="#333" stroke="#111"/>

            <!-- Energy Coils -->
            <rect x="38" y="12" width="24" height="6" rx="1" fill="#4af" stroke="#28a"/>
            <rect x="38" y="22" width="24" height="6" rx="1" fill="#4af" stroke="#28a"/>
            <rect x="38" y="32" width="24" height="6" rx="1" fill="#4af" stroke="#28a"/>

            <!-- Drill Tip -->
            <path d="M50 48 L42 60 L58 60 Z" fill="#666" stroke="#333"/>
            <circle cx="50" cy="55" r="3" fill="#4af">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="0.5s" repeatCount="indefinite"/>
            </circle>

            <!-- Support Struts -->
            <path d="M35 25 L40 48" fill="none" stroke="#444" stroke-width="3"/>
            <path d="M65 25 L60 48" fill="none" stroke="#444" stroke-width="3"/>

            <!-- Warning Label -->
            <rect x="20" y="65" width="60" height="8" fill="url(#caution)" opacity="0.3"/>
        </g>
    </svg>`,
};

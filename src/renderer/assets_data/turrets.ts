
import { SHARED_DEFS } from './shared';

export const turrets: Record<string, string> = {
    'turret_turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Rotating Platform -->
            <circle cx="50" cy="50" r="24" fill="url(#metalGrad)" stroke="#111"/>
            <circle cx="50" cy="50" r="20" fill="COL_PRIMARY" opacity="0.8"/>
            
            <!-- Recoil Mechanism / Mantlet -->
            <rect x="40" y="30" width="20" height="20" rx="2" fill="#222" stroke="#000"/>
            
            <!-- Main Gun Housing -->
            <rect x="42" y="10" width="16" height="40" fill="#222" stroke="#000"/>
            <rect x="44" y="5" width="12" height="45" fill="#333"/>
            
            <!-- Barrel Detail -->
            <rect x="46" y="0" width="8" height="15" fill="#111"/> 
            <rect x="45" y="0" width="10" height="3" fill="#000"/> <!-- Muzzle Brake -->
            
            <!-- Vents/Bolts -->
            <circle cx="45" cy="40" r="1" fill="#555"/>
            <circle cx="55" cy="40" r="1" fill="#555"/>
        </g>
    </svg>`,

    'sam_site_turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Rotating Mount -->
            <rect x="30" y="35" width="40" height="40" rx="4" fill="COL_PRIMARY" stroke="#000"/>
            <rect x="35" y="40" width="30" height="30" fill="#222" opacity="0.5"/>
            
            <!-- Missile Pods (Angled) -->
            <path d="M20 45 L40 45 L40 75 L15 75 Z" fill="#eee" stroke="#222"/> <!-- Left Pod -->
            <path d="M60 45 L80 45 L85 75 L60 75 Z" fill="#eee" stroke="#222"/> <!-- Right Pod -->
            
            <!-- Missiles inside pods -->
            <circle cx="28" cy="50" r="3" fill="#fff" stroke="#000"/>
            <circle cx="28" cy="60" r="3" fill="#fff" stroke="#000"/>
            <circle cx="28" cy="70" r="3" fill="#fff" stroke="#000"/>
            
            <circle cx="72" cy="50" r="3" fill="#fff" stroke="#000"/>
            <circle cx="72" cy="60" r="3" fill="#fff" stroke="#000"/>
            <circle cx="72" cy="70" r="3" fill="#fff" stroke="#000"/>
            
            <!-- Radar Disk on Mount -->
            <ellipse cx="50" cy="55" rx="10" ry="4" fill="#33c" stroke="#111"/>
            
            <!-- Warning strip -->
            <rect x="35" y="70" width="30" height="4" fill="url(#caution)"/>
        </g>
    </svg>`,

    'pillbox_turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Concrete Dome -->
            <circle cx="50" cy="50" r="30" fill="url(#metalGrad)" stroke="#222" stroke-width="2"/>
            
            <!-- Firing Slits -->
            <rect x="30" y="46" width="40" height="8" fill="#000"/>
            <rect x="46" y="30" width="8" height="40" fill="#000"/>
            
            <!-- Top Hatch -->
            <circle cx="50" cy="50" r="10" fill="COL_PRIMARY"/>
            <circle cx="50" cy="50" r="8" fill="#222" opacity="0.3"/>
        </g>
    </svg>`,

    'light_turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Turret Base -->
            <circle cx="45" cy="50" r="20" fill="url(#metalGrad)" stroke="#111"/>
            <circle cx="45" cy="50" r="15" fill="COL_PRIMARY"/>
            
            <!-- Gun -->
            <rect x="45" y="46" width="40" height="8" fill="#111"/>
            
            <!-- Hatch -->
            <circle cx="45" cy="50" r="8" fill="#333" stroke="#111"/>
        </g>
    </svg>`,

    'heavy_turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
             <!-- Large Turret Block -->
            <rect x="25" y="25" width="40" height="50" rx="4" fill="url(#darkMetal)" stroke="#000"/>
            <rect x="28" y="28" width="34" height="44" fill="COL_PRIMARY" opacity="0.5"/>
            
            <!-- Gun -->
            <rect x="50" y="45" width="40" height="10" fill="#111"/>
            <rect x="50" y="43" width="10" height="14" fill="#444"/> <!-- Gun Base -->
        </g>
    </svg>`,

    'mammoth_turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Turret Block -->
            <rect x="35" y="30" width="40" height="40" rx="2" fill="#222" stroke="#000"/>
            
            <!-- Rocket Pods -->
            <rect x="65" y="35" width="15" height="10" fill="#eee"/>
            <rect x="65" y="55" width="15" height="10" fill="#eee"/>
            
            <!-- Twin Barrels -->
            <rect x="75" y="42" width="25" height="16" fill="#111"/>
            <rect x="75" y="45" width="30" height="4" fill="#000"/> <!-- Detail -->
            <rect x="75" y="51" width="30" height="4" fill="#000"/> <!-- Detail -->
        </g>
    </svg>`,

    'artillery_turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
             <!-- Turret Base -->
            <rect x="25" y="25" width="40" height="50" rx="2" fill="#333"/>
            
            <!-- Long Gun -->
            <rect x="40" y="44" width="55" height="12" fill="#111"/>
        </g>
    </svg>`,

    'flame_tank_turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Nozzle Mount -->
            <circle cx="65" cy="50" r="10" fill="#222"/>
            <rect x="65" y="45" width="20" height="10" fill="#111"/>
            <circle cx="85" cy="50" r="2" fill="#f90"/>
        </g>
    </svg>`,

    'jeep_turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Gun Mount -->
            <circle cx="30" cy="50" r="5" fill="#111"/>
            <rect x="25" y="48" width="20" height="4" fill="#333"/>
            <rect x="40" y="47" width="10" height="6" fill="#111"/> <!-- Muzzle -->
        </g>
    </svg>`,
};

import { SHARED_DEFS } from './shared';

export const buildings: Record<string, string> = {
    'conyard': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Custom Shaped Base -->
            <path d="M5 5 L95 5 L95 95 L65 95 L65 65 L35 65 L35 95 L5 95 Z" fill="#334" stroke="#223" stroke-width="2"/>
            
            <!-- Main Hub -->
            <rect x="20" y="20" width="60" height="40" fill="url(#metalGrad)" stroke="#112" stroke-width="2"/>
            <rect x="25" y="25" width="50" height="30" fill="COL_PRIMARY" opacity="0.65" style="mix-blend-mode: overlay"/>
            <rect x="25" y="50" width="50" height="5" fill="COL_PRIMARY"/>
            
            <!-- Massive Yellow Crane Base -->
            <circle cx="50" cy="40" r="15" fill="#333" stroke="#111" stroke-width="2"/>
            <circle cx="50" cy="40" r="10" fill="#fe0" stroke="#000" stroke-width="1"/>
            
            <!-- Long Crane Arm -->
            <path d="M50 35 L85 10 L90 15 L55 45 Z" fill="#fc0" stroke="#000" stroke-width="1"/>
            <path d="M85 15 L85 30" stroke="#000" stroke-width="2"/>
            <rect x="80" y="30" width="10" height="5" fill="#555"/>
            
            <!-- Secondary Structures -->
            <rect x="10" y="65" width="20" height="25" fill="#445" stroke="#112"/>
            <rect x="70" y="65" width="20" height="25" fill="#445" stroke="#112"/>
            
            <!-- Vents -->
            <circle cx="20" cy="77" r="5" fill="#111"/>
            <circle cx="80" cy="77" r="5" fill="#111"/>
        </g>
    </svg>`,

    'power': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Reduced Base -->
            <rect x="10" y="10" width="80" height="80" rx="40" fill="#333" stroke="#111" stroke-width="2"/>
            
            <!-- Player Color Strip Outer Ring -->
            <circle cx="50" cy="50" r="38" fill="none" stroke="COL_PRIMARY" stroke-width="3" opacity="0.7"/>
            
            <!-- Three Large Cooling Towers -->
            <circle cx="30" cy="30" r="15" fill="url(#metalGrad)" stroke="#222" stroke-width="2"/>
            <circle cx="30" cy="30" r="10" fill="#111"/>
            
            <circle cx="70" cy="30" r="15" fill="url(#metalGrad)" stroke="#222" stroke-width="2"/>
            <circle cx="70" cy="30" r="10" fill="#111"/>
            
            <circle cx="50" cy="70" r="15" fill="url(#metalGrad)" stroke="#222" stroke-width="2"/>
            <circle cx="50" cy="70" r="10" fill="#111"/>
            
            <!-- Central Glowing Energy Core -->
            <circle cx="50" cy="50" r="12" fill="#222" stroke="#444" stroke-width="2"/>
            <circle cx="50" cy="50" r="8" fill="url(#energyGrad)" opacity="0.9">
                 <animate attributeName="opacity" values="0.6;1;0.6" dur="1.5s" repeatCount="indefinite" />
            </circle>
            
            <!-- Lightning Connectors -->
            <path d="M50 50 L30 30 M50 50 L70 30 M50 50 L50 70" stroke="#0f0" stroke-width="2" stroke-dasharray="2,2">
                 <animate attributeName="stroke-dashoffset" values="4;0" dur="0.2s" repeatCount="indefinite" />
            </path>
        </g>
    </svg>`,

    'refinery': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Asymmetrical Base -->
            <path d="M5 10 L95 10 L95 90 L50 90 L50 40 L5 40 Z" fill="#444" stroke="#222" stroke-width="2"/>
            
            <!-- Twin Silos -->
            <circle cx="75" cy="35" r="15" fill="url(#darkMetal)" stroke="#000" stroke-width="2"/>
            <circle cx="75" cy="70" r="15" fill="url(#darkMetal)" stroke="#000" stroke-width="2"/>
            
            <!-- Player Color Rings on Silos -->
            <circle cx="75" cy="35" r="12" fill="none" stroke="COL_PRIMARY" stroke-width="2"/>
            <circle cx="75" cy="70" r="12" fill="none" stroke="COL_PRIMARY" stroke-width="2"/>
            
            <!-- Ore Windows -->
            <rect x="70" y="25" width="10" height="20" fill="url(#goldGrad)" opacity="0.7"/>
            <rect x="70" y="60" width="10" height="20" fill="url(#goldGrad)" opacity="0.7"/>
            
            <!-- Long Conveyor Belt -->
            <rect x="5" y="15" width="55" height="15" fill="#222" stroke="#111"/>
            <rect x="5" y="15" width="55" height="15" fill="none" stroke="#555" stroke-dasharray="2,2">
                <animate attributeName="stroke-dashoffset" values="4;0" dur="0.2s" repeatCount="indefinite" />
            </rect>
            
            <!-- Funnel / Dropping Point -->
            <path d="M10 10 L30 10 L25 35 L15 35 Z" fill="#333" stroke="#111"/>
            <circle cx="20" cy="22" r="5" fill="#111"/>
            
            <!-- Ground Pipes connecting Silos -->
            <path d="M85 35 L90 35 L90 70 L85 70" fill="none" stroke="#777" stroke-width="4"/>
        </g>
    </svg>`,

    'barracks': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Base divided into dirt and concrete -->
            <rect x="5" y="5" width="90" height="90" rx="4" fill="#654" stroke="#321"/>
            <rect x="5" y="50" width="90" height="45" fill="#444"/>
            
            <!-- Training Obstacle Course (Dirt Area) -->
            <rect x="15" y="15" width="20" height="5" fill="#321"/>
            <rect x="40" y="25" width="20" height="5" fill="#321"/>
            <rect x="65" y="15" width="20" height="5" fill="#321"/>
            <circle cx="50" cy="20" r="15" fill="none" stroke="#543" stroke-width="2" stroke-dasharray="4,4"/>
            
            <!-- Main Bunker Structure -->
            <rect x="10" y="55" width="80" height="35" rx="5" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="10" y="55" width="80" height="35" rx="5" fill="url(#metalGrad)" opacity="0.5" style="mix-blend-mode: multiply"/>
            
            <!-- Roof Military Star Logo -->
            <g transform="translate(50, 72) scale(0.6)">
                <polygon points="0,-15 4,-5 15,-5 6,2 9,12 0,6 -9,12 -6,2 -15,-5 -4,-5" fill="#fff" opacity="0.8"/>
            </g>
            
            <!-- Entrance -->
            <path d="M40 55 L60 55 L50 45 Z" fill="#222"/>
            
            <!-- Small Tents on sides -->
            <path d="M15 55 L30 55 L22 45 Z" fill="#454" stroke="#111"/>
            <path d="M70 55 L85 55 L77 45 Z" fill="#454" stroke="#111"/>
        </g>
    </svg>`,

    'factory': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Massive Output Base Pad with Tread Marks -->
            <rect x="5" y="5" width="90" height="90" fill="#333" stroke="#111" stroke-width="2"/>
            <path d="M40 40 L40 90 M60 40 L60 90" stroke="#1a1a1a" stroke-width="4" stroke-dasharray="2,2"/>
            <rect x="5" y="85" width="90" height="10" fill="url(#caution)"/>
            
            <!-- U-shaped main structure building -->
            <path d="M10 10 L90 10 L90 50 L70 50 L70 30 L30 30 L30 50 L10 50 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <path d="M10 10 L90 10 L90 50 L70 50 L70 30 L30 30 L30 50 L10 50 Z" fill="url(#metalGrad)" opacity="0.5" style="mix-blend-mode: multiply"/>
            
            <!-- Vents & Exhaust on U-shape arms -->
            <circle cx="20" cy="40" r="5" fill="#111"/>
            <circle cx="80" cy="40" r="5" fill="#111"/>
            <rect x="15" y="15" width="10" height="5" fill="#222"/>
            <rect x="75" y="15" width="10" height="5" fill="#222"/>
            
            <!-- Assembly Bay Garage Door -->
            <rect x="30" y="30" width="40" height="25" fill="#1a1a1a" stroke="#444" stroke-width="2"/>
            <line x1="30" y1="35" x2="70" y2="35" stroke="#333" stroke-width="1"/>
            <line x1="30" y1="40" x2="70" y2="40" stroke="#333" stroke-width="1"/>
            <line x1="30" y1="45" x2="70" y2="45" stroke="#333" stroke-width="1"/>
            <line x1="30" y1="50" x2="70" y2="50" stroke="#333" stroke-width="1"/>
            
            <!-- Giant Gear Insignia on Roof -->
            <circle cx="50" cy="20" r="8" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="4,2" opacity="0.8"/>
            <circle cx="50" cy="20" r="3" fill="#fff" opacity="0.8"/>
        </g>
    </svg>`,

    'tech': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Hexagonal Tech Base -->
            <polygon points="50,5 95,25 95,75 50,95 5,75 5,25" fill="#2a2a35" stroke="#4a4a5a" stroke-width="2"/>
            
            <!-- Outer Glow Rings -->
            <circle cx="50" cy="50" r="35" fill="none" stroke="COL_PRIMARY" stroke-width="1" opacity="0.5"/>
            <circle cx="50" cy="50" r="40" fill="none" stroke="COL_PRIMARY" stroke-width="3" opacity="0.3"/>
            
            <!-- Giant Glass Dome Over Center -->
            <circle cx="50" cy="50" r="30" fill="url(#glassGrad)" stroke="#fff" stroke-width="2"/>
            <circle cx="50" cy="50" r="30" fill="COL_PRIMARY" opacity="0.4"/>
            
            <!-- Radar Dish Inside Dome -->
            <ellipse cx="50" cy="50" rx="15" ry="5" fill="#222" stroke="#aaa" stroke-width="1">
                <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="4s" repeatCount="indefinite"/>
            </ellipse>
            <circle cx="50" cy="50" r="4" fill="#0ff">
                 <animate attributeName="opacity" values="0.4;1;0.4" dur="1s" repeatCount="indefinite" />
            </circle>
            
            <!-- Tech Nodes / Antennas on Hex Corners -->
            <circle cx="50" cy="15" r="3" fill="#0ff"/>
            <circle cx="80" cy="30" r="3" fill="#0ff"/>
            <circle cx="80" cy="70" r="3" fill="#0ff"/>
            <circle cx="50" cy="85" r="3" fill="#0ff"/>
            <circle cx="20" cy="70" r="3" fill="#0ff"/>
            <circle cx="20" cy="30" r="3" fill="#0ff"/>
            
            <!-- Connection Lines -->
            <path d="M50 15 L50 20 M80 30 L73 35 M80 70 L73 65 M50 85 L50 80 M20 70 L27 65 M20 30 L27 35" stroke="#0ff" stroke-width="1"/>
        </g>
    </svg>`,

    'airforce_command': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Full Runway Tarmac -->
            <rect x="5" y="5" width="90" height="90" fill="#2c2c2c" stroke="#111" stroke-width="2"/>
            
            <!-- Angled Runway Centerline -->
            <line x1="20" y1="80" x2="80" y2="20" stroke="#fff" stroke-width="2" stroke-dasharray="6,4"/>
            <line x1="10" y1="80" x2="20" y2="80" stroke="#fff" stroke-width="2"/>
            <line x1="80" y1="20" x2="90" y2="20" stroke="#fff" stroke-width="2"/>
            
            <!-- Jet Silhouette Parked -->
            <g transform="translate(60, 60) rotate(-45)">
                <path d="M-10,0 L10,0 L0,-20 Z" fill="#555" stroke="#222" stroke-width="1"/>
                <path d="M-15,5 L15,5 L0,-5 Z" fill="#555"/>
            </g>
            
            <!-- Command Tower -->
            <rect x="10" y="10" width="30" height="30" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="10" y="10" width="30" height="30" fill="url(#metalGrad)" opacity="0.4" style="mix-blend-mode: multiply"/>
            <circle cx="25" cy="25" r="12" fill="url(#glassGrad)" stroke="#111"/>
            
            <!-- Rotating Tower Radar -->
            <line x1="25" y1="15" x2="25" y2="35" stroke="#222" stroke-width="3">
                <animateTransform attributeName="transform" type="rotate" from="0 25 25" to="360 25 25" dur="3s" repeatCount="indefinite"/>
            </line>
            <circle cx="25" cy="25" r="3" fill="#f00">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="0.5s" repeatCount="indefinite"/>
            </circle>
            
            <!-- Helipad H mark -->
            <circle cx="75" cy="75" r="15" fill="none" stroke="#fd0" stroke-width="2"/>
            <path d="M70 70 L70 80 M80 70 L80 80 M70 75 L80 75" stroke="#fd0" stroke-width="2"/>
        </g>
    </svg>`,

    'service_depot': `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Giant Cross/H-pad Base -->
            <path d="M20 10 L40 10 L40 40 L80 40 L80 10 L100 10 L100 110 L80 110 L80 80 L40 80 L40 110 L20 110 Z" fill="#333" stroke="#111" stroke-width="2"/>
            
            <!-- Hazard Stripes on entry/exit -->
            <rect x="40" y="30" width="40" height="10" fill="url(#caution)"/>
            <rect x="40" y="80" width="40" height="10" fill="url(#caution)"/>
            
            <!-- Central Repair Pit -->
            <rect x="45" y="45" width="30" height="30" fill="#1a1a1a" stroke="#000" stroke-width="2"/>
            <rect x="45" y="45" width="30" height="30" fill="none" stroke="#0f0" stroke-width="1" opacity="0.5"/>
            
            <!-- Four Robotic Repair Arms pointing inwards -->
            <path d="M25 25 L40 40 L45 50" fill="none" stroke="COL_PRIMARY" stroke-width="3"/>
            <circle cx="25" cy="25" r="4" fill="#666"/>
            <circle cx="45" cy="50" r="2" fill="#0f0"/>
            
            <path d="M95 25 L80 40 L75 50" fill="none" stroke="COL_PRIMARY" stroke-width="3"/>
            <circle cx="95" cy="25" r="4" fill="#666"/>
            <circle cx="75" cy="50" r="2" fill="#0f0"/>
            
            <path d="M25 95 L40 80 L45 70" fill="none" stroke="COL_PRIMARY" stroke-width="3"/>
            <circle cx="25" cy="95" r="4" fill="#666"/>
            <circle cx="45" cy="70" r="2" fill="#0f0"/>
            
            <path d="M95 95 L80 80 L75 70" fill="none" stroke="COL_PRIMARY" stroke-width="3"/>
            <circle cx="95" cy="95" r="4" fill="#666"/>
            <circle cx="75" cy="70" r="2" fill="#0f0"/>
            
            <!-- Giant Hologram Repair Icon (Wrench) Floating Above -->
            <g transform="translate(60, 60)" opacity="0.8">
                <polygon points="-12,-8 -4,0 -4,12 -8,16 0,20 8,16 4,12 4,0 12,-8 8,-12 0,-4 -8,-12" fill="#0f0" opacity="0.4"/>
                <polygon points="-12,-8 -4,0 -4,12 -8,16 0,20 8,16 4,12 4,0 12,-8 8,-12 0,-4 -8,-12" fill="none" stroke="#0f0" stroke-width="1"/>
                <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="10s" repeatCount="indefinite"/>
            </g>
        </g>
    </svg>`,

    'induction_rig_deployed': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Oil Derrick / Rig Shape Base -->
            <path d="M20 80 L30 20 L70 20 L80 80 Z" fill="none" stroke="#333" stroke-width="4"/>
            <path d="M25 50 L75 50 M22 65 L78 65 M28 35 L72 35" stroke="#333" stroke-width="2"/>
            
            <!-- Ground Anchor Pads -->
            <rect x="10" y="80" width="20" height="10" rx="2" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="70" y="80" width="20" height="10" rx="2" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            
            <!-- Central Drill Shaft (Animated drilling down) -->
            <rect x="46" y="20" width="8" height="70" fill="#222"/>
            <rect x="44" y="20" width="12" height="10" fill="url(#metalGrad)">
                <animate attributeName="y" values="20;70;20" dur="1.5s" repeatCount="indefinite"/>
            </rect>
            
            <!-- Energy/Resource Glow from Ground -->
            <ellipse cx="50" cy="90" rx="15" ry="5" fill="#4af" opacity="0.8">
                 <animate attributeName="opacity" values="0.4;1;0.4" dur="0.8s" repeatCount="indefinite"/>
            </ellipse>
            <path d="M45 90 L55 90 L50 20 Z" fill="#4af" opacity="0.4"/>
            
            <!-- Top Transmitter Ring -->
            <circle cx="50" cy="15" r="10" fill="#222" stroke="COL_PRIMARY" stroke-width="2"/>
            <circle cx="50" cy="15" r="4" fill="#4af">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="0.4s" repeatCount="indefinite"/>
            </circle>
            
            <!-- Beam UP to orbit -->
            <line x1="50" y1="10" x2="50" y2="-10" stroke="#4af" stroke-width="3" stroke-dasharray="4,2">
                <animate attributeName="stroke-dashoffset" values="6;0" dur="0.3s" repeatCount="indefinite"/>
            </line>
        </g>
    </svg>`,
};

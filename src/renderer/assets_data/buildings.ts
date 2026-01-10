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

    'airforce_command': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Runway/Tarmac Base -->
            <rect x="2" y="2" width="96" height="96" rx="2" fill="#333" stroke="#111"/>

            <!-- Runway Markings -->
            <rect x="45" y="5" width="10" height="90" fill="#444"/>
            <line x1="50" y1="10" x2="50" y2="25" stroke="#fff" stroke-width="2" stroke-dasharray="4,4"/>
            <line x1="50" y1="75" x2="50" y2="90" stroke="#fff" stroke-width="2" stroke-dasharray="4,4"/>

            <!-- Control Tower -->
            <rect x="5" y="25" width="30" height="50" fill="COL_PRIMARY" stroke="#111"/>
            <rect x="5" y="25" width="30" height="50" fill="url(#metalGrad)" opacity="0.4"/>
            <rect x="8" y="30" width="24" height="20" fill="#acf" stroke="#345"/>
            <rect x="10" y="60" width="8" height="15" fill="#222"/>

            <!-- Hangar Structure -->
            <path d="M60 20 L60 80 L95 80 L95 20 Q78 10 60 20" fill="url(#darkMetal)" stroke="#111"/>
            <rect x="65" y="50" width="25" height="30" fill="#1a1a1a" stroke="#444"/>

            <!-- Landing Pad Indicators (6 slots in 2 rows of 3) -->
            <circle cx="20" cy="80" r="4" fill="#0f0" opacity="0.6"/>
            <circle cx="35" cy="80" r="4" fill="#0f0" opacity="0.6"/>
            <circle cx="50" cy="80" r="4" fill="#0f0" opacity="0.6"/>

            <!-- Radar Dish -->
            <ellipse cx="20" cy="25" rx="10" ry="5" fill="#555" stroke="#333"/>
            <line x1="20" y1="20" x2="20" y2="25" stroke="#888" stroke-width="2"/>
            <circle cx="20" cy="18" r="3" fill="#0f0" opacity="0.8">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="1s" repeatCount="indefinite"/>
            </circle>

            <!-- Player Color Band -->
            <rect x="2" y="2" width="96" height="5" fill="COL_PRIMARY"/>
        </g>
    </svg>`,

    'service_depot': `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Large Base Pad with Workshop Floor -->
            <rect x="2" y="2" width="116" height="116" rx="4" fill="#333" stroke="#111"/>

            <!-- Hazard Stripes on Edges -->
            <rect x="5" y="5" width="110" height="10" fill="url(#caution)"/>
            <rect x="5" y="105" width="110" height="10" fill="url(#caution)"/>

            <!-- Main Workshop Structure -->
            <rect x="10" y="25" width="100" height="80" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="10" y="25" width="100" height="80" fill="url(#metalGrad)" opacity="0.4" style="mix-blend-mode: multiply"/>

            <!-- Repair Bay Opening (Large Door) -->
            <rect x="25" y="40" width="70" height="65" fill="#1a1a1a" stroke="#444" stroke-width="2"/>
            <rect x="30" y="45" width="60" height="55" fill="#222"/>

            <!-- Hydraulic Lift Platform Inside -->
            <rect x="35" y="55" width="50" height="40" fill="#444" stroke="#333"/>
            <rect x="40" y="60" width="40" height="30" fill="#555"/>

            <!-- Crane/Arm Structure -->
            <path d="M95 30 L108 18 L112 22 L102 35 Z" fill="#666" stroke="#222" stroke-width="1"/>
            <circle cx="95" cy="30" r="6" fill="#444" stroke="#222" stroke-width="2"/>

            <!-- Tool Rack on Left -->
            <rect x="12" y="50" width="10" height="40" fill="#222"/>
            <line x1="17" y1="55" x2="17" y2="60" stroke="#888" stroke-width="2"/>
            <line x1="17" y1="65" x2="17" y2="70" stroke="#888" stroke-width="2"/>
            <line x1="17" y1="75" x2="17" y2="80" stroke="#888" stroke-width="2"/>

            <!-- Repair Icon (Wrench) at Top Border - Main Visual Indicator -->
            <g transform="translate(60, 17)">
                <circle r="12" fill="#0a0" stroke="#060" stroke-width="2">
                    <animate attributeName="fill" values="#0a0;#0f0;#0a0" dur="1.5s" repeatCount="indefinite"/>
                </circle>
                <path d="M-5,-7 L-3,-5 L-3,5 L-5,7 L5,7 L3,5 L3,-5 L5,-7 Z" fill="#fff" stroke="#060" stroke-width="1"/>
            </g>

            <!-- Status Lights -->
            <circle cx="15" cy="30" r="3" fill="#0f0" opacity="0.8"/>
            <circle cx="105" cy="30" r="3" fill="#0f0" opacity="0.8"/>

            <!-- Player Color Band at Bottom -->
            <rect x="2" y="112" width="116" height="6" fill="COL_PRIMARY"/>
        </g>
    </svg>`,

    'induction_rig_deployed': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Base Platform anchored to ground -->
            <rect x="15" y="70" width="70" height="25" rx="2" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="15" y="70" width="70" height="25" fill="url(#metalGrad)" opacity="0.3" style="mix-blend-mode: overlay"/>

            <!-- Anchor Legs -->
            <path d="M20 70 L10 95" stroke="#444" stroke-width="6"/>
            <path d="M80 70 L90 95" stroke="#444" stroke-width="6"/>
            <circle cx="10" cy="95" r="5" fill="#333"/>
            <circle cx="90" cy="95" r="5" fill="#333"/>

            <!-- Main Extraction Tower -->
            <rect x="35" y="15" width="30" height="55" rx="2" fill="#333" stroke="#111"/>

            <!-- Energy Coils (animated glow) -->
            <rect x="38" y="20" width="24" height="8" rx="2" fill="#4af" stroke="#28a">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="0.8s" repeatCount="indefinite"/>
            </rect>
            <rect x="38" y="32" width="24" height="8" rx="2" fill="#4af" stroke="#28a">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="0.8s" begin="0.2s" repeatCount="indefinite"/>
            </rect>
            <rect x="38" y="44" width="24" height="8" rx="2" fill="#4af" stroke="#28a">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="0.8s" begin="0.4s" repeatCount="indefinite"/>
            </rect>
            <rect x="38" y="56" width="24" height="8" rx="2" fill="#4af" stroke="#28a">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="0.8s" begin="0.6s" repeatCount="indefinite"/>
            </rect>

            <!-- Energy Beam from ground (traveling up animation) -->
            <line x1="50" y1="95" x2="50" y2="70" stroke="#4af" stroke-width="4" opacity="0.6">
                <animate attributeName="stroke-dashoffset" values="50;0" dur="0.5s" repeatCount="indefinite"/>
                <animate attributeName="stroke-dasharray" values="5,45;25,25;45,5" dur="0.5s" repeatCount="indefinite"/>
            </line>

            <!-- Top Transmitter -->
            <rect x="40" y="5" width="20" height="10" rx="2" fill="#222" stroke="#111"/>
            <circle cx="50" cy="10" r="4" fill="#4af">
                <animate attributeName="opacity" values="0.6;1;0.6" dur="0.3s" repeatCount="indefinite"/>
            </circle>

            <!-- Credit Beam shooting up (data transfer visualization) -->
            <line x1="50" y1="5" x2="50" y2="-20" stroke="#4af" stroke-width="2" opacity="0.8">
                <animate attributeName="y2" values="5;-30;5" dur="1s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.8;0.2;0.8" dur="1s" repeatCount="indefinite"/>
            </line>

            <!-- Player Color Band -->
            <rect x="15" y="70" width="70" height="4" fill="COL_PRIMARY"/>

            <!-- Warning/Status Light -->
            <circle cx="25" cy="80" r="3" fill="#0f0">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="1s" repeatCount="indefinite"/>
            </circle>
        </g>
    </svg>`,
};

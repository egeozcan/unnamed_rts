import { SHARED_DEFS, TREADS_H } from './shared';

export const vehicles: Record<string, string> = {
    'harvester': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Chassis -->
            <path d="M 15 20 L 85 20 L 85 80 L 15 80 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            
            <!-- Cab (Front right) -->
            <rect x="65" y="25" width="15" height="20" rx="3" fill="#333" stroke="#111" stroke-width="2"/>
            <rect x="67" y="27" width="10" height="15" rx="1" fill="url(#glassGrad)"/>
            
            <!-- Harvester Head/Maw (Front) -->
            <path d="M 85 25 L 98 25 L 98 75 L 85 75 Z" fill="#222" stroke="#111" stroke-width="2"/>
            <!-- Spinning blades indication -->
            <rect x="88" y="28" width="6" height="44" fill="#555"/>
            <rect x="85" y="32" width="12" height="4" fill="#888"/>
            <rect x="85" y="42" width="12" height="4" fill="#888"/>
            <rect x="85" y="52" width="12" height="4" fill="#888"/>
            <rect x="85" y="62" width="12" height="4" fill="#888"/>
            
            <!-- Cargo Tub (Back) -->
            <path d="M 20 25 L 60 25 L 60 75 L 20 75 Z" fill="#383838" stroke="#111" stroke-width="2"/>
            <path d="M 22 27 L 58 27 L 58 73 L 22 73 Z" fill="url(#caution)" opacity="0.3"/>
            <!-- Harvested material (gold/spice) -->
            <path d="M 25 35 Q 40 45 35 65 Q 45 70 55 55 Q 50 35 25 35" fill="url(#goldGrad)" opacity="0.9"/>
        </g>
    </svg>`,

    'jeep': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Tires -->
            <rect x="25" y="22" width="14" height="6" rx="2" fill="#111"/>
            <rect x="25" y="72" width="14" height="6" rx="2" fill="#111"/>
            <rect x="65" y="22" width="14" height="6" rx="2" fill="#111"/>
            <rect x="65" y="72" width="14" height="6" rx="2" fill="#111"/>
            
            <!-- Chassis -->
            <path d="M 20 30 L 80 30 Q 88 50 80 70 L 20 70 Q 15 50 20 30 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            
            <!-- Open Cab -->
            <path d="M 40 36 L 65 36 L 65 64 L 40 64 Z" fill="#2b2b2b" stroke="#111" stroke-width="2"/>
            <!-- Seats -->
            <rect x="44" y="40" width="8" height="18" rx="2" fill="#444"/>
            <rect x="56" y="40" width="8" height="18" rx="2" fill="#444"/> <!-- Driver -->
            <!-- Steering wheel -->
            <circle cx="62" cy="49" r="4" fill="none" stroke="#222" stroke-width="2"/>
            
            <!-- Front Hood -->
            <path d="M 70 38 L 82 42 L 82 58 L 70 62 Z" fill="url(#metalGrad)" opacity="0.5"/>

            <!-- Machine Gun Mount -->
            <circle cx="34" cy="50" r="7" fill="#333" stroke="#111" stroke-width="2"/>
            <path d="M 34 48 L 52 48 L 52 52 L 34 52 Z" fill="#1a1a1a"/> <!-- Barrel -->
            <rect x="42" y="46" width="6" height="8" fill="#111"/> <!-- Receiver -->
        </g>
    </svg>`,

    'apc': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Hull - sloped front -->
            <path d="M 12 25 L 75 25 L 88 40 L 88 60 L 75 75 L 12 75 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <path d="M 12 25 L 75 25 L 88 40 L 88 60 L 75 75 L 12 75 Z" fill="url(#metalGrad)" opacity="0.3" style="mix-blend-mode: overlay"/>
            
            <!-- Armor Plates -->
            <path d="M 20 30 L 45 30 L 45 70 L 20 70 Z" fill="url(#metalGrad)" opacity="0.4" stroke="#444"/>
            
            <!-- Troop Hatches -->
            <rect x="25" y="35" width="16" height="30" rx="2" fill="#333" stroke="#111" stroke-width="2"/>
            <line x1="33" y1="35" x2="33" y2="65" stroke="#111" stroke-width="2"/>
            
            <!-- Command Hatch & Small Turret -->
            <circle cx="55" cy="50" r="12" fill="#444" stroke="#111" stroke-width="2"/>
            <circle cx="55" cy="50" r="8" fill="#2b2b2b"/>
            <rect x="55" y="48" width="20" height="4" fill="#111"/> <!-- Light machine gun -->

            <!-- Front Driver Viewport -->
            <rect x="70" y="42" width="6" height="16" fill="url(#glassGrad)" stroke="#111"/>
        </g>
    </svg>`,

    'light': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Agile Hull -->
            <path d="M 20 28 L 65 25 L 80 40 L 80 60 L 65 75 L 20 72 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <path d="M 20 28 L 65 25 L 80 40 L 80 60 L 65 75 L 20 72 Z" fill="url(#metalGrad)" opacity="0.4"/>
            
            <!-- Engine Grill Back -->
            <rect x="25" y="38" width="10" height="24" fill="#222"/>
            <line x1="28" y1="38" x2="28" y2="62" stroke="#111"/>
            <line x1="32" y1="38" x2="32" y2="62" stroke="#111"/>

            <!-- Fast Attack Turret -->
            <circle cx="50" cy="50" r="14" fill="#444" stroke="#111" stroke-width="2"/>
            <circle cx="50" cy="50" r="8" fill="COL_PRIMARY"/>
            <!-- Cannon -->
            <rect x="50" y="47" width="35" height="6" fill="#2b2b2b" stroke="#111"/>
            <rect x="80" y="46" width="6" height="8" fill="#111"/> <!-- Muzzle brake -->
        </g>
    </svg>`,

    'heavy': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Blocky Heavy Hull -->
            <path d="M 12 20 L 75 20 L 88 35 L 88 65 L 75 80 L 12 80 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="18" y="26" width="55" height="48" fill="url(#metalGrad)" opacity="0.5" stroke="#444"/>
            
            <!-- Vents -->
            <rect x="22" y="32" width="12" height="36" rx="2" fill="#222"/>
            <rect x="24" y="34" width="8" height="32" fill="url(#darkMetal)"/>
            
            <!-- Heavy Turret -->
            <path d="M 40 35 L 65 38 L 65 62 L 40 65 Z" fill="#3a3a3a" stroke="#111" stroke-width="2"/>
            <circle cx="52" cy="50" r="16" fill="COL_PRIMARY" stroke="#222" stroke-width="2"/>
            
            <!-- Heavy Cannon -->
            <rect x="52" y="45" width="45" height="10" fill="#2a2a2a" stroke="#111" stroke-width="2"/>
            <rect x="65" y="44" width="15" height="12" fill="#1a1a1a"/> <!-- Bore Evacuator -->
            <!-- Twin support barrels / optics -->
            <rect x="60" y="56" width="15" height="3" fill="#111"/>
        </g>
    </svg>`,

    'flame_tank': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Armored Hull -->
            <path d="M 15 25 L 70 25 L 85 45 L 85 55 L 70 75 L 15 75 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            
            <!-- Flame Tanks (Prominent) -->
            <rect x="25" y="20" width="45" height="16" rx="8" fill="#d32f2f" stroke="#800000" stroke-width="2"/>
            <rect x="25" y="64" width="45" height="16" rx="8" fill="#d32f2f" stroke="#800000" stroke-width="2"/>
            <!-- Tank bands -->
            <rect x="35" y="20" width="4" height="16" fill="#111"/>
            <rect x="55" y="20" width="4" height="16" fill="#111"/>
            <rect x="35" y="64" width="4" height="16" fill="#111"/>
            <rect x="55" y="64" width="4" height="16" fill="#111"/>
            
            <!-- Turret -->
            <circle cx="50" cy="50" r="16" fill="#333" stroke="#111" stroke-width="2"/>
            <circle cx="50" cy="50" r="8" fill="COL_PRIMARY"/>
            
            <!-- Flame Projectors -->
            <path d="M 50 42 L 85 46 L 85 54 L 50 58 Z" fill="#2a2a2a" stroke="#111" stroke-width="2"/>
            <!-- Igniters -->
            <circle cx="85" cy="50" r="3" fill="#ff9900">
                <animate attributeName="opacity" values="0.7;1;0.7" dur="0.2s" repeatCount="indefinite"/>
            </circle>
        </g>
    </svg>`,

    'stealth': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Stealth Shape (Sleek angles) -->
            <path d="M 10 50 L 35 20 L 75 40 L 90 50 L 75 60 L 35 80 Z" fill="#1a1a24" stroke="COL_PRIMARY" stroke-width="2"/>
            <path d="M 35 20 L 50 50 L 35 80" fill="none" stroke="#2a2a35" stroke-width="2"/>
            <path d="M 75 40 L 50 50 L 75 60" fill="none" stroke="#2a2a35" stroke-width="2"/>
            
            <!-- Cockpit -->
            <path d="M 45 45 L 65 50 L 45 55 Z" fill="url(#glassGrad)" stroke="#111"/>
            
            <!-- Anti-grav / Engine Glow -->
            <ellipse cx="25" cy="35" rx="6" ry="12" fill="#ff3333" opacity="0.6" transform="rotate(-30 25 35)">
                 <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1s" repeatCount="indefinite" />
            </ellipse>
            <ellipse cx="25" cy="65" rx="6" ry="12" fill="#ff3333" opacity="0.6" transform="rotate(30 25 65)">
                 <animate attributeName="opacity" values="0.3;0.8;0.3" dur="1s" repeatCount="indefinite" />
            </ellipse>
            
            <!-- Main Thruster -->
            <path d="M 5 45 L 12 50 L 5 55 Z" fill="#ff5500" opacity="0.8">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="0.1s" repeatCount="indefinite" />
            </path>
        </g>
    </svg>`,

    'artillery': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Stabilizer Hull -->
            <path d="M 15 25 L 75 25 L 80 45 L 80 55 L 75 75 L 15 75 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            
            <!-- Deployable struts / anchors -->
            <rect x="10" y="20" width="8" height="10" rx="1" fill="#444" stroke="#111"/>
            <rect x="10" y="70" width="8" height="10" rx="1" fill="#444" stroke="#111"/>
            <rect x="70" y="20" width="8" height="10" rx="1" fill="#444" stroke="#111"/>
            <rect x="70" y="70" width="8" height="10" rx="1" fill="#444" stroke="#111"/>
            
            <!-- Massive Artillery Turret Base -->
            <rect x="25" y="35" width="30" height="30" rx="5" fill="#3a3a3a" stroke="#111" stroke-width="2"/>
            <circle cx="40" cy="50" r="10" fill="COL_PRIMARY"/>
            
            <!-- Long Range Gun -->
            <path d="M 40 46 L 95 46 L 95 54 L 40 54 Z" fill="#2a2a2a" stroke="#111" stroke-width="2"/>
            <rect x="65" y="44" width="12" height="12" fill="#1a1a1a"/> <!-- Recoil sleeve -->
            <rect x="90" y="45" width="5" height="10" fill="#111"/> <!-- Muzzle brake -->
        </g>
    </svg>`,

    'mlrs': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Hull -->
            <path d="M 15 25 L 70 25 L 85 40 L 85 60 L 70 75 L 15 75 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            
            <!-- Turret Base -->
            <circle cx="45" cy="50" r="22" fill="#3a3a3a" stroke="#111" stroke-width="2"/>
            
            <!-- Rocket Launch Box (Angled) -->
            <rect x="35" y="30" width="40" height="40" rx="3" fill="#e0e0e0" stroke="#333" stroke-width="2"/>
            
            <!-- Missile Tubes (3x3 grid) -->
            <circle cx="45" cy="40" r="4" fill="#111"/>
            <circle cx="55" cy="40" r="4" fill="#111"/>
            <circle cx="65" cy="40" r="4" fill="#111"/>
            
            <circle cx="45" cy="50" r="4" fill="#111"/>
            <circle cx="55" cy="50" r="4" fill="#111"/>
            <circle cx="65" cy="50" r="4" fill="#111"/>
            
            <circle cx="45" cy="60" r="4" fill="#111"/>
            <circle cx="55" cy="60" r="4" fill="#111"/>
            <circle cx="65" cy="60" r="4" fill="#111"/>
            
            <!-- Loaded Missiles (red tips) -->
            <circle cx="45" cy="40" r="2" fill="#d32f2f"/>
            <circle cx="65" cy="50" r="2" fill="#d32f2f"/>
            <circle cx="55" cy="60" r="2" fill="#d32f2f"/>
        </g>
    </svg>`,

    'mammoth': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- 4 Independent Quad Treads -->
            <rect x="5" y="5" width="40" height="22" fill="url(#treadsPat)" rx="3" stroke="#000" stroke-width="2"/>
            <rect x="55" y="5" width="40" height="22" fill="url(#treadsPat)" rx="3" stroke="#000" stroke-width="2"/>
            <rect x="5" y="73" width="40" height="22" fill="url(#treadsPat)" rx="3" stroke="#000" stroke-width="2"/>
            <rect x="55" y="73" width="40" height="22" fill="url(#treadsPat)" rx="3" stroke="#000" stroke-width="2"/>
            
            <!-- Massive Hull Center -->
            <path d="M 15 20 L 85 20 L 95 35 L 95 65 L 85 80 L 15 80 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="3"/>
            <path d="M 20 25 L 80 25 L 88 38 L 88 62 L 80 75 L 20 75 Z" fill="url(#metalGrad)" opacity="0.6"/>
            
            <!-- Super Heavy Turret -->
            <path d="M 35 30 L 75 35 L 75 65 L 35 70 Z" fill="#333" stroke="#111" stroke-width="2"/>
            <circle cx="55" cy="50" r="15" fill="COL_PRIMARY" stroke="#222" stroke-width="2"/>
            
            <!-- Twin Main Cannons -->
            <rect x="55" y="38" width="45" height="8" fill="#2a2a2a" stroke="#111"/>
            <rect x="55" y="54" width="45" height="8" fill="#2a2a2a" stroke="#111"/>
            <rect x="75" y="37" width="10" height="10" fill="#111"/> <!-- Evacuators -->
            <rect x="75" y="53" width="10" height="10" fill="#111"/>
            
            <!-- Mammoth Tusk Missiles -->
            <rect x="40" y="25" width="20" height="12" rx="2" fill="#555" stroke="#111"/>
            <rect x="40" y="63" width="20" height="12" rx="2" fill="#555" stroke="#111"/>
            <!-- Missile tips -->
            <circle cx="56" cy="28" r="2" fill="#d00"/>
            <circle cx="56" cy="34" r="2" fill="#d00"/>
            <circle cx="56" cy="66" r="2" fill="#d00"/>
            <circle cx="56" cy="72" r="2" fill="#d00"/>
        </g>
    </svg>`,

    'mcv': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Huge Rig Cab -->
            <rect x="75" y="25" width="20" height="50" rx="3" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <path d="M 80 30 L 92 35 L 92 65 L 80 70 Z" fill="url(#glassGrad)" stroke="#111"/> <!-- Wide windshield -->
            
            <!-- Packed Base Hull (Trailer) -->
            <rect x="10" y="20" width="60" height="60" rx="4" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="14" y="24" width="52" height="52" fill="url(#metalGrad)" stroke="#444"/>
            
            <!-- Folded Construction Crane -->
            <path d="M 20 40 L 60 40 L 60 60 L 20 60 Z" fill="#d32f2f" stroke="#111" stroke-width="2"/>
            <line x1="20" y1="40" x2="60" y2="60" stroke="#111" stroke-width="4"/>
            <line x1="20" y1="60" x2="60" y2="40" stroke="#111" stroke-width="4"/>
            
            <!-- Radar Dish (Folded) -->
            <ellipse cx="30" cy="50" rx="15" ry="5" fill="#e0e0e0" stroke="#333" stroke-width="2"/>
            <circle cx="30" cy="50" r="3" fill="#ff9900"/>
            
            <text x="35" y="85" font-family="Arial, sans-serif" font-weight="900" font-size="22" fill="#fff" opacity="0.6" style="letter-spacing: 2px;">MCV</text>
        </g>
    </svg>`,

    'heli': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Shadow of Rotor (Static) -->
            <circle cx="50" cy="50" r="48" fill="#000" opacity="0.15"/>

            <!-- Fuselage -->
            <path d="M 35 40 L 65 40 Q 80 50 65 60 L 35 60 Q 30 50 35 40 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            
            <!-- Tail Boom -->
            <path d="M 10 48 L 40 46 L 40 54 L 10 52 Z" fill="#3a3a3a" stroke="#111"/>
            <!-- Tail Rotor -->
            <circle cx="10" cy="50" r="8" fill="none" stroke="#222" stroke-width="2"/>
            <line x1="2" y1="50" x2="18" y2="50" stroke="#111" stroke-width="3">
                <animateTransform attributeName="transform" type="rotate" from="0 10 50" to="360 10 50" dur="0.1s" repeatCount="indefinite"/>
            </line>

            <!-- Cockpit Canopy -->
            <path d="M 55 42 L 72 45 Q 76 50 72 55 L 55 58 Z" fill="url(#glassGrad)" stroke="#111"/>

            <!-- Weapon Pods -->
            <rect x="45" y="32" width="12" height="6" rx="2" fill="#555" stroke="#111"/>
            <rect x="45" y="62" width="12" height="6" rx="2" fill="#555" stroke="#111"/>
            <circle cx="57" cy="35" r="2" fill="#d00"/>
            <circle cx="57" cy="65" r="2" fill="#d00"/>

            <!-- Main Rotor Animation -->
            <g>
                <animateTransform attributeName="transform" type="rotate" from="0 50 50" to="360 50 50" dur="0.05s" repeatCount="indefinite"/>
                <path d="M 46 2 L 54 2 L 54 98 L 46 98 Z" fill="#1a1a1a" opacity="0.7"/>
                <path d="M 2 46 L 98 46 L 98 54 L 2 54 Z" fill="#1a1a1a" opacity="0.7"/>
                <circle cx="50" cy="50" r="6" fill="#444" stroke="#111"/>
            </g>
        </g>
    </svg>`,

    'harrier': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Altitude Shadow -->
            <path d="M 15 65 L 45 40 L 90 65 L 45 90 Z" fill="#000" opacity="0.2"/>

            <!-- Delta VTOL Wing -->
            <path d="M 15 50 L 45 20 L 60 20 L 45 50 L 60 80 L 45 80 Z" fill="#3a3a3a" stroke="#111" stroke-width="2"/>
            
            <!-- Fuselage -->
            <path d="M 10 46 L 60 46 L 90 50 L 60 54 L 10 54 Z" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>

            <!-- VTOL Engine Vents -->
            <circle cx="45" cy="35" r="5" fill="#222"/>
            <circle cx="45" cy="65" r="5" fill="#222"/>
            <ellipse cx="30" cy="50" rx="8" ry="4" fill="#222"/>

            <!-- Cockpit -->
            <path d="M 65 48 L 80 49 Q 84 50 80 51 L 65 52 Z" fill="url(#glassGrad)" stroke="#111"/>

            <!-- Tail fins -->
            <path d="M 15 46 L 10 35 L 25 46 Z" fill="COL_PRIMARY" stroke="#111"/>
            <path d="M 15 54 L 10 65 L 25 54 Z" fill="COL_PRIMARY" stroke="#111"/>

            <!-- Afterburner Thrust -->
            <polygon points="10,48 5,50 10,52" fill="#0ff" opacity="0.8">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="0.1s" repeatCount="indefinite"/>
                <animate attributeName="points" values="10,48 5,50 10,52; 10,48 0,50 10,52" dur="0.1s" repeatCount="indefinite"/>
            </polygon>
            
            <!-- Wing payload -->
            <path d="M 50 30 L 60 30 L 58 32 L 50 32 Z" fill="#e0e0e0"/>
            <path d="M 50 70 L 60 70 L 58 68 L 50 68 Z" fill="#e0e0e0"/>
        </g>
    </svg>`,

    'induction_rig': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}
            <!-- Base Platform -->
            <rect x="15" y="25" width="70" height="50" rx="4" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>
            <rect x="20" y="30" width="60" height="40" fill="url(#metalGrad)" stroke="#444"/>

            <!-- Induction Drill / Core Mount -->
            <polygon points="30,10 70,10 60,30 40,30" fill="#3a3a3a" stroke="#111" stroke-width="2"/>
            
            <!-- Plasma Coils -->
            <rect x="40" y="8" width="20" height="4" rx="1" fill="#44aaff" stroke="#115588"/>
            <rect x="38" y="14" width="24" height="4" rx="1" fill="#44aaff" stroke="#115588"/>
            <rect x="36" y="20" width="28" height="4" rx="1" fill="#44aaff" stroke="#115588"/>
            <rect x="34" y="26" width="32" height="4" rx="1" fill="#44aaff" stroke="#115588"/>

            <!-- Drill Head / Emitter -->
            <path d="M 50 0 L 45 8 L 55 8 Z" fill="#00ffff" opacity="0.8">
                <animate attributeName="opacity" values="0.5;1;0.5" dur="0.5s" repeatCount="indefinite"/>
            </path>
            
            <!-- Power Conduits -->
            <path d="M 25 50 Q 50 40 75 50" fill="none" stroke="#44aaff" stroke-width="2" opacity="0.6"/>
            <path d="M 35 60 Q 50 50 65 60" fill="none" stroke="#44aaff" stroke-width="2" opacity="0.6"/>

            <!-- Warning Decals -->
            <rect x="25" y="65" width="50" height="5" fill="url(#caution)" opacity="0.5"/>
            <!-- Back Engine -->
            <rect x="20" y="40" width="10" height="20" rx="2" fill="#222" stroke="#111"/>
        </g>
    </svg>`,

    'demo_truck': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            ${TREADS_H}

            <!-- Truck Base Cab -->
            <rect x="15" y="25" width="70" height="50" rx="4" fill="COL_PRIMARY" stroke="#111" stroke-width="2"/>

            <!-- Bomb/Nuke Payload Area (Cargo Bed) -->
            <rect x="20" y="30" width="50" height="40" rx="2" fill="#2b2b2b" stroke="#111" stroke-width="2"/>
            
            <!-- Radioactive / Explosive Caution pattern -->
            <rect x="20" y="30" width="50" height="40" rx="2" fill="url(#caution)" opacity="0.4"/>

            <!-- Large Nuke / Bomb Cylinder -->
            <rect x="25" y="35" width="40" height="30" rx="10" fill="#aaaaaa" stroke="#333" stroke-width="2"/>
            <!-- Bomb straps -->
            <rect x="32" y="35" width="4" height="30" fill="#111"/>
            <rect x="54" y="35" width="4" height="30" fill="#111"/>
            
            <!-- Radiation/Biohazard Symbol Approximation -->
            <circle cx="45" cy="50" r="8" fill="#ffcc00" stroke="#111"/>
            <path d="M 45 50 L 45 44 M 45 50 L 40 53 M 45 50 L 50 53" stroke="#111" stroke-width="3"/>
            <circle cx="45" cy="50" r="2" fill="#111"/>

            <!-- Detonator Core (Blinking) -->
            <circle cx="75" cy="50" r="6" fill="#222" stroke="#111"/>
            <circle cx="75" cy="50" r="3" fill="#ff0000">
                <animate attributeName="fill" values="#ff0000;#550000;#ff0000" dur="0.4s" repeatCount="indefinite"/>
            </circle>

            <!-- Front Cab Window -->
            <rect x="80" y="35" width="5" height="30" rx="1" fill="url(#glassGrad)" stroke="#111"/>
        </g>
    </svg>`,
};

import { SHARED_DEFS } from './shared';

export const defenses: Record<string, string> = {
    'turret': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Concrete Base -->
            <rect x="25" y="25" width="50" height="50" fill="#444" stroke="#222" stroke-width="2"/>
            <rect x="30" y="30" width="40" height="40" fill="#333"/>
        </g>
    </svg>`,

    'sam_site': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Hex Pattern Base -->
            <polygon points="50,95 90,75 90,35 50,15 10,35 10,75" fill="#333" stroke="#111" stroke-width="2"/>
        </g>
    </svg>`,

    'pillbox': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Sandbags/Base -->
            <circle cx="50" cy="50" r="45" fill="#554433" stroke="#332211"/>
            <circle cx="50" cy="50" r="40" fill="#665544"/>
        </g>
    </svg>`,

    'obelisk': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Base -->
            <rect x="20" y="80" width="60" height="15" fill="#111" stroke="#f00" stroke-width="2"/>
            
            <!-- Tower -->
            <path d="M25 80 L75 80 L55 10 L45 10 Z" fill="#000" stroke="COL_PRIMARY" stroke-width="2"/>
            
            <!-- Energy Core -->
            <path d="M35 70 L65 70 L50 20 Z" fill="#f00" opacity="0.6">
                 <animate attributeName="opacity" values="0.4;0.9;0.4" dur="3s" repeatCount="indefinite" />
            </path>
            
            <!-- Crystal Tip -->
            <circle cx="50" cy="10" r="8" fill="#f00" stroke="#fff" stroke-width="2"/>
            <circle cx="50" cy="10" r="5" fill="#fff" opacity="0.8">
                 <animate attributeName="opacity" values="0.5;1;0.5" dur="0.5s" repeatCount="indefinite" />
            </circle>
        </g>
    </svg>`,
};

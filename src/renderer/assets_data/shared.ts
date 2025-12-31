
export const SHARED_DEFS = `
    <defs>
        <linearGradient id="metalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#cfcfd6;stop-opacity:1" />
            <stop offset="40%" style="stop-color:#889;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#445;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="darkMetal" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#555;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#222;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="glassGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#acd;stop-opacity:0.9" />
            <stop offset="50%" style="stop-color:#58a;stop-opacity:0.8" />
            <stop offset="100%" style="stop-color:#246;stop-opacity:0.9" />
        </linearGradient>
        <linearGradient id="energyGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style="stop-color:#4f4;stop-opacity:1" />
            <stop offset="50%" style="stop-color:#0f0;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#080;stop-opacity:1" />
        </linearGradient>
        <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style="stop-color:#ffd700;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#b8860b;stop-opacity:1" />
        </linearGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceAlpha" stdDeviation="2"/>
            <feOffset dx="2" dy="2" result="offsetblur"/>
            <feComponentTransfer>
                <feFuncA type="linear" slope="0.5"/>
            </feComponentTransfer>
            <feMerge>
                <feMergeNode/>
                <feMergeNode in="SourceGraphic"/>
            </feMerge>
        </filter>
        <pattern id="treadsPat" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
            <rect width="8" height="8" fill="#1a1a1a"/>
            <rect y="2" width="8" height="2" fill="#333"/>
        </pattern>
         <pattern id="caution" x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="10" fill="#fd0"/>
            <rect x="5" width="5" height="10" fill="#222"/>
        </pattern>
    </defs>
`;

export const TREADS_H = `
    <rect x="2" y="4" width="96" height="20" fill="url(#treadsPat)" rx="2" stroke="#000" stroke-width="1"/>
    <rect x="2" y="76" width="96" height="20" fill="url(#treadsPat)" rx="2" stroke="#000" stroke-width="1"/>
`;

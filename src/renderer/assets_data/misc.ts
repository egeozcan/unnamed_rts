import { SHARED_DEFS } from './shared';

export const misc: Record<string, string> = {
    'ore': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
        ${SHARED_DEFS}
        <g filter="url(#shadow)">
            <!-- Gold Nuggets -->
            <circle cx="50" cy="50" r="35" fill="url(#goldGrad)" stroke="#b8860b"/>
            
            <circle cx="30" cy="40" r="15" fill="url(#goldGrad)" stroke="#b8860b"/>
            <circle cx="70" cy="60" r="12" fill="url(#goldGrad)" stroke="#b8860b"/>
            <circle cx="70" cy="30" r="10" fill="url(#goldGrad)" stroke="#b8860b"/>
            
            <!-- Sparkles -->
            <path d="M40 30 L42 35 L40 40 L38 35 Z" fill="#fff" opacity="0.8">
                 <animate attributeName="opacity" values="0;1;0" dur="2s" repeatCount="indefinite" />
            </path>
            <path d="M60 60 L62 65 L60 70 L58 65 Z" fill="#fff" opacity="0.8">
                 <animate attributeName="opacity" values="0;1;0" dur="2.5s" repeatCount="indefinite" />
            </path>
        </g>
    </svg>`,
};

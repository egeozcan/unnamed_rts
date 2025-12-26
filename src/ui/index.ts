import rules from '../data/rules.json';
import { GameState, Entity } from '../engine/types.js';

const RULES = rules as any;

let gameState: GameState | null = null;
let onBuildClick: ((category: string, key: string) => void) | null = null;
let onToggleSellMode: (() => void) | null = null;


export function initUI(state: GameState, buildBy: (category: string, key: string) => void, toggleSell: () => void) {
    gameState = state;
    onBuildClick = buildBy;
    onToggleSellMode = toggleSell;
    setupTabs();
    setupButtons();

    const sellBtn = document.getElementById('sell-btn');
    if (sellBtn) {
        sellBtn.onclick = () => {
            if (onToggleSellMode) onToggleSellMode();
        };
    }
}

function setupTabs() {
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = (tab as HTMLElement).dataset.tab;
            setTab(tabName || 'buildings');
        });
    });
}

export function setTab(tab: string) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.btn-grid').forEach(g => g.classList.remove('active'));

    const tabIndex = ['buildings', 'infantry', 'vehicles'].indexOf(tab);
    if (tabIndex >= 0) {
        document.querySelectorAll('.tab')[tabIndex]?.classList.add('active');
    }
    document.getElementById('tab-' + tab)?.classList.add('active');
}

function setupButtons() {
    const bb = document.getElementById('tab-buildings')!;
    const bi = document.getElementById('tab-infantry')!;
    const bv = document.getElementById('tab-vehicles')!;

    bb.innerHTML = '';
    bi.innerHTML = '';
    bv.innerHTML = '';

    for (const k in RULES.buildings) {
        const data = RULES.buildings[k];
        // Check hidden using 'in' operator to avoid type issues
        if (!('hidden' in data && data.hidden)) {
            createBtn(bb, k, data.name, data.cost, 'building');
        }
    }

    for (const k in RULES.units) {
        const u = RULES.units[k];
        if (u.type === 'infantry') {
            createBtn(bi, k, u.name, u.cost, 'infantry');
        } else {
            createBtn(bv, k, u.name, u.cost, 'vehicle');
        }
    }
}

function createBtn(parent: HTMLElement, key: string, name: string, cost: number, category: string) {
    const btn = document.createElement('div');
    btn.className = 'build-btn';
    btn.id = 'btn-' + key;
    btn.innerHTML = `
        <div class="progress-overlay"></div>
        <div class="btn-name">${name}</div>
        <div class="btn-cost">$${cost}</div>
        <div class="btn-status"></div>
    `;
    btn.onclick = () => {
        if (gameState?.mode === 'demo') return;
        if (btn.classList.contains('disabled')) return;
        if (onBuildClick) {
            onBuildClick(category, key);
        }
    };
    parent.appendChild(btn);
}

export function hasBuilding(key: string, owner: number, entities: Entity[]): boolean {
    return entities.some(e => e.owner === owner && e.key === key && !e.dead);
}

export function updateButtons(
    entities: Entity[],
    queues: Record<string, { current: string | null; progress: number }>,
    readyToPlace: string | null,
    placingBuilding: string | null
) {
    const owner = 0;

    // Update prerequisites
    const check = (list: string[], isBuilding: boolean) => {
        for (const k of list) {
            const el = document.getElementById('btn-' + k);
            if (!el) continue;

            const data = isBuilding
                ? RULES.buildings[k]
                : RULES.units[k];

            let met = true;
            if (data?.req) {
                for (const r of data.req) {
                    if (!hasBuilding(r, owner, entities)) met = false;
                }
            }

            if (met) {
                el.classList.remove('disabled');
            } else {
                el.classList.add('disabled');
            }
        }
    };

    check(Object.keys(RULES.buildings), true);
    check(Object.keys(RULES.units), false);

    // Update production states
    const categories = ['building', 'infantry', 'vehicle'] as const;

    for (const cat of categories) {
        const q = queues[cat];
        const containerId = cat === 'building' ? 'tab-buildings' :
            cat === 'infantry' ? 'tab-infantry' : 'tab-vehicles';
        const container = document.getElementById(containerId);
        if (!container) continue;

        // Reset all buttons in this category
        Array.from(container.children).forEach(btn => {
            btn.classList.remove('building', 'ready', 'placing');
            const overlay = btn.querySelector('.progress-overlay') as HTMLElement;
            const status = btn.querySelector('.btn-status') as HTMLElement;
            if (overlay) overlay.style.width = '0%';
            if (status) status.innerText = '';
        });

        // Mark currently building
        if (q?.current) {
            const btn = document.getElementById('btn-' + q.current);
            if (btn) {
                btn.classList.add('building');
                const overlay = btn.querySelector('.progress-overlay') as HTMLElement;
                const status = btn.querySelector('.btn-status') as HTMLElement;
                if (overlay) overlay.style.width = q.progress + '%';
                if (status) status.innerText = 'BUILDING';
            }
        }

        // Mark ready to place
        if (cat === 'building' && readyToPlace) {
            const btn = document.getElementById('btn-' + readyToPlace);
            if (btn) {
                btn.classList.add('ready');
                const overlay = btn.querySelector('.progress-overlay') as HTMLElement;
                const status = btn.querySelector('.btn-status') as HTMLElement;
                if (overlay) overlay.style.width = '100%';
                if (status) status.innerText = 'READY';

                if (placingBuilding === readyToPlace) {
                    btn.classList.add('placing');
                    btn.classList.remove('ready');
                    if (status) status.innerText = 'PLACING';
                }
            }
        }
    }
}

export function updateSellModeUI(state: GameState) {
    gameState = state;
    const btn = document.getElementById('sell-btn');
    const canvas = document.getElementById('gameCanvas');

    if (btn) {
        if (state.sellMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }

    if (canvas) {
        if (state.sellMode) {
            canvas.classList.add('sell-mode');
        } else {
            canvas.classList.remove('sell-mode');
        }
    }
}

export function updateMoney(amount: number) {
    const el = document.getElementById('money-display');
    if (el) el.innerText = `$ ${Math.floor(amount)}`;
}

export function updatePower(out: number, inPower: number) {
    const el = document.getElementById('power-display');
    if (el) {
        el.innerText = `Power: ${out} / ${inPower}`;
        if (out < inPower) {
            el.classList.add('low-power');
            document.getElementById('low-power-warning')?.classList.add('visible');
        } else {
            el.classList.remove('low-power');
            document.getElementById('low-power-warning')?.classList.remove('visible');
        }
    }
}

export function setStatusMessage(msg: string) {
    const el = document.getElementById('status-msg');
    if (el) el.innerText = msg;
}

export function showMenu() {
    const menu = document.getElementById('menu');
    if (menu) menu.style.display = 'flex';
}

export function hideMenu() {
    const menu = document.getElementById('menu');
    if (menu) menu.style.display = 'none';
}

export function showEndScreen(message: string, isVictory: boolean) {
    const endScreen = document.getElementById('end-screen');
    const title = document.getElementById('end-title');
    if (endScreen && title) {
        title.innerText = message;
        title.style.color = isVictory ? '#0f0' : '#f00';
        endScreen.classList.add('visible');
    }
}

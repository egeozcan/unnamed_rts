import { RULES } from '../data/schemas/index.js';
import { GameState, Entity, EntityId, Vector, AttackStance, UnitEntity } from '../engine/types.js';
import { getAIState, AIPlayerState, AIStrategy, InvestmentPriority } from '../engine/ai/index.js';
import { canBuild } from '../engine/reducer.js';
import { isUnit, isHarvester, isEngineer, isInductionRig, isWell, isResource, isBuilding, isEnemyOf, isPlayerEntity } from '../engine/type-guards.js';

let gameState: GameState | null = null;
let onBuildClick: ((category: string, key: string, count: number) => void) | null = null;
let onCancelBuild: ((category: string) => void) | null = null;
let onDequeueUnit: ((category: string, key: string, count: number) => void) | null = null;
let onToggleSellMode: (() => void) | null = null;
let onToggleRepairMode: (() => void) | null = null;
let onSetStance: ((stance: AttackStance) => void) | null = null;
let onToggleAttackMove: (() => void) | null = null;


export function initUI(
    state: GameState,
    buildBy: (category: string, key: string, count: number) => void,
    toggleSell: () => void,
    toggleRepair?: () => void,
    cancelBuild?: (category: string) => void,
    dequeueUnit?: (category: string, key: string, count: number) => void
) {
    gameState = state;
    onBuildClick = buildBy;
    onCancelBuild = cancelBuild || null;
    onDequeueUnit = dequeueUnit || null;
    onToggleSellMode = toggleSell;
    onToggleRepairMode = toggleRepair || null;
    setupTabs();
    setupButtons();

    const sellBtn = document.getElementById('sell-btn');
    if (sellBtn) {
        sellBtn.onclick = () => {
            if (onToggleSellMode) onToggleSellMode();
        };
    }

    const repairBtn = document.getElementById('repair-btn');
    if (repairBtn) {
        repairBtn.onclick = () => {
            if (onToggleRepairMode) onToggleRepairMode();
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

    const tabIndex = ['buildings', 'defense', 'infantry', 'vehicles', 'air'].indexOf(tab);
    if (tabIndex >= 0) {
        document.querySelectorAll('.tab')[tabIndex]?.classList.add('active');
    }
    document.getElementById('tab-' + tab)?.classList.add('active');
}

function setupButtons() {
    const bb = document.getElementById('tab-buildings')!;
    const bd = document.getElementById('tab-defense')!;
    const bi = document.getElementById('tab-infantry')!;
    const bv = document.getElementById('tab-vehicles')!;
    const ba = document.getElementById('tab-air')!;

    bb.innerHTML = '';
    bd.innerHTML = '';
    bi.innerHTML = '';
    bv.innerHTML = '';
    ba.innerHTML = '';

    for (const k in RULES.buildings) {
        const data = RULES.buildings[k];
        // Check hidden using 'in' operator to avoid type issues
        if (!('hidden' in data && data.hidden)) {
            if (data.isDefense) {
                createBtn(bd, k, data.name, data.cost, 'building');
            } else {
                createBtn(bb, k, data.name, data.cost, 'building');
            }
        }
    }

    for (const k in RULES.units) {
        const u = RULES.units[k];
        if (u.type === 'infantry') {
            createBtn(bi, k, u.name, u.cost, 'infantry');
        } else if (u.type === 'air') {
            createBtn(ba, k, u.name, u.cost, 'air');
        } else {
            createBtn(bv, k, u.name, u.cost, 'vehicle');
        }
    }
}

// Global tooltip element
let globalTooltip: HTMLElement | null = null;

function getGlobalTooltip(): HTMLElement {
    if (!globalTooltip) {
        globalTooltip = document.createElement('div');
        globalTooltip.id = 'build-tooltip';
        globalTooltip.className = 'build-tooltip';
        document.body.appendChild(globalTooltip);
    }
    return globalTooltip;
}

interface TooltipInfo {
    missingPrereqs: string[];
    limitReached: boolean;
    currentCount: number;
    maxCount: number | null;
}

function getTooltipInfo(key: string, category: string): TooltipInfo {
    const result: TooltipInfo = {
        missingPrereqs: [],
        limitReached: false,
        currentCount: 0,
        maxCount: null
    };

    if (!gameState) return result;

    const isBuilding = category === 'building';
    const data = isBuilding ? RULES.buildings[key] : RULES.units[key];
    if (!data) return result;

    // Get player's buildings and count of this specific item
    const playerId = 0; // Human player
    const playerBuildings = new Set<string>();
    let count = 0;

    for (const entity of Object.values(gameState.entities)) {
        if (entity.owner === playerId && !entity.dead) {
            if (entity.type === 'BUILDING') {
                playerBuildings.add(entity.key);
                if (entity.key === key) count++;
            } else if (entity.type === 'UNIT' && entity.key === key) {
                count++;
            }
        }
    }

    result.currentCount = count;

    // Check maxCount limit
    if (data.maxCount) {
        result.maxCount = data.maxCount;
        result.limitReached = count >= data.maxCount;
    }

    // Find missing prerequisites
    if (data.prerequisites) {
        for (const prereq of data.prerequisites) {
            if (!playerBuildings.has(prereq)) {
                const prereqData = RULES.buildings[prereq];
                result.missingPrereqs.push(prereqData?.name || prereq);
            }
        }
    }

    return result;
}

function showTooltipForButton(btn: HTMLElement, key: string, category: string) {
    const tooltip = getGlobalTooltip();
    const isBuilding = category === 'building';
    const data = isBuilding ? RULES.buildings[key] : RULES.units[key];
    if (!data) return;

    // Build stats line
    let stats: string;
    if (isBuilding) {
        const building = RULES.buildings[key];
        const powerInfo = building.power ? `Power: +${building.power}` :
            building.drain ? `Drain: ${building.drain}` : '';
        stats = `HP: ${building.hp}${powerInfo ? ' | ' + powerInfo : ''}`;
        if (building.range && building.damage) {
            stats += ` | Dmg: ${building.damage} | Range: ${building.range}`;
        }
    } else {
        const unit = RULES.units[key];
        stats = `HP: ${unit.hp} | Speed: ${unit.speed}`;
        if (unit.damage && unit.damage > 0) {
            stats += ` | Dmg: ${unit.damage}`;
        }
        if (unit.range && unit.range > 0) {
            stats += ` | Range: ${unit.range}`;
        }
    }

    const description = data.description || '';

    // Get prerequisite and limit info
    const info = getTooltipInfo(key, category);

    // Build the requirements/restrictions HTML
    let restrictionsHtml = '';

    if (info.limitReached) {
        restrictionsHtml += `
            <div class="tooltip-requires">
                <div class="tooltip-requires-title">Limit Reached</div>
                Maximum ${info.maxCount} allowed (you have ${info.currentCount})
            </div>
        `;
    } else if (info.maxCount) {
        restrictionsHtml += `
            <div class="tooltip-limit">
                Limit: ${info.currentCount}/${info.maxCount}
            </div>
        `;
    }

    if (info.missingPrereqs.length > 0) {
        restrictionsHtml += `
            <div class="tooltip-requires">
                <div class="tooltip-requires-title">Requires:</div>
                ${info.missingPrereqs.join(', ')}
            </div>
        `;
    }

    tooltip.innerHTML = `
        <div class="tooltip-title">${data.name}</div>
        <div class="tooltip-stats">${stats}</div>
        ${description ? `<div class="tooltip-desc">${description}</div>` : ''}
        ${restrictionsHtml}
    `;

    // Position to the left of the button
    const rect = btn.getBoundingClientRect();
    const tooltipWidth = 220;
    tooltip.style.top = `${rect.top}px`;
    tooltip.style.left = `${rect.left - tooltipWidth - 10}px`;
    tooltip.style.display = 'block';
}

function hideTooltip() {
    if (globalTooltip) {
        globalTooltip.style.display = 'none';
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
        <div class="queue-count"></div>
    `;

    // Show/hide tooltip on hover
    btn.addEventListener('mouseenter', () => showTooltipForButton(btn, key, category));
    btn.addEventListener('mouseleave', hideTooltip);

    btn.onclick = (e) => {
        if (gameState?.mode === 'demo') return;
        if (btn.classList.contains('disabled')) return;
        const count = e.shiftKey ? 10 : 1;
        if (onBuildClick) {
            onBuildClick(category, key, count);
        }
    };
    btn.oncontextmenu = (e) => {
        e.preventDefault();
        if (gameState?.mode === 'demo') return;
        const count = e.shiftKey ? 10 : 1;

        // For units: use dequeue behavior
        if (category === 'infantry' || category === 'vehicle' || category === 'air') {
            if (btn.classList.contains('building') || btn.classList.contains('queued')) {
                if (onDequeueUnit) {
                    onDequeueUnit(category, key, count);
                }
            }
        } else {
            // Buildings: existing cancel behavior
            if (btn.classList.contains('building') || btn.classList.contains('ready') || btn.classList.contains('placing')) {
                if (onCancelBuild) {
                    onCancelBuild(category);
                }
            }
        }
    };
    parent.appendChild(btn);
}

export function hasBuilding(key: string, owner: number, entities: Entity[]): boolean {
    return entities.some(e => e.owner === owner && e.key === key && !e.dead);
}

// Track previous button states to avoid unnecessary DOM updates
const prevButtonStates: Map<string, {
    disabled: boolean;
    building: boolean;
    ready: boolean;
    placing: boolean;
    queued: boolean;
    progress: number;
    queueCount: number;
}> = new Map();

export function updateButtons(
    entities: Record<EntityId, Entity>,
    queues: Record<string, { current: string | null; progress: number; queued?: readonly string[] }>,
    readyToPlace: string | null,
    placingBuilding: string | null,
    playerId: number = 0
) {
    const owner = playerId;

    // Update prerequisites using canBuild from reducer
    // Buildings
    for (const k of Object.keys(RULES.buildings)) {
        const el = document.getElementById('btn-' + k);
        if (!el) continue;

        const shouldBeDisabled = !canBuild(k, 'building', owner, entities);
        const isDisabled = el.classList.contains('disabled');
        if (shouldBeDisabled !== isDisabled) {
            el.classList.toggle('disabled', shouldBeDisabled);
        }
    }

    // Units (infantry, vehicles, and air)
    for (const k of Object.keys(RULES.units)) {
        const el = document.getElementById('btn-' + k);
        if (!el) continue;

        const unitData = RULES.units[k];
        const category = unitData.type === 'infantry' ? 'infantry' :
            unitData.type === 'air' ? 'air' : 'vehicle';

        const shouldBeDisabled = !canBuild(k, category, owner, entities);
        const isDisabled = el.classList.contains('disabled');
        if (shouldBeDisabled !== isDisabled) {
            el.classList.toggle('disabled', shouldBeDisabled);
        }
    }

    // Compute desired state for each button
    const desiredStates: Map<string, {
        building: boolean;
        ready: boolean;
        placing: boolean;
        queued: boolean;
        progress: number;
        queueCount: number;
        statusText: string;
    }> = new Map();

    // Update production states
    const categories = ['building', 'infantry', 'vehicle', 'air'] as const;

    for (const cat of categories) {
        const q = queues[cat];
        const containerIds = cat === 'building' ? ['tab-buildings', 'tab-defense'] :
            cat === 'infantry' ? ['tab-infantry'] :
                cat === 'air' ? ['tab-air'] : ['tab-vehicles'];

        // Count queued items by key
        const queuedCounts: Record<string, number> = {};
        if (q?.queued) {
            for (const key of q.queued) {
                queuedCounts[key] = (queuedCounts[key] || 0) + 1;
            }
        }

        for (const containerId of containerIds) {
            const container = document.getElementById(containerId);
            if (!container) continue;

            // Initialize all buttons in this category to default state
            Array.from(container.children).forEach(btn => {
                const btnId = btn.id;
                if (!btnId.startsWith('btn-')) return;
                const key = btnId.slice(4);

                desiredStates.set(key, {
                    building: false,
                    ready: false,
                    placing: false,
                    queued: false,
                    progress: 0,
                    queueCount: 0,
                    statusText: ''
                });
            });
        }

        // Set state for currently building item
        if (q?.current) {
            const state = desiredStates.get(q.current);
            if (state) {
                state.building = true;
                state.progress = q.progress;
                state.statusText = 'BUILDING';
                state.queueCount = 1 + (queuedCounts[q.current] || 0);
            }
        }

        // Set state for queued items (not currently building)
        for (const [key, count] of Object.entries(queuedCounts)) {
            if (key === q?.current) continue;
            const state = desiredStates.get(key);
            if (state) {
                state.queued = true;
                state.queueCount = count;
            }
        }

        // Set state for ready to place (buildings only)
        if (cat === 'building' && readyToPlace) {
            const state = desiredStates.get(readyToPlace);
            if (state) {
                state.building = false;
                state.ready = true;
                state.progress = 100;
                state.statusText = 'READY';

                if (placingBuilding === readyToPlace) {
                    state.ready = false;
                    state.placing = true;
                    state.statusText = 'PLACING';
                }
            }
        }
    }

    // Apply changes only where needed
    for (const [key, desired] of desiredStates) {
        const btn = document.getElementById('btn-' + key);
        if (!btn) continue;

        const prev = prevButtonStates.get(key);

        // Update classes only if changed
        if (!prev || prev.building !== desired.building) {
            btn.classList.toggle('building', desired.building);
        }
        if (!prev || prev.ready !== desired.ready) {
            btn.classList.toggle('ready', desired.ready);
        }
        if (!prev || prev.placing !== desired.placing) {
            btn.classList.toggle('placing', desired.placing);
        }
        if (!prev || prev.queued !== desired.queued) {
            btn.classList.toggle('queued', desired.queued);
        }

        // Update progress overlay only if changed
        if (!prev || prev.progress !== desired.progress) {
            const overlay = btn.querySelector('.progress-overlay') as HTMLElement;
            if (overlay) overlay.style.width = desired.progress + '%';
        }

        // Update status text only if changed
        if (!prev || prev.queueCount !== desired.queueCount || desired.statusText !== (prev.building || prev.ready || prev.placing ? (prev.placing ? 'PLACING' : prev.ready ? 'READY' : 'BUILDING') : '')) {
            const status = btn.querySelector('.btn-status') as HTMLElement;
            if (status) status.innerText = desired.statusText;
        }

        // Update queue count only if changed
        if (!prev || prev.queueCount !== desired.queueCount) {
            const queueCountEl = btn.querySelector('.queue-count') as HTMLElement;
            if (queueCountEl) {
                if (desired.queueCount > 1) {
                    queueCountEl.innerText = `x${desired.queueCount}`;
                    queueCountEl.style.display = 'block';
                } else {
                    queueCountEl.innerText = '';
                    queueCountEl.style.display = 'none';
                }
            }
        }

        // Store current state for next comparison
        prevButtonStates.set(key, {
            disabled: btn.classList.contains('disabled'),
            building: desired.building,
            ready: desired.ready,
            placing: desired.placing,
            queued: desired.queued,
            progress: desired.progress,
            queueCount: desired.queueCount
        });
    }
}

export function updateGameState(state: GameState) {
    gameState = state;
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
            canvas.classList.remove('repair-mode');
        } else {
            canvas.classList.remove('sell-mode');
        }
    }
}

export function updateRepairModeUI(state: GameState) {
    gameState = state;
    const btn = document.getElementById('repair-btn');
    const canvas = document.getElementById('gameCanvas');

    if (btn) {
        if (state.repairMode) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    }

    if (canvas) {
        if (state.repairMode) {
            canvas.classList.add('repair-mode');
            canvas.classList.remove('sell-mode');
        } else {
            canvas.classList.remove('repair-mode');
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

export function setStatusMessage(msg: string, type: 'info' | 'error' = 'info') {
    const el = document.getElementById('status-msg');
    if (el) {
        el.innerText = msg;
        el.style.color = type === 'error' ? '#f44' : '#fff';
    }
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

export function setObserverMode(isObserver: boolean) {
    const sidebar = document.getElementById('sidebar');
    const gameContainer = document.getElementById('game-container');
    const minimapContainer = document.getElementById('minimap-container');

    if (isObserver) {
        // Hide sidebar, show floating minimap
        if (sidebar) sidebar.classList.add('observer-hidden');
        if (gameContainer) gameContainer.classList.add('observer-mode');
        if (minimapContainer) minimapContainer.classList.add('floating');
    } else {
        // Show normal sidebar
        if (sidebar) sidebar.classList.remove('observer-hidden');
        if (gameContainer) gameContainer.classList.remove('observer-mode');
        if (minimapContainer) minimapContainer.classList.remove('floating');
    }


}

// Callback for loading game state
let onLoadGameState: ((state: GameState) => void) | null = null;
let onCloseDebug: (() => void) | null = null;
let debugOverlayInitialized = false;
let debugContentRendered = false;
let currentDebugState: GameState | null = null;

export function setLoadGameStateCallback(callback: (state: GameState) => void) {
    onLoadGameState = callback;
}

export function setCloseDebugCallback(callback: () => void) {
    onCloseDebug = callback;
}

// Call this to force a re-render of debug content (e.g., after loading state)
export function refreshDebugUI() {
    debugContentRendered = false;
}

export function updateDebugUI(state: GameState) {
    currentDebugState = state;

    let debugOverlay = document.getElementById('debug-overlay');
    if (!state.debugMode) {
        if (debugOverlay) debugOverlay.style.display = 'none';
        debugOverlayInitialized = false;
        debugContentRendered = false;
        return;
    }

    // Game is paused in debug mode - only render content once
    if (debugContentRendered) {
        return;
    }

    // Create overlay if it doesn't exist
    if (!debugOverlay) {
        debugOverlay = document.createElement('div');
        debugOverlay.id = 'debug-overlay';
        document.body.appendChild(debugOverlay);
    }

    debugOverlay.style.display = 'block';

    // Only create the structure once, then update dynamic content
    if (!debugOverlayInitialized) {
        let html = `
            <div class="debug-header">
                <h2>DEBUG MODE (PAUSED)</h2>
                <div class="debug-header-actions">
                    <button id="debug-collapse-all" class="debug-icon-btn" title="Expand All">&#9654;</button>
                    <button id="debug-close-btn" class="debug-icon-btn debug-close-btn" title="Close (F3)">&times;</button>
                </div>
            </div>
        `;

        // Game Info section (collapsible)
        html += `
            <details class="debug-details">
                <summary>Game Info</summary>
                <div id="debug-game-info" class="debug-section"></div>
            </details>
        `;

        // Save/Load buttons section (collapsible)
        html += `
            <details class="debug-details">
                <summary>Save / Load State</summary>
                <div class="debug-section">
                    <div class="debug-btn-row">
                        <button id="debug-save-clipboard" class="debug-btn">Copy to Clipboard</button>
                        <button id="debug-save-file" class="debug-btn">Download JSON</button>
                    </div>
                    <div class="debug-btn-row">
                        <button id="debug-load-clipboard" class="debug-btn">Paste from Clipboard</button>
                        <button id="debug-load-file" class="debug-btn">Load JSON File</button>
                    </div>
                    <input type="file" id="debug-file-input" accept=".json" style="display: none;" />
                </div>
            </details>
        `;

        html += '<div id="debug-stats-container" class="debug-stats-container"></div>';

        debugOverlay.innerHTML = html;

        // Attach event listeners ONCE
        setupDebugSaveLoadHandlers();
        setupDebugHeaderHandlers();
        debugOverlayInitialized = true;
    }

    // Update game info section
    const gameInfoEl = document.getElementById('debug-game-info');
    if (gameInfoEl) {
        const entityCounts = {
            units: Object.values(state.entities).filter(e => e.type === 'UNIT' && !e.dead).length,
            buildings: Object.values(state.entities).filter(e => e.type === 'BUILDING' && !e.dead).length,
            resources: Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead).length,
            projectiles: state.projectiles.length,
            particles: state.particles.length
        };
        gameInfoEl.innerHTML = `
            <p><strong>Tick:</strong> ${state.tick} (${(state.tick / 60).toFixed(1)}s)</p>
            <p><strong>Entities:</strong> ${entityCounts.units} units, ${entityCounts.buildings} buildings, ${entityCounts.resources} resources</p>
            <p><strong>Projectiles:</strong> ${entityCounts.projectiles} | <strong>Particles:</strong> ${entityCounts.particles}</p>
            <p><strong>Map:</strong> ${state.config.width}x${state.config.height}</p>
        `;
    }

    // Update player stats with AI information
    const statsContainer = document.getElementById('debug-stats-container');
    if (statsContainer) {
        // Preserve open/closed state of all details elements before updating
        const openState: Record<string, boolean> = {};
        statsContainer.querySelectorAll('details[data-id]').forEach(el => {
            const id = el.getAttribute('data-id');
            if (id) openState[id] = el.hasAttribute('open');
        });

        let statsHtml = '';
        for (const pid in state.players) {
            const player = state.players[pid];
            const playerId = parseInt(pid);
            const entities = Object.values(state.entities).filter(e => e.owner === playerId && !e.dead);
            const buildings = entities.filter(e => e.type === 'BUILDING');
            const units = entities.filter(e => e.type === 'UNIT');
            const harvesters = units.filter(u => u.key === 'harvester');
            const combatUnits = units.filter(u => u.key !== 'harvester' && u.key !== 'mcv');

            let aiHtml = '';
            if (player.isAi) {
                try {
                    const aiState = getAIState(playerId);
                    aiHtml = buildAIStateHTML(aiState, state, playerId, openState);
                } catch (e) {
                    aiHtml = '<p class="debug-warning">AI state unavailable</p>';
                }
            }

            const playerOpen = openState[`player-${playerId}`] ? 'open' : '';
            statsHtml += `
                <details ${playerOpen} class="debug-details player-debug-stat" data-id="player-${playerId}" style="border-left: 4px solid ${player.color}">
                    <summary>Player ${player.id} ${player.isAi ? `(AI - ${player.difficulty})` : '(Human)'}</summary>
                    <div class="debug-section">
                        <div class="debug-stat-row">
                            <span>Credits:</span>
                            <span class="debug-value">$${Math.floor(player.credits)}</span>
                        </div>
                        <div class="debug-stat-row">
                            <span>Power:</span>
                            <span class="debug-value ${player.usedPower > player.maxPower ? 'debug-warning' : ''}">${player.maxPower - player.usedPower} / ${player.maxPower}</span>
                        </div>
                        <div class="debug-stat-row">
                            <span>Buildings:</span>
                            <span class="debug-value">${buildings.length}</span>
                        </div>
                        <div class="debug-stat-row">
                            <span>Combat Units:</span>
                            <span class="debug-value">${combatUnits.length}</span>
                        </div>
                        <div class="debug-stat-row">
                            <span>Harvesters:</span>
                            <span class="debug-value">${harvesters.length}</span>
                        </div>
                        ${aiHtml}
                    </div>
                </details>
            `;
        }
        statsContainer.innerHTML = statsHtml;
    }

    debugContentRendered = true;
}

function buildAIStateHTML(aiState: AIPlayerState, state: GameState, playerId: number, openState: Record<string, boolean>): string {
    const strategyColors: Record<AIStrategy, string> = {
        'buildup': '#4af',
        'attack': '#f44',
        'defend': '#ff4',
        'harass': '#f84',
        'all_in': '#f00'
    };

    const priorityColors: Record<InvestmentPriority, string> = {
        'economy': '#4f4',
        'warfare': '#f44',
        'defense': '#ff4',
        'balanced': '#aaa'
    };

    const strategyColor = strategyColors[aiState.strategy] || '#fff';
    const priorityColor = priorityColors[aiState.investmentPriority] || '#fff';

    // Get threat level color
    const threatColor = aiState.threatLevel > 70 ? '#f44' :
        aiState.threatLevel > 40 ? '#fa4' :
            aiState.threatLevel > 20 ? '#ff4' : '#4f4';

    // Get economy score color
    const econColor = aiState.economyScore > 70 ? '#4f4' :
        aiState.economyScore > 40 ? '#ff4' : '#f44';

    // Build vengeance info
    let vengeanceHtml = '';
    const vengeanceEntries = Object.entries(aiState.vengeanceScores);
    if (vengeanceEntries.length > 0) {
        const topVengeance = vengeanceEntries
            .map(([pid, score]) => ({ pid: parseInt(pid), score: score as number }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);

        vengeanceHtml = topVengeance.map(v => {
            const targetPlayer = state.players[v.pid];
            const color = targetPlayer?.color || '#888';
            return `<span class="debug-vengeance-badge" style="border-color: ${color}">P${v.pid}: ${v.score.toFixed(0)}</span>`;
        }).join(' ');
    } else {
        vengeanceHtml = '<span class="debug-muted">None</span>';
    }

    // Build enemy intelligence info
    const intel = aiState.enemyIntelligence;
    const totalEnemyUnits = Object.values(intel.unitCounts).reduce((a, b) => a + (b as number), 0);
    const topEnemyUnits = Object.entries(intel.unitCounts)
        .sort((a, b) => (b[1] as number) - (a[1] as number))
        .slice(0, 3)
        .map(([key, count]) => `${key}: ${count}`)
        .join(', ');

    // Expansion target info
    const expansionInfo = aiState.expansionTarget
        ? `(${Math.round(aiState.expansionTarget.x)}, ${Math.round(aiState.expansionTarget.y)})`
        : '<span class="debug-muted">None</span>';

    // Enemy base location
    const enemyBaseInfo = aiState.enemyBaseLocation
        ? `(${Math.round(aiState.enemyBaseLocation.x)}, ${Math.round(aiState.enemyBaseLocation.y)})`
        : '<span class="debug-muted">Unknown</span>';

    // Preserve open state for AI subsections
    const aiStateOpen = openState[`ai-state-${playerId}`] ? 'open' : '';
    const groupsOpen = openState[`ai-groups-${playerId}`] ? 'open' : '';
    const targetingOpen = openState[`ai-targeting-${playerId}`] ? 'open' : '';
    const intelOpen = openState[`ai-intel-${playerId}`] ? 'open' : '';

    return `
        <div class="debug-ai-section">
            <details ${aiStateOpen} class="debug-details debug-ai-subsection" data-id="ai-state-${playerId}">
                <summary>AI State</summary>
                <div class="debug-section">
                    <div class="debug-stat-row">
                        <span>Strategy:</span>
                        <span class="debug-badge" style="background: ${strategyColor}">${aiState.strategy.toUpperCase()}</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Priority:</span>
                        <span class="debug-badge" style="background: ${priorityColor}">${aiState.investmentPriority.toUpperCase()}</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Threat Level:</span>
                        <span class="debug-value" style="color: ${threatColor}">${aiState.threatLevel.toFixed(0)}%</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Economy Score:</span>
                        <span class="debug-value" style="color: ${econColor}">${aiState.economyScore.toFixed(0)}%</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Peace Ticks:</span>
                        <span class="debug-value">${aiState.peaceTicks} (${(aiState.peaceTicks / 60).toFixed(1)}s)</span>
                    </div>
                </div>
            </details>

            <details ${groupsOpen} class="debug-details debug-ai-subsection" data-id="ai-groups-${playerId}">
                <summary>Groups</summary>
                <div class="debug-section">
                    <div class="debug-stat-row">
                        <span>Attack Group:</span>
                        <span class="debug-value">${aiState.attackGroup.length} units</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Defense Group:</span>
                        <span class="debug-value">${aiState.defenseGroup.length} units</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Harass Group:</span>
                        <span class="debug-value">${aiState.harassGroup.length} units</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Threats Near Base:</span>
                        <span class="debug-value ${aiState.threatsNearBase.length > 0 ? 'debug-warning' : ''}">${aiState.threatsNearBase.length}</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Harvesters Attacked:</span>
                        <span class="debug-value ${aiState.harvestersUnderAttack.length > 0 ? 'debug-warning' : ''}">${aiState.harvestersUnderAttack.length}</span>
                    </div>
                </div>
            </details>

            <details ${targetingOpen} class="debug-details debug-ai-subsection" data-id="ai-targeting-${playerId}">
                <summary>Targeting</summary>
                <div class="debug-section">
                    <div class="debug-stat-row">
                        <span>Enemy Base:</span>
                        <span class="debug-value">${enemyBaseInfo}</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Expansion Target:</span>
                        <span class="debug-value">${expansionInfo}</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Vengeance:</span>
                        <span class="debug-value">${vengeanceHtml}</span>
                    </div>
                </div>
            </details>

            <details ${intelOpen} class="debug-details debug-ai-subsection" data-id="ai-intel-${playerId}">
                <summary>Enemy Intel</summary>
                <div class="debug-section">
                    <div class="debug-stat-row">
                        <span>Dominant Armor:</span>
                        <span class="debug-value">${intel.dominantArmor}</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>Enemy Units (${totalEnemyUnits}):</span>
                        <span class="debug-value debug-small">${topEnemyUnits || 'None'}</span>
                    </div>
                </div>
            </details>
        </div>
    `;
}

// Get the current debug state (used by button handlers)
function getCurrentDebugState(): GameState | null {
    return currentDebugState;
}

function setupDebugSaveLoadHandlers() {
    const showStatus = (msg: string, isError = false) => {
        showToast(msg, isError ? 'error' : 'success');
    };

    // Helper to serialize state with Vector objects as plain objects
    const serializeState = (s: GameState): string => {
        return JSON.stringify(s, (_key, value) => {
            if (value && typeof value === 'object' && 'x' in value && 'y' in value && typeof value.x === 'number' && typeof value.y === 'number') {
                return { x: value.x, y: value.y };
            }
            return value;
        }, 2);
    };

    // Save to clipboard
    const saveClipboardBtn = document.getElementById('debug-save-clipboard');
    if (saveClipboardBtn) {
        saveClipboardBtn.onclick = async () => {
            const state = getCurrentDebugState();
            if (!state) return;
            try {
                const json = serializeState(state);
                await navigator.clipboard.writeText(json);
                showStatus('✓ State copied to clipboard!');
            } catch (e) {
                showStatus('✗ Failed to copy to clipboard', true);
            }
        };
    }

    // Save to file
    const saveFileBtn = document.getElementById('debug-save-file');
    if (saveFileBtn) {
        saveFileBtn.onclick = () => {
            const state = getCurrentDebugState();
            if (!state) return;
            try {
                const json = serializeState(state);
                const blob = new Blob([json], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `game_state_tick_${state.tick}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                showStatus('✓ State downloaded!');
            } catch (e) {
                showStatus('✗ Failed to save file', true);
            }
        };
    }

    // Load from clipboard
    const loadClipboardBtn = document.getElementById('debug-load-clipboard');
    if (loadClipboardBtn) {
        loadClipboardBtn.onclick = async () => {
            try {
                const text = await navigator.clipboard.readText();
                const loadedState = parseGameState(text);
                if (loadedState && onLoadGameState) {
                    onLoadGameState(loadedState);
                    refreshDebugUI(); // Re-render with new state
                    showStatus('✓ State loaded from clipboard!');
                } else if (!onLoadGameState) {
                    showStatus('✗ Load callback not set', true);
                }
            } catch (e) {
                showStatus('✗ Failed to load from clipboard', true);
            }
        };
    }

    // Load from file
    const loadFileBtn = document.getElementById('debug-load-file');
    const fileInput = document.getElementById('debug-file-input') as HTMLInputElement;
    if (loadFileBtn && fileInput) {
        loadFileBtn.onclick = () => fileInput.click();
        fileInput.onchange = (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const text = event.target?.result as string;
                    const loadedState = parseGameState(text);
                    if (loadedState && onLoadGameState) {
                        onLoadGameState(loadedState);
                        refreshDebugUI(); // Re-render with new state
                        showStatus('✓ State loaded from file!');
                    } else if (!onLoadGameState) {
                        showStatus('✗ Load callback not set', true);
                    }
                } catch (e) {
                    showStatus('✗ Failed to parse file', true);
                }
            };
            reader.readAsText(file);
            fileInput.value = ''; // Reset for next use
        };
    }
}

function setupDebugHeaderHandlers() {
    // Close button - toggle debug mode off (same as pressing F3)
    const closeBtn = document.getElementById('debug-close-btn');
    if (closeBtn) {
        closeBtn.onclick = () => {
            if (onCloseDebug) {
                onCloseDebug();
            }
        };
    }

    // Collapse all toggle
    const collapseAllBtn = document.getElementById('debug-collapse-all');
    if (collapseAllBtn) {
        collapseAllBtn.onclick = () => {
            const overlay = document.getElementById('debug-overlay');
            if (!overlay) return;

            const allDetails = overlay.querySelectorAll('details');
            const someOpen = Array.from(allDetails).some(d => d.hasAttribute('open'));

            allDetails.forEach(d => {
                if (someOpen) {
                    d.removeAttribute('open');
                } else {
                    d.setAttribute('open', '');
                }
            });

            // Update button icon
            collapseAllBtn.innerHTML = someOpen ? '&#9654;' : '&#9660;';
        };
    }
}

// Toast notification system
function showToast(message: string, type: 'success' | 'error' = 'success') {
    let container = document.getElementById('debug-toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'debug-toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `debug-toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// Convert plain {x, y} object to Vector instance
function toVector(v: { x: number; y: number } | null | undefined): Vector | null {
    if (!v || typeof v.x !== 'number' || typeof v.y !== 'number') return null;
    return new Vector(v.x, v.y);
}

// Parse and reconstruct game state from JSON, restoring Vector objects
function parseGameState(json: string): GameState | null {
    try {
        const data = JSON.parse(json);

        // Reconstruct Vector objects in entities
        if (data.entities) {
            for (const id of Object.keys(data.entities)) {
                const e = data.entities[id];

                // Top-level entity vectors
                if (e.pos) e.pos = new Vector(e.pos.x, e.pos.y);
                if (e.prevPos) e.prevPos = new Vector(e.prevPos.x, e.prevPos.y);

                // Movement component vectors (for units)
                if (e.movement) {
                    e.movement.vel = e.movement.vel ? new Vector(e.movement.vel.x, e.movement.vel.y) : new Vector(0, 0);
                    e.movement.moveTarget = toVector(e.movement.moveTarget);
                    e.movement.finalDest = toVector(e.movement.finalDest);
                    e.movement.unstuckDir = toVector(e.movement.unstuckDir);
                    e.movement.avgVel = toVector(e.movement.avgVel);
                    if (e.movement.path && Array.isArray(e.movement.path)) {
                        e.movement.path = e.movement.path.map((p: { x: number; y: number }) => new Vector(p.x, p.y));
                    }
                }

                // Combat component vectors
                if (e.combat) {
                    e.combat.attackMoveTarget = toVector(e.combat.attackMoveTarget);
                    e.combat.stanceHomePos = toVector(e.combat.stanceHomePos);
                }

                // Harvester component vectors
                if (e.harvester) {
                    e.harvester.dockPos = toVector(e.harvester.dockPos);
                }

                // Building state component vectors
                if (e.buildingState) {
                    e.buildingState.rallyPoint = toVector(e.buildingState.rallyPoint);
                }
            }
        }

        // Reconstruct Vector objects in projectiles
        if (data.projectiles && Array.isArray(data.projectiles)) {
            for (const p of data.projectiles) {
                if (p.pos) p.pos = new Vector(p.pos.x, p.pos.y);
                if (p.vel) p.vel = new Vector(p.vel.x, p.vel.y);
            }
        }

        // Reconstruct Vector objects in particles
        if (data.particles && Array.isArray(data.particles)) {
            for (const p of data.particles) {
                if (p.pos) p.pos = new Vector(p.pos.x, p.pos.y);
                if (p.vel) p.vel = new Vector(p.vel.x, p.vel.y);
            }
        }

        return data as GameState;
    } catch (e) {
        console.error('Failed to parse game state:', e);
        return null;
    }
}

// ==================== Command Bar (Stances + Attack-Move) ====================

/**
 * Initialize the command bar for unit stances and attack-move.
 * Must be called after the DOM is ready.
 */
export function initCommandBar(
    setStance: (stance: AttackStance) => void,
    toggleAttackMove: () => void
) {
    onSetStance = setStance;
    onToggleAttackMove = toggleAttackMove;

    // Wire up stance buttons
    const aggressiveBtn = document.getElementById('stance-aggressive');
    const defensiveBtn = document.getElementById('stance-defensive');
    const holdBtn = document.getElementById('stance-hold');
    const attackMoveBtn = document.getElementById('attack-move-btn');

    if (aggressiveBtn) {
        aggressiveBtn.addEventListener('click', () => onSetStance?.('aggressive'));
    }
    if (defensiveBtn) {
        defensiveBtn.addEventListener('click', () => onSetStance?.('defensive'));
    }
    if (holdBtn) {
        holdBtn.addEventListener('click', () => onSetStance?.('hold_ground'));
    }
    if (attackMoveBtn) {
        attackMoveBtn.addEventListener('click', () => onToggleAttackMove?.());
    }
}

/**
 * Update the command bar visibility and state based on current selection.
 * Shows the bar when combat units are selected, highlights active stance.
 */
export function updateCommandBar(state: GameState) {
    const commandBar = document.getElementById('command-bar');
    const canvas = document.getElementById('gameCanvas');
    if (!commandBar) return;

    // Check if we have combat units selected (not harvesters, MCVs)
    const hasCombatUnits = state.selection.some(id => {
        const entity = state.entities[id];
        return entity && isUnit(entity) &&
            entity.key !== 'harvester' && entity.key !== 'mcv';
    });

    // Show/hide command bar
    if (hasCombatUnits) {
        commandBar.classList.remove('hidden');

        // Get the dominant stance of selected units
        const stances = state.selection
            .map(id => state.entities[id])
            .filter(e => e && isUnit(e) && e.key !== 'harvester' && e.key !== 'mcv')
            .map(e => (e as UnitEntity).combat?.stance || 'aggressive');

        // Find most common stance
        const stanceCounts = stances.reduce((acc, s) => {
            acc[s] = (acc[s] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        let dominantStance: AttackStance = 'aggressive';
        let maxCount = 0;
        for (const [stance, count] of Object.entries(stanceCounts)) {
            if (count > maxCount) {
                maxCount = count;
                dominantStance = stance as AttackStance;
            }
        }

        // Update stance button states
        document.querySelectorAll('.stance-btn').forEach(btn => btn.classList.remove('active'));
        if (dominantStance === 'aggressive') {
            document.getElementById('stance-aggressive')?.classList.add('active');
        } else if (dominantStance === 'defensive') {
            document.getElementById('stance-defensive')?.classList.add('active');
        } else if (dominantStance === 'hold_ground') {
            document.getElementById('stance-hold')?.classList.add('active');
        }
    } else {
        commandBar.classList.add('hidden');
    }

    // Update attack-move button and canvas cursor
    const attackMoveBtn = document.getElementById('attack-move-btn');
    if (attackMoveBtn) {
        if (state.attackMoveMode) {
            attackMoveBtn.classList.add('active');
        } else {
            attackMoveBtn.classList.remove('active');
        }
    }

    if (canvas) {
        if (state.attackMoveMode) {
            canvas.classList.add('attack-move-mode');
        } else {
            canvas.classList.remove('attack-move-mode');
        }
    }
}

// All action cursor CSS class names
const ACTION_CURSOR_CLASSES = [
    'cursor-move', 'cursor-attack', 'cursor-harvest', 'cursor-capture',
    'cursor-deploy', 'cursor-engineer-repair', 'cursor-no-entry'
];

type ActionCursor = 'move' | 'attack' | 'harvest' | 'capture' | 'deploy' | 'engineer-repair' | 'no-entry' | null;

/**
 * Analyze what types of units are currently selected
 */
function getSelectionInfo(state: GameState, playerId: number): {
    hasUnits: boolean;
    hasCombatUnits: boolean;
    hasHarvesters: boolean;
    hasEngineers: boolean;
    hasInductionRigs: boolean;
} {
    let hasUnits = false;
    let hasCombatUnits = false;
    let hasHarvesters = false;
    let hasEngineers = false;
    let hasInductionRigs = false;

    for (const id of state.selection) {
        const entity = state.entities[id];
        if (!entity || entity.dead || entity.owner !== playerId) continue;
        if (!isUnit(entity)) continue;

        hasUnits = true;

        if (isHarvester(entity)) {
            hasHarvesters = true;
        } else if (isEngineer(entity)) {
            hasEngineers = true;
        } else if (isInductionRig(entity)) {
            hasInductionRigs = true;
        } else {
            // Regular combat unit (not harvester, engineer, or induction rig)
            const unitData = RULES.units[entity.key];
            if (unitData && unitData.damage > 0) {
                hasCombatUnits = true;
            }
        }
    }

    return { hasUnits, hasCombatUnits, hasHarvesters, hasEngineers, hasInductionRigs };
}

/**
 * Find entity under mouse cursor
 */
function getEntityAtPosition(entities: Record<EntityId, Entity>, wx: number, wy: number): Entity | null {
    for (const id in entities) {
        const entity = entities[id];
        if (entity.dead) continue;

        // For buildings, use rectangular bounds
        if (entity.type === 'BUILDING') {
            const dx = Math.abs(wx - entity.pos.x);
            const dy = Math.abs(wy - entity.pos.y);
            if (dx <= entity.w / 2 && dy <= entity.h / 2) {
                return entity;
            }
        } else {
            // For other entities, use radius
            const dist = Math.sqrt((wx - entity.pos.x) ** 2 + (wy - entity.pos.y) ** 2);
            if (dist <= entity.radius + 5) {
                return entity;
            }
        }
    }
    return null;
}

/**
 * Check if any selected combat unit can attack a given target
 */
function canAnyUnitAttackTarget(state: GameState, targetEntity: Entity, playerId: number): boolean {
    // Determine if target is air or ground
    const targetData = RULES.units[targetEntity.key];
    const isTargetAir = targetData && targetData.fly === true;

    for (const id of state.selection) {
        const entity = state.entities[id];
        if (!entity || entity.dead || entity.owner !== playerId) continue;
        if (!isUnit(entity)) continue;

        const unitData = RULES.units[entity.key];
        if (!unitData || unitData.damage <= 0) continue;

        // Check weapon targeting capabilities
        const weaponType = unitData.weaponType || 'bullet';
        const targeting = RULES.weaponTargeting?.[weaponType] || { canTargetGround: true, canTargetAir: false };

        if (isTargetAir && targeting.canTargetAir) return true;
        if (!isTargetAir && targeting.canTargetGround) return true;
    }

    return false;
}

/**
 * Update the action cursor based on what's selected and what's under the mouse.
 * Shows different cursors for move, attack, harvest, capture, deploy, repair, and invalid targets.
 */
export function updateActionCursor(
    state: GameState,
    mouseWorldX: number,
    mouseWorldY: number,
    playerId: number
): void {
    const canvas = document.getElementById('gameCanvas');
    if (!canvas) return;

    // Helper to clear all action cursors
    const clearCursors = () => {
        for (const cls of ACTION_CURSOR_CLASSES) {
            canvas.classList.remove(cls);
        }
    };

    // Helper to set a specific cursor
    const setCursor = (cursor: ActionCursor) => {
        clearCursors();
        if (cursor) {
            canvas.classList.add(`cursor-${cursor}`);
        }
    };

    // Don't show action cursor if in special modes
    if (state.sellMode || state.repairMode || state.attackMoveMode || state.placingBuilding) {
        clearCursors();
        return;
    }

    // Get selection info
    const selInfo = getSelectionInfo(state, playerId);

    // No units selected → no action cursor
    if (!selInfo.hasUnits) {
        clearCursors();
        return;
    }

    // Find entity under mouse
    const hoveredEntity = getEntityAtPosition(state.entities, mouseWorldX, mouseWorldY);

    // === DETERMINE CURSOR BASED ON HOVERED ENTITY ===

    if (!hoveredEntity) {
        // Hovering empty ground → move cursor
        setCursor('move');
        return;
    }

    // --- WELL ---
    if (isWell(hoveredEntity)) {
        if (selInfo.hasInductionRigs) {
            setCursor('deploy');
        } else {
            setCursor('move');
        }
        return;
    }

    // --- RESOURCE (ORE) ---
    if (isResource(hoveredEntity)) {
        if (selInfo.hasHarvesters) {
            setCursor('harvest');
        } else {
            setCursor('move');
        }
        return;
    }

    // --- ROCK ---
    if (hoveredEntity.type === 'ROCK') {
        // Can't interact with rocks
        setCursor('no-entry');
        return;
    }

    // --- FRIENDLY ENTITY ---
    if (isPlayerEntity(hoveredEntity, playerId)) {
        // Engineer can repair damaged friendly buildings
        if (selInfo.hasEngineers && isBuilding(hoveredEntity) && hoveredEntity.hp < hoveredEntity.maxHp) {
            setCursor('engineer-repair');
            return;
        }
        // Can't do anything else to friendly entities (attacking own units not allowed)
        // Show no cursor change (default crosshair)
        clearCursors();
        return;
    }

    // --- NEUTRAL ENTITY ---
    if (hoveredEntity.owner === -1) {
        // Can't attack neutral entities
        setCursor('move');
        return;
    }

    // --- ENEMY ENTITY ---
    if (isEnemyOf(hoveredEntity, playerId)) {
        // Engineer + enemy building
        if (selInfo.hasEngineers && isBuilding(hoveredEntity)) {
            const buildingData = RULES.buildings[hoveredEntity.key];
            if (buildingData && buildingData.capturable === true) {
                setCursor('capture');
            } else {
                // Non-capturable building (defense building)
                setCursor('no-entry');
            }
            return;
        }

        // Combat units vs enemy
        if (selInfo.hasCombatUnits || selInfo.hasHarvesters || selInfo.hasInductionRigs) {
            // Check if any selected unit can actually attack this target
            if (canAnyUnitAttackTarget(state, hoveredEntity, playerId)) {
                setCursor('attack');
            } else {
                // Can't attack (e.g., ground unit vs air target)
                setCursor('no-entry');
            }
            return;
        }

        // Only engineers selected vs enemy unit (not building) - can't attack
        if (selInfo.hasEngineers && !isBuilding(hoveredEntity)) {
            setCursor('no-entry');
            return;
        }
    }

    // Default: no cursor change
    clearCursors();
}


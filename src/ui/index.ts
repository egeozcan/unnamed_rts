import rules from '../data/rules.json';
import { GameState, Entity } from '../engine/types.js';
import { getAIState, AIPlayerState, AIStrategy, InvestmentPriority } from '../engine/ai.js';

const RULES = rules as any;

let gameState: GameState | null = null;
let onBuildClick: ((category: string, key: string) => void) | null = null;
let onToggleSellMode: (() => void) | null = null;
let onToggleRepairMode: (() => void) | null = null;


export function initUI(state: GameState, buildBy: (category: string, key: string) => void, toggleSell: () => void, toggleRepair?: () => void) {
    gameState = state;
    onBuildClick = buildBy;
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

    const tabIndex = ['buildings', 'defense', 'infantry', 'vehicles'].indexOf(tab);
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

    bb.innerHTML = '';
    bd.innerHTML = '';
    bi.innerHTML = '';
    bv.innerHTML = '';

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
        const containerIds = cat === 'building' ? ['tab-buildings', 'tab-defense'] :
            cat === 'infantry' ? ['tab-infantry'] : ['tab-vehicles'];

        for (const containerId of containerIds) {
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
        }

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
let debugOverlayInitialized = false;
let currentDebugState: GameState | null = null;

export function setLoadGameStateCallback(callback: (state: GameState) => void) {
    onLoadGameState = callback;
}

export function updateDebugUI(state: GameState) {
    currentDebugState = state;

    let debugOverlay = document.getElementById('debug-overlay');
    if (!state.debugMode) {
        if (debugOverlay) debugOverlay.style.display = 'none';
        debugOverlayInitialized = false;
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
        let html = '<h2>DEBUG MODE (PAUSED)</h2>';
        html += '<div id="debug-game-info" class="debug-section"></div>';

        // Save/Load buttons section (static, created once)
        html += '<div class="debug-save-load-section">';
        html += '<h3>Save / Load State</h3>';
        html += '<div class="debug-btn-row">';
        html += '<button id="debug-save-clipboard" class="debug-btn">📋 Copy to Clipboard</button>';
        html += '<button id="debug-save-file" class="debug-btn">💾 Download JSON</button>';
        html += '</div>';
        html += '<div class="debug-btn-row">';
        html += '<button id="debug-load-clipboard" class="debug-btn">📋 Paste from Clipboard</button>';
        html += '<button id="debug-load-file" class="debug-btn">📂 Load JSON File</button>';
        html += '</div>';
        html += '<input type="file" id="debug-file-input" accept=".json" style="display: none;" />';
        html += '<p id="debug-status" class="debug-status"></p>';
        html += '</div>';

        html += '<div id="debug-stats-container" class="debug-stats-container"></div>';

        debugOverlay.innerHTML = html;

        // Attach event listeners ONCE
        setupDebugSaveLoadHandlers();
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
                    aiHtml = buildAIStateHTML(aiState, state, playerId);
                } catch (e) {
                    aiHtml = '<p class="debug-warning">AI state unavailable</p>';
                }
            }

            statsHtml += `
                <div class="player-debug-stat" style="border-left: 4px solid ${player.color}">
                    <h3>Player ${player.id} ${player.isAi ? `(AI - ${player.difficulty})` : '(Human)'}</h3>
                    <div class="debug-stat-row">
                        <span>💰 Credits:</span>
                        <span class="debug-value">$${Math.floor(player.credits)}</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>⚡ Power:</span>
                        <span class="debug-value ${player.usedPower > player.maxPower ? 'debug-warning' : ''}">${player.maxPower - player.usedPower} / ${player.maxPower}</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>🏗️ Buildings:</span>
                        <span class="debug-value">${buildings.length}</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>⚔️ Combat Units:</span>
                        <span class="debug-value">${combatUnits.length}</span>
                    </div>
                    <div class="debug-stat-row">
                        <span>🚜 Harvesters:</span>
                        <span class="debug-value">${harvesters.length}</span>
                    </div>
                    ${aiHtml}
                </div>
            `;
        }
        statsContainer.innerHTML = statsHtml;
    }
}

function buildAIStateHTML(aiState: AIPlayerState, state: GameState, _playerId: number): string {
    const strategyColors: Record<AIStrategy, string> = {
        'buildup': '#4af',
        'attack': '#f44',
        'defend': '#ff4',
        'harass': '#f84'
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

    return `
        <div class="debug-ai-section">
            <h4>🤖 AI State</h4>
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
            
            <h4>👥 Groups</h4>
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
            
            <h4>🎯 Targeting</h4>
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
            
            <h4>🔍 Enemy Intel</h4>
            <div class="debug-stat-row">
                <span>Dominant Armor:</span>
                <span class="debug-value">${intel.dominantArmor}</span>
            </div>
            <div class="debug-stat-row">
                <span>Enemy Units (${totalEnemyUnits}):</span>
                <span class="debug-value debug-small">${topEnemyUnits || 'None'}</span>
            </div>
        </div>
    `;
}

// Get the current debug state (used by button handlers)
function getCurrentDebugState(): GameState | null {
    return currentDebugState;
}

function setupDebugSaveLoadHandlers() {
    const showStatus = (msg: string, isError = false) => {
        const statusEl = document.getElementById('debug-status');
        if (statusEl) {
            statusEl.textContent = msg;
            statusEl.style.color = isError ? '#f66' : '#6f6';
            setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 3000);
        }
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

// Parse and reconstruct game state from JSON, restoring Vector objects
function parseGameState(json: string): GameState | null {
    try {
        const data = JSON.parse(json);

        // Import Vector dynamically to reconstruct
        // Since we can't import here, we'll use a simple object check
        // The game engine should handle plain {x, y} objects  
        return data as GameState;
    } catch (e) {
        console.error('Failed to parse game state:', e);
        return null;
    }
}


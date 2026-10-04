import { INITIAL_STATE, update, createPlayerState } from './engine/reducer.js';
import { type GameState, Vector, type EntityId, type Entity, type SkirmishConfig, type PlayerType, PLAYER_COLORS, type Action, type BuildingEntity, type HarvesterUnit, type CombatUnit, type AirUnit, type PlayerState } from './engine/types.js';
import { initPathfindingWorker } from './engine/utils.js';
import { rebuildSpatialGrid } from './engine/spatial.js';

declare global {
    interface Window {
        GAME_STATE?: GameState;
        startGame?: typeof startGameWithConfig;
    }
}
import './styles.css';
import { Renderer } from './renderer/index.js';
import { initUI, updateButtons, updateMoney, updatePower, hideMenu, updateSellModeUI, updateRepairModeUI, setObserverMode, updateDebugUI, setLoadGameStateCallback, setCloseDebugCallback, setStatusMessage, initCommandBar, updateCommandBar, updateActionCursor } from './ui/index.js';
import { initMinimap, renderMinimap, setMinimapClickHandler, setMinimapCommandHandler, pingMinimap } from './ui/minimap.js';
import { pushAlert, resetAlerts, dismissAlert } from './ui/alerts.js';
import { initScoreboard, updateScoreboard } from './ui/scoreboard.js';
import { shouldRunCadencedUpdate } from './ui/cadence.js';
import { initBirdsEye, renderBirdsEye, setBirdsEyeClickHandler, setBirdsEyeCloseHandler } from './ui/birdsEyeView.js';
import { initPauseMenu, showPauseMenu, hidePauseMenu, isHelpVisible, showHelp, closeHelp } from './ui/pause-menu.js';
import { initInput, clampCamera, getInputState, getDragSelection, getMiddleMouseScrollOrigin, handleCameraInput, handleZoomInput, getMinZoom, getWheelMode, setWheelMode, type WheelMode } from './input/index.js';
import { computeAiActions, getAIImplementationOptions, resetAIState, resetAIImplementations, DEFAULT_AI_IMPLEMENTATION_ID } from './engine/ai/index.js';
import { RULES, isUnitData } from './data/schemas/index.js';
import { isUnit, isBuilding, isHarvester, isInductionRig, isWell } from './engine/type-guards.js';
import { isAirUnit } from './engine/entity-helpers.js';
import { isGarrisonableTransport, isInfantryUnit, isTransportedUnit } from './engine/transport.js';
import { pickEntityAt, isHiddenByFog } from './engine/picking.js';
import { createFogGrid } from './engine/reducers/fog.js';
import { createEntityCache } from './engine/perf.js';
import { applySkirmishSettingsToUI, collectSkirmishSettingsFromUI, loadSkirmishSettingsFromStorage, saveSkirmishSettingsToStorage } from './skirmish/persistence.js';
import { getStartingPositions as getStartingPositionsForMap, generateMap as generateSkirmishMap, validateSkirmishConfig, saveRematchConfig, takeRematchConfig } from './game-utils.js';
import { renderEndResults, showEndScreen } from './ui/end-screen.js';
import { enhanceSkirmishSetup } from './ui/skirmish-setup.js';

// Game speed setting (1 = slow, 2 = medium, 3 = fast, 5 = lightspeed)
type GameSpeed = 1 | 2 | 3 | 4 | 5;

// Get canvas
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

// Game state
let currentState: GameState = INITIAL_STATE;
let humanPlayerId: number | null = 0; // Track which player is human (null = observer mode)
let prePauseMode: 'game' | 'demo' | null = null;
let humanDefeatShown = false;
let lastAlertedNotification: GameState['notification'] = null;
// Induction Rigs ordered onto a far well, deployed when they arrive (rig id -> well id)
// Touch-first device: alerts say "tap" instead of "click"
const IS_TOUCH = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
// Sell mode asks for a second click on the same building within this time
// Page-level listeners added by this module; aborted on hot reload so they don't pile up
const moduleListeners = new AbortController();
let lastViewSize: { width: number; height: number } | null = null;
const SELL_CONFIRM_MS = 3000;
let pendingSell: { id: EntityId; until: number } | null = null;
let wasLowPower = false;

// HMR: Restore state from previous hot reload if available
if (import.meta.hot?.data?.gameState) {
    currentState = reconstructVectors(import.meta.hot.data.gameState);
    humanPlayerId = import.meta.hot.data.humanPlayerId;
    console.log('[HMR] Restored game state from hot reload');
}

// OPTIMIZATION: Cache power calculations to avoid recalculating every frame
let cachedPower: { out: number; in: number } = { out: 0, in: 0 };
let cachedPowerTick: number = -1;
let cachedPowerPlayer: number | null = null;
const POWER_RECALC_TICKS = 5;

// Frame rate limiting
const TARGET_FPS = 60;
const FRAME_TIME = 1000 / TARGET_FPS;
const FRAME_TIME_TOLERANCE = 1;
// Fast-forward speeds run several sim ticks per frame; cap the time spent so a heavy late-game
// match slows the sim down instead of freezing rendering and input (the first tick always runs).
const SIM_FRAME_BUDGET_MS = 30;
const TICKS_PER_GAME_SPEED: Record<GameSpeed, number> = {
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 20,
};

let lastFrameTime = 0;
let gameSpeed: GameSpeed = 2;
let animationFrameId: number | null = null;
let lastButtonsTick = -1;
let lastButtonsTimeMs = -Infinity;
const aiImplementationOptions = getAIImplementationOptions();

const BUTTONS_MIN_TICK_DELTA = 5;
const BUTTONS_MIN_TIME_DELTA_MS = 80;
const MINIMAP_MIN_TICK_DELTA = 2;
const MINIMAP_MIN_TIME_DELTA_MS = 66;
const BIRDS_EYE_MIN_TICK_DELTA = 2;
const BIRDS_EYE_MIN_TIME_DELTA_MS = 83;
const DEBUG_UI_MIN_TICK_DELTA = 3;
const DEBUG_UI_MIN_TIME_DELTA_MS = 100;
const FRAME_TIMING_WINDOW = 300;

interface RollingTimingWindow {
    values: Float64Array;
    index: number;
    count: number;
    sum: number;
}

interface FrameStageTimingSummary {
    avg: number;
    p95: number;
    max: number;
}

interface FrameTimingSummary {
    sampleCount: number;
    simMs: FrameStageTimingSummary;
    renderMs: FrameStageTimingSummary;
    uiMs: FrameStageTimingSummary;
    frameMs: FrameStageTimingSummary;
}

function createRollingTimingWindow(size: number): RollingTimingWindow {
    return {
        values: new Float64Array(size),
        index: 0,
        count: 0,
        sum: 0
    };
}

function recordRollingTiming(window: RollingTimingWindow, value: number): void {
    const clampedValue = Number.isFinite(value) ? Math.max(0, value) : 0;
    if (window.count === window.values.length) {
        window.sum -= window.values[window.index];
    } else {
        window.count++;
    }

    window.values[window.index] = clampedValue;
    window.sum += clampedValue;
    window.index = (window.index + 1) % window.values.length;
}

function summarizeRollingTiming(window: RollingTimingWindow): FrameStageTimingSummary {
    if (window.count === 0) {
        return { avg: 0, p95: 0, max: 0 };
    }

    const sample = Array.from(window.values.slice(0, window.count));
    sample.sort((a, b) => a - b);
    const p95Index = Math.min(sample.length - 1, Math.ceil(sample.length * 0.95) - 1);
    const max = sample[sample.length - 1];

    return {
        avg: window.sum / window.count,
        p95: sample[p95Index],
        max
    };
}

const simTimingWindow = createRollingTimingWindow(FRAME_TIMING_WINDOW);
const renderTimingWindow = createRollingTimingWindow(FRAME_TIMING_WINDOW);
const uiTimingWindow = createRollingTimingWindow(FRAME_TIMING_WINDOW);
const frameTimingWindow = createRollingTimingWindow(FRAME_TIMING_WINDOW);

let lastMinimapTick = -1;
let lastMinimapTimeMs = -Infinity;
let lastBirdsEyeTick = -1;
let lastBirdsEyeTimeMs = -Infinity;
let lastDebugUiTick = -1;
let lastDebugUiTimeMs = -Infinity;
let latestFrameTimingSummary: FrameTimingSummary | null = null;
let wasDebugMode = false;

function buildFrameTimingSummary(): FrameTimingSummary {
    return {
        sampleCount: frameTimingWindow.count,
        simMs: summarizeRollingTiming(simTimingWindow),
        renderMs: summarizeRollingTiming(renderTimingWindow),
        uiMs: summarizeRollingTiming(uiTimingWindow),
        frameMs: summarizeRollingTiming(frameTimingWindow)
    };
}

function applyAiActionsForTick(state: GameState, initiativeSeed: number): GameState {
    const aiPlayerIds = Object.keys(state.players)
        .map(Number)
        .filter(pid => state.players[pid]?.isAi);

    if (aiPlayerIds.length === 0) {
        return state;
    }

    const sharedEntityCache = createEntityCache(state.entities);
    const actionListsByPlayer = new Map<number, Action[]>();
    for (const pid of aiPlayerIds) {
        actionListsByPlayer.set(pid, computeAiActions(state, pid, sharedEntityCache));
    }

    const activePlayerIds = aiPlayerIds.filter(pid => (actionListsByPlayer.get(pid)?.length ?? 0) > 0);
    if (activePlayerIds.length === 0) {
        return state;
    }

    const startIdx = initiativeSeed % activePlayerIds.length;
    const orderedPlayerIds = activePlayerIds
        .slice(startIdx)
        .concat(activePlayerIds.slice(0, startIdx));

    let maxActions = 0;
    for (const pid of orderedPlayerIds) {
        const count = actionListsByPlayer.get(pid)?.length ?? 0;
        if (count > maxActions) maxActions = count;
    }

    let nextState = state;
    for (let actionIndex = 0; actionIndex < maxActions; actionIndex++) {
        for (const pid of orderedPlayerIds) {
            const playerActions = actionListsByPlayer.get(pid);
            if (!playerActions || actionIndex >= playerActions.length) continue;
            nextState = update(nextState, playerActions[actionIndex]);
        }
    }

    return nextState;
}

function setGameSpeed(speed: GameSpeed) {
    gameSpeed = speed;
    updateSpeedIndicator();
}

/** Switch between the 3D and classic 2D view (purely visual - the simulation is unaffected). */
function toggleGraphicsMode() {
    const mode = renderer.toggleGraphicsMode();
    syncGraphicsModeSelect();
    currentState = {
        ...currentState,
        notification: { text: mode === '3d' ? '3D view (V to switch)' : 'Classic 2D view (V to switch)', type: 'info', tick: currentState.tick }
    };
}

function syncGraphicsModeSelect() {
    const select = document.getElementById('graphics-mode') as HTMLSelectElement | null;
    if (select) select.value = renderer.getGraphicsMode();
}

function setupWheelModeSelect() {
    const select = document.getElementById('wheel-mode') as HTMLSelectElement | null;
    if (!select) return;
    select.value = getWheelMode();
    select.addEventListener('change', () => setWheelMode(select.value as WheelMode), { signal: moduleListeners.signal });
}

function setupGraphicsModeSelect() {
    const select = document.getElementById('graphics-mode') as HTMLSelectElement | null;
    if (!select) return;
    syncGraphicsModeSelect();
    select.addEventListener('change', () => {
        renderer.setGraphicsMode(select.value === '2d' ? '2d' : '3d');
    }, { signal: moduleListeners.signal });
}

function updateSpeedIndicator() {
    const indicator = document.getElementById('speed-indicator');

    if (!indicator) {
        return;
    }

    const labels = { 1: 'SLOW', 2: 'NORMAL', 3: 'FAST', 4: 'VERY FAST', 5: 'LIGHTSPEED' };
    indicator.textContent = `SPEED: ${labels[gameSpeed]}`;
    indicator.className = `speed-${gameSpeed}`;
}

// Setup Skirmish UI logic
function setupSkirmishUI() {
    const playerSlots = document.querySelectorAll('.player-slot');
    const observerIndicator = document.getElementById('observer-mode');

    function updateSlotAiControls(slot: Element): void {
        const slotDiv = slot as HTMLElement;
        const typeSelect = slot.querySelector('.player-type') as HTMLSelectElement;
        const implementationSelect = slot.querySelector('.ai-implementation') as HTMLSelectElement | null;
        const teamSelect = slot.querySelector('.player-team') as HTMLSelectElement | null;

        if (!implementationSelect) {
            if (teamSelect) {
                teamSelect.disabled = typeSelect.value === 'none';
            }
            slotDiv.classList.toggle('disabled', typeSelect.value === 'none');
            return;
        }

        const isAiSlot = typeSelect.value !== 'human' && typeSelect.value !== 'none';
        implementationSelect.disabled = !isAiSlot;
        implementationSelect.classList.toggle('hidden', !isAiSlot);

        // Disable team dropdown when slot is none
        if (teamSelect) {
            teamSelect.disabled = typeSelect.value === 'none';
        }

        slotDiv.classList.toggle('disabled', typeSelect.value === 'none');
    }

    function updateObserverMode() {
        const hasHuman = Array.from(playerSlots).some(slot => {
            const select = slot.querySelector('.player-type') as HTMLSelectElement;
            return select.value === 'human';
        });

        if (observerIndicator) {
            observerIndicator.classList.toggle('visible', !hasHuman);
        }
    }

    playerSlots.forEach(slot => {
        const select = slot.querySelector('.player-type') as HTMLSelectElement;
        select.addEventListener('change', () => {
            // If this slot became human, set all other human slots to AI-Medium
            if (select.value === 'human') {
                playerSlots.forEach(otherSlot => {
                    if (otherSlot !== slot) {
                        const otherSelect = otherSlot.querySelector('.player-type') as HTMLSelectElement;
                        if (otherSelect.value === 'human') {
                            otherSelect.value = 'medium';
                            updateSlotAiControls(otherSlot);
                        }
                    }
                });
            }

            updateSlotAiControls(slot);
            updateObserverMode();
        }, { signal: moduleListeners.signal });

        updateSlotAiControls(slot);
    });

    updateObserverMode();
}

function populateAiImplementationSelects() {
    const selects = document.querySelectorAll('.ai-implementation') as NodeListOf<HTMLSelectElement>;
    for (const select of selects) {
        const current = select.value || DEFAULT_AI_IMPLEMENTATION_ID;
        select.innerHTML = '';
        for (const option of aiImplementationOptions) {
            const optionNode = document.createElement('option');
            optionNode.value = option.id;
            optionNode.textContent = option.name;
            select.appendChild(optionNode);
        }

        const hasCurrent = aiImplementationOptions.some(option => option.id === current);
        select.value = hasCurrent ? current : DEFAULT_AI_IMPLEMENTATION_ID;
    }
}

/** The setup of the running skirmish, for "Play Again". */
let lastSkirmishConfig: SkirmishConfig | null = null;
/** The human player after they were eliminated and chose to keep watching (for the final screen). */
let defeatedHumanId: number | null = null;

function getSafeSessionStorage(): Storage | null {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
}

function getSafeLocalStorage(): Storage | null {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

function persistSkirmishMenuSettings() {
    const storage = getSafeLocalStorage();
    if (!storage) return;
    const settings = collectSkirmishSettingsFromUI();
    saveSkirmishSettingsToStorage(storage, settings);
}

function restoreSkirmishMenuSettings() {
    const storage = getSafeLocalStorage();
    if (!storage) return;

    const slotCount = document.querySelectorAll('.player-slot').length;
    const settings = loadSkirmishSettingsFromStorage(storage, slotCount);
    if (!settings) return;
    applySkirmishSettingsToUI(settings);
}

function setupSkirmishPersistence() {
    const selectors = '.player-type, .ai-implementation, .player-team, #map-size, #resource-density, #rock-density, #fog-of-war';
    const elements = document.querySelectorAll(selectors);
    for (const element of elements) {
        element.addEventListener('change', persistSkirmishMenuSettings, { signal: moduleListeners.signal });
    }
}

// Get skirmish configuration from UI
function getSkirmishConfig(): SkirmishConfig {
    const players: SkirmishConfig['players'] = [];

    document.querySelectorAll('.player-slot').forEach((slot, index) => {
        const select = slot.querySelector('.player-type') as HTMLSelectElement;
        const aiSelect = slot.querySelector('.ai-implementation') as HTMLSelectElement | null;
        const teamSelect = slot.querySelector('.player-team') as HTMLSelectElement | null;
        const type = select.value as PlayerType;

        if (type !== 'none') {
            const teamValue = teamSelect?.value || '';
            players.push({
                slot: index,
                type,
                color: PLAYER_COLORS[index],
                aiImplementationId: type === 'human'
                    ? undefined
                    : (aiSelect?.value || DEFAULT_AI_IMPLEMENTATION_ID),
                team: teamValue ? (teamValue as 'A' | 'B' | 'C' | 'D') : null,
            });
        }
    });

    const mapSize = (document.getElementById('map-size') as HTMLSelectElement).value as 'small' | 'medium' | 'large' | 'huge';
    const resourceDensity = (document.getElementById('resource-density') as HTMLSelectElement).value as 'low' | 'medium' | 'high';
    const rockDensity = (document.getElementById('rock-density') as HTMLSelectElement).value as 'low' | 'medium' | 'high';
    const fogOfWarEnabled = (document.getElementById('fog-of-war') as HTMLSelectElement | null)?.value !== 'off';

    return { players, mapSize, resourceDensity, rockDensity, fogOfWarEnabled };
}

// Get starting positions for players based on map size
function getStartingPositions(mapWidth: number, mapHeight: number, numPlayers: number): Vector[] {
    return getStartingPositionsForMap(mapWidth, mapHeight, numPlayers);
}

// Generate map entities
function generateMap(config: SkirmishConfig): { entities: Record<EntityId, Entity>, mapWidth: number, mapHeight: number } {
    return generateSkirmishMap(config);
}

function showSetupError(message: string) {
    const el = document.getElementById('setup-error');
    if (!el) return;
    el.textContent = message;
    el.classList.toggle('visible', message !== '');
}

// Start button handler
document.getElementById('start-skirmish-btn')?.addEventListener('click', () => {
    persistSkirmishMenuSettings();
    const config = getSkirmishConfig();
    const setupError = validateSkirmishConfig(config);
    showSetupError(setupError ?? '');
    if (setupError) return;
    lastSkirmishConfig = config;
    startGameWithConfig(config);
}, { signal: moduleListeners.signal });

// Clear a stale setup error as soon as the setup changes
document.getElementById('menu')?.addEventListener('change', () => showSetupError(''), { signal: moduleListeners.signal });

document.getElementById('menu-help-btn')?.addEventListener('click', () => {
    showHelp(() => { /* back to the main menu underneath */ });
}, { signal: moduleListeners.signal });

// Before a game starts the in-game input layer isn't listening yet: let Escape close the menu's help
window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && currentState.mode === 'menu' && isHelpVisible()) closeHelp();
}, { signal: moduleListeners.signal });

// In-game buttons (Sell, Repair, stances...) must not keep keyboard focus: Enter/Space would
// re-press them (Enter is also Deploy MCV), e.g. silently re-arming sell mode
document.getElementById('game-container')?.addEventListener('click', e => {
    const button = (e.target as HTMLElement | null)?.closest('button');
    if (button) button.blur();
}, { signal: moduleListeners.signal });

// The speed badge doubles as a control (touch / keyboards without [ ]): click = faster, wrapping round;
// right-click or Shift+click = slower
const speedIndicator = document.getElementById('speed-indicator');
speedIndicator?.addEventListener('click', (e) => {
    setGameSpeed((e.shiftKey ? (gameSpeed + 3) % 5 + 1 : gameSpeed % 5 + 1) as GameSpeed);
}, { signal: moduleListeners.signal });
speedIndicator?.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    setGameSpeed(Math.max(1, gameSpeed - 1) as GameSpeed);
}, { signal: moduleListeners.signal });

document.getElementById('hud-menu-btn')?.addEventListener('click', (e) => {
    // Drop focus so Space/Enter don't re-activate the button behind the overlay
    (e.currentTarget as HTMLElement).blur();
    togglePause();
}, { signal: moduleListeners.signal });

// Restart button
document.getElementById('restart-btn')?.addEventListener('click', () => {
    location.reload();
}, { signal: moduleListeners.signal });

// Play Again: reload for a clean slate (renderer, worker, input) and start the same setup at once
document.getElementById('play-again-btn')?.addEventListener('click', () => {
    if (lastSkirmishConfig) saveRematchConfig(getSafeSessionStorage(), lastSkirmishConfig);
    location.reload();
}, { signal: moduleListeners.signal });

document.getElementById('spectate-btn')?.addEventListener('click', spectateAfterDefeat, { signal: moduleListeners.signal });

// Initialize skirmish UI
populateAiImplementationSelects();
restoreSkirmishMenuSettings();
setupSkirmishUI();
setupSkirmishPersistence();
setupGraphicsModeSelect();
setupWheelModeSelect();
enhanceSkirmishSetup(aiImplementationOptions);

// "Play Again" from the previous page: start that skirmish straight away (after this module has
// finished initialising). Not after a hot reload, which restores its own game.
{
    const rematch = import.meta.hot?.data?.gameState ? null : takeRematchConfig(getSafeSessionStorage());
    if (rematch) {
        lastSkirmishConfig = rematch;
        setTimeout(() => startGameWithConfig(rematch), 0);
    }
}

// Helper to reconstruct Vector objects from plain {x, y} when loading game state
function reconstructVectors(state: GameState): GameState {
    // Helper to convert plain object to Vector
    const toVec = (v: { x: number; y: number } | null | undefined): Vector | null => {
        if (!v || typeof v.x !== 'number' || typeof v.y !== 'number') return null;
        return new Vector(v.x, v.y);
    };

    // Deep clone and reconstruct vectors
    const entities: Record<EntityId, Entity> = {};
    for (const id in state.entities) {
        const e = state.entities[id];

        // Base entity properties
        const baseEntity = {
            ...e,
            pos: new Vector(e.pos.x, e.pos.y),
            prevPos: new Vector(e.prevPos.x, e.prevPos.y)
        };

        if (isUnit(e)) {
            // Reconstruct movement component vectors
            const movement = e.movement;
            const reconstructedMovement = {
                ...movement,
                vel: new Vector(movement.vel.x, movement.vel.y),
                moveTarget: toVec(movement.moveTarget),
                finalDest: toVec(movement.finalDest),
                unstuckDir: toVec(movement.unstuckDir),
                path: movement.path ? movement.path.map((p: { x: number, y: number }) => new Vector(p.x, p.y)) : null,
                avgVel: movement.avgVel ? new Vector(movement.avgVel.x, movement.avgVel.y) : undefined
            };

            // Reconstruct combat component vectors
            const combat = e.combat;
            const reconstructedCombat = {
                ...combat,
                attackMoveTarget: toVec(combat.attackMoveTarget),
                stanceHomePos: toVec(combat.stanceHomePos)
            };

            if (isHarvester(e)) {
                // Harvester unit - reconstruct harvester component vectors
                const harvester = e.harvester;
                const reconstructedHarvester = {
                    ...harvester,
                    dockPos: harvester.dockPos ? new Vector(harvester.dockPos.x, harvester.dockPos.y) : undefined
                };
                entities[id] = {
                    ...baseEntity,
                    type: 'UNIT',
                    key: 'harvester',
                    movement: reconstructedMovement,
                    combat: reconstructedCombat,
                    harvester: reconstructedHarvester
                } as HarvesterUnit;
            } else if ((e as AirUnit).airUnit) {
                // Air unit (harrier)
                entities[id] = {
                    ...baseEntity,
                    type: 'UNIT',
                    key: e.key,
                    movement: reconstructedMovement,
                    combat: reconstructedCombat,
                    airUnit: (e as AirUnit).airUnit
                } as AirUnit;
            } else {
                // Combat unit
                entities[id] = {
                    ...baseEntity,
                    type: 'UNIT',
                    key: e.key,
                    movement: reconstructedMovement,
                    combat: reconstructedCombat,
                    engineer: (e as CombatUnit).engineer
                } as CombatUnit;
            }
        } else if (isBuilding(e)) {
            // Reconstruct building state vectors (rallyPoint is in building component)
            const building = e.building;
            const reconstructedBuilding = building ? {
                ...building,
                rallyPoint: toVec(building.rallyPoint)
            } : { isRepairing: false };

            // Building entity
            entities[id] = {
                ...baseEntity,
                type: 'BUILDING',
                key: e.key,
                building: reconstructedBuilding,
                combat: e.combat,
                airBase: e.airBase,
                inductionRig: e.inductionRig
            } as BuildingEntity;
        } else {
            // Resource, Rock, or Well entity - no additional Vector components
            entities[id] = baseEntity as Entity;
        }
    }

    return {
        ...state,
        entities,
        camera: { x: state.camera.x, y: state.camera.y }
    };
}

function startGameWithConfig(config: SkirmishConfig) {
    hideMenu();

    // AI state is module-level and keyed by player slot; drop anything left over
    // from a previous skirmish so stale strategies, groups and ticks don't carry over.
    resetAIState();
    resetAIImplementations();
    controlGroups = new Map();
    lastGroupRecall = null;
    resetAlerts();
    lastAlertedNotification = null;
    wasLowPower = false;
    humanDefeatShown = false;
    lastButtonsTick = -1;
    lastButtonsTimeMs = -Infinity;

    // Generate map
    const { entities, mapWidth, mapHeight } = generateMap(config);

    // Determine human player
    const humanPlayer = config.players.find(p => p.type === 'human');
    humanPlayerId = humanPlayer ? humanPlayer.slot : null;

    // Create player states
    const players: Record<number, PlayerState> = {};
    config.players.forEach(p => {
        const isAi = p.type !== 'human';
        const difficulty = (p.type === 'human' ? 'medium' : p.type) as 'dummy' | 'easy' | 'medium' | 'hard';
        const aiImplementationId = p.aiImplementationId || DEFAULT_AI_IMPLEMENTATION_ID;
        players[p.slot] = createPlayerState(p.slot, isAi, difficulty, p.color, aiImplementationId, p.team ?? null);
    });

    // Get starting positions
    const positions = getStartingPositions(mapWidth, mapHeight, config.players.length);

    // Create base entities for each player
    config.players.forEach((p, idx) => {
        const pos = positions[idx];

        // Construction Yard
        const cyId = `cy_p${p.slot}`;
        const conyardEntity: BuildingEntity = {
            id: cyId, owner: p.slot, type: 'BUILDING', key: 'conyard',
            pos: pos, prevPos: pos,
            hp: 3000, maxHp: 3000, w: 90, h: 90, radius: 45, dead: false,
            building: {
                isRepairing: false,
                placedTick: 0
            }
        };
        entities[cyId] = conyardEntity;

        // Harvester
        const harvId = `harv_p${p.slot}`;
        const harvPos = pos.add(new Vector(80, 50));
        const harvesterEntity: HarvesterUnit = {
            id: harvId, owner: p.slot, type: 'UNIT', key: 'harvester',
            pos: harvPos, prevPos: harvPos,
            hp: 1000, maxHp: 1000, w: 35, h: 35, radius: 17, dead: false,
            movement: {
                vel: new Vector(0, 0),
                rotation: 0,
                moveTarget: null,
                path: null,
                pathIdx: 0,
                finalDest: null,
                stuckTimer: 0,
                unstuckDir: null,
                unstuckTimer: 0
            },
            combat: {
                targetId: null,
                lastAttackerId: null,
                cooldown: 0,
                flash: 0,
                turretAngle: 0
            },
            harvester: {
                cargo: 0,
                resourceTargetId: null,
                baseTargetId: null
            }
        };
        entities[harvId] = harvesterEntity;
    });

    // Initialize fog of war for human player only
    const fogOfWar: Record<number, Uint8Array> = {};
    if (humanPlayerId !== null && config.fogOfWarEnabled !== false) {
        fogOfWar[humanPlayerId] = createFogGrid(mapWidth, mapHeight);
    }

    // Build game state
    const isObserverMode = humanPlayerId === null;
    const state: GameState = {
        ...INITIAL_STATE,
        running: true,
        mode: isObserverMode ? 'demo' : 'game',
        difficulty: 'easy', // Legacy field
        entities: entities,
        players: players,
        fogOfWar,
        config: {
            width: mapWidth,
            height: mapHeight,
            resourceDensity: config.resourceDensity,
            rockDensity: config.rockDensity
        }
    };

    currentState = state;

    // Center camera on human player's starting position
    if (humanPlayerId !== null) {
        const humanIndex = config.players.findIndex(p => p.slot === humanPlayerId);
        if (humanIndex >= 0 && humanIndex < positions.length) {
            const startPos = positions[humanIndex];
            // Center the camera on the player's base
            currentState = {
                ...currentState,
                camera: {
                    x: startPos.x - renderer.getSize().width / 2,
                    y: startPos.y - renderer.getSize().height / 2
                }
            };
        }
    }

    // Set up callback for loading game state from debug UI
    setLoadGameStateCallback((loadedState) => {
        // Reconstruct Vector objects from plain {x, y} objects
        currentState = reconstructVectors(loadedState);
        // Hover/render queries read the global spatial grid, which is otherwise only rebuilt on tick
        rebuildSpatialGrid(currentState.entities);
        updateButtonsUI();
    });

    // Set up callback for closing debug UI (same as pressing F3)
    setCloseDebugCallback(() => {
        currentState = update(currentState, { type: 'TOGGLE_DEBUG' });
        updateButtonsUI();
    });

    // Initialize pathfinding web worker (async, will fall back to sync until ready)
    initPathfindingWorker(mapWidth, mapHeight).catch(err => {
        console.warn('[PathWorker] Failed to initialize:', err);
    });

    // Initialize UI
    initUI(currentState, handleBuildClick, handleToggleSellMode, handleToggleRepairMode, handleCancelBuild, handleDequeueUnit);
    initMinimap();
    initScoreboard();
    initBirdsEye();
    initCommandBar(
        (stance) => {
            if (currentState.selection.length > 0) {
                currentState = update(currentState, {
                    type: 'SET_STANCE',
                    payload: { unitIds: currentState.selection, stance }
                });
                updateButtonsUI();
            }
        },
        () => {
            currentState = update(currentState, { type: 'TOGGLE_ATTACK_MOVE_MODE' });
            updateButtonsUI();
        },
        () => {
            currentState = update(currentState, {
                type: 'COMMAND_UNGARRISON',
                payload: { unitIds: currentState.selection }
            });
            updateButtonsUI();
        }
    );

    // Initialize pause menu
    initPauseMenu(
        resumeGame,
        () => {
            // Quit - reload page
            location.reload();
        }
    );

    // Set observer mode if all players are AI
    setObserverMode(isObserverMode);
    renderer.resize();

    if (isObserverMode) {
        const size = renderer.getSize();
        const mapWidth = currentState.config.width;
        const mapHeight = currentState.config.height;
        const observerZoom = getMinZoom(size.width, size.height, mapWidth, mapHeight); // Fully zoomed out

        const centeredX = mapWidth / 2 - size.width / (2 * observerZoom);
        const centeredY = mapHeight / 2 - size.height / (2 * observerZoom);

        currentState = {
            ...currentState,
            zoom: observerZoom,
            camera: clampCamera(centeredX, centeredY, size.width, size.height, observerZoom, mapWidth, mapHeight)
        };
    }

    // Initialize input
    initInput(canvas, createInputCallbacks());

    // Set up minimap click handler to pan camera
    setMinimapClickHandler((worldX, worldY) => {
        centerCameraOn(worldX, worldY);
    });

    // Minimap orders: right-click moves (or sets a rally point / cancels a mode like
    // on the map), and left-click in attack-move mode attack-moves. Always a ground order.
    setMinimapCommandHandler((worldX, worldY, button) => {
        if (currentState.mode !== 'game') return false;
        if (button === 0 && !currentState.attackMoveMode) return false;
        handleRightClick(worldX, worldY, true);
        return true;
    });

    // Set up bird's eye view click handler to pan camera and close
    setBirdsEyeClickHandler((worldX, worldY) => {
        centerCameraOn(worldX, worldY);
    });

    // Set up bird's eye close handler
    setBirdsEyeCloseHandler(() => {
        currentState = update(currentState, { type: 'TOGGLE_BIRDS_EYE' });
    });

    // Start game loop
    gameLoop();
}

function pauseGame() {
    if (currentState.mode !== 'game' && currentState.mode !== 'demo') return;
    if (!currentState.running) return; // Nothing to pause once the game is over
    prePauseMode = currentState.mode;
    currentState = { ...currentState, mode: 'paused' };
    showPauseMenu();
}

function resumeGame() {
    if (currentState.mode === 'paused' && prePauseMode) {
        currentState = { ...currentState, mode: prePauseMode };
        prePauseMode = null;
    }
    hidePauseMenu();
}

function togglePause() {
    if (currentState.mode === 'paused') {
        resumeGame();
    } else {
        pauseGame();
    }
}

// Control groups: Ctrl/Cmd+digit assigns, Shift+digit adds, digit recalls (twice quickly = jump camera)
const CONTROL_GROUP_DOUBLE_TAP_MS = 400;
let controlGroups = new Map<number, EntityId[]>();
let lastGroupRecall: { group: number; timeMs: number } | null = null;

function handleControlGroup(group: number, action: 'recall' | 'assign' | 'add') {
    if (currentState.mode !== 'game' || humanPlayerId === null) return;

    const isOwnedAlive = (id: EntityId) => {
        const e = currentState.entities[id];
        return !!e && !e.dead && e.owner === humanPlayerId;
    };

    if (action === 'assign' || action === 'add') {
        const base = action === 'add' ? (controlGroups.get(group) ?? []).filter(isOwnedAlive) : [];
        const members = [...new Set([...base, ...currentState.selection.filter(isOwnedAlive)])];
        if (members.length === 0 || (action === 'add' && members.length === base.length)) return;
        controlGroups.set(group, members);
        currentState = {
            ...currentState,
            notification: {
                text: action === 'add' ? `Group ${group}: added (${members.length} total)` : `Group ${group}: ${members.length} assigned`,
                type: 'info',
                tick: currentState.tick
            }
        };
        updateButtonsUI();
        return;
    }

    const members = (controlGroups.get(group) ?? []).filter(isOwnedAlive);
    controlGroups.set(group, members);
    if (members.length === 0) return;

    const now = performance.now();
    const isDoubleTap = lastGroupRecall?.group === group && now - lastGroupRecall.timeMs < CONTROL_GROUP_DOUBLE_TAP_MS;
    lastGroupRecall = { group, timeMs: now };

    currentState = update(currentState, { type: 'SELECT_UNITS', payload: members });
    if (isDoubleTap) {
        let cx = 0, cy = 0;
        for (const id of members) {
            cx += currentState.entities[id].pos.x;
            cy += currentState.entities[id].pos.y;
        }
        centerCameraOn(cx / members.length, cy / members.length);
    }
    updateButtonsUI();
}

function centerCameraOn(worldX: number, worldY: number) {
    const size = renderer.getSize();
    const zoom = currentState.zoom;
    currentState = {
        ...currentState,
        camera: clampCamera(worldX - size.width / zoom / 2, worldY - size.height / zoom / 2,
            size.width, size.height, zoom, currentState.config.width, currentState.config.height)
    };
}

function createInputCallbacks(): Parameters<typeof initInput>[1] {
    return {
        onLeftClick: handleLeftClick,
        onRightClick: handleRightClick,
        onDeployMCV: attemptMCVDeploy,
        onToggleDebug: () => {
            currentState = update(currentState, { type: 'TOGGLE_DEBUG' });
            updateButtonsUI();
        },
        onToggleMinimap: () => {
            if (currentState.mode === 'demo') {
                currentState = update(currentState, { type: 'TOGGLE_MINIMAP' });
            }
        },
        onToggleBirdsEye: () => {
            currentState = update(currentState, { type: 'TOGGLE_BIRDS_EYE' });
        },
        onAdjustSpeed: (delta) => {
            setGameSpeed(Math.max(1, Math.min(5, gameSpeed + delta)) as GameSpeed);
        },
        onControlGroup: handleControlGroup,
        onSetStance: (stance) => {
            if (currentState.selection.length > 0) {
                currentState = update(currentState, {
                    type: 'SET_STANCE',
                    payload: { unitIds: currentState.selection, stance }
                });
                updateButtonsUI();
            }
        },
        onToggleAttackMove: () => {
            if (currentState.mode !== 'game') return;
            // Nothing to order: don't arm a mode that would swallow the next click
            // (attack-move only commands ground units other than harvesters and MCVs)
            const hasUnits = getCommandableSelection().some(id => {
                const e = currentState.entities[id];
                return e?.type === 'UNIT' && e.key !== 'harvester' && e.key !== 'mcv' && !isAirUnit(e);
            });
            if (!currentState.attackMoveMode && !hasUnits) return;
            currentState = update(currentState, { type: 'TOGGLE_ATTACK_MOVE_MODE' });
            updateButtonsUI();
        },
        onUngarrison: () => {
            currentState = update(currentState, {
                type: 'COMMAND_UNGARRISON',
                payload: { unitIds: currentState.selection }
            });
            updateButtonsUI();
        },
        onStop: () => {
            if (currentState.mode !== 'game') return;
            const unitIds = getCommandableSelection();
            if (unitIds.length === 0) return;
            currentState = update(currentState, { type: 'COMMAND_STOP', payload: { unitIds } });
            updateButtonsUI();
        },
        onSelectArmy: () => {
            if (currentState.mode !== 'game' || humanPlayerId === null) return;
            const army = Object.values(currentState.entities)
                .filter(e => isArmyUnit(e, humanPlayerId!))
                .map(e => e.id);
            if (army.length === 0) return;
            currentState = update(currentState, { type: 'SELECT_UNITS', payload: army });
            updateButtonsUI();
        },
        onCenterOnSelection: () => {
            if (currentState.mode !== 'game') return;
            const selected = currentState.selection.map(id => currentState.entities[id]).filter(e => e && !e.dead);
            if (selected.length === 0) return;
            centerCameraOn(
                selected.reduce((sum, e) => sum + e.pos.x, 0) / selected.length,
                selected.reduce((sum, e) => sum + e.pos.y, 0) / selected.length
            );
        },
        onToggleGraphics: toggleGraphicsMode,
        onCancel: handleCancel,
        onTogglePause: togglePause,
        isPaused: () => currentState.mode === 'paused',
        onTap: handleTap,
        onClearSelection: () => {
            if (currentState.mode !== 'game') return;
            currentState = update(currentState, { type: 'SELECT_UNITS', payload: [] });
            updateButtonsUI();
        },
        onDoubleClick: handleDoubleClick,
        getZoom: () => currentState.zoom,
        getCamera: () => currentState.camera
    };
}

function handleBuildClick(category: string, key: string, count: number = 1) {
    if (currentState.mode === 'demo') return;
    if (humanPlayerId === null) return;

    if (category === 'building') {
        const player = currentState.players[humanPlayerId];
        const inProgress = player.queues.building.current ?? player.readyToPlace;
        if (inProgress && inProgress !== key) {
            const name = RULES.buildings[inProgress]?.name ?? inProgress;
            pushAlert(player.readyToPlace
                ? `Place your ${name} first (or right-click its button to cancel)`
                : `Already building ${name} - one structure at a time`, 'warning', 'build-busy', 1000);
            return;
        }
        if (player.readyToPlace === key) {
            // Exit sell/repair mode when entering placement mode
            currentState = {
                ...currentState,
                placingBuilding: key,
                sellMode: false,
                repairMode: false
            };
        } else {
            currentState = update(currentState, { type: 'START_BUILD', payload: { category, key, playerId: humanPlayerId } });
        }
    } else {
        // Units use the queue system
        currentState = update(currentState, { type: 'QUEUE_UNIT', payload: { category, key, playerId: humanPlayerId, count } });
    }

    updateButtonsUI();
}

function handleToggleSellMode() {
    if (currentState.mode === 'demo') return;
    currentState = update(currentState, { type: 'TOGGLE_SELL_MODE' });
    updateButtonsUI();
}

function handleToggleRepairMode() {
    if (currentState.mode === 'demo') return;
    currentState = update(currentState, { type: 'TOGGLE_REPAIR_MODE' });
    updateButtonsUI();
}

function handleCancelBuild(category: string) {
    if (currentState.mode === 'demo') return;
    if (humanPlayerId === null) return;
    currentState = update(currentState, {
        type: 'CANCEL_BUILD',
        payload: { category, playerId: humanPlayerId }
    });
    updateButtonsUI();
}

function handleDequeueUnit(category: string, key: string, count: number) {
    if (currentState.mode === 'demo') return;
    if (humanPlayerId === null) return;
    currentState = update(currentState, {
        type: 'DEQUEUE_UNIT',
        payload: { category, key, playerId: humanPlayerId, count }
    });
    updateButtonsUI();
}

function handleLeftClick(wx: number, wy: number, isDrag: boolean, dragRect?: { x1: number; y1: number; x2: number; y2: number }) {
    // Debug Mode - copy clicked entity as JSON (works in any mode)
    if (currentState.debugMode && !isDrag) {
        const entityList = Object.values(currentState.entities);
        const clicked = entityList.find(e =>
            !e.dead && e.pos.dist(new Vector(wx, wy)) < e.radius + 20
        );
        if (clicked) {
            const json = JSON.stringify(clicked);
            navigator.clipboard.writeText(json).then(() => {
                console.log(`[DEBUG] Copied entity ${clicked.id} to clipboard`);
            }).catch(err => {
                console.error('[DEBUG] Failed to copy to clipboard:', err);
            });
        }
        return;
    }

    if (currentState.mode !== 'game') return;

    // Attack-move mode: a left-click issues the order (A, then click - as in most RTS games);
    // a drag still box-selects (and leaves the mode)
    if (currentState.attackMoveMode && isDrag) {
        currentState = update(currentState, { type: 'TOGGLE_ATTACK_MOVE_MODE' });
    } else if (currentState.attackMoveMode) {
        currentState = update(currentState, {
            type: 'COMMAND_ATTACK_MOVE',
            payload: { unitIds: getCommandableSelection(), x: wx, y: wy }
        });
        updateButtonsUI();
        return;
    }

    // Sell Mode: the first click names the building and its refund, a second click on it sells.
    // Sell mode then ends, unless Shift is held to keep selling.
    if (currentState.sellMode) {
        if (humanPlayerId === null) return;
        const clicked = pickEntityAt(currentState.entities, wx, wy, e => e.owner === humanPlayerId && isBuilding(e));
        if (!clicked || !isBuilding(clicked)) return;
        const now = performance.now();
        if (pendingSell && pendingSell.id === clicked.id && now < pendingSell.until) {
            pendingSell = null;
            currentState = update(currentState, {
                type: 'SELL_BUILDING',
                payload: { buildingId: clicked.id, playerId: humanPlayerId }
            });
            if (!getInputState().keys['Shift'] && currentState.sellMode) {
                currentState = update(currentState, { type: 'TOGGLE_SELL_MODE' });
            }
            updateButtonsUI();
        } else {
            pendingSell = { id: clicked.id, until: now + SELL_CONFIRM_MS };
            const data = RULES.buildings[clicked.key];
            const refund = Math.floor((data?.cost ?? 0) * (RULES.economy?.sellBuildingReturnPercentage || 0.5) * (clicked.hp / clicked.maxHp));
            pushAlert(`Sell ${data?.name ?? clicked.key} for $${refund}? ${IS_TOUCH ? 'Tap' : 'Click'} it again to confirm`, 'warning');
        }
        return;
    }

    // Repair Mode
    if (currentState.repairMode) {
        if (humanPlayerId === null) return;
        const clicked = pickEntityAt(currentState.entities, wx, wy, e => e.owner === humanPlayerId && isBuilding(e));
        if (clicked && isBuilding(clicked)) {
            // Toggle repair on/off for this building
            if (clicked.building.isRepairing) {
                currentState = update(currentState, {
                    type: 'STOP_REPAIR',
                    payload: { buildingId: clicked.id, playerId: humanPlayerId }
                });
            } else {
                currentState = update(currentState, {
                    type: 'START_REPAIR',
                    payload: { buildingId: clicked.id, playerId: humanPlayerId }
                });
            }
            updateButtonsUI();
        }
        return;
    }

    // Building placement
    if (currentState.placingBuilding) {
        if (humanPlayerId === null) return;
        currentState = update(currentState, {
            type: 'PLACE_BUILDING',
            payload: { key: currentState.placingBuilding, x: wx, y: wy, playerId: humanPlayerId }
        });
        updateButtonsUI();
        return;
    }

    // Selection with shift-click support
    const inputState = getInputState();
    const shiftHeld = inputState.keys['Shift'];

    // Start with existing selection if shift is held
    let newSelection: EntityId[] = shiftHeld ? [...currentState.selection] : [];

    if (isDrag && dragRect) {
        for (const id in currentState.entities) {
            const e = currentState.entities[id];
            if (humanPlayerId !== null && e.owner === humanPlayerId && isUnit(e) && !e.dead &&
                !isTransportedUnit(e) &&
                e.pos.x > dragRect.x1 && e.pos.x < dragRect.x2 &&
                e.pos.y > dragRect.y1 && e.pos.y < dragRect.y2) {
                // Add to selection if not already selected
                if (!newSelection.includes(e.id)) {
                    newSelection.push(e.id);
                }
            }
        }
    } else {
        const clicked = humanPlayerId === null
            ? null
            : pickEntityAt(currentState.entities, wx, wy, e => e.owner === humanPlayerId);
        if (clicked) {
            // Check if clicking on already selected MCV -> Deploy
            if (clicked.type === 'UNIT' && clicked.key === 'mcv' && currentState.selection.includes(clicked.id)) {
                attemptMCVDeploy();
                return;
            }

            if (shiftHeld) {
                // Shift-click: toggle selection
                if (newSelection.includes(clicked.id)) {
                    // Remove from selection
                    newSelection = newSelection.filter(id => id !== clicked.id);
                } else {
                    // Add to selection
                    newSelection.push(clicked.id);
                }
            } else {
                // Regular click: replace selection
                newSelection = [clicked.id];
            }
        } else if (!shiftHeld && humanPlayerId !== null) {
            // Nothing of ours here: an enemy, allied or neutral unit/building can be inspected
            const other = pickEntityAt(currentState.entities, wx, wy, e =>
                (e.type === 'UNIT' || e.type === 'BUILDING') && e.owner !== humanPlayerId &&
                !isHiddenByFog(currentState, e, humanPlayerId));
            if (other) {
                currentState = update(currentState, { type: 'INSPECT_ENTITY', payload: other.id });
                updateButtonsUI();
                return;
            }
        }
    }

    currentState = update(currentState, { type: 'SELECT_UNITS', payload: newSelection });
    updateButtonsUI();
}

// Escape: close the pause menu, else back out of the active mode (sell, repair, placement,
// attack-move), else clear the selection, else open the pause menu
function handleCancel() {
    if (isHelpVisible()) {
        closeHelp();
        return;
    }
    if (currentState.mode === 'paused') {
        resumeGame();
        return;
    }
    if (currentState.mode === 'demo') {
        pauseGame();
        return;
    }
    if (currentState.mode !== 'game') return;

    if (currentState.sellMode) {
        currentState = update(currentState, { type: 'TOGGLE_SELL_MODE' });
    } else if (currentState.repairMode) {
        currentState = update(currentState, { type: 'TOGGLE_REPAIR_MODE' });
    } else if (currentState.placingBuilding) {
        currentState = update(currentState, { type: 'CANCEL_PLACEMENT' });
    } else if (currentState.attackMoveMode) {
        currentState = update(currentState, { type: 'TOGGLE_ATTACK_MOVE_MODE' });
    } else if (currentState.selection.length > 0 || currentState.inspectedId) {
        currentState = update(currentState, { type: 'SELECT_UNITS', payload: [] });
    } else {
        pauseGame();
        return;
    }
    updateButtonsUI();
}

/**
 * Touch has no right button: a tap selects your own unit (or a building when nothing is selected),
 * and anywhere else it commands the current selection, like a right-click.
 */
function handleTap(wx: number, wy: number) {
    if (currentState.mode !== 'game' || humanPlayerId === null) return;
    if (currentState.sellMode || currentState.repairMode || currentState.placingBuilding || currentState.attackMoveMode) {
        handleLeftClick(wx, wy, false);
        return;
    }
    const own = pickEntityAt(currentState.entities, wx, wy, e => e.owner === humanPlayerId);
    // Only selected units take tap-orders; a selected building is just "what you're looking at",
    // except a Barracks/Factory, where a tap on the ground sets its rally point
    const selection = getCommandableSelection();
    const hasUnits = selection.some(id => currentState.entities[id]?.type === 'UNIT');
    const isRallyBuilding = selection.length === 1 && ['barracks', 'factory'].includes(currentState.entities[selection[0]]?.key ?? '');
    const commands = hasUnits || (isRallyBuilding && !own);
    // Tapping your own transport with infantry selected loads them, like a right-click
    const loadsTransport = !!own && !selection.includes(own.id) && isGarrisonableTransport(own) &&
        selection.some(id => isInfantryUnit(currentState.entities[id]));
    if (!commands || (own && own.type === 'UNIT' && !loadsTransport)) {
        handleLeftClick(wx, wy, false);
    } else {
        handleRightClick(wx, wy);
    }
}

/** Selected entities that can take orders (alive, not riding inside a transport). */
function getCommandableSelection(): EntityId[] {
    return currentState.selection.filter(id => {
        const entity = currentState.entities[id];
        if (!entity || entity.dead) return false;
        return entity.type !== 'UNIT' || !isTransportedUnit(entity);
    });
}

function handleRightClick(wx: number, wy: number, groundOnly = false) {
    if (currentState.mode !== 'game') return;

    // Cancel sell mode
    if (currentState.sellMode) {
        currentState = update(currentState, { type: 'TOGGLE_SELL_MODE' });
        updateButtonsUI();
        return;
    }

    // Cancel repair mode
    if (currentState.repairMode) {
        currentState = update(currentState, { type: 'TOGGLE_REPAIR_MODE' });
        updateButtonsUI();
        return;
    }

    // Cancel placement mode (but keep building ready to place)
    if (currentState.placingBuilding) {
        currentState = update(currentState, { type: 'CANCEL_PLACEMENT' });
        updateButtonsUI();
        return;
    }

    const selectedCommandIds = getCommandableSelection();

    // Cancel attack-move mode if active (but still process the command)
    if (currentState.attackMoveMode) {
        currentState = update(currentState, {
            type: 'COMMAND_ATTACK_MOVE',
            payload: { unitIds: selectedCommandIds, x: wx, y: wy }
        });
        // attackMoveMode is cleared by the reducer
        return;
    }

    // Check if a production building is selected - set rally point
    // Only barracks and factory can have rally points (not refinery or airforce_command)
    const RALLY_POINT_BUILDINGS = ['barracks', 'factory'];
    const selectedIds = selectedCommandIds;
    if (selectedIds.length === 1) {
        const selectedEntity = currentState.entities[selectedIds[0]];
        if (selectedEntity && selectedEntity.type === 'BUILDING' && selectedEntity.owner === humanPlayerId) {
            if (RALLY_POINT_BUILDINGS.includes(selectedEntity.key)) {
                // This is a production building - set rally point
                currentState = update(currentState, {
                    type: 'SET_RALLY_POINT',
                    payload: { buildingId: selectedIds[0], x: wx, y: wy }
                });
                updateButtonsUI();
                return;
            }
        }
    }

    // Find target
    // Unexplored fog hides its entities from clicks too (right-clicking there just moves)
    // (Minimap orders are always ground orders - a dot is too small to target.)
    const targetId: EntityId | null = groundOnly ? null : pickEntityAt(currentState.entities, wx, wy,
        e => !isHiddenByFog(currentState, e, humanPlayerId))?.id ?? null;

    // Issue commands
    if (selectedIds.length === 0) return;

    // Special handling for Induction Rig: deploy on wells
    if (targetId) {
        const targetEntity = currentState.entities[targetId];
        if (targetEntity && isWell(targetEntity)) {
            // Check if we have an Induction Rig selected
            const selectedRigId = selectedIds.find(id => {
                const ent = currentState.entities[id];
                return ent && ent.owner === humanPlayerId && isInductionRig(ent);
            });

            if (selectedRigId) {
                // Deploys now if close enough, otherwise drives there and deploys on arrival
                currentState = update(currentState, {
                    type: 'COMMAND_DEPLOY_RIG',
                    payload: { unitId: selectedRigId, wellId: targetId }
                });
                return;
            }
        }
    }

    // Special handling for Air-Force Command: launch all docked harriers with ammo
    if (targetId) {
        const harrierIds: EntityId[] = [];
        for (const id of selectedIds) {
            const entity = currentState.entities[id];
            if (entity && entity.type === 'BUILDING' && entity.key === 'airforce_command' && isBuilding(entity) && entity.airBase) {
                // Find all docked harriers with ammo in this air base
                for (const slotId of entity.airBase.slots) {
                    if (slotId) {
                        const harrier = currentState.entities[slotId];
                        if (harrier && !harrier.dead && isAirUnit(harrier) &&
                            harrier.airUnit.state === 'docked' && harrier.airUnit.ammo > 0) {
                            harrierIds.push(slotId);
                        }
                    }
                }
            }
        }

        // If we have harriers to launch, issue attack command for them
        if (harrierIds.length > 0) {
            currentState = update(currentState, {
                type: 'COMMAND_ATTACK',
                payload: { unitIds: harrierIds, targetId }
            });
        } else {
            // Normal attack command for other units
            currentState = update(currentState, {
                type: 'COMMAND_ATTACK',
                payload: { unitIds: selectedIds, targetId, x: wx, y: wy }
            });
        }
    } else {
        currentState = update(currentState, {
            type: 'COMMAND_MOVE',
            payload: { unitIds: selectedIds, x: wx, y: wy }
        });
    }
}

function attemptMCVDeploy() {
    if (humanPlayerId === null) return;

    // Find selected MCV owned by human player
    const selectedMCVId = currentState.selection.find(id => {
        const ent = currentState.entities[id];
        return ent && ent.owner === humanPlayerId && ent.type === 'UNIT' && ent.key === 'mcv';
    });

    if (selectedMCVId) {
        currentState = update(currentState, {
            type: 'DEPLOY_MCV',
            payload: { unitId: selectedMCVId }
        });
        updateButtonsUI();
    }
}

// Buildings that can be set as primary for production
const PRIMARY_BUILDING_MAP: Record<string, 'infantry' | 'vehicle'> = {
    'barracks': 'infantry',
    'factory': 'vehicle'
};

/** Own fighting units: not harvesters, MCVs, engineers or other support units, and not inside a transport. */
function isArmyUnit(e: Entity, owner: number): boolean {
    if (e.type !== 'UNIT' || e.dead || e.owner !== owner || isTransportedUnit(e)) return false;
    if (isAirUnit(e) && e.airUnit.state === 'docked') return false;
    if (NON_ARMY_UNITS.has(e.key)) return false;
    const data = RULES.units[e.key];
    return !!data && isUnitData(data) && data.damage > 0;
}
const NON_ARMY_UNITS = new Set(['harvester', 'mcv', 'induction_rig', 'engineer']);

function handleDoubleClick(wx: number, wy: number) {
    if (humanPlayerId === null || currentState.mode !== 'game') return;
    // In a click mode the clicks belong to that mode
    if (currentState.sellMode || currentState.repairMode || currentState.placingBuilding || currentState.attackMoveMode) return;

    // Double-click on one of your units: select every unit of that type on screen
    const clickedUnit = pickEntityAt(currentState.entities, wx, wy, e => e.type === 'UNIT' && e.owner === humanPlayerId);
    if (clickedUnit && clickedUnit.key !== 'mcv') {
        const size = renderer.getSize();
        const { x: camX, y: camY } = currentState.camera;
        const zoom = currentState.zoom;
        const sameType = Object.values(currentState.entities)
            .filter(e => e.type === 'UNIT' && !e.dead && e.owner === humanPlayerId && e.key === clickedUnit.key && !isTransportedUnit(e) &&
                e.pos.x >= camX && e.pos.x <= camX + size.width / zoom && e.pos.y >= camY && e.pos.y <= camY + size.height / zoom)
            .map(e => e.id);
        currentState = update(currentState, { type: 'SELECT_UNITS', payload: sameType.length > 0 ? sameType : [clickedUnit.id] });
        updateButtonsUI();
        return;
    }

    // Check if double-clicked on a production building owned by human player
    for (const id in currentState.entities) {
        const entity = currentState.entities[id];
        if (entity.type !== 'BUILDING' || entity.owner !== humanPlayerId || entity.dead) continue;

        const category = PRIMARY_BUILDING_MAP[entity.key];
        if (!category) continue;

        // Check if click is within building bounds
        const dx = Math.abs(wx - entity.pos.x);
        const dy = Math.abs(wy - entity.pos.y);
        if (dx <= entity.w / 2 && dy <= entity.h / 2) {
            // Set this building as primary
            currentState = update(currentState, {
                type: 'SET_PRIMARY_BUILDING',
                payload: { buildingId: id, category, playerId: humanPlayerId }
            });
            updateButtonsUI();
            return;
        }
    }

    // No production building clicked - try to deploy MCV
    attemptMCVDeploy();
}

function updateButtonsUI() {
    // A half-confirmed sale is forgotten once sell mode ends
    if (!currentState.sellMode) pendingSell = null;
    // Use human player's UI, or first player if observer
    const pid = humanPlayerId !== null ? humanPlayerId : Object.keys(currentState.players).map(Number)[0];
    const player = currentState.players[pid];
    if (!player) return;

    updateButtons(
        currentState.entities,
        player.queues,
        player.readyToPlace,
        currentState.placingBuilding,
        pid,
        player.credits
    );
    updateSellModeUI(currentState);
    updateRepairModeUI(currentState);
    updateCommandBar(currentState);

    // Update status message from notification
    if (currentState.notification) {
        setStatusMessage(currentState.notification.text, currentState.notification.type);
    } else {
        // Clear message if no notification (or show default hint)
        setStatusMessage("");
    }
}

function gameLoop(timestamp: number = 0) {
    // Frame rate limiting - skip if not enough time has passed
    // rAF timestamps on a 60Hz display jitter around 16.67ms; without a tolerance roughly half of
    // the frames land just under FRAME_TIME and get skipped, producing 33ms hitches.
    const elapsed = timestamp - lastFrameTime;
    if (elapsed < FRAME_TIME - FRAME_TIME_TOLERANCE) {
        animationFrameId = requestAnimationFrame(gameLoop);
        return;
    }
    lastFrameTime = timestamp - (elapsed >= FRAME_TIME ? elapsed % FRAME_TIME : 0);

    const skipSim = !currentState.running;
    if (skipSim) {
        checkWinCondition();
        // Skip early return to allow panning and viewing the map after game ends
    }

    if (currentState.mode === 'paused' && !skipSim) {
        // Still render but don't update
        const input = getInputState();
        renderer.render(currentState, getDragSelection(), { x: input.mouse.x, y: input.mouse.y }, humanPlayerId, getMiddleMouseScrollOrigin());
        animationFrameId = requestAnimationFrame(gameLoop);
        return;
    }

    const frameStartMs = performance.now();
    const simStartMs = frameStartMs;
    const preSimState = currentState;

    if (currentState.debugMode || skipSim) {
        // Just render, don't update
    } else {
        // Determine how many ticks to run based on speed setting
        const ticksToRun = TICKS_PER_GAME_SPEED[gameSpeed];

        for (let t = 0; t < ticksToRun; t++) {
            if (t > 0 && performance.now() - simStartMs > SIM_FRAME_BUDGET_MS) break;
            currentState = applyAiActionsForTick(currentState, currentState.tick + t);

            currentState = update(currentState, { type: 'TICK' });
        }
    }
    const simMs = performance.now() - simStartMs;
    announceGameEvents(preSimState, currentState);
    checkHumanDefeat();

    // Reducer notifications (placement errors, deploy results...) also appear over the battlefield
    if (currentState.notification && currentState.notification !== lastAlertedNotification) {
        pushAlert(currentState.notification.text, currentState.notification.type);
    }
    lastAlertedNotification = currentState.notification ?? null;

    let uiMs = 0;
    const preRenderUiStartMs = performance.now();

    // Update UI - use human player's data, or first player if observer
    const displayPlayerId = humanPlayerId !== null ? humanPlayerId : Object.keys(currentState.players).map(Number)[0];
    const displayPlayer = currentState.players[displayPlayerId];

    // OPTIMIZATION: Cache power calculation - only recalculate every 5 ticks or when tick changes
    // Power only changes when buildings are built/destroyed, so no need to calculate every frame
    if (cachedPowerTick < 0 || cachedPowerPlayer !== displayPlayerId ||
        currentState.tick < cachedPowerTick || currentState.tick - cachedPowerTick >= POWER_RECALC_TICKS) {
        cachedPower = calculatePower(displayPlayerId, currentState.entities);
        cachedPowerTick = currentState.tick;
        cachedPowerPlayer = displayPlayerId;
    }

    if (displayPlayer) {
        updateMoney(displayPlayer.credits);
        updatePower(cachedPower.out, cachedPower.in);
    }

    const isLowPower = cachedPower.out < cachedPower.in;
    if (isLowPower && !wasLowPower && humanPlayerId !== null && currentState.mode === 'game') {
        pushAlert('Low power - production slowed. Build a Power Plant', 'warning', 'low-power', 30000);
    }
    wasLowPower = isLowPower;

    if (skipSim || shouldRunCadencedUpdate({
        currentTick: currentState.tick,
        currentTimeMs: timestamp,
        lastTick: lastButtonsTick,
        lastTimeMs: lastButtonsTimeMs,
        minTickDelta: BUTTONS_MIN_TICK_DELTA,
        minTimeDeltaMs: BUTTONS_MIN_TIME_DELTA_MS
    })) {
        updateButtonsUI();
        lastButtonsTick = currentState.tick;
        lastButtonsTimeMs = timestamp;
    }
    uiMs += performance.now() - preRenderUiStartMs;

    // Expose state for debugging
    window.GAME_STATE = currentState;


    // Camera & Zoom Input
    const input = getInputState();
    const renderStartMs = performance.now();

    const oldZoom = currentState.zoom;
    const zoomViewSize = renderer.getSize();
    const newZoom = handleZoomInput(oldZoom,
        getMinZoom(zoomViewSize.width, zoomViewSize.height, currentState.config.width, currentState.config.height));

    if (newZoom !== oldZoom) {
        // Zoom towards mouse
        const mouseX = input.mouse.x;
        const mouseY = input.mouse.y;

        const worldX = currentState.camera.x + mouseX / oldZoom;
        const worldY = currentState.camera.y + mouseY / oldZoom;

        const newCameraX = worldX - mouseX / newZoom;
        const newCameraY = worldY - mouseY / newZoom;

        const size = renderer.getSize();
        currentState = {
            ...currentState,
            zoom: newZoom,
            camera: clampCamera(newCameraX, newCameraY, size.width, size.height, newZoom, currentState.config.width, currentState.config.height)
        };
    }

    // Window resized: keep the world point at the centre of the view where it was (the camera is
    // top-left anchored, so otherwise the view grows and shrinks from the bottom-right corner)
    const viewSize = renderer.getSize();
    if (lastViewSize && (lastViewSize.width !== viewSize.width || lastViewSize.height !== viewSize.height)) {
        const zoom = currentState.zoom;
        currentState = {
            ...currentState,
            camera: {
                ...currentState.camera,
                x: currentState.camera.x + (lastViewSize.width - viewSize.width) / (2 * zoom),
                y: currentState.camera.y + (lastViewSize.height - viewSize.height) / (2 * zoom)
            }
        };
    }
    lastViewSize = viewSize;

    const newCamera = handleCameraInput(
        currentState.camera,
        currentState.zoom,
        renderer.getSize().width,
        renderer.getSize().height,
        currentState.config.width,
        currentState.config.height
    );
    currentState = { ...currentState, camera: newCamera };

    // Render
    renderer.render(currentState, getDragSelection(), { x: input.mouse.x, y: input.mouse.y }, humanPlayerId, getMiddleMouseScrollOrigin());

    // Update action cursor (shows move, attack, harvest, capture, deploy, repair, no-entry based on context)
    if (humanPlayerId !== null) {
        const mouseWorldX = currentState.camera.x + input.mouse.x / currentState.zoom;
        const mouseWorldY = currentState.camera.y + input.mouse.y / currentState.zoom;
        updateActionCursor(currentState, mouseWorldX, mouseWorldY, humanPlayerId);
    }
    const renderMs = performance.now() - renderStartMs;

    const postRenderUiStartMs = performance.now();
    // Minimap
    const size = renderer.getSize();
    const lowPower = cachedPower.out < cachedPower.in;
    if (skipSim || shouldRunCadencedUpdate({
        currentTick: currentState.tick,
        currentTimeMs: timestamp,
        lastTick: lastMinimapTick,
        lastTimeMs: lastMinimapTimeMs,
        minTickDelta: MINIMAP_MIN_TICK_DELTA,
        minTimeDeltaMs: MINIMAP_MIN_TIME_DELTA_MS
    })) {
        const fogGrid = humanPlayerId !== null ? currentState.fogOfWar?.[humanPlayerId] : undefined;
        const fogGridW = fogGrid ? Math.ceil(currentState.config.width / 40) : undefined;
        renderMinimap(
            currentState.entities,
            currentState.camera,
            currentState.zoom,
            size.width,
            size.height,
            lowPower,
            currentState.config.width,
            currentState.config.height,
            fogGrid,
            fogGridW
        );
        lastMinimapTick = currentState.tick;
        lastMinimapTimeMs = timestamp;
    }

    // Scoreboard
    updateScoreboard(currentState, timestamp);

    // Observer Minimap Toggle
    if (currentState.mode === 'demo') {
        const observerMinimap = document.getElementById('observer-minimap');
        if (observerMinimap) {
            observerMinimap.style.display = currentState.showMinimap ? 'block' : 'none';
        }
    }

    // Bird's Eye View
    if (!currentState.showBirdsEye) {
        renderBirdsEye(currentState, size.width, size.height);
    } else if (skipSim || shouldRunCadencedUpdate({
        currentTick: currentState.tick,
        currentTimeMs: timestamp,
        lastTick: lastBirdsEyeTick,
        lastTimeMs: lastBirdsEyeTimeMs,
        minTickDelta: BIRDS_EYE_MIN_TICK_DELTA,
        minTimeDeltaMs: BIRDS_EYE_MIN_TIME_DELTA_MS
    })) {
        renderBirdsEye(currentState, size.width, size.height);
        lastBirdsEyeTick = currentState.tick;
        lastBirdsEyeTimeMs = timestamp;
    }

    // Debug UI
    if (currentState.debugMode && (skipSim || shouldRunCadencedUpdate({
        currentTick: currentState.tick,
        currentTimeMs: timestamp,
        lastTick: lastDebugUiTick,
        lastTimeMs: lastDebugUiTimeMs,
        minTickDelta: DEBUG_UI_MIN_TICK_DELTA,
        minTimeDeltaMs: DEBUG_UI_MIN_TIME_DELTA_MS
    }))) {
        // The summary sorts four 300-sample windows, so only build it when the debug UI refreshes
        latestFrameTimingSummary = buildFrameTimingSummary();
        updateDebugUI(currentState, latestFrameTimingSummary);
        lastDebugUiTick = currentState.tick;
        lastDebugUiTimeMs = timestamp;
        wasDebugMode = true;
    } else if (!currentState.debugMode && wasDebugMode) {
        updateDebugUI(currentState, latestFrameTimingSummary);
        wasDebugMode = false;
    }
    uiMs += performance.now() - postRenderUiStartMs;

    const frameMs = performance.now() - frameStartMs;
    recordRollingTiming(simTimingWindow, simMs);
    recordRollingTiming(renderTimingWindow, renderMs);
    recordRollingTiming(uiTimingWindow, uiMs);
    recordRollingTiming(frameTimingWindow, frameMs);

    animationFrameId = requestAnimationFrame(gameLoop);
}

function calculatePower(pid: number, entities: Record<EntityId, Entity>) {
    const p = { in: 0, out: 0 };
    for (const id in entities) {
        const e = entities[id];
        if (e.owner === pid && !e.dead) {
            const data = RULES.buildings[e.key];
            if (data) {
                if (data.power) p.out += data.power;
                if (data.drain) p.in += data.drain;
            }
        }
    }
    return p;
}

/**
 * Surface what just happened to the human player as battlefield alerts: completed structures,
 * new units, stalled production, attacks. `prev` is the state before this frame's ticks.
 */
function announceGameEvents(prev: GameState, next: GameState) {
    if (humanPlayerId === null || next.mode !== 'game') return;
    // The "click it in the sidebar" hint is stale once the player picks it up or places it
    if (!next.players[humanPlayerId]?.readyToPlace || next.placingBuilding) dismissAlert('ready-to-place');
    if (prev === next) return;
    const prevPlayer = prev.players[humanPlayerId];
    const player = next.players[humanPlayerId];
    if (!prevPlayer || !player) return;

    if (player.readyToPlace && player.readyToPlace !== prevPlayer.readyToPlace) {
        const name = RULES.buildings[player.readyToPlace]?.name ?? player.readyToPlace;
        pushAlert(`Construction complete: ${name} - ${IS_TOUCH ? 'tap' : 'click'} it in the sidebar to place`, 'success', 'ready-to-place');
    }

    const producing = Object.values(player.queues).some(q => q.current);
    if (producing && player.credits < 1) {
        pushAlert('Insufficient funds - production on hold', 'warning', 'no-funds', 20000);
    }

    for (const id in next.entities) {
        const e = next.entities[id];
        if (e.owner !== humanPlayerId || e.dead) continue;
        const before = prev.entities[id];
        if (!before) {
            if (e.type === 'UNIT') {
                const name = RULES.units[e.key]?.name ?? e.key;
                pushAlert(`Unit ready: ${name}`, 'info', `unit-ready:${e.key}`, 1500);
            }
            continue;
        }
        if (e.hp < before.hp) {
            if (e.type === 'BUILDING') {
                pushAlert('Our base is under attack!', 'error', 'base-attack', 20000);
                pingMinimap(e.pos.x, e.pos.y);
            } else if (e.type === 'UNIT' && e.key === 'harvester') {
                pushAlert('Harvester under attack!', 'error', 'harvester-attack', 20000);
                pingMinimap(e.pos.x, e.pos.y);
            }
        }
    }
}

function hasHumanBeenEliminated(): boolean {
    if (humanPlayerId === null) return false;
    for (const id in currentState.entities) {
        const e = currentState.entities[id];
        if (e.owner !== humanPlayerId || e.dead) continue;
        if (e.type === 'BUILDING' || (e.type === 'UNIT' && e.key === 'mcv')) return false;
    }
    return true;
}

/** The human lost while other players fight on: offer to keep watching or leave. */
function checkHumanDefeat() {
    if (humanDefeatShown || currentState.winner !== null || !currentState.running) return;
    if (currentState.mode !== 'game' || !hasHumanBeenEliminated()) return;

    humanDefeatShown = true;
    const endScreen = document.getElementById('end-screen');
    const endTitle = document.getElementById('end-title');
    const endSubtitle = document.getElementById('end-subtitle');
    const spectateBtn = document.getElementById('spectate-btn');
    if (!endScreen || !endTitle) return;
    endTitle.textContent = 'MISSION FAILED';
    endTitle.style.color = '#ff4444';
    if (endSubtitle) endSubtitle.textContent = 'Your base was destroyed. The battle continues without you.';
    if (spectateBtn) spectateBtn.hidden = false;
    renderEndResults(currentState, { localPlayerId: humanPlayerId });
    showGameEndScreen();
}

/** Switch a defeated player to observing the rest of the match. */
function spectateAfterDefeat() {
    const endScreen = document.getElementById('end-screen');
    const spectateBtn = document.getElementById('spectate-btn');
    endScreen?.classList.remove('visible');
    if (spectateBtn) spectateBtn.hidden = true;

    if (humanPlayerId !== null) {
        const { [humanPlayerId]: _ownFog, ...otherFog } = currentState.fogOfWar ?? {};
        currentState = { ...currentState, fogOfWar: otherFog, selection: [], placingBuilding: null, sellMode: false, repairMode: false, attackMoveMode: false };
        defeatedHumanId = humanPlayerId;
    }
    humanPlayerId = null;
    currentState = { ...currentState, mode: 'demo' };
    setObserverMode(true);
    renderer.resize();
    updateButtonsUI();
}

/** The end screen, offering Play Again only when there is a setup to replay (not after a hot reload or a debug state load). */
function showGameEndScreen() {
    const playAgain = document.getElementById('play-again-btn');
    if (playAgain) playAgain.hidden = !lastSkirmishConfig;
    showEndScreen();
}

function checkWinCondition() {
    if (currentState.winner !== null) {
        const endScreen = document.getElementById('end-screen');
        const endTitle = document.getElementById('end-title');
        if (endScreen && endTitle) {
            if (endTitle.dataset.final === 'true') return;
            endTitle.dataset.final = 'true';
            humanDefeatShown = false;
            const endSubtitle = document.getElementById('end-subtitle');
            if (endSubtitle) endSubtitle.textContent = '';
            const spectateBtn = document.getElementById('spectate-btn');
            if (spectateBtn) spectateBtn.hidden = true;

            if (currentState.winner === -1) {
                // Draw
                endTitle.textContent = 'DRAW';
                endTitle.style.color = '#ffffff';
            } else if (humanPlayerId !== null) {
                const humanTeam = currentState.players[humanPlayerId]?.team;
                const winnerTeam = currentState.players[currentState.winner]?.team;
                const humanTeamWon = humanTeam != null && winnerTeam != null && humanTeam === winnerTeam;

                if (currentState.winner === humanPlayerId || humanTeamWon) {
                    // Human player or human's team won
                    endTitle.textContent = 'MISSION ACCOMPLISHED';
                    endTitle.style.color = '#44ff88';
                } else {
                    // Human player lost (another player/team won)
                    endTitle.textContent = 'MISSION FAILED';
                    endTitle.style.color = '#ff4444';
                }
            } else {
                // Observer mode - show which player/team won
                const winnerTeam = currentState.players[currentState.winner]?.team;
                if (winnerTeam) {
                    endTitle.textContent = `TEAM ${winnerTeam} WINS`;
                    endTitle.style.color = '#ffffff';
                } else {
                    const winnerColor = PLAYER_COLORS[currentState.winner] || '#ffffff';
                    endTitle.textContent = `PLAYER ${currentState.winner + 1} WINS`;
                    endTitle.style.color = winnerColor;
                }
                // A human who was knocked out earlier and kept watching
                if (defeatedHumanId !== null && endSubtitle) {
                    const defeatedTeam = currentState.players[defeatedHumanId]?.team;
                    endSubtitle.textContent = defeatedTeam != null && defeatedTeam === winnerTeam
                        ? 'Your team won - even though your base fell.'
                        : 'You were eliminated earlier in the battle.';
                }
            }

            // The tick has stopped: refresh the scoreboard now so it shows the final result
            updateScoreboard(currentState, undefined, true);
            renderEndResults(currentState, { localPlayerId: humanPlayerId ?? defeatedHumanId });
            showGameEndScreen();
        }
    }
}

window.startGame = startGameWithConfig;

// HMR: Save and restore state across hot reloads
if (import.meta.hot) {
    // Restore state from previous module if available
    if (import.meta.hot.data?.gameState) {
        const savedState = import.meta.hot.data.gameState;
        currentState = reconstructVectors(savedState);
        humanPlayerId = import.meta.hot.data.humanPlayerId;
        gameSpeed = import.meta.hot.data.gameSpeed || 2;
        prePauseMode = import.meta.hot.data.prePauseMode ?? (currentState.mode === 'paused' ? 'game' : null);
        console.log('[HMR] Restored game state from hot reload');

        // Reinitialize input with fresh callbacks after state restoration
        const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
        if (canvas) {
            initInput(canvas, createInputCallbacks());
            // The pause menu buttons still call the old module's resume/quit
            initPauseMenu(resumeGame, () => location.reload());

            // Reinitialize UI modules with fresh callbacks (they use listener guard pattern for HMR)
            initUI(currentState, handleBuildClick, handleToggleSellMode, handleToggleRepairMode, handleCancelBuild, handleDequeueUnit);
            initMinimap();
            initScoreboard();
            initBirdsEye();
            initCommandBar(
                (stance) => {
                    if (currentState.selection.length > 0) {
                        currentState = update(currentState, {
                            type: 'SET_STANCE',
                            payload: { unitIds: currentState.selection, stance }
                        });
                        updateButtonsUI();
                    }
                },
                () => {
                    currentState = update(currentState, { type: 'TOGGLE_ATTACK_MOVE_MODE' });
                    updateButtonsUI();
                },
                () => {
                    currentState = update(currentState, {
                        type: 'COMMAND_UNGARRISON',
                        payload: { unitIds: currentState.selection }
                    });
                    updateButtonsUI();
                }
            );

            // Restart the game loop
            animationFrameId = requestAnimationFrame(gameLoop);
        }
    }

    import.meta.hot.accept();
    import.meta.hot.dispose((data) => {
        // Cancel the animation frame to prevent duplicate loops
        if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        // The next module instance creates its own renderer (and WebGL context) and listeners
        renderer.dispose();
        moduleListeners.abort();

        // Only save if game is running (not in menu)
        if (currentState.mode !== 'menu') {
            data.gameState = currentState;
            data.humanPlayerId = humanPlayerId;
            data.gameSpeed = gameSpeed;
            data.prePauseMode = prePauseMode;
            console.log('[HMR] Saved game state for hot reload');
        }
    });
}

// Export pure functions for testing
export const _testUtils = {
    getStartingPositions,
    reconstructVectors,
    calculatePower,
    generateMap
};

import { INITIAL_STATE, update, createPlayerState } from './engine/reducer.js';
import { GameState, Vector, EntityId, Entity, SkirmishConfig, PlayerType, MAP_SIZES, DENSITY_SETTINGS, PLAYER_COLORS } from './engine/types.js';
import './styles.css';
import { Renderer } from './renderer/index.js';
import { initUI, updateButtons, updateMoney, updatePower, hideMenu, updateSellModeUI, updateRepairModeUI, setObserverMode, updateDebugUI, setLoadGameStateCallback } from './ui/index.js';
import { initMinimap, renderMinimap, setMinimapClickHandler } from './ui/minimap.js';
import { initInput, getInputState, getDragSelection, handleCameraInput, handleZoomInput } from './input/index.js';
import { computeAiActions } from './engine/ai.js';
import rules from './data/rules.json';

const RULES = rules as any;

// Get canvas
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

// Game state
let currentState: GameState = INITIAL_STATE;
let humanPlayerId: number | null = 0; // Track which player is human (null = observer mode)

// Setup Skirmish UI logic
function setupSkirmishUI() {
    const playerSlots = document.querySelectorAll('.player-slot');
    const observerIndicator = document.getElementById('observer-mode');

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
                        }
                    }
                });
            }

            // Update disabled state based on closed
            const slotDiv = slot as HTMLElement;
            slotDiv.classList.toggle('disabled', select.value === 'none');

            updateObserverMode();
        });
    });

    updateObserverMode();
}

// Get skirmish configuration from UI
function getSkirmishConfig(): SkirmishConfig {
    const players: SkirmishConfig['players'] = [];

    document.querySelectorAll('.player-slot').forEach((slot, index) => {
        const select = slot.querySelector('.player-type') as HTMLSelectElement;
        const type = select.value as PlayerType;

        if (type !== 'none') {
            players.push({
                slot: index,
                type,
                color: PLAYER_COLORS[index]
            });
        }
    });

    const mapSize = (document.getElementById('map-size') as HTMLSelectElement).value as 'small' | 'medium' | 'large' | 'huge';
    const resourceDensity = (document.getElementById('resource-density') as HTMLSelectElement).value as 'low' | 'medium' | 'high';
    const rockDensity = (document.getElementById('rock-density') as HTMLSelectElement).value as 'low' | 'medium' | 'high';

    return { players, mapSize, resourceDensity, rockDensity };
}

// Get starting positions for players based on map size
function getStartingPositions(mapWidth: number, mapHeight: number, numPlayers: number): Vector[] {
    const margin = 350; // Distance from edge
    const centerX = mapWidth / 2;
    const centerY = mapHeight / 2;

    // 8 positions: corners + mid-edges for maximum spacing
    const positions = [
        new Vector(margin, margin),                          // Top-left (0)
        new Vector(mapWidth - margin, mapHeight - margin),   // Bottom-right (1)
        new Vector(mapWidth - margin, margin),               // Top-right (2)
        new Vector(margin, mapHeight - margin),              // Bottom-left (3)
        new Vector(centerX, margin),                         // Top-center (4)
        new Vector(centerX, mapHeight - margin),             // Bottom-center (5)
        new Vector(margin, centerY),                         // Left-center (6)
        new Vector(mapWidth - margin, centerY)               // Right-center (7)
    ];
    return positions.slice(0, numPlayers);
}

// Generate map entities
function generateMap(config: SkirmishConfig): { entities: Record<EntityId, Entity>, mapWidth: number, mapHeight: number } {
    const entities: Record<EntityId, Entity> = {};
    const mapDims = MAP_SIZES[config.mapSize];
    const { width: mapWidth, height: mapHeight } = mapDims;
    const density = DENSITY_SETTINGS[config.resourceDensity];
    const rockSettings = DENSITY_SETTINGS[config.rockDensity];

    // Calculate spawn zones to avoid for rocks
    const margin = 350;
    const spawnRadius = 200; // Keep rocks away from spawn areas
    const spawnZones = [
        new Vector(margin, margin),                          // Top-left
        new Vector(mapWidth - margin, mapHeight - margin),   // Bottom-right
        new Vector(mapWidth - margin, margin),               // Top-right
        new Vector(margin, mapHeight - margin)               // Bottom-left
    ];

    // Helper to check if position is near any spawn zone
    function isNearSpawnZone(x: number, y: number): boolean {
        for (const zone of spawnZones) {
            if (new Vector(x, y).dist(zone) < spawnRadius) {
                return true;
            }
        }
        return false;
    }

    // Generate resources in clusters
    const resourceCount = density.resources;
    const numClusters = Math.floor(resourceCount / 8) + 3; // More resources = more clusters
    const resourcesPerCluster = Math.ceil(resourceCount / numClusters);

    // Generate cluster centers in the middle area of the map
    const clusterCenters: Vector[] = [];
    for (let c = 0; c < numClusters; c++) {
        const cx = 500 + Math.random() * (mapWidth - 1000);
        const cy = 500 + Math.random() * (mapHeight - 1000);
        clusterCenters.push(new Vector(cx, cy));
    }

    // Generate resources around cluster centers
    let resourceId = 0;
    for (const center of clusterCenters) {
        const clusterSize = resourcesPerCluster + Math.floor(Math.random() * 5) - 2;
        for (let i = 0; i < clusterSize && resourceId < resourceCount; i++) {
            // Random position within cluster radius (50-150 from center)
            const angle = Math.random() * Math.PI * 2;
            const dist = 20 + Math.random() * 100;
            const x = center.x + Math.cos(angle) * dist;
            const y = center.y + Math.sin(angle) * dist;

            // Skip if out of bounds
            if (x < 100 || x > mapWidth - 100 || y < 100 || y > mapHeight - 100) continue;

            const id = 'res_' + resourceId++;
            entities[id] = {
                id, owner: -1, type: 'RESOURCE', key: 'ore',
                pos: new Vector(x, y), prevPos: new Vector(x, y),
                hp: 1000, maxHp: 1000, w: 25, h: 25, radius: 12, dead: false,
                vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
                targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
            };
        }
    }

    // Generate rocks (impassable obstacles) - avoid spawn zones
    const rockCount = rockSettings.rocks;
    let rocksPlaced = 0;
    let attempts = 0;
    const maxAttempts = rockCount * 10;

    while (rocksPlaced < rockCount && attempts < maxAttempts) {
        attempts++;
        const x = 300 + Math.random() * (mapWidth - 600);
        const y = 300 + Math.random() * (mapHeight - 600);

        // Skip if too close to a spawn zone
        if (isNearSpawnZone(x, y)) {
            continue;
        }

        const size = 30 + Math.random() * 40;
        const id = 'rock_' + rocksPlaced;
        entities[id] = {
            id, owner: -1, type: 'ROCK', key: 'rock',
            pos: new Vector(x, y), prevPos: new Vector(x, y),
            hp: 9999, maxHp: 9999, w: size, h: size, radius: size / 2, dead: false,
            vel: new Vector(0, 0), rotation: Math.random() * Math.PI * 2, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
            targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
        };
        rocksPlaced++;
    }

    return { entities, mapWidth, mapHeight };
}

// Start button handler
document.getElementById('start-skirmish-btn')?.addEventListener('click', () => {
    const config = getSkirmishConfig();
    if (config.players.length < 2) {
        alert('You need at least 2 players to start a game!');
        return;
    }
    startGameWithConfig(config);
});

// Restart button
document.getElementById('restart-btn')?.addEventListener('click', () => {
    location.reload();
});

// Initialize skirmish UI
setupSkirmishUI();

// Helper to reconstruct Vector objects from plain {x, y} when loading game state
function reconstructVectors(state: GameState): GameState {
    // Deep clone and reconstruct vectors
    const entities: Record<EntityId, Entity> = {};
    for (const id in state.entities) {
        const e = state.entities[id];
        entities[id] = {
            ...e,
            pos: new Vector(e.pos.x, e.pos.y),
            prevPos: new Vector(e.prevPos.x, e.prevPos.y),
            vel: new Vector(e.vel.x, e.vel.y),
            moveTarget: e.moveTarget ? new Vector(e.moveTarget.x, e.moveTarget.y) : null,
            finalDest: e.finalDest ? new Vector(e.finalDest.x, e.finalDest.y) : null,
            unstuckDir: e.unstuckDir ? new Vector(e.unstuckDir.x, e.unstuckDir.y) : null,
            path: e.path ? e.path.map((p: { x: number, y: number }) => new Vector(p.x, p.y)) : null
        };
    }

    return {
        ...state,
        entities,
        camera: { x: state.camera.x, y: state.camera.y }
    };
}

function startGameWithConfig(config: SkirmishConfig) {
    hideMenu();

    // Generate map
    const { entities, mapWidth, mapHeight } = generateMap(config);

    // Determine human player
    const humanPlayer = config.players.find(p => p.type === 'human');
    humanPlayerId = humanPlayer ? humanPlayer.slot : null;

    // Create player states
    const players: Record<number, any> = {};
    config.players.forEach(p => {
        const isAi = p.type !== 'human';
        const difficulty = (p.type === 'human' ? 'medium' : p.type) as 'easy' | 'medium' | 'hard';
        players[p.slot] = createPlayerState(p.slot, isAi, difficulty, p.color);
    });

    // Get starting positions
    const positions = getStartingPositions(mapWidth, mapHeight, config.players.length);

    // Create base entities for each player
    config.players.forEach((p, idx) => {
        const pos = positions[idx];

        // Construction Yard
        const cyId = `cy_p${p.slot}`;
        entities[cyId] = {
            id: cyId, owner: p.slot, type: 'BUILDING', key: 'conyard',
            pos: pos, prevPos: pos,
            hp: 3000, maxHp: 3000, w: 90, h: 90, radius: 45, dead: false,
            vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
            targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
        };

        // Harvester
        const harvId = `harv_p${p.slot}`;
        const harvPos = pos.add(new Vector(80, 50));
        entities[harvId] = {
            id: harvId, owner: p.slot, type: 'UNIT', key: 'harvester',
            pos: harvPos, prevPos: harvPos,
            hp: 1000, maxHp: 1000, w: 35, h: 35, radius: 17, dead: false,
            vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
            targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
        };
    });

    // Build game state
    const isObserverMode = humanPlayerId === null;
    let state: GameState = {
        ...INITIAL_STATE,
        running: true,
        mode: isObserverMode ? 'demo' : 'game',
        difficulty: 'easy', // Legacy field
        entities: entities,
        players: players,
        config: {
            width: mapWidth,
            height: mapHeight,
            resourceDensity: config.resourceDensity,
            rockDensity: config.rockDensity
        }
    };

    currentState = state;

    // Set up callback for loading game state from debug UI
    setLoadGameStateCallback((loadedState) => {
        // Reconstruct Vector objects from plain {x, y} objects
        currentState = reconstructVectors(loadedState);
        updateButtonsUI();
    });

    // Initialize UI  
    initUI(currentState, handleBuildClick, handleToggleSellMode, handleToggleRepairMode);
    initMinimap();

    // Set observer mode if all players are AI
    setObserverMode(isObserverMode);
    renderer.resize();

    // Initialize input
    initInput(canvas, {
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
        getZoom: () => currentState.zoom,
        getCamera: () => currentState.camera
    });

    // Set up minimap click handler to pan camera
    setMinimapClickHandler((worldX, worldY) => {
        const size = renderer.getSize();
        const mapWidth = currentState.config.width;
        const mapHeight = currentState.config.height;
        const zoom = currentState.zoom;

        // Center camera on clicked point
        const newX = Math.max(0, Math.min(mapWidth - size.width / zoom, worldX - size.width / zoom / 2));
        const newY = Math.max(0, Math.min(mapHeight - size.height / zoom, worldY - size.height / zoom / 2));

        currentState = {
            ...currentState,
            camera: { x: newX, y: newY }
        };
    });

    // Start game loop
    gameLoop();
}

function handleBuildClick(category: string, key: string) {
    if (currentState.mode === 'demo') return;
    if (humanPlayerId === null) return;

    if (category === 'building') {
        if (currentState.players[humanPlayerId].readyToPlace === key) {
            currentState = { ...currentState, placingBuilding: key };
        } else {
            currentState = update(currentState, { type: 'START_BUILD', payload: { category, key, playerId: humanPlayerId } });
        }
    } else {
        currentState = update(currentState, { type: 'START_BUILD', payload: { category, key, playerId: humanPlayerId } });
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

function handleLeftClick(wx: number, wy: number, isDrag: boolean, dragRect?: { x1: number; y1: number; x2: number; y2: number }) {
    if (currentState.mode === 'demo') return;

    // Sell Mode
    if (currentState.sellMode) {
        if (humanPlayerId === null) return;
        const entityList = Object.values(currentState.entities);
        const clicked = entityList.find(e =>
            !e.dead && e.owner === humanPlayerId && e.type === 'BUILDING' && e.pos.dist(new Vector(wx, wy)) < e.radius + 15
        );
        if (clicked) {
            currentState = update(currentState, {
                type: 'SELL_BUILDING',
                payload: { buildingId: clicked.id, playerId: humanPlayerId }
            });
            updateButtonsUI();
        }
        return;
    }

    // Repair Mode
    if (currentState.repairMode) {
        if (humanPlayerId === null) return;
        const entityList = Object.values(currentState.entities);
        const clicked = entityList.find(e =>
            !e.dead && e.owner === humanPlayerId && e.type === 'BUILDING' && e.pos.dist(new Vector(wx, wy)) < e.radius + 15
        );
        if (clicked) {
            // Toggle repair on/off for this building
            if (clicked.isRepairing) {
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

    // Selection
    let newSelection: EntityId[] = [];

    if (isDrag && dragRect) {
        for (const id in currentState.entities) {
            const e = currentState.entities[id];
            if (humanPlayerId !== null && e.owner === humanPlayerId && e.type === 'UNIT' && !e.dead &&
                e.pos.x > dragRect.x1 && e.pos.x < dragRect.x2 &&
                e.pos.y > dragRect.y1 && e.pos.y < dragRect.y2) {
                newSelection.push(e.id);
            }
        }
    } else {
        const entityList = Object.values(currentState.entities);
        const clicked = entityList.find(e =>
            !e.dead && humanPlayerId !== null && e.owner === humanPlayerId && e.pos.dist(new Vector(wx, wy)) < e.radius + 15
        );
        if (clicked) {
            newSelection.push(clicked.id);
        }
    }

    currentState = update(currentState, { type: 'SELECT_UNITS', payload: newSelection });
    updateButtonsUI();
}

function handleRightClick(wx: number, wy: number) {
    if (currentState.mode === 'demo') return;

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

    // Cancel placement
    if (currentState.placingBuilding) {
        if (humanPlayerId === null) return;
        currentState = update(currentState, {
            type: 'CANCEL_BUILD',
            payload: { category: 'building', playerId: humanPlayerId }
        });
        updateButtonsUI();
        return;
    }

    // Find target
    let targetId: EntityId | null = null;
    const entityList = Object.values(currentState.entities);
    for (const ent of entityList) {
        if (!ent.dead && ent.pos.dist(new Vector(wx, wy)) < ent.radius + 5) {
            targetId = ent.id;
            break;
        }
    }

    // Issue commands
    const selectedIds = currentState.selection;
    if (selectedIds.length === 0) return;

    if (targetId) {
        currentState = update(currentState, {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: selectedIds, targetId }
        });
    } else {
        currentState = update(currentState, {
            type: 'COMMAND_MOVE',
            payload: { unitIds: selectedIds, x: wx, y: wy }
        });
    }
}

function attemptMCVDeploy() {
    // TODO: Implement MCV Deploy action in reducer
}

function updateButtonsUI() {
    // Use human player's UI, or first player if observer
    const pid = humanPlayerId !== null ? humanPlayerId : Object.keys(currentState.players).map(Number)[0];
    const player = currentState.players[pid];
    if (!player) return;

    updateButtons(
        currentState.entities,
        player.queues,
        player.readyToPlace,
        currentState.placingBuilding
    );
    updateSellModeUI(currentState);
    updateRepairModeUI(currentState);
}

function gameLoop() {
    if (!currentState.running) {
        checkWinCondition();
        return;
    }

    if (currentState.debugMode) {
        // Just render, don't update
    } else {
        // AI Logic - iterate over ALL AI players
        let aiActions: any[] = [];
        for (const pidStr in currentState.players) {
            const pid = parseInt(pidStr);
            const player = currentState.players[pid];
            if (player.isAi) {
                const actions = computeAiActions(currentState, pid);
                aiActions.push(...actions);
            }
        }

        for (const action of aiActions) {
            currentState = update(currentState, action);
        }

        currentState = update(currentState, { type: 'TICK' });
    }

    // Update UI - use human player's data, or first player if observer
    const displayPlayerId = humanPlayerId !== null ? humanPlayerId : Object.keys(currentState.players).map(Number)[0];
    const displayPlayer = currentState.players[displayPlayerId];
    const power = calculatePower(displayPlayerId, currentState.entities);
    if (displayPlayer) {
        updateMoney(displayPlayer.credits);
        updatePower(power.out, power.in);
    }

    if (currentState.tick % 5 === 0) {
        updateButtonsUI();
    }

    // Expose state for debugging
    (window as any).GAME_STATE = currentState;


    // Camera & Zoom Input
    const input = getInputState();

    const oldZoom = currentState.zoom;
    const newZoom = handleZoomInput(oldZoom);

    if (newZoom !== oldZoom) {
        // Zoom towards mouse
        const mouseX = input.mouse.x;
        const mouseY = input.mouse.y;

        const worldX = currentState.camera.x + mouseX / oldZoom;
        const worldY = currentState.camera.y + mouseY / oldZoom;

        const newCameraX = worldX - mouseX / newZoom;
        const newCameraY = worldY - mouseY / newZoom;

        const mapWidth = currentState.config.width;
        const mapHeight = currentState.config.height;

        currentState = {
            ...currentState,
            zoom: newZoom,
            camera: {
                x: Math.max(0, Math.min(mapWidth - canvas.width / newZoom, newCameraX)),
                y: Math.max(0, Math.min(mapHeight - canvas.height / newZoom, newCameraY))
            }
        };
    }

    const newCamera = handleCameraInput(
        currentState.camera,
        currentState.zoom,
        canvas.width,
        canvas.height,
        currentState.config.width,
        currentState.config.height
    );
    currentState = { ...currentState, camera: newCamera };

    // Render
    renderer.render(currentState, getDragSelection(), { x: input.mouse.x, y: input.mouse.y }, humanPlayerId);

    // Minimap
    const size = renderer.getSize();
    const lowPower = power.out < power.in;
    renderMinimap(
        Object.values(currentState.entities),
        currentState.camera,
        currentState.zoom,
        size.width,
        size.height,
        lowPower,
        currentState.config.width,
        currentState.config.height
    );

    // Observer Minimap Toggle
    if (currentState.mode === 'demo') {
        const observerMinimap = document.getElementById('observer-minimap');
        if (observerMinimap) {
            observerMinimap.style.display = currentState.showMinimap ? 'block' : 'none';
        }
    }

    // Debug UI
    updateDebugUI(currentState);

    requestAnimationFrame(gameLoop);
}

function calculatePower(pid: number, entities: Record<EntityId, any>) {
    let p = { in: 0, out: 0 };
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

function checkWinCondition() {
    if (currentState.winner !== null) {
        const endScreen = document.getElementById('end-screen');
        const endTitle = document.getElementById('end-title');
        if (endScreen && endTitle) {
            endScreen.classList.add('visible');
            if (currentState.winner === -1) {
                // Draw
                endTitle.textContent = 'DRAW';
                endTitle.style.color = '#ffffff';
            } else if (humanPlayerId !== null && currentState.winner === humanPlayerId) {
                // Human player won
                endTitle.textContent = 'MISSION ACCOMPLISHED';
                endTitle.style.color = '#44ff88';
            } else if (humanPlayerId !== null) {
                // Human player lost (another player won)
                endTitle.textContent = 'MISSION FAILED';
                endTitle.style.color = '#ff4444';
            } else {
                // Observer mode - show which player won
                const winnerColor = PLAYER_COLORS[currentState.winner] || '#ffffff';
                endTitle.textContent = `PLAYER ${currentState.winner + 1} WINS`;
                endTitle.style.color = winnerColor;
            }
        }
    }
}

(window as any).startGame = startGameWithConfig;

// Export pure functions for testing
export const _testUtils = {
    getStartingPositions,
    reconstructVectors,
    calculatePower,
    generateMap
};

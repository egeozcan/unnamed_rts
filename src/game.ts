import { INITIAL_STATE, update, createPlayerState } from './engine/reducer.js';
import { GameState, Vector, EntityId, Entity, SkirmishConfig, PlayerType, MAP_SIZES, DENSITY_SETTINGS, WELL_DENSITY_SETTINGS, PLAYER_COLORS, Action, ResourceEntity, RockEntity, WellEntity, BuildingEntity, HarvesterUnit, UnitEntity, CombatUnit, PlayerState } from './engine/types.js';

declare global {
    interface Window {
        GAME_STATE?: GameState;
        startGame?: typeof startGameWithConfig;
    }
}
import { createDefaultWellComponent } from './engine/entity-helpers.js';
import './styles.css';
import { Renderer } from './renderer/index.js';
import { initUI, updateButtons, updateMoney, updatePower, hideMenu, updateSellModeUI, updateRepairModeUI, setObserverMode, updateDebugUI, setLoadGameStateCallback, setCloseDebugCallback, setStatusMessage } from './ui/index.js';
import { initMinimap, renderMinimap, setMinimapClickHandler } from './ui/minimap.js';
import { initBirdsEye, renderBirdsEye, setBirdsEyeClickHandler, setBirdsEyeCloseHandler } from './ui/birdsEyeView.js';
import { initInput, getInputState, getDragSelection, handleCameraInput, handleZoomInput } from './input/index.js';
import { computeAiActions } from './engine/ai/index.js';
import { RULES } from './data/schemas/index.js';
import { isUnit, isBuilding, isHarvester } from './engine/type-guards.js';
import { isAirUnit } from './engine/entity-helpers.js';

// Game speed setting (1 = slow, 2 = medium, 3 = fast, 5 = lightspeed)
type GameSpeed = 1 | 2 | 3 | 4 | 5;

// Get canvas
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

// Game state
let currentState: GameState = INITIAL_STATE;
let humanPlayerId: number | null = 0; // Track which player is human (null = observer mode)

// OPTIMIZATION: Cache power calculations to avoid recalculating every frame
let cachedPower: { out: number; in: number } = { out: 0, in: 0 };
let cachedPowerTick: number = -1;

// Frame rate limiting
const TARGET_FPS = 60;
const FRAME_TIME = 1000 / TARGET_FPS;
const TICKS_PER_GAME_SPEED: Record<GameSpeed, number> = {
    1: 1,
    2: 2,
    3: 3,
    4: 4,
    5: 20,
};

let lastFrameTime = 0;
let gameSpeed: GameSpeed = 2;

function setGameSpeed(speed: GameSpeed) {
    gameSpeed = speed;
    updateSpeedIndicator();
}

function updateSpeedIndicator() {
    const indicator = document.getElementById('speed-indicator');

    if (!indicator) {
        return;
    }

    const labels = { 1: 'SLOW', 2: 'NORMAL', 3: 'FAST', 4: 'VERY FAST', 5: 'LIGHTSPEED' };
    indicator.textContent = labels[gameSpeed];
    indicator.className = `speed-${gameSpeed}`;
}

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
            const resourceEntity: ResourceEntity = {
                id, owner: -1, type: 'RESOURCE', key: 'ore',
                pos: new Vector(x, y), prevPos: new Vector(x, y),
                hp: 1000, maxHp: 1000, w: 25, h: 25, radius: 12, dead: false
            };
            entities[id] = resourceEntity;
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
        const rockEntity: RockEntity = {
            id, owner: -1, type: 'ROCK', key: 'rock',
            pos: new Vector(x, y), prevPos: new Vector(x, y),
            hp: 9999, maxHp: 9999, w: size, h: size, radius: size / 2, dead: false
        };
        entities[id] = rockEntity;
        rocksPlaced++;
    }

    // Generate ore wells (neutral resource generators)
    const wellCount = WELL_DENSITY_SETTINGS[config.resourceDensity];
    let wellsPlaced = 0;
    let wellAttempts = 0;
    const maxWellAttempts = wellCount * 20;

    while (wellsPlaced < wellCount && wellAttempts < maxWellAttempts) {
        wellAttempts++;

        // Place wells in middle area of map (600px from edges)
        const x = 600 + Math.random() * (mapWidth - 1200);
        const y = 600 + Math.random() * (mapHeight - 1200);

        // Skip if too close to a spawn zone
        if (isNearSpawnZone(x, y)) {
            continue;
        }

        // Check not too close to existing wells (min 400px apart)
        let tooClose = false;
        for (const id in entities) {
            const e = entities[id];
            if (e.type === 'WELL') {
                if (new Vector(x, y).dist(e.pos) < 400) {
                    tooClose = true;
                    break;
                }
            }
        }
        if (tooClose) continue;

        const id = 'well_' + wellsPlaced;
        const wellEntity: WellEntity = {
            id,
            owner: -1,
            type: 'WELL',
            key: 'well',
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 9999,
            maxHp: 9999,
            w: 50,
            h: 50,
            radius: 25,
            dead: false,
            well: createDefaultWellComponent()
        };
        entities[id] = wellEntity;
        wellsPlaced++;
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
                moveTarget: movement.moveTarget ? new Vector(movement.moveTarget.x, movement.moveTarget.y) : null,
                finalDest: movement.finalDest ? new Vector(movement.finalDest.x, movement.finalDest.y) : null,
                unstuckDir: movement.unstuckDir ? new Vector(movement.unstuckDir.x, movement.unstuckDir.y) : null,
                path: movement.path ? movement.path.map((p: { x: number, y: number }) => new Vector(p.x, p.y)) : null,
                avgVel: movement.avgVel ? new Vector(movement.avgVel.x, movement.avgVel.y) : undefined
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
                    combat: e.combat,
                    harvester: reconstructedHarvester
                } as HarvesterUnit;
            } else {
                // Combat unit
                entities[id] = {
                    ...baseEntity,
                    type: 'UNIT',
                    key: e.key,
                    movement: reconstructedMovement,
                    combat: e.combat,
                    engineer: (e as CombatUnit).engineer
                } as UnitEntity;
            }
        } else if (isBuilding(e)) {
            // Building entity
            entities[id] = {
                ...baseEntity,
                type: 'BUILDING',
                key: e.key,
                building: e.building,
                combat: e.combat
            } as BuildingEntity;
        } else {
            // Resource or Rock entity - no additional components
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

    // Generate map
    const { entities, mapWidth, mapHeight } = generateMap(config);

    // Determine human player
    const humanPlayer = config.players.find(p => p.type === 'human');
    humanPlayerId = humanPlayer ? humanPlayer.slot : null;

    // Create player states
    const players: Record<number, PlayerState> = {};
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

    // Set up callback for closing debug UI (same as pressing F3)
    setCloseDebugCallback(() => {
        currentState = update(currentState, { type: 'TOGGLE_DEBUG' });
        updateButtonsUI();
    });

    // Initialize UI
    initUI(currentState, handleBuildClick, handleToggleSellMode, handleToggleRepairMode, handleCancelBuild, handleDequeueUnit);
    initMinimap();
    initBirdsEye();

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
        onToggleBirdsEye: () => {
            currentState = update(currentState, { type: 'TOGGLE_BIRDS_EYE' });
        },
        onSetSpeed: (speed: 1 | 2 | 3 | 4 | 5) => {
            setGameSpeed(speed);
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

    // Set up bird's eye view click handler to pan camera and close
    setBirdsEyeClickHandler((worldX, worldY) => {
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

    // Set up bird's eye close handler
    setBirdsEyeCloseHandler(() => {
        currentState = update(currentState, { type: 'TOGGLE_BIRDS_EYE' });
    });

    // Start game loop
    gameLoop();
}

function handleBuildClick(category: string, key: string, count: number = 1) {
    if (currentState.mode === 'demo') return;
    if (humanPlayerId === null) return;

    if (category === 'building') {
        if (currentState.players[humanPlayerId].readyToPlace === key) {
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
    if (currentState.mode === 'demo') return;

    // Sell Mode
    if (currentState.sellMode) {
        if (humanPlayerId === null) return;
        const entityList = Object.values(currentState.entities);
        const clicked = entityList.find(e =>
            !e.dead && e.owner === humanPlayerId && isBuilding(e) && e.pos.dist(new Vector(wx, wy)) < e.radius + 15
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
            !e.dead && e.owner === humanPlayerId && isBuilding(e) && e.pos.dist(new Vector(wx, wy)) < e.radius + 15
        );
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

    // Selection
    let newSelection: EntityId[] = [];

    if (isDrag && dragRect) {
        for (const id in currentState.entities) {
            const e = currentState.entities[id];
            if (humanPlayerId !== null && e.owner === humanPlayerId && isUnit(e) && !e.dead &&
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
            // Check if clicking on already selected MCV -> Deploy
            if (clicked.type === 'UNIT' && clicked.key === 'mcv' && currentState.selection.includes(clicked.id)) {
                attemptMCVDeploy();
                return;
            }

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
                payload: { unitIds: selectedIds, targetId }
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
    const elapsed = timestamp - lastFrameTime;
    if (elapsed < FRAME_TIME) {
        requestAnimationFrame(gameLoop);
        return;
    }
    lastFrameTime = timestamp - (elapsed % FRAME_TIME);

    if (!currentState.running) {
        checkWinCondition();
        return;
    }

    if (currentState.debugMode) {
        // Just render, don't update
    } else {
        // Determine how many ticks to run based on speed setting
        const ticksToRun = TICKS_PER_GAME_SPEED[gameSpeed];

        for (let t = 0; t < ticksToRun; t++) {
            // AI Logic - iterate over ALL AI players
            let aiActions: Action[] = [];
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
    }

    // Update UI - use human player's data, or first player if observer
    const displayPlayerId = humanPlayerId !== null ? humanPlayerId : Object.keys(currentState.players).map(Number)[0];
    const displayPlayer = currentState.players[displayPlayerId];

    // OPTIMIZATION: Cache power calculation - only recalculate every 5 ticks or when tick changes
    // Power only changes when buildings are built/destroyed, so no need to calculate every frame
    if (cachedPowerTick !== currentState.tick) {
        cachedPower = calculatePower(displayPlayerId, currentState.entities);
        cachedPowerTick = currentState.tick;
    }

    if (displayPlayer) {
        updateMoney(displayPlayer.credits);
        updatePower(cachedPower.out, cachedPower.in);
    }

    if (currentState.tick % 5 === 0) {
        updateButtonsUI();
    }

    // Expose state for debugging
    window.GAME_STATE = currentState;


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
        const panBuffer = 300;

        currentState = {
            ...currentState,
            zoom: newZoom,
            camera: {
                x: Math.max(-panBuffer / newZoom, Math.min(mapWidth - canvas.width / newZoom + panBuffer / newZoom, newCameraX)),
                y: Math.max(-panBuffer / newZoom, Math.min(mapHeight - canvas.height / newZoom + panBuffer / newZoom, newCameraY))
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
    const lowPower = cachedPower.out < cachedPower.in;
    // OPTIMIZATION: Pass entities record directly instead of creating array with Object.values()
    // The minimap function can iterate over the record if needed
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

    // Bird's Eye View
    renderBirdsEye(currentState, size.width, size.height);

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

window.startGame = startGameWithConfig;

// Export pure functions for testing
export const _testUtils = {
    getStartingPositions,
    reconstructVectors,
    calculatePower,
    generateMap
};

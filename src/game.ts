import { INITIAL_STATE, update } from './engine/reducer.js';
import { GameState, Vector, EntityId, MAP_WIDTH, MAP_HEIGHT } from './engine/types.js';
import './styles.css';
import { Renderer } from './renderer/index.js';
import { initUI, updateButtons, updateMoney, updatePower, hideMenu } from './ui/index.js';
import { initMinimap, renderMinimap } from './ui/minimap.js';
import { initInput, getInputState, getDragSelection, handleCameraInput } from './input/index.js';
import { computeAiActions } from './engine/ai.js';
import rules from './data/rules.json';

const RULES = rules as any;

// Get canvas
const canvas = document.getElementById('gameCanvas') as HTMLCanvasElement;
const renderer = new Renderer(canvas);

// Game state
let currentState: GameState = INITIAL_STATE;

// Menu button handlers
document.querySelectorAll('.menu-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as 'easy' | 'hard' | 'demo';
        startGame(mode);
    });
});

// Restart button
document.getElementById('restart-btn')?.addEventListener('click', () => {
    location.reload();
});

function startGame(mode: string) {
    hideMenu();

    // Reset state
    let state = { ...INITIAL_STATE };
    state.mode = mode === 'demo' ? 'demo' : 'game';
    state.difficulty = mode === 'hard' ? 'hard' : 'easy';
    state.running = true;
    state.entities = {};

    // Resources
    for (let i = 0; i < 150; i++) {
        const x = Math.random() * MAP_WIDTH;
        const y = Math.random() * MAP_HEIGHT;
        if (x > 500 && x < 2500) {
            const id = 'res_' + i;
            state.entities[id] = {
                id, owner: -1, type: 'RESOURCE', key: 'ore',
                pos: new Vector(x, y), prevPos: new Vector(x, y),
                hp: 1000, maxHp: 1000, w: 25, h: 25, radius: 12, dead: false,
                vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
                targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
            };
        }
    }

    // Bases
    // In demo mode, we still want P0 base, but controlled by AI
    {
        const id = 'cy_p0';
        state.entities[id] = {
            id, owner: 0, type: 'BUILDING', key: 'conyard',
            pos: new Vector(300, 300), prevPos: new Vector(300, 300),
            hp: 3000, maxHp: 3000, w: 90, h: 90, radius: 45, dead: false,
            vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
            targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
        };
        // Harvester
        const hid = 'harv_p0';
        state.entities[hid] = {
            id: hid, owner: 0, type: 'UNIT', key: 'harvester',
            pos: new Vector(400, 350), prevPos: new Vector(400, 350),
            hp: 1000, maxHp: 1000, w: 35, h: 35, radius: 17, dead: false,
            vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
            targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
        };
    }

    // AI Base
    const aiId = 'cy_p1';
    state.entities[aiId] = {
        id: aiId, owner: 1, type: 'BUILDING', key: 'conyard',
        pos: new Vector(2500, 2500), prevPos: new Vector(2500, 2500),
        hp: 3000, maxHp: 3000, w: 90, h: 90, radius: 45, dead: false,
        vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
        targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
    };
    const aghid = 'harv_p1';
    state.entities[aghid] = {
        id: aghid, owner: 1, type: 'UNIT', key: 'harvester',
        pos: new Vector(2400, 2400), prevPos: new Vector(2400, 2400),
        hp: 1000, maxHp: 1000, w: 35, h: 35, radius: 17, dead: false,
        vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
        targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
    };

    currentState = state;

    // Initialize UI
    initUI(currentState, handleBuildClick);
    initMinimap();

    // Initialize input
    initInput(canvas, {
        onLeftClick: handleLeftClick,
        onRightClick: handleRightClick,
        onDeployMCV: attemptMCVDeploy,
        getZoom: () => currentState.zoom,
        getCamera: () => currentState.camera
    });

    // Start game loop
    gameLoop();
}

function handleBuildClick(category: string, key: string) {
    if (currentState.mode === 'demo') return;

    if (category === 'building') {
        if (currentState.players[0].readyToPlace === key) {
            currentState = { ...currentState, placingBuilding: key };
        } else {
            currentState = update(currentState, { type: 'START_BUILD', payload: { category, key, playerId: 0 } });
        }
    } else {
        currentState = update(currentState, { type: 'START_BUILD', payload: { category, key, playerId: 0 } });
    }

    updateButtonsUI();
}

function handleLeftClick(wx: number, wy: number, isDrag: boolean, dragRect?: { x1: number; y1: number; x2: number; y2: number }) {
    if (currentState.mode === 'demo') return;

    // Building placement
    if (currentState.placingBuilding) {
        currentState = update(currentState, {
            type: 'PLACE_BUILDING',
            payload: { key: currentState.placingBuilding, x: wx, y: wy, playerId: 0 }
        });
        updateButtonsUI();
        return;
    }

    // Selection
    let newSelection: EntityId[] = [];

    if (isDrag && dragRect) {
        for (const id in currentState.entities) {
            const e = currentState.entities[id];
            if (e.owner === 0 && e.type === 'UNIT' && !e.dead &&
                e.pos.x > dragRect.x1 && e.pos.x < dragRect.x2 &&
                e.pos.y > dragRect.y1 && e.pos.y < dragRect.y2) {
                newSelection.push(e.id);
            }
        }
    } else {
        const entityList = Object.values(currentState.entities);
        const clicked = entityList.find(e =>
            !e.dead && e.owner === 0 && e.pos.dist(new Vector(wx, wy)) < e.radius + 15
        );
        if (clicked) {
            newSelection.push(clicked.id);
        }
    }

    currentState = update(currentState, { type: 'SELECT_UNITS', payload: newSelection });
}

function handleRightClick(wx: number, wy: number) {
    if (currentState.mode === 'demo') return;

    // Cancel placement
    if (currentState.placingBuilding) {
        currentState = update(currentState, {
            type: 'CANCEL_BUILD',
            payload: { category: 'building', playerId: 0 }
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
    updateButtons(
        Object.values(currentState.entities),
        currentState.players[0].queues,
        currentState.players[0].readyToPlace,
        currentState.placingBuilding
    );
}

function gameLoop() {
    if (!currentState.running) return;

    // AI Logic
    const aiActions = computeAiActions(currentState, 1);
    if (currentState.mode === 'demo') {
        const p0Actions = computeAiActions(currentState, 0);
        aiActions.push(...p0Actions);
    }

    for (const action of aiActions) {
        currentState = update(currentState, action);
    }

    currentState = update(currentState, { type: 'TICK' });

    // Update UI
    const p0 = currentState.players[0];
    const power = calculatePower(0, currentState.entities);
    updateMoney(p0.credits);
    updatePower(power.out, power.in);

    if (currentState.tick % 5 === 0) {
        updateButtonsUI();
    }

    if (currentState.tick % 60 === 0) {
        checkWinCondition();
    }

    // Camera Input
    const input = getInputState();
    const newCamera = handleCameraInput(currentState.camera, currentState.zoom, canvas.width, canvas.height);
    currentState = { ...currentState, camera: newCamera };

    // Render
    renderer.render(currentState, getDragSelection(), { x: input.mouse.x, y: input.mouse.y });

    // Minimap
    const size = renderer.getSize();
    const lowPower = power.out < power.in;
    renderMinimap(Object.values(currentState.entities), currentState.camera, currentState.zoom, size.width, size.height, lowPower);

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
    // Check if player has no buildings/units left?
}

(window as any).startGame = startGame;

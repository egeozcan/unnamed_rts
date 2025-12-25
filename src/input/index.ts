import { Vector, MAP_WIDTH, MAP_HEIGHT } from '../engine/types.js';

interface Mouse {
    x: number;
    y: number;
    wx: number;
    wy: number;
}

interface RawMouse {
    x: number;
    y: number;
}

interface Keys {
    [key: string]: boolean;
}

interface DragStart {
    x: number;
    y: number;
}

export interface InputState {
    mouse: Mouse;
    rawMouse: RawMouse;
    keys: Keys;
    dragStart: DragStart | null;
    touchDist: number;
}

let inputState: InputState = {
    mouse: { x: 0, y: 0, wx: 0, wy: 0 },
    rawMouse: { x: 0, y: 0 },
    keys: {},
    dragStart: null,
    touchDist: 0
};

let canvas: HTMLCanvasElement;
let onLeftClick: ((wx: number, wy: number, isDrag: boolean, dragRect?: { x1: number, y1: number, x2: number, y2: number }) => void) | null = null;
let onRightClick: ((wx: number, wy: number) => void) | null = null;
let onDeployMCV: (() => void) | null = null;
let getZoom: (() => number) | null = null;
let getCamera: (() => { x: number; y: number }) | null = null;

export function initInput(
    gameCanvas: HTMLCanvasElement,
    callbacks: {
        onLeftClick: (wx: number, wy: number, isDrag: boolean, dragRect?: { x1: number, y1: number, x2: number, y2: number }) => void;
        onRightClick: (wx: number, wy: number) => void;
        onDeployMCV: () => void;
        getZoom: () => number;
        getCamera: () => { x: number; y: number };
    }
) {
    canvas = gameCanvas;
    onLeftClick = callbacks.onLeftClick;
    onRightClick = callbacks.onRightClick;
    onDeployMCV = callbacks.onDeployMCV;
    getZoom = callbacks.getZoom;
    getCamera = callbacks.getCamera;

    setupEventListeners();
}

function screenToWorld(sx: number, sy: number): Vector {
    const zoom = getZoom?.() || 1;
    const camera = getCamera?.() || { x: 0, y: 0 };
    return new Vector((sx / zoom) + camera.x, (sy / zoom) + camera.y);
}

function setupEventListeners() {
    // Keyboard
    window.addEventListener('keydown', e => {
        inputState.keys[e.key] = true;
        if (e.key === 'd' || e.key === 'D') {
            onDeployMCV?.();
        }
    });

    window.addEventListener('keyup', e => {
        inputState.keys[e.key] = false;
    });

    // Mouse move
    window.addEventListener('mousemove', e => {
        inputState.rawMouse.x = e.clientX;
        inputState.rawMouse.y = e.clientY;
        const rect = canvas.getBoundingClientRect();
        inputState.mouse.x = e.clientX - rect.left;
        inputState.mouse.y = e.clientY - rect.top;
    });

    // Mouse down
    window.addEventListener('mousedown', e => {
        const worldMouse = screenToWorld(inputState.mouse.x, inputState.mouse.y);
        inputState.mouse.wx = worldMouse.x;
        inputState.mouse.wy = worldMouse.y;

        if (inputState.rawMouse.x > canvas.width) return;

        if (e.button === 0) {
            // Left click - start drag
            inputState.dragStart = { x: inputState.mouse.x, y: inputState.mouse.y };
        } else if (e.button === 2) {
            // Right click
            onRightClick?.(inputState.mouse.wx, inputState.mouse.wy);
        }
    });

    // Mouse up
    window.addEventListener('mouseup', e => {
        if (e.button === 0 && inputState.dragStart) {
            const zoom = getZoom?.() || 1;

            const p1 = screenToWorld(
                Math.min(inputState.dragStart.x, inputState.mouse.x),
                Math.min(inputState.dragStart.y, inputState.mouse.y)
            );
            const p2 = screenToWorld(
                Math.max(inputState.dragStart.x, inputState.mouse.x),
                Math.max(inputState.dragStart.y, inputState.mouse.y)
            );

            const isDrag = (p2.x - p1.x > 10 / zoom) || (p2.y - p1.y > 10 / zoom);

            onLeftClick?.(
                inputState.mouse.wx,
                inputState.mouse.wy,
                isDrag,
                isDrag ? { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y } : undefined
            );

            inputState.dragStart = null;
        }
    });

    // Double click for MCV deploy
    window.addEventListener('dblclick', e => {
        if (e.button === 0 && inputState.rawMouse.x < canvas.width) {
            onDeployMCV?.();
        }
    });

    // Context menu prevention
    window.addEventListener('contextmenu', e => e.preventDefault());

    // Zoom & Scroll
    window.addEventListener('wheel', e => {
        e.preventDefault();
    }, { passive: false });

    // Touch zoom
    window.addEventListener('touchstart', e => {
        if (e.touches.length === 2) {
            inputState.touchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        }
    });

    window.addEventListener('touchmove', e => {
        if (e.touches.length === 2) {
            e.preventDefault();
            const newDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            inputState.touchDist = newDist;
        }
    }, { passive: false });

    // Minimap click
    const minimap = document.getElementById('minimapCanvas');
    if (minimap) {
        minimap.addEventListener('mousedown', e => {
            moveCameraToMinimap(e);
            const moveHandler = (ev: MouseEvent) => moveCameraToMinimap(ev);
            const upHandler = () => {
                document.removeEventListener('mousemove', moveHandler);
                document.removeEventListener('mouseup', upHandler);
            };
            document.addEventListener('mousemove', moveHandler);
            document.addEventListener('mouseup', upHandler);
        });
    }
}

function moveCameraToMinimap(_e: MouseEvent) {
    // Minimap camera movement is handled by the game loop
    // This is a placeholder for future implementation
}

export function getInputState(): InputState {
    return inputState;
}

export function getDragSelection(): DragStart | null {
    return inputState.dragStart;
}

export function handleCameraInput(camera: { x: number; y: number }, zoom: number, canvasWidth: number, canvasHeight: number): { x: number; y: number } {
    const speed = 15 / zoom;
    let dx = 0, dy = 0;

    const keys = inputState.keys;
    if (keys.ArrowUp || keys.w || keys.W) dy -= speed;
    if (keys.ArrowDown || keys.s || keys.S) dy += speed;
    if (keys.ArrowLeft || keys.a || keys.A) dx -= speed;
    if (keys.ArrowRight || keys.d || keys.D) dx += speed;

    // Edge scrolling
    if (inputState.rawMouse.x < 10) dx -= speed;
    if (inputState.rawMouse.x > window.innerWidth - 10) dx += speed;
    if (inputState.rawMouse.y < 10) dy -= speed;
    if (inputState.rawMouse.y > window.innerHeight - 10) dy += speed;

    return {
        x: Math.max(0, Math.min(MAP_WIDTH - canvasWidth / zoom, camera.x + dx)),
        y: Math.max(0, Math.min(MAP_HEIGHT - canvasHeight / zoom, camera.y + dy))
    };
}

export function handleZoomInput(currentZoom: number): number {
    // Wheel zoom is handled in the event listener
    // Return current zoom for now
    return currentZoom;
}

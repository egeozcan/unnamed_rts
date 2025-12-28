import { Vector } from '../engine/types.js';

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
    wheelDeltaX: number;
    wheelDeltaY: number;
    wheelZoom: number;
    pinchRatio: number;
}

let inputState: InputState = {
    mouse: { x: 0, y: 0, wx: 0, wy: 0 },
    rawMouse: { x: 0, y: 0 },
    keys: {},
    dragStart: null,
    touchDist: 0,
    wheelDeltaX: 0,
    wheelDeltaY: 0,
    wheelZoom: 0,
    pinchRatio: 1
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
        onToggleDebug: () => void;
        onToggleMinimap: () => void;
        getZoom: () => number;
        getCamera: () => { x: number; y: number };
    }
) {
    canvas = gameCanvas;
    onLeftClick = callbacks.onLeftClick;
    onRightClick = callbacks.onRightClick;
    onDeployMCV = callbacks.onDeployMCV;
    (inputState as any).onToggleDebug = callbacks.onToggleDebug;
    (inputState as any).onToggleMinimap = callbacks.onToggleMinimap;
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
        if (e.key === 'F3') {
            e.preventDefault(); // Prevent browser's default F3 behavior (find)
            (inputState as any).onToggleDebug?.();
        }
        if (e.key === 'm' || e.key === 'M') {
            (inputState as any).onToggleMinimap?.();
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
        if (e.ctrlKey) {
            // Pinch to zoom (Mac touchpad)
            inputState.wheelZoom += e.deltaY;
        } else {
            // Two finger scroll
            inputState.wheelDeltaX += e.deltaX;
            inputState.wheelDeltaY += e.deltaY;
        }
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
            if (inputState.touchDist > 0) {
                const ratio = newDist / inputState.touchDist;
                inputState.pinchRatio *= ratio;
            }
            inputState.touchDist = newDist;
        }
    }, { passive: false });

    window.addEventListener('touchend', e => {
        if (e.touches.length < 2) {
            inputState.touchDist = 0;
            inputState.pinchRatio = 1;
        }
    });

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

export function handleCameraInput(
    camera: { x: number; y: number },
    zoom: number,
    canvasWidth: number,
    canvasHeight: number,
    mapWidth: number = 3000,
    mapHeight: number = 3000
): { x: number; y: number } {
    let dx = 0, dy = 0;

    const keys = inputState.keys;
    const speed = 15 / zoom;
    if (keys.ArrowUp || keys.w || keys.W) dy -= speed;
    if (keys.ArrowDown || keys.s || keys.S) dy += speed;
    if (keys.ArrowLeft || keys.a || keys.A) dx -= speed;
    if (keys.ArrowRight || keys.d || keys.D) dx += speed;

    // Edge scrolling
    if (inputState.rawMouse.x < 10) dx -= speed;
    if (inputState.rawMouse.x > window.innerWidth - 10) dx += speed;
    if (inputState.rawMouse.y < 10) dy -= speed;
    if (inputState.rawMouse.y > window.innerHeight - 10) dy += speed;

    // Wheel/Touchpad scrolling
    dx += inputState.wheelDeltaX / zoom;
    dy += inputState.wheelDeltaY / zoom;
    inputState.wheelDeltaX = 0;
    inputState.wheelDeltaY = 0;

    return {
        x: Math.max(0, Math.min(mapWidth - canvasWidth / zoom, camera.x + dx)),
        y: Math.max(0, Math.min(mapHeight - canvasHeight / zoom, camera.y + dy))
    };
}

export function handleZoomInput(currentZoom: number): number {
    let newZoom = currentZoom;

    // Mouse wheel zoom
    if (inputState.wheelZoom !== 0) {
        newZoom = currentZoom * Math.pow(0.999, inputState.wheelZoom);
        inputState.wheelZoom = 0;
    }

    // Touch pinch zoom
    if (inputState.pinchRatio !== 1) {
        newZoom *= inputState.pinchRatio;
        inputState.pinchRatio = 1;
    }

    return Math.max(0.5, Math.min(2.0, newZoom));
}

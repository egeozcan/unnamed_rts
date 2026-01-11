import { Vector, AttackStance } from '../engine/types.js';

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

interface MiddleMouseScroll {
    originX: number;
    originY: number;
}

export interface InputState {
    mouse: Mouse;
    rawMouse: RawMouse;
    keys: Keys;
    dragStart: DragStart | null;
    middleMouseScroll: MiddleMouseScroll | null;
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
    middleMouseScroll: null,
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
let onToggleDebug: (() => void) | null = null;
let onToggleMinimap: (() => void) | null = null;
let onToggleBirdsEye: (() => void) | null = null;
let onSetSpeed: ((speed: 1 | 2 | 3 | 4 | 5) => void) | null = null;
let onSetStance: ((stance: AttackStance) => void) | null = null;
let onToggleAttackMove: (() => void) | null = null;
let onDoubleClick: ((wx: number, wy: number) => void) | null = null;
let getZoom: (() => number) | null = null;
let getCamera: (() => { x: number; y: number }) | null = null;
let listenersInitialized = false;

export function initInput(
    gameCanvas: HTMLCanvasElement,
    callbacks: {
        onLeftClick: (wx: number, wy: number, isDrag: boolean, dragRect?: { x1: number, y1: number, x2: number, y2: number }) => void;
        onRightClick: (wx: number, wy: number) => void;
        onDeployMCV: () => void;
        onToggleDebug: () => void;
        onToggleMinimap: () => void;
        onToggleBirdsEye: () => void;
        onSetSpeed: (speed: 1 | 2 | 3 | 4 | 5) => void;
        onSetStance?: (stance: AttackStance) => void;
        onToggleAttackMove?: () => void;
        onDoubleClick?: (wx: number, wy: number) => void;
        getZoom: () => number;
        getCamera: () => { x: number; y: number };
    }
) {
    canvas = gameCanvas;
    onLeftClick = callbacks.onLeftClick;
    onRightClick = callbacks.onRightClick;
    onDeployMCV = callbacks.onDeployMCV;
    onToggleDebug = callbacks.onToggleDebug;
    onToggleMinimap = callbacks.onToggleMinimap;
    onToggleBirdsEye = callbacks.onToggleBirdsEye;
    onSetSpeed = callbacks.onSetSpeed;
    onSetStance = callbacks.onSetStance || null;
    onToggleAttackMove = callbacks.onToggleAttackMove || null;
    onDoubleClick = callbacks.onDoubleClick || null;
    getZoom = callbacks.getZoom;
    getCamera = callbacks.getCamera;

    // Only set up event listeners once - callbacks are updated via module variables
    if (!listenersInitialized) {
        setupEventListeners();
        listenersInitialized = true;
    }
}

function screenToWorld(sx: number, sy: number): Vector {
    const zoom = getZoom?.() || 1;
    const camera = getCamera?.() || { x: 0, y: 0 };
    return new Vector((sx / zoom) + camera.x, (sy / zoom) + camera.y);
}

// Dead zone threshold - no scrolling within this radius
const SCROLL_DEAD_ZONE = 10;

function getScrollCursor(dx: number, dy: number): string {
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < SCROLL_DEAD_ZONE) {
        return 'all-scroll';
    }

    // Determine direction based on angle
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    // 8-way directional cursors
    if (angle >= -22.5 && angle < 22.5) return 'e-resize';
    if (angle >= 22.5 && angle < 67.5) return 'se-resize';
    if (angle >= 67.5 && angle < 112.5) return 's-resize';
    if (angle >= 112.5 && angle < 157.5) return 'sw-resize';
    if (angle >= 157.5 || angle < -157.5) return 'w-resize';
    if (angle >= -157.5 && angle < -112.5) return 'nw-resize';
    if (angle >= -112.5 && angle < -67.5) return 'n-resize';
    if (angle >= -67.5 && angle < -22.5) return 'ne-resize';

    return 'all-scroll';
}

function setupEventListeners() {
    // Keyboard
    window.addEventListener('keydown', e => {
        inputState.keys[e.key] = true;
        if (e.key === 'F3') {
            e.preventDefault(); // Prevent browser's default F3 behavior (find)
            onToggleDebug?.();
        }
        if (e.key === 'm' || e.key === 'M') {
            onToggleMinimap?.();
        }
        if (e.key === 'b' || e.key === 'B') {
            onToggleBirdsEye?.();
        }
        // Game speed controls (1 = slow, 2 = normal, 3 = fast, 4 = very fast, 5 = lightspeed)
        if (e.key === '1') {
            onSetSpeed?.(1);
        }
        if (e.key === '2') {
            onSetSpeed?.(2);
        }
        if (e.key === '3') {
            onSetSpeed?.(3);
        }
        if (e.key === '4') {
            onSetSpeed?.(4);
        }
        if (e.key === '5') {
            onSetSpeed?.(5);
        }
        // Deploy MCV key handler
        if (e.key === 'Enter') {
            onDeployMCV?.();
        }
        // Stance controls: F = Aggressive, G = Defensive, H = Hold Ground
        if (e.key === 'f' || e.key === 'F') {
            onSetStance?.('aggressive');
        }
        if (e.key === 'g' || e.key === 'G') {
            onSetStance?.('defensive');
        }
        if (e.key === 'h' || e.key === 'H') {
            onSetStance?.('hold_ground');
        }
        // Attack-move toggle
        if (e.key === 'a' || e.key === 'A') {
            onToggleAttackMove?.();
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

        // Update cursor based on scroll direction when middle mouse scrolling
        if (inputState.middleMouseScroll) {
            const dx = inputState.mouse.x - inputState.middleMouseScroll.originX;
            const dy = inputState.mouse.y - inputState.middleMouseScroll.originY;
            document.body.style.cursor = getScrollCursor(dx, dy);
        }
    });

    // Mouse down
    window.addEventListener('mousedown', e => {
        // Ignore clicks inside the debug overlay
        const debugOverlay = document.getElementById('debug-overlay');
        if (debugOverlay && debugOverlay.style.display !== 'none' && debugOverlay.contains(e.target as Node)) {
            return;
        }

        // Update mouse position from event (in case mousemove hasn't fired yet)
        const rect = canvas.getBoundingClientRect();
        inputState.rawMouse.x = e.clientX;
        inputState.rawMouse.y = e.clientY;
        inputState.mouse.x = e.clientX - rect.left;
        inputState.mouse.y = e.clientY - rect.top;

        const worldMouse = screenToWorld(inputState.mouse.x, inputState.mouse.y);
        inputState.mouse.wx = worldMouse.x;
        inputState.mouse.wy = worldMouse.y;

        if (inputState.rawMouse.x > canvas.width) return;

        if (e.button === 0) {
            // Left click - start drag
            inputState.dragStart = { x: inputState.mouse.x, y: inputState.mouse.y };
        } else if (e.button === 1) {
            // Middle click - start auto-scroll mode
            e.preventDefault();
            inputState.middleMouseScroll = {
                originX: inputState.mouse.x,
                originY: inputState.mouse.y
            };
            document.body.style.cursor = 'all-scroll';
        } else if (e.button === 2) {
            // Right click
            onRightClick?.(inputState.mouse.wx, inputState.mouse.wy);
        }
    });

    // Mouse up
    window.addEventListener('mouseup', e => {
        // Ignore clicks inside the debug overlay
        const debugOverlay = document.getElementById('debug-overlay');
        if (debugOverlay && debugOverlay.style.display !== 'none' && debugOverlay.contains(e.target as Node)) {
            return;
        }

        // Middle mouse button release - end auto-scroll mode
        if (e.button === 1) {
            inputState.middleMouseScroll = null;
            document.body.style.cursor = '';
        }

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

    // Double click handler (MCV deploy, primary building, etc.)
    window.addEventListener('dblclick', e => {
        if (e.button === 0 && inputState.rawMouse.x < canvas.width) {
            const worldMouse = screenToWorld(inputState.mouse.x, inputState.mouse.y);
            if (onDoubleClick) {
                onDoubleClick(worldMouse.x, worldMouse.y);
            } else {
                // Fallback: just deploy MCV for backwards compatibility
                onDeployMCV?.();
            }
        }
    });

    // Context menu prevention
    window.addEventListener('contextmenu', e => e.preventDefault());

    // Zoom & Scroll
    window.addEventListener('wheel', e => {
        // Allow scrolling within the debug overlay
        const debugOverlay = document.getElementById('debug-overlay');
        if (debugOverlay && debugOverlay.contains(e.target as Node)) {
            return; // Let normal scroll behavior happen
        }

        // Allow scrolling within the sidebar (building list, etc.)
        const sidebar = document.getElementById('sidebar');
        if (sidebar && sidebar.contains(e.target as Node)) {
            return; // Let normal scroll behavior happen
        }

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

export function getMiddleMouseScrollOrigin(): { x: number; y: number } | null {
    if (!inputState.middleMouseScroll) return null;
    return { x: inputState.middleMouseScroll.originX, y: inputState.middleMouseScroll.originY };
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
    // Arrow keys for camera movement (WASD removed - used for unit commands)
    if (keys.ArrowUp) dy -= speed;
    if (keys.ArrowDown) dy += speed;
    if (keys.ArrowLeft) dx -= speed;
    if (keys.ArrowRight) dx += speed;

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

    // Middle mouse button auto-scroll: speed based on distance from origin
    if (inputState.middleMouseScroll) {
        const scrollDx = inputState.mouse.x - inputState.middleMouseScroll.originX;
        const scrollDy = inputState.mouse.y - inputState.middleMouseScroll.originY;
        const dist = Math.sqrt(scrollDx * scrollDx + scrollDy * scrollDy);

        if (dist > SCROLL_DEAD_ZONE) {
            // Scale factor: the further from origin, the faster the scroll
            // Subtract dead zone so speed starts at 0 when exiting dead zone
            const scrollSpeed = (dist - SCROLL_DEAD_ZONE) * 0.15 / zoom;
            const angle = Math.atan2(scrollDy, scrollDx);
            dx += Math.cos(angle) * scrollSpeed;
            dy += Math.sin(angle) * scrollSpeed;
        }
    }

    // Allow panning 300px past map edges to see units under UI panels
    const panBuffer = 300;
    return {
        x: Math.max(-panBuffer / zoom, Math.min(mapWidth - canvasWidth / zoom + panBuffer / zoom, camera.x + dx)),
        y: Math.max(-panBuffer / zoom, Math.min(mapHeight - canvasHeight / zoom + panBuffer / zoom, camera.y + dy))
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

    return Math.max(0.25, Math.min(2.0, newZoom));
}

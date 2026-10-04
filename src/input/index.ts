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
let onAdjustSpeed: ((delta: 1 | -1) => void) | null = null;
let onControlGroup: ((group: number, action: 'recall' | 'assign' | 'add') => void) | null = null;
let isPaused: (() => boolean) | null = null;
let onTap: ((wx: number, wy: number) => void) | null = null;

// Touch gesture tracking (one finger): a short, still touch is a tap, movement pans the camera
const TOUCH_TAP_SLOP = 12;
const TOUCH_TAP_MAX_MS = 500;
// Holding a finger still this long starts a box selection (drag) or, released in place, deselects
const TOUCH_HOLD_MS = 400;
let touchGesture: {
    startX: number; startY: number; lastX: number; lastY: number;
    panning: boolean; holding: boolean; startMs: number; holdTimer: number | null;
} | null = null;
let onClearSelection: (() => void) | null = null;

function endTouchGesture(): void {
    if (touchGesture?.holdTimer != null) window.clearTimeout(touchGesture.holdTimer);
    if (touchGesture?.holding) inputState.dragStart = null;
    touchGesture = null;
}

function setMouseFromClient(clientX: number, clientY: number): void {
    const rect = canvas.getBoundingClientRect();
    inputState.rawMouse.x = clientX;
    inputState.rawMouse.y = clientY;
    inputState.mouse.x = clientX - rect.left;
    inputState.mouse.y = clientY - rect.top;
}
let onSetStance: ((stance: AttackStance) => void) | null = null;
let onToggleAttackMove: (() => void) | null = null;
let onUngarrison: (() => void) | null = null;
let onStop: (() => void) | null = null;
let onSelectArmy: (() => void) | null = null;
let onCenterOnSelection: (() => void) | null = null;
let onDoubleClick: ((wx: number, wy: number) => void) | null = null;
let onTogglePause: (() => void) | null = null;
let onToggleGraphics: (() => void) | null = null;
let onCancel: (() => void) | null = null;
let getZoom: (() => number) | null = null;
let getCamera: (() => { x: number; y: number }) | null = null;
let listenersInitialized = false;
let hasPointerPosition = false;
// The canvas rect as of the last mouse move (edge scrolling reads it every frame without forcing a layout)
let edgeScrollRect: DOMRect | null = null;

export function initInput(
    gameCanvas: HTMLCanvasElement,
    callbacks: {
        onLeftClick: (wx: number, wy: number, isDrag: boolean, dragRect?: { x1: number, y1: number, x2: number, y2: number }) => void;
        onRightClick: (wx: number, wy: number) => void;
        onDeployMCV: () => void;
        onToggleDebug: () => void;
        onToggleMinimap: () => void;
        onToggleBirdsEye: () => void;
        onAdjustSpeed: (delta: 1 | -1) => void;
        onControlGroup?: (group: number, action: 'recall' | 'assign' | 'add') => void;
        /** True while the game is paused: world clicks and gameplay hotkeys are ignored. */
        isPaused?: () => boolean;
        /** Touch tap on the battlefield: select what's there, or command the selection. */
        onTap?: (wx: number, wy: number) => void;
        /** Touch long-press released in place: clear the selection. */
        onClearSelection?: () => void;
        onSetStance?: (stance: AttackStance) => void;
        onToggleAttackMove?: () => void;
        onUngarrison?: () => void;
        onStop?: () => void;
        onSelectArmy?: () => void;
        onCenterOnSelection?: () => void;
        onDoubleClick?: (wx: number, wy: number) => void;
        onTogglePause?: () => void;
        onToggleGraphics?: () => void;
        onCancel?: () => void;
        getZoom: () => number;
        getCamera: () => { x: number; y: number };
    }
) {
    canvas = gameCanvas;
    hasPointerPosition = false;
    onLeftClick = callbacks.onLeftClick;
    onRightClick = callbacks.onRightClick;
    onDeployMCV = callbacks.onDeployMCV;
    onToggleDebug = callbacks.onToggleDebug;
    onToggleMinimap = callbacks.onToggleMinimap;
    onToggleBirdsEye = callbacks.onToggleBirdsEye;
    onAdjustSpeed = callbacks.onAdjustSpeed;
    onControlGroup = callbacks.onControlGroup || null;
    isPaused = callbacks.isPaused || null;
    onTap = callbacks.onTap || null;
    onClearSelection = callbacks.onClearSelection || null;
    onSetStance = callbacks.onSetStance || null;
    onToggleAttackMove = callbacks.onToggleAttackMove || null;
    onUngarrison = callbacks.onUngarrison || null;
    onStop = callbacks.onStop || null;
    onSelectArmy = callbacks.onSelectArmy || null;
    onCenterOnSelection = callbacks.onCenterOnSelection || null;
    onDoubleClick = callbacks.onDoubleClick || null;
    onTogglePause = callbacks.onTogglePause || null;
    onToggleGraphics = callbacks.onToggleGraphics || null;
    onCancel = callbacks.onCancel || null;
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

/** Wheel units per zoom step for the +/- keys and one mouse-wheel notch (zoom *= 0.999^units). */
const KEY_ZOOM_STEP = 150;

/** What a plain (non-pinch) wheel/two-finger scroll does: guessed per event, or forced by the player. */
export type WheelMode = 'auto' | 'zoom' | 'pan';
const WHEEL_MODE_STORAGE_KEY = 'rts.wheelMode';

let wheelMode: WheelMode = loadWheelMode();
// Trackpads send a continuous stream of events (incl. momentum); once a stream looks like a
// trackpad, keep treating it as one so a stray "notch-sized" delta doesn't jump the zoom
const TRACKPAD_STREAM_GAP_MS = 120;
let lastTrackpadEventMs = -Infinity;

function loadWheelMode(): WheelMode {
    try {
        const stored = window.localStorage.getItem(WHEEL_MODE_STORAGE_KEY);
        return stored === 'zoom' || stored === 'pan' ? stored : 'auto';
    } catch {
        return 'auto';
    }
}

export function getWheelMode(): WheelMode {
    return wheelMode;
}

export function setWheelMode(mode: WheelMode): void {
    wheelMode = mode;
    try {
        window.localStorage.setItem(WHEEL_MODE_STORAGE_KEY, mode);
    } catch {
        // Storage unavailable (private mode): the choice lasts for this session only
    }
}

/**
 * Tell a notched mouse wheel (zooms) apart from two-finger trackpad scrolling (pans).
 * Line/page-based deltas are always a wheel; Chromium/WebKit also report pixel deltas for wheels,
 * but in whole notches (wheelDelta multiples of 120) and never with a horizontal component.
 * Not every mouse can be told apart this way (e.g. smooth-scrolling wheels on macOS), which is what
 * the explicit Zoom/Pan setting is for.
 */
function isMouseWheelEvent(e: WheelEvent): boolean {
    if (wheelMode !== 'auto') return wheelMode === 'zoom';
    if (e.deltaMode !== 0) return true;

    const now = performance.now();
    const inTrackpadStream = now - lastTrackpadEventMs < TRACKPAD_STREAM_GAP_MS;
    const legacyDelta = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY;
    const looksNotched = e.deltaX === 0 && typeof legacyDelta === 'number' && legacyDelta !== 0 && legacyDelta % 120 === 0;
    if (looksNotched && !inTrackpadStream) return true;

    lastTrackpadEventMs = now;
    return false;
}

function setupEventListeners() {
    // Keyboard
    window.addEventListener('keydown', e => {
        // Never steal keys from form fields (debug panel inputs, etc.)
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
            // ...except Escape on the pause menu's own controls, which still closes it
            if (e.key === 'Escape' && isPaused?.()) {
                target.blur();
                onCancel?.();
            }
            return;
        }

        if (e.key === 'F3') {
            e.preventDefault(); // Prevent browser's default F3 behavior (find)
            onToggleDebug?.();
            return;
        }
        // Escape backs out of the current mode, overlay or menu (skipped when an overlay already consumed it)
        if (e.key === 'Escape') {
            if (!e.defaultPrevented && !e.repeat) onCancel?.();
            return;
        }
        // Pause game
        if (e.key === ' ' || ((e.key === 'p' || e.key === 'P') && !e.ctrlKey && !e.metaKey && !e.altKey)) {
            e.preventDefault();
            if (!e.repeat) onTogglePause?.();
            return;
        }

        // Track held keys even while paused, so a modifier held across unpausing still counts
        inputState.keys[e.key] = true;

        // Everything below is a gameplay hotkey: inactive while paused
        if (isPaused?.()) return;

        // Game speed: [ slower, ] faster. Matched on the typed character, before the digit keys:
        // on many layouts these need AltGr/Option + a digit key (reported as Ctrl+Alt / Alt)
        if (e.key === '[' || e.key === ']') {
            if (!e.repeat && !e.metaKey) onAdjustSpeed?.(e.key === '[' ? -1 : 1);
            return;
        }

        // Control groups: Ctrl/Cmd+digit assigns (Ctrl+Shift+digit too, for browsers that keep
        // Ctrl+digit for tab switching), Shift+digit adds, digit recalls (twice quickly = jump to it).
        // With Alt held the digit key types something else (AltGr/Option layouts): not a group key
        if (/^Digit[0-9]$/.test(e.code) && !e.altKey) {
            const group = Number(e.code.slice(5));
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                onControlGroup?.(group, 'assign');
            } else if (e.shiftKey) {
                onControlGroup?.(group, 'add');
            } else if (!e.altKey && !e.repeat) {
                onControlGroup?.(group, 'recall');
            }
            return;
        }

        // The remaining hotkeys are plain keys: leave browser/OS shortcuts (Ctrl+F, Cmd+V...) alone
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        // Zoom: + / - (the mouse wheel zooms too)
        if (e.key === '+' || e.key === '=') {
            inputState.wheelZoom -= KEY_ZOOM_STEP;
            return;
        }
        if (e.key === '-' || e.key === '_') {
            inputState.wheelZoom += KEY_ZOOM_STEP;
            return;
        }
        if (e.repeat) return;

        const key = e.key.toLowerCase();
        if (key === 'm') onToggleMinimap?.();
        if (key === 'b') onToggleBirdsEye?.();
        // Deploy MCV key handler
        if (e.key === 'Enter') onDeployMCV?.();
        // Stance controls: F = Aggressive, G = Defensive, H = Hold Ground
        if (key === 'f') onSetStance?.('aggressive');
        if (key === 'g') onSetStance?.('defensive');
        if (key === 'h') onSetStance?.('hold_ground');
        // Attack-move toggle
        if (key === 'a') onToggleAttackMove?.();
        // Ungarrison selected transports
        if (key === 'u') onUngarrison?.();
        // S = stop, Q = select all combat units, C = centre the camera on the selection
        if (key === 's') onStop?.();
        if (key === 'q') onSelectArmy?.();
        if (key === 'c') onCenterOnSelection?.();
        // Switch between the 3D and classic 2D view
        if (key === 'v') onToggleGraphics?.();
    });

    window.addEventListener('keyup', e => {
        inputState.keys[e.key] = false;
    });

    // A key released while the window is unfocused never sends keyup: drop all held keys
    // (otherwise an arrow key keeps scrolling forever), and stop edge-scrolling until the pointer is back
    window.addEventListener('blur', () => {
        inputState.keys = {};
        hasPointerPosition = false;
        // The mouseup that ends a drag box may never arrive either
        inputState.dragStart = null;
        endTouchGesture();
    });
    document.documentElement.addEventListener('mouseleave', () => {
        hasPointerPosition = false;
    });
    // After a resize the last pointer position may now be at an edge: wait for a real move
    window.addEventListener('resize', () => {
        hasPointerPosition = false;
    });

    // Mouse move
    window.addEventListener('mousemove', e => {
        hasPointerPosition = true;
        inputState.rawMouse.x = e.clientX;
        inputState.rawMouse.y = e.clientY;
        const rect = canvas.getBoundingClientRect();
        edgeScrollRect = rect;
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
        hasPointerPosition = true;
        // Only presses on the battlefield itself become world clicks: menus, overlays, the
        // scoreboard and the sidebar sit on top of (or beside) the canvas and handle their own clicks
        if (e.target !== canvas || isPaused?.()) {
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
        if (e.button === 0 && e.target === canvas && !isPaused?.()) {
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
        // Only the battlefield zooms/pans: menus, help, the sidebar and the debug panel scroll normally
        if (e.target !== canvas) {
            // ...but a trackpad pinch over the in-game HUD must not zoom the whole page
            if (e.ctrlKey && document.getElementById('game-container')?.contains(e.target as Node)) e.preventDefault();
            return;
        }

        e.preventDefault();
        if (isPaused?.()) return;
        if (e.ctrlKey) {
            // Pinch to zoom (Mac touchpad)
            inputState.wheelZoom += e.deltaY;
        } else if (isMouseWheelEvent(e)) {
            // A notched mouse wheel zooms (one notch = one zoom step)
            inputState.wheelZoom += Math.sign(e.deltaY) * KEY_ZOOM_STEP;
        } else {
            // Two finger scroll
            inputState.wheelDeltaX += e.deltaX;
            inputState.wheelDeltaY += e.deltaY;
        }
    }, { passive: false });

    // Touch: tap = select / command, one-finger drag = pan, two-finger pinch = zoom
    canvas.addEventListener('touchstart', e => {
        if (e.touches.length === 2) {
            endTouchGesture();
            inputState.touchDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
        } else if (e.touches.length === 1) {
            const t = e.touches[0];
            endTouchGesture();
            const gesture: NonNullable<typeof touchGesture> = {
                startX: t.clientX, startY: t.clientY, lastX: t.clientX, lastY: t.clientY,
                panning: false, holding: false, startMs: performance.now(), holdTimer: null
            };
            gesture.holdTimer = window.setTimeout(() => {
                gesture.holdTimer = null;
                if (touchGesture !== gesture || gesture.panning || isPaused?.()) return;
                // Long press: the finger now draws a selection box (the renderer draws dragStart -> mouse)
                gesture.holding = true;
                navigator.vibrate?.(15); // Feel for the hold where the device supports it
                const rect = canvas.getBoundingClientRect();
                inputState.dragStart = { x: gesture.startX - rect.left, y: gesture.startY - rect.top };
                setMouseFromClient(gesture.lastX, gesture.lastY);
            }, TOUCH_HOLD_MS);
            touchGesture = gesture;
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', e => {
        e.preventDefault();
        if (e.touches.length === 2) {
            const newDist = Math.hypot(
                e.touches[0].clientX - e.touches[1].clientX,
                e.touches[0].clientY - e.touches[1].clientY
            );
            if (inputState.touchDist > 0) {
                const ratio = newDist / inputState.touchDist;
                inputState.pinchRatio *= ratio;
            }
            inputState.touchDist = newDist;
        } else if (e.touches.length === 1 && touchGesture?.holding) {
            const t = e.touches[0];
            setMouseFromClient(t.clientX, t.clientY);
            touchGesture.lastX = t.clientX;
            touchGesture.lastY = t.clientY;
        } else if (e.touches.length === 1 && touchGesture) {
            const t = e.touches[0];
            if (!touchGesture.panning && Math.hypot(t.clientX - touchGesture.startX, t.clientY - touchGesture.startY) > TOUCH_TAP_SLOP) {
                touchGesture.panning = true;
                if (touchGesture.holdTimer != null) window.clearTimeout(touchGesture.holdTimer);
                touchGesture.holdTimer = null;
            }
            if (touchGesture.panning) {
                // Drag the map with the finger
                inputState.wheelDeltaX -= t.clientX - touchGesture.lastX;
                inputState.wheelDeltaY -= t.clientY - touchGesture.lastY;
            }
            touchGesture.lastX = t.clientX;
            touchGesture.lastY = t.clientY;
        }
    }, { passive: false });

    canvas.addEventListener('touchend', e => {
        if (e.touches.length < 2) {
            inputState.touchDist = 0;
        }
        const gesture = touchGesture;
        if (!gesture || e.touches.length > 0) return;
        const wasHolding = gesture.holding;
        const dragStart = inputState.dragStart;
        endTouchGesture();

        // Every one-finger gesture is handled here: suppress the emulated mouse events that would
        // follow (a long press started while paused would otherwise turn into a click)
        e.preventDefault();
        if (wasHolding && dragStart) {
            const moved = Math.hypot(gesture.lastX - gesture.startX, gesture.lastY - gesture.startY) > TOUCH_TAP_SLOP;
            if (!moved) {
                onClearSelection?.();
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const ex = gesture.lastX - rect.left;
            const ey = gesture.lastY - rect.top;
            const p1 = screenToWorld(Math.min(dragStart.x, ex), Math.min(dragStart.y, ey));
            const p2 = screenToWorld(Math.max(dragStart.x, ex), Math.max(dragStart.y, ey));
            const fingerWorld = screenToWorld(ex, ey);
            onLeftClick?.(fingerWorld.x, fingerWorld.y, true, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
            return;
        }
        if (gesture.panning) return;
        if (performance.now() - gesture.startMs > TOUCH_TAP_MAX_MS) return;

        if (isPaused?.()) return;
        const rect = canvas.getBoundingClientRect();
        const world = screenToWorld(gesture.startX - rect.left, gesture.startY - rect.top);
        onTap?.(world.x, world.y);
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => {
        endTouchGesture();
        inputState.touchDist = 0;
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

    // Edge scrolling (only after we've seen a real pointer position): the pointer must be on the
    // battlefield, within 10px of its edge - not over the sidebar or another panel
    if (hasPointerPosition && edgeScrollRect) {
        const rect = edgeScrollRect;
        const { x, y } = inputState.rawMouse;
        const onCanvas = x >= rect.left - 1 && x <= rect.right + 1 && y >= rect.top - 1 && y <= rect.bottom + 1;
        if (onCanvas) {
            if (x < rect.left + 10) dx -= speed;
            if (x > rect.right - 10) dx += speed;
            if (y < rect.top + 10) dy -= speed;
            if (y > rect.bottom - 10) dy += speed;
        }
    }

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

    return clampCamera(camera.x + dx, camera.y + dy, canvasWidth, canvasHeight, zoom, mapWidth, mapHeight);
}

// Panning may go 300 screen px past the map edges, to see units under UI panels
const CAMERA_PAN_BUFFER = 300;

/**
 * Keep the camera (top-left world position) within the map plus the pan buffer. On an axis where
 * the whole map fits in the view, the map is centred instead.
 */
export function clampCamera(
    x: number, y: number,
    viewWidth: number, viewHeight: number,
    zoom: number,
    mapWidth: number, mapHeight: number
): { x: number; y: number } {
    const clampAxis = (value: number, view: number, map: number) => {
        const visible = view / zoom;
        if (visible >= map) return map / 2 - visible / 2;
        const buffer = CAMERA_PAN_BUFFER / zoom;
        return Math.max(-buffer, Math.min(map - visible + buffer, value));
    };
    return { x: clampAxis(x, viewWidth, mapWidth), y: clampAxis(y, viewHeight, mapHeight) };
}

export const MAX_ZOOM = 2.0;
const DEFAULT_MIN_ZOOM = 0.25;

/**
 * The furthest the view may zoom out: 0.25, or further if that is needed to fit the whole map in
 * the view (big maps, small windows).
 */
export function getMinZoom(viewWidth: number, viewHeight: number, mapWidth: number, mapHeight: number): number {
    const fit = Math.min(viewWidth / mapWidth, viewHeight / mapHeight);
    return fit > 0 ? Math.min(DEFAULT_MIN_ZOOM, fit) : DEFAULT_MIN_ZOOM;
}

export function handleZoomInput(currentZoom: number, minZoom: number = DEFAULT_MIN_ZOOM): number {
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

    if (newZoom === currentZoom) return currentZoom;
    return Math.max(minZoom, Math.min(MAX_ZOOM, newZoom));
}

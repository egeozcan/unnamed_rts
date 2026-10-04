import { type Entity, type EntityId, PLAYER_COLORS } from '../engine/types.js';
import { isTransportedUnit } from '../engine/transport.js';

let minimapCtx: CanvasRenderingContext2D | null = null;
let minimapCanvas: HTMLCanvasElement | null = null;
let observerMinimapCtx: CanvasRenderingContext2D | null = null;
let observerMinimapCanvas: HTMLCanvasElement | null = null;
let currentMapWidth = 3000;
let currentMapHeight = 3000;
let onMinimapClick: ((worldX: number, worldY: number) => void) | null = null;
// Returns true when the click was used as an order (so it doesn't also pan)
let onMinimapCommand: ((worldX: number, worldY: number, button: number) => boolean) | null = null;

// "Under attack" pings: expanding rings drawn on the minimap for a couple of seconds
const PING_DURATION_MS = 2500;
const PING_MIN_INTERVAL_MS = 4000;
let pings: { x: number; y: number; startMs: number }[] = [];

/** Flash a ring on the minimap at a world position (throttled, so a long fight doesn't spam rings). */
export function pingMinimap(worldX: number, worldY: number): void {
    const now = performance.now();
    pings = pings.filter(p => now - p.startMs < PING_DURATION_MS);
    if (pings.some(p => now - p.startMs < PING_MIN_INTERVAL_MS)) return;
    pings.push({ x: worldX, y: worldY, startMs: now });
}

// Track if listeners are already attached (for HMR support)
let listenersInitialized = false;

/**
 * Where the map is drawn inside a minimap of the given size: scaled uniformly
 * and centred, so a non-square map isn't stretched to the canvas shape.
 */
export function getMinimapLayout(width: number, height: number, mapWidth: number, mapHeight: number) {
    const scale = Math.min(width / mapWidth, height / mapHeight);
    return {
        scale,
        offsetX: (width - mapWidth * scale) / 2,
        offsetY: (height - mapHeight * scale) / 2
    };
}

function setupClickHandler(canvas: HTMLCanvasElement) {
    let isDragging = false;

    function toWorld(e: MouseEvent): { x: number; y: number } {
        const rect = canvas.getBoundingClientRect();
        const { scale, offsetX, offsetY } = getMinimapLayout(rect.width, rect.height, currentMapWidth, currentMapHeight);
        const x = (e.clientX - rect.left - offsetX) / scale;
        const y = (e.clientY - rect.top - offsetY) / scale;
        return {
            x: Math.max(0, Math.min(currentMapWidth, x)),
            y: Math.max(0, Math.min(currentMapHeight, y))
        };
    }

    function handleMinimapInput(e: MouseEvent) {
        if (!onMinimapClick) return;
        const world = toWorld(e);
        onMinimapClick(world.x, world.y);
    }

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 0 || e.button === 2) {
            const world = toWorld(e);
            if (onMinimapCommand?.(world.x, world.y, e.button)) return;
        }
        if (e.button !== 0) return;
        isDragging = true;
        handleMinimapInput(e);
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    canvas.addEventListener('mousemove', (e) => {
        if (isDragging) {
            handleMinimapInput(e);
        }
    });

    canvas.addEventListener('mouseup', () => {
        isDragging = false;
    });

    canvas.addEventListener('mouseleave', () => {
        isDragging = false;
    });
}

/** Match the canvas bitmap to its displayed size so the minimap is sharp. */
function syncCanvasSize(canvas: HTMLCanvasElement): number {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    return dpr;
}

function isCanvasVisible(canvas: HTMLCanvasElement): boolean {
    return canvas.offsetParent !== null && canvas.width > 0 && canvas.height > 0;
}


export function initMinimap() {
    // Regular sidebar minimap
    minimapCanvas = document.getElementById('minimapCanvas') as HTMLCanvasElement;
    if (minimapCanvas) {
        minimapCtx = minimapCanvas.getContext('2d');
    }

    // Observer mode floating minimap
    observerMinimapCanvas = document.getElementById('observerMinimapCanvas') as HTMLCanvasElement;
    if (observerMinimapCanvas) {
        observerMinimapCtx = observerMinimapCanvas.getContext('2d');
    }

    // Only set up listeners once - callbacks are updated via module variables (for HMR support)
    if (!listenersInitialized) {
        if (minimapCanvas) {
            setupClickHandler(minimapCanvas);
        }
        if (observerMinimapCanvas) {
            setupClickHandler(observerMinimapCanvas);
        }
        listenersInitialized = true;
    }
}

export function setMinimapClickHandler(handler: (worldX: number, worldY: number) => void) {
    onMinimapClick = handler;
}

/** Orders given on the minimap: right-click (button 2), or left-click (button 0) in a command mode. */
export function setMinimapCommandHandler(handler: (worldX: number, worldY: number, button: number) => boolean) {
    onMinimapCommand = handler;
}

function renderToContext(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    entities: Record<EntityId, Entity>,
    camera: { x: number; y: number },
    zoom: number,
    canvasWidth: number,
    canvasHeight: number,
    lowPower: boolean,
    mapWidth: number,
    mapHeight: number,
    fogGrid?: Uint8Array,
    fogGridW?: number
) {
    // Draw in CSS pixels on a bitmap sized for the device pixel ratio
    const dpr = syncCanvasSize(canvas);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    // Low power no longer blanks frames: the minimap stays readable and the steady
    // #low-power-warning overlay/label (styles.css) communicates the state instead.
    void lowPower;

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    // Uniform scale, centred, so the map keeps its shape
    const { scale, offsetX, offsetY } = getMinimapLayout(width, height, mapWidth, mapHeight);
    const sx = scale;
    const sy = scale;
    ctx.fillStyle = '#0b0f0b';
    ctx.fillRect(offsetX, offsetY, mapWidth * scale, mapHeight * scale);
    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX, offsetY, mapWidth * scale, mapHeight * scale);
    ctx.clip();
    ctx.translate(offsetX, offsetY);

    // Draw entities
    const time = Date.now();
    for (const id in entities) {
        const e = entities[id];
        if (e.dead) continue;
        if (isTransportedUnit(e)) continue;

        // Fog of war check — skip entities on unrevealed tiles
        if (fogGrid && fogGridW) {
            const tileX = Math.floor(e.pos.x / 40);
            const tileY = Math.floor(e.pos.y / 40);
            if (fogGrid[tileY * fogGridW + tileX] === 0) continue;
        }

        // Check for induction rig - render with glow
        if (e.type === 'BUILDING' && e.key === 'induction_rig_deployed') {
            // Pulsing glow effect
            const pulse = 0.5 + 0.5 * Math.sin(time / 300);
            const glowRadius = 6 + pulse * 4;
            const x = e.pos.x * sx;
            const y = e.pos.y * sy;

            // Outer glow
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
            gradient.addColorStop(0, `rgba(0, 255, 200, ${0.8 * pulse})`);
            gradient.addColorStop(0.5, `rgba(0, 200, 150, ${0.4 * pulse})`);
            gradient.addColorStop(1, 'rgba(0, 150, 100, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
            ctx.fill();

            // Core
            ctx.fillStyle = '#00ffc8';
            ctx.fillRect(x - 2, y - 2, 4, 4);
            continue;
        }

        // Check for demo truck - render with danger glow
        if (e.type === 'UNIT' && e.key === 'demo_truck') {
            // Pulsing danger glow effect (faster pulse for urgency)
            const pulse = 0.5 + 0.5 * Math.sin(time / 150);
            const glowRadius = 5 + pulse * 3;
            const x = e.pos.x * sx;
            const y = e.pos.y * sy;

            // Outer danger glow (red/orange)
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
            gradient.addColorStop(0, `rgba(255, 100, 0, ${0.9 * pulse})`);
            gradient.addColorStop(0.5, `rgba(255, 50, 0, ${0.5 * pulse})`);
            gradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
            ctx.fill();

            // Core with player color
            const playerColor = e.owner >= 0 && e.owner < PLAYER_COLORS.length
                ? PLAYER_COLORS[e.owner]
                : '#ff6600';
            ctx.fillStyle = playerColor;
            ctx.fillRect(x - 2, y - 2, 4, 4);
            continue;
        }

        if (e.owner >= 0 && e.owner < PLAYER_COLORS.length) {
            ctx.fillStyle = PLAYER_COLORS[e.owner];
        } else if (e.type === 'ROCK') {
            ctx.fillStyle = '#555';
        } else if (e.type === 'WELL') {
            ctx.fillStyle = '#ffd700'; // Gold color for wells
        } else {
            ctx.fillStyle = '#aa0';
        }

        ctx.fillRect(e.pos.x * sx - 1.5, e.pos.y * sy - 1.5, 3, 3);
    }

    // Draw fog overlay on minimap
    if (fogGrid && fogGridW) {
        const fogGridH = Math.ceil(mapHeight / 40);
        ctx.fillStyle = '#000';
        for (let ty = 0; ty < fogGridH; ty++) {
            for (let tx = 0; tx < fogGridW; tx++) {
                if (fogGrid[ty * fogGridW + tx] === 0) {
                    ctx.fillRect(tx * 40 * sx, ty * 40 * sy, 40 * sx + 1, 40 * sy + 1);
                }
            }
        }
    }

    // Under-attack pings
    const nowMs = performance.now();
    for (const p of pings) {
        const t = (nowMs - p.startMs) / PING_DURATION_MS;
        if (t < 0 || t >= 1) continue;
        ctx.strokeStyle = `rgba(255, 60, 60, ${1 - t})`;
        ctx.lineWidth = 2;
        for (const phase of [0, 0.5]) {
            const r = 4 + ((t * 2 + phase) % 1) * 14;
            ctx.beginPath();
            ctx.arc(p.x * sx, p.y * sy, r, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    // Draw viewport rectangle
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
        camera.x * sx,
        camera.y * sy,
        (canvasWidth / zoom) * sx,
        (canvasHeight / zoom) * sy
    );
    ctx.restore();
}

export function renderMinimap(
    entities: Record<EntityId, Entity>,
    camera: { x: number; y: number },
    zoom: number,
    canvasWidth: number,
    canvasHeight: number,
    lowPower: boolean,
    mapWidth: number = 3000,
    mapHeight: number = 3000,
    fogGrid?: Uint8Array,
    fogGridW?: number
) {
    // Store current map size for click handling
    currentMapWidth = mapWidth;
    currentMapHeight = mapHeight;

    // Render to regular minimap if visible
    if (minimapCtx && minimapCanvas && isCanvasVisible(minimapCanvas)) {
        renderToContext(minimapCtx, minimapCanvas, entities, camera, zoom, canvasWidth, canvasHeight, lowPower, mapWidth, mapHeight, fogGrid, fogGridW);
    }

    // Render to observer minimap if visible
    if (observerMinimapCtx && observerMinimapCanvas && isCanvasVisible(observerMinimapCanvas)) {
        renderToContext(observerMinimapCtx, observerMinimapCanvas, entities, camera, zoom, canvasWidth, canvasHeight, false, mapWidth, mapHeight, fogGrid, fogGridW);
    }
}

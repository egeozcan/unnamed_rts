import { Entity, EntityId, PLAYER_COLORS } from '../engine/types.js';

let minimapCtx: CanvasRenderingContext2D | null = null;
let minimapCanvas: HTMLCanvasElement | null = null;
let observerMinimapCtx: CanvasRenderingContext2D | null = null;
let observerMinimapCanvas: HTMLCanvasElement | null = null;
let currentMapWidth = 3000;
let currentMapHeight = 3000;
let onMinimapClick: ((worldX: number, worldY: number) => void) | null = null;

// Track if listeners are already attached (for HMR support)
let listenersInitialized = false;

function setupClickHandler(canvas: HTMLCanvasElement) {
    let isDragging = false;

    function handleMinimapInput(e: MouseEvent) {
        if (!onMinimapClick) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Convert minimap coords to world coords
        const worldX = (x / rect.width) * currentMapWidth;
        const worldY = (y / rect.height) * currentMapHeight;

        onMinimapClick(worldX, worldY);
    }

    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        handleMinimapInput(e);
    });

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
    mapHeight: number
) {
    const width = canvas.width;
    const height = canvas.height;

    // Low power flicker effect (only for sidebar minimap)
    if (lowPower && Math.random() > 0.7) {
        ctx.fillStyle = Math.random() > 0.5 ? '#111' : '#222';
        ctx.fillRect(0, 0, width, height);
        return;
    }

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const sx = width / mapWidth;
    const sy = height / mapHeight;

    // Draw entities
    const time = Date.now();
    for (const id in entities) {
        const e = entities[id];
        if (e.dead) continue;

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

        ctx.fillRect(e.pos.x * sx, e.pos.y * sy, 3, 3);
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
}

export function renderMinimap(
    entities: Record<EntityId, Entity>,
    camera: { x: number; y: number },
    zoom: number,
    canvasWidth: number,
    canvasHeight: number,
    lowPower: boolean,
    mapWidth: number = 3000,
    mapHeight: number = 3000
) {
    // Store current map size for click handling
    currentMapWidth = mapWidth;
    currentMapHeight = mapHeight;

    // Render to regular minimap if visible
    if (minimapCtx && minimapCanvas && isCanvasVisible(minimapCanvas)) {
        renderToContext(minimapCtx, minimapCanvas, entities, camera, zoom, canvasWidth, canvasHeight, lowPower, mapWidth, mapHeight);
    }

    // Render to observer minimap if visible
    if (observerMinimapCtx && observerMinimapCanvas && isCanvasVisible(observerMinimapCanvas)) {
        renderToContext(observerMinimapCtx, observerMinimapCanvas, entities, camera, zoom, canvasWidth, canvasHeight, false, mapWidth, mapHeight);
    }
}

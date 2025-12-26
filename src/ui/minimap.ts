import { Entity, PLAYER_COLORS } from '../engine/types.js';

let minimapCtx: CanvasRenderingContext2D | null = null;
let minimapCanvas: HTMLCanvasElement | null = null;
let observerMinimapCtx: CanvasRenderingContext2D | null = null;
let observerMinimapCanvas: HTMLCanvasElement | null = null;
let currentMapWidth = 3000;
let currentMapHeight = 3000;
let onMinimapClick: ((worldX: number, worldY: number) => void) | null = null;

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


export function initMinimap() {
    // Regular sidebar minimap
    minimapCanvas = document.getElementById('minimapCanvas') as HTMLCanvasElement;
    if (minimapCanvas) {
        minimapCtx = minimapCanvas.getContext('2d');
        setupClickHandler(minimapCanvas);
    }

    // Observer mode floating minimap
    observerMinimapCanvas = document.getElementById('observerMinimapCanvas') as HTMLCanvasElement;
    if (observerMinimapCanvas) {
        observerMinimapCtx = observerMinimapCanvas.getContext('2d');
        setupClickHandler(observerMinimapCanvas);
    }
}

export function setMinimapClickHandler(handler: (worldX: number, worldY: number) => void) {
    onMinimapClick = handler;
}

function renderToContext(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    entities: Entity[],
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
    for (const e of entities) {
        if (e.dead) continue;

        if (e.owner >= 0 && e.owner < PLAYER_COLORS.length) {
            ctx.fillStyle = PLAYER_COLORS[e.owner];
        } else if (e.type === 'ROCK') {
            ctx.fillStyle = '#555';
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
    entities: Entity[],
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
    if (minimapCtx && minimapCanvas) {
        renderToContext(minimapCtx, minimapCanvas, entities, camera, zoom, canvasWidth, canvasHeight, lowPower, mapWidth, mapHeight);
    }

    // Render to observer minimap if visible
    if (observerMinimapCtx && observerMinimapCanvas) {
        renderToContext(observerMinimapCtx, observerMinimapCanvas, entities, camera, zoom, canvasWidth, canvasHeight, false, mapWidth, mapHeight);
    }
}

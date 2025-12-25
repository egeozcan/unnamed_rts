import { Entity, MAP_WIDTH, MAP_HEIGHT } from '../engine/types.js';

let minimapCtx: CanvasRenderingContext2D | null = null;
let minimapCanvas: HTMLCanvasElement | null = null;

export function initMinimap() {
    minimapCanvas = document.getElementById('minimapCanvas') as HTMLCanvasElement;
    if (minimapCanvas) {
        minimapCtx = minimapCanvas.getContext('2d');
    }
}

export function renderMinimap(
    entities: Entity[],
    camera: { x: number; y: number },
    zoom: number,
    canvasWidth: number,
    canvasHeight: number,
    lowPower: boolean
) {
    if (!minimapCtx || !minimapCanvas) return;

    const ctx = minimapCtx;
    const width = minimapCanvas.width;
    const height = minimapCanvas.height;

    // Low power flicker effect
    if (lowPower && Math.random() > 0.7) {
        ctx.fillStyle = Math.random() > 0.5 ? '#111' : '#222';
        ctx.fillRect(0, 0, width, height);
        return;
    }

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);

    const sx = width / MAP_WIDTH;
    const sy = height / MAP_HEIGHT;

    // Draw entities
    for (const e of entities) {
        if (e.dead) continue;

        if (e.owner === 0) {
            ctx.fillStyle = '#0f0';
        } else if (e.owner === 1) {
            ctx.fillStyle = '#f00';
        } else {
            ctx.fillStyle = '#aa0'; // Neutral/resources
        }

        ctx.fillRect(e.pos.x * sx, e.pos.y * sy, 3, 3);
    }

    // Draw viewport rectangle
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(
        camera.x * sx,
        camera.y * sy,
        (canvasWidth / zoom) * sx,
        (canvasHeight / zoom) * sy
    );
}

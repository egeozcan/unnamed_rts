import { Entity, GameState, PLAYER_COLORS, PlayerState, EntityId } from '../engine/types.js';
import { RULES } from '../data/schemas/index.js';

// Module state
let birdsEyeOverlay: HTMLDivElement | null = null;
let birdsEyeCanvas: HTMLCanvasElement | null = null;
let birdsEyeCtx: CanvasRenderingContext2D | null = null;
let onBirdsEyeClick: ((worldX: number, worldY: number) => void) | null = null;
let onClose: (() => void) | null = null;
let currentMapWidth = 3000;
let currentMapHeight = 3000;

// Entity categorization
type EntityCategory = 'infantry' | 'vehicle' | 'air' | 'building_base' | 'building_defense' | 'resource' | 'rock' | 'well';

// Defense building keys
const DEFENSE_KEYS = ['turret', 'sam_site', 'pillbox', 'obelisk'];

function categorizeEntity(entity: Entity): EntityCategory {
    if (entity.type === 'RESOURCE') return 'resource';
    if (entity.type === 'ROCK') return 'rock';
    if (entity.type === 'WELL') return 'well';

    if (entity.type === 'UNIT') {
        // Check rules.json for unit type
        const unitData = RULES.units[entity.key];
        if (unitData?.type === 'infantry') return 'infantry';
        if (unitData?.type === 'air') return 'air';
        return 'vehicle';
    }

    if (entity.type === 'BUILDING') {
        if (DEFENSE_KEYS.includes(entity.key)) return 'building_defense';
        return 'building_base';
    }

    return 'resource';
}

// Shape configuration for different entity types
const SHAPE_CONFIG: Record<EntityCategory, { size: number; shape: 'circle' | 'rect' | 'diamond' | 'triangle' }> = {
    infantry: { size: 4, shape: 'circle' },
    vehicle: { size: 8, shape: 'rect' },
    air: { size: 6, shape: 'diamond' },
    building_base: { size: 14, shape: 'rect' },
    building_defense: { size: 10, shape: 'triangle' },
    resource: { size: 4, shape: 'circle' },
    rock: { size: 6, shape: 'rect' },
    well: { size: 8, shape: 'circle' },
};

function drawShape(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    size: number,
    shape: 'circle' | 'rect' | 'diamond' | 'triangle',
    color: string
) {
    ctx.fillStyle = color;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1;

    switch (shape) {
        case 'circle':
            ctx.beginPath();
            ctx.arc(x, y, size / 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            break;
        case 'rect':
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
            ctx.strokeRect(x - size / 2, y - size / 2, size, size);
            break;
        case 'diamond':
            ctx.beginPath();
            ctx.moveTo(x, y - size / 2);
            ctx.lineTo(x + size / 2, y);
            ctx.lineTo(x, y + size / 2);
            ctx.lineTo(x - size / 2, y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            break;
        case 'triangle':
            ctx.beginPath();
            ctx.moveTo(x, y - size / 2);
            ctx.lineTo(x + size / 2, y + size / 2);
            ctx.lineTo(x - size / 2, y + size / 2);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            break;
    }
}

interface PlayerStats {
    infantry: number;
    vehicles: number;
    buildings: number;
    defenses: number;
}

function computePlayerStats(entities: Record<EntityId, Entity>, players: Record<number, PlayerState>): Record<number, PlayerStats> {
    const stats: Record<number, PlayerStats> = {};

    for (const pid in players) {
        stats[parseInt(pid)] = {
            infantry: 0,
            vehicles: 0,
            buildings: 0,
            defenses: 0,
        };
    }

    for (const id in entities) {
        const e = entities[id];
        if (e.dead || e.owner < 0) continue;

        const s = stats[e.owner];
        if (!s) continue;

        const category = categorizeEntity(e);
        switch (category) {
            case 'infantry':
                s.infantry++;
                break;
            case 'vehicle':
            case 'air':
                s.vehicles++;
                break;
            case 'building_base':
                s.buildings++;
                break;
            case 'building_defense':
                s.defenses++;
                break;
        }
    }

    return stats;
}

function renderLegend(stats: Record<number, PlayerStats>, players: Record<number, PlayerState>) {
    const legendEl = document.getElementById('birds-eye-legend');
    if (!legendEl) return;

    let html = '<div class="legend-grid">';

    // Sort players by ID
    const sortedPids = Object.keys(stats).map(Number).sort((a, b) => a - b);

    for (const pid of sortedPids) {
        const player = players[pid];
        if (!player) continue;

        const s = stats[pid];
        const color = player.color || PLAYER_COLORS[pid] || '#888';

        html += `
            <div class="legend-player" style="border-left: 4px solid ${color}">
                <div class="legend-player-name" style="color: ${color}">P${pid + 1}</div>
                <div class="legend-stats">
                    <span title="Infantry">Inf: ${s.infantry}</span>
                    <span title="Vehicles">Veh: ${s.vehicles}</span>
                    <span title="Buildings">Bld: ${s.buildings}</span>
                    <span title="Defenses">Def: ${s.defenses}</span>
                </div>
            </div>
        `;
    }

    html += '</div>';
    legendEl.innerHTML = html;
}

export function initBirdsEye() {
    // Create overlay if it doesn't exist
    birdsEyeOverlay = document.getElementById('birds-eye-overlay') as HTMLDivElement;
    if (!birdsEyeOverlay) {
        birdsEyeOverlay = document.createElement('div');
        birdsEyeOverlay.id = 'birds-eye-overlay';
        birdsEyeOverlay.innerHTML = `
            <div class="birds-eye-header">
                <span class="birds-eye-title">TACTICAL OVERVIEW</span>
                <span class="birds-eye-hint">Click to jump | Press B or ESC to close</span>
            </div>
            <div class="birds-eye-content">
                <canvas id="birdsEyeCanvas"></canvas>
                <div id="birds-eye-legend" class="birds-eye-legend"></div>
            </div>
        `;
        birdsEyeOverlay.style.display = 'none';
        document.body.appendChild(birdsEyeOverlay);
    }

    birdsEyeCanvas = document.getElementById('birdsEyeCanvas') as HTMLCanvasElement;
    if (birdsEyeCanvas) {
        birdsEyeCtx = birdsEyeCanvas.getContext('2d');
        setupClickHandler();
    }
}

function setupClickHandler() {
    if (!birdsEyeCanvas) return;

    birdsEyeCanvas.addEventListener('click', (e) => {
        const rect = birdsEyeCanvas!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Convert to world coordinates
        const worldX = (x / rect.width) * currentMapWidth;
        const worldY = (y / rect.height) * currentMapHeight;

        if (onBirdsEyeClick) {
            onBirdsEyeClick(worldX, worldY);
        }
        if (onClose) {
            onClose();
        }
    });

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && birdsEyeOverlay?.style.display !== 'none') {
            if (onClose) onClose();
        }
    });
}

export function setBirdsEyeClickHandler(handler: (worldX: number, worldY: number) => void) {
    onBirdsEyeClick = handler;
}

export function setBirdsEyeCloseHandler(handler: () => void) {
    onClose = handler;
}

export function renderBirdsEye(state: GameState, canvasWidth: number, canvasHeight: number) {
    if (!state.showBirdsEye) {
        if (birdsEyeOverlay) birdsEyeOverlay.style.display = 'none';
        return;
    }

    if (!birdsEyeOverlay || !birdsEyeCanvas || !birdsEyeCtx) {
        initBirdsEye();
        if (!birdsEyeCanvas || !birdsEyeCtx) return;
    }

    birdsEyeOverlay!.style.display = 'flex';

    // Calculate canvas size to fit screen with padding
    const padding = 80;
    const headerHeight = 60;
    const legendHeight = 60;
    const availableWidth = window.innerWidth - padding * 2;
    const availableHeight = window.innerHeight - padding * 2 - headerHeight - legendHeight;

    currentMapWidth = state.config.width;
    currentMapHeight = state.config.height;

    // Maintain aspect ratio
    const mapAspect = currentMapWidth / currentMapHeight;
    const screenAspect = availableWidth / availableHeight;

    let viewWidth: number, viewHeight: number;
    if (mapAspect > screenAspect) {
        viewWidth = availableWidth;
        viewHeight = availableWidth / mapAspect;
    } else {
        viewHeight = availableHeight;
        viewWidth = availableHeight * mapAspect;
    }

    birdsEyeCanvas.width = viewWidth;
    birdsEyeCanvas.height = viewHeight;
    birdsEyeCanvas.style.width = viewWidth + 'px';
    birdsEyeCanvas.style.height = viewHeight + 'px';

    const ctx = birdsEyeCtx;
    const sx = viewWidth / currentMapWidth;
    const sy = viewHeight / currentMapHeight;

    // Clear with dark background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    // Draw grid lines for reference
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    const gridSize = 500;
    for (let x = 0; x <= currentMapWidth; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x * sx, 0);
        ctx.lineTo(x * sx, viewHeight);
        ctx.stroke();
    }
    for (let y = 0; y <= currentMapHeight; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y * sy);
        ctx.lineTo(viewWidth, y * sy);
        ctx.stroke();
    }

    // Get entities and sort for proper layering
    const entities = Object.values(state.entities).filter(e => !e.dead);

    // Sort order: resources/rocks first, then buildings, then units
    const layerOrder: Record<EntityCategory, number> = {
        resource: 0,
        rock: 1,
        well: 2,
        building_base: 3,
        building_defense: 4,
        infantry: 5,
        vehicle: 6,
        air: 7,
    };

    const sortedEntities = entities.sort((a, b) => {
        return layerOrder[categorizeEntity(a)] - layerOrder[categorizeEntity(b)];
    });

    // Draw entities
    for (const e of sortedEntities) {
        const category = categorizeEntity(e);
        const config = SHAPE_CONFIG[category];

        let color: string;
        if (e.owner >= 0 && e.owner < PLAYER_COLORS.length) {
            color = PLAYER_COLORS[e.owner];
        } else if (category === 'rock') {
            color = '#555';
        } else if (category === 'well') {
            color = '#ffd700';
        } else {
            color = '#aa0'; // Resources
        }

        // Scale size based on canvas scale for visibility
        const scaleFactor = Math.max(sx, sy);
        const scaledSize = Math.max(config.size * scaleFactor, config.size * 0.8);

        drawShape(ctx, e.pos.x * sx, e.pos.y * sy, scaledSize, config.shape, color);
    }

    // Draw current viewport rectangle
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    const viewportWidth = canvasWidth / state.zoom;
    const viewportHeight = canvasHeight / state.zoom;
    ctx.strokeRect(
        state.camera.x * sx,
        state.camera.y * sy,
        viewportWidth * sx,
        viewportHeight * sy
    );
    ctx.setLineDash([]);

    // Update legend with player stats
    const stats = computePlayerStats(state.entities, state.players);
    renderLegend(stats, state.players);
}

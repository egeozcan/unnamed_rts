import { Entity, GameState, GameMode, PLAYER_COLORS, PlayerState, EntityId } from '../engine/types.js';
import { RULES } from '../data/schemas/index.js';
import { getAIState } from '../engine/ai/index.js';

// Module state
let birdsEyeOverlay: HTMLDivElement | null = null;
let birdsEyeCanvas: HTMLCanvasElement | null = null;
let birdsEyeCtx: CanvasRenderingContext2D | null = null;
let onBirdsEyeClick: ((worldX: number, worldY: number) => void) | null = null;
let onClose: (() => void) | null = null;
let currentMapWidth = 3000;
let currentMapHeight = 3000;
let mousePos: { x: number; y: number } | null = null;
let hoveredEntity: Entity | null = null;

// Track if listeners are already attached (for HMR support)
let listenersInitialized = false;

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
    air: number;
    buildings: number;
    defenses: number;
}

function computePlayerStats(entities: Record<EntityId, Entity>, players: Record<number, PlayerState>): Record<number, PlayerStats> {
    const stats: Record<number, PlayerStats> = {};

    for (const pid in players) {
        stats[parseInt(pid)] = {
            infantry: 0,
            vehicles: 0,
            air: 0,
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
                s.vehicles++;
                break;
            case 'air':
                s.air++;
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

// Strategy display colors
const STRATEGY_COLORS: Record<string, string> = {
    'buildup': '#4af',
    'attack': '#f44',
    'defend': '#ff4',
    'harass': '#f84',
    'all_in': '#f00'
};

const PRIORITY_COLORS: Record<string, string> = {
    'economy': '#4f4',
    'warfare': '#f44',
    'defense': '#ff4',
    'balanced': '#aaa'
};

function renderLegend(stats: Record<number, PlayerStats>, players: Record<number, PlayerState>, mode: GameMode) {
    const legendEl = document.getElementById('birds-eye-legend');
    if (!legendEl) return;

    const isObserver = mode === 'demo';
    let html = '<div class="legend-grid">';

    // Sort players by ID
    const sortedPids = Object.keys(stats).map(Number).sort((a, b) => a - b);

    for (const pid of sortedPids) {
        const player = players[pid];
        if (!player) continue;

        const s = stats[pid];
        const color = player.color || PLAYER_COLORS[pid] || '#888';

        // Determine if player is defeated (no buildings or units)
        const totalUnits = s.infantry + s.vehicles + s.air;
        const totalBuildings = s.buildings + s.defenses;
        const isDefeated = totalUnits === 0 && totalBuildings === 0;

        // Power status
        const powerOut = player.maxPower;
        const powerIn = player.usedPower;
        const lowPower = powerIn > powerOut;
        const powerClass = lowPower ? 'low-power' : '';

        // Format credits
        const credits = Math.floor(player.credits);

        // AI state info for observer mode
        let aiStateHtml = '';
        let tooltipData = '';
        if (player.isAi && isObserver && !isDefeated) {
            const aiState = getAIState(pid);
            const strategyColor = STRATEGY_COLORS[aiState.strategy] || '#888';
            const priorityColor = PRIORITY_COLORS[aiState.investmentPriority] || '#888';

            // Compact AI state display
            aiStateHtml = `
                <div class="legend-ai-state">
                    <span class="ai-badge" style="background: ${strategyColor}" title="Strategy">${aiState.strategy.toUpperCase()}</span>
                    <span class="ai-badge" style="background: ${priorityColor}" title="Priority">${aiState.investmentPriority.slice(0, 4).toUpperCase()}</span>
                    <span class="ai-personality" title="Personality">${aiState.personality}</span>
                </div>
            `;

            // Tooltip data for hover (detailed AI state)
            tooltipData = `data-ai-tooltip="Strategy: ${aiState.strategy}&#10;Priority: ${aiState.investmentPriority}&#10;Personality: ${aiState.personality}&#10;Threat: ${aiState.threatLevel}%&#10;Economy: ${aiState.economyScore}%&#10;Attack Group: ${aiState.attackGroup.length}&#10;Defense Group: ${aiState.defenseGroup.length}&#10;Threats Near Base: ${aiState.threatsNearBase.length}"`;
        }

        html += `
            <div class="legend-player${isDefeated ? ' defeated' : ''}" style="border-left: 4px solid ${color}" ${tooltipData}>
                <div class="legend-player-header">
                    <div class="legend-player-name" style="color: ${color}">P${pid + 1}${player.isAi ? ' (AI)' : ''}${isDefeated ? ' - DEFEATED' : ''}</div>
                    <div class="legend-player-resources">
                        <span class="legend-credits" title="Credits">$${credits}</span>
                        <span class="legend-power ${powerClass}" title="Power (Generated/Used)">⚡${powerOut}/${powerIn}</span>
                    </div>
                </div>
                <div class="legend-stats">
                    <span title="Infantry">🚶${s.infantry}</span>
                    <span title="Vehicles">🚗${s.vehicles}</span>
                    <span title="Aircraft">✈️${s.air}</span>
                    <span title="Buildings">🏠${s.buildings}</span>
                    <span title="Defenses">🗼${s.defenses}</span>
                </div>
                ${aiStateHtml}
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
                <div>
                    <span class="birds-eye-title">TACTICAL OVERVIEW</span>
                    <span id="birds-eye-tick" style="color: #888; font-family: 'Courier New', monospace; font-size: 16px; margin-left: 15px; font-weight: bold;"></span>
                </div>
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
    }

    // Only set up listeners once - callbacks are updated via module variables (for HMR support)
    if (!listenersInitialized) {
        setupClickHandler();
        listenersInitialized = true;
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

    // Track mouse position for tooltips
    birdsEyeCanvas.addEventListener('mousemove', (e) => {
        const rect = birdsEyeCanvas!.getBoundingClientRect();
        mousePos = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    });

    birdsEyeCanvas.addEventListener('mouseleave', () => {
        mousePos = null;
        hoveredEntity = null;
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

    const tickEl = document.getElementById('birds-eye-tick');
    if (tickEl) {
        tickEl.textContent = `TICK: ${state.tick}`;
    }

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
    const time = Date.now();
    for (const e of sortedEntities) {
        const category = categorizeEntity(e);
        const config = SHAPE_CONFIG[category];

        // Check for induction rig - render with glow
        if (e.type === 'BUILDING' && e.key === 'induction_rig_deployed') {
            const pulse = 0.5 + 0.5 * Math.sin(time / 300);
            const x = e.pos.x * sx;
            const y = e.pos.y * sy;
            const baseSize = Math.max(config.size * Math.max(sx, sy), config.size * 0.8);
            const glowRadius = baseSize + pulse * 8;

            // Outer glow
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
            gradient.addColorStop(0, `rgba(0, 255, 200, ${0.9 * pulse})`);
            gradient.addColorStop(0.4, `rgba(0, 220, 170, ${0.5 * pulse})`);
            gradient.addColorStop(1, 'rgba(0, 150, 100, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
            ctx.fill();

            // Core with player color tint
            const playerColor = e.owner >= 0 && e.owner < PLAYER_COLORS.length
                ? PLAYER_COLORS[e.owner]
                : '#00ffc8';
            drawShape(ctx, x, y, baseSize, 'rect', '#00ffc8');
            ctx.strokeStyle = playerColor;
            ctx.lineWidth = 2;
            ctx.strokeRect(x - baseSize / 2, y - baseSize / 2, baseSize, baseSize);
            continue;
        }

        // Check for demo truck - render with danger glow
        if (e.type === 'UNIT' && e.key === 'demo_truck') {
            const pulse = 0.5 + 0.5 * Math.sin(time / 150);
            const x = e.pos.x * sx;
            const y = e.pos.y * sy;
            const baseSize = Math.max(config.size * Math.max(sx, sy), config.size * 0.8);
            const glowRadius = baseSize + pulse * 10;

            // Outer danger glow (red/orange pulsing)
            const gradient = ctx.createRadialGradient(x, y, 0, x, y, glowRadius);
            gradient.addColorStop(0, `rgba(255, 100, 0, ${0.9 * pulse})`);
            gradient.addColorStop(0.4, `rgba(255, 50, 0, ${0.5 * pulse})`);
            gradient.addColorStop(1, 'rgba(200, 0, 0, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
            ctx.fill();

            // Diamond shape core with player color
            const playerColor = e.owner >= 0 && e.owner < PLAYER_COLORS.length
                ? PLAYER_COLORS[e.owner]
                : '#ff6600';
            drawShape(ctx, x, y, baseSize, 'diamond', playerColor);

            // Warning stripes overlay
            ctx.strokeStyle = '#ffff00';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y - baseSize / 2);
            ctx.lineTo(x + baseSize / 2, y);
            ctx.lineTo(x, y + baseSize / 2);
            ctx.lineTo(x - baseSize / 2, y);
            ctx.closePath();
            ctx.stroke();
            continue;
        }

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
    renderLegend(stats, state.players, state.mode);

    // Handle tooltip hover detection and drawing
    if (mousePos && birdsEyeCanvas) {
        // Convert mouse position to world coordinates
        const worldX = (mousePos.x / viewWidth) * currentMapWidth;
        const worldY = (mousePos.y / viewHeight) * currentMapHeight;

        // Find entity under mouse cursor
        hoveredEntity = null;
        let closestDist = Infinity;

        for (const e of sortedEntities) {
            // Only show tooltips for units and buildings
            if (e.type !== 'UNIT' && e.type !== 'BUILDING') continue;

            const dist = Math.sqrt(Math.pow(e.pos.x - worldX, 2) + Math.pow(e.pos.y - worldY, 2));
            const category = categorizeEntity(e);
            const config = SHAPE_CONFIG[category];
            // Use a reasonable hit radius based on entity size
            const hitRadius = Math.max(config.size * 2, 20);

            if (dist < hitRadius && dist < closestDist) {
                closestDist = dist;
                hoveredEntity = e;
            }
        }

        // Draw tooltip if hovering over an entity
        if (hoveredEntity) {
            drawTooltip(ctx, hoveredEntity, mousePos, viewWidth, viewHeight);
        }
    }
}

function drawTooltip(
    ctx: CanvasRenderingContext2D,
    entity: Entity,
    mouse: { x: number; y: number },
    canvasWidth: number,
    canvasHeight: number
) {
    let name = '';
    if (entity.type === 'BUILDING' && RULES.buildings[entity.key]) {
        name = RULES.buildings[entity.key].name;
    } else if (entity.type === 'UNIT' && RULES.units[entity.key]) {
        name = RULES.units[entity.key].name;
    }

    if (!name) return;

    ctx.save();
    ctx.font = '12px "Segoe UI", Arial, sans-serif';

    // Show entity info
    const healthPercent = entity.maxHp > 0 ? Math.round((entity.hp / entity.maxHp) * 100) : 100;
    const healthLine = `HP: ${Math.round(entity.hp)}/${entity.maxHp} (${healthPercent}%)`;
    const ownerLine = `Player ${entity.owner + 1}`;

    const metrics = ctx.measureText(name);
    const healthMetrics = ctx.measureText(healthLine);
    const ownerMetrics = ctx.measureText(ownerLine);
    const padding = 8;
    const w = Math.max(metrics.width, healthMetrics.width, ownerMetrics.width) + padding * 2;
    const h = 56;
    const x = mouse.x + 16;
    const y = mouse.y + 16;

    // Keep tooltip on screen
    const finalX = Math.min(x, canvasWidth - w - 10);
    const finalY = Math.min(y, canvasHeight - h - 10);

    // Background
    const playerColor = entity.owner >= 0 && entity.owner < PLAYER_COLORS.length
        ? PLAYER_COLORS[entity.owner]
        : '#888';
    ctx.fillStyle = 'rgba(20, 30, 40, 0.95)';
    ctx.strokeStyle = playerColor;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.roundRect(finalX, finalY, w, h, 4);
    ctx.fill();
    ctx.stroke();

    // Name
    ctx.fillStyle = playerColor;
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 12px "Segoe UI", Arial, sans-serif';
    ctx.fillText(name, finalX + padding, finalY + 12);

    // Owner
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '11px "Segoe UI", Arial, sans-serif';
    ctx.fillText(ownerLine, finalX + padding, finalY + 28);

    // Health
    const healthColor = healthPercent > 50 ? '#88ff88' : healthPercent > 25 ? '#ffff88' : '#ff8888';
    ctx.fillStyle = healthColor;
    ctx.fillText(healthLine, finalX + padding, finalY + 44);

    ctx.restore();
}

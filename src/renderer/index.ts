import { type GameState, type Entity, type Projectile, type Particle, type Vector, BUILD_RADIUS, PLAYER_COLORS, type CommandIndicator, TILE_SIZE } from '../engine/types.js';
import { getAssetBitmap, initGraphics } from './assets.js';
import { RULES } from '../data/schemas/index.js';
import { getSpatialGrid } from '../engine/spatial.js';
import { pickEntityAt, setPickLift } from '../engine/picking.js';
import { isUnit, isBuilding, isHarvester } from '../engine/type-guards.js';
import { isAirUnit } from '../engine/entity-helpers.js';
import { getTransportCapacity, isTransportedUnit } from '../engine/transport.js';
import { getPlacementError } from '../engine/reducers/buildings.js';
import { isAlly } from '../engine/teams.js';
import type { Scene3D, PlacementGhost } from './three/scene.js';
import { AIRBASE_PAD_HEIGHT, AIRBASE_SLOT_OFFSETS, HEIGHT_TO_SCREEN, getAltitude, getModelHeight, heightToScreenLift } from './three/projection.js';

/** World units a 3D model's top is drawn above its ground position (for picking). */
const pickLift3D = (entity: Entity): number => (getAltitude(entity) + getModelHeight(entity)) * HEIGHT_TO_SCREEN;
import { type GraphicsMode, isWebGLAvailable, loadGraphicsMode, saveGraphicsMode } from './graphics-mode.js';

const TRAIL_BANDS = 6;
const trailStyleCache = new Map<number, string>();

/** rgba() white at `opacity`, quantised to 1% steps so the strings can be cached. */
function trailStrokeStyle(opacity: number): string {
    const key = Math.round(opacity * 100);
    let style = trailStyleCache.get(key);
    if (!style) {
        style = `rgba(255, 255, 255, ${key / 100})`;
        trailStyleCache.set(key, style);
    }
    return style;
}

/** Device pixel ratio for the overlay canvas backing store (capped to bound fill cost). */
function overlayPixelRatio(): number {
    return Math.min(typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1, 2);
}

/** World-pixel radius around the cursor that can contain the centre of any pickable entity. */
const HOVER_QUERY_RADIUS = 120;

export type OwnerRelation = 'own' | 'ally' | 'enemy' | 'neutral';

/** How `owner` relates to the viewer. Observers (viewer null) see every player as 'neutral'. */
export function getOwnerRelation(state: GameState | null, owner: number, viewerId: number | null): OwnerRelation {
    if (viewerId === null || owner < 0) return 'neutral';
    if (owner === viewerId) return 'own';
    if (state && isAlly(state, owner, viewerId)) return 'ally';
    return 'enemy';
}

/**
 * HP bar fill colour. Green -> yellow -> red also steps down in brightness and sits on a dark track,
 * so the bar still reads for red-green colour-blind players.
 */
export function hpBarColor(ratio: number): string {
    if (ratio > 0.6) return '#3fdc4f';
    if (ratio > 0.3) return '#f2c230';
    return '#e8392b';
}

/**
 * On-screen width (CSS px) of an entity's status bars. Bars are drawn in screen space so they stay
 * readable when zoomed out and don't balloon when zoomed in; buildings get bars proportional to
 * their footprint.
 */
export function statusBarWidth(entity: Pick<Entity, 'type' | 'w'>, zoom: number): number {
    if (entity.type === 'BUILDING') return Math.min(120, Math.max(28, entity.w * zoom * 0.8));
    return Math.min(44, Math.max(22, Math.max(30, entity.w) * zoom));
}

/**
 * Whether a building extends the viewer's build range: allied, alive, and not a defense
 * (mirrors getPlacementError in reducers/buildings.ts).
 */
export function extendsBuildRange(state: GameState, entity: Entity, playerId: number): boolean {
    if (entity.type !== 'BUILDING' || entity.dead) return false;
    if (!isAlly(state, entity.owner, playerId)) return false;
    return !RULES.buildings[entity.key]?.isDefense;
}

export class Renderer {
    private ctx: CanvasRenderingContext2D;
    private canvas: HTMLCanvasElement;
    private readonly selectionSet = new Set<string>();
    private readonly screenCulledEntities: Entity[] = [];
    private readonly passengerCountByTransport = new Map<string, number>();
    private fogEdgeGradients: {
        ctx: CanvasRenderingContext2D;
        tileSize: number;
        top: CanvasGradient;
        bottom: CanvasGradient;
        left: CanvasGradient;
        right: CanvasGradient;
    } | null = null;
    private readonly resourceEntities: Entity[] = [];
    private readonly rockEntities: Entity[] = [];
    private readonly wellEntities: Entity[] = [];
    private readonly unitBuildingEntities: Entity[] = [];
    private readonly primaryBuildingIds = new Set<string>();

    // 3D view: a WebGL scene drawn behind this canvas, which then only draws the overlay
    // (HP bars, selection, tooltips...). three.js is loaded lazily so 2D mode never pays for it.
    private graphicsMode: GraphicsMode;
    private scene3d: Scene3D | null = null;
    private scene3dLoading = false;
    private scene3dFailed = false;
    private disposed = false;
    // State of the frame being drawn (placement-ghost validity, tooltip ally colours)
    private frameState: GameState | null = null;
    private readonly onWindowResize = () => this.resize();
    // Logical (CSS px) size of the canvas. All drawing and game math use these; the backing store is
    // scaled by the device pixel ratio so the overlay stays sharp on HiDPI screens.
    private cssWidth = 1;
    private cssHeight = 1;
    private pixelRatio = 1;
    // Entity under the cursor this frame (shared picking), for the tooltip and hover marker
    private hoveredEntity: Entity | null = null;
    private hoveredResourceId: string | null = null;
    private oreBarsVisible = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.resize();
        window.addEventListener('resize', this.onWindowResize);
        initGraphics();
        this.graphicsMode = loadGraphicsMode();
        if (this.graphicsMode === '3d') this.ensureScene3D();
    }

    getGraphicsMode(): GraphicsMode {
        return this.graphicsMode;
    }

    setGraphicsMode(mode: GraphicsMode): void {
        this.graphicsMode = mode;
        saveGraphicsMode(mode);
        if (mode === '3d') this.ensureScene3D();
        this.applyGraphicsModeToDom();
    }

    toggleGraphicsMode(): GraphicsMode {
        this.setGraphicsMode(this.graphicsMode === '3d' ? '2d' : '3d');
        return this.graphicsMode;
    }

    dispose(): void {
        this.disposed = true;
        window.removeEventListener('resize', this.onWindowResize);
        this.scene3d?.dispose();
        this.scene3d = null;
        this.canvas.classList.remove('overlay-3d');
    }

    private is3DActive(): boolean {
        return this.graphicsMode === '3d' && this.scene3d !== null;
    }

    private ensureScene3D(): void {
        if (this.scene3d || this.scene3dLoading || this.scene3dFailed) return;
        const container = this.canvas.parentElement;
        if (!container || !isWebGLAvailable()) {
            console.warn('[Renderer] WebGL unavailable - using the 2D view');
            this.scene3dFailed = true;
            return;
        }
        this.scene3dLoading = true;
        import('./three/scene.js')
            .then(({ Scene3D }) => {
                // The renderer can be disposed (hot reload) while three.js is still loading
                if (this.disposed) return;
                // A stale canvas can survive a hot reload
                document.getElementById('gameCanvas3d')?.remove();
                this.scene3d = new Scene3D(container, this.canvas);
                this.scene3d.setSize(this.cssWidth, this.cssHeight);
                this.applyGraphicsModeToDom();
            })
            .catch(error => {
                console.error('[Renderer] Failed to start the 3D view - using 2D', error);
                this.scene3dFailed = true;
            })
            .finally(() => {
                this.scene3dLoading = false;
            });
    }

    private applyGraphicsModeToDom(): void {
        const active = this.is3DActive();
        this.canvas.classList.toggle('overlay-3d', active);
        if (this.scene3d) this.scene3d.canvas.style.display = active ? '' : 'none';
    }

    resize() {
        const container = document.getElementById('game-container');
        const sidebar = document.getElementById('sidebar');
        const sidebarHidden = sidebar?.classList.contains('observer-hidden');

        // The sidebar narrows on small screens (CSS media queries): measure it instead of assuming 300px.
        // In observer mode the sidebar is hidden and the canvas takes the full width.
        const sidebarRect = sidebarHidden || !sidebar ? null : sidebar.getBoundingClientRect();
        const containerWidth = container?.clientWidth ?? window.innerWidth;
        // Phones in portrait stack the sidebar below the battlefield instead of beside it
        const stacked = !!container && getComputedStyle(container).flexDirection === 'column';
        const width = Math.max(1, Math.floor(stacked ? containerWidth : containerWidth - (sidebarRect?.width ?? 0)));
        const height = Math.max(1, Math.floor(stacked ? window.innerHeight - (sidebarRect?.height ?? 0) : window.innerHeight));
        const pixelRatio = overlayPixelRatio();
        this.cssWidth = width;
        this.cssHeight = height;
        this.pixelRatio = pixelRatio;
        this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
        this.canvas.height = Math.max(1, Math.round(height * pixelRatio));
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.scene3d?.setSize(width, height);
    }

    /** Logical (CSS pixel) size of the battlefield canvas - the space input and camera math use. */
    getSize(): { width: number; height: number } {
        return { width: this.cssWidth, height: this.cssHeight };
    }

    render(state: GameState, dragStart: { x: number; y: number } | null, mousePos: { x: number; y: number }, localPlayerId: number | null = null, scrollOrigin: { x: number; y: number } | null = null) {
        this.frameState = state;
        const { camera, zoom, entities, projectiles, particles, selection, placingBuilding, tick } = state;
        const ctx = this.ctx;

        // Browser zoom or a move to another monitor changes the DPR without a resize event
        if (overlayPixelRatio() !== this.pixelRatio) this.resize();
        ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
        // Clicks, right-clicks, the cursor and the tooltip all pick against what is drawn
        setPickLift(this.is3DActive() ? pickLift3D : null);

        this.selectionSet.clear();
        let harvesterSelected = false;
        for (const selectedId of selection) {
            this.selectionSet.add(selectedId);
            const selected = entities[selectedId];
            if (selected && isHarvester(selected)) harvesterSelected = true;
        }
        if (state.inspectedId) this.selectionSet.add(state.inspectedId);
        // Ore-remaining bars only matter while managing harvesters (or when hovering a crystal)
        this.oreBarsVisible = harvesterSelected;

        // In 3D mode the world is drawn by the WebGL canvas underneath; this canvas only carries the overlay
        const use3D = this.is3DActive();

        // Clear
        if (use3D) {
            ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
        } else {
            ctx.fillStyle = '#2d3322';
            ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
        }

        // Apply screen shake offset to camera
        let effectiveCameraX = camera.x;
        let effectiveCameraY = camera.y;
        if (camera.shakeIntensity && camera.shakeDuration && camera.shakeDuration > 0) {
            effectiveCameraX += (Math.random() - 0.5) * camera.shakeIntensity;
            effectiveCameraY += (Math.random() - 0.5) * camera.shakeIntensity;
        }
        const effectiveCamera = { x: effectiveCameraX, y: effectiveCameraY };

        // Draw map boundary indicator lines
        this.drawMapBorder(effectiveCamera, zoom, state.config.width, state.config.height);

        ctx.save();

        // OPTIMIZATION: Cache frequently accessed values
        const canvasWidth = this.cssWidth;
        const canvasHeight = this.cssHeight;
        const cameraX = effectiveCameraX;
        const cameraY = effectiveCameraY;

        // Calculate visible world bounds with buffer for large entities
        const buffer = 150;
        const viewLeft = cameraX - buffer / zoom;
        const viewRight = cameraX + (canvasWidth + buffer) / zoom;
        const viewTop = cameraY - buffer / zoom;
        const viewBottom = cameraY + (canvasHeight + buffer) / zoom;

        // Use spatial grid to get only visible entities
        const viewCenterX = (viewLeft + viewRight) / 2;
        const viewCenterY = (viewTop + viewBottom) / 2;
        const viewWidth = viewRight - viewLeft;
        const viewHeight = viewBottom - viewTop;
        // Query radius = half diagonal of view to cover the entire visible area
        const queryRadius = Math.sqrt(viewWidth * viewWidth + viewHeight * viewHeight) / 2;

        const visibleEntities = getSpatialGrid().queryRadius(viewCenterX, viewCenterY, queryRadius);
        const screenCulledEntities = this.screenCulledEntities;
        screenCulledEntities.length = 0;

        // Fog of war filtering
        const fogGrid = localPlayerId !== null ? state.fogOfWar?.[localPlayerId] : undefined;
        const fogGridW = fogGrid ? Math.ceil(state.config.width / TILE_SIZE) : 0;

        // OPTIMIZATION: Early culling - filter out entities outside screen bounds before sorting.
        for (const e of visibleEntities) {
            if (e.dead) continue;

            // Fog of war — skip entities on unrevealed tiles
            if (fogGrid) {
                const tileX = Math.floor(e.pos.x / TILE_SIZE);
                const tileY = Math.floor(e.pos.y / TILE_SIZE);
                if (fogGrid[tileY * fogGridW + tileX] === 0) continue;
            }

            // Quick screen bounds check using world coordinates
            const screenX = (e.pos.x - cameraX) * zoom;
            const screenY = (e.pos.y - cameraY) * zoom;
            const screenRadius = e.radius * zoom;

            if (screenX + screenRadius >= -100 &&
                screenX - screenRadius <= canvasWidth + 100 &&
                screenY + screenRadius >= -100 &&
                screenY - screenRadius <= canvasHeight + 100) {
                screenCulledEntities.push(e);
            }
        }

        // Sort only visible entities by Y for proper layering
        const sortedEntities = screenCulledEntities.sort((a, b) => a.pos.y - b.pos.y);

        // What's under the cursor - same picking as clicks and the cursor (engine/picking.ts)
        this.updateHover(mousePos, effectiveCamera, zoom, fogGrid, fogGridW);

        // OPTIMIZATION: Batch entities by type to reduce context state changes
        // Group entities into batches: RESOURCE, ROCK, WELL, then UNIT/BUILDING by owner
        const resourceEntities = this.resourceEntities;
        const rockEntities = this.rockEntities;
        const wellEntities = this.wellEntities;
        const unitBuildingEntities = this.unitBuildingEntities;
        resourceEntities.length = 0;
        rockEntities.length = 0;
        wellEntities.length = 0;
        unitBuildingEntities.length = 0;

        for (const entity of sortedEntities) {
            if (entity.type === 'RESOURCE') {
                resourceEntities.push(entity);
            } else if (entity.type === 'ROCK') {
                rockEntities.push(entity);
            } else if (entity.type === 'WELL') {
                wellEntities.push(entity);
            } else {
                unitBuildingEntities.push(entity);
            }
        }

        // Count current passengers per transport (transported units are hidden in carriers).
        // PERFORMANCE: this is a whole-world scan, so only do it on frames where a transport is
        // actually on screen (the map is reused between frames).
        const passengerCountByTransport = this.passengerCountByTransport;
        passengerCountByTransport.clear();
        let transportVisible = false;
        for (const entity of unitBuildingEntities) {
            if (entity.type === 'UNIT' && getTransportCapacity(entity) > 0) {
                transportVisible = true;
                break;
            }
        }
        if (transportVisible) {
            for (const id in entities) {
                const candidate = entities[id];
                if (!isUnit(candidate) || candidate.dead) continue;
                if (!isTransportedUnit(candidate)) continue;
                const transportId = candidate.movement?.transportId;
                if (!transportId) continue;
                passengerCountByTransport.set(transportId, (passengerCountByTransport.get(transportId) ?? 0) + 1);
            }
        }

        if (use3D) {
            let placement: PlacementGhost | null = null;
            if (state.mode !== 'demo' && placingBuilding && mousePos.x < canvasWidth) {
                const x = mousePos.x / zoom + effectiveCamera.x;
                const y = mousePos.y / zoom + effectiveCamera.y;
                placement = { key: placingBuilding, x, y, valid: this.isValidBuildLocation(x, y, localPlayerId ?? 0) };
            }
            this.scene3d!.render({
                state,
                entities: sortedEntities,
                camera: effectiveCamera,
                zoom,
                width: canvasWidth,
                height: canvasHeight,
                fogGrid,
                localPlayerId,
                placement
            });

            for (const entity of resourceEntities) {
                this.drawEntityOverlay3D(entity, effectiveCamera, zoom, false, state.mode, tick, localPlayerId, entities, passengerCountByTransport);
            }
            for (const entity of unitBuildingEntities) {
                this.drawEntityOverlay3D(entity, effectiveCamera, zoom, this.selectionSet.has(entity.id), state.mode, tick, localPlayerId, entities, passengerCountByTransport);
            }
        } else {
            // Draw resources (no owner-specific colors)
            for (const entity of resourceEntities) {
                this.drawEntity(entity, effectiveCamera, zoom, this.selectionSet.has(entity.id), state.mode, tick, localPlayerId, entities, passengerCountByTransport);
            }

            // Draw rocks (no owner-specific colors)
            for (const entity of rockEntities) {
                this.drawEntity(entity, effectiveCamera, zoom, this.selectionSet.has(entity.id), state.mode, tick, localPlayerId, entities, passengerCountByTransport);
            }

            // Draw wells (no owner-specific colors)
            for (const entity of wellEntities) {
                this.drawEntity(entity, effectiveCamera, zoom, this.selectionSet.has(entity.id), state.mode, tick, localPlayerId, entities, passengerCountByTransport);
            }

            // Draw units and buildings (batched by owner for color caching)
            for (const entity of unitBuildingEntities) {
                this.drawEntity(entity, effectiveCamera, zoom, this.selectionSet.has(entity.id), state.mode, tick, localPlayerId, entities, passengerCountByTransport);
            }
        }

        // Draw rally points for selected production buildings (barracks/factory only)
        const RALLY_POINT_BUILDINGS = ['barracks', 'factory'];
        for (const id of selection) {
            const entity = entities[id];
            if (entity && entity.type === 'BUILDING' && !entity.dead) {
                if (RALLY_POINT_BUILDINGS.includes(entity.key) && entity.building.rallyPoint) {
                    this.drawRallyPoint(entity, entity.building.rallyPoint, effectiveCamera, zoom);
                }
            }
        }

        // Draw primary building indicators
        const primaryBuildingIds = this.primaryBuildingIds;
        primaryBuildingIds.clear();
        for (const pid in state.players) {
            // Primary buildings are a production setting: only show the viewer's own (all of them for observers)
            if (localPlayerId !== null && !isAlly(state, Number(pid), localPlayerId)) continue;
            const player = state.players[Number(pid)];
            const primaryBuildings = player?.primaryBuildings;
            if (!primaryBuildings) continue;
            if (primaryBuildings.infantry) primaryBuildingIds.add(primaryBuildings.infantry);
            if (primaryBuildings.vehicle) primaryBuildingIds.add(primaryBuildings.vehicle);
        }
        for (const buildingId of primaryBuildingIds) {
            const entity = entities[buildingId];
            if (entity && entity.type === 'BUILDING' && !entity.dead) {
                const lift = use3D ? heightToScreenLift(getModelHeight(entity), zoom) : 0;
                this.drawPrimaryIndicator(entity, effectiveCamera, zoom, lift);
            }
        }

        if (use3D) {
            // Projectiles, explosions and fog live in the 3D scene; only floating text stays 2D
            for (const particle of particles) {
                if (!particle.text) continue;
                if (fogGrid && fogGrid[Math.floor(particle.pos.y / TILE_SIZE) * fogGridW + Math.floor(particle.pos.x / TILE_SIZE)] === 0) continue;
                this.drawParticle(particle, effectiveCamera, zoom);
            }
        } else {
            // Draw projectiles
            for (const proj of projectiles) {
                if (proj.dead) continue;
                this.drawProjectile(proj, effectiveCamera, zoom, entities);
            }

            // Draw particles
            for (const particle of particles) {
                this.drawParticle(particle, effectiveCamera, zoom);
            }

            // Draw fog of war overlay
            if (fogGrid) {
                this.drawFogOverlay(ctx, fogGrid, fogGridW, effectiveCamera, zoom, canvasWidth, canvasHeight, state.config.height);
            }
        }

        // Draw command indicator (move/attack target)
        if (state.commandIndicator) {
            this.drawCommandIndicator(state.commandIndicator, effectiveCamera, zoom, tick);
        }

        // Building placement preview
        if (state.mode !== 'demo' && placingBuilding && mousePos.x < canvasWidth) {
            this.drawPlacementPreview(placingBuilding, mousePos, effectiveCamera, zoom, entities, localPlayerId, use3D);
        }


        // Drag selection box
        if (dragStart) {
            ctx.strokeStyle = '#0f0';
            ctx.strokeRect(dragStart.x, dragStart.y, mousePos.x - dragStart.x, mousePos.y - dragStart.y);
        }

        // Middle mouse scroll origin indicator
        if (scrollOrigin) {
            ctx.save();
            ctx.strokeStyle = '#fff';
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
            ctx.lineWidth = 2;

            // Draw origin circle (dead zone indicator)
            ctx.beginPath();
            ctx.arc(scrollOrigin.x, scrollOrigin.y, 10, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();

            // Draw directional arrows
            const arrowSize = 6;
            const arrowDist = 18;
            ctx.fillStyle = '#fff';

            // Up arrow
            ctx.beginPath();
            ctx.moveTo(scrollOrigin.x, scrollOrigin.y - arrowDist - arrowSize);
            ctx.lineTo(scrollOrigin.x - arrowSize, scrollOrigin.y - arrowDist);
            ctx.lineTo(scrollOrigin.x + arrowSize, scrollOrigin.y - arrowDist);
            ctx.closePath();
            ctx.fill();

            // Down arrow
            ctx.beginPath();
            ctx.moveTo(scrollOrigin.x, scrollOrigin.y + arrowDist + arrowSize);
            ctx.lineTo(scrollOrigin.x - arrowSize, scrollOrigin.y + arrowDist);
            ctx.lineTo(scrollOrigin.x + arrowSize, scrollOrigin.y + arrowDist);
            ctx.closePath();
            ctx.fill();

            // Left arrow
            ctx.beginPath();
            ctx.moveTo(scrollOrigin.x - arrowDist - arrowSize, scrollOrigin.y);
            ctx.lineTo(scrollOrigin.x - arrowDist, scrollOrigin.y - arrowSize);
            ctx.lineTo(scrollOrigin.x - arrowDist, scrollOrigin.y + arrowSize);
            ctx.closePath();
            ctx.fill();

            // Right arrow
            ctx.beginPath();
            ctx.moveTo(scrollOrigin.x + arrowDist + arrowSize, scrollOrigin.y);
            ctx.lineTo(scrollOrigin.x + arrowDist, scrollOrigin.y - arrowSize);
            ctx.lineTo(scrollOrigin.x + arrowDist, scrollOrigin.y + arrowSize);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }

        // Draw tooltips
        this.drawTooltip(mousePos, effectiveCamera, zoom, localPlayerId, use3D);


        ctx.restore();
    }

    private drawMapBorder(camera: { x: number; y: number }, zoom: number, mapWidth: number, mapHeight: number) {
        const ctx = this.ctx;
        const canvasWidth = this.cssWidth;
        const canvasHeight = this.cssHeight;

        // Convert map boundaries to screen coordinates
        const leftEdge = (0 - camera.x) * zoom;
        const rightEdge = (mapWidth - camera.x) * zoom;
        const topEdge = (0 - camera.y) * zoom;
        const bottomEdge = (mapHeight - camera.y) * zoom;

        ctx.save();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);

        // Draw left edge if visible
        if (leftEdge > 0 && leftEdge < canvasWidth) {
            ctx.beginPath();
            ctx.moveTo(leftEdge, Math.max(0, topEdge));
            ctx.lineTo(leftEdge, Math.min(canvasHeight, bottomEdge));
            ctx.stroke();
        }

        // Draw right edge if visible
        if (rightEdge > 0 && rightEdge < canvasWidth) {
            ctx.beginPath();
            ctx.moveTo(rightEdge, Math.max(0, topEdge));
            ctx.lineTo(rightEdge, Math.min(canvasHeight, bottomEdge));
            ctx.stroke();
        }

        // Draw top edge if visible
        if (topEdge > 0 && topEdge < canvasHeight) {
            ctx.beginPath();
            ctx.moveTo(Math.max(0, leftEdge), topEdge);
            ctx.lineTo(Math.min(canvasWidth, rightEdge), topEdge);
            ctx.stroke();
        }

        // Draw bottom edge if visible
        if (bottomEdge > 0 && bottomEdge < canvasHeight) {
            ctx.beginPath();
            ctx.moveTo(Math.max(0, leftEdge), bottomEdge);
            ctx.lineTo(Math.min(canvasWidth, rightEdge), bottomEdge);
            ctx.stroke();
        }

        ctx.restore();
    }

    private worldToScreen(worldPos: Vector, camera: { x: number; y: number }, zoom: number): { x: number; y: number } {
        return {
            x: (worldPos.x - camera.x) * zoom,
            y: (worldPos.y - camera.y) * zoom
        };
    }

    private drawEntity(entity: Entity, camera: { x: number; y: number }, zoom: number, isSelected: boolean, mode: string, tick: number, localPlayerId: number | null, allEntities: Record<string, Entity>, passengerCountByTransport: Map<string, number>) {
        // Skip docked harriers - they are invisible while docked at base
        if (isAirUnit(entity) && entity.airUnit.state === 'docked') {
            return;
        }

        const ctx = this.ctx;
        const sc = this.worldToScreen(entity.pos, camera, zoom);

        // OPTIMIZATION: Culling is now done earlier in render() before sorting
        // This check is redundant and has been removed for performance

        ctx.save();
        ctx.translate(sc.x, sc.y);
        ctx.scale(zoom, zoom);

        // Selection circle (HP and other status bars are drawn upright in screen space below)
        if (isSelected) {
            this.drawSelectionRing(entity, localPlayerId);

            // MCV deploy hint
            if (entity.key === 'mcv' && localPlayerId !== null && entity.owner === localPlayerId && mode !== 'demo') {
                ctx.fillStyle = '#fff';
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('Deploy (Enter)', 0, entity.radius + 20);
            }
        }

        // Draw repair icon for buildings being repaired (flashing)
        this.drawRepairIcon(entity, tick);

        // Draw entity
        if (entity.type === 'RESOURCE') {
            const img = getAssetBitmap(entity.key, entity.owner, entity.w, entity.h, zoom * this.pixelRatio);
            if (img) {
                ctx.drawImage(img, -entity.w / 2, -entity.h / 2, entity.w, entity.h);
            } else {
                ctx.fillStyle = '#d4af37';
                ctx.beginPath();
                ctx.arc(0, 0, 10, 0, Math.PI * 2);
                ctx.fill();
            }
        } else if (entity.type === 'ROCK') {
            // Rocks are impassable obstacles - draw as brown/gray shapes
            ctx.fillStyle = '#665544';
            ctx.strokeStyle = '#443322';
            ctx.lineWidth = 2;
            ctx.beginPath();
            // Draw irregular rock shape
            const r = entity.radius;
            ctx.moveTo(-r * 0.8, -r * 0.5);
            ctx.lineTo(-r * 0.3, -r * 0.9);
            ctx.lineTo(r * 0.4, -r * 0.7);
            ctx.lineTo(r * 0.9, -r * 0.2);
            ctx.lineTo(r * 0.6, r * 0.6);
            ctx.lineTo(-r * 0.2, r * 0.8);
            ctx.lineTo(-r * 0.8, r * 0.4);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Add some detail
            ctx.fillStyle = '#554433';
            ctx.beginPath();
            ctx.arc(-r * 0.3, -r * 0.2, r * 0.15, 0, Math.PI * 2);
            ctx.fill();
        } else if (entity.type === 'WELL') {
            // Draw ore well - golden when active, grey when blocked
            const isBlocked = entity.well.isBlocked;

            // Only pulse when active (not blocked)
            const pulsePhase = (tick % 60) / 60;
            const pulseScale = isBlocked ? 1 : 1 + Math.sin(pulsePhase * Math.PI * 2) * 0.05;

            // Outer glow
            ctx.fillStyle = isBlocked ? 'rgba(128, 128, 128, 0.2)' : 'rgba(212, 175, 55, 0.3)';
            ctx.beginPath();
            ctx.arc(0, 0, entity.radius * 1.5 * pulseScale, 0, Math.PI * 2);
            ctx.fill();

            // Main pool with gradient
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, entity.radius);
            if (isBlocked) {
                // Grey/inactive colors
                gradient.addColorStop(0, '#a0a0a0');
                gradient.addColorStop(0.6, '#707070');
                gradient.addColorStop(1, '#505050');
            } else {
                // Golden/active colors
                gradient.addColorStop(0, '#ffd700');
                gradient.addColorStop(0.6, '#b8860b');
                gradient.addColorStop(1, '#8b6914');
            }
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(0, 0, entity.radius * pulseScale, 0, Math.PI * 2);
            ctx.fill();

            // Inner highlight (dimmer when blocked)
            ctx.fillStyle = isBlocked ? 'rgba(200, 200, 200, 0.2)' : 'rgba(255, 255, 200, 0.4)';
            ctx.beginPath();
            ctx.arc(-5, -5, entity.radius * 0.3, 0, Math.PI * 2);
            ctx.fill();

            // Border
            ctx.strokeStyle = isBlocked ? '#404040' : '#654321';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(0, 0, entity.radius, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            // Get rotation from movement component for units, 0 for buildings
            const rotation = isUnit(entity) ? entity.movement.rotation : 0;
            ctx.rotate(rotation);

            const img = getAssetBitmap(entity.key, entity.owner, entity.w, entity.h, zoom * this.pixelRatio);
            const playerColor = PLAYER_COLORS[entity.owner] || '#888888';

            // Get flash from combat component (units always have it, buildings may have it)
            const flash = entity.combat?.flash ?? 0;
            if (flash > 0) {
                ctx.fillStyle = '#fff';
                ctx.fillRect(-entity.w / 2, -entity.h / 2, entity.w, entity.h);
            } else if (img) {
                ctx.drawImage(img, -entity.w / 2, -entity.h / 2, entity.w, entity.h);
            } else {
                ctx.fillStyle = playerColor;
                ctx.fillRect(-entity.w / 2, -entity.h / 2, entity.w, entity.h);
            }

            // Transport occupancy indicator (e.g. APC with passengers).
            if (entity.type === 'UNIT') {
                const capacity = getTransportCapacity(entity);
                const passengerCount = capacity > 0 ? (passengerCountByTransport.get(entity.id) ?? 0) : 0;
                if (passengerCount > 0) {
                    ctx.save();
                    ctx.rotate(-rotation); // Keep badge upright while unit body rotates.
                    this.drawPassengerBadge(entity, passengerCount);
                    ctx.restore();
                }
            }

            // Air-Force Command: draw docked harrier indicators
            if (entity.type === 'BUILDING' && entity.key === 'airforce_command' && isBuilding(entity) && entity.airBase) {
                for (let i = 0; i < entity.airBase.slots.length; i++) {
                    const slotId = entity.airBase.slots[i];
                    const pos = AIRBASE_SLOT_OFFSETS[i] || { x: 0, y: 0 };
                    if (slotId) {
                        const harrier = allEntities[slotId];
                        const isReloading = harrier && isAirUnit(harrier) && harrier.airUnit.ammo < harrier.airUnit.maxAmmo;
                        const isDamaged = harrier && harrier.hp < harrier.maxHp;

                        // Draw small harrier icon at slot
                        ctx.save();
                        ctx.translate(pos.x, pos.y);

                        // Red if reloading, else player color
                        ctx.fillStyle = isReloading ? '#ff0000' : playerColor;

                        // Simple jet shape
                        ctx.beginPath();
                        ctx.moveTo(0, -8);
                        ctx.lineTo(6, 6);
                        ctx.lineTo(0, 3);
                        ctx.lineTo(-6, 6);
                        ctx.closePath();
                        ctx.fill();
                        ctx.strokeStyle = '#000';
                        ctx.lineWidth = 1;
                        ctx.stroke();

                        // Draw mini HP bar if damaged
                        if (isDamaged) {
                            const hpRatio = Math.max(0, harrier.hp / harrier.maxHp);
                            ctx.fillStyle = '#222';
                            ctx.fillRect(-8, 8, 16, 3);
                            ctx.fillStyle = hpBarColor(hpRatio);
                            ctx.fillRect(-8, 8, 16 * hpRatio, 3);
                        }

                        ctx.restore();
                    } else {
                        // Empty slot indicator
                        ctx.fillStyle = 'rgba(100, 100, 100, 0.3)';
                        ctx.beginPath();
                        ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }

            // Service Depot: draw repair aura radius when selected
            if (entity.type === 'BUILDING' && entity.key === 'service_depot' && isSelected) {
                const depotData = RULES.buildings['service_depot'];
                if (depotData && depotData.repairRadius) {
                    ctx.save();
                    ctx.strokeStyle = 'rgba(0, 255, 0, 0.4)';
                    ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.arc(0, 0, depotData.repairRadius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                    ctx.restore();
                }
            }

            // Draw turret barrel overlay for units/buildings with turrets
            const turretEntities = ['light', 'heavy', 'mammoth', 'artillery', 'flame_tank', 'turret', 'sam_site', 'pillbox', 'jeep'];
            if (turretEntities.includes(entity.key) && entity.combat) {
                ctx.save();
                // Undo body rotation first, then apply turret angle
                ctx.rotate(-rotation);
                ctx.rotate(entity.combat.turretAngle);

                // Draw turret asset if available
                const turretKey = entity.key + '_turret';
                const turretImg = getAssetBitmap(turretKey, entity.owner, entity.w, entity.h, zoom * this.pixelRatio);

                if (turretImg) {
                    ctx.drawImage(turretImg, -entity.w / 2, -entity.h / 2, entity.w, entity.h);
                } else {
                    // Fallback for missing assets or untracked turret entities
                    if (entity.key === 'turret') {
                        ctx.fillStyle = '#111';
                        ctx.fillRect(0, -4, entity.w * 0.6, 8);
                    } else {
                        // Generic barrel
                        ctx.fillStyle = '#111';
                        ctx.fillRect(0, -3, entity.w * 0.5, 6);
                    }
                }

                ctx.restore();
            }
        }

        ctx.restore();

        // Bars stay upright and screen-sized whatever the unit's rotation and the zoom
        this.drawStatusBars(entity, sc.x, sc.y, zoom, isSelected);
    }

    /**
     * 3D mode counterpart of drawEntity: the model itself is in the WebGL scene, so this only draws the
     * 2D decorations. Ground markers (selection ring, aura radius) stay on the ground; bars and badges
     * are lifted by the model's on-screen height so they sit above it.
     */
    private drawEntityOverlay3D(entity: Entity, camera: { x: number; y: number }, zoom: number, isSelected: boolean, mode: string, tick: number, localPlayerId: number | null, allEntities: Record<string, Entity>, passengerCountByTransport: Map<string, number>) {
        if (isAirUnit(entity) && entity.airUnit.state === 'docked') return;

        const ctx = this.ctx;
        const sc = this.worldToScreen(entity.pos, camera, zoom);
        ctx.save();
        ctx.translate(sc.x, sc.y);
        ctx.scale(zoom, zoom);

        if (isSelected) {
            this.drawSelectionRing(entity, localPlayerId);

            if (entity.key === 'mcv' && localPlayerId !== null && entity.owner === localPlayerId && mode !== 'demo') {
                ctx.fillStyle = '#fff';
                ctx.font = '10px Arial';
                ctx.textAlign = 'center';
                ctx.fillText('Deploy (Enter)', 0, entity.radius + 20);
            }

            if (entity.type === 'BUILDING' && entity.key === 'service_depot') {
                const repairRadius = RULES.buildings['service_depot']?.repairRadius;
                if (repairRadius) {
                    ctx.strokeStyle = 'rgba(0, 255, 0, 0.4)';
                    ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
                    ctx.beginPath();
                    ctx.arc(0, 0, repairRadius, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                }
            }
        }

        // Damaged harriers parked on an Air-Force Command get a mini HP bar over their slot
        if (isBuilding(entity) && entity.key === 'airforce_command' && entity.airBase) {
            const padLift = heightToScreenLift(AIRBASE_PAD_HEIGHT + 5, 1);
            for (let i = 0; i < entity.airBase.slots.length; i++) {
                const harrier = allEntities[entity.airBase.slots[i] ?? ''];
                if (!harrier || !isAirUnit(harrier) || harrier.airUnit.state !== 'docked' || harrier.hp >= harrier.maxHp) continue;
                const pos = AIRBASE_SLOT_OFFSETS[i] || { x: 0, y: 0 };
                const hpRatio = Math.max(0, harrier.hp / harrier.maxHp);
                ctx.fillStyle = '#222';
                ctx.fillRect(pos.x - 8, pos.y - padLift - 10, 16, 3);
                ctx.fillStyle = hpBarColor(hpRatio);
                ctx.fillRect(pos.x - 8, pos.y - padLift - 10, 16 * hpRatio, 3);
            }
        }

        // Everything below floats above the model
        const liftWorld = heightToScreenLift(getModelHeight(entity) + getAltitude(entity), 1);
        ctx.translate(0, -liftWorld);

        this.drawRepairIcon(entity, tick);

        if (entity.type === 'UNIT' && getTransportCapacity(entity) > 0) {
            const passengerCount = passengerCountByTransport.get(entity.id) ?? 0;
            if (passengerCount > 0) this.drawPassengerBadge(entity, passengerCount);
        }

        ctx.restore();

        this.drawStatusBars(entity, sc.x, sc.y - liftWorld * zoom, zoom, isSelected);
    }

    /**
     * Selection ring in the entity's zoomed local frame. Besides colour, the stroke pattern tells
     * own (solid), allied (dashed) and enemy (solid with crosshair ticks) apart.
     */
    private drawSelectionRing(entity: Entity, localPlayerId: number | null) {
        const relation = getOwnerRelation(this.frameState, entity.owner, localPlayerId);
        this.strokeRelationRing(entity.radius + 8, relation, 2, '#0f0');
    }

    /** Ring of radius `r` (current frame units) styled by owner relation. */
    private strokeRelationRing(r: number, relation: OwnerRelation, lineWidth: number, ownColor: string) {
        const ctx = this.ctx;
        ctx.save();
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = relation === 'enemy' ? '#ff4040' : relation === 'ally' ? '#4db8ff' : ownColor;
        if (relation === 'ally') ctx.setLineDash([r * 0.35, r * 0.2]);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
        if (relation === 'enemy') {
            // Crosshair ticks: an enemy marker that doesn't rely on red vs green
            const tick = Math.max(4 * lineWidth, r * 0.3);
            ctx.beginPath();
            ctx.moveTo(r - tick / 2, 0); ctx.lineTo(r + tick / 2, 0);
            ctx.moveTo(-r - tick / 2, 0); ctx.lineTo(-r + tick / 2, 0);
            ctx.moveTo(0, r - tick / 2); ctx.lineTo(0, r + tick / 2);
            ctx.moveTo(0, -r - tick / 2); ctx.lineTo(0, -r + tick / 2);
            ctx.stroke();
        }
        ctx.restore();
    }

    /**
     * HP, harvester-cargo and ore-remaining bars, drawn upright in screen space (CSS px) above the
     * entity whose (possibly lifted) screen centre is (sx, sy).
     */
    private drawStatusBars(entity: Entity, sx: number, sy: number, zoom: number, isSelected: boolean) {
        const halfExtent = entity.type === 'BUILDING' ? entity.h / 2 : entity.radius;
        let barBottom = sy - halfExtent * zoom - 3;

        if (entity.type === 'RESOURCE') {
            if (entity.hp >= entity.maxHp) return;
            if (!this.oreBarsVisible && this.hoveredResourceId !== entity.id) return;
            const w = Math.min(32, Math.max(18, 24 * zoom));
            this.drawBar(sx - w / 2, sy - entity.radius * zoom - 6, w, 3, entity.hp / entity.maxHp, '#ffdf00');
            return;
        }

        const width = statusBarWidth(entity, zoom);
        if (isHarvester(entity) && entity.harvester.cargo > 0) {
            const ratio = Math.min(1, entity.harvester.cargo / 500); // 500 is capacity
            this.drawBar(sx - width / 2, barBottom - 3, width, 3, ratio, '#2fe0ff');
            barBottom -= 3 + 2;
        }

        if (entity.hp < entity.maxHp || isSelected) {
            const height = entity.type === 'BUILDING' ? 5 : 4;
            const ratio = Math.max(0, Math.min(1, entity.hp / entity.maxHp));
            this.drawBar(sx - width / 2, barBottom - height, width, height, ratio, hpBarColor(ratio));
        }
    }

    /** A filled bar with a dark track and a 1px black outline, snapped to whole pixels. */
    private drawBar(x: number, y: number, w: number, h: number, ratio: number, color: string) {
        const ctx = this.ctx;
        const bx = Math.round(x);
        const by = Math.round(y);
        const bw = Math.round(w);
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(bx - 1, by - 1, bw + 2, h + 2);
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(bx, by, bw, h);
        ctx.fillStyle = color;
        ctx.fillRect(bx, by, Math.max(0, Math.min(1, ratio)) * bw, h);
    }

    /** Flashing wrench over buildings that are being repaired. */
    private drawRepairIcon(entity: Entity, tick: number) {
        if (!isBuilding(entity) || !entity.building.isRepairing) return;
        if ((tick % 30) >= 20) return; // Flash on for 20 ticks, off for 10
        const ctx = this.ctx;
        ctx.save();
        ctx.fillStyle = '#00ff00';
        ctx.strokeStyle = '#004400';
        ctx.lineWidth = 2;

        // Simple wrench shape
        const iconY = -entity.radius - 25;
        ctx.beginPath();
        ctx.arc(0, iconY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Wrench handle
        ctx.fillRect(-2, iconY + 6, 4, 12);
        ctx.strokeRect(-2, iconY + 6, 4, 12);
        ctx.restore();
    }

    /** Passenger count badge at the top-right of a transport (caller keeps the frame upright). */
    private drawPassengerBadge(entity: Entity, passengerCount: number) {
        const ctx = this.ctx;
        const badgeX = entity.w / 2 - 4;
        const badgeY = -entity.h / 2 + 4;
        const badgeText = passengerCount > 9 ? '9+' : String(passengerCount);

        ctx.save();
        ctx.fillStyle = 'rgba(20, 20, 20, 0.9)';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#4cffd2';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(badgeText, badgeX, badgeY + 0.5);
        ctx.restore();
    }

    private drawProjectile(proj: Projectile, camera: { x: number; y: number }, zoom: number, entities: Record<string, Entity>) {
        const ctx = this.ctx;
        const sc = this.worldToScreen(proj.pos, camera, zoom);

        // Calculate visual Y offset for arc
        let yOffset = 0;
        if (proj.arcHeight > 0) {
            const targetEntity = entities[proj.targetId];
            // Non-homing shots fly at their aim point, not where the target has moved to
            const targetPos = (proj.archetype !== 'missile' && proj.targetPos) || targetEntity?.pos || proj.pos;
            const totalDist = proj.startPos.dist(targetPos);
            const traveled = proj.startPos.dist(proj.pos);
            const progress = totalDist > 0 ? traveled / totalDist : 0;
            // Parabola: 4 * progress * (1 - progress) peaks at 0.5
            yOffset = proj.arcHeight * 4 * progress * (1 - progress);
        }

        const drawY = sc.y - (yOffset * zoom);

        // Draw trail first (behind projectile)
        this.drawProjectileTrail(proj, camera, zoom);

        // Draw shadow for arcing projectiles
        if (proj.arcHeight > 0 && yOffset > 10) {
            ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
            ctx.beginPath();
            ctx.ellipse(sc.x, sc.y, 8 * zoom, 4 * zoom, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.save();
        ctx.translate(sc.x, drawY);

        // Rotate to face direction of travel
        const angle = Math.atan2(proj.vel.y, proj.vel.x);
        ctx.rotate(angle);

        switch (proj.archetype) {
            case 'hitscan':
                // Yellow tracer line
                ctx.strokeStyle = '#ff0';
                ctx.lineWidth = 2 * zoom;
                ctx.beginPath();
                ctx.moveTo(-8 * zoom, 0);
                ctx.lineTo(0, 0);
                ctx.stroke();
                break;

            case 'rocket':
                // Orange-red elongated oval
                ctx.fillStyle = '#f52';
                ctx.beginPath();
                ctx.ellipse(0, 0, 8 * zoom, 4 * zoom, 0, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'artillery':
                // Dark gray circle
                ctx.fillStyle = '#444';
                ctx.beginPath();
                ctx.arc(0, 0, 6 * zoom, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'missile':
                // White triangle
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.moveTo(10 * zoom, 0);
                ctx.lineTo(-5 * zoom, -5 * zoom);
                ctx.lineTo(-5 * zoom, 5 * zoom);
                ctx.closePath();
                ctx.fill();
                break;

            case 'ballistic':
                // Brown/brass circle
                ctx.fillStyle = '#a85';
                ctx.beginPath();
                ctx.arc(0, 0, 4 * zoom, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'grenade':
                // Dark green circle
                ctx.fillStyle = '#252';
                ctx.beginPath();
                ctx.arc(0, 0, 5 * zoom, 0, Math.PI * 2);
                ctx.fill();
                break;

            default:
                // Fallback - yellow dot (for heal, etc.)
                ctx.fillStyle = proj.type === 'heal' ? '#0f0' : '#ff0';
                ctx.beginPath();
                ctx.arc(0, 0, 3 * zoom, 0, Math.PI * 2);
                ctx.fill();
        }

        ctx.restore();
    }

    private drawProjectileTrail(proj: Projectile, camera: { x: number; y: number }, zoom: number) {
        const { trailPoints } = proj;
        const n = trailPoints.length;
        if (n < 2) return;

        const ctx = this.ctx;
        ctx.lineWidth = 1 * zoom;

        // PERFORMANCE: a trail used to be up to 29 separate strokes, each with its own freshly
        // formatted rgba() string and two temporary screen-position objects. The fade is now
        // quantised into a few opacity bands that are each stroked once as a connected path.
        const bands = Math.min(TRAIL_BANDS, n - 1);
        const segments = n - 1;
        let i = 1;
        for (let band = 0; band < bands; band++) {
            // Segments [i, end) belong to this band
            const end = band === bands - 1 ? n : 1 + Math.round(((band + 1) * segments) / bands);
            if (end <= i) continue;

            const mid = (i + end - 1) / 2;
            ctx.strokeStyle = trailStrokeStyle((mid / n) * 0.3);
            ctx.beginPath();
            const first = trailPoints[i - 1];
            ctx.moveTo((first.x - camera.x) * zoom, (first.y - camera.y) * zoom);
            for (let k = i; k < end; k++) {
                const p = trailPoints[k];
                ctx.lineTo((p.x - camera.x) * zoom, (p.y - camera.y) * zoom);
            }
            ctx.stroke();
            i = end;
        }
    }

    private drawParticle(particle: Particle, camera: { x: number; y: number }, zoom: number) {
        const ctx = this.ctx;
        const sc = this.worldToScreen(particle.pos, camera, zoom);

        if (particle.text) {
            ctx.fillStyle = particle.color;
            ctx.font = 'bold 12px Arial';
            ctx.fillText(particle.text, sc.x, sc.y);
        } else {
            ctx.fillStyle = particle.color;
            ctx.fillRect(sc.x, sc.y, 2 * zoom, 2 * zoom);
        }
    }

    private drawCommandIndicator(indicator: CommandIndicator, camera: { x: number; y: number }, zoom: number, currentTick: number) {
        const ctx = this.ctx;
        const sc = this.worldToScreen(indicator.pos, camera, zoom);

        const INDICATOR_DURATION = 120;
        const elapsed = currentTick - indicator.startTick;
        const progress = Math.min(1, elapsed / INDICATOR_DURATION);

        // Fade out over the duration
        const alpha = 1 - progress;

        // Pulsing effect
        const pulse = 1 + 0.3 * Math.sin(elapsed * 0.2);
        const baseRadius = 15 * zoom * pulse;

        ctx.save();
        ctx.globalAlpha = alpha;

        // Color based on type
        const color = indicator.type === 'move' ? '#44ff44' : indicator.type === 'attack_move' ? '#ffaa22' : '#ff4444';

        // Outer ring
        ctx.strokeStyle = color;
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, baseRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Inner ring (smaller, same color)
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, baseRadius * 0.5, 0, Math.PI * 2);
        ctx.stroke();

        // Center dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, 3 * zoom, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    private drawRallyPoint(building: Entity, rallyPoint: Vector, camera: { x: number; y: number }, zoom: number) {
        const ctx = this.ctx;
        const buildingScreen = this.worldToScreen(building.pos, camera, zoom);
        const rallyScreen = this.worldToScreen(rallyPoint, camera, zoom);

        ctx.save();

        // Draw dashed line from building to rally point
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2 * zoom;
        ctx.setLineDash([5 * zoom, 5 * zoom]);
        ctx.beginPath();
        ctx.moveTo(buildingScreen.x, buildingScreen.y);
        ctx.lineTo(rallyScreen.x, rallyScreen.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw flag at rally point
        const flagHeight = 20 * zoom;
        const flagWidth = 12 * zoom;

        // Flag pole
        ctx.strokeStyle = '#ffcc00';
        ctx.lineWidth = 2 * zoom;
        ctx.beginPath();
        ctx.moveTo(rallyScreen.x, rallyScreen.y);
        ctx.lineTo(rallyScreen.x, rallyScreen.y - flagHeight);
        ctx.stroke();

        // Flag
        ctx.fillStyle = '#ffcc00';
        ctx.beginPath();
        ctx.moveTo(rallyScreen.x, rallyScreen.y - flagHeight);
        ctx.lineTo(rallyScreen.x + flagWidth, rallyScreen.y - flagHeight + flagWidth / 2);
        ctx.lineTo(rallyScreen.x, rallyScreen.y - flagHeight + flagWidth);
        ctx.closePath();
        ctx.fill();

        // Circle at base
        ctx.beginPath();
        ctx.arc(rallyScreen.x, rallyScreen.y, 4 * zoom, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    private drawPrimaryIndicator(building: Entity, camera: { x: number; y: number }, zoom: number, liftPx = 0) {
        const ctx = this.ctx;
        const screen = this.worldToScreen(building.pos, camera, zoom);

        ctx.save();

        // Draw a yellow star at the top-right corner of the building (on its roof in 3D)
        const starSize = 8 * zoom;
        const offsetX = (building.w / 2) * zoom - 5 * zoom;
        const offsetY = -(building.h / 2) * zoom + 5 * zoom - liftPx;

        const cx = screen.x + offsetX;
        const cy = screen.y + offsetY;

        // 5-pointed star
        ctx.fillStyle = '#ffcc00';
        ctx.strokeStyle = '#886600';
        ctx.lineWidth = 1 * zoom;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const angle = (i * 144 - 90) * Math.PI / 180;
            const x = cx + Math.cos(angle) * starSize;
            const y = cy + Math.sin(angle) * starSize;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        ctx.restore();
    }

    private drawPlacementPreview(
        buildingKey: string,
        mousePos: { x: number; y: number },
        camera: { x: number; y: number },
        zoom: number,
        entities: Record<string, Entity>,
        localPlayerId: number | null,
        footprintOnly = false
    ) {
        const ctx = this.ctx;
        const mx = (mousePos.x / zoom) + camera.x;
        const my = (mousePos.y / zoom) + camera.y;

        const playerId = localPlayerId ?? 0;
        const valid = this.isValidBuildLocation(mx, my, playerId);
        const b = RULES.buildings[buildingKey];
        if (!b) return;

        // Draw build radius indicators around the buildings that let you build nearby
        // (own and allied, except defenses - same rule as getPlacementError)
        ctx.save();
        for (const id in entities) {
            const e = entities[id];
            if (this.frameState && extendsBuildRange(this.frameState, e, playerId)) {
                const s = this.worldToScreen(e.pos, camera, zoom);
                ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                ctx.beginPath();
                ctx.arc(s.x, s.y, BUILD_RADIUS * zoom, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Draw ghost building
        const sc = {
            x: (mx - camera.x) * zoom,
            y: (my - camera.y) * zoom
        };
        const rx = sc.x - (b.w / 2) * zoom, ry = sc.y - (b.h / 2) * zoom;
        const rw = b.w * zoom, rh = b.h * zoom;
        if (footprintOnly) {
            // The 3D scene draws a hologram of the building; just mark its footprint
            ctx.fillStyle = valid ? 'rgba(0,255,0,0.15)' : 'rgba(255,0,0,0.15)';
            ctx.strokeStyle = valid ? 'rgba(0,255,0,0.8)' : 'rgba(255,0,0,0.8)';
            ctx.lineWidth = 1.5;
            ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeRect(rx, ry, rw, rh);
        } else {
            ctx.fillStyle = valid ? 'rgba(0,255,0,0.5)' : 'rgba(255,0,0,0.5)';
            ctx.fillRect(rx, ry, rw, rh);
        }
        if (!valid) {
            // A cross marks an invalid spot without relying on red vs green
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
            ctx.lineWidth = 2;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(rx, ry); ctx.lineTo(rx + rw, ry + rh);
            ctx.moveTo(rx + rw, ry); ctx.lineTo(rx, ry + rh);
            ctx.stroke();
        }
        ctx.restore();
    }

    private isValidBuildLocation(x: number, y: number, owner: number): boolean {
        if (!this.frameState || !this.frameState.placingBuilding) return false;
        return getPlacementError(this.frameState, this.frameState.placingBuilding, x, y, owner) === null;
    }

    private drawFogOverlay(
        ctx: CanvasRenderingContext2D,
        fogGrid: Uint8Array,
        gridW: number,
        camera: { x: number; y: number },
        zoom: number,
        canvasWidth: number,
        canvasHeight: number,
        mapHeight: number
    ) {
        const gridH = Math.ceil(mapHeight / TILE_SIZE);
        const tileScreenSize = TILE_SIZE * zoom;

        // Calculate visible tile range
        const startTileX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
        const startTileY = Math.max(0, Math.floor(camera.y / TILE_SIZE));
        const endTileX = Math.min(gridW - 1, Math.floor((camera.x + canvasWidth / zoom) / TILE_SIZE));
        const endTileY = Math.min(gridH - 1, Math.floor((camera.y + canvasHeight / zoom) / TILE_SIZE));

        // Draw solid black for unrevealed tiles.
        // PERFORMANCE: merge horizontal runs of unrevealed tiles into a single fillRect. At low zoom
        // thousands of tiles are visible and one call per tile dominates the frame.
        ctx.fillStyle = '#000';
        for (let ty = startTileY; ty <= endTileY; ty++) {
            const rowOffset = ty * gridW;
            const screenY = (ty * TILE_SIZE - camera.y) * zoom;
            let tx = startTileX;
            while (tx <= endTileX) {
                if (fogGrid[rowOffset + tx] !== 0) {
                    tx++;
                    continue;
                }
                const runStart = tx;
                while (tx <= endTileX && fogGrid[rowOffset + tx] === 0) tx++;
                const screenX = (runStart * TILE_SIZE - camera.x) * zoom;
                const runWidth = (tx - runStart) * tileScreenSize;
                ctx.fillRect(screenX, screenY, runWidth + 1, tileScreenSize + 1);
            }
        }

        // Edge smoothing — draw gradients at fog boundaries.
        // PERFORMANCE: the four edge gradients are defined once in tile-local coordinates (and rebuilt
        // only when the zoom changes) and each edge just translates to its tile, instead of
        // allocating a gradient + colour stops per edge per frame.
        const halfTile = tileScreenSize / 2;
        let gradients = this.fogEdgeGradients;
        if (!gradients || gradients.tileSize !== tileScreenSize || gradients.ctx !== ctx) {
            const make = (x0: number, y0: number, x1: number, y1: number) => {
                const grad = ctx.createLinearGradient(x0, y0, x1, y1);
                grad.addColorStop(0, 'rgba(0,0,0,0.7)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                return grad;
            };
            gradients = {
                ctx,
                tileSize: tileScreenSize,
                top: make(0, 0, 0, halfTile),
                bottom: make(0, tileScreenSize, 0, halfTile),
                left: make(0, 0, halfTile, 0),
                right: make(tileScreenSize, 0, halfTile, 0)
            };
            this.fogEdgeGradients = gradients;
        }

        ctx.save();
        for (let ty = startTileY; ty <= endTileY; ty++) {
            for (let tx = startTileX; tx <= endTileX; tx++) {
                if (fogGrid[ty * gridW + tx] !== 1) continue; // Only process revealed tiles

                const hasTop = ty > 0 && fogGrid[(ty - 1) * gridW + tx] === 0;
                const hasBottom = ty < gridH - 1 && fogGrid[(ty + 1) * gridW + tx] === 0;
                const hasLeft = tx > 0 && fogGrid[ty * gridW + (tx - 1)] === 0;
                const hasRight = tx < gridW - 1 && fogGrid[ty * gridW + (tx + 1)] === 0;
                if (!hasTop && !hasBottom && !hasLeft && !hasRight) continue;

                const screenX = (tx * TILE_SIZE - camera.x) * zoom;
                const screenY = (ty * TILE_SIZE - camera.y) * zoom;
                ctx.translate(screenX, screenY);

                if (hasTop) {
                    ctx.fillStyle = gradients.top;
                    ctx.fillRect(0, 0, tileScreenSize, halfTile);
                }
                if (hasBottom) {
                    ctx.fillStyle = gradients.bottom;
                    ctx.fillRect(0, halfTile, tileScreenSize, halfTile);
                }
                if (hasLeft) {
                    ctx.fillStyle = gradients.left;
                    ctx.fillRect(0, 0, halfTile, tileScreenSize);
                }
                if (hasRight) {
                    ctx.fillStyle = gradients.right;
                    ctx.fillRect(halfTile, 0, halfTile, tileScreenSize);
                }

                ctx.translate(-screenX, -screenY);
            }
        }
        ctx.restore();
    }

    /**
     * Find the entity under the cursor with the shared pickEntityAt (the same hit test as clicks and
     * the action cursor), skipping anything the fog hides.
     */
    private updateHover(
        mousePos: { x: number; y: number },
        camera: { x: number; y: number },
        zoom: number,
        fogGrid: Uint8Array | undefined,
        fogGridW: number
    ) {
        this.hoveredEntity = null;
        this.hoveredResourceId = null;
        if (mousePos.x < 0 || mousePos.y < 0 || mousePos.x >= this.cssWidth || mousePos.y >= this.cssHeight) return;

        const worldX = camera.x + mousePos.x / zoom;
        const worldY = camera.y + mousePos.y / zoom;
        const candidates = getSpatialGrid().queryRadius(worldX, worldY, HOVER_QUERY_RADIUS);
        const visible = (entity: Entity) =>
            !fogGrid || fogGrid[Math.floor(entity.pos.y / TILE_SIZE) * fogGridW + Math.floor(entity.pos.x / TILE_SIZE)] !== 0;

        this.hoveredEntity = pickEntityAt(candidates, worldX, worldY, entity =>
            (entity.type === 'UNIT' || entity.type === 'BUILDING') && visible(entity) && this.getEntityName(entity) !== ''
            && !(isAirUnit(entity) && entity.airUnit.state === 'docked'));
        this.hoveredResourceId = pickEntityAt(candidates, worldX, worldY, entity => entity.type === 'RESOURCE' && visible(entity))?.id ?? null;
    }

    private getEntityName(entity: Entity): string {
        if (entity.type === 'BUILDING') return RULES.buildings[entity.key]?.name ?? '';
        if (entity.type === 'UNIT') return RULES.units[entity.key]?.name ?? '';
        return '';
    }

    /** "You", "Ally P3 (A)", "Enemy P2", or for observers "P2 (B)". */
    private getOwnerLabel(owner: number, relation: OwnerRelation): string {
        if (relation === 'own') return 'You';
        const player = this.frameState?.players[owner];
        const name = player ? `P${owner + 1}${player.team ? ` (${player.team})` : ''}` : 'Neutral';
        if (relation === 'ally') return `Ally ${name}`;
        if (relation === 'enemy') return `Enemy ${name}`;
        return name;
    }

    private drawTooltip(
        mousePos: { x: number; y: number },
        camera: { x: number; y: number },
        zoom: number,
        localPlayerId: number | null,
        use3D: boolean
    ) {
        const entity = this.hoveredEntity;
        if (!entity) return;
        const name = this.getEntityName(entity);
        if (!name) return;

        const ctx = this.ctx;
        const relation = getOwnerRelation(this.frameState, entity.owner, localPlayerId);

        // Hover marker (skipped for own units that already show a selection ring). Its shape -
        // solid / dashed / crosshair - tells own, ally and enemy apart without colour.
        if (!this.selectionSet.has(entity.id)) {
            const lift = use3D ? heightToScreenLift(getAltitude(entity), zoom) : 0;
            const sc = this.worldToScreen(entity.pos, camera, zoom);
            const r = entity.type === 'BUILDING'
                ? Math.hypot(entity.w, entity.h) / 2 * zoom + 2
                : (entity.radius + 6) * zoom;
            ctx.save();
            ctx.translate(sc.x, sc.y - lift);
            ctx.globalAlpha = 0.75;
            this.strokeRelationRing(Math.max(8, r), relation, 1.5, 'rgba(255, 255, 255, 0.9)');
            ctx.restore();
        }

        ctx.save();
        ctx.font = '12px "Segoe UI", Arial, sans-serif';

        const ownerLabel = this.getOwnerLabel(entity.owner, relation);
        const hpLine = `${ownerLabel} · HP ${Math.max(0, Math.ceil(entity.hp))}/${entity.maxHp}`;
        const debugLine = this.frameState?.debugMode
            ? `${entity.id} (${Math.round(entity.pos.x)}, ${Math.round(entity.pos.y)})`
            : '';

        const padding = 6;
        const swatch = 8;
        const nameWidth = ctx.measureText(name).width;
        ctx.font = '11px "Segoe UI", Arial, sans-serif';
        const hpWidth = ctx.measureText(hpLine).width + swatch + 5;
        ctx.font = '10px "Segoe UI", Arial, sans-serif';
        const debugWidth = debugLine ? ctx.measureText(debugLine).width : 0;
        const w = Math.max(nameWidth, hpWidth, debugWidth) + padding * 2;
        const h = debugLine ? 52 : 38;

        // Keep tooltip on screen
        const finalX = Math.min(mousePos.x + 16, this.cssWidth - w - 10);
        const finalY = Math.min(mousePos.y + 16, this.cssHeight - h - 10);

        const isEnemy = relation === 'enemy';
        ctx.fillStyle = 'rgba(20, 30, 40, 0.9)';
        ctx.strokeStyle = isEnemy ? 'rgba(255, 100, 100, 0.5)' : 'rgba(100, 200, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(finalX, finalY, w, h, 4);
        ctx.fill();
        ctx.stroke();

        ctx.textBaseline = 'middle';
        ctx.font = '12px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = isEnemy ? '#ffaaaa' : '#ffffff';
        ctx.fillText(name, finalX + padding, finalY + 12);

        // Owner colour swatch + relation/owner + HP
        ctx.fillStyle = PLAYER_COLORS[entity.owner] ?? '#888888';
        ctx.fillRect(finalX + padding, finalY + 27 - swatch / 2, swatch, swatch);
        ctx.strokeStyle = '#000';
        ctx.strokeRect(finalX + padding + 0.5, finalY + 27 - swatch / 2 + 0.5, swatch - 1, swatch - 1);
        ctx.font = '11px "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = '#cfd8dc';
        ctx.fillText(hpLine, finalX + padding + swatch + 5, finalY + 27);

        if (debugLine) {
            ctx.fillStyle = '#aaaaaa';
            ctx.font = '10px "Segoe UI", Arial, sans-serif';
            ctx.fillText(debugLine, finalX + padding, finalY + 42);
        }
        ctx.restore();
    }
}

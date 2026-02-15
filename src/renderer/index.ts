import { GameState, Entity, Projectile, Particle, Vector, BUILD_RADIUS, PLAYER_COLORS, CommandIndicator } from '../engine/types.js';
import { getAsset, initGraphics } from './assets.js';
import { RULES } from '../data/schemas/index.js';
import { getSpatialGrid } from '../engine/spatial.js';
import { isUnit, isBuilding, isHarvester } from '../engine/type-guards.js';
import { isAirUnit } from '../engine/entity-helpers.js';

export class Renderer {
    private ctx: CanvasRenderingContext2D;
    private canvas: HTMLCanvasElement;
    private readonly selectionSet = new Set<string>();
    private readonly screenCulledEntities: Entity[] = [];
    private readonly resourceEntities: Entity[] = [];
    private readonly rockEntities: Entity[] = [];
    private readonly wellEntities: Entity[] = [];
    private readonly unitBuildingEntities: Entity[] = [];
    private readonly primaryBuildingIds = new Set<string>();

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d')!;
        this.resize();
        window.addEventListener('resize', () => this.resize());
        initGraphics();
    }

    resize() {
        const container = document.getElementById('game-container');
        const sidebar = document.getElementById('sidebar');
        const sidebarHidden = sidebar?.classList.contains('observer-hidden');

        if (container) {
            // In observer mode, canvas takes full width
            const sidebarWidth = sidebarHidden ? 0 : 300;
            this.canvas.width = container.clientWidth - sidebarWidth;
        } else {
            this.canvas.width = window.innerWidth - 300;
        }
        this.canvas.height = window.innerHeight;
    }

    getSize(): { width: number; height: number } {
        return { width: this.canvas.width, height: this.canvas.height };
    }

    render(state: GameState, dragStart: { x: number; y: number } | null, mousePos: { x: number; y: number }, localPlayerId: number | null = null, scrollOrigin: { x: number; y: number } | null = null) {
        const { camera, zoom, entities, projectiles, particles, selection, placingBuilding, tick } = state;
        const ctx = this.ctx;

        this.selectionSet.clear();
        for (const selectedId of selection) {
            this.selectionSet.add(selectedId);
        }

        // Clear
        ctx.fillStyle = '#2d3322';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;
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

        // OPTIMIZATION: Early culling - filter out entities outside screen bounds before sorting.
        for (const e of visibleEntities) {
            if (e.dead) continue;

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

        // Draw resources (no owner-specific colors)
        for (const entity of resourceEntities) {
            this.drawEntity(entity, effectiveCamera, zoom, this.selectionSet.has(entity.id), state.mode, tick, localPlayerId, entities);
        }

        // Draw rocks (no owner-specific colors)
        for (const entity of rockEntities) {
            this.drawEntity(entity, effectiveCamera, zoom, this.selectionSet.has(entity.id), state.mode, tick, localPlayerId, entities);
        }

        // Draw wells (no owner-specific colors)
        for (const entity of wellEntities) {
            this.drawEntity(entity, effectiveCamera, zoom, this.selectionSet.has(entity.id), state.mode, tick, localPlayerId, entities);
        }

        // Draw units and buildings (batched by owner for color caching)
        for (const entity of unitBuildingEntities) {
            this.drawEntity(entity, effectiveCamera, zoom, this.selectionSet.has(entity.id), state.mode, tick, localPlayerId, entities);
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
            const player = state.players[Number(pid)];
            const primaryBuildings = player?.primaryBuildings;
            if (!primaryBuildings) continue;
            if (primaryBuildings.infantry) primaryBuildingIds.add(primaryBuildings.infantry);
            if (primaryBuildings.vehicle) primaryBuildingIds.add(primaryBuildings.vehicle);
        }
        for (const buildingId of primaryBuildingIds) {
            const entity = entities[buildingId];
            if (entity && entity.type === 'BUILDING' && !entity.dead) {
                this.drawPrimaryIndicator(entity, effectiveCamera, zoom);
            }
        }

        // Draw projectiles
        for (const proj of projectiles) {
            if (proj.dead) continue;
            this.drawProjectile(proj, effectiveCamera, zoom, entities);
        }

        // Draw particles
        for (const particle of particles) {
            this.drawParticle(particle, effectiveCamera, zoom);
        }

        // Draw command indicator (move/attack target)
        if (state.commandIndicator) {
            this.drawCommandIndicator(state.commandIndicator, effectiveCamera, zoom, tick);
        }

        // Building placement preview
        if (state.mode !== 'demo' && placingBuilding && mousePos.x < canvasWidth) {
            this.drawPlacementPreview(placingBuilding, mousePos, effectiveCamera, zoom, entities, localPlayerId);
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
        this.drawTooltip(mousePos, sortedEntities, effectiveCamera, zoom, localPlayerId);


        ctx.restore();
    }

    private drawMapBorder(camera: { x: number; y: number }, zoom: number, mapWidth: number, mapHeight: number) {
        const ctx = this.ctx;
        const canvasWidth = this.canvas.width;
        const canvasHeight = this.canvas.height;

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

    private drawEntity(entity: Entity, camera: { x: number; y: number }, zoom: number, isSelected: boolean, mode: string, tick: number, localPlayerId: number | null, allEntities: Record<string, Entity>) {
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

        // Selection circle and HP bar
        // Always show HP bar if damaged, OR if selected
        if (isSelected || (entity.hp < entity.maxHp && entity.type !== 'RESOURCE')) {
            if (isSelected) {
                ctx.strokeStyle = '#0f0';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, entity.radius + 8, 0, Math.PI * 2);
                ctx.stroke();

                // MCV deploy hint
                if (entity.key === 'mcv' && localPlayerId !== null && entity.owner === localPlayerId && mode !== 'demo') {
                    ctx.fillStyle = '#fff';
                    ctx.font = '10px Arial';
                    ctx.textAlign = 'center';
                    ctx.fillText('Deploy (Enter)', 0, entity.radius + 20);
                }
            }

            // HP bar (Skipped for resources)
            if (entity.type !== 'RESOURCE' && (entity.hp < entity.maxHp || isSelected)) {
                ctx.fillStyle = 'red';
                ctx.fillRect(-15, -entity.radius - 12, 30, 4);
                ctx.fillStyle = '#0f0';
                ctx.fillRect(-15, -entity.radius - 12, 30 * Math.max(0, entity.hp / entity.maxHp), 4);
            }
        }

        // Draw repair icon for buildings being repaired (flashing)
        if (isBuilding(entity) && entity.building.isRepairing) {
            const showIcon = (tick % 30) < 20; // Flash on for 20 ticks, off for 10
            if (showIcon) {
                ctx.save();
                // Draw wrench icon above the building
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
        }

        // Draw entity
        if (entity.type === 'RESOURCE') {
            const img = getAsset(entity.key, entity.owner);
            if (img && img.complete) {
                ctx.drawImage(img, -entity.w / 2, -entity.h / 2, entity.w, entity.h);
            } else {
                ctx.fillStyle = '#d4af37';
                ctx.beginPath();
                ctx.arc(0, 0, 10, 0, Math.PI * 2);
                ctx.fill();
            }

            // Resource amount bar
            if (entity.hp < entity.maxHp) {
                const ratio = entity.hp / entity.maxHp;
                ctx.fillStyle = '#333';
                ctx.fillRect(-12, -15, 24, 4);
                ctx.fillStyle = '#ffdf00';
                ctx.fillRect(-12, -15, 24 * ratio, 4);
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

            const img = getAsset(entity.key, entity.owner);
            const playerColor = PLAYER_COLORS[entity.owner] || '#888888';

            // Get flash from combat component (units always have it, buildings may have it)
            const flash = entity.combat?.flash ?? 0;
            if (flash > 0) {
                ctx.fillStyle = '#fff';
                ctx.fillRect(-entity.w / 2, -entity.h / 2, entity.w, entity.h);
            } else if (img && img.complete) {
                ctx.drawImage(img, -entity.w / 2, -entity.h / 2, entity.w, entity.h);
            } else {
                ctx.fillStyle = playerColor;
                ctx.fillRect(-entity.w / 2, -entity.h / 2, entity.w, entity.h);
            }

            // Harvester Cargo Bar
            if (isHarvester(entity) && entity.harvester.cargo > 0) {
                const ratio = Math.min(1, entity.harvester.cargo / 500); // 500 is capacity
                ctx.fillStyle = '#333';
                ctx.fillRect(-10, -entity.h / 2 - 6, 20, 3);
                ctx.fillStyle = '#0ff';
                ctx.fillRect(-10, -entity.h / 2 - 6, 20 * ratio, 3);
            }

            // Air-Force Command: draw docked harrier indicators
            if (entity.type === 'BUILDING' && entity.key === 'airforce_command' && isBuilding(entity) && entity.airBase) {
                const slotPositions = [
                    { x: -30, y: -20 }, { x: 0, y: -20 }, { x: 30, y: -20 },
                    { x: -30, y: 10 }, { x: 0, y: 10 }, { x: 30, y: 10 }
                ];
                for (let i = 0; i < entity.airBase.slots.length; i++) {
                    const slotId = entity.airBase.slots[i];
                    const pos = slotPositions[i] || { x: 0, y: 0 };
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
                            const hpRatio = harrier.hp / harrier.maxHp;
                            ctx.fillStyle = 'red';
                            ctx.fillRect(-8, 8, 16, 3);
                            ctx.fillStyle = '#0f0';
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
                const turretImg = getAsset(turretKey, entity.owner);

                if (turretImg && turretImg.complete) {
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
    }

    private drawProjectile(proj: Projectile, camera: { x: number; y: number }, zoom: number, entities: Record<string, Entity>) {
        const ctx = this.ctx;
        const sc = this.worldToScreen(proj.pos, camera, zoom);

        // Calculate visual Y offset for arc
        let yOffset = 0;
        if (proj.arcHeight > 0) {
            const targetEntity = entities[proj.targetId];
            const targetPos = targetEntity?.pos || proj.pos;
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
        if (trailPoints.length < 2) return;

        const ctx = this.ctx;

        for (let i = 1; i < trailPoints.length; i++) {
            const prev = this.worldToScreen(trailPoints[i - 1], camera, zoom);
            const curr = this.worldToScreen(trailPoints[i], camera, zoom);

            const opacity = (i / trailPoints.length) * 0.3;
            ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
            ctx.lineWidth = 1 * zoom;

            ctx.beginPath();
            ctx.moveTo(prev.x, prev.y);
            ctx.lineTo(curr.x, curr.y);
            ctx.stroke();
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
        const color = indicator.type === 'move' ? '#44ff44' : '#ff4444';

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

    private drawPrimaryIndicator(building: Entity, camera: { x: number; y: number }, zoom: number) {
        const ctx = this.ctx;
        const screen = this.worldToScreen(building.pos, camera, zoom);

        ctx.save();

        // Draw a yellow star at the top-right corner of the building
        const starSize = 8 * zoom;
        const offsetX = (building.w / 2) * zoom - 5 * zoom;
        const offsetY = -(building.h / 2) * zoom + 5 * zoom;

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
        localPlayerId: number | null
    ) {
        const ctx = this.ctx;
        const mx = (mousePos.x / zoom) + camera.x;
        const my = (mousePos.y / zoom) + camera.y;

        const playerId = localPlayerId ?? 0;
        const valid = this.isValidBuildLocation(mx, my, playerId, entities);
        const b = RULES.buildings[buildingKey];
        if (!b) return;

        // Draw build radius indicators for player buildings
        ctx.save();
        for (const id in entities) {
            const e = entities[id];
            if (e.owner === playerId && e.type === 'BUILDING' && !e.dead) {
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
        ctx.fillStyle = valid ? 'rgba(0,255,0,0.5)' : 'rgba(255,0,0,0.5)';
        ctx.fillRect(sc.x - (b.w / 2) * zoom, sc.y - (b.h / 2) * zoom, b.w * zoom, b.h * zoom);
        ctx.restore();
    }

    private isValidBuildLocation(x: number, y: number, owner: number, entities: Record<string, Entity>): boolean {
        let near = false;
        const buildRadiusSq = BUILD_RADIUS * BUILD_RADIUS;
        for (const id in entities) {
            const e = entities[id];
            if (e.owner === owner && e.type === 'BUILDING' && !e.dead) {
                const dx = e.pos.x - x;
                const dy = e.pos.y - y;
                if ((dx * dx + dy * dy) < buildRadiusSq) {
                    near = true;
                    break;
                }
            }
        }

        // Also check no collision with existing entities
        for (const id in entities) {
            const e = entities[id];
            if (!e.dead) {
                const dx = e.pos.x - x;
                const dy = e.pos.y - y;
                const minDistance = e.radius + 45;
                if ((dx * dx + dy * dy) < (minDistance * minDistance)) {
                    return false;
                }
            }
        }

        return near;
    }

    private drawTooltip(
        mousePos: { x: number; y: number },
        _entities: Entity[],
        camera: { x: number; y: number },
        zoom: number,
        localPlayerId: number | null
    ) {
        const ctx = this.ctx;

        // Convert mouse position to world coordinates
        const worldX = camera.x + mousePos.x / zoom;
        const worldY = camera.y + mousePos.y / zoom;

        // Use spatial grid to find only nearby entities (50 pixel radius covers most entities)
        const nearbyEntities = getSpatialGrid().queryRadius(worldX, worldY, 60);

        // Sort by Y (descending) to find top-most entity first
        nearbyEntities.sort((a, b) => b.pos.y - a.pos.y);

        for (const entity of nearbyEntities) {
            // Only show tooltips for units and buildings
            if (entity.dead) continue;
            if (entity.type !== 'UNIT' && entity.type !== 'BUILDING') continue;

            // Check collision
            const s = this.worldToScreen(entity.pos, camera, zoom);
            const dx = s.x - mousePos.x;
            const dy = s.y - mousePos.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            // Adjusted radius for simpler hit detection
            // Use slightly larger radius to make hovering easier
            if (dist < (entity.radius + 5) * zoom) {
                let name = '';
                if (entity.type === 'BUILDING' && RULES.buildings[entity.key]) {
                    name = RULES.buildings[entity.key].name;
                } else if (entity.type === 'UNIT' && RULES.units[entity.key]) {
                    name = RULES.units[entity.key].name;
                }

                if (name) {
                    ctx.save();
                    ctx.font = '12px "Segoe UI", Arial, sans-serif';

                    // In observer mode (localPlayerId === null), show extra debug info
                    const isObserver = localPlayerId === null;
                    let tooltipText = name;
                    let extraLine = '';
                    if (isObserver) {
                        extraLine = `${entity.id} (${Math.round(entity.pos.x)}, ${Math.round(entity.pos.y)})`;
                    }

                    const metrics = ctx.measureText(tooltipText);
                    const extraMetrics = extraLine ? ctx.measureText(extraLine) : { width: 0 };
                    const padding = 6;
                    const w = Math.max(metrics.width, extraMetrics.width) + (padding * 2);
                    const h = isObserver ? 40 : 24;
                    const x = mousePos.x + 16;
                    const y = mousePos.y + 16;

                    // Keep tooltip on screen
                    const finalX = Math.min(x, this.canvas.width - w - 10);
                    const finalY = Math.min(y, this.canvas.height - h - 10);

                    // Background
                    const isEnemy = localPlayerId !== null ? entity.owner !== localPlayerId : entity.owner !== -1;
                    ctx.fillStyle = 'rgba(20, 30, 40, 0.9)';
                    ctx.strokeStyle = isEnemy ? 'rgba(255, 100, 100, 0.5)' : 'rgba(100, 200, 255, 0.5)';
                    ctx.lineWidth = 1;

                    ctx.beginPath();
                    ctx.roundRect(finalX, finalY, w, h, 4);
                    ctx.fill();
                    ctx.stroke();

                    // Text
                    ctx.fillStyle = isEnemy ? '#ffaaaa' : '#ffffff';
                    ctx.textBaseline = 'middle';
                    if (isObserver) {
                        ctx.fillText(tooltipText, finalX + padding, finalY + 12);
                        ctx.fillStyle = '#aaaaaa';
                        ctx.font = '10px "Segoe UI", Arial, sans-serif';
                        ctx.fillText(extraLine, finalX + padding, finalY + 28);
                    } else {
                        ctx.fillText(tooltipText, finalX + padding, finalY + (h / 2));
                    }
                    ctx.restore();

                    // Only show one tooltip
                    return;
                }
            }
        }
    }
}

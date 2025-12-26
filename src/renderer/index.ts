import { GameState, Entity, Projectile, Particle, Vector, BUILD_RADIUS, PLAYER_COLORS } from '../engine/types.js';
import { getAsset, initGraphics } from './assets.js';
import rules from '../data/rules.json';

const RULES = rules as any;

export class Renderer {
    private ctx: CanvasRenderingContext2D;
    private canvas: HTMLCanvasElement;

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

    render(state: GameState, dragStart: { x: number; y: number } | null, mousePos: { x: number; y: number }) {
        const { camera, zoom, entities, projectiles, particles, selection, placingBuilding } = state;
        const ctx = this.ctx;

        // Clear
        ctx.fillStyle = '#2d3322';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        ctx.save();

        // Sort entities by Y for proper layering
        const sortedEntities = Object.values(entities).sort((a, b) => a.pos.y - b.pos.y);

        // Draw entities
        for (const entity of sortedEntities) {
            if (entity.dead) continue;
            this.drawEntity(entity, camera, zoom, selection.includes(entity.id), state.mode);
        }

        // Draw projectiles
        for (const proj of projectiles) {
            if (proj.dead) continue;
            this.drawProjectile(proj, camera, zoom);
        }

        // Draw particles
        for (const particle of particles) {
            this.drawParticle(particle, camera, zoom);
        }

        // Building placement preview
        if (state.mode !== 'demo' && placingBuilding && mousePos.x < this.canvas.width) {
            this.drawPlacementPreview(placingBuilding, mousePos, camera, zoom, Object.values(entities));
        }


        // Drag selection box
        if (dragStart) {
            ctx.strokeStyle = '#0f0';
            ctx.strokeRect(dragStart.x, dragStart.y, mousePos.x - dragStart.x, mousePos.y - dragStart.y);
        }

        // Draw tooltips
        this.drawTooltip(mousePos, sortedEntities, camera, zoom);

        ctx.restore();
    }

    private worldToScreen(worldPos: Vector, camera: { x: number; y: number }, zoom: number): { x: number; y: number } {
        return {
            x: (worldPos.x - camera.x) * zoom,
            y: (worldPos.y - camera.y) * zoom
        };
    }

    private drawEntity(entity: Entity, camera: { x: number; y: number }, zoom: number, isSelected: boolean, mode: string) {
        const ctx = this.ctx;
        const sc = this.worldToScreen(entity.pos, camera, zoom);

        // Culling
        if (sc.x < -100 || sc.x > this.canvas.width + 100 || sc.y < -100 || sc.y > this.canvas.height + 100) {
            return;
        }

        ctx.save();
        ctx.translate(sc.x, sc.y);
        ctx.scale(zoom, zoom);

        // Selection circle and HP bar
        // Always show HP bar if damaged, OR if selected
        if (isSelected || entity.hp < entity.maxHp) {
            if (isSelected) {
                ctx.strokeStyle = '#0f0';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, entity.radius + 8, 0, Math.PI * 2);
                ctx.stroke();

                // MCV deploy hint
                if (entity.key === 'mcv' && entity.owner === 0 && mode !== 'demo') {
                    ctx.fillStyle = '#fff';
                    ctx.font = '10px Arial';
                    ctx.fillText('Deploy (D)', -25, entity.radius + 20);
                }
            }

            // HP bar
            if (entity.hp < entity.maxHp || isSelected) {
                ctx.fillStyle = 'red';
                ctx.fillRect(-15, -entity.radius - 12, 30, 4);
                ctx.fillStyle = '#0f0';
                ctx.fillRect(-15, -entity.radius - 12, 30 * Math.max(0, entity.hp / entity.maxHp), 4);
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
        } else {
            ctx.rotate(entity.rotation);

            const img = getAsset(entity.key, entity.owner);
            const playerColor = PLAYER_COLORS[entity.owner] || '#888888';

            if (entity.flash > 0) {
                ctx.fillStyle = '#fff';
                ctx.fillRect(-entity.w / 2, -entity.h / 2, entity.w, entity.h);
            } else if (img && img.complete) {
                ctx.drawImage(img, -entity.w / 2, -entity.h / 2, entity.w, entity.h);
            } else {
                ctx.fillStyle = playerColor;
                ctx.fillRect(-entity.w / 2, -entity.h / 2, entity.w, entity.h);
            }

            // Harvester Cargo Bar
            if (entity.key === 'harvester' && entity.cargo > 0) {
                const ratio = Math.min(1, entity.cargo / 500); // 500 is capacity
                ctx.fillStyle = '#333';
                ctx.fillRect(-10, -entity.h / 2 - 6, 20, 3);
                ctx.fillStyle = '#0ff';
                ctx.fillRect(-10, -entity.h / 2 - 6, 20 * ratio, 3);
            }
        }

        ctx.restore();
    }

    private drawProjectile(proj: Projectile, camera: { x: number; y: number }, zoom: number) {
        const ctx = this.ctx;
        const sc = this.worldToScreen(proj.pos, camera, zoom);

        ctx.fillStyle = proj.type === 'heal' ? '#0f0' : (proj.type === 'rocket' ? '#f55' : '#ff0');
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, 3 * zoom, 0, Math.PI * 2);
        ctx.fill();
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

    private drawPlacementPreview(
        buildingKey: string,
        mousePos: { x: number; y: number },
        camera: { x: number; y: number },
        zoom: number,
        entities: Entity[]
    ) {
        const ctx = this.ctx;
        const mx = (mousePos.x / zoom) + camera.x;
        const my = (mousePos.y / zoom) + camera.y;

        const valid = this.isValidBuildLocation(mx, my, 0, entities);
        const b = RULES.buildings[buildingKey];
        if (!b) return;

        // Draw build radius indicators for player buildings
        ctx.save();
        for (const e of entities) {
            if (e.owner === 0 && e.type === 'BUILDING' && !e.dead) {
                const s = this.worldToScreen(e.pos, camera, zoom);
                ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                ctx.beginPath();
                ctx.arc(s.x, s.y, BUILD_RADIUS * zoom, 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        // Draw ghost building
        const sc = this.worldToScreen(new Vector(mx, my), camera, zoom);
        ctx.fillStyle = valid ? 'rgba(0,255,0,0.5)' : 'rgba(255,0,0,0.5)';
        ctx.fillRect(sc.x - (b.w / 2) * zoom, sc.y - (b.h / 2) * zoom, b.w * zoom, b.h * zoom);
        ctx.restore();
    }

    private isValidBuildLocation(x: number, y: number, owner: number, entities: Entity[]): boolean {
        let near = false;
        for (const e of entities) {
            if (e.owner === owner && e.type === 'BUILDING' && !e.dead) {
                if (e.pos.dist(new Vector(x, y)) < BUILD_RADIUS) {
                    near = true;
                    break;
                }
            }
        }

        // Also check no collision with existing entities
        for (const e of entities) {
            if (!e.dead && e.pos.dist(new Vector(x, y)) < (e.radius + 45)) {
                return false;
            }
        }

        return near;
    }

    private drawTooltip(
        mousePos: { x: number; y: number },
        entities: Entity[],
        camera: { x: number; y: number },
        zoom: number
    ) {
        const ctx = this.ctx;

        // Iterate backwards to find the top-most entity
        for (let i = entities.length - 1; i >= 0; i--) {
            const entity = entities[i];

            // Only show tooltips for units and buildings
            if (entity.dead) continue;
            if (entity.type !== 'UNIT' && entity.type !== 'BUILDING') continue;

            // Check collision
            const s = this.worldToScreen(entity.pos, camera, zoom);
            const dist = Math.sqrt(Math.pow(s.x - mousePos.x, 2) + Math.pow(s.y - mousePos.y, 2));

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
                    const metrics = ctx.measureText(name);
                    const padding = 6;
                    const w = metrics.width + (padding * 2);
                    const h = 24;
                    const x = mousePos.x + 16;
                    const y = mousePos.y + 16;

                    // Keep tooltip on screen
                    const finalX = Math.min(x, this.canvas.width - w - 10);
                    const finalY = Math.min(y, this.canvas.height - h - 10);

                    // Background
                    const isEnemy = entity.owner !== 0; // Assuming 0 is local player
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
                    ctx.fillText(name, finalX + padding, finalY + (h / 2));
                    ctx.restore();

                    // Only show one tooltip
                    return;
                }
            }
        }
    }
}

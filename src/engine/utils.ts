import { Entity, Vector, TILE_SIZE, GRID_W, GRID_H } from './types.js';
import rules from '../data/rules.json';

const RULES = rules as any;

// Collision grid
export const collisionGrid = new Uint8Array(GRID_W * GRID_H);

export function markGrid(x: number, y: number, w: number, h: number, blocked: boolean): void {
    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);
    const gw = Math.ceil(w / TILE_SIZE);
    const gh = Math.ceil(h / TILE_SIZE);

    for (let j = gy; j < gy + gh; j++) {
        for (let i = gx; i < gx + gw; i++) {
            if (i >= 0 && i < GRID_W && j >= 0 && j < GRID_H) {
                collisionGrid[j * GRID_W + i] = blocked ? 1 : 0;
            }
        }
    }
}

export function refreshCollisionGrid(entities: Record<string, Entity> | Entity[]): void {
    collisionGrid.fill(0);
    const list = Array.isArray(entities) ? entities : Object.values(entities);
    for (const e of list) {
        if (e.type === 'BUILDING' && !e.dead) {
            markGrid(e.pos.x - e.w / 2, e.pos.y - e.h / 2, e.w, e.h, true);
        }
        // Optional: Mark resources as blocked? 
        // Ore is small, maybe walkable? 
        // Trees?
    }
}

let nextEntityId = 1;

export function createEntity(x: number, y: number, owner: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE', statsKey: string): Entity {
    const isBuilding = type === 'BUILDING';
    const isResource = type === 'RESOURCE';

    let data: any;
    if (isBuilding) {
        data = RULES.buildings[statsKey];
    } else if (isResource) {
        data = { hp: 1000, w: 25, h: 25 };
    } else {
        data = RULES.units[statsKey];
    }

    if (!data) {
        data = { hp: 100, w: 20, h: 20 };
    }

    const entity: Entity = {
        id: 'e' + (nextEntityId++),
        owner,
        type,
        key: statsKey,
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp: data.hp || 100,
        maxHp: data.hp || 100,
        w: data.w || 20,
        h: data.h || data.w || 20,
        radius: Math.max(data.w || 20, data.h || data.w || 20) / 2,
        dead: false,
        vel: new Vector(0, 0),
        rotation: 0,
        moveTarget: null,
        path: null,
        pathIdx: 0,
        finalDest: null,
        stuckTimer: 0,
        unstuckDir: null,
        unstuckTimer: 0,
        targetId: null,
        lastAttackerId: null,
        cooldown: 0,
        flash: 0,
        cargo: 0,
        resourceTargetId: null,
        baseTargetId: null
    };

    return entity;
}

export function findOpenSpot(x: number, y: number, radius: number, entities: Entity[]): Vector {
    for (let r = radius; r < radius + 200; r += 20) {
        for (let a = 0; a < Math.PI * 2; a += 0.5) {
            const cx = x + Math.cos(a) * r;
            const cy = y + Math.sin(a) * r;
            const gx = Math.floor(cx / TILE_SIZE);
            const gy = Math.floor(cy / TILE_SIZE);

            if (gx >= 0 && gx < GRID_W && gy >= 0 && gy < GRID_H && collisionGrid[gy * GRID_W + gx] === 0) {
                let clear = true;
                for (const e of entities) {
                    if (e.pos.dist(new Vector(cx, cy)) < e.radius + 15) {
                        clear = false;
                        break;
                    }
                }
                if (clear) return new Vector(cx, cy);
            }
        }
    }
    return new Vector(x, y + radius);
}

export function spawnParticle(particles: any[], x: number, y: number, color: string, speed: number): void {
    particles.push({
        pos: new Vector(x, y),
        vel: new Vector((Math.random() - 0.5) * speed, (Math.random() - 0.5) * speed),
        life: 15 + Math.random() * 15,
        color
    });
}

export function spawnFloater(particles: any[], x: number, y: number, text: string, color: string): void {
    particles.push({
        pos: new Vector(x, y),
        vel: new Vector(0, -1),
        life: 40,
        text,
        color
    });
}

export function hasBuilding(key: string, owner: number, entities: Entity[]): boolean {
    return entities.some(e => e.owner === owner && e.key === key && !e.dead);
}

export function calculatePower(entities: Entity[]): Record<number, { in: number; out: number }> {
    const power: Record<number, { in: number; out: number }> = {
        0: { in: 0, out: 0 },
        1: { in: 0, out: 0 }
    };

    for (const e of entities) {
        if (e.type === 'BUILDING' && !e.dead && e.owner >= 0) {
            const data = RULES.buildings[e.key];
            if (data) {
                if ('power' in data) power[e.owner].out += data.power;
                if ('drain' in data) power[e.owner].in += data.drain;
            }
        }
    }

    return power;
}

export function isValidMCVSpot(x: number, y: number, selfId: string | null, entities: Entity[]): boolean {
    const gx = Math.floor(x / TILE_SIZE);
    const gy = Math.floor(y / TILE_SIZE);

    if (gx >= 0 && gx + 2 < GRID_W && gy >= 0 && gy + 2 < GRID_H) {
        if (collisionGrid[gy * GRID_W + gx] === 1) return false;
    }

    for (const e of entities) {
        if (!e.dead && e.id !== selfId && e.pos.dist(new Vector(x, y)) < (e.radius + 45)) {
            return false;
        }
    }
    return true;
}

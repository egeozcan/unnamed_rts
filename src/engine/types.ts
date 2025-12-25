export type PlayerId = string;
export type EntityId = string;

export interface Position {
    readonly x: number;
    readonly y: number;
}

export class Vector {
    readonly x: number;
    readonly y: number;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }

    add(v: Vector): Vector {
        return new Vector(this.x + v.x, this.y + v.y);
    }

    sub(v: Vector): Vector {
        return new Vector(this.x - v.x, this.y - v.y);
    }

    mag(): number {
        return Math.sqrt(this.x * this.x + this.y * this.y);
    }

    dot(other: Vector): number {
        return this.x * other.x + this.y * other.y;
    }

    norm(): Vector {
        const m = this.mag();
        return m === 0 ? new Vector(0, 0) : new Vector(this.x / m, this.y / m);
    }

    scale(s: number): Vector {
        return new Vector(this.x * s, this.y * s);
    }

    dist(v: Vector): number {
        return Math.sqrt(Math.pow(this.x - v.x, 2) + Math.pow(this.y - v.y, 2));
    }
}

export type EntityType = 'UNIT' | 'BUILDING' | 'RESOURCE';

export interface Entity {
    readonly id: EntityId;
    readonly owner: number; // 0 = player, 1 = enemy, -1 = neutral
    readonly type: EntityType;
    readonly key: string; // 'harvester', 'conyard', 'power', etc.
    readonly pos: Vector;
    readonly prevPos: Vector;
    readonly hp: number;
    readonly maxHp: number;
    readonly w: number;
    readonly h: number;
    readonly radius: number;
    readonly dead: boolean;

    // Movement
    readonly vel: Vector;
    readonly rotation: number;
    readonly moveTarget: Vector | null;
    readonly path: Vector[] | null;
    readonly pathIdx: number;
    readonly finalDest: Vector | null;
    readonly stuckTimer: number;
    readonly unstuckDir: Vector | null;
    readonly unstuckTimer: number;

    // Combat
    readonly targetId: EntityId | null; // Changed to ID for serializability check
    readonly lastAttackerId: EntityId | null; // Changed to ID
    readonly cooldown: number;
    readonly flash: number;

    // Harvester specific
    readonly cargo: number;
    readonly resourceTargetId: EntityId | null; // Changed to ID
    readonly baseTargetId: EntityId | null; // Changed to ID
    readonly dockPos?: Vector;
    readonly avgVel?: Vector;
}

export interface Projectile {
    readonly ownerId: EntityId;
    readonly pos: Vector;
    readonly vel: Vector;
    readonly targetId: EntityId;
    readonly speed: number;
    readonly damage: number;
    readonly splash: number;
    readonly type: 'bullet' | 'rocket' | 'heal';
    readonly dead: boolean;
}

export interface Particle {
    readonly pos: Vector;
    readonly vel: Vector;
    readonly life: number;
    readonly color: string;
    readonly text?: string;
}

export interface ProductionQueue {
    readonly current: string | null;
    readonly progress: number;
}

export interface Camera {
    readonly x: number;
    readonly y: number;
}

export type GameMode = 'menu' | 'game' | 'demo';

export interface PlayerState {
    readonly id: number; // Changed to number to match owner
    readonly isAi: boolean;
    readonly credits: number;
    readonly maxPower: number;
    readonly usedPower: number;
    readonly queues: {
        building: ProductionQueue;
        infantry: ProductionQueue;
        vehicle: ProductionQueue;
        air: ProductionQueue;
    };
    readonly readyToPlace: string | null;
}

export interface MapConfig {
    readonly width: number;
    readonly height: number;
}

export interface Power {
    readonly in: number;  // consumption
    readonly out: number; // production
}

export interface GameState {
    readonly running: boolean;
    readonly mode: GameMode;
    readonly difficulty: 'easy' | 'hard';
    readonly tick: number;

    readonly camera: Camera;
    readonly zoom: number;

    readonly entities: Record<EntityId, Entity>; // Changed to Record for easier ID lookup
    readonly projectiles: Projectile[];
    readonly particles: Particle[];
    readonly selection: EntityId[]; // Store IDs

    readonly placingBuilding: string | null;

    readonly players: Record<number, PlayerState>; // Replaces money/power/production

    readonly config: MapConfig;
}

export type ActionType =
    | 'TICK'
    | 'COMMAND_MOVE'
    | 'COMMAND_ATTACK'
    | 'START_BUILD'
    | 'PLACE_BUILDING'
    | 'CANCEL_BUILD'
    | 'SELECT_UNITS';

export interface Action {
    type: ActionType;
    payload?: any;
}

// Constants
export const MAP_WIDTH = 3000;
export const MAP_HEIGHT = 3000;
export const TILE_SIZE = 40;
export const GRID_W = Math.ceil(MAP_WIDTH / TILE_SIZE);
export const GRID_H = Math.ceil(MAP_HEIGHT / TILE_SIZE);
export const BUILD_RADIUS = 350;
export const PLAYER_COLOR = '#4488ff';
export const ENEMY_COLOR = '#ff4444';


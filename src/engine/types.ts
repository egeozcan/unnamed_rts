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

export type EntityType = 'UNIT' | 'BUILDING' | 'RESOURCE' | 'ROCK';

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
    readonly turretAngle: number; // Angle the turret is facing (for tanks/defensive buildings)

    // Harvester specific
    readonly cargo: number;
    readonly resourceTargetId: EntityId | null; // Changed to ID
    readonly baseTargetId: EntityId | null; // Changed to ID
    readonly dockPos?: Vector;
    readonly avgVel?: Vector;

    // Specialized unit flags
    readonly captureTargetId?: EntityId | null;
    readonly repairTargetId?: EntityId | null;

    // Building repair state
    readonly isRepairing?: boolean;

    // Building metadata
    readonly placedTick?: number; // Tick when building was placed (for AI decision-making)
}

export interface Projectile {
    readonly ownerId: EntityId;
    readonly pos: Vector;
    readonly vel: Vector;
    readonly targetId: EntityId;
    readonly speed: number;
    readonly damage: number;
    readonly splash: number;
    readonly type: string;
    readonly weaponType?: string;
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
    readonly invested: number;  // Credits already spent on this item
}

export interface Camera {
    readonly x: number;
    readonly y: number;
}

export type GameMode = 'menu' | 'game' | 'demo';

// Player type for skirmish configuration
export type PlayerType = 'human' | 'easy' | 'medium' | 'hard' | 'none';

// Skirmish configuration for game setup
export interface SkirmishConfig {
    readonly players: Array<{
        slot: number;
        type: PlayerType;
        color: string;
    }>;
    readonly mapSize: 'small' | 'medium' | 'large' | 'huge';
    readonly resourceDensity: 'low' | 'medium' | 'high';
    readonly rockDensity: 'low' | 'medium' | 'high';
}

export interface PlayerState {
    readonly id: number; // Changed to number to match owner
    readonly isAi: boolean;
    readonly difficulty: 'easy' | 'medium' | 'hard';
    readonly color: string;
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
    readonly resourceDensity: 'low' | 'medium' | 'high';
    readonly rockDensity: 'low' | 'medium' | 'high';
}

export interface Power {
    readonly in: number;  // consumption
    readonly out: number; // production
}

export interface GameState {
    readonly running: boolean;
    readonly mode: GameMode;
    readonly sellMode: boolean;
    readonly repairMode: boolean;
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

    readonly winner: number | null;
    readonly config: MapConfig;

    readonly debugMode: boolean;
    readonly showMinimap: boolean;
}

export type ActionType =
    | 'TICK'
    | 'COMMAND_MOVE'
    | 'COMMAND_ATTACK'
    | 'START_BUILD'
    | 'PLACE_BUILDING'
    | 'CANCEL_BUILD'
    | 'SELECT_UNITS'
    | 'SELL_BUILDING'
    | 'TOGGLE_SELL_MODE'
    | 'TOGGLE_REPAIR_MODE'
    | 'START_REPAIR'
    | 'STOP_REPAIR'
    | 'TOGGLE_DEBUG'
    | 'TOGGLE_MINIMAP';

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

// Maximum players supported
export const MAX_PLAYERS = 8;

// Player colors for up to 8 players
export const PLAYER_COLORS = [
    '#4488ff', // Blue
    '#ff4444', // Red
    '#44ff88', // Green
    '#ffcc44', // Yellow
    '#ff44ff', // Magenta
    '#44ffff', // Cyan
    '#ff8844', // Orange
    '#8844ff', // Purple
];

// Map size presets
export const MAP_SIZES = {
    small: { width: 2000, height: 2000 },      // 2 players
    medium: { width: 3000, height: 3000 },     // 2-4 players
    large: { width: 4000, height: 4000 },      // 4-6 players
    huge: { width: 5000, height: 5000 }        // 6-8 players
};

// Density settings
export const DENSITY_SETTINGS = {
    low: { resources: 80, rocks: 15 },
    medium: { resources: 150, rocks: 30 },
    high: { resources: 250, rocks: 50 }
};

// Legacy colors for backwards compatibility
export const PLAYER_COLOR = PLAYER_COLORS[0];
export const ENEMY_COLOR = PLAYER_COLORS[1];


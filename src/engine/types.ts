import {
    MovementComponent,
    CombatComponent,
    HarvesterComponent,
    EngineerComponent,
    BuildingStateComponent,
    WellComponent,
    AirUnitComponent,
    AirBaseComponent,
    InductionRigComponent,
    AttackStance
} from './components.js';

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

// ============ KEY TYPES ============
// Type-safe keys for each entity category

export type UnitKey =
    | 'harvester'
    | 'rifle' | 'rocket' | 'engineer' | 'medic' | 'sniper' | 'flamer' | 'grenadier' | 'commando'
    | 'jeep' | 'apc' | 'light' | 'heavy' | 'flame_tank' | 'stealth' | 'artillery' | 'mlrs' | 'mammoth'
    | 'heli' | 'harrier' | 'mcv' | 'induction_rig';

export type BuildingKey =
    | 'conyard' | 'power' | 'refinery' | 'barracks' | 'factory'
    | 'turret' | 'sam_site' | 'pillbox' | 'obelisk' | 'tech' | 'airforce_command' | 'service_depot'
    | 'induction_rig_deployed';

export type ResourceKey = 'ore';
export type RockKey = 'rock';
export type WellKey = 'well';

export type EntityType = 'UNIT' | 'BUILDING' | 'RESOURCE' | 'ROCK' | 'WELL';

// ============ BASE ENTITY ============
// Properties shared by all entity types

export interface BaseEntity {
    readonly id: EntityId;
    readonly owner: number; // 0-7 = players, -1 = neutral
    readonly pos: Vector;
    readonly prevPos: Vector;
    readonly hp: number;
    readonly maxHp: number;
    readonly w: number;
    readonly h: number;
    readonly radius: number;
    readonly dead: boolean;
}

// ============ UNIT ENTITIES ============

// Combat units (all units except harvester and harrier which have their own interfaces)
export interface CombatUnit extends BaseEntity {
    readonly type: 'UNIT';
    readonly key: Exclude<UnitKey, 'harvester' | 'harrier'>;
    readonly movement: MovementComponent;
    readonly combat: CombatComponent;
    readonly engineer?: EngineerComponent; // Only for engineer units
}

// Harvester units (special unit with harvesting capability)
export interface HarvesterUnit extends BaseEntity {
    readonly type: 'UNIT';
    readonly key: 'harvester';
    readonly movement: MovementComponent;
    readonly combat: CombatComponent;
    readonly harvester: HarvesterComponent;
}

// Air units (harriers that dock and reload)
export interface AirUnit extends BaseEntity {
    readonly type: 'UNIT';
    readonly key: 'harrier';  // Can be extended for more air unit types later
    readonly movement: MovementComponent;
    readonly combat: CombatComponent;
    readonly airUnit: AirUnitComponent;
}

export type UnitEntity = CombatUnit | HarvesterUnit | AirUnit;

// ============ BUILDING ENTITIES ============

export interface BuildingEntity extends BaseEntity {
    readonly type: 'BUILDING';
    readonly key: BuildingKey;
    readonly combat?: CombatComponent; // Only for defense buildings (turret, sam_site, etc.)
    readonly building: BuildingStateComponent;
    readonly airBase?: AirBaseComponent; // Only for airforce_command
    readonly inductionRig?: InductionRigComponent; // Only for induction_rig_deployed
}

// ============ STATIC ENTITIES ============

export interface ResourceEntity extends BaseEntity {
    readonly type: 'RESOURCE';
    readonly key: ResourceKey;
}

export interface RockEntity extends BaseEntity {
    readonly type: 'ROCK';
    readonly key: RockKey;
}

export interface WellEntity extends BaseEntity {
    readonly type: 'WELL';
    readonly key: WellKey;
    readonly well: WellComponent;
}

// ============ DISCRIMINATED UNION ============

export type Entity = UnitEntity | BuildingEntity | ResourceEntity | RockEntity | WellEntity;

// Re-export component types for convenience
export type {
    MovementComponent,
    CombatComponent,
    HarvesterComponent,
    EngineerComponent,
    BuildingStateComponent,
    WellComponent,
    AirUnitComponent,
    AirBaseComponent,
    AirUnitState,
    InductionRigComponent,
    AttackStance
} from './components.js';

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
    readonly queued?: readonly string[];  // Queued items waiting to be built (max 99 total)
}

export interface Camera {
    readonly x: number;
    readonly y: number;
}

export type GameMode = 'menu' | 'game' | 'demo';

// Player type for skirmish configuration
export type PlayerType = 'human' | 'dummy' | 'easy' | 'medium' | 'hard' | 'none';

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
    readonly difficulty: 'dummy' | 'easy' | 'medium' | 'hard';
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
    readonly primaryBuildings?: {
        infantry: EntityId | null;  // Primary barracks
        vehicle: EntityId | null;   // Primary factory
    };
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

export interface CommandIndicator {
    readonly pos: Vector;
    readonly type: 'move' | 'attack';
    readonly startTick: number;
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
    readonly showBirdsEye: boolean;
    readonly notification?: { text: string; type: 'info' | 'error'; tick: number } | null;
    readonly attackMoveMode: boolean;
    readonly commandIndicator?: CommandIndicator | null;
}

// Discriminated union for all game actions
export type Action =
    | { type: 'TICK' }
    | { type: 'COMMAND_MOVE'; payload: { unitIds: EntityId[]; x: number; y: number } }
    | { type: 'COMMAND_ATTACK'; payload: { unitIds: EntityId[]; targetId: EntityId } }
    | { type: 'START_BUILD'; payload: { category: string; key: string; playerId: number } }
    | { type: 'PLACE_BUILDING'; payload: { key: string; x: number; y: number; playerId: number } }
    | { type: 'CANCEL_BUILD'; payload: { category: string; playerId: number } }
    | { type: 'CANCEL_PLACEMENT' }
    | { type: 'SELECT_UNITS'; payload: EntityId[] }
    | { type: 'SELL_BUILDING'; payload: { buildingId: EntityId; playerId: number } }
    | { type: 'TOGGLE_SELL_MODE' }
    | { type: 'TOGGLE_REPAIR_MODE' }
    | { type: 'START_REPAIR'; payload: { buildingId: EntityId; playerId: number } }
    | { type: 'STOP_REPAIR'; payload: { buildingId: EntityId; playerId: number } }
    | { type: 'TOGGLE_DEBUG' }
    | { type: 'TOGGLE_MINIMAP' }
    | { type: 'TOGGLE_BIRDS_EYE' }
    | { type: 'DEPLOY_MCV'; payload: { unitId: EntityId } }
    | { type: 'DEPLOY_INDUCTION_RIG'; payload: { unitId: EntityId; wellId: EntityId } }
    | { type: 'QUEUE_UNIT'; payload: { category: string; key: string; playerId: number; count: number } }
    | { type: 'DEQUEUE_UNIT'; payload: { category: string; key: string; playerId: number; count: number } }
    | { type: 'COMMAND_ATTACK_MOVE'; payload: { unitIds: EntityId[]; x: number; y: number } }
    | { type: 'SET_STANCE'; payload: { unitIds: EntityId[]; stance: AttackStance } }
    | { type: 'TOGGLE_ATTACK_MOVE_MODE' }
    | { type: 'SET_RALLY_POINT'; payload: { buildingId: EntityId; x: number; y: number } }
    | { type: 'SET_PRIMARY_BUILDING'; payload: { buildingId: EntityId; category: 'infantry' | 'vehicle'; playerId: number } };

// Helper type to extract action type strings
export type ActionType = Action['type'];

// Helper type to extract payload from a specific action type
export type ActionPayload<T extends ActionType> = Extract<Action, { type: T }> extends { payload: infer P } ? P : never;

// Type guard to narrow action type and access payload safely
export function isActionType<T extends ActionType>(action: Action, type: T): action is Extract<Action, { type: T }> {
    return action.type === type;
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

// Well density settings
export const WELL_DENSITY_SETTINGS = {
    none: 0,
    low: 2,
    medium: 4,
    high: 6
};

// Legacy colors for backwards compatibility
export const PLAYER_COLOR = PLAYER_COLORS[0];
export const ENEMY_COLOR = PLAYER_COLORS[1];


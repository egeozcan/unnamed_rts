import {
    Vector,
    EntityId,
    Entity,
    BuildingEntity,
    ResourceEntity,
    RockEntity,
    WellEntity,
    HarvesterUnit,
    CombatUnit,
    AirUnit,
    UnitKey,
    BuildingKey,
    GameState
} from './types.js';
import {
    createDefaultMovement,
    createDefaultCombat,
    createDefaultHarvester,
    createDefaultBuildingState,
    createDefaultWellComponent,
    createDefaultAirUnit,
    createDefaultAirBase
} from './entity-helpers.js';

// ============ TEST ENTITY ID GENERATION ============

let testEntityCounter = 0;

export function resetTestEntityCounter(): void {
    testEntityCounter = 0;
}

export function createTestId(prefix: string = 'e'): EntityId {
    return `${prefix}_test_${++testEntityCounter}`;
}

// ============ HARVESTER UNIT BUILDER ============

export interface HarvesterOptions {
    id?: EntityId;
    owner?: number;
    x?: number;
    y?: number;
    hp?: number;
    cargo?: number;
    moveTarget?: Vector | null;
    targetId?: EntityId | null;
    lastAttackerId?: EntityId | null;
    lastDamageTick?: number;
    resourceTargetId?: EntityId | null;
    baseTargetId?: EntityId | null;
    manualMode?: boolean;
    dead?: boolean;
    harvestAttemptTicks?: number;
}

export function createTestHarvester(options: HarvesterOptions = {}): HarvesterUnit {
    const id = options.id ?? createTestId('harv');
    const x = options.x ?? 500;
    const y = options.y ?? 500;
    const maxHp = 1000; // From rules.json

    return {
        id,
        owner: options.owner ?? 0,
        type: 'UNIT',
        key: 'harvester',
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp: options.hp ?? maxHp,
        maxHp,
        w: 30,
        h: 30,
        radius: 15,
        dead: options.dead ?? false,
        movement: {
            ...createDefaultMovement(),
            moveTarget: options.moveTarget ?? null
        },
        combat: {
            ...createDefaultCombat(),
            targetId: options.targetId ?? null,
            lastAttackerId: options.lastAttackerId ?? null,
            lastDamageTick: options.lastDamageTick
        },
        harvester: {
            ...createDefaultHarvester(),
            cargo: options.cargo ?? 0,
            resourceTargetId: options.resourceTargetId ?? null,
            baseTargetId: options.baseTargetId ?? null,
            manualMode: options.manualMode,
            harvestAttemptTicks: options.harvestAttemptTicks ?? 0
        }
    };
}

// ============ COMBAT UNIT BUILDER ============

export interface CombatUnitOptions {
    id?: EntityId;
    owner?: number;
    key?: Exclude<UnitKey, 'harvester' | 'harrier'>;
    x?: number;
    y?: number;
    hp?: number;
    maxHp?: number;
    moveTarget?: Vector | null;
    targetId?: EntityId | null;
    lastAttackerId?: EntityId | null;
    lastDamageTick?: number;
    cooldown?: number;
    dead?: boolean;
    rotation?: number;
    path?: Vector[] | null;
    stuckTimer?: number;
    finalDest?: Vector | null;
}

export function createTestCombatUnit(options: CombatUnitOptions = {}): CombatUnit {
    const id = options.id ?? createTestId('unit');
    const key = options.key ?? 'rifle';
    const x = options.x ?? 500;
    const y = options.y ?? 500;
    const hp = options.hp ?? 100;

    return {
        id,
        owner: options.owner ?? 0,
        type: 'UNIT',
        key,
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp,
        maxHp: options.maxHp ?? hp,
        w: 20,
        h: 20,
        radius: 10,
        dead: options.dead ?? false,
        movement: {
            ...createDefaultMovement(),
            moveTarget: options.moveTarget ?? null,
            rotation: options.rotation ?? 0,
            path: options.path ?? null,
            stuckTimer: options.stuckTimer ?? 0,
            finalDest: options.finalDest ?? null
        },
        combat: {
            ...createDefaultCombat(),
            targetId: options.targetId ?? null,
            lastAttackerId: options.lastAttackerId ?? null,
            lastDamageTick: options.lastDamageTick,
            cooldown: options.cooldown ?? 0
        }
    };
}

// ============ AIR UNIT (HARRIER) BUILDER ============

export interface HarrierOptions {
    id?: EntityId;
    owner?: number;
    x?: number;
    y?: number;
    hp?: number;
    maxHp?: number;
    ammo?: number;
    maxAmmo?: number;
    state?: 'docked' | 'flying' | 'attacking' | 'returning';
    homeBaseId?: EntityId | null;
    dockedSlot?: number | null;
    targetId?: EntityId | null;
    cooldown?: number;
    dead?: boolean;
}

export function createTestHarrier(options: HarrierOptions = {}): AirUnit {
    const id = options.id ?? createTestId('harrier');
    const x = options.x ?? 500;
    const y = options.y ?? 500;
    const hp = options.hp ?? 200;
    const maxAmmo = options.maxAmmo ?? 1;

    return {
        id,
        owner: options.owner ?? 0,
        type: 'UNIT',
        key: 'harrier',
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp,
        maxHp: options.maxHp ?? hp,
        w: 25,
        h: 25,
        radius: 12,
        dead: options.dead ?? false,
        movement: {
            ...createDefaultMovement(),
            vel: new Vector(0, 0),
            moveTarget: null
        },
        combat: {
            ...createDefaultCombat(),
            targetId: options.targetId ?? null,
            cooldown: options.cooldown ?? 0
        },
        airUnit: {
            ...createDefaultAirUnit(options.homeBaseId ?? null, options.dockedSlot ?? null, maxAmmo),
            ammo: options.ammo ?? maxAmmo,
            maxAmmo,
            state: options.state ?? 'docked',
            homeBaseId: options.homeBaseId ?? null,
            dockedSlot: options.dockedSlot ?? null
        }
    };
}

// ============ AIRFORCE COMMAND BUILDER ============

export interface AirforceCommandOptions {
    id?: EntityId;
    owner?: number;
    x?: number;
    y?: number;
    hp?: number;
    maxHp?: number;
    slots?: (EntityId | null)[];
    reloadProgress?: number;
    dead?: boolean;
}

export function createTestAirforceCommand(options: AirforceCommandOptions = {}): BuildingEntity {
    const id = options.id ?? createTestId('airforce');
    const x = options.x ?? 500;
    const y = options.y ?? 500;
    const hp = options.hp ?? 1500;

    return {
        id,
        owner: options.owner ?? 0,
        type: 'BUILDING',
        key: 'airforce_command',
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp,
        maxHp: options.maxHp ?? hp,
        w: 100,
        h: 80,
        radius: 40,
        dead: options.dead ?? false,
        building: createDefaultBuildingState(),
        airBase: {
            slots: options.slots ?? createDefaultAirBase().slots,
            reloadProgress: options.reloadProgress ?? 120
        }
    };
}

// ============ BUILDING BUILDER ============

export interface BuildingOptions {
    id?: EntityId;
    owner?: number;
    key?: BuildingKey;
    x?: number;
    y?: number;
    hp?: number;
    maxHp?: number;
    w?: number;
    h?: number;
    radius?: number;
    isRepairing?: boolean;
    placedTick?: number;
    dead?: boolean;
    targetId?: EntityId | null;
    cooldown?: number;
}

export function createTestBuilding(options: BuildingOptions = {}): BuildingEntity {
    const id = options.id ?? createTestId('bld');
    const key = options.key ?? 'conyard';
    const x = options.x ?? 500;
    const y = options.y ?? 500;

    // Default dimensions based on building type
    const defaults: Record<string, { w: number; h: number; hp: number }> = {
        conyard: { w: 90, h: 90, hp: 3000 },
        power: { w: 60, h: 60, hp: 800 },
        refinery: { w: 100, h: 80, hp: 1200 },
        barracks: { w: 60, h: 80, hp: 1000 },
        factory: { w: 100, h: 100, hp: 2000 },
        turret: { w: 40, h: 40, hp: 500 },
        sam_site: { w: 40, h: 40, hp: 600 },
        pillbox: { w: 40, h: 40, hp: 400 },
        obelisk: { w: 40, h: 60, hp: 800 },
        tech: { w: 80, h: 80, hp: 1500 }
    };

    const buildingDefaults = defaults[key] || { w: 60, h: 60, hp: 1000 };
    const w = options.w ?? buildingDefaults.w;
    const h = options.h ?? buildingDefaults.h;
    const maxHp = options.maxHp ?? buildingDefaults.hp;
    const hp = options.hp ?? maxHp;

    // Defense buildings get combat component
    const isDefense = ['turret', 'sam_site', 'pillbox', 'obelisk'].includes(key);
    const combat = isDefense ? {
        ...createDefaultCombat(),
        targetId: options.targetId ?? null,
        cooldown: options.cooldown ?? 0
    } : undefined;

    return {
        id,
        owner: options.owner ?? 0,
        type: 'BUILDING',
        key,
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp,
        maxHp,
        w,
        h,
        radius: options.radius ?? Math.min(w, h) / 2,
        dead: options.dead ?? false,
        combat,
        building: {
            ...createDefaultBuildingState(),
            isRepairing: options.isRepairing,
            placedTick: options.placedTick
        }
    };
}

// ============ RESOURCE BUILDER ============

export interface ResourceOptions {
    id?: EntityId;
    x?: number;
    y?: number;
    hp?: number;
    maxHp?: number;
}

export function createTestResource(options: ResourceOptions = {}): ResourceEntity {
    const id = options.id ?? createTestId('ore');
    const x = options.x ?? 500;
    const y = options.y ?? 500;
    const hp = options.hp ?? 1000;
    const maxHp = options.maxHp ?? Math.max(hp, 1000); // Default to 1000 or hp, whichever is larger

    return {
        id,
        owner: -1,
        type: 'RESOURCE',
        key: 'ore',
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp,
        maxHp,
        w: 25,
        h: 25,
        radius: 12,
        dead: false
    };
}

// ============ ROCK BUILDER ============

export interface RockOptions {
    id?: EntityId;
    x?: number;
    y?: number;
    size?: number;
}

export function createTestRock(options: RockOptions = {}): RockEntity {
    const id = options.id ?? createTestId('rock');
    const x = options.x ?? 500;
    const y = options.y ?? 500;
    const size = options.size ?? 40;

    return {
        id,
        owner: -1,
        type: 'ROCK',
        key: 'rock',
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp: 9999,
        maxHp: 9999,
        w: size,
        h: size,
        radius: size / 2,
        dead: false
    };
}

// ============ WELL BUILDER ============

export interface WellOptions {
    id?: EntityId;
    x?: number;
    y?: number;
    nextSpawnTick?: number;
    currentOreCount?: number;
    totalSpawned?: number;
    isBlocked?: boolean;
}

export function createTestWell(options: WellOptions = {}): WellEntity {
    const id = options.id ?? createTestId('well');
    const x = options.x ?? 500;
    const y = options.y ?? 500;

    return {
        id,
        owner: -1,
        type: 'WELL',
        key: 'well',
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp: 9999,
        maxHp: 9999,
        w: 50,
        h: 50,
        radius: 25,
        dead: false,
        well: {
            ...createDefaultWellComponent(),
            nextSpawnTick: options.nextSpawnTick ?? 0,
            currentOreCount: options.currentOreCount ?? 0,
            totalSpawned: options.totalSpawned ?? 0,
            isBlocked: options.isBlocked ?? false
        }
    };
}

// ============ STATE HELPERS ============

export function addEntityToState(state: GameState, entity: Entity): GameState {
    return {
        ...state,
        entities: {
            ...state.entities,
            [entity.id]: entity
        }
    };
}

export function addEntitiesToState(state: GameState, entities: Entity[]): GameState {
    const newEntities = { ...state.entities };
    for (const entity of entities) {
        newEntities[entity.id] = entity;
    }
    return {
        ...state,
        entities: newEntities
    };
}

// ============ GENERIC ENTITY BUILDER ============
// For compatibility with tests that need a more flexible approach

export interface GenericEntityOptions {
    id?: EntityId;
    owner?: number;
    type: 'UNIT' | 'BUILDING' | 'RESOURCE' | 'ROCK' | 'WELL';
    key: string;
    x?: number;
    y?: number;
    hp?: number;
    dead?: boolean;
    // Additional overrides for unit properties
    moveTarget?: Vector | null;
    targetId?: EntityId | null;
    cargo?: number;
    resourceTargetId?: EntityId | null;
    baseTargetId?: EntityId | null;
    manualMode?: boolean;
    // Building properties
    isRepairing?: boolean;
    placedTick?: number;
}

export function createTestEntity(options: GenericEntityOptions): Entity {
    switch (options.type) {
        case 'UNIT':
            if (options.key === 'harvester') {
                return createTestHarvester({
                    id: options.id,
                    owner: options.owner,
                    x: options.x,
                    y: options.y,
                    hp: options.hp,
                    dead: options.dead,
                    moveTarget: options.moveTarget,
                    targetId: options.targetId,
                    cargo: options.cargo,
                    resourceTargetId: options.resourceTargetId,
                    baseTargetId: options.baseTargetId,
                    manualMode: options.manualMode
                });
            } else {
                return createTestCombatUnit({
                    id: options.id,
                    owner: options.owner,
                    key: options.key as Exclude<UnitKey, 'harvester' | 'harrier'>,
                    x: options.x,
                    y: options.y,
                    hp: options.hp,
                    dead: options.dead,
                    moveTarget: options.moveTarget,
                    targetId: options.targetId
                });
            }
        case 'BUILDING':
            return createTestBuilding({
                id: options.id,
                owner: options.owner,
                key: options.key as BuildingKey,
                x: options.x,
                y: options.y,
                hp: options.hp,
                dead: options.dead,
                isRepairing: options.isRepairing,
                placedTick: options.placedTick
            });
        case 'RESOURCE':
            return createTestResource({
                id: options.id,
                x: options.x,
                y: options.y,
                hp: options.hp
            });
        case 'ROCK':
            return createTestRock({
                id: options.id,
                x: options.x,
                y: options.y
            });
        case 'WELL':
            return createTestWell({
                id: options.id,
                x: options.x,
                y: options.y
            });
    }
}

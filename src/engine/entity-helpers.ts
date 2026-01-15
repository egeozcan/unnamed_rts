import {
    Vector,
    EntityId,
    Entity,
    UnitEntity,
    BuildingEntity,
    HarvesterUnit,
    AirUnit,
    DemoTruckUnit,
    MovementComponent,
    CombatComponent,
    HarvesterComponent,
    BuildingStateComponent,
    WellComponent,
    AirUnitComponent,
    AirBaseComponent,
    DemoTruckComponent
} from './types.js';

// ============ COMPONENT DEFAULTS ============

export function createDefaultMovement(): MovementComponent {
    return {
        vel: new Vector(0, 0),
        rotation: 0,
        moveTarget: null,
        path: null,
        pathIdx: 0,
        finalDest: null,
        stuckTimer: 0,
        unstuckDir: null,
        unstuckTimer: 0,
        avgVel: undefined
    };
}

export function createDefaultCombat(): CombatComponent {
    return {
        targetId: null,
        lastAttackerId: null,
        lastDamageTick: undefined,
        cooldown: 0,
        flash: 0,
        turretAngle: 0,
        stance: 'aggressive',
        attackMoveTarget: null,
        stanceHomePos: null
    };
}

export function createDefaultHarvester(): HarvesterComponent {
    return {
        cargo: 0,
        resourceTargetId: null,
        baseTargetId: null,
        dockPos: undefined,
        manualMode: false,  // New harvesters auto-harvest by default
        harvestAttemptTicks: undefined,
        lastDistToOre: undefined,
        bestDistToOre: undefined,
        blockedOreId: undefined,
        blockedOreTimer: undefined
    };
}

export function createDefaultBuildingState(): BuildingStateComponent {
    return {
        isRepairing: undefined,
        placedTick: undefined
    };
}

export function createDefaultWellComponent(): WellComponent {
    return {
        nextSpawnTick: 0,
        currentOreCount: 0,
        totalSpawned: 0,
        isBlocked: false
    };
}

export function createDefaultDemoTruck(): DemoTruckComponent {
    return {
        detonationTargetId: null,
        detonationTargetPos: null,
        hasDetonated: false
    };
}

// ============ IMMUTABLE UPDATE HELPERS ============

export function updateMovement<T extends UnitEntity>(
    entity: T,
    updates: Partial<MovementComponent>
): T {
    return {
        ...entity,
        movement: { ...entity.movement, ...updates }
    };
}

export function updateCombat<T extends UnitEntity>(
    entity: T,
    updates: Partial<CombatComponent>
): T {
    return {
        ...entity,
        combat: { ...entity.combat, ...updates }
    };
}

export function updateBuildingCombat(
    entity: BuildingEntity,
    updates: Partial<CombatComponent>
): BuildingEntity {
    if (!entity.combat) return entity;
    return {
        ...entity,
        combat: { ...entity.combat, ...updates }
    };
}

export function updateHarvester(
    entity: HarvesterUnit,
    updates: Partial<HarvesterComponent>
): HarvesterUnit {
    return {
        ...entity,
        harvester: { ...entity.harvester, ...updates }
    };
}

export function updateDemoTruck(
    entity: DemoTruckUnit,
    updates: Partial<DemoTruckComponent>
): DemoTruckUnit {
    return {
        ...entity,
        demoTruck: { ...entity.demoTruck, ...updates }
    };
}

export function updateBuildingState(
    entity: BuildingEntity,
    updates: Partial<BuildingStateComponent>
): BuildingEntity {
    return {
        ...entity,
        building: { ...entity.building, ...updates }
    };
}

// ============ COMBINED UPDATE HELPERS ============

export function updateUnitMovementAndCombat<T extends UnitEntity>(
    entity: T,
    movementUpdates?: Partial<MovementComponent>,
    combatUpdates?: Partial<CombatComponent>
): T {
    let result = entity;
    if (movementUpdates) {
        result = { ...result, movement: { ...result.movement, ...movementUpdates } };
    }
    if (combatUpdates) {
        result = { ...result, combat: { ...result.combat, ...combatUpdates } };
    }
    return result;
}

export function updateHarvesterFull(
    entity: HarvesterUnit,
    baseUpdates?: Partial<Omit<HarvesterUnit, 'movement' | 'combat' | 'harvester' | 'type' | 'key'>>,
    movementUpdates?: Partial<MovementComponent>,
    combatUpdates?: Partial<CombatComponent>,
    harvesterUpdates?: Partial<HarvesterComponent>
): HarvesterUnit {
    let result: HarvesterUnit = entity;

    if (baseUpdates) {
        result = { ...result, ...baseUpdates };
    }
    if (movementUpdates) {
        result = { ...result, movement: { ...result.movement, ...movementUpdates } };
    }
    if (combatUpdates) {
        result = { ...result, combat: { ...result.combat, ...combatUpdates } };
    }
    if (harvesterUpdates) {
        result = { ...result, harvester: { ...result.harvester, ...harvesterUpdates } };
    }

    return result;
}

// ============ AIR UNIT COMPONENT DEFAULTS ============

export function createDefaultAirUnit(homeBaseId: EntityId | null, slot: number | null, maxAmmo: number = 1): AirUnitComponent {
    return {
        ammo: maxAmmo,
        maxAmmo,
        state: 'docked',
        homeBaseId,
        dockedSlot: slot
    };
}

export function createDefaultAirBase(slotCount: number = 6): AirBaseComponent {
    return {
        slots: Array(slotCount).fill(null) as readonly (EntityId | null)[],
        reloadProgress: 0
    };
}

// ============ AIR UNIT UPDATE HELPERS ============

export function updateAirUnit(
    entity: AirUnit,
    updates: Partial<AirUnitComponent>
): AirUnit {
    return {
        ...entity,
        airUnit: { ...entity.airUnit, ...updates }
    };
}

export function updateAirBase(
    entity: BuildingEntity,
    updates: Partial<AirBaseComponent>
): BuildingEntity {
    if (!entity.airBase) return entity;
    return {
        ...entity,
        airBase: { ...entity.airBase, ...updates }
    };
}

// ============ TYPE GUARDS ============

export function isAirUnit(entity: Entity): entity is AirUnit {
    return entity.type === 'UNIT' && entity.key === 'harrier';
}

export function isHarvester(entity: Entity): entity is HarvesterUnit {
    return entity.type === 'UNIT' && entity.key === 'harvester';
}

export function isUnit(entity: Entity): entity is UnitEntity {
    return entity.type === 'UNIT';
}

export function isBuilding(entity: Entity): entity is BuildingEntity {
    return entity.type === 'BUILDING';
}

export function isAirBase(entity: Entity): entity is BuildingEntity & { airBase: AirBaseComponent } {
    return entity.type === 'BUILDING' && entity.key === 'airforce_command' && !!(entity as BuildingEntity).airBase;
}

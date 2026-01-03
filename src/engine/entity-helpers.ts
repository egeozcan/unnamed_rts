import {
    Vector,
    UnitEntity,
    BuildingEntity,
    HarvesterUnit,
    MovementComponent,
    CombatComponent,
    HarvesterComponent,
    BuildingStateComponent,
    WellComponent
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
        turretAngle: 0
    };
}

export function createDefaultHarvester(): HarvesterComponent {
    return {
        cargo: 0,
        resourceTargetId: null,
        baseTargetId: null,
        dockPos: undefined,
        manualMode: undefined,
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

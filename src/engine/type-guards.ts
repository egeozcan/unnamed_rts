import {
    Entity,
    UnitEntity,
    BuildingEntity,
    ResourceEntity,
    RockEntity,
    WellEntity,
    CombatUnit,
    HarvesterUnit,
    DemoTruckUnit,
    CombatComponent
} from './types.js';

// ============ ENTITY TYPE GUARDS ============

export function isUnit(entity: Entity): entity is UnitEntity {
    return entity.type === 'UNIT';
}

export function isBuilding(entity: Entity): entity is BuildingEntity {
    return entity.type === 'BUILDING';
}

export function isResource(entity: Entity): entity is ResourceEntity {
    return entity.type === 'RESOURCE';
}

export function isRock(entity: Entity): entity is RockEntity {
    return entity.type === 'ROCK';
}

export function isWell(entity: Entity): entity is WellEntity {
    return entity.type === 'WELL';
}

// ============ UNIT SUBTYPE GUARDS ============

export function isHarvester(entity: Entity): entity is HarvesterUnit {
    return entity.type === 'UNIT' && entity.key === 'harvester';
}

export function isCombatUnit(entity: Entity): entity is CombatUnit {
    return entity.type === 'UNIT' && entity.key !== 'harvester' && entity.key !== 'harrier' && entity.key !== 'demo_truck';
}

export function isDemoTruck(entity: Entity): entity is DemoTruckUnit {
    return entity.type === 'UNIT' && entity.key === 'demo_truck';
}

export function isEngineer(entity: Entity): entity is CombatUnit {
    return entity.type === 'UNIT' && entity.key === 'engineer';
}

export function isMCV(entity: Entity): entity is CombatUnit {
    return entity.type === 'UNIT' && entity.key === 'mcv';
}

export function isMedic(entity: Entity): entity is CombatUnit {
    return entity.type === 'UNIT' && entity.key === 'medic';
}

export function isInductionRig(entity: Entity): entity is CombatUnit {
    return entity.type === 'UNIT' && entity.key === 'induction_rig';
}

// ============ COMPONENT ACCESS HELPERS ============

export function hasMovement(entity: Entity): entity is UnitEntity {
    return entity.type === 'UNIT';
}

export function hasCombat(entity: Entity): entity is (UnitEntity | BuildingEntity) & { combat: CombatComponent } {
    if (entity.type === 'UNIT') return true;
    if (entity.type === 'BUILDING') return entity.combat !== undefined;
    return false;
}

export function hasHarvester(entity: Entity): entity is HarvesterUnit {
    return entity.type === 'UNIT' && entity.key === 'harvester';
}

// ============ BUILDING SUBTYPE GUARDS ============

const DEFENSE_BUILDING_KEYS = ['turret', 'sam_site', 'pillbox', 'obelisk'];

export function isDefenseBuilding(entity: Entity): entity is BuildingEntity & { combat: CombatComponent } {
    return entity.type === 'BUILDING' && DEFENSE_BUILDING_KEYS.includes(entity.key);
}

export function isRefinery(entity: Entity): entity is BuildingEntity {
    return entity.type === 'BUILDING' && entity.key === 'refinery';
}

export function isConyard(entity: Entity): entity is BuildingEntity {
    return entity.type === 'BUILDING' && entity.key === 'conyard';
}

export function isDeployedInductionRig(entity: Entity): entity is BuildingEntity {
    return entity.type === 'BUILDING' && entity.key === 'induction_rig_deployed';
}

// ============ OWNER HELPERS ============

export function isNeutral(entity: Entity): boolean {
    return entity.owner === -1;
}

export function isPlayerEntity(entity: Entity, playerId: number): boolean {
    return entity.owner === playerId;
}

export function isEnemyOf(entity: Entity, playerId: number): boolean {
    return entity.owner !== playerId && entity.owner !== -1;
}

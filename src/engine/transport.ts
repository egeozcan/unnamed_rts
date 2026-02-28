import { Entity, EntityId, UnitEntity } from './types.js';
import { RULES, isUnitData } from '../data/schemas/index.js';

export function isTransportedUnit(entity: Entity): boolean {
    return entity.type === 'UNIT' && entity.movement.transportId != null;
}

export function isInfantryUnit(entity: Entity): entity is UnitEntity {
    if (entity.type !== 'UNIT') return false;
    const data = RULES.units[entity.key];
    return Boolean(data && isUnitData(data) && data.type === 'infantry');
}

export function isGarrisonableTransport(entity: Entity): entity is UnitEntity {
    if (entity.type !== 'UNIT') return false;
    const data = RULES.units[entity.key];
    return Boolean(data && isUnitData(data) && data.transportCapacity && data.transportCapacity > 0);
}

export function getTransportCapacity(entity: Entity): number {
    if (entity.type !== 'UNIT') return 0;
    const data = RULES.units[entity.key];
    if (!data || !isUnitData(data)) return 0;
    return Math.max(0, Math.floor(data.transportCapacity || 0));
}

export function getTransportPassengers(
    entities: Record<EntityId, Entity>,
    transportId: EntityId
): UnitEntity[] {
    const passengers: UnitEntity[] = [];
    for (const id in entities) {
        const entity = entities[id];
        if (entity.type !== 'UNIT' || entity.dead) continue;
        if (entity.movement.transportId !== transportId) continue;
        passengers.push(entity);
    }
    return passengers;
}

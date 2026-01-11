import {
    GameState, Entity, EntityId, PlayerState, Vector, PLAYER_COLORS,
    UnitKey, BuildingKey, Projectile
} from '../types';
import { RULES, Building, Unit, isBuildingData, isUnitData } from '../../data/schemas/index';
import { createDefaultMovement, createDefaultCombat, createDefaultHarvester, createDefaultBuildingState, createDefaultAirUnit, createDefaultAirBase } from '../entity-helpers';
import { type EntityCache } from '../perf';

// Power calculation cache - keyed by tick to auto-invalidate
let powerCache: Map<number, { in: number, out: number }> = new Map();
let powerCacheTick = -1;

/**
 * Check if prerequisites are met for a building or unit.
 * Prerequisites are defined on the unit/building data objects.
 */
function checkPrerequisites(key: string, playerBuildings: Entity[]): boolean {
    const unitData = RULES.units[key];
    const buildingData = RULES.buildings[key];
    const prereqs = unitData?.prerequisites || buildingData?.prerequisites || [];
    return prereqs.every((req: string) => playerBuildings.some(b => b.key === req && !b.dead));
}

/**
 * Check if a player has the required production building for a category.
 * Production building requirements are defined in RULES.productionBuildings.
 * Each category can have multiple valid production buildings (for faction support).
 */
function hasProductionBuilding(category: string, playerBuildings: Entity[]): boolean {
    const validBuildings: string[] = RULES.productionBuildings?.[category] || [];
    if (validBuildings.length === 0) return false;
    return playerBuildings.some(b => validBuildings.includes(b.key) && !b.dead);
}

/**
 * Check if a player can build a specific item (has prerequisites and production building).
 * Accepts EntityCache for optimized lookups.
 */
export function canBuild(key: string, category: string, playerId: number, entities: Record<EntityId, Entity> | EntityCache): boolean {
    // Support both EntityCache and entities record for backward compatibility
    const isEntityCache = 'buildingsByOwner' in entities && entities.buildingsByOwner instanceof Map;
    const playerBuildings = isEntityCache
        ? (entities.buildingsByOwner.get(playerId) || [])
        : Object.values(entities as Record<EntityId, Entity>).filter(e => e.owner === playerId && e.type === 'BUILDING' && !e.dead);

    // Check production building requirement
    if (!hasProductionBuilding(category, playerBuildings)) {
        return false;
    }

    // Check prerequisites
    if (!checkPrerequisites(key, playerBuildings)) {
        return false;
    }

    // Check maxCount limit
    const unitData = RULES.units[key];
    const buildingData = RULES.buildings[key];
    const maxCount = unitData?.maxCount || buildingData?.maxCount;
    if (maxCount !== undefined) {
        // Count existing entities of this type
        let existingCount = 0;
        if (isEntityCache) {
            const cache = entities as EntityCache;
            const buildings = cache.buildingsByOwner.get(playerId) || [];
            const units = cache.unitsByOwner.get(playerId) || [];
            existingCount = [...buildings, ...units].filter(e => e.key === key).length;
        } else {
            existingCount = Object.values(entities as Record<EntityId, Entity>)
                .filter(e => e.owner === playerId && !e.dead && e.key === key).length;
        }
        if (existingCount >= maxCount) {
            return false;
        }
    }

    return true;
}

export function createPlayerState(id: number, isAi: boolean, difficulty: 'easy' | 'medium' | 'hard' | 'dummy' = 'medium', color: string = PLAYER_COLORS[id] || '#888888'): PlayerState {
    return {
        id,
        isAi,
        difficulty,
        color,
        credits: isAi ? 10000 : 3000,
        maxPower: 0,
        usedPower: 0,
        queues: {
            building: { current: null, progress: 0, invested: 0, queued: [] },
            infantry: { current: null, progress: 0, invested: 0, queued: [] },
            vehicle: { current: null, progress: 0, invested: 0, queued: [] },
            air: { current: null, progress: 0, invested: 0, queued: [] }
        },
        readyToPlace: null
    };
}

export function calculatePower(playerId: number, entities: Record<EntityId, Entity> | EntityCache, tick?: number): { in: number, out: number } {
    // Use cache if available for current tick
    if (tick !== undefined) {
        if (tick !== powerCacheTick) {
            // New tick - clear cache
            powerCache.clear();
            powerCacheTick = tick;
        }
        const cached = powerCache.get(playerId);
        if (cached) {
            return cached;
        }
    }

    let p = { in: 0, out: 0 };

    // Support both EntityCache and entities record
    if ('buildingsByOwner' in entities) {
        // Using EntityCache - much faster
        const cache = entities as EntityCache;
        const buildings = cache.buildingsByOwner.get(playerId) || [];
        for (const e of buildings) {
            const data = RULES.buildings[e.key];
            if (data) {
                if (data.power) p.out += data.power;
                if (data.drain) p.in += data.drain;
            }
        }
    } else {
        // Fallback to entities record
        for (const id in entities) {
            const e = entities[id];
            if (e.owner === playerId && !e.dead) {
                const data = RULES.buildings[e.key];
                if (data) {
                    if (data.power) p.out += data.power;
                    if (data.drain) p.in += data.drain;
                }
            }
        }
    }

    // Cache the result if tick is provided
    if (tick !== undefined) {
        powerCache.set(playerId, p);
    }

    return p;
}

// Returns rule data for a building or unit key.
export function getRuleData(key: string): Building | Unit | null {
    if (RULES.buildings[key]) return RULES.buildings[key];
    if (RULES.units[key]) return RULES.units[key];
    return null;
}

export function createEntity(x: number, y: number, owner: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE', key: string, state: GameState): Entity {
    const id = 'e_' + state.tick + '_' + Math.floor(Math.random() * 100000);

    const data = getRuleData(key);
    const isResource = type === 'RESOURCE';

    // Resource entities have fixed stats, others use rules data
    const hp = isResource ? 1000 : (data?.hp || 100);
    const w = isResource ? 25 : (data?.w || 20);
    const h = isResource ? 25 : ((data && isBuildingData(data)) ? data.h : (data?.w || 20));

    const baseProps = {
        id,
        owner,
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp,
        maxHp: hp,
        w,
        h,
        radius: w / 2,
        dead: false
    };

    if (type === 'UNIT') {
        if (key === 'harvester') {
            return {
                ...baseProps,
                type: 'UNIT' as const,
                key: 'harvester' as const,
                movement: createDefaultMovement(),
                combat: createDefaultCombat(),
                harvester: createDefaultHarvester()
            };
        } else if (key === 'harrier') {
            // Harrier is created through production system which assigns home base
            // This is a fallback for direct creation (shouldn't normally happen)
            return {
                ...baseProps,
                type: 'UNIT' as const,
                key: 'harrier' as const,
                movement: createDefaultMovement(),
                combat: createDefaultCombat(),
                airUnit: createDefaultAirUnit(null as unknown as string, -1, 1)
            };
        } else {
            return {
                ...baseProps,
                type: 'UNIT' as const,
                key: key as Exclude<UnitKey, 'harvester' | 'harrier'>,
                movement: createDefaultMovement(),
                combat: createDefaultCombat(),
                engineer: key === 'engineer' ? { captureTargetId: null, repairTargetId: null } : undefined
            };
        }
    } else if (type === 'BUILDING') {
        const isDefense = ['turret', 'sam_site', 'pillbox', 'obelisk'].includes(key);
        const isAirBase = key === 'airforce_command';
        return {
            ...baseProps,
            type: 'BUILDING' as const,
            key: key as BuildingKey,
            combat: isDefense ? createDefaultCombat() : undefined,
            building: {
                ...createDefaultBuildingState(),
                placedTick: state.tick
            },
            airBase: isAirBase ? createDefaultAirBase(6) : undefined
        };
    } else {
        // RESOURCE
        return {
            ...baseProps,
            type: 'RESOURCE' as const,
            key: 'ore' as const
        };
    }
}

export function killPlayerEntities(entities: Record<EntityId, Entity>, playerId: number): Record<EntityId, Entity> {
    const nextEntities = { ...entities };
    for (const id in nextEntities) {
        const ent = nextEntities[id];
        if (ent.owner === playerId && !ent.dead) {
            if (ent.type === 'UNIT') {
                nextEntities[id] = {
                    ...ent,
                    dead: true,
                    hp: 0,
                    combat: { ...ent.combat, flash: 10 }
                };
            } else if (ent.type === 'BUILDING' && ent.combat) {
                nextEntities[id] = {
                    ...ent,
                    dead: true,
                    hp: 0,
                    combat: { ...ent.combat, flash: 10 }
                };
            } else {
                nextEntities[id] = { ...ent, dead: true, hp: 0 };
            }
        }
    }
    return nextEntities;
}

export function createProjectile(source: Entity, target: Entity): Projectile {
    const data = getRuleData(source.key);
    const weaponType = data?.weaponType || 'bullet';
    const isRocket = weaponType === 'rocket' || weaponType === 'heavy_cannon';
    // Missiles (SAM/Stealth Tank) should be very fast (28)
    // Rockets/Artillery are slower (9)
    // Standard bullets are 18
    let speed = 18;
    if (weaponType === 'missile') speed = 28;
    else if (isRocket) speed = 9;

    return {
        ownerId: source.id,
        pos: source.pos,
        vel: target.pos.sub(source.pos).norm().scale(speed),
        targetId: target.id,
        speed: speed,
        damage: data?.damage || 10,
        splash: (data && isUnitData(data)) ? (data.splash || 0) : 0,
        type: weaponType,
        weaponType: weaponType,
        dead: false
    };
}

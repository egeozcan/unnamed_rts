/**
 * Air Unit State Machine
 * Handles harrier-type air units that dock at Air-Force Command buildings.
 *
 * States:
 * - docked: Unit is at base, invisible, being reloaded
 * - flying: Unit is moving toward target
 * - attacking: Unit is in range and firing
 * - returning: Unit is heading back to base after firing
 */

import {
    Entity, EntityId, BuildingEntity, AirUnit, Vector, Projectile
} from '../types';
import { RULES } from '../../data/schemas/index';
import { getRuleData, createProjectile } from './helpers';
import { isAirUnit, updateAirUnit } from '../entity-helpers';
import { moveToward } from './units';

/**
 * Update an air unit's state machine.
 * Called from the game loop for harrier units.
 */
export function updateAirUnitState(
    entity: AirUnit,
    allEntities: Record<EntityId, Entity>,
    entityList: Entity[]
): { entity: AirUnit, projectile?: Projectile | null, modifiedEntities?: Record<EntityId, Entity> } {
    const data = getRuleData(entity.key);
    let nextEntity = entity;
    let projectile: Projectile | null = null;
    let modifiedEntities: Record<EntityId, Entity> | undefined;

    switch (entity.airUnit.state) {
        case 'docked':
            // Docked harriers are invisible and handled by the base
            // They don't move or do anything - just wait to be launched
            // Reload is handled by the base building
            break;

        case 'flying':
            // Flying toward target
            if (entity.combat.targetId) {
                const target = allEntities[entity.combat.targetId];
                if (target && !target.dead) {
                    const dist = entity.pos.dist(target.pos);
                    const range = data?.range || 200;

                    if (dist <= range) {
                        // In range, switch to attacking state
                        nextEntity = updateAirUnit(nextEntity, { state: 'attacking' });
                    } else {
                        // Move toward target
                        nextEntity = moveToward(nextEntity, target.pos, entityList) as AirUnit;
                    }
                } else {
                    // Target dead or gone, return to base
                    nextEntity = {
                        ...nextEntity,
                        combat: { ...nextEntity.combat, targetId: null },
                        airUnit: { ...nextEntity.airUnit, state: 'returning' }
                    };
                }
            } else {
                // No target, return to base
                nextEntity = updateAirUnit(nextEntity, { state: 'returning' });
            }
            break;

        case 'attacking':
            // In attack position, fire when ready
            if (entity.airUnit.ammo > 0 && entity.combat.cooldown <= 0) {
                const target = allEntities[entity.combat.targetId!];
                if (target && !target.dead) {
                    // Fire missile
                    projectile = createProjectile(entity, target);
                    nextEntity = {
                        ...nextEntity,
                        combat: { ...nextEntity.combat, cooldown: data?.rate || 60 },
                        airUnit: {
                            ...nextEntity.airUnit,
                            ammo: nextEntity.airUnit.ammo - 1,
                            state: 'returning'  // Auto-return after firing
                        }
                    };
                } else {
                    // Target gone, return
                    nextEntity = {
                        ...nextEntity,
                        combat: { ...nextEntity.combat, targetId: null },
                        airUnit: { ...nextEntity.airUnit, state: 'returning' }
                    };
                }
            } else if (entity.airUnit.ammo <= 0) {
                // Out of ammo, return to base
                nextEntity = {
                    ...nextEntity,
                    combat: { ...nextEntity.combat, targetId: null },
                    airUnit: { ...nextEntity.airUnit, state: 'returning' }
                };
            }
            break;

        case 'returning':
            // Head back to home base
            const homeBase = entity.airUnit.homeBaseId
                ? allEntities[entity.airUnit.homeBaseId] as BuildingEntity
                : null;

            if (homeBase && !homeBase.dead && homeBase.airBase) {
                const dist = entity.pos.dist(homeBase.pos);
                if (dist < 50) {
                    // Arrived at base - find available slot and dock
                    const slotIndex = homeBase.airBase.slots.findIndex(s => s === null);
                    if (slotIndex !== -1) {
                        nextEntity = {
                            ...nextEntity,
                            airUnit: {
                                ...nextEntity.airUnit,
                                state: 'docked',
                                dockedSlot: slotIndex
                            },
                            combat: { ...nextEntity.combat, targetId: null },
                            movement: {
                                ...nextEntity.movement,
                                vel: new Vector(0, 0),
                                moveTarget: null
                            }
                        };
                        // Update air base slots to include this harrier
                        const newSlots = [...homeBase.airBase.slots];
                        newSlots[slotIndex] = entity.id;
                        modifiedEntities = {
                            [homeBase.id]: {
                                ...homeBase,
                                airBase: {
                                    ...homeBase.airBase,
                                    slots: newSlots
                                }
                            }
                        };
                    } else {
                        // No slot available at home base - try to find another base
                        nextEntity = findNewHomeBase(nextEntity, allEntities);
                    }
                } else {
                    // Move toward base
                    nextEntity = moveToward(nextEntity, homeBase.pos, entityList) as AirUnit;
                }
            } else {
                // Base destroyed - find a new base
                nextEntity = findNewHomeBase(nextEntity, allEntities);
            }
            break;
    }

    return { entity: nextEntity, projectile, modifiedEntities };
}

/**
 * Find a new home base for a stranded harrier.
 * If no base with available slots exists, the harrier crashes (dies).
 */
function findNewHomeBase(entity: AirUnit, allEntities: Record<EntityId, Entity>): AirUnit {
    // Find another Air-Force Command owned by same player with available slot
    for (const id in allEntities) {
        const e = allEntities[id];
        if (e.type === 'BUILDING' && e.key === 'airforce_command' &&
            e.owner === entity.owner && !e.dead && e.airBase) {
            // Check for available slot
            const availableSlot = e.airBase.slots.findIndex(s => s === null);
            if (availableSlot !== -1) {
                // Found a new home - head there
                return {
                    ...entity,
                    airUnit: {
                        ...entity.airUnit,
                        homeBaseId: e.id,
                        state: 'returning'
                    }
                };
            }
        }
    }

    // No base with available slot found - harrier crashes (out of fuel)
    // This applies to both AI and human players
    return {
        ...entity,
        dead: true,
        hp: 0,
        movement: {
            ...entity.movement,
            vel: new Vector(0, 0)
        }
    };
}

/**
 * Update Air-Force Command building - handles harrier reload.
 * Returns updated harriers that need their ammo restored.
 */
export function updateAirBase(
    entity: BuildingEntity,
    allEntities: Record<EntityId, Entity>,
    _currentTick: number
): { entity: BuildingEntity, updatedHarriers: Record<EntityId, AirUnit> } {
    if (!entity.airBase || entity.key !== 'airforce_command') {
        return { entity, updatedHarriers: {} };
    }

    const airBase = entity.airBase; // Extract to keep type narrowed
    let nextAirBase = airBase;
    const updatedHarriers: Record<EntityId, AirUnit> = {};
    const reloadTicks = RULES.buildings['airforce_command']?.reloadTicks || 120;

    // Healing - Repair all docked harriers slowly (independent of reload)
    if (_currentTick % 5 === 0) {
        for (const slotId of airBase.slots) {
            if (!slotId) continue;
            const harrier = allEntities[slotId];
            if (!harrier || harrier.dead || !isAirUnit(harrier)) continue;

            if (harrier.airUnit.state === 'docked' && harrier.hp < harrier.maxHp) {
                updatedHarriers[harrier.id] = {
                    ...harrier,
                    hp: Math.min(harrier.maxHp, harrier.hp + 2)
                };
            }
        }
    }

    // Process reload - find a docked harrier that needs ammo
    let foundHarrierNeedingReload = false;

    for (const slotId of airBase.slots) {
        if (!slotId) continue;

        const harrier = allEntities[slotId];
        if (!harrier || harrier.dead || !isAirUnit(harrier)) continue;

        if (harrier.airUnit.state === 'docked' && harrier.airUnit.ammo < harrier.airUnit.maxAmmo) {
            foundHarrierNeedingReload = true;

            // Decrement reload progress
            const newProgress = nextAirBase.reloadProgress - 1;

            if (newProgress <= 0) {
                // Reload complete - restore ammo
                const prev = updatedHarriers[harrier.id] || harrier;
                updatedHarriers[harrier.id] = {
                    ...prev,
                    airUnit: {
                        ...prev.airUnit,
                        ammo: prev.airUnit.maxAmmo
                    }
                };

                // Reset reload progress for next harrier
                nextAirBase = {
                    slots: nextAirBase.slots,
                    reloadProgress: reloadTicks
                };
            } else {
                nextAirBase = {
                    slots: nextAirBase.slots,
                    reloadProgress: newProgress
                };
            }

            break; // Only process one harrier at a time
        }
    }

    // If no harrier needs reload, reset progress
    if (!foundHarrierNeedingReload && nextAirBase.reloadProgress !== reloadTicks) {
        nextAirBase = {
            ...nextAirBase,
            reloadProgress: reloadTicks
        };
    }

    // Process Launching (Staggered)
    const currentTick = _currentTick;
    const lastLaunch = nextAirBase.lastLaunchTick || 0;
    const launchDelay = 15; // 15 ticks = 250ms at 60fps

    if (currentTick - lastLaunch >= launchDelay) {
        // Find a docked harrier that wants to launch (has a target)
        // Check slots in order 0-5
        for (let i = 0; i < nextAirBase.slots.length; i++) {
            const slotId = nextAirBase.slots[i];
            if (!slotId) continue;

            const harrier = allEntities[slotId];
            if (!harrier || harrier.dead || !isAirUnit(harrier)) continue;

            // Check if harrier wants to launch (has target and ammo)
            if (harrier.airUnit.state === 'docked' && harrier.combat.targetId && harrier.airUnit.ammo > 0) {
                // Determine launch position based on slot
                // Slot positions relative to center
                const slotPositions = [
                    { x: -30, y: -20 }, { x: 0, y: -20 }, { x: 30, y: -20 },
                    { x: -30, y: 10 }, { x: 0, y: 10 }, { x: 30, y: 10 }
                ];
                const offset = slotPositions[i] || { x: 0, y: 0 };
                // Rotate offset by building rotation if necessary (assuming valid rotation is 0 for now)

                const launchPos = entity.pos.add(new Vector(offset.x, offset.y));

                // Launch this harrier!
                updatedHarriers[harrier.id] = {
                    ...harrier,
                    pos: launchPos, // Set physical position to slot
                    airUnit: {
                        ...harrier.airUnit,
                        state: 'flying', // Take off!
                        dockedSlot: null
                    },
                    // combat target is already set by commandAttack
                };

                // Clear slot
                const newSlots = [...nextAirBase.slots];
                newSlots[i] = null;

                nextAirBase = {
                    ...nextAirBase,
                    slots: newSlots,
                    lastLaunchTick: currentTick
                };

                // Only launch one per check
                break;
            }
        }
    }

    // Self-Healing: Ensure all harriers that think they are docked here are actually in the slots
    // This fixes state desyncs where harriers are docked but invisible (missing from base slots)
    const knownHarrierIds = new Set(nextAirBase.slots.filter(id => id !== null) as string[]);
    const lostHarriers: string[] = [];

    // Scan for lost harriers (expensive but robust)
    // In a high-perf scenario this should be optimized with a spatial grid or cache
    for (const id in allEntities) {
        const ent = allEntities[id];
        if (ent.type === 'UNIT' && ent.key === 'harrier' && !ent.dead) {
            const h = ent as AirUnit;
            // Skip harriers we just launched this tick!
            if (updatedHarriers[h.id]) continue;

            if (h.airUnit.state === 'docked' && h.airUnit.homeBaseId === entity.id && !knownHarrierIds.has(h.id)) {
                lostHarriers.push(h.id);
            }
        }
    }

    if (lostHarriers.length > 0) {
        const newSlots = [...nextAirBase.slots];
        let assignedCount = 0;

        for (const harrierId of lostHarriers) {
            // Find empty slot
            const emptyIdx = newSlots.findIndex(s => s === null);
            if (emptyIdx !== -1) {
                newSlots[emptyIdx] = harrierId;
                assignedCount++;

                // Also update the harrier's dockedSlot to match reality
                const harrier = allEntities[harrierId] as AirUnit;
                if (harrier.airUnit.dockedSlot !== emptyIdx) {
                    updatedHarriers[harrierId] = {
                        ...harrier,
                        airUnit: { ...harrier.airUnit, dockedSlot: emptyIdx }
                    };
                }
            } else {
                console.warn(`[AirBase] Could not recover lost harrier ${harrierId} - no slots available`);
                // Force undock? Or just leave it in limbo?
                // For now leave it, it might get picked up next time a slot opens
            }
        }

        if (assignedCount > 0) {
            nextAirBase = {
                ...nextAirBase,
                slots: newSlots
            };
        }
    }

    const nextEntity: BuildingEntity = {
        ...entity,
        airBase: nextAirBase
    };

    return { entity: nextEntity, updatedHarriers };
}

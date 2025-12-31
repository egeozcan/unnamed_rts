/**
 * New AI Strategies
 *
 * Additional strategy implementations beyond the core 5:
 * - Tech Rush: Fast tech center, rush advanced units
 * - Turtle: Heavy defense, slow expansion
 * - Eco Boom: Maximum economy, delayed military
 * - Air Dominance: Mass helicopters/air units
 * - Timing Push: Specific composition attack window
 */

import { Entity, Action, GameState } from '../../types.js';
import { RULES } from '../../../data/schemas/index.js';
import { AIPlayerState } from '../types.js';
import { hasProductionBuildingFor, checkPrerequisites } from '../utils/production.js';
import { getDefenseBuildings } from '../utils/spatial.js';

// ============ STRATEGY TYPES ============

/**
 * Extended strategy type including new strategies
 */
export type ExtendedStrategy =
    | 'buildup'
    | 'attack'
    | 'defend'
    | 'harass'
    | 'all_in'
    | 'tech_rush'
    | 'turtle'
    | 'eco_boom'
    | 'air_dominance'
    | 'timing_push';

// ============ TECH RUSH ============

/**
 * Tech Rush strategy handler
 * Prioritize tech center and rush to advanced units (mammoth, artillery, heli)
 */
export function handleTechRush(
    state: GameState,
    playerId: number,
    _aiState: AIPlayerState,
    buildings: Entity[],
    credits: number
): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const buildingQueueEmpty = !player.queues.building.current;
    const vehicleQueueEmpty = !player.queues.vehicle.current;
    const hasConyard = hasProductionBuildingFor('building', buildings);
    const hasFactory = hasProductionBuildingFor('vehicle', buildings);
    const hasTech = buildings.some(b => b.key === 'tech' && !b.dead);

    // Priority 1: Build tech center if we don't have one
    if (hasConyard && !hasTech && buildingQueueEmpty) {
        const canBuildTech = checkPrerequisites('tech', buildings);
        const techData = RULES.buildings['tech'];

        if (canBuildTech && techData && credits >= techData.cost) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'building', key: 'tech', playerId }
            });
            return actions;
        }

        // Build prerequisites for tech if needed
        if (!canBuildTech) {
            // Tech typically requires: conyard, power, factory
            if (!hasFactory && buildingQueueEmpty) {
                const factoryData = RULES.buildings['factory'];
                if (factoryData && checkPrerequisites('factory', buildings) && credits >= factoryData.cost) {
                    actions.push({
                        type: 'START_BUILD',
                        payload: { category: 'building', key: 'factory', playerId }
                    });
                    return actions;
                }
            }
        }
    }

    // Priority 2: Build advanced units once we have tech
    if (hasTech && hasFactory && vehicleQueueEmpty) {
        // Prefer: mammoth > artillery > mlrs
        const advancedUnits = ['mammoth', 'artillery', 'mlrs'];

        for (const unitKey of advancedUnits) {
            const unitData = RULES.units[unitKey];
            if (unitData && checkPrerequisites(unitKey, buildings) && credits >= unitData.cost) {
                actions.push({
                    type: 'START_BUILD',
                    payload: { category: 'vehicle', key: unitKey, playerId }
                });
                break;
            }
        }
    }

    // Priority 3: Minimal defense (just enough to survive)
    const defenseBuildings = getDefenseBuildings(buildings);
    if (hasConyard && defenseBuildings.length < 2 && buildingQueueEmpty && credits > 2000) {
        const turretData = RULES.buildings['turret'];
        if (turretData && checkPrerequisites('turret', buildings) && credits >= turretData.cost) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'building', key: 'turret', playerId }
            });
        }
    }

    return actions;
}

// ============ TURTLE ============

/**
 * Turtle strategy handler
 * Heavy defense, slow expansion, artillery for range
 */
export function handleTurtle(
    state: GameState,
    playerId: number,
    _aiState: AIPlayerState,
    buildings: Entity[],
    credits: number
): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const buildingQueueEmpty = !player.queues.building.current;
    const vehicleQueueEmpty = !player.queues.vehicle.current;
    const infantryQueueEmpty = !player.queues.infantry.current;
    const hasConyard = hasProductionBuildingFor('building', buildings);
    const hasFactory = hasProductionBuildingFor('vehicle', buildings);
    const hasBarracks = hasProductionBuildingFor('infantry', buildings);

    // Priority 1: Build lots of defenses
    const defenseBuildings = getDefenseBuildings(buildings);
    const maxDefenses = 6;

    if (hasConyard && defenseBuildings.length < maxDefenses && buildingQueueEmpty) {
        // Prioritize: turret > sam_site > pillbox > obelisk
        const defenseOrder = ['turret', 'sam_site', 'pillbox', 'obelisk'];

        for (const defKey of defenseOrder) {
            const defData = RULES.buildings[defKey];
            if (defData && checkPrerequisites(defKey, buildings) && credits >= defData.cost) {
                actions.push({
                    type: 'START_BUILD',
                    payload: { category: 'building', key: defKey, playerId }
                });
                break;
            }
        }
    }

    // Priority 2: Build ranged units (artillery, rocket soldiers)
    if (hasFactory && vehicleQueueEmpty) {
        const rangedVehicles = ['artillery', 'mlrs', 'heavy'];

        for (const unitKey of rangedVehicles) {
            const unitData = RULES.units[unitKey];
            if (unitData && checkPrerequisites(unitKey, buildings) && credits >= unitData.cost + 500) {
                actions.push({
                    type: 'START_BUILD',
                    payload: { category: 'vehicle', key: unitKey, playerId }
                });
                break;
            }
        }
    }

    // Priority 3: Build rocket soldiers for anti-armor
    if (hasBarracks && infantryQueueEmpty && credits > 1000) {
        const rocketData = RULES.units['rocket'];
        if (rocketData && checkPrerequisites('rocket', buildings) && credits >= rocketData.cost) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'rocket', playerId }
            });
        }
    }

    return actions;
}

// ============ ECO BOOM ============

/**
 * Eco Boom strategy handler
 * Maximum harvesters and refineries, delayed military
 */
export function handleEcoBoom(
    state: GameState,
    playerId: number,
    _aiState: AIPlayerState,
    buildings: Entity[],
    credits: number
): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const buildingQueueEmpty = !player.queues.building.current;
    const vehicleQueueEmpty = !player.queues.vehicle.current;
    const hasConyard = hasProductionBuildingFor('building', buildings);
    const hasFactory = hasProductionBuildingFor('vehicle', buildings);

    // Count economy
    const harvesters = Object.values(state.entities).filter(e =>
        e.owner === playerId && e.type === 'UNIT' && e.key === 'harvester' && !e.dead
    );
    const refineries = buildings.filter(b => b.key === 'refinery' && !b.dead);

    // Priority 1: Build refineries (aim for 4+)
    const targetRefineries = 4;
    if (hasConyard && refineries.length < targetRefineries && buildingQueueEmpty) {
        const refData = RULES.buildings['refinery'];
        if (refData && checkPrerequisites('refinery', buildings) && credits >= refData.cost) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'building', key: 'refinery', playerId }
            });
            return actions;
        }
    }

    // Priority 2: Build harvesters (aim for 2 per refinery, max 8)
    const targetHarvesters = Math.min(refineries.length * 2, 8);
    if (hasFactory && harvesters.length < targetHarvesters && vehicleQueueEmpty) {
        const harvData = RULES.units['harvester'];
        if (harvData && checkPrerequisites('harvester', buildings) && credits >= harvData.cost) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'vehicle', key: 'harvester', playerId }
            });
            return actions;
        }
    }

    // Priority 3: Build factory if we don't have one (needed for harvesters)
    if (hasConyard && !hasFactory && buildingQueueEmpty) {
        const factoryData = RULES.buildings['factory'];
        if (factoryData && checkPrerequisites('factory', buildings) && credits >= factoryData.cost) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'building', key: 'factory', playerId }
            });
            return actions;
        }
    }

    // Priority 4: Only build military when economy is strong
    const economyStrong = harvesters.length >= 6 && refineries.length >= 3;
    if (economyStrong && hasFactory && vehicleQueueEmpty && credits > 3000) {
        // Build heavy units with surplus
        const heavyUnits = ['mammoth', 'heavy', 'mlrs'];
        for (const unitKey of heavyUnits) {
            const unitData = RULES.units[unitKey];
            if (unitData && checkPrerequisites(unitKey, buildings) && credits >= unitData.cost) {
                actions.push({
                    type: 'START_BUILD',
                    payload: { category: 'vehicle', key: unitKey, playerId }
                });
                break;
            }
        }
    }

    return actions;
}

// ============ AIR DOMINANCE ============

/**
 * Air Dominance strategy handler
 * Rush to tech center, mass helicopters
 */
export function handleAirDominance(
    state: GameState,
    playerId: number,
    _aiState: AIPlayerState,
    buildings: Entity[],
    credits: number
): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const buildingQueueEmpty = !player.queues.building.current;
    const airQueueEmpty = !player.queues.air.current;
    const hasConyard = hasProductionBuildingFor('building', buildings);
    const hasTech = buildings.some(b => b.key === 'tech' && !b.dead);
    const hasHelipad = hasProductionBuildingFor('air', buildings);

    // Priority 1: Build tech center
    if (hasConyard && !hasTech && buildingQueueEmpty) {
        const techData = RULES.buildings['tech'];
        if (techData && checkPrerequisites('tech', buildings) && credits >= techData.cost) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'building', key: 'tech', playerId }
            });
            return actions;
        }
    }

    // Priority 2: Build helipad (if exists in rules)
    // Note: Game may not have helipad - helicopters might come from factory
    if (hasTech && !hasHelipad && buildingQueueEmpty) {
        // Check if helipad exists in rules
        const helipadBuildings = RULES.productionBuildings?.['air'] || [];
        for (const helipadKey of helipadBuildings) {
            const heliData = RULES.buildings[helipadKey];
            if (heliData && checkPrerequisites(helipadKey, buildings) && credits >= heliData.cost) {
                actions.push({
                    type: 'START_BUILD',
                    payload: { category: 'building', key: helipadKey, playerId }
                });
                return actions;
            }
        }
    }

    // Priority 3: Mass helicopters
    if (hasHelipad && airQueueEmpty) {
        const heliData = RULES.units['heli'];
        if (heliData && checkPrerequisites('heli', buildings) && credits >= heliData.cost) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'air', key: 'heli', playerId }
            });
        }
    }

    // Priority 4: Target enemy SAM sites first (set in attack targeting)

    return actions;
}

// ============ TIMING PUSH ============

/**
 * Timing Push configuration
 */
export interface TimingPushConfig {
    targetComposition: Record<string, number>; // e.g., { light: 4, rocket: 4 }
    triggerCredits: number; // Attack when below this (spent on army)
}

/**
 * Default timing push configs
 */
export const TIMING_PUSH_CONFIGS: Record<string, TimingPushConfig> = {
    light_rush: {
        targetComposition: { light: 6 },
        triggerCredits: 500
    },
    mixed_push: {
        targetComposition: { light: 4, rocket: 4 },
        triggerCredits: 800
    },
    heavy_timing: {
        targetComposition: { heavy: 4, rocket: 2 },
        triggerCredits: 1000
    }
};

/**
 * Timing Push strategy handler
 * Build specific composition, attack at timing window
 */
export function handleTimingPush(
    state: GameState,
    playerId: number,
    _aiState: AIPlayerState,
    buildings: Entity[],
    credits: number,
    config: TimingPushConfig = TIMING_PUSH_CONFIGS.mixed_push
): { actions: Action[]; shouldAttack: boolean } {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return { actions, shouldAttack: false };

    const vehicleQueueEmpty = !player.queues.vehicle.current;
    const infantryQueueEmpty = !player.queues.infantry.current;
    const hasFactory = hasProductionBuildingFor('vehicle', buildings);
    const hasBarracks = hasProductionBuildingFor('infantry', buildings);

    // Count current army
    const myUnits = Object.values(state.entities).filter(e =>
        e.owner === playerId && e.type === 'UNIT' && !e.dead
    );

    // Check if composition is met
    let compositionMet = true;
    let totalNeeded = 0;
    let totalHave = 0;

    for (const [unitKey, targetCount] of Object.entries(config.targetComposition)) {
        const currentCount = myUnits.filter(u => u.key === unitKey).length;
        totalHave += currentCount;
        totalNeeded += targetCount;
        if (currentCount < targetCount) {
            compositionMet = false;
        }
    }

    // If composition met, signal to attack
    if (compositionMet) {
        return { actions, shouldAttack: true };
    }

    // Build toward composition
    for (const [unitKey, targetCount] of Object.entries(config.targetComposition)) {
        const currentCount = myUnits.filter(u => u.key === unitKey).length;
        if (currentCount >= targetCount) continue;

        const unitData = RULES.units[unitKey];
        if (!unitData) continue;

        const isInfantry = unitData.type === 'infantry';
        const queueEmpty = isInfantry ? infantryQueueEmpty : vehicleQueueEmpty;
        const hasProduction = isInfantry ? hasBarracks : hasFactory;

        if (hasProduction && queueEmpty && checkPrerequisites(unitKey, buildings) && credits >= unitData.cost) {
            actions.push({
                type: 'START_BUILD',
                payload: {
                    category: isInfantry ? 'infantry' : 'vehicle',
                    key: unitKey,
                    playerId
                }
            });
            break;
        }
    }

    return { actions, shouldAttack: false };
}

// ============ STRATEGY SELECTION HELPERS ============

/**
 * Determine which extended strategy to use based on personality and game state
 */
export function selectExtendedStrategy(
    economyScore: number,
    threatLevel: number,
    techLevel: 'low' | 'mid' | 'high',
    personalityPreferences: ExtendedStrategy[]
): ExtendedStrategy {
    // If under threat, defend
    if (threatLevel > 70) {
        return 'defend';
    }

    // Check personality preferences
    for (const pref of personalityPreferences) {
        // Validate preference is viable
        switch (pref) {
            case 'tech_rush':
                if (economyScore >= 40) return 'tech_rush';
                break;
            case 'turtle':
                return 'turtle'; // Always viable
            case 'eco_boom':
                if (threatLevel < 30) return 'eco_boom';
                break;
            case 'air_dominance':
                if (economyScore >= 50 && techLevel !== 'low') return 'air_dominance';
                break;
            case 'timing_push':
                if (economyScore >= 30 && threatLevel < 50) return 'timing_push';
                break;
        }
    }

    // Default to buildup
    return 'buildup';
}

import { GameState, Action, Entity, PlayerState, BuildingEntity, Vector, UnitEntity, HarvesterUnit } from '../types.js';
import { RULES, AIPersonality } from '../../data/schemas/index.js';
import { AIPlayerState } from './types.js';
import { DebugEvents } from '../debug/events.js';
import {
    hasProductionBuildingFor,
    checkPrerequisites,
    countProductionBuildings,
    getProductionBuildingsFor,
    getCounterUnits,
    isRefineryUseful,
    getPriorityIndex,
    isValidPlacement,
    isAtMaxCount,
    // Well utilities for Induction Rig
    getAccessibleWells,
    getUnoccupiedWells,
    getInductionRigs,
    getDeployedInductionRigs,
    getNonDefenseBuildings,
    // Constants (some duplicated locally for now - see AI_CONSTANTS in utils.ts for central definitions)
    SURPLUS_DEFENSE_THRESHOLD,
    MAX_SURPLUS_TURRETS,
    ALL_IN_PHASE1_TICKS,
    ALL_IN_PHASE2_TICKS,
    ALL_IN_PHASE3_TICKS
} from './utils.js';
import { getAIState, findBaseCenter } from './state.js';
import { findCaptureOpportunities } from './planning.js';
export function handleEconomy(
    state: GameState,
    playerId: number,
    buildings: Entity[],
    player: PlayerState,
    personality: AIPersonality,
    aiState: AIPlayerState,
    enemies: Entity[]
): Action[] {
    const actions: Action[] = [];
    const buildOrder = personality.build_order_priority;

    // ===== CORE CAPABILITY CHECK =====
    // A conyard (deployed MCV) is required to build new buildings
    const hasConyard = hasProductionBuildingFor('building', buildings);

    // ===== INVESTMENT PRIORITY HANDLING =====

    // Count current harvesters and refineries
    const harvesters = Object.values(state.entities).filter(e =>
        e.owner === playerId && e.type === 'UNIT' && e.key === 'harvester' && !e.dead
    );
    const refineries = buildings.filter(b => b.key === 'refinery' && !b.dead);
    const hasFactory = hasProductionBuildingFor('vehicle', buildings);
    const buildingQueueEmpty = !player.queues.building.current;
    const vehicleQueueEmpty = !player.queues.vehicle.current;

    // Detect Panic Mode and Combat Mode
    const isPanic = aiState.threatLevel > 75 || (aiState.threatLevel > 50 && player.credits < 1000) || aiState.strategy === 'all_in';
    const isInCombat = aiState.strategy === 'attack' || aiState.strategy === 'defend' || aiState.strategy === 'all_in';

    // PANIC DEFENSE: Prioritize defensive structures over everything else if in panic
    if (hasConyard && isPanic && buildingQueueEmpty) {
        const canBuildTurret = checkPrerequisites('turret', buildings);

        // Try to build defensive structures if we have funds
        if (canBuildTurret) {
            const turretData = RULES.buildings['turret'];
            const pillboxData = RULES.buildings['pillbox'];

            let defToBuild = 'turret';
            if (player.credits < (turretData?.cost || 800) && player.credits >= (pillboxData?.cost || 400)) {
                defToBuild = 'pillbox';
            }

            const data = RULES.buildings[defToBuild];
            if (data && player.credits >= data.cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: defToBuild, playerId } });
                if (import.meta.env?.DEV) {
                    DebugEvents.emit('decision', {
                        tick: state.tick,
                        playerId,
                        data: {
                            category: 'economy',
                            action: 'queue-build',
                            reason: 'panic-defense',
                            building: defToBuild,
                            isPanic: true
                        }
                    });
                }
                // Don't return, let unit production happen too
            }
        }
    }

    // CRITICAL FIX: Maximum refineries per player to prevent infinite refinery spam
    const MAX_REFINERIES = 4;
    const hasEnoughRefineries = refineries.length >= MAX_REFINERIES;
    const hasBarracks = hasProductionBuildingFor('infantry', buildings);

    if (aiState.investmentPriority === 'economy' && !isPanic) {
        // ECONOMY PRIORITY: Build harvesters and expand toward ore

        // CRITICAL FIX: Prioritize production buildings BEFORE more refineries
        // Without barracks/factory, the AI cannot build an army!
        if (hasConyard && buildingQueueEmpty) {
            // If we have a refinery but no barracks, build barracks first
            if (refineries.length > 0 && !hasBarracks) {
                const barracksData = RULES.buildings['barracks'];
                const barracksReqsMet = checkPrerequisites('barracks', buildings);
                if (barracksData && barracksReqsMet && player.credits >= barracksData.cost) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'barracks', playerId } });
                    return actions;
                }
            }

            // If we have barracks but no factory, build factory
            if (hasBarracks && !hasFactory) {
                const factoryData = RULES.buildings['factory'];
                const factoryReqsMet = checkPrerequisites('factory', buildings);
                if (factoryData && factoryReqsMet && player.credits >= factoryData.cost) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'factory', playerId } });
                    return actions;
                }
            }
        }

        // 1. Build harvesters if we have too few (personality-driven ratio)
        const harvRatio = personality.harvester_ratio ?? 2;
        const idealHarvesters = Math.max(Math.ceil(refineries.length * harvRatio), 2);
        const canBuildHarvester = refineries.length > 0; // Need refinery for harvesters
        if (harvesters.length < idealHarvesters && hasFactory && vehicleQueueEmpty && canBuildHarvester) {
            const harvData = RULES.units['harvester'];
            const harvReqsMet = checkPrerequisites('harvester', buildings);
            if (harvData && harvReqsMet && player.credits >= harvData.cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'harvester', playerId } });
                if (import.meta.env?.DEV) {
                    DebugEvents.emit('decision', {
                        tick: state.tick,
                        playerId,
                        data: {
                            category: 'economy',
                            action: 'queue-build',
                            reason: 'economy-priority-harvester',
                            unit: 'harvester',
                            currentHarvesters: harvesters.length,
                            idealHarvesters
                        }
                    });
                }
                return actions; // Focus on harvesters
            }
        }

        // 2. Build refinery near distant ore if we have an expansion target
        // CRITICAL FIX: Only if below max refineries
        if (hasConyard && aiState.expansionTarget && buildingQueueEmpty && !hasEnoughRefineries) {
            const refineryData = RULES.buildings['refinery'];
            const canBuildRefinery = checkPrerequisites('refinery', buildings);

            // Check if we can reach the expansion target with current build range
            const BUILD_RADIUS = 400;
            const nonDefenseBuildings = buildings.filter(b => {
                const bData = RULES.buildings[b.key];
                return !bData?.isDefense;
            });

            let canReachTarget = false;
            for (const b of nonDefenseBuildings) {
                if (b.pos.dist(aiState.expansionTarget) < BUILD_RADIUS + 100) {
                    canReachTarget = true;
                    break;
                }
            }

            // Count existing power plants to limit building walk
            const existingPowerPlants = buildings.filter(b => b.key === 'power').length;
            const MAX_POWER_FOR_EXPANSION = 4; // Limit building walk to 4 power plants

            if (canReachTarget && canBuildRefinery && refineryData && player.credits >= refineryData.cost) {
                // Build refinery near the ore
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'refinery', playerId } });
                if (import.meta.env?.DEV) {
                    DebugEvents.emit('decision', {
                        tick: state.tick,
                        playerId,
                        data: {
                            category: 'economy',
                            action: 'queue-build',
                            reason: 'expansion-refinery',
                            building: 'refinery',
                            refineryCount: refineries.length
                        }
                    });
                }
                return actions;
            } else if (!canReachTarget && buildingQueueEmpty && existingPowerPlants < MAX_POWER_FOR_EXPANSION) {
                // BUILDING WALK: Build power plant toward the ore (limited number)
                const powerData = RULES.buildings['power'];
                if (powerData && player.credits >= powerData.cost) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId } });
                    return actions;
                }
            }
        }

        // 3. Build refinery near accessible unclaimed ore (when expansionTarget is null)
        // CRITICAL FIX: Only if below max refineries
        if (hasConyard && !aiState.expansionTarget && buildingQueueEmpty && !hasEnoughRefineries) {
            const refineryData = RULES.buildings['refinery'];
            const canBuildRefinery = checkPrerequisites('refinery', buildings);
            const BUILD_RADIUS = 400;

            // Check for accessible ore without a refinery (from ANY player, not just ours)
            const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
            const allRefineries = Object.values(state.entities).filter(e =>
                e.type === 'BUILDING' && e.key === 'refinery' && !e.dead
            );
            const nonDefenseBuildings = buildings.filter(b => {
                const bData = RULES.buildings[b.key];
                return !bData?.isDefense;
            });

            let hasUnclaimedAccessibleOre = false;
            for (const ore of allOre) {
                // Check if ore is within build range
                let isAccessible = false;
                for (const b of nonDefenseBuildings) {
                    if (b.pos.dist(ore.pos) < BUILD_RADIUS + 150) {
                        isAccessible = true;
                        break;
                    }
                }
                if (!isAccessible) continue;

                // CRITICAL FIX: Check if ore already has a refinery nearby from ANY player
                const hasNearbyRefinery = allRefineries.some(r => r.pos.dist(ore.pos) < 300);
                if (!hasNearbyRefinery) {
                    hasUnclaimedAccessibleOre = true;
                    break;
                }
            }

            if (hasUnclaimedAccessibleOre && canBuildRefinery && refineryData && player.credits >= refineryData.cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'refinery', playerId } });
                return actions;
            }
        }
    } else if (aiState.investmentPriority === 'defense') {
        // DEFENSE PRIORITY: Build turrets
        if (hasConyard && buildingQueueEmpty) {
            const turretData = RULES.buildings['turret'];
            const canBuildTurret = checkPrerequisites('turret', buildings);
            if (canBuildTurret && turretData && player.credits >= turretData.cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'turret', playerId } });
                // Don't return - continue with unit production for defense
            }
        }
    }

    // ===== PEACETIME ECONOMY EXPANSION =====
    const isPeacetime = aiState.threatLevel <= 20 &&
        (aiState.investmentPriority === 'balanced' || aiState.investmentPriority === 'warfare');

    if (isPeacetime) {
        // 1. Build harvesters if below ideal (personality-driven ratio)
        const harvRatioPeace = personality.harvester_ratio ?? 2;
        const idealHarvesters = Math.max(Math.ceil(refineries.length * harvRatioPeace), 2);
        const canBuildHarvester = refineries.length > 0;

        if (harvesters.length < idealHarvesters && hasFactory && vehicleQueueEmpty && canBuildHarvester) {
            const harvData = RULES.units['harvester'];
            const harvReqsMet = checkPrerequisites('harvester', buildings);
            // Use a higher credit threshold for peacetime - only spend surplus
            const peacetimeCreditThreshold = 800;
            if (harvData && harvReqsMet && player.credits >= harvData.cost + peacetimeCreditThreshold) {
                actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'harvester', playerId } });
                return actions; // Prioritize harvester production in peacetime
            }
        }

        // 2. Build additional refinery if we have accessible ore without refinery coverage
        // CRITICAL FIX: Only if below max refineries
        if (hasConyard && buildingQueueEmpty && !hasEnoughRefineries) {
            const refineryData = RULES.buildings['refinery'];
            const canBuildRefinery = checkPrerequisites('refinery', buildings);
            const BUILD_RADIUS = 400;

            // Find ore patches within build range that don't have a nearby refinery (from ANY player)
            const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
            const allRefineries = Object.values(state.entities).filter(e =>
                e.type === 'BUILDING' && e.key === 'refinery' && !e.dead
            );
            const nonDefenseBuildings = buildings.filter(b => {
                const bData = RULES.buildings[b.key];
                return !bData?.isDefense;
            });

            let hasUnclaimedAccessibleOre = false;
            for (const ore of allOre) {
                // Check if ore is within build range
                let isAccessible = false;
                for (const b of nonDefenseBuildings) {
                    if (b.pos.dist(ore.pos) < BUILD_RADIUS + 150) {
                        isAccessible = true;
                        break;
                    }
                }
                if (!isAccessible) continue;

                // CRITICAL FIX: Check if ore already has a refinery nearby from ANY player
                const hasNearbyRefinery = allRefineries.some(r => r.pos.dist(ore.pos) < 300);
                if (!hasNearbyRefinery) {
                    hasUnclaimedAccessibleOre = true;
                    break;
                }
            }

            // Build refinery if we have money and unclaimed accessible ore
            const peacetimeRefineryThreshold = 1000;
            if (hasUnclaimedAccessibleOre && canBuildRefinery && refineryData &&
                player.credits >= refineryData.cost + peacetimeRefineryThreshold) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'refinery', playerId } });
                return actions; // Prioritize refinery expansion
            }
        }
    }

    // ===== SURPLUS DEFENSE BUILDING =====
    if (hasConyard && player.credits >= SURPLUS_DEFENSE_THRESHOLD && aiState.threatLevel === 0 && buildingQueueEmpty) {
        const existingTurrets = buildings.filter(b => {
            const bData = RULES.buildings[b.key];
            return bData?.isDefense && !b.dead;
        }).length;

        // Build more defenses if we have surplus and not too many already
        const maxDefenses = personality.defense_investment ?? MAX_SURPLUS_TURRETS;
        if (existingTurrets < maxDefenses) {
            const canBuildTurret = checkPrerequisites('turret', buildings);
            const turretData = RULES.buildings['turret'];

            if (canBuildTurret && turretData && player.credits >= turretData.cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'turret', playerId } });
                // Don't return - allow unit production to continue
            }
        }
    }

    // ===== SURPLUS PRODUCTION BUILDINGS =====
    const SURPLUS_PRODUCTION_THRESHOLD = 6000; // Higher threshold for production buildings
    const MAX_SURPLUS_BARRACKS = 3;
    const MAX_SURPLUS_FACTORIES = 3;

    if (hasConyard && player.credits >= SURPLUS_PRODUCTION_THRESHOLD && aiState.threatLevel <= 20 && buildingQueueEmpty) {
        const existingBarracks = countProductionBuildings('infantry', buildings);
        const existingFactories = countProductionBuildings('vehicle', buildings);

        // Prefer factories over barracks (vehicles are stronger)
        if (existingFactories < MAX_SURPLUS_FACTORIES) {
            const factoryData = RULES.buildings['factory'];
            const factoryReqsMet = checkPrerequisites('factory', buildings);
            if (factoryData && factoryReqsMet && player.credits >= factoryData.cost + 2000) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'factory', playerId } });
            }
        } else if (existingBarracks < MAX_SURPLUS_BARRACKS) {
            const barracksData = RULES.buildings['barracks'];
            const barracksReqsMet = checkPrerequisites('barracks', buildings);
            if (barracksData && barracksReqsMet && player.credits >= barracksData.cost + 2000) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'barracks', playerId } });
            }
        } else if (!isAtMaxCount('airforce_command', buildings, player)) {
            // Build airforce_command for harrier production (respects maxCount from rules.json)
            const airforceData = RULES.buildings['airforce_command'];
            const airforceReqsMet = checkPrerequisites('airforce_command', buildings);
            if (airforceData && airforceReqsMet && player.credits >= airforceData.cost + 2000) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'airforce_command', playerId } });
            }
        }
    }

    // ===== SERVICE DEPOT PRIORITY =====
    // Build service depot when we have many damaged units (respects maxCount from rules.json)
    if (hasConyard && buildingQueueEmpty && !isPanic && hasFactory && !isAtMaxCount('service_depot', buildings, player)) {
        const serviceDepotReqsMet = checkPrerequisites('service_depot', buildings);
        const serviceDepotData = RULES.buildings['service_depot'];

        if (serviceDepotReqsMet && serviceDepotData) {
            // Count damaged combat units (below 70% HP)
            const damagedUnits = Object.values(state.entities).filter(e =>
                e.owner === playerId &&
                e.type === 'UNIT' &&
                !e.dead &&
                e.key !== 'harvester' &&
                e.hp < e.maxHp * 0.7
            );

            // Build if we have 2+ damaged units and can afford it with buffer
            if (damagedUnits.length >= 2 && player.credits >= serviceDepotData.cost + 500) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'service_depot', playerId } });
            }
        }
    }

    // ===== EXPANSION REFINERY PRIORITY =====
    // After deploying an MCV at an expansion, prioritize building a refinery there.
    // CRITICAL FIX: Only if below max refineries
    if (hasConyard && buildingQueueEmpty && !isPanic && !hasEnoughRefineries) {
        const conyards = buildings.filter(b => b.key === 'conyard' && !b.dead);
        const REFINERY_COVERAGE_RADIUS = 500; // Distance within which a refinery "covers" a conyard

        // Check if any conyard lacks a nearby refinery
        for (const conyard of conyards) {
            const hasNearbyRefinery = refineries.some(r => r.pos.dist(conyard.pos) < REFINERY_COVERAGE_RADIUS);

            if (!hasNearbyRefinery) {
                // This conyard has no refinery nearby - check if there's ore to harvest
                const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
                const oreNearConyard = allOre.some(ore => ore.pos.dist(conyard.pos) < 800);

                if (oreNearConyard) {
                    const refineryData = RULES.buildings['refinery'];
                    const canBuildRefinery = checkPrerequisites('refinery', buildings);

                    if (refineryData && canBuildRefinery && player.credits >= refineryData.cost) {
                        actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'refinery', playerId } });
                        // Return early - refinery at expansion is high priority
                        return actions;
                    }
                }
                break; // Only check one conyard per tick
            }
        }
    }

    // ===== STANDARD BUILD ORDER =====
    // Build order fulfillment - only if we have a conyard
    if (!hasConyard) {
        // No conyard = cannot build buildings, skip to unit production
    } else {
        const q = player.queues.building;

        // ===== DYNAMIC PRODUCTION BUILDING PRIORITY =====
        if (!q.current && buildingQueueEmpty) {
            const canProduceInfantry = hasProductionBuildingFor('infantry', buildings);
            const canProduceVehicles = hasProductionBuildingFor('vehicle', buildings);
            const needsInfantryProduction = !canProduceInfantry && player.credits >= 500;
            const needsVehicleProduction = !canProduceVehicles && player.credits >= 2000;

            // Prioritize getting infantry production first (cheaper, faster)
            if (needsInfantryProduction) {
                const infantryBuildings = getProductionBuildingsFor('infantry');
                for (const bKey of infantryBuildings) {
                    const data = RULES.buildings[bKey];
                    if (data && checkPrerequisites(bKey, buildings) && player.credits >= data.cost) {
                        actions.push({ type: 'START_BUILD', payload: { category: 'building', key: bKey, playerId } });
                        break;
                    }
                }
            }
            // Then vehicle production (only if we already have infantry production)
            else if (needsVehicleProduction && canProduceInfantry) {
                const vehicleBuildings = getProductionBuildingsFor('vehicle');
                for (const bKey of vehicleBuildings) {
                    const data = RULES.buildings[bKey];
                    if (data && checkPrerequisites(bKey, buildings) && player.credits >= data.cost) {
                        actions.push({ type: 'START_BUILD', payload: { category: 'building', key: bKey, playerId } });
                        break;
                    }
                }
            }
        }

        // Standard build order fulfillment (if no dynamic priority triggered)
        // Respects maxCount from rules.json for all buildings
        if (actions.length === 0) {
            for (const item of buildOrder) {
                // Skip economic buildings during active combat (Issue #12)
                if (isInCombat && ['power', 'refinery'].includes(item) && player.credits < 3000) {
                    continue;
                }

                // Skip if already at max count (uses maxCount from rules.json)
                if (isAtMaxCount(item, buildings, player)) {
                    continue;
                }

                const having = buildings.some(b => b.key === item);
                const building = q.current === item;
                const queued = q.queued?.includes(item);
                const readyToPlace = player.readyToPlace === item;

                if (!having && !building && !queued && !readyToPlace) {
                    const data = RULES.buildings[item];
                    if (data) {
                        const reqsMet = checkPrerequisites(item, buildings);
                        if (reqsMet && player.credits >= data.cost) {
                            actions.push({ type: 'START_BUILD', payload: { category: 'building', key: item, playerId } });
                            break;
                        }
                    }
                }
            }
        }
    }

    // Unit production - STAGGERED for smoother resource usage
    const prefs = personality.unit_preferences;

    // Personality-based credit buffer with strategy modifiers
    const baseBuffer = personality.credit_buffer ?? 400;
    const stratMult = aiState.strategy === 'attack' ? 0.5 :
        aiState.strategy === 'defend' ? 1.2 : 1.0;
    let creditBuffer = Math.floor(baseBuffer * stratMult);
    let creditThreshold = creditBuffer + 400;

    // Override for Panic Mode
    if (isPanic) {
        creditThreshold = 0; // Spend everything
        creditBuffer = 0;    // No reserves
    }

    // Override for Doomed Mode - no point saving, spend everything to build army
    if (aiState.isDoomed) {
        creditThreshold = 0;
        creditBuffer = 0;
    }


    const infantryQueueEmpty = !player.queues.infantry.current;

    // Get counter-building unit preferences based on enemy composition
    const counterUnits = getCounterUnits(aiState.enemyIntelligence.dominantArmor, prefs);
    const counterInfantry = counterUnits.infantry;
    const counterVehicle = counterUnits.vehicle;

    if (player.credits > creditThreshold) {
        // STAGGERED PRODUCTION: Alternate between infantry and vehicles
        // This prevents resource spikes and creates more varied attacks

        // Track credits locally to avoid mutating immutable state
        let creditsRemaining = player.credits;

        // Decide what to build this tick
        let buildInfantry = false;
        let buildVehicle = false;

        if (isPanic) {
            // PANIC: Build EVERYTHING possible
            if (hasBarracks && infantryQueueEmpty) buildInfantry = true;
            if (hasFactory && vehicleQueueEmpty) buildVehicle = true;
        } else {
            // NORMAL: Staggered
            if (hasBarracks && infantryQueueEmpty && hasFactory && vehicleQueueEmpty) {
                // Both available - alternate based on last production
                if (aiState.lastProductionType === 'infantry') {
                    buildVehicle = true;
                } else if (aiState.lastProductionType === 'vehicle') {
                    buildInfantry = true;
                } else {
                    buildVehicle = true; // Default to vehicle
                }
            } else if (hasBarracks && infantryQueueEmpty) {
                buildInfantry = true;
            } else if (hasFactory && vehicleQueueEmpty) {
                buildVehicle = true;
            }
        }

        // Execute infantry production with counter-building
        if (buildInfantry) {
            // All-in mode: cheapest units first for maximum quantity
            // Panic mode: rockets for damage, rifles for quantity
            const list = aiState.strategy === 'all_in'
                ? ['rifle', 'flamer', 'grenadier', 'rocket'] // Cheapest first for max units
                : isPanic
                    ? ['rocket', 'rifle']
                    : counterInfantry;

            for (const key of list) {
                const data = RULES.units[key];
                const reqsMet = checkPrerequisites(key, buildings);
                const cost = data?.cost || 0;
                // Check against buffer using local creditsRemaining to avoid state mutation
                if (reqsMet && creditsRemaining >= cost && (creditsRemaining - cost) >= creditBuffer) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'infantry', key, playerId } });
                    aiState.lastProductionType = 'infantry';
                    creditsRemaining -= cost; // Track locally for subsequent checks
                    break;
                }
            }
        }

        // Execute vehicle production with counter-building
        let vehicleBuilt = false;
        if (buildVehicle) {
            // All-in mode: cheapest combat units first for maximum quantity (no harvesters!)
            const list = aiState.strategy === 'all_in'
                ? ['jeep', 'apc', 'light', 'heavy'] // Cheapest combat units first
                : isPanic
                    ? ['light', 'jeep']
                    : counterVehicle;

            for (const key of list) {
                const data = RULES.units[key];
                const reqsMet = checkPrerequisites(key, buildings);
                const cost = data?.cost || 0;
                // Check against buffer using local creditsRemaining to avoid state mutation
                if (reqsMet && creditsRemaining >= cost && (creditsRemaining - cost) >= creditBuffer) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key, playerId } });
                    aiState.lastProductionType = 'vehicle';
                    creditsRemaining -= cost; // Track locally for subsequent checks
                    vehicleBuilt = true;
                    break;
                }
            }
        }

        // FALLBACK: If vehicle production was desired but failed (can't afford any vehicles),
        // try infantry production instead. This prevents AI stalling when low on credits.
        if (buildVehicle && !vehicleBuilt && hasBarracks && infantryQueueEmpty) {
            const list = counterInfantry;
            for (const key of list) {
                const data = RULES.units[key];
                const reqsMet = checkPrerequisites(key, buildings);
                const cost = data?.cost || 0;
                // Check against buffer using local creditsRemaining to avoid state mutation
                if (reqsMet && creditsRemaining >= cost && (creditsRemaining - cost) >= creditBuffer) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'infantry', key, playerId } });
                    aiState.lastProductionType = 'infantry';
                    creditsRemaining -= cost; // Track locally for subsequent checks
                    break;
                }
            }
        }

        // ===== ENGINEER PRODUCTION FOR CAPTURE OPPORTUNITIES =====
        // Build engineers when there are valuable enemy buildings to capture
        // Skip during panic/all-in (need combat units instead)
        const queuedInfantryThisTick = actions.some(a =>
            a.type === 'START_BUILD' &&
            (a.payload as { category: string }).category === 'infantry'
        );
        if (hasBarracks && infantryQueueEmpty && !isPanic && aiState.strategy !== 'all_in' && !queuedInfantryThisTick) {
            const baseCenter = findBaseCenter(buildings);
            const captureOps = findCaptureOpportunities(enemies, baseCenter);

            if (captureOps.length > 0) {
                // Count existing engineers
                const existingEngineers = Object.values(state.entities).filter(e =>
                    e.owner === playerId && e.type === 'UNIT' && e.key === 'engineer' && !e.dead
                ).length;

                // Limit to 2 engineers at a time (fragile + expensive)
                const maxEngineers = Math.min(2, captureOps.length);

                if (existingEngineers < maxEngineers) {
                    const engineerData = RULES.units['engineer'];
                    const engineerReqsMet = checkPrerequisites('engineer', buildings);
                    const engineerCost = engineerData?.cost || 500;

                    // Extra buffer (500) to not starve combat production
                    if (engineerReqsMet && creditsRemaining >= engineerCost + creditBuffer + 500) {
                        actions.push({ type: 'START_BUILD', payload: { category: 'infantry', key: 'engineer', playerId } });
                        aiState.lastProductionType = 'infantry';
                        creditsRemaining -= engineerCost;
                    }
                }
            }
        }

        // ===== DEMO TRUCK PRODUCTION =====
        // Build demo trucks for surgical strikes against high-value targets
        // Skip during panic/all-in (need regular combat units)
        const queuedVehicleForDemoCheck = actions.some(a =>
            a.type === 'START_BUILD' &&
            (a.payload as { category: string }).category === 'vehicle'
        );
        if (hasFactory && vehicleQueueEmpty && !isPanic && aiState.strategy !== 'all_in' && !queuedVehicleForDemoCheck) {
            // Count existing demo trucks
            const existingDemoTrucks = Object.values(state.entities).filter(e =>
                e.owner === playerId && e.type === 'UNIT' && e.key === 'demo_truck' && !e.dead
            ).length;

            // Limit to 2 demo trucks at a time (expensive + suicide units)
            const maxDemoTrucks = 2;

            // Only build if there are high-value building targets
            const highValueTargets = enemies.filter(e =>
                e.type === 'BUILDING' &&
                ['conyard', 'factory', 'refinery', 'barracks', 'tech'].includes(e.key)
            );

            if (existingDemoTrucks < maxDemoTrucks && highValueTargets.length > 0) {
                const demoTruckData = RULES.units['demo_truck'];
                const demoTruckReqsMet = checkPrerequisites('demo_truck', buildings);
                const demoTruckCost = demoTruckData?.cost || 1500;

                // High credit buffer (1000) - only build when we have surplus
                // Demo trucks are expensive and risky
                if (demoTruckReqsMet && creditsRemaining >= demoTruckCost + creditBuffer + 1000) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'demo_truck', playerId } });
                    aiState.lastProductionType = 'vehicle';
                    creditsRemaining -= demoTruckCost;
                }
            }
        }

        // ===== AIR UNIT PRODUCTION =====
        // Produce harriers when airforce_command is available - prioritize air power
        const hasAirforce = hasProductionBuildingFor('air', buildings);
        const airQueueEmpty = !player.queues.air.current;

        // Count total slots available (6 per airforce command) and current harriers
        const airforceCommands = buildings.filter(b => b.key === 'airforce_command' && !b.dead);
        const totalSlots = airforceCommands.length * 6;
        const currentHarriers = Object.values(state.entities).filter(
            e => e.type === 'UNIT' && e.key === 'harrier' && e.owner === playerId && !e.dead
        ).length;
        const harriersInQueue = player.queues.air.current ? 1 : 0;
        const hasAvailableSlots = (currentHarriers + harriersInQueue) < totalSlots;

        // Lower threshold for harrier production (800 instead of 1500) to build air power faster
        if (hasAirforce && airQueueEmpty && hasAvailableSlots && !isPanic && creditsRemaining > creditBuffer + 800) {
            const harrierData = RULES.units['harrier'];
            const harrierReqsMet = checkPrerequisites('harrier', buildings);
            const cost = harrierData?.cost || 0;

            if (harrierReqsMet && creditsRemaining >= cost && (creditsRemaining - cost) >= creditBuffer) {
                actions.push({ type: 'START_BUILD', payload: { category: 'air', key: 'harrier', playerId } });
                aiState.lastProductionType = 'air';
                creditsRemaining -= cost;
            }
        }

        // ===== INDUCTION RIG PRODUCTION =====
        // Build induction rigs when we have accessible unoccupied wells and surplus economy
        // This provides stable macro income (80% efficiency) without harvester management
        // Check if we already queued a vehicle this tick
        const queuedVehicleThisTick = actions.some(a =>
            a.type === 'START_BUILD' &&
            (a.payload as { category: string }).category === 'vehicle'
        );
        if (hasFactory && vehicleQueueEmpty && !isPanic && !queuedVehicleThisTick) {
            const inductionRigData = RULES.units['induction_rig'];
            const inductionRigReqsMet = checkPrerequisites('induction_rig', buildings);
            const rigCost = inductionRigData?.cost || 1800;

            // Only build if we have accessible wells without rigs
            const unoccupiedWells = getUnoccupiedWells(state);
            const nonDefenseBuildings = getNonDefenseBuildings(buildings);
            const accessibleWells = getAccessibleWells(unoccupiedWells, nonDefenseBuildings, 1500);

            // Count existing induction rigs (mobile + deployed) for this player
            const existingRigs = getInductionRigs(state, playerId);
            const deployedRigs = getDeployedInductionRigs(state, playerId);
            const totalRigs = existingRigs.length + deployedRigs.length;

            // Build if:
            // 1. Have accessible unoccupied wells
            // 2. Don't have more rigs in transit than accessible wells
            // 3. Have enough credits (with buffer for larger investment)
            // 4. Not already at max rigs (limit to 3 for now)
            const MAX_INDUCTION_RIGS = 3;
            const wantsRig = accessibleWells.length > 0 &&
                             existingRigs.length < accessibleWells.length &&
                             totalRigs < MAX_INDUCTION_RIGS;

            // Higher credit threshold - this is an expensive strategic investment
            const rigCreditThreshold = creditBuffer + 1500;

            if (wantsRig && inductionRigReqsMet && creditsRemaining >= rigCost &&
                creditsRemaining > rigCreditThreshold) {
                actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'induction_rig', playerId } });
                aiState.lastProductionType = 'vehicle';
                creditsRemaining -= rigCost;
            }
        }
    }

    // ========== MCV PRODUCTION FOR RECOVERY & EXPANSION ==========
    const mcvCost = RULES.units.mcv?.cost || 3000;
    const vehicleQueue = player.queues.vehicle;
    const alreadyBuildingMcv = vehicleQueue.current === 'mcv';
    const mcvInQueued = vehicleQueue.queued?.includes('mcv') || false;

    // CRITICAL: Check if we already queued a vehicle action THIS TICK
    const alreadyQueuedVehicleThisTick = actions.some(a =>
        a.type === 'START_BUILD' &&
        (a.payload as { category: string }).category === 'vehicle'
    );

    // Debug: find all MCVs for this player
    const allMcvs = Object.values(state.entities).filter((e: Entity) => e.key === 'mcv' && !e.dead);
    const existingMcvs = allMcvs.filter(e => e.owner === playerId);

    const existingConyards = buildings.filter(b => b.key === 'conyard' && !b.dead);
    const MAX_BASES = 2;

    // Common guards for both recovery and expansion
    if (!hasFactory) return actions;
    if (alreadyBuildingMcv || mcvInQueued) return actions;
    if (alreadyQueuedVehicleThisTick) return actions;
    if (existingMcvs.length > 0) return actions;

    // ===== RECOVERY: Build MCV if we lost our conyard =====
    // Conditions: No conyard, have factory, situation is stable (not under heavy attack)
    if (existingConyards.length === 0) {
        const mcvReqsMet = checkPrerequisites('mcv', buildings);
        // Lower credit threshold for recovery - this is critical
        const canAffordRecoveryMcv = player.credits >= mcvCost + 500;
        // Only build if not in panic mode (situation is looking better)
        const situationStable = !isPanic && aiState.threatLevel < 60;

        if (mcvReqsMet && canAffordRecoveryMcv && situationStable) {
            console.log(`[MCV] P${playerId} queueing MCV for RECOVERY (no conyard, threat=${aiState.threatLevel})`);
            actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'mcv', playerId } });
        }
        return actions;
    }

    // ===== EXPANSION: Build MCV to expand to distant ore =====
    // Guards specific to expansion
    if (existingConyards.length >= MAX_BASES) return actions;
    if (player.credits <= mcvCost + 2000) return actions;

    // Find distant ore for expansion
    const baseCenter = buildings.find(b => b.key === 'conyard')?.pos || buildings[0]?.pos;
    if (!baseCenter) return actions;

    let hasDistantOre = false;
    for (const e of Object.values(state.entities)) {
        const entity = e as Entity;
        if (entity.type !== 'RESOURCE' || entity.dead) continue;

        let inRange = false;
        for (const b of buildings) {
            const bData = RULES.buildings[b.key];
            if (bData?.isDefense) continue;
            if (entity.pos.dist(b.pos) < 600) {
                inRange = true;
                break;
            }
        }

        const distFromBase = entity.pos.dist(baseCenter);
        if (!inRange && distFromBase > 600 && distFromBase < 1500) {
            hasDistantOre = true;
            break;
        }
    }
    if (hasDistantOre) {
        console.log(`[MCV] P${playerId} queueing MCV for expansion (conyards=${existingConyards.length}/${MAX_BASES})`);
        actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'mcv', playerId } });
    }

    return actions;
}

export function handleEmergencySell(
    _state: GameState,
    playerId: number,
    buildings: Entity[],
    player: PlayerState,
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];

    // ===== SELL COOLDOWN (Issue #2) =====
    const SELL_COOLDOWN = 120; // 2 seconds
    if (_state.tick - aiState.lastSellTick < SELL_COOLDOWN) {
        return actions;
    }

    // ===== BUILDING AGE GRACE PERIOD (Issue #1) =====
    const BUILDING_GRACE_PERIOD = 300; // 5 seconds
    const matureBuildings = buildings.filter(b => {
        const bldEntity = b as BuildingEntity;
        const age = _state.tick - (bldEntity.building.placedTick || 0);
        return age >= BUILDING_GRACE_PERIOD;
    });

    const REFINERY_COST = RULES.buildings.refinery.cost;

    // 1. Identify Critical Needs
    const hasRefinery = buildings.some(b => b.key === 'refinery');
    const hasConyard = hasProductionBuildingFor('building', buildings);

    // Check for "Stalemate / Fire Sale" condition
    const harvesters = Object.values(_state.entities).filter(e =>
        e.owner === playerId && e.key === 'harvester' && !e.dead
    );
    const hasIncome = harvesters.length > 0 && hasRefinery;
    const isBroke = player.credits < 200;
    // "Doomed" state: no income AND no way to recover (no conyard to build refinery)
    const isDoomed = !hasIncome && !hasConyard && !hasRefinery;
    const isStalemate = (!hasIncome && isBroke) || isDoomed;

    // Track doomed state in AI state for strategy module to use
    aiState.isDoomed = isDoomed;

    const needsRefinery = hasConyard && !hasRefinery && player.credits < REFINERY_COST;

    // ===== ARMY AND THREAT ASSESSMENT =====
    // Count our combat units (excluding harvesters and MCVs)
    const combatUnits = Object.values(_state.entities).filter(e =>
        e.owner === playerId &&
        e.type === 'UNIT' &&
        e.key !== 'harvester' &&
        e.key !== 'mcv' &&
        !e.dead
    );
    const armySize = combatUnits.length;
    // Require a larger army (5+ units) before we consider it "significant" enough to avoid panic selling
    // With a real army, the AI should fight, not sell buildings
    const hasSignificantArmy = armySize >= 5;

    // Assess threat significance - not just presence but actual danger
    const threatCount = aiState.threatsNearBase.length;
    const isSignificantThreat = threatCount >= 3 || aiState.threatLevel >= 50;

    // Check if enemy army attacking our base is larger than ours
    // Only consider selling when we're truly overwhelmed
    const isOverwhelmedByEnemy = threatCount > armySize && threatCount >= 3;

    // 2. Define Protected Buildings
    // Protect defense, production (barracks/factory), conyard, and power under normal pressure
    const protectedBuildings = new Set([
        'turret', 'pillbox', 'sam_site', 'obelisk',  // Defense
        'barracks', 'factory',                        // Production
        'conyard',                                    // Construction (recovery potential)
        'power'                                       // Power
    ]);

    let shouldSell = false;
    let candidates: Entity[] = [];

    // ===== PROACTIVE USELESS REFINERY SELLING (Issue #3 Enhancement) =====
    if (!shouldSell) {
        const uselessRefineries = matureBuildings.filter(b =>
            b.key === 'refinery' && !isRefineryUseful(b, _state)
        );

        // Only sell if we have more than one refinery OR the refinery is really useless
        const allRefineries = buildings.filter(b => b.key === 'refinery');
        if (uselessRefineries.length > 0 && allRefineries.length > 1) {
            shouldSell = true;
            candidates = uselessRefineries;
        }
    }

    // Condition C: Stalemate / "Fire Sale" (Aggressive Sell)
    // Priority: tech -> conyard -> excess production -> factory (if has barracks)
    // CRITICAL: Only trigger when truly desperate:
    // - No income and broke (stalemate)
    // - No significant army to fight with
    // - AND base is under attack by a larger force (overwhelmed)
    if (!shouldSell && isStalemate && !hasSignificantArmy && isOverwhelmedByEnemy) {
        const hasBarracks = hasProductionBuildingFor('infantry', buildings);

        // Count production buildings to identify excess
        const barracksCount = matureBuildings.filter(b => b.key === 'barracks').length;
        const factoryCount = matureBuildings.filter(b => b.key === 'factory').length;

        candidates = matureBuildings.filter(b => {
            // Always allow selling tech
            if (b.key === 'tech') return true;
            // Never sell conyard in stalemate - keep for recovery potential
            // (Last Resort will handle truly desperate situations)
            if (b.key === 'conyard') return false;
            // Sell excess barracks (keep at least 1)
            if (b.key === 'barracks' && barracksCount > 1) return true;
            // Sell excess factories (keep at least 1)
            if (b.key === 'factory' && factoryCount > 1) return true;
            // Sell factory if we have barracks (can still produce infantry)
            if (b.key === 'factory' && hasBarracks) return true;
            // Protect defense and power
            if (protectedBuildings.has(b.key)) return false;
            // Never sell refinery (needed for income recovery)
            if (b.key === 'refinery') return false;
            return true;
        });

        if (candidates.length > 0) {
            shouldSell = true;
            // Priority: tech, excess barracks, factory
            const stalematePriority = ['tech', 'barracks', 'factory'];
            candidates.sort((a, b) => {
                const idxA = getPriorityIndex(a.key, stalematePriority);
                const idxB = getPriorityIndex(b.key, stalematePriority);
                if (idxA !== idxB) return idxA - idxB;
                return 0;
            });
        }
    }

    // Condition D: Sell Useless Refineries Under Attack (damaged + useless)
    if (!shouldSell) {
        const uselessDamagedRefinery = matureBuildings.find(b =>
            b.key === 'refinery' &&
            b.hp < b.maxHp &&
            !isRefineryUseful(b, _state)
        );

        if (uselessDamagedRefinery) {
            shouldSell = true;
            candidates = [uselessDamagedRefinery];
        }
    }

    // Condition A: Critical Low Funds (Classic Emergency)
    // REWORKED: Only trigger when under SIGNIFICANT threat AND we lack army to defend
    const criticalLow = player.credits <= 200;
    const underAttack = aiState.threatsNearBase.length > 0 || aiState.harvestersUnderAttack.length > 0;

    // Emergency sell requires:
    // 1. Very low credits (<=50) OR (low credits AND significant threat AND no army to defend)
    // If we have an army, let them fight - don't panic sell
    const isRealEmergency = player.credits <= 50 ||
        (criticalLow && isSignificantThreat && !hasSignificantArmy);

    if (!shouldSell && isRealEmergency && underAttack) {
        shouldSell = true;
        // Use protected buildings set - only sell tech, conyard, and useless refineries
        candidates = matureBuildings.filter(b => {
            if (protectedBuildings.has(b.key)) return false;
            if (b.key === 'refinery') return !isRefineryUseful(b, _state);
            return true;
        });
        candidates.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    }

    // Condition B: Need Refinery (Strategic Sell)
    // Priority: tech -> excess production buildings -> factory (if has barracks)
    if (!shouldSell && needsRefinery) {
        shouldSell = true;

        // Count production buildings to identify excess
        const barracksCount = matureBuildings.filter(b => b.key === 'barracks').length;
        const factoryCount = matureBuildings.filter(b => b.key === 'factory').length;
        const hasBarracks = barracksCount > 0;

        candidates = matureBuildings.filter(b => {
            // Always allow selling tech
            if (b.key === 'tech') return true;
            // Sell excess barracks (keep at least 1)
            if (b.key === 'barracks' && barracksCount > 1) return true;
            // Sell excess factories (keep at least 1)
            if (b.key === 'factory' && factoryCount > 1) return true;
            // Sell factory if we have barracks (can still produce infantry)
            if (b.key === 'factory' && hasBarracks) return true;
            // Protect everything else
            if (protectedBuildings.has(b.key)) return false;
            if (b.key === 'conyard') return false;
            if (b.key === 'refinery') return false;
            return true;
        });

        // Priority: tech first, then excess production, then factory
        const refineryPriority = ['tech', 'barracks', 'factory'];
        candidates.sort((a, b) => {
            const idxA = getPriorityIndex(a.key, refineryPriority);
            const idxB = getPriorityIndex(b.key, refineryPriority);
            if (idxA !== idxB) return idxA - idxB;
            const costA = RULES.buildings[a.key]?.cost || 0;
            const costB = RULES.buildings[b.key]?.cost || 0;
            return costB - costA;
        });
    }

    if (shouldSell && candidates.length > 0) {
        const toSell = candidates[0];
        aiState.lastSellTick = _state.tick; // Update cooldown tracker
        actions.push({
            type: 'SELL_BUILDING',
            payload: {
                buildingId: toSell.id,
                playerId
            }
        });
    }

    return actions;
}

/**
 * Last Resort Mode: When the AI has no army, is under attack, has no income,
 * and cannot produce anything, sell everything except barracks and power
 * to fund a desperate infantry spam.
 */
export function handleLastResortSell(
    state: GameState,
    playerId: number,
    buildings: Entity[],
    player: PlayerState,
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];
    const LAST_RESORT_CREDIT_THRESHOLD = 100;

    // All conditions must be true:
    // 1. Very low credits
    if (player.credits >= LAST_RESORT_CREDIT_THRESHOLD) return actions;

    // 2. Under attack
    if (aiState.threatsNearBase.length === 0) return actions;

    // 3. No combat units (no army)
    const combatUnits = Object.values(state.entities).filter(e =>
        e.owner === playerId &&
        e.type === 'UNIT' &&
        e.key !== 'harvester' &&
        e.key !== 'mcv' &&
        !e.dead
    );
    if (combatUnits.length > 0) return actions;

    // 4. No income (no harvesters OR no refinery)
    const harvesters = Object.values(state.entities).filter(e =>
        e.owner === playerId && e.key === 'harvester' && !e.dead
    );
    const hasRefinery = buildings.some(b => b.key === 'refinery' && !b.dead);
    if (harvesters.length > 0 && hasRefinery) return actions;

    // 5. Has barracks (can produce infantry to make use of funds)
    if (!hasProductionBuildingFor('infantry', buildings)) return actions;

    // === LAST RESORT MODE ===
    const LAST_RESORT_SELL_COOLDOWN = 30; // Faster selling in last resort (0.5s)
    if (state.tick - aiState.lastSellTick < LAST_RESORT_SELL_COOLDOWN) return actions;

    const BUILDING_GRACE_PERIOD = 300;
    const matureBuildings = buildings.filter(b => {
        const bldEntity = b as BuildingEntity;
        const age = state.tick - (bldEntity.building.placedTick || 0);
        return age >= BUILDING_GRACE_PERIOD;
    });

    // Keep only barracks and power
    const keepInLastResort = new Set(['barracks', 'power']);
    // Sell highest value buildings first for quicker cash
    const sellOrder = ['conyard', 'tech', 'factory', 'refinery', 'turret', 'pillbox', 'sam_site', 'obelisk'];

    const candidates = matureBuildings.filter(b => !b.dead && !keepInLastResort.has(b.key));
    if (candidates.length === 0) return actions;

    candidates.sort((a, b) => {
        const idxA = getPriorityIndex(a.key, sellOrder);
        const idxB = getPriorityIndex(b.key, sellOrder);
        if (idxA !== idxB) return idxA - idxB;
        // Secondary: sell more damaged buildings first (less refund lost)
        return (a.hp / a.maxHp) - (b.hp / b.maxHp);
    });

    const toSell = candidates[0];
    aiState.lastSellTick = state.tick;

    actions.push({
        type: 'SELL_BUILDING',
        payload: { buildingId: toSell.id, playerId }
    });

    return actions;
}

export function handleAllInSell(
    state: GameState,
    playerId: number,
    buildings: Entity[],
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];

    // Only run in all_in mode
    if (aiState.strategy !== 'all_in' || aiState.allInStartTick === 0) {
        return actions;
    }

    // Respect sell cooldown
    const SELL_COOLDOWN = 60; // 1 second cooldown for all_in (faster than normal)
    if (state.tick - aiState.lastSellTick < SELL_COOLDOWN) {
        return actions;
    }

    const ticksInAllIn = state.tick - aiState.allInStartTick;

    // Define building categories for each phase
    const defenseBuildings = ['turret', 'pillbox', 'sam_site', 'obelisk'];
    const economyBuildings = ['tech', 'power', 'refinery'];
    const productionBuildings = ['factory', 'barracks', 'conyard'];

    let candidates: Entity[] = [];

    // Phase 3: Sell EVERYTHING (self-elimination) - but ONLY if we have no combat units left
    if (ticksInAllIn >= ALL_IN_PHASE3_TICKS) {
        // Check if we still have combat units - if so, don't self-eliminate!
        const hasCombatUnits = Object.values(state.entities).some(e =>
            e.owner === playerId && e.type === 'UNIT' &&
            e.key !== 'harvester' && e.key !== 'mcv' && !e.dead
        );
        if (!hasCombatUnits) {
            // Sell all buildings, including production - this is the end
            candidates = buildings.filter(b => !b.dead);
            // Sort by cost (sell cheapest first to keep production going as long as possible)
            candidates.sort((a, b) => {
                const costA = RULES.buildings[a.key]?.cost || 0;
                const costB = RULES.buildings[b.key]?.cost || 0;
                return costA - costB;
            });
        }
    }
    // Phase 2: Sell economy/support buildings
    else if (ticksInAllIn >= ALL_IN_PHASE2_TICKS) {
        candidates = buildings.filter(b =>
            !b.dead && (economyBuildings.includes(b.key) || defenseBuildings.includes(b.key))
        );
        // Keep at least 1 power plant if we still have production
        const hasProduction = buildings.some(b => productionBuildings.includes(b.key) && !b.dead);
        if (hasProduction) {
            const powerPlants = candidates.filter(b => b.key === 'power');
            if (powerPlants.length === 1) {
                candidates = candidates.filter(b => b.key !== 'power');
            }
        }
    }
    // Phase 1: Sell defense buildings only
    else if (ticksInAllIn >= ALL_IN_PHASE1_TICKS) {
        candidates = buildings.filter(b => !b.dead && defenseBuildings.includes(b.key));
    }

    if (candidates.length > 0) {
        const toSell = candidates[0];
        aiState.lastSellTick = state.tick;
        actions.push({
            type: 'SELL_BUILDING',
            payload: {
                buildingId: toSell.id,
                playerId
            }
        });
    }

    return actions;
}

export function handleBuildingPlacement(
    state: GameState,
    playerId: number,
    buildings: Entity[],
    player: PlayerState
): Action[] {
    const actions: Action[] = [];
    const key = player.readyToPlace;
    if (!key) return actions;

    const buildingData = RULES.buildings[key];
    if (!buildingData) {
        actions.push({ type: 'CANCEL_BUILD', payload: { category: 'building', playerId } });
        return actions;
    }

    // EARLY CHECK: Cancel build if player has no non-defense buildings
    const nonDefenseBuildings = buildings.filter(b => {
        const bData = RULES.buildings[b.key];
        return !bData?.isDefense;
    });

    if (nonDefenseBuildings.length === 0) {
        actions.push({ type: 'CANCEL_BUILD', payload: { category: 'building', playerId } });
        return actions;
    }

    const conyard = buildings.find(b => b.key === 'conyard') || buildings[0];
    const center = conyard ? conyard.pos : new Vector(300, 300);

    // Find the building that extends furthest from base (for expansion)
    let expansionFront: Vector = center;
    for (const b of buildings) {
        const bData = RULES.buildings[b.key];
        if (bData?.isDefense) continue;
        const dist = b.pos.dist(center);
        if (dist > expansionFront.dist(center)) {
            expansionFront = b.pos;
        }
    }

    // Check if there's distant ore worth expanding towards
    const resources = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
    let distantOreTarget: Vector | null = null;
    const BUILD_RADIUS = 400;

    for (const ore of resources) {
        // Check if ore is beyond current build range but within 1500 units
        let inRange = false;
        for (const b of buildings) {
            const bData = RULES.buildings[b.key];
            if (bData?.isDefense) continue;
            if (ore.pos.dist(b.pos) < BUILD_RADIUS + 200) {
                inRange = true;
                break;
            }
        }

        // Check if any refinery already claims this ore
        const hasNearbyRefinery = Object.values(state.entities).some(e =>
            e.type === 'BUILDING' && e.key === 'refinery' && !e.dead && e.pos.dist(ore.pos) < 200
        );

        if (!inRange && !hasNearbyRefinery && ore.pos.dist(center) < 1500) {
            if (!distantOreTarget || ore.pos.dist(center) < distantOreTarget.dist(center)) {
                distantOreTarget = ore.pos;
            }
        }
    }

    // Candidates for placement
    let bestSpot: { x: number, y: number } | null = null;
    let bestScore = -Infinity;

    // Strategies based on building type
    let searchCenter = center;
    let searchRadiusMin = 100;
    let searchRadiusMax = 300;
    let expandingTowardsOre = false;

    if (key === 'refinery') {
        let bestOre: Entity | null = null;
        let minDist = Infinity;
        const MAX_ORE_DISTANCE = 550; // Max distance from ore to nearby building

        // Get non-defense buildings for distance calculation
        const nonDefenseBuildings2 = buildings.filter(b => {
            const bData = RULES.buildings[b.key];
            return !bData?.isDefense;
        });

        for (const ore of resources) {
            let minDistToBuilding = Infinity;
            for (const b of nonDefenseBuildings2) {
                const d = ore.pos.dist(b.pos);
                if (d < minDistToBuilding) minDistToBuilding = d;
            }

            if (minDistToBuilding > MAX_ORE_DISTANCE) continue;

            const allEntities = Object.values(state.entities);
            const hasRefinery = allEntities.some(b =>
                b.type === 'BUILDING' &&
                b.key === 'refinery' &&
                !b.dead &&
                b.pos.dist(ore.pos) < 200
            );

            let effectiveDist = minDistToBuilding;
            if (hasRefinery) effectiveDist += 5000; // Strongly avoid already-claimed ore

            if (effectiveDist < minDist) {
                minDist = effectiveDist;
                bestOre = ore;
            }
        }

        if (bestOre) {
            searchCenter = bestOre.pos;
            searchRadiusMin = 80;
            searchRadiusMax = 180;
        }
    } else if (key === 'barracks' || key === 'factory') {
        searchRadiusMin = 120;
        searchRadiusMax = 350;
    } else if (key === 'power' && distantOreTarget) {
        // Power plants can be used for "building walk" expansion towards distant ore
        // BUT only if we don't already have too many power plants
        const existingPowerPlants = buildings.filter(b => b.key === 'power').length;
        const MAX_POWER_FOR_EXPANSION = 5;

        if (existingPowerPlants < MAX_POWER_FOR_EXPANSION) {
            const dirToOre = distantOreTarget.sub(expansionFront).norm();
            searchCenter = expansionFront.add(dirToOre.scale(150));
            searchRadiusMin = 80;
            searchRadiusMax = 250;
            expandingTowardsOre = true;
        }
    } else if (buildingData.isDefense) {
        // === STRATEGIC DEFENSIVE BUILDING PLACEMENT ===
        const aiState = getAIState(playerId);
        const refineries = buildings.filter(b => b.key === 'refinery');
        const existingDefenses = buildings.filter(b => {
            const bd = RULES.buildings[b.key];
            return bd?.isDefense;
        });

        // Strategy 1: Place between base and enemy (if known)
        if (aiState.enemyBaseLocation) {
            const dirToEnemy = aiState.enemyBaseLocation.sub(center).norm();
            searchCenter = center.add(dirToEnemy.scale(250));
            searchRadiusMin = 100;
            searchRadiusMax = 200;
        }

        // Strategy 2: If we have refineries, prioritize protecting them
        if (refineries.length > 0) {
            // Find refinery with least nearby defenses
            let leastDefendedRefinery: Entity | null = null;
            let minDefenses = Infinity;

            for (const ref of refineries) {
                const nearbyDefenses = existingDefenses.filter(d =>
                    d.pos.dist(ref.pos) < 300
                ).length;

                if (nearbyDefenses < minDefenses) {
                    minDefenses = nearbyDefenses;
                    leastDefendedRefinery = ref;
                }
            }

            if (leastDefendedRefinery && minDefenses < 2) {
                searchCenter = leastDefendedRefinery.pos;
                searchRadiusMin = 80;
                searchRadiusMax = 200;
            }
        }
    }

    // Try multiple spots
    const attempts = 50;
    for (let i = 0; i < attempts; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = searchRadiusMin + Math.random() * (searchRadiusMax - searchRadiusMin);
        const x = searchCenter.x + Math.cos(ang) * dist;
        const y = searchCenter.y + Math.sin(ang) * dist;

        if (isValidPlacement(x, y, buildingData.w, buildingData.h, state, buildings, key)) {
            let score = 0;

            const distToCenter = new Vector(x, y).dist(searchCenter);
            if (key === 'refinery') {
                score -= distToCenter;
            } else if (expandingTowardsOre && distantOreTarget) {
                // Prefer spots closer to distant ore (expansion)
                score -= new Vector(x, y).dist(distantOreTarget) * 0.8;
                score += new Vector(x, y).dist(center) * 0.2;
            } else if (buildingData.isDefense) {
                // ===== IMPROVED DEFENSE PLACEMENT (Issue #8) =====
                const aiState = getAIState(playerId);
                const spotPos = new Vector(x, y);

                // Get existing defenses for spacing check
                const existingDefenses = buildings.filter(b => {
                    const bd = RULES.buildings[b.key];
                    return bd?.isDefense;
                });

                // ===== STRICT SPACING: Minimum 200 units apart =====
                let tooClose = false;
                for (const def of existingDefenses) {
                    const distToDefense = def.pos.dist(spotPos);
                    if (distToDefense < 200) {
                        score -= (200 - distToDefense) * 5; // Heavy penalty
                        if (distToDefense < 100) {
                            tooClose = true; // Reject completely
                        }
                    }
                }
                if (tooClose) continue; // Skip this spot entirely

                // ===== COVERAGE ANGLE: Prefer covering new directions =====
                if (existingDefenses.length > 0) {
                    const spotAngle = Math.atan2(spotPos.y - center.y, spotPos.x - center.x);
                    let minAngleDiff = Infinity;
                    for (const def of existingDefenses) {
                        const defAngle = Math.atan2(def.pos.y - center.y, def.pos.x - center.x);
                        let angleDiff = Math.abs(spotAngle - defAngle);
                        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                        if (angleDiff < minAngleDiff) minAngleDiff = angleDiff;
                    }

                    if (minAngleDiff > Math.PI / 4) {
                        score += minAngleDiff * 30;
                    }
                }

                // Enemy base direction bonus
                if (aiState.enemyBaseLocation) {
                    const toEnemy = aiState.enemyBaseLocation.sub(center).norm();
                    const spotDir = spotPos.sub(center).norm();
                    const alignment = toEnemy.dot(spotDir);
                    score += alignment * 50;
                }

                // Bonus for being near refineries (protecting economy)
                const refineries = buildings.filter(b => b.key === 'refinery');
                for (const ref of refineries) {
                    const distToRef = ref.pos.dist(spotPos);
                    if (distToRef < 300 && distToRef > 100) {
                        score += 80;
                    } else if (distToRef < 100) {
                        score -= 30;
                    }
                }

                // Moderate distance from base center (150-300 is ideal)
                const distFromCenter = spotPos.dist(center);
                if (distFromCenter > 150 && distFromCenter < 300) {
                    score += 30;
                } else {
                    score -= Math.abs(distFromCenter - 225) * 0.2;
                }
            } else {
                score -= new Vector(x, y).dist(center) * 0.5;
            }

            // Margin/Spacing preference
            let nearestBldgDist = Infinity;
            for (const b of buildings) {
                const d = b.pos.dist(new Vector(x, y));
                if (d < nearestBldgDist) nearestBldgDist = d;
            }
            if (nearestBldgDist < 80) score -= (80 - nearestBldgDist) * 2;

            if (score > bestScore) {
                bestScore = score;
                bestSpot = { x, y };
            }
        }
    }

    if (bestSpot) {
        actions.push({
            type: 'PLACE_BUILDING',
            payload: { key: key, x: bestSpot.x, y: bestSpot.y, playerId }
        });
    }

    return actions;
}

export function handleBuildingRepair(
    _state: GameState,
    playerId: number,
    buildings: Entity[],
    player: PlayerState,
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];

    // Don't repair if we're in a critical emergency (low funds, under attack)
    if (player.credits < 500 && aiState.threatsNearBase.length > 0) {
        return actions;
    }

    // Define repair thresholds and priorities
    const repairPriorities: { [key: string]: { threshold: number; priority: number } } = {
        'conyard': { threshold: 0.7, priority: 1 },
        'refinery': { threshold: 0.6, priority: 2 },
        'factory': { threshold: 0.5, priority: 3 },
        'barracks': { threshold: 0.5, priority: 4 },
        'service_depot': { threshold: 0.5, priority: 5 },
        'power': { threshold: 0.4, priority: 6 },
        'turret': { threshold: 0.4, priority: 7 },
        'pillbox': { threshold: 0.4, priority: 8 },
        'sam_site': { threshold: 0.4, priority: 9 },
    };

    const damagedBuildings: { entity: Entity; priority: number; threshold: number }[] = [];

    for (const building of buildings) {
        if (building.dead) continue;

        const hpRatio = building.hp / building.maxHp;
        const repairConfig = repairPriorities[building.key] || { threshold: 0.3, priority: 10 };

        const bldEntity = building as BuildingEntity;
        if (hpRatio < repairConfig.threshold && !bldEntity.building.isRepairing) {
            // Skip non-essential refineries (far from ore)
            if (building.key === 'refinery' && !isRefineryUseful(building, _state)) {
                continue;
            }

            damagedBuildings.push({
                entity: building,
                priority: repairConfig.priority,
                threshold: repairConfig.threshold
            });
        }
    }

    if (damagedBuildings.length === 0) {
        return actions;
    }

    damagedBuildings.sort((a, b) => a.priority - b.priority);

    const currentlyRepairing = buildings.filter(b => (b as BuildingEntity).building.isRepairing).length;
    const maxConcurrentRepairs = player.credits > 2000 ? 2 : 1;
    const underAttack = aiState.threatsNearBase.length > 0;
    const wealthyEnough = player.credits > 1000;
    const veryWealthy = player.credits > 2000;

    for (const damaged of damagedBuildings) {
        if (currentlyRepairing >= maxConcurrentRepairs) break;

        const isProduction = ['conyard', 'refinery', 'factory', 'barracks'].includes(damaged.entity.key);
        const isDefense = ['turret', 'pillbox', 'sam_site'].includes(damaged.entity.key);
        const isPower = damaged.entity.key === 'power';

        let shouldRepair = false;

        if (isProduction && wealthyEnough) shouldRepair = true;
        if (isDefense && !underAttack && wealthyEnough) shouldRepair = true;
        if (isPower && damaged.entity.hp / damaged.entity.maxHp < 0.3 && wealthyEnough) shouldRepair = true;
        if (veryWealthy && damaged.entity.hp / damaged.entity.maxHp < 0.2) shouldRepair = true;

        if (shouldRepair) {
            actions.push({
                type: 'START_REPAIR',
                payload: {
                    buildingId: damaged.entity.id,
                    playerId
                }
            });
        }
    }

    return actions;
}

export function handleMCVOperations(
    state: GameState,
    playerId: number,
    _aiState: AIPlayerState,
    myBuildings: Entity[],
    myUnits: Entity[]
): Action[] {
    const actions: Action[] = [];

    const mcvs = myUnits.filter(u => u.key === 'mcv' && !u.dead);
    if (mcvs.length === 0) return actions;

    const BUILD_RADIUS = 400;
    const MAX_BASES = 2;
    const baseCenter = findBaseCenter(myBuildings);

    // Find expansion location - distant ore that needs a new base
    const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
    let bestExpansionTarget: Vector | null = null;
    let bestScore = -Infinity;

    for (const ore of allOre) {
        // Check if ore is covered by existing buildings
        let inBuildRange = false;
        for (const b of myBuildings) {
            const bData = RULES.buildings[b.key];
            if (bData?.isDefense) continue;
            if (ore.pos.dist(b.pos) < BUILD_RADIUS + 200) {
                inBuildRange = true;
                break;
            }
        }
        if (inBuildRange) continue;

        // Check if ore has nearby enemy presence (dangerous)
        let nearbyEnemyThreats = 0;
        for (const e of Object.values(state.entities)) {
            if (e.owner !== playerId && e.owner !== -1 && !e.dead) {
                if (e.pos.dist(ore.pos) < 500) nearbyEnemyThreats++;
            }
        }
        if (nearbyEnemyThreats > 2) continue;

        const distFromBase = ore.pos.dist(baseCenter);
        if (distFromBase > 600 && distFromBase < 1500) {
            const score = 1000 - distFromBase - nearbyEnemyThreats * 100;
            if (score > bestScore) {
                bestScore = score;
                bestExpansionTarget = ore.pos;
            }
        }
    }

    const hasConyard = myBuildings.some(b => b.key === 'conyard');
    const currentConyards = myBuildings.filter(b => b.key === 'conyard').length;
    let deploymentQueuedThisTick = false;

    for (const mcv of mcvs) {
        const mcvUnit = mcv as UnitEntity;
        const CONYARD_RADIUS = 45;

        // Helper to check if MCV can deploy at a position
        const canDeployAt = (pos: Vector): boolean => {
            if (pos.x < CONYARD_RADIUS || pos.x > state.config.width - CONYARD_RADIUS ||
                pos.y < CONYARD_RADIUS || pos.y > state.config.height - CONYARD_RADIUS) {
                return false;
            }

            for (const e of Object.values(state.entities)) {
                if (e.dead || e.id === mcv.id) continue;
                if (e.type === 'BUILDING' || e.type === 'ROCK' || e.type === 'RESOURCE' || e.type === 'WELL') {
                    const combinedRadius = CONYARD_RADIUS + e.radius;
                    if (e.pos.dist(pos) < combinedRadius * 0.9) {
                        return false;
                    }
                }
            }
            return true;
        };

        // Helper to find a valid deployment position near a target using spiral search
        const findDeployPosition = (center: Vector, maxSearchRadius: number = 200): Vector | null => {
            if (canDeployAt(center)) return center;
            const step = 40;
            for (let radius = step; radius <= maxSearchRadius; radius += step) {
                for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                    const testPos = new Vector(
                        center.x + Math.cos(angle) * radius,
                        center.y + Math.sin(angle) * radius
                    );
                    if (canDeployAt(testPos)) return testPos;
                }
            }
            return null;
        };

        // PRIORITY 1: If we have no conyard, deploy immediately (emergency)
        if (!hasConyard && !deploymentQueuedThisTick) {
            const deployPos = findDeployPosition(mcv.pos, 300);
            if (deployPos) {
                if (deployPos.dist(mcv.pos) < 20) {
                    actions.push({ type: 'DEPLOY_MCV', payload: { unitId: mcv.id } });
                    deploymentQueuedThisTick = true;
                } else {
                    actions.push({
                        type: 'COMMAND_MOVE',
                        payload: { unitIds: [mcv.id], x: deployPos.x, y: deployPos.y }
                    });
                }
            }
            continue;
        }

        const atMaxBases = (currentConyards + (deploymentQueuedThisTick ? 1 : 0)) >= MAX_BASES;

        // PRIORITY 2: If MCV has no destination, assign expansion target
        if (!mcvUnit.movement.moveTarget && !mcvUnit.movement.finalDest && bestExpansionTarget && !atMaxBases) {
            const deployPos = findDeployPosition(bestExpansionTarget.add(new Vector(100, 0)), 250);
            if (deployPos) {
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: { unitIds: [mcv.id], x: deployPos.x, y: deployPos.y }
                });
            }
            continue;
        }

        // PRIORITY 3: If MCV is near its destination, try to deploy
        if (mcvUnit.movement.finalDest && mcv.pos.dist(mcvUnit.movement.finalDest) < 100 && !atMaxBases) {
            const deployPos = findDeployPosition(mcv.pos, 200);
            if (deployPos) {
                if (deployPos.dist(mcv.pos) < 20) {
                    actions.push({ type: 'DEPLOY_MCV', payload: { unitId: mcv.id } });
                    deploymentQueuedThisTick = true;
                } else {
                    actions.push({
                        type: 'COMMAND_MOVE',
                        payload: { unitIds: [mcv.id], x: deployPos.x, y: deployPos.y }
                    });
                }
            }
            continue;
        }

        // PRIORITY 4: Emergency deployment - only deploy idle MCV if we have NO conyard at all
        if (!mcvUnit.movement.moveTarget && !mcvUnit.movement.finalDest && !bestExpansionTarget) {
            if (!hasConyard) {
                const deployPos = findDeployPosition(mcv.pos, 200);
                if (deployPos) {
                    if (deployPos.dist(mcv.pos) < 20) {
                        actions.push({ type: 'DEPLOY_MCV', payload: { unitId: mcv.id } });
                    } else {
                        actions.push({
                            type: 'COMMAND_MOVE',
                            payload: { unitIds: [mcv.id], x: deployPos.x, y: deployPos.y }
                        });
                    }
                }
            }
        }
    }

    return actions;
}

export function handleHarvesterGathering(
    state: GameState,
    _playerId: number,
    harvesters: Entity[],
    harvestersUnderAttack: string[]
): Action[] {
    const actions: Action[] = [];

    for (const harvester of harvesters) {
        if (harvester.dead) continue;

        // Skip if under attack - safety logic will handle this
        if (harvestersUnderAttack.includes(harvester.id)) continue;

        const h = harvester as HarvesterUnit;

        // Check if idle:
        // 1. Not moving
        // 2. No resource target (not gathering)
        // 3. No base target (not returning)
        if (!h.movement.moveTarget && !h.harvester.resourceTargetId && !h.harvester.baseTargetId) {

            // Recovery logic: Find nearest ore and gather
            // This also fixes manualMode if it was set
            const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);

            let bestOre: Entity | null = null;
            let minDist = Infinity;

            for (const ore of allOre) {
                const d = harvester.pos.dist(ore.pos);
                if (d < minDist) {
                    minDist = d;
                    bestOre = ore;
                }
            }

            if (bestOre) {
                actions.push({
                    type: 'COMMAND_ATTACK',
                    payload: {
                        unitIds: [harvester.id],
                        targetId: bestOre.id
                    }
                });
            }
        }
    }
    return actions;
}

/**
 * Handle Induction Rig operations: Move rigs to unoccupied wells and deploy them.
 * Induction rigs provide stable macro income by siphoning wells at 80% efficiency.
 */
export function handleInductionRigOperations(
    state: GameState,
    _playerId: number,
    myBuildings: Entity[],
    myUnits: Entity[]
): Action[] {
    const actions: Action[] = [];

    // Find all mobile induction rigs for this player
    const rigs = myUnits.filter(u => u.key === 'induction_rig' && !u.dead);
    if (rigs.length === 0) return actions;

    // Get accessible unoccupied wells
    const unoccupiedWells = getUnoccupiedWells(state);
    const nonDefenseBuildings = getNonDefenseBuildings(myBuildings);
    const accessibleWells = getAccessibleWells(unoccupiedWells, nonDefenseBuildings, 1500);

    if (accessibleWells.length === 0 && rigs.length > 0) {
        // No accessible wells - rigs may need to wait or be repurposed
        return actions;
    }

    // Track which wells are being targeted by other rigs this tick
    const targetedWells = new Set<string>();

    for (const rig of rigs) {
        const rigUnit = rig as UnitEntity;

        // Find the nearest unoccupied well that isn't already being targeted
        let bestWell: Entity | null = null;
        let minDist = Infinity;

        for (const well of accessibleWells) {
            if (targetedWells.has(well.id)) continue;

            const dist = rig.pos.dist(well.pos);
            if (dist < minDist) {
                minDist = dist;
                bestWell = well;
            }
        }

        if (!bestWell) continue;

        // Mark this well as targeted
        targetedWells.add(bestWell.id);

        // Deployment distance - how close the rig needs to be to deploy
        const DEPLOY_DISTANCE = 60;

        if (minDist <= DEPLOY_DISTANCE) {
            // Close enough to deploy
            actions.push({
                type: 'DEPLOY_INDUCTION_RIG',
                payload: { unitId: rig.id, wellId: bestWell.id }
            });
        } else if (!rigUnit.movement.moveTarget && !rigUnit.movement.finalDest) {
            // Not moving - command to move to the well
            actions.push({
                type: 'COMMAND_MOVE',
                payload: { unitIds: [rig.id], x: bestWell.pos.x, y: bestWell.pos.y }
            });
        } else if (rigUnit.movement.finalDest) {
            // Check if already moving toward this well
            const destDist = rigUnit.movement.finalDest.dist(bestWell.pos);
            if (destDist > 100) {
                // Moving toward wrong location - redirect to well
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: { unitIds: [rig.id], x: bestWell.pos.x, y: bestWell.pos.y }
                });
            }
        }
    }

    return actions;
}

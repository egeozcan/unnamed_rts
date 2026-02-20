import { GameState, Action, Entity, Vector, isActionType } from '../../../types.js';
import { createEntityCache, EntityCache, getEnemiesOf, getBuildingsForOwner, getUnitsForOwner } from '../../../perf.js';
import {
    getAIState,
    resetAIState,
    findBaseCenter,
    updateEnemyBaseLocation,
    updateEnemyIntelligence,
    updateVengeance
} from '../../state.js';
import {
    AI_CONSTANTS,
    hasProductionBuildingFor,
    checkPrerequisites
} from '../../utils.js';
import {
    detectThreats,
    updateStrategy,
    evaluateInvestmentPriority
} from '../../planning.js';
import {
    handleEconomy,
    handleEmergencySell,
    handleLastResortSell,
    handleAllInSell,
    handleBuildingPlacement,
    handleBuildingRepair,
    handleMCVOperations,
    handleHarvesterGathering,
    handleInductionRigOperations
} from '../../action_economy.js';
import {
    handleAttack,
    handleDefense,
    handleHarass,
    handleRally,
    handleScouting,
    handleMicro,
    handleHarvesterSafety,
    handleHarvesterSuicideAttack,
    handleAirStrikes,
    handleDemoTruckAssault,
    handleUnitRepair,
    handleEngineerCapture,
    handleHijackerAssault
} from '../../action_combat.js';
import { updateHarvesterAI } from '../../harvester/index.js';
import { AIImplementation } from '../../contracts.js';
import { AIPersonality, RULES } from '../../../../data/schemas/index.js';

// ============================================================================
// Hydra AI - Adaptive multi-pronged strategy
//
// Philosophy: Fast economy into relentless dual-production pressure.
// Never let production buildings idle. Attack early & often. Adapt to enemy.
// ============================================================================

const NON_COMBAT_UNIT_KEYS = new Set(['harvester', 'mcv', 'engineer', 'induction_rig', 'demo_truck', 'hijacker']);

function isCombatUnitKey(key: string): boolean {
    if (NON_COMBAT_UNIT_KEYS.has(key)) return false;
    const unitData = RULES.units[key];
    return Boolean(unitData && unitData.damage > 0);
}

// --- Hydra Personality ---
// Aggressive economy with early pressure. Key insight: 2 refineries early gives
// massive income advantage. Then constant dual-lane production overwhelms.
const titanPersonality: AIPersonality = {
    aggression_bias: 1.5,          // Very aggressive
    retreat_threshold: 0.15,       // Fight harder before retreating
    attack_threshold: 3,           // Attack immediately when threshold reached
    harass_threshold: 2,           // Harass early with just 2 fast units
    rally_offset: 150,             // Rally closer to frontline
    build_order_priority: [
        'power', 'refinery', 'barracks', 'factory', 'refinery', 'power'
    ],
    unit_preferences: {
        infantry: ['rocket', 'rocket', 'grenadier'], // Heavy anti-armor bias
        vehicle: ['heavy', 'heavy', 'artillery']     // Heavy armor bias
    },
    harvester_ratio: 1.6,         // Lean econ
    credit_buffer: 50,             // Spend almost everything
    kite_aggressiveness: 0.8,      // Better kiting
    defense_investment: 0,         // Zero defense buildings - army IS the defense
    max_chase_distance: 700,       // Chase down fleeing enemies
    min_attack_group_size: 3,      // Form groups of 3
    max_attack_group_size: 30      // But can form large deathballs too
};

// --- Rush Detection Constants ---
const RUSH_MIN_TICK = 600;        // 10 seconds
const RUSH_MIN_COMBAT_UNITS = 3;
const RUSH_VENGEANCE_BOOST = 250;
const BOOM_RUSH_MIN_TICK = 900;   // 15 seconds - faster detection
const BOOM_RUSH_MIN_BOOM_SCORE = 25;
const BOOM_RUSH_VENGEANCE_BOOST = 225;

// --- Dual Production Constants ---
const INFANTRY_PRIORITY: Record<string, string[]> = {
    mixed: ['rocket', 'grenadier', 'rifle'],
    infantry: ['grenadier', 'rocket', 'flamer'],      // splash vs infantry
    heavy: ['rocket', 'rocket', 'grenadier'],       // anti-armor
    light: ['rocket', 'grenadier', 'rifle']         // general purpose
};

const VEHICLE_PRIORITY: Record<string, string[]> = {
    mixed: ['heavy', 'light', 'flame_tank'],
    infantry: ['flame_tank', 'light', 'heavy'],        // flame tanks devastate infantry
    heavy: ['heavy', 'light', 'artillery'],          // heavy vs heavy
    light: ['heavy', 'light', 'flame_tank']          // general
};

// --- Rush Detection ---

type RushTarget = {
    ownerId: number;
    targetPos: Vector;
};

function findRushTarget(
    state: GameState,
    cache: ReturnType<typeof createEntityCache>,
    playerId: number,
    baseCenter: Vector,
    myCombatCount: number,
    aiState: ReturnType<typeof getAIState>
): RushTarget | null {
    if (state.tick < RUSH_MIN_TICK || myCombatCount < RUSH_MIN_COMBAT_UNITS) {
        return null;
    }

    const ownerIds = Array.from(cache.byOwner.keys()).filter(id => id !== playerId && id !== -1);
    let bestTarget: RushTarget | null = null;
    let bestScore = -Infinity;

    for (const ownerId of ownerIds) {
        const enemyBuildings = getBuildingsForOwner(cache, ownerId);
        const enemyUnits = getUnitsForOwner(cache, ownerId);
        if (enemyBuildings.length === 0) continue;

        const enemyCombatUnits = enemyUnits.filter(u => isCombatUnitKey(u.key));
        const enemyDefenses = enemyBuildings.filter(b => Boolean(RULES.buildings[b.key]?.isDefense));

        // Skip well-defended enemies
        if (enemyDefenses.length > 2) continue;

        // Need clear advantage: either no enemy army, or we outnumber significantly
        const hasAdvantage = enemyCombatUnits.length === 0 ||
            (myCombatCount >= enemyCombatUnits.length * 1.3 && myCombatCount >= 3);
        if (!hasAdvantage) continue;

        // Check for eco vulnerability signals
        const enemyRefineries = enemyBuildings.filter(b => b.key === 'refinery').length;
        const enemyHarvesters = enemyUnits.filter(u => u.key === 'harvester').length;
        const boomScore = aiState.enemyIntelligence.boomScores[ownerId] || 0;

        // Greedy: no combat units AND no defenses
        const isGreedy = enemyCombatUnits.length === 0 && enemyDefenses.length === 0;
        // Low defense + booming economy
        const isLowDefense = enemyDefenses.length <= 1 && (
            boomScore >= 20 ||
            enemyRefineries >= 3 ||
            (enemyRefineries >= 2 && enemyHarvesters >= 4)
        );
        // Outmatched: we have 2x their army
        const isOutmatched = enemyCombatUnits.length > 0 &&
            myCombatCount >= enemyCombatUnits.length * 2;

        if (!isGreedy && !isLowDefense && !isOutmatched) continue;

        const primaryTarget =
            enemyBuildings.find(b => b.key === 'conyard') ||
            enemyBuildings.find(b => b.key === 'factory') ||
            enemyBuildings.find(b => b.key === 'barracks') ||
            enemyBuildings.find(b => b.key === 'refinery') ||
            enemyBuildings[0];

        const unitLead = Math.max(0, myCombatCount - enemyCombatUnits.length);
        const greedyBonus = isGreedy ? 150 : 0;
        const outmatchBonus = isOutmatched ? 100 : 0;
        const score = greedyBonus + outmatchBonus + unitLead * 40 + boomScore * 8 -
            enemyDefenses.length * 30 - primaryTarget.pos.dist(baseCenter) * 0.5;

        if (score > bestScore) {
            bestScore = score;
            bestTarget = { ownerId, targetPos: primaryTarget.pos };
        }
    }

    return bestTarget;
}

function findBoomRushTarget(
    state: GameState,
    cache: ReturnType<typeof createEntityCache>,
    playerId: number,
    baseCenter: Vector,
    myCombatCount: number,
    aiState: ReturnType<typeof getAIState>
): RushTarget | null {
    if (state.tick < BOOM_RUSH_MIN_TICK || myCombatCount < RUSH_MIN_COMBAT_UNITS) {
        return null;
    }

    const ownerIds = Array.from(cache.byOwner.keys()).filter(id => id !== playerId && id !== -1);
    let bestTarget: RushTarget | null = null;
    let bestScore = -Infinity;

    for (const ownerId of ownerIds) {
        const boomScore = aiState.enemyIntelligence.boomScores[ownerId] || 0;
        if (boomScore < BOOM_RUSH_MIN_BOOM_SCORE) continue;

        const enemyBuildings = getBuildingsForOwner(cache, ownerId);
        const enemyUnits = getUnitsForOwner(cache, ownerId);
        if (enemyBuildings.length === 0) continue;

        const enemyCombatUnits = enemyUnits.filter(u => isCombatUnitKey(u.key));
        const enemyDefenses = enemyBuildings.filter(b => Boolean(RULES.buildings[b.key]?.isDefense));

        // Must outnumber them
        if (enemyCombatUnits.length >= myCombatCount) continue;
        if (enemyDefenses.length > 2) continue;

        const primaryTarget =
            enemyBuildings.find(b => b.key === 'conyard') ||
            enemyBuildings.find(b => b.key === 'factory') ||
            enemyBuildings.find(b => b.key === 'refinery') ||
            enemyBuildings[0];

        const score = boomScore * 10 - primaryTarget.pos.dist(baseCenter) * 0.5;
        if (score > bestScore) {
            bestScore = score;
            bestTarget = { ownerId, targetPos: primaryTarget.pos };
        }
    }

    return bestTarget;
}

// --- Dual Production Enforcement ---
// The heart of Hydra: NEVER let production buildings idle.

function ensureDualProduction(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    myUnits: Entity[],
    dominantArmor: string
): void {
    const player = state.players[playerId];
    if (!player) return;

    // Infantry production
    if (hasProductionBuildingFor('infantry', myBuildings) &&
        !player.queues.infantry.current &&
        !actions.some(a => isActionType(a, 'START_BUILD') && a.payload.category === 'infantry')) {

        const prefs = INFANTRY_PRIORITY[dominantArmor] || INFANTRY_PRIORITY['mixed'];

        // Count existing special units
        const engineerCount = myUnits.filter(u => u.key === 'engineer' && !u.dead).length;
        const hijackerCount = myUnits.filter(u => u.key === 'hijacker' && !u.dead).length;

        // Occasionally build special units (after early game)
        if (state.tick > 3000 && engineerCount < 1 &&
            checkPrerequisites('engineer', myBuildings) &&
            player.credits >= 700) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'engineer', playerId }
            });
            return;
        }

        if (state.tick > 4000 && hijackerCount < 1 &&
            checkPrerequisites('hijacker', myBuildings) &&
            player.credits >= 800) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'hijacker', playerId }
            });
            return;
        }

        for (const key of prefs) {
            const data = RULES.units[key];
            if (!data) continue;
            if (data.cost > player.credits) continue;
            if (!checkPrerequisites(key, myBuildings)) continue;
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'infantry', key, playerId }
            });
            break;
        }

        // If nothing from prefs was affordable, at least build a rifle (100 credits)
        if (!actions.some(a => isActionType(a, 'START_BUILD') && a.payload.category === 'infantry')) {
            if (player.credits >= 100 && checkPrerequisites('rifle', myBuildings)) {
                actions.push({
                    type: 'START_BUILD',
                    payload: { category: 'infantry', key: 'rifle', playerId }
                });
            }
        }
    }

    // Vehicle production
    if (hasProductionBuildingFor('vehicle', myBuildings) &&
        !player.queues.vehicle.current &&
        !actions.some(a => isActionType(a, 'START_BUILD') && a.payload.category === 'vehicle')) {

        // Check if we need more harvesters
        const refineries = myBuildings.filter(b => b.key === 'refinery' && !b.dead).length;
        const harvesters = myUnits.filter(u => u.key === 'harvester' && !u.dead).length;
        const targetHarvesters = Math.ceil(refineries * 2);

        if (harvesters < targetHarvesters &&
            checkPrerequisites('harvester', myBuildings) &&
            player.credits >= 1400) {
            // Let handleEconomy handle harvester building - don't double up
        } else {
            // Build combat vehicles
            const demoTruckCount = myUnits.filter(u => u.key === 'demo_truck' && !u.dead).length;

            // Demo trucks for breaking defenses (after we have tech chain)
            if (demoTruckCount < 1 &&
                checkPrerequisites('demo_truck', myBuildings) &&
                player.credits >= 1200) {
                actions.push({
                    type: 'START_BUILD',
                    payload: { category: 'vehicle', key: 'demo_truck', playerId }
                });
                return;
            }

            const prefs = VEHICLE_PRIORITY[dominantArmor] || VEHICLE_PRIORITY['mixed'];
            for (const key of prefs) {
                const data = RULES.units[key];
                if (!data) continue;
                if (data.cost > player.credits) continue;
                if (!checkPrerequisites(key, myBuildings)) continue;
                actions.push({
                    type: 'START_BUILD',
                    payload: { category: 'vehicle', key, playerId }
                });
                break;
            }
        }
    }
}

// --- Tech Chain Enforcement ---
// LEAN tech: Only build tech center late-game or when rich. Skip service depot/airforce early.
// Every credit spent on non-combat buildings is a unit we DON'T have.

function ensureTechChain(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    combatUnitCount: number
): void {
    const player = state.players[playerId];
    if (!player) return;
    if (player.queues.building.current) return;
    if (player.readyToPlace) return;

    // Don't double-queue building actions
    const alreadyQueuedBuilding = actions.some(a =>
        isActionType(a, 'START_BUILD') && a.payload.category === 'building'
    );
    if (alreadyQueuedBuilding) return;

    const hasConyard = myBuildings.some(b => b.key === 'conyard' && !b.dead);
    if (!hasConyard) return;

    // Tech center: Only when we have a solid army AND surplus credits
    // Don't sacrifice army momentum for tech
    const hasTech = myBuildings.some(b => b.key === 'tech' && !b.dead);
    if (!hasTech && checkPrerequisites('tech', myBuildings)) {
        const canAffordTech = (state.tick >= 6000 && player.credits >= 2500) ||
            (player.credits >= 4000) ||
            (combatUnitCount >= 12 && player.credits >= 2000);
        if (canAffordTech) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'building', key: 'tech', playerId }
            });
            return;
        }
    }

    // Service depot: Only very late game when rich (repairs are nice-to-have, not essential)
    const hasDepot = myBuildings.some(b => b.key === 'service_depot' && !b.dead);
    if (!hasDepot && state.tick >= 10000 && player.credits >= 4000 &&
        checkPrerequisites('service_depot', myBuildings)) {
        actions.push({
            type: 'START_BUILD',
            payload: { category: 'building', key: 'service_depot', playerId }
        });
        return;
    }

    // Airforce command: Only when truly wealthy and have large army
    const hasAir = myBuildings.some(b => b.key === 'airforce_command' && !b.dead);
    if (!hasAir && state.tick >= 12000 && player.credits >= 5000 && combatUnitCount >= 15 &&
        checkPrerequisites('airforce_command', myBuildings)) {
        actions.push({
            type: 'START_BUILD',
            payload: { category: 'building', key: 'airforce_command', playerId }
        });
    }
}

// --- Extra Power & Refinery Management ---

function ensureInfrastructure(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[]
): void {
    const player = state.players[playerId];
    if (!player) return;
    if (player.queues.building.current) return;
    if (player.readyToPlace) return;

    const alreadyQueuedBuilding = actions.some(a =>
        isActionType(a, 'START_BUILD') && a.payload.category === 'building'
    );
    if (alreadyQueuedBuilding) return;

    const hasConyard = myBuildings.some(b => b.key === 'conyard' && !b.dead);
    if (!hasConyard) return;

    // Check power: if we're power-negative, build more power plants
    const powerBuildings = myBuildings.filter(b => !b.dead);
    let totalPower = 0;
    let totalDrain = 0;
    for (const b of powerBuildings) {
        const data = RULES.buildings[b.key];
        if (data) {
            totalPower += data.power || 0;
            totalDrain += data.drain || 0;
        }
    }

    if (totalDrain > totalPower - 30 && player.credits >= 400) {
        if (checkPrerequisites('power', myBuildings)) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'building', key: 'power', playerId }
            });
            return;
        }
    }

    // Build 3rd refinery only when truly wealthy (don't starve army production)
    const refineries = myBuildings.filter(b => b.key === 'refinery' && !b.dead).length;
    if (refineries < 3 && player.credits >= 4000 &&
        checkPrerequisites('refinery', myBuildings)) {
        actions.push({
            type: 'START_BUILD',
            payload: { category: 'building', key: 'refinery', playerId }
        });
    }
}

// --- Wave Attack Target Selection ---
// Find the best target for a full-army attack. Prioritize:
// 1. Known enemy base location (from intelligence)
// 2. Closest enemy production building (conyard > factory > barracks)
// 3. Any enemy building

function findBestAttackTarget(
    enemies: Entity[],
    baseCenter: Vector,
    aiState: ReturnType<typeof getAIState>
): Vector | null {
    // If we have a known enemy base location, use it
    if (aiState.enemyBaseLocation) {
        return aiState.enemyBaseLocation;
    }

    // Otherwise find closest enemy building
    const enemyBuildings = enemies.filter(e => e.type === 'BUILDING' && !e.dead);
    if (enemyBuildings.length === 0) {
        // No buildings? Target any enemy unit
        const enemyUnits = enemies.filter(e => e.type === 'UNIT' && !e.dead);
        if (enemyUnits.length === 0) return null;
        // Find closest
        let closest = enemyUnits[0];
        let closestDist = closest.pos.dist(baseCenter);
        for (const u of enemyUnits) {
            const d = u.pos.dist(baseCenter);
            if (d < closestDist) {
                closest = u;
                closestDist = d;
            }
        }
        return closest.pos;
    }

    // Priority: conyard (kill to prevent rebuilds) > production > economy > defense
    const priority: Record<string, number> = {
        'conyard': 200, 'factory': 80, 'barracks': 70, 'refinery': 60,
        'power': 40, 'tech': 30
    };
    let bestBuilding = enemyBuildings[0];
    let bestScore = -Infinity;
    for (const b of enemyBuildings) {
        const typePriority = priority[b.key] || 10;
        // Prefer closer targets (distance penalty)
        const dist = b.pos.dist(baseCenter);
        const score = typePriority - dist * 0.01;
        if (score > bestScore) {
            bestScore = score;
            bestBuilding = b;
        }
    }

    // Also update enemy base location for future reference
    aiState.enemyBaseLocation = bestBuilding.pos;
    return bestBuilding.pos;
}

// ============================================================================
// Main Hydra AI Logic
// ============================================================================

export function computeTitanAiActions(state: GameState, playerId: number, sharedCache?: EntityCache): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const aiState = getAIState(playerId);
    const personality = { ...titanPersonality };

    // PERFORMANCE: Use cached entity lookups
    const cache = sharedCache ?? createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId);

    // Check for elimination
    const hasMCV = myUnits.some(u => u.key === 'mcv');
    if (myBuildings.length === 0 && !hasMCV) {
        return actions;
    }

    const harvesters = myUnits.filter(u => u.key === 'harvester');
    const combatUnits = myUnits.filter(u =>
        u.key !== 'harvester' &&
        u.key !== 'mcv' &&
        u.key !== 'engineer' &&
        u.key !== 'demo_truck' &&
        u.key !== 'hijacker'
    );

    const baseCenter = findBaseCenter(myBuildings);

    // INTELLIGENCE: Update every tick for accurate decision-making
    updateEnemyBaseLocation(aiState, enemies);
    updateEnemyIntelligence(aiState, enemies, state.tick);
    updateVengeance(state, playerId, aiState, [...myBuildings, ...myUnits]);

    // Adapt personality based on enemy composition
    const dominantArmor = aiState.enemyIntelligence.dominantArmor;
    if (dominantArmor === 'infantry') {
        personality.unit_preferences = {
            infantry: ['grenadier', 'rocket', 'flamer'],
            vehicle: ['flame_tank', 'light', 'heavy']
        };
    } else if (dominantArmor === 'heavy') {
        personality.unit_preferences = {
            infantry: ['rocket', 'rocket', 'grenadier'],
            vehicle: ['heavy', 'artillery', 'light']
        };
    }

    // Detect if enemy is booming - become more aggressive
    const maxBoomScore = Object.values(aiState.enemyIntelligence.boomScores).reduce(
        (max, s) => Math.max(max, s), 0
    );
    if (maxBoomScore >= 25) {
        personality.attack_threshold = Math.min(personality.attack_threshold!, 3);
        personality.min_attack_group_size = Math.min(personality.min_attack_group_size!, 3);
    }

    // PERFORMANCE: Stagger AI computation
    const tickOffset = playerId % AI_CONSTANTS.AI_TICK_INTERVAL;
    const isFullComputeTick = state.tick < AI_CONSTANTS.AI_TICK_INTERVAL ||
        state.tick % AI_CONSTANTS.AI_TICK_INTERVAL === tickOffset;

    // Always detect threats (no delay for Hydra - instant reactions)
    const threats = detectThreats(
        baseCenter,
        harvesters,
        enemies,
        myBuildings,
        'hard',
        state.tick
    );
    aiState.threatsNearBase = threats.threatsNearBase;
    aiState.harvestersUnderAttack = threats.harvestersUnderAttack;

    const threatsNearBase = aiState.threatsNearBase;

    // Track threat timing
    if (threatsNearBase.length > 0 && aiState.lastThreatDetectedTick === 0) {
        aiState.lastThreatDetectedTick = state.tick;
    } else if (threatsNearBase.length === 0) {
        aiState.lastThreatDetectedTick = 0;
    }

    const isDummy = player.difficulty === 'dummy';

    // --- CRITICAL REACTIONS (every tick) ---
    if (!isDummy) {
        // Harvester safety
        actions.push(...handleHarvesterSafety(
            state, playerId, harvesters, combatUnits, baseCenter, enemies, aiState, cache, 'hard'
        ));

        // Instant defense - no reaction delay for Hydra
        if (threatsNearBase.length > 0 && combatUnits.length > 0) {
            actions.push(...handleDefense(state, playerId, aiState, combatUnits, baseCenter, personality));
        }

        // Always micro (kiting, positioning)
        actions.push(...handleMicro(state, combatUnits, enemies, baseCenter, personality, myBuildings, 'hard'));
    }

    // --- SPECIAL OPS (every tick, low cost) ---
    if (!isDummy) {
        actions.push(...handleUnitRepair(state, playerId, combatUnits, myBuildings));

        const engineers = myUnits.filter(u => u.key === 'engineer' && !u.dead);
        if (engineers.length > 0) {
            actions.push(...handleEngineerCapture(state, playerId, aiState, engineers, enemies, baseCenter));
        }

        if (enemies.length > 0) {
            actions.push(...handleHijackerAssault(state, playerId, enemies, aiState, baseCenter));
            actions.push(...handleAirStrikes(state, playerId, enemies, aiState));
            actions.push(...handleDemoTruckAssault(state, playerId, enemies, aiState));
        }
    }

    // On non-compute ticks, only run critical reactions above
    if (!isFullComputeTick) {
        return actions;
    }

    // --- FULL COMPUTATION (every 3 ticks) ---

    // Update Strategy
    updateStrategy(
        aiState,
        state.tick,
        myBuildings,
        combatUnits,
        enemies,
        threatsNearBase,
        personality,
        player.credits,
        'hard'
    );

    evaluateInvestmentPriority(
        state,
        playerId,
        aiState,
        myBuildings,
        combatUnits,
        enemies,
        baseCenter
    );

    // --- RUSH DETECTION ---
    const rushTarget = findRushTarget(state, cache, playerId, baseCenter, combatUnits.length, aiState);
    const shouldRush = !isDummy &&
        aiState.strategy !== 'all_in' &&
        threatsNearBase.length === 0 &&
        combatUnits.length >= RUSH_MIN_COMBAT_UNITS &&
        rushTarget !== null;

    if (shouldRush && rushTarget) {
        aiState.strategy = 'attack';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = combatUnits.map(u => u.id);
        aiState.harassGroup = [];
        aiState.enemyBaseLocation = rushTarget.targetPos;
        aiState.vengeanceScores[rushTarget.ownerId] = Math.max(
            aiState.vengeanceScores[rushTarget.ownerId] || 0,
            RUSH_VENGEANCE_BOOST
        );
    }

    // Boom rush detection (if not already rushing)
    if (!shouldRush) {
        const boomTarget = findBoomRushTarget(state, cache, playerId, baseCenter, combatUnits.length, aiState);
        const shouldBoomRush = !isDummy &&
            aiState.strategy !== 'all_in' &&
            threatsNearBase.length === 0 &&
            combatUnits.length >= RUSH_MIN_COMBAT_UNITS &&
            boomTarget !== null;

        if (shouldBoomRush && boomTarget) {
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = state.tick;
            aiState.attackGroup = combatUnits.map(u => u.id);
            aiState.harassGroup = [];
            aiState.enemyBaseLocation = boomTarget.targetPos;
            aiState.vengeanceScores[boomTarget.ownerId] = Math.max(
                aiState.vengeanceScores[boomTarget.ownerId] || 0,
                BOOM_RUSH_VENGEANCE_BOOST
            );
        }
    }

    // --- HYDRA AGGRESSION OVERRIDE ---
    // Force attacks aggressively. Don't let army sit idle. Every idle tick is wasted.
    if (!isDummy && threatsNearBase.length === 0 && enemies.length > 0) {
        const enemyCombatUnits = enemies.filter(e =>
            e.type === 'UNIT' && isCombatUnitKey(e.key)
        );
        const armyRatio = enemyCombatUnits.length > 0
            ? combatUnits.length / enemyCombatUnits.length
            : (combatUnits.length > 0 ? 10 : 0);

        if (aiState.strategy === 'buildup' || aiState.strategy === 'defend' || aiState.strategy === 'harass') {
            const forceAttackArmyAdvantage = combatUnits.length >= 3 && armyRatio >= 1.3;
            const forceAttackCreditSurplus = combatUnits.length >= 3 && player.credits >= 2000;
            const forceAttackMidGame = state.tick >= 4000 && combatUnits.length >= 5;
            const forceAttackLargeArmy = combatUnits.length >= 8;

            if (forceAttackArmyAdvantage || forceAttackCreditSurplus || forceAttackMidGame || forceAttackLargeArmy) {
                aiState.strategy = 'attack';
                aiState.lastStrategyChange = state.tick;
                aiState.attackGroup = combatUnits.map(u => u.id);
                aiState.harassGroup = [];
            }
        }
    }

    // --- ECONOMY & PRODUCTION ---
    if (player.readyToPlace) {
        actions.push(...handleBuildingPlacement(state, playerId, myBuildings, player));
    }

    actions.push(...handleEmergencySell(state, playerId, myBuildings, player, aiState));
    actions.push(...handleLastResortSell(state, playerId, myBuildings, player, aiState));
    actions.push(...handleAllInSell(state, playerId, myBuildings, aiState));

    // Core economy handling
    actions.push(...(handleEconomy(state, playerId, myBuildings, player, personality, aiState, enemies, cache) || []));

    // Building repairs
    actions.push(...handleBuildingRepair(state, playerId, myBuildings, player, aiState));

    // MCV & expansion
    actions.push(...handleMCVOperations(state, playerId, aiState, myBuildings, myUnits));
    actions.push(...handleInductionRigOperations(state, playerId, myBuildings, myUnits));

    // Harvester gathering
    actions.push(...handleHarvesterGathering(
        state, playerId, harvesters, aiState.harvestersUnderAttack, aiState, 'hard'
    ));

    // Harvester AI (coordination, danger maps, escorts)
    const harvesterResult = updateHarvesterAI(
        aiState.harvesterAI,
        playerId,
        state,
        'hard',
        cache
    );
    aiState.harvesterAI = harvesterResult.harvesterAI;
    actions.push(...harvesterResult.actions);

    // --- HYDRA SPECIAL: Infrastructure & Tech Chain ---
    ensureInfrastructure(actions, state, playerId, myBuildings);
    ensureTechChain(actions, state, playerId, myBuildings, combatUnits.length);

    // --- HYDRA SPECIAL: Dual Production Enforcement ---
    // This is the core advantage: NEVER let production buildings idle
    ensureDualProduction(actions, state, playerId, myBuildings, myUnits, dominantArmor);

    // --- COMBAT EXECUTION ---
    if (isDummy) {
        actions.push(...handleRally(state, playerId, aiState, combatUnits, baseCenter, enemies));
        return actions;
    }

    // Defense group management
    if (aiState.strategy === 'defend') {
        aiState.defenseGroup = aiState.defenseGroup || [];
    } else {
        aiState.defenseGroup = [];
    }

    if (aiState.strategy === 'attack' || aiState.strategy === 'all_in') {
        // HYDRA WAVE ATTACK: Send ALL combat units at once via direct command.
        // This bypasses the shared handleAttack's trickle prevention which splits
        // the army into small groups. Hydra's philosophy: overwhelm with numbers.
        const targetPos = findBestAttackTarget(enemies, baseCenter, aiState);

        if (targetPos && combatUnits.length >= 3) {
            // Clear offensive groups to prevent conflicts with handleAttack state
            aiState.offensiveGroups = [];
            aiState.attackGroup = combatUnits.map(u => u.id);
            aiState.harassGroup = [];

            // Send the ENTIRE army as one wave
            actions.push({
                type: 'COMMAND_ATTACK_MOVE',
                payload: {
                    unitIds: combatUnits.map(u => u.id),
                    x: targetPos.x,
                    y: targetPos.y
                }
            });
        } else {
            // Fallback to standard attack handler if no target found
            actions.push(...handleAttack(
                state, playerId, aiState, combatUnits, enemies, baseCenter, personality, true
            ));
        }

        if (aiState.strategy === 'all_in') {
            actions.push(...handleHarvesterSuicideAttack(state, playerId, harvesters, enemies, combatUnits));
        }
    }

    if (aiState.strategy === 'harass') {
        actions.push(...handleHarass(state, playerId, aiState, combatUnits, enemies));
    }

    if (aiState.strategy === 'buildup') {
        actions.push(...handleRally(state, playerId, aiState, combatUnits, baseCenter, enemies));
    }

    // Always scout
    actions.push(...handleScouting(state, playerId, aiState, combatUnits, enemies, baseCenter));

    return actions;
}

export const TitanAIImplementation: AIImplementation = {
    id: 'titan',
    name: 'Titan',
    description: 'An overwhelmingly macro-focused AI that spams production facilities and relentlessly counters enemy compositions.',
    computeActions: ({ state, playerId, entityCache }) => computeTitanAiActions(state, playerId, entityCache),
    reset: resetAIState
};

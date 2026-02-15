import { GameState, Action, Entity, UnitEntity, Vector, EntityId, isActionType } from '../../../types.js';
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
    getDifficultyModifiers,
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
    handleAirStrikes,
    handleDemoTruckAssault,
    handleUnitRepair,
    handleEngineerCapture,
    handleHijackerAssault
} from '../../action_combat.js';
import { updateHarvesterAI } from '../../harvester/index.js';
import { AIImplementation } from '../../contracts.js';
import { AIPersonality, RULES, isUnitData } from '../../../../data/schemas/index.js';

type Phase = 'fortify' | 'expansion' | 'assault';

type StartBuildAction = Extract<Action, { type: 'START_BUILD' }>;

const infantryFortressPersonality: AIPersonality = {
    aggression_bias: 1.0,
    retreat_threshold: 0.15,
    attack_threshold: 5,
    harass_threshold: 3,
    rally_offset: 180,
    build_order_priority: [
        'power', 'barracks', 'refinery'
    ],
    unit_preferences: {
        infantry: ['rocket', 'grenadier', 'rifle', 'hijacker', 'engineer'],
        vehicle: ['heavy', 'light', 'flame_tank']
    },
    harvester_ratio: 2.5,
    credit_buffer: 500,
    kite_aggressiveness: 0.5,
    defense_investment: 3,
    max_chase_distance: 400,
    min_attack_group_size: 4,
    max_attack_group_size: 20
};

// Phase thresholds - aggressive timing
const EXPANSION_MIN_INFANTRY = 3;
const EXPANSION_MIN_DEFENSES = 1;
const ASSAULT_MIN_INFANTRY = 8;
const ASSAULT_MIN_DEFENSES = 2;
const FORCE_ASSAULT_TICK = 8000;
const FORCE_ASSAULT_MIN_INFANTRY = 3;

// Rush detection constants (modeled after classic AI)
const RUSH_MIN_TICK = 600;        // 10 seconds - check for vulnerable enemies
const RUSH_MIN_COMBAT_UNITS = 3;  // Need at least 3 to rush
const RUSH_VENGEANCE_BOOST = 225; // High priority on rush target

// Barracks targets
const TARGET_BARRACKS_FORTIFY = 2;
const TARGET_BARRACKS_EXPANSION = 3;
const TARGET_BARRACKS_ASSAULT = 3;

// Defense targets per phase - minimal to free building queue for barracks
const TARGET_DEFENSES_FORTIFY = 1;
const TARGET_DEFENSES_EXPANSION = 2;
const TARGET_DEFENSES_ASSAULT = 3;

// Defense build priority order (cheap first, then better)
// Prioritize stronger defenses when available (turrets, SAMs).
// Early game: turret/sam fail prereqs, falls through to pillbox.
// Mid/late game: turrets and SAMs built first (stronger).
const DEFENSE_BUILD_ORDER = ['turret', 'sam_site', 'pillbox', 'obelisk'];

// Base garrison - disabled to let updateStrategy handle all combat decisions
const GARRISON_FRACTION_FORTIFY = 0;
const GARRISON_FRACTION_EXPANSION = 0;
const GARRISON_FRACTION_ASSAULT = 0;
const GARRISON_MIN_SIZE = 0;
const GARRISON_PATROL_RADIUS = 300;      // How close to base garrison units stay

// Infantry weights for weighted selection - COMBAT UNITS ONLY.
// Hijackers/engineers are maintained separately by queueSpecialInfantry.
// Rockets (300cr, range 220, 35 effective vs buildings/heavy) are the backbone.
// Grenadiers (250cr, splash 35, 32 effective vs buildings) for splash damage.
// Flamers (400cr, short range 80 but devastating DPS) as support.
const INFANTRY_WEIGHTS: Record<Phase, Record<string, number>> = {
    fortify: {
        rifle: 3,
        grenadier: 3,
        rocket: 5,
        flamer: 0,
        hijacker: 0,
        engineer: 0,
        sniper: 0
    },
    expansion: {
        rifle: 2,
        grenadier: 3,
        rocket: 5,
        flamer: 0,
        hijacker: 0,
        engineer: 0,
        sniper: 0
    },
    assault: {
        rifle: 1,
        grenadier: 3,
        rocket: 5,
        flamer: 0,
        hijacker: 0,
        engineer: 0,
        sniper: 1
    }
};

function determinePhase(
    tick: number,
    infantryCount: number,
    defenseCount: number,
    hasFactory: boolean
): Phase {
    if (tick >= FORCE_ASSAULT_TICK && infantryCount >= FORCE_ASSAULT_MIN_INFANTRY) {
        return 'assault';
    }
    if (infantryCount >= ASSAULT_MIN_INFANTRY && defenseCount >= ASSAULT_MIN_DEFENSES && hasFactory) {
        return 'assault';
    }
    if (infantryCount >= EXPANSION_MIN_INFANTRY && defenseCount >= EXPANSION_MIN_DEFENSES) {
        return 'expansion';
    }
    return 'fortify';
}

function isInfantryBuildAction(action: Action): action is StartBuildAction {
    return isActionType(action, 'START_BUILD') && action.payload.category === 'infantry';
}

/**
 * Weighted random infantry selection - mixes in specialists instead of always picking rifles.
 * Uses deterministic selection based on tick to avoid randomness in reducer.
 */
function choosePreferredInfantry(
    phase: Phase,
    myBuildings: Entity[],
    credits: number,
    tick: number
): string | null {
    const weights = INFANTRY_WEIGHTS[phase];

    // Build candidates list with weights
    const candidates: { key: string; weight: number }[] = [];
    let totalWeight = 0;

    for (const [key, weight] of Object.entries(weights)) {
        if (weight === 0) continue;
        const unitData = RULES.units[key];
        if (!unitData) continue;
        if (unitData.cost > credits) continue;
        if (!checkPrerequisites(key, myBuildings)) continue;
        candidates.push({ key, weight });
        totalWeight += weight;
    }

    if (candidates.length === 0) return null;

    // Deterministic weighted selection using tick
    const roll = tick % totalWeight;
    let cumulative = 0;
    for (const { key, weight } of candidates) {
        cumulative += weight;
        if (roll < cumulative) return key;
    }

    return candidates[candidates.length - 1].key;
}

/**
 * Remap infantry builds through weighted selection for variety.
 * Remap vehicle builds to preferred cheaper vehicles (avoid expensive heavy/mammoth from counter-building).
 */
function enforceProductionBias(
    actions: Action[],
    playerId: number,
    phase: Phase,
    myBuildings: Entity[],
    credits: number,
    tick: number
): Action[] {
    let infantryIndex = 0;
    return actions.map(action => {
        if (!isActionType(action, 'START_BUILD')) return action;
        const buildAction = action as StartBuildAction;

        // Remap infantry builds through weighted selection for variety
        if (buildAction.payload.category === 'infantry') {
            const preferred = choosePreferredInfantry(phase, myBuildings, credits, tick + infantryIndex);
            infantryIndex++;
            if (!preferred) return action;
            return {
                type: 'START_BUILD',
                payload: { category: 'infantry', key: preferred, playerId }
            } satisfies Action;
        }

        // Redirect counter-building vehicle picks to infantry.
        // handleEconomy's counter-building often picks suboptimal vehicles
        // (APC, mammoth, etc.). Let queueVehicleIfPossible handle all vehicle production
        // with our preferred priority (demo trucks → artillery → heavy/flame).
        // Keep harvesters untouched.
        if (buildAction.payload.category === 'vehicle' && buildAction.payload.key !== 'harvester') {
            const preferred = choosePreferredInfantry(phase, myBuildings, credits, tick + infantryIndex);
            infantryIndex++;
            if (!preferred) return action;
            return {
                type: 'START_BUILD',
                payload: { category: 'infantry', key: preferred, playerId }
            } satisfies Action;
        }

        return action;
    });
}

function ensureExtraBarracks(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    phase: Phase
): void {
    const target = phase === 'assault' ? TARGET_BARRACKS_ASSAULT :
        phase === 'expansion' ? TARGET_BARRACKS_EXPANSION : TARGET_BARRACKS_FORTIFY;

    const existingBarracks = myBuildings.filter(b => b.key === 'barracks' && !b.dead).length;
    if (existingBarracks >= target) return;

    const player = state.players[playerId];
    if (!player) return;

    const hasConyard = myBuildings.some(b => b.key === 'conyard' && !b.dead);
    if (!hasConyard) return;

    if (player.queues.building.current) return;

    const alreadyQueued = actions.some(a =>
        isActionType(a, 'START_BUILD') &&
        a.payload.category === 'building' &&
        a.payload.key === 'barracks'
    );
    if (alreadyQueued) return;

    if (!checkPrerequisites('barracks', myBuildings)) return;

    const barracksCost = RULES.buildings['barracks']?.cost ?? 300;
    if (player.credits < barracksCost) return;

    actions.push({
        type: 'START_BUILD',
        payload: { category: 'building', key: 'barracks', playerId }
    });
}

/**
 * Proactively queue defense buildings to hit phase targets.
 * Unlike the shared handleEconomy surplus defense logic which requires 5000+ credits,
 * this queues defenses as a core priority with a much lower credit threshold.
 */
function queueDefenseIfPossible(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    phase: Phase,
    defenseCount: number
): void {
    const target = phase === 'assault' ? TARGET_DEFENSES_ASSAULT :
        phase === 'expansion' ? TARGET_DEFENSES_EXPANSION : TARGET_DEFENSES_FORTIFY;

    if (defenseCount >= target) return;

    const player = state.players[playerId];
    if (!player) return;

    const hasConyard = myBuildings.some(b => b.key === 'conyard' && !b.dead);
    if (!hasConyard) return;

    if (player.queues.building.current) return;

    // Don't double-queue building actions
    const alreadyQueuedBuilding = actions.some(a =>
        isActionType(a, 'START_BUILD') && a.payload.category === 'building'
    );
    if (alreadyQueuedBuilding) return;

    // Pick the best defense we can afford from the priority order
    for (const defenseKey of DEFENSE_BUILD_ORDER) {
        const data = RULES.buildings[defenseKey];
        if (!data) continue;
        if (!checkPrerequisites(defenseKey, myBuildings)) continue;
        // Low credit buffer - prioritize defenses over saving credits
        if (player.credits < data.cost + 100) continue;

        actions.push({
            type: 'START_BUILD',
            payload: { category: 'building', key: defenseKey, playerId }
        });
        return;
    }
}

/**
 * Queue special infantry (hijackers, engineers) when below target counts.
 * Also fills empty infantry queue with counter-appropriate units via weighted selection.
 */
function queueSpecialInfantry(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    myUnits: Entity[],
    phase: Phase
): void {
    const player = state.players[playerId];
    if (!player) return;
    if (!hasProductionBuildingFor('infantry', myBuildings)) return;
    if (player.queues.infantry.current) return;
    if (actions.some(isInfantryBuildAction)) return;

    // Count existing special units
    const hijackerCount = myUnits.filter(u => u.key === 'hijacker' && !u.dead).length;
    const engineerCount = myUnits.filter(u => u.key === 'engineer' && !u.dead).length;

    // Maintain hijackers (600cr each, steal enemy vehicles - huge economic value)
    // Skip in fortify phase - no enemy vehicles yet, spend credits on combat infantry
    const targetHijackers = phase === 'fortify' ? 0 : 2;
    if (hijackerCount < targetHijackers && checkPrerequisites('hijacker', myBuildings)) {
        const cost = RULES.units['hijacker']?.cost ?? 600;
        if (player.credits >= cost + 200) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'hijacker', playerId }
            });
            return;
        }
    }

    // Maintain 1 engineer (500cr, captures enemy buildings)
    // Skip in fortify phase - too expensive early, focus on combat units
    if (phase !== 'fortify' && engineerCount < 1 && checkPrerequisites('engineer', myBuildings)) {
        const cost = RULES.units['engineer']?.cost ?? 500;
        if (player.credits >= cost + 200) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'infantry', key: 'engineer', playerId }
            });
            return;
        }
    }

    // Fill empty queue with weighted selection (rockets, grenadiers, etc.)
    const preferred = choosePreferredInfantry(phase, myBuildings, player.credits, state.tick);
    if (!preferred) return;

    actions.push({
        type: 'START_BUILD',
        payload: { category: 'infantry', key: preferred, playerId }
    });
}

/**
 * Proactively queue vehicle production.
 * Maintains a supply of demo trucks (key to breaking through defenses)
 * while also building heavy tanks for direct combat.
 */
function queueVehicleIfPossible(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    myUnits: Entity[]
): void {
    const player = state.players[playerId];
    if (!player) return;
    if (!hasProductionBuildingFor('vehicle', myBuildings)) return;
    if (player.queues.vehicle.current) return;

    // Don't queue if we already have a vehicle build queued
    const hasVehicleBuild = actions.some(a =>
        isActionType(a, 'START_BUILD') && a.payload.category === 'vehicle'
    );
    if (hasVehicleBuild) return;

    // Count active special vehicles
    const demoTruckCount = myUnits.filter(u => u.key === 'demo_truck' && !u.dead).length;
    const artilleryCount = myUnits.filter(u => u.key === 'artillery' && !u.dead).length;
    const mlrsCount = myUnits.filter(u => u.key === 'mlrs' && !u.dead).length;
    // Priority 1: Maintain demo trucks (consumed on use, essential for breaking defenses)
    if (demoTruckCount < 2 && checkPrerequisites('demo_truck', myBuildings)) {
        const cost = RULES.units['demo_truck']?.cost ?? 1000;
        if (player.credits >= cost + 150) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'vehicle', key: 'demo_truck', playerId }
            });
            return;
        }
    }

    // Priority 2: Build siege units (artillery + MLRS) behind infantry screen
    // Artillery: 130dmg heavy_cannon, range 550, 195 effective vs buildings
    // MLRS: 100dmg missile, range 500, 150 effective vs heavy tanks, interception aura
    if (artilleryCount < 3 && checkPrerequisites('artillery', myBuildings)) {
        const cost = RULES.units['artillery']?.cost ?? 1200;
        if (player.credits >= cost + 200) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'vehicle', key: 'artillery', playerId }
            });
            return;
        }
    }

    if (mlrsCount < 1 && checkPrerequisites('mlrs', myBuildings)) {
        const cost = RULES.units['mlrs']?.cost ?? 1800;
        if (player.credits >= cost + 200) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'vehicle', key: 'mlrs', playerId }
            });
            return;
        }
    }

    // Priority 3: Heavy tanks or flame tanks for direct combat
    const combatVehicles = ['heavy', 'flame_tank'];
    for (const key of combatVehicles) {
        if (!checkPrerequisites(key, myBuildings)) continue;
        const cost = RULES.units[key]?.cost ?? 1000;
        if (player.credits < cost + 150) continue;

        actions.push({
            type: 'START_BUILD',
            payload: { category: 'vehicle', key, playerId }
        });
        return;
    }

}

/**
 * Queue the tech chain: factory → tech → airforce_command.
 * Runs AFTER ensureExtraBarracks so 2nd barracks always has priority.
 * This replaces the removed build_order_priority entries for these buildings.
 */
const TECH_CHAIN = ['factory', 'tech', 'airforce_command'] as const;

function ensureTechChain(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[]
): void {
    const player = state.players[playerId];
    if (!player) return;

    const hasConyard = myBuildings.some(b => b.key === 'conyard' && !b.dead);
    if (!hasConyard) return;
    if (player.queues.building.current) return;

    // Don't double-queue building actions
    const alreadyQueuedBuilding = actions.some(a =>
        isActionType(a, 'START_BUILD') && a.payload.category === 'building'
    );
    if (alreadyQueuedBuilding) return;

    for (const key of TECH_CHAIN) {
        const exists = myBuildings.some(b => b.key === key && !b.dead);
        if (exists) continue;

        if (!checkPrerequisites(key, myBuildings)) break; // Prerequisites are sequential

        const data = RULES.buildings[key];
        if (!data) continue;
        if (player.credits < data.cost + 200) break; // Keep some buffer for units

        actions.push({
            type: 'START_BUILD',
            payload: { category: 'building', key, playerId }
        });
        return;
    }
}

function isInfantryUnit(unit: Entity): boolean {
    if (unit.type !== 'UNIT' || unit.dead) return false;
    const data = RULES.units[unit.key];
    return Boolean(data && isUnitData(data) && data.type === 'infantry');
}

/**
 * Maintain a standing garrison of infantry near the base.
 * Assigns a fraction of combat units to the defenseGroup so they stay home
 * and patrol near base instead of joining attack/harass groups.
 * Returns { garrison, expeditionary } split of combat units.
 */
function maintainBaseGarrison(
    state: GameState,
    aiState: import('../../types.js').AIPlayerState,
    combatUnits: Entity[],
    baseCenter: Vector,
    phase: Phase
): { garrison: Entity[]; expeditionary: Entity[] } {
    const fraction = phase === 'fortify' ? GARRISON_FRACTION_FORTIFY :
        phase === 'expansion' ? GARRISON_FRACTION_EXPANSION : GARRISON_FRACTION_ASSAULT;

    const desiredGarrisonSize = Math.max(
        GARRISON_MIN_SIZE,
        Math.ceil(combatUnits.length * fraction)
    );

    // Clean up dead units from defenseGroup
    aiState.defenseGroup = aiState.defenseGroup.filter(id => {
        const e = state.entities[id];
        return e && !e.dead;
    });

    // Remove units from defenseGroup that are no longer in combatUnits
    const combatIds = new Set(combatUnits.map(u => u.id));
    aiState.defenseGroup = aiState.defenseGroup.filter(id => combatIds.has(id));

    // If garrison is too large (e.g. phase changed), release excess
    while (aiState.defenseGroup.length > desiredGarrisonSize) {
        aiState.defenseGroup.pop();
    }

    // If garrison is too small, add closest-to-base units
    if (aiState.defenseGroup.length < desiredGarrisonSize) {
        const garrisonSet = new Set(aiState.defenseGroup);
        const candidates = combatUnits
            .filter(u => !garrisonSet.has(u.id) &&
                !aiState.attackGroup.includes(u.id) &&
                !aiState.harassGroup.includes(u.id))
            .sort((a, b) => a.pos.dist(baseCenter) - b.pos.dist(baseCenter));

        for (const unit of candidates) {
            if (aiState.defenseGroup.length >= desiredGarrisonSize) break;
            aiState.defenseGroup.push(unit.id);
        }
    }

    const garrisonSet = new Set<EntityId>(aiState.defenseGroup);
    const garrison = combatUnits.filter(u => garrisonSet.has(u.id));
    const expeditionary = combatUnits.filter(u => !garrisonSet.has(u.id));

    return { garrison, expeditionary };
}

/**
 * Order garrison units to patrol near base. Idle garrison units move to
 * positions around the base center. If threats appear, they engage.
 */
function handleGarrisonPatrol(
    _state: GameState,
    aiState: import('../../types.js').AIPlayerState,
    garrison: Entity[],
    baseCenter: Vector
): Action[] {
    const actions: Action[] = [];

    // If there are threats near base, garrison engages them (handleDefense covers this)
    if (aiState.threatsNearBase.length > 0) return actions;

    // Patrol: move idle garrison units to positions around base
    const idleGarrison = garrison.filter(u => {
        const unit = u as UnitEntity;
        return !unit.movement.moveTarget && !unit.combat.targetId;
    });

    if (idleGarrison.length === 0) return actions;

    // Spread patrol positions around base center
    const farFromBase = idleGarrison.filter(u =>
        u.pos.dist(baseCenter) > GARRISON_PATROL_RADIUS
    );

    if (farFromBase.length > 0) {
        // Move distant idle units back toward base
        for (let i = 0; i < farFromBase.length; i++) {
            const angle = (i / farFromBase.length) * Math.PI * 2;
            const patrolX = baseCenter.x + Math.cos(angle) * (GARRISON_PATROL_RADIUS * 0.6);
            const patrolY = baseCenter.y + Math.sin(angle) * (GARRISON_PATROL_RADIUS * 0.6);
            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: [farFromBase[i].id],
                    x: patrolX,
                    y: patrolY
                }
            });
        }
    }

    return actions;
}

function isDefenseBuilding(building: Entity): boolean {
    if (building.type !== 'BUILDING' || building.dead) return false;
    return Boolean(RULES.buildings[building.key]?.isDefense);
}

const NON_COMBAT_UNIT_KEYS = new Set(['harvester', 'mcv', 'engineer', 'induction_rig']);

function isCombatUnitKey(key: string): boolean {
    if (NON_COMBAT_UNIT_KEYS.has(key)) return false;
    const unitData = RULES.units[key];
    return Boolean(unitData && unitData.damage > 0);
}

/**
 * Detect vulnerable enemies and trigger early rushes.
 * Infantry is cheap and fast to produce from barracks - we can rush earlier than tank builds.
 * Returns target position if a rush opportunity is found.
 */
function findRushTarget(
    state: GameState,
    cache: ReturnType<typeof createEntityCache>,
    playerId: number,
    baseCenter: Vector,
    myCombatCount: number,
    aiState: import('../../types.js').AIPlayerState
): { targetPos: Vector; ownerId: number } | null {
    if (state.tick < RUSH_MIN_TICK || myCombatCount < RUSH_MIN_COMBAT_UNITS) {
        return null;
    }

    const ownerIds = Array.from(cache.byOwner.keys()).filter(id => id !== playerId && id !== -1);
    let bestTarget: { targetPos: Vector; ownerId: number } | null = null;
    let bestScore = -Infinity;

    for (const ownerId of ownerIds) {
        const enemyBuildings = getBuildingsForOwner(cache, ownerId);
        const enemyUnits = getUnitsForOwner(cache, ownerId);
        if (enemyBuildings.length === 0) continue;

        const enemyCombatUnits = enemyUnits.filter(u => isCombatUnitKey(u.key));
        const enemyDefenses = enemyBuildings.filter(b => Boolean(RULES.buildings[b.key]?.isDefense));

        // Skip if enemy is well-defended
        if (enemyDefenses.length > 1) continue;

        // Need clear army advantage
        if (enemyCombatUnits.length >= myCombatCount) continue;

        // Check for eco vulnerability signals
        const enemyRefineries = enemyBuildings.filter(b => b.key === 'refinery').length;
        const enemyHarvesters = enemyUnits.filter(u => u.key === 'harvester').length;
        const boomScore = aiState.enemyIntelligence.boomScores[ownerId] || 0;

        // Greedy rush: no combat units AND no defenses
        const isGreedy = enemyCombatUnits.length === 0 && enemyDefenses.length === 0;
        // Low defense rush: few defenses + booming economy
        const isLowDefense = enemyDefenses.length <= 1 && (
            boomScore >= 20 ||
            enemyRefineries >= 3 ||
            (enemyRefineries >= 2 && enemyHarvesters >= 4)
        );

        if (!isGreedy && !isLowDefense) continue;

        const primaryTarget =
            enemyBuildings.find(b => b.key === 'conyard') ||
            enemyBuildings.find(b => b.key === 'factory') ||
            enemyBuildings.find(b => b.key === 'barracks') ||
            enemyBuildings.find(b => b.key === 'refinery') ||
            enemyBuildings[0];

        const unitLead = Math.max(0, myCombatCount - enemyCombatUnits.length);
        const greedyBonus = isGreedy ? 100 : 0;
        const score = greedyBonus + unitLead * 40 + boomScore * 8 -
            enemyDefenses.length * 30 - primaryTarget.pos.dist(baseCenter);

        if (score > bestScore) {
            bestScore = score;
            bestTarget = { ownerId, targetPos: primaryTarget.pos };
        }
    }

    return bestTarget;
}

export function computeInfantryFortressAiActions(state: GameState, playerId: number, sharedCache?: EntityCache): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const aiState = getAIState(playerId);

    const cache = sharedCache ?? createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId);

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
    const infantry = myUnits.filter(isInfantryUnit);
    const defenses = myBuildings.filter(isDefenseBuilding);
    const hasFactory = myBuildings.some(b => b.key === 'factory' && !b.dead);

    const phase = determinePhase(state.tick, infantry.length, defenses.length, hasFactory);
    const baseCenter = findBaseCenter(myBuildings);

    updateEnemyBaseLocation(aiState, enemies);
    updateEnemyIntelligence(aiState, enemies, state.tick);
    updateVengeance(state, playerId, aiState, [...myBuildings, ...myUnits]);

    const tickOffset = playerId % AI_CONSTANTS.AI_TICK_INTERVAL;
    const isFullComputeTick = state.tick < AI_CONSTANTS.AI_TICK_INTERVAL ||
        state.tick % AI_CONSTANTS.AI_TICK_INTERVAL === tickOffset;

    const difficultyMods = getDifficultyModifiers(player.difficulty);
    const shouldDetectThreats = isFullComputeTick ||
        aiState.threatsNearBase.length > 0 ||
        aiState.harvestersUnderAttack.length > 0;

    if (shouldDetectThreats) {
        const threats = detectThreats(
            baseCenter,
            harvesters,
            enemies,
            myBuildings,
            player.difficulty,
            state.tick
        );
        aiState.threatsNearBase = threats.threatsNearBase;
        aiState.harvestersUnderAttack = threats.harvestersUnderAttack;
    }
    const hasImmediateThreat = aiState.threatsNearBase.length > 0;

    if (hasImmediateThreat && aiState.lastThreatDetectedTick === 0) {
        aiState.lastThreatDetectedTick = state.tick;
    } else if (!hasImmediateThreat) {
        aiState.lastThreatDetectedTick = 0;
    }

    const isDummy = player.difficulty === 'dummy';

    // Maintain base garrison - split combat units into garrison and expeditionary
    const { garrison, expeditionary } = maintainBaseGarrison(
        state, aiState, combatUnits, baseCenter, phase
    );

    // Phase-based strategy hints (don't override updateStrategy entirely)
    // Only force assault when we have enough army
    if (phase === 'assault' && enemies.length > 0 && expeditionary.length >= 8) {
        aiState.strategy = 'attack';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = expeditionary.map(u => u.id);
    }

    if (!isDummy) {
        actions.push(...handleHarvesterSafety(state, playerId, harvesters, combatUnits, baseCenter, enemies, aiState, cache, player.difficulty));

        const reactionDelayPassed = hasImmediateThreat &&
            (state.tick - aiState.lastThreatDetectedTick >= difficultyMods.reactionDelay);

        if (reactionDelayPassed && combatUnits.length > 0) {
            // All units (garrison + expeditionary) respond to base threats
            actions.push(...handleDefense(state, playerId, aiState, combatUnits, baseCenter, infantryFortressPersonality));
        }

        // Garrison units patrol near base when no threats
        actions.push(...handleGarrisonPatrol(state, aiState, garrison, baseCenter));
    }

    if (!isFullComputeTick) {
        if (!isDummy && phase === 'assault' && expeditionary.length > 0 && enemies.length > 0) {
            actions.push(...handleAttack(state, playerId, aiState, expeditionary, enemies, baseCenter, infantryFortressPersonality, true));
        }
        return actions;
    }

    updateStrategy(
        aiState,
        state.tick,
        myBuildings,
        combatUnits,
        enemies,
        aiState.threatsNearBase,
        infantryFortressPersonality,
        player.credits,
        player.difficulty
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

    // Re-apply assault override after strategy update
    if (phase === 'assault' && enemies.length > 0 && expeditionary.length >= 8) {
        aiState.strategy = 'attack';
        aiState.attackGroup = expeditionary.map(u => u.id);
    }

    // Rush detection: look for greedy or low-defense enemies to punish early
    const rushTarget = findRushTarget(state, cache, playerId, baseCenter, combatUnits.length, aiState);
    const isRushing = !!rushTarget;
    if (rushTarget) {
        // Boost vengeance toward rush target to steer attack/harass toward them
        aiState.vengeanceScores[rushTarget.ownerId] =
            Math.max(aiState.vengeanceScores[rushTarget.ownerId] || 0, RUSH_VENGEANCE_BOOST);
        // Force attack strategy during rush (like classic AI does)
        if (combatUnits.length >= RUSH_MIN_COMBAT_UNITS) {
            aiState.strategy = 'attack';
            aiState.attackGroup = expeditionary.map(u => u.id);
        }
    }

    if (player.readyToPlace) {
        actions.push(...handleBuildingPlacement(state, playerId, myBuildings, player));
    }

    actions.push(...handleEmergencySell(state, playerId, myBuildings, player, aiState));
    actions.push(...handleLastResortSell(state, playerId, myBuildings, player, aiState));
    actions.push(...handleAllInSell(state, playerId, myBuildings, aiState));

    // Economy: infantry fortress does NOT strip defense builds (unlike eco_tank_all_in)
    let economyActions = handleEconomy(
        state,
        playerId,
        myBuildings,
        player,
        infantryFortressPersonality,
        aiState,
        enemies,
        cache
    );

    // Redirect non-harvester, non-demo_truck vehicle builds to infantry
    economyActions = enforceProductionBias(economyActions, playerId, phase, myBuildings, player.credits, state.tick);

    actions.push(...economyActions);
    actions.push(...handleMCVOperations(state, playerId, aiState, myBuildings, myUnits));
    actions.push(...handleInductionRigOperations(state, playerId, myBuildings, myUnits));

    // Queue extra barracks FIRST (production throughput is critical for infantry focus)
    ensureExtraBarracks(actions, state, playerId, myBuildings, phase);

    // Queue tech chain (factory → tech → airforce_command) AFTER extra barracks
    ensureTechChain(actions, state, playerId, myBuildings);

    // Queue defenses to hit phase targets
    queueDefenseIfPossible(actions, state, playerId, myBuildings, phase, defenses.length);

    // Proactively queue infantry if nothing in queue
    queueSpecialInfantry(actions, state, playerId, myBuildings, myUnits, phase);

    // Proactively queue vehicles - demo trucks for harassment, light tanks for combat
    if (hasFactory) {
        queueVehicleIfPossible(actions, state, playerId, myBuildings, myUnits);
    }

    actions.push(...handleBuildingRepair(state, playerId, myBuildings, player, aiState));

    actions.push(...handleHarvesterGathering(state, playerId, harvesters, aiState.harvestersUnderAttack, aiState, player.difficulty));

    const harvesterResult = updateHarvesterAI(
        aiState.harvesterAI,
        playerId,
        state,
        player.difficulty,
        cache
    );
    aiState.harvesterAI = harvesterResult.harvesterAI;
    actions.push(...harvesterResult.actions);

    if (isDummy) {
        actions.push(...handleRally(state, playerId, aiState, expeditionary, baseCenter, enemies));
        return actions;
    }

    // Combat handlers - only expeditionary units go on offense, garrison stays home
    // ignoreSizeLimit = true when rushing (like classic AI) or in assault phase
    const ignoreSizeLimit = phase === 'assault' || isRushing;
    if (aiState.strategy === 'attack' || aiState.strategy === 'all_in') {
        actions.push(...handleAttack(state, playerId, aiState, expeditionary, enemies, baseCenter, infantryFortressPersonality, ignoreSizeLimit));
    } else if (aiState.strategy === 'harass') {
        actions.push(...handleHarass(state, playerId, aiState, expeditionary, enemies));
    } else {
        actions.push(...handleRally(state, playerId, aiState, expeditionary, baseCenter, enemies));
    }


    actions.push(...handleScouting(state, playerId, aiState, expeditionary, enemies, baseCenter));
    actions.push(...handleMicro(state, combatUnits, enemies, baseCenter, infantryFortressPersonality, myBuildings, player.difficulty));
    actions.push(...handleUnitRepair(state, playerId, combatUnits, myBuildings));

    // Engineer capture - always active, engineers seek out enemy buildings
    const engineers = myUnits.filter(u => u.key === 'engineer' && !u.dead);
    if (engineers.length > 0) {
        actions.push(...handleEngineerCapture(state, playerId, aiState, engineers, enemies, baseCenter));
    }

    // Demo trucks, hijackers, air strikes - always active when enemies exist
    if (enemies.length > 0) {
        actions.push(...handleAirStrikes(state, playerId, enemies, aiState));
        actions.push(...handleDemoTruckAssault(state, playerId, enemies, aiState));
        actions.push(...handleHijackerAssault(state, playerId, enemies, aiState, baseCenter));
    }

    return actions;
}

export const infantryFortressAIImplementation: AIImplementation = {
    id: 'infantry_fortress',
    name: 'Infantry Fortress',
    description: 'Heavy base defenses with infantry swarms, hijackers, demo trucks, and engineers.',
    computeActions: ({ state, playerId, entityCache }) => computeInfantryFortressAiActions(state, playerId, entityCache),
    reset: resetAIState
};

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
import type { AIPlayerState } from '../../types.js';
import {
    AI_CONSTANTS,
    getDifficultyModifiers,
    hasProductionBuildingFor,
    checkPrerequisites
} from '../../utils.js';
import {
    detectThreats,
    updateStrategy,
    evaluateInvestmentPriority,
    findCaptureOpportunities
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
    handleUnitRepair,
    handleEngineerCapture,
    handleHijackerAssault
} from '../../action_combat.js';
import { updateHarvesterAI } from '../../harvester/index.js';
import { AIImplementation } from '../../contracts.js';
import { AIPersonality, RULES, isUnitData } from '../../../../data/schemas/index.js';
import {
    getSentinelOpportunistRuntimeState,
    resetSentinelOpportunistRuntimeState
} from './state.js';

type Phase = 'fortify' | 'expansion' | 'assault';

type StartBuildAction = Extract<Action, { type: 'START_BUILD' }>;

const sentinelOpportunistPersonality: AIPersonality = {
    aggression_bias: 0.8,
    retreat_threshold: 0.22,
    attack_threshold: 8,
    harass_threshold: 5,
    rally_offset: 180,
    build_order_priority: ['power', 'refinery', 'barracks', 'power', 'factory', 'refinery'],
    unit_preferences: {
        infantry: ['rocket', 'rifle', 'grenadier'],
        vehicle: ['heavy', 'artillery', 'light']
    },
    harvester_ratio: 2.4,
    credit_buffer: 800,
    kite_aggressiveness: 0.45,
    defense_investment: 4,
    max_chase_distance: 320,
    min_attack_group_size: 8,
    max_attack_group_size: 18
};

// Phase thresholds
const EXPANSION_MIN_INFANTRY = 8;
const EXPANSION_MIN_DEFENSES = 3;
const ASSAULT_MIN_TICK = 12000;
const ASSAULT_MIN_COMBAT_UNITS = 12;
const ASSAULT_MIN_DEFENSES = 4;

// Barracks targets
const TARGET_BARRACKS_FORTIFY = 1;
const TARGET_BARRACKS_EXPANSION = 2;
const TARGET_BARRACKS_ASSAULT = 2;

// Defense targets
const TARGET_DEFENSES_FORTIFY = 3;
const TARGET_DEFENSES_EXPANSION = 4;
const TARGET_DEFENSES_ASSAULT = 4;

const DEFENSE_BUILD_ORDER = ['turret', 'sam_site', 'pillbox', 'obelisk'];

// Garrison fractions and minimums
const GARRISON_FRACTION_FORTIFY = 0.65;
const GARRISON_FRACTION_EXPANSION = 0.45;
const GARRISON_FRACTION_ASSAULT = 0.30;
const GARRISON_MIN_FORTIFY = 3;
const GARRISON_MIN_EXPANSION = 3;
const GARRISON_MIN_ASSAULT = 2;
const GARRISON_PATROL_RADIUS = 300;

// Specialist gates and caps
const SPECIALIST_MAX_THREAT_LEVEL = 55;
const SPECIALIST_MIN_CREDITS = 1400;
const SPECIALIST_MIN_COMBAT_UNITS = 7;
const SPECIALIST_CAP_ENGINEER = 1;
const SPECIALIST_CAP_HIJACKER = 2;
const ENGINEER_CAPTURE_SCAN_DISTANCE = 1300;

// Production pacing
const INFANTRY_START_INTERVAL = 6;
const VEHICLE_START_INTERVAL = 9;

// Push windows
const PUSH_WINDOW_START_TICK = 12000;
const PUSH_WINDOW_INTERVAL = 2400;
const PUSH_WINDOW_DURATION = 900;
const PUSH_MIN_COMBAT_UNITS = 12;
const PUSH_MIN_DEFENSES = 4;
const PUSH_MIN_CREDITS = 1800;

// Rush tightening
const STRICT_RUSH_MIN_TICK = 900;
const STRICT_RUSH_MIN_EXPEDITIONARY = 6;
const STRICT_RUSH_COMBAT_RATIO = 1.4;
const STRICT_RUSH_VENGEANCE_BOOST = 260;

const NON_COMBAT_UNIT_KEYS = new Set(['harvester', 'mcv', 'engineer', 'induction_rig', 'hijacker', 'demo_truck']);
const VEHICLE_PRODUCTION_KEYS = ['heavy', 'artillery', 'light'] as const;
const TECH_CHAIN = ['factory', 'tech', 'airforce_command'] as const;

const INFANTRY_WEIGHTS: Record<Phase, Record<string, number>> = {
    fortify: {
        rocket: 4,
        rifle: 4,
        grenadier: 2
    },
    expansion: {
        rocket: 5,
        rifle: 3,
        grenadier: 2
    },
    assault: {
        rocket: 5,
        rifle: 2,
        grenadier: 3
    }
};

function determinePhase(
    tick: number,
    infantryCount: number,
    defenseCount: number,
    combatCount: number
): Phase {
    if (tick >= ASSAULT_MIN_TICK && combatCount >= ASSAULT_MIN_COMBAT_UNITS && defenseCount >= ASSAULT_MIN_DEFENSES) {
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

function choosePreferredInfantry(
    phase: Phase,
    myBuildings: Entity[],
    credits: number,
    tick: number
): string | null {
    const weights = INFANTRY_WEIGHTS[phase];
    const candidates: { key: string; weight: number }[] = [];
    let totalWeight = 0;

    for (const [key, weight] of Object.entries(weights)) {
        if (weight <= 0) continue;
        const data = RULES.units[key];
        if (!data) continue;
        if (data.cost > credits) continue;
        if (!checkPrerequisites(key, myBuildings)) continue;
        candidates.push({ key, weight });
        totalWeight += weight;
    }

    if (candidates.length === 0 || totalWeight <= 0) {
        return null;
    }

    const roll = tick % totalWeight;
    let cumulative = 0;
    for (const candidate of candidates) {
        cumulative += candidate.weight;
        if (roll < cumulative) {
            return candidate.key;
        }
    }

    return candidates[candidates.length - 1].key;
}

function choosePreferredVehicle(myBuildings: Entity[], credits: number, tick: number): string | null {
    const candidates: string[] = [];
    for (const key of VEHICLE_PRODUCTION_KEYS) {
        const data = RULES.units[key];
        if (!data) continue;
        if (data.cost > credits) continue;
        if (!checkPrerequisites(key, myBuildings)) continue;
        candidates.push(key);
    }

    if (candidates.length === 0) {
        return null;
    }

    return candidates[tick % candidates.length];
}

function enforceProductionBias(
    actions: Action[],
    playerId: number,
    phase: Phase,
    myBuildings: Entity[],
    credits: number,
    tick: number
): Action[] {
    const remapped: Action[] = [];
    let infantryCursor = 0;
    let vehicleCursor = 0;

    for (const action of actions) {
        if (!isActionType(action, 'START_BUILD')) {
            remapped.push(action);
            continue;
        }

        if (action.payload.category === 'infantry') {
            const preferred = choosePreferredInfantry(phase, myBuildings, credits, tick + infantryCursor);
            infantryCursor++;
            if (!preferred) {
                remapped.push(action);
                continue;
            }
            remapped.push({
                type: 'START_BUILD',
                payload: { category: 'infantry', key: preferred, playerId }
            });
            continue;
        }

        if (action.payload.category === 'vehicle') {
            const key = action.payload.key;
            if (key === 'harvester' || key === 'mcv') {
                remapped.push(action);
                continue;
            }

            const preferred = choosePreferredVehicle(myBuildings, credits, tick + vehicleCursor);
            vehicleCursor++;
            if (!preferred) {
                continue;
            }

            remapped.push({
                type: 'START_BUILD',
                payload: { category: 'vehicle', key: preferred, playerId }
            });
            continue;
        }

        remapped.push(action);
    }

    return remapped;
}

function ensureExtraBarracks(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    phase: Phase
): void {
    const target = phase === 'assault'
        ? TARGET_BARRACKS_ASSAULT
        : phase === 'expansion'
            ? TARGET_BARRACKS_EXPANSION
            : TARGET_BARRACKS_FORTIFY;

    const existingBarracks = myBuildings.filter(b => b.key === 'barracks' && !b.dead).length;
    if (existingBarracks >= target) return;

    const player = state.players[playerId];
    if (!player) return;
    if (player.queues.building.current) return;

    const hasConyard = myBuildings.some(b => b.key === 'conyard' && !b.dead);
    if (!hasConyard) return;

    const alreadyQueued = actions.some(action =>
        isActionType(action, 'START_BUILD') &&
        action.payload.category === 'building' &&
        action.payload.key === 'barracks'
    );
    if (alreadyQueued) return;

    if (!checkPrerequisites('barracks', myBuildings)) return;

    const barracksCost = RULES.buildings.barracks?.cost ?? 300;
    if (player.credits < barracksCost + 200) return;

    actions.push({
        type: 'START_BUILD',
        payload: { category: 'building', key: 'barracks', playerId }
    });
}

function queueDefenseIfPossible(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    phase: Phase,
    defenseCount: number
): void {
    const target = phase === 'assault'
        ? TARGET_DEFENSES_ASSAULT
        : phase === 'expansion'
            ? TARGET_DEFENSES_EXPANSION
            : TARGET_DEFENSES_FORTIFY;

    if (defenseCount >= target) return;

    const player = state.players[playerId];
    if (!player) return;

    const hasConyard = myBuildings.some(b => b.key === 'conyard' && !b.dead);
    if (!hasConyard) return;
    if (player.queues.building.current) return;

    const alreadyQueuedBuilding = actions.some(action =>
        isActionType(action, 'START_BUILD') && action.payload.category === 'building'
    );
    if (alreadyQueuedBuilding) return;

    for (const defenseKey of DEFENSE_BUILD_ORDER) {
        const data = RULES.buildings[defenseKey];
        if (!data) continue;
        if (!checkPrerequisites(defenseKey, myBuildings)) continue;
        if (player.credits < data.cost + 150) continue;

        actions.push({
            type: 'START_BUILD',
            payload: { category: 'building', key: defenseKey, playerId }
        });
        return;
    }
}

function getTargetDefensesForPhase(phase: Phase): number {
    return phase === 'assault'
        ? TARGET_DEFENSES_ASSAULT
        : phase === 'expansion'
            ? TARGET_DEFENSES_EXPANSION
            : TARGET_DEFENSES_FORTIFY;
}

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

    const alreadyQueuedBuilding = actions.some(action =>
        isActionType(action, 'START_BUILD') && action.payload.category === 'building'
    );
    if (alreadyQueuedBuilding) return;

    for (const key of TECH_CHAIN) {
        const exists = myBuildings.some(b => b.key === key && !b.dead);
        if (exists) continue;
        if (!checkPrerequisites(key, myBuildings)) break;

        const data = RULES.buildings[key];
        if (!data) continue;
        if (player.credits < data.cost + 250) break;

        actions.push({
            type: 'START_BUILD',
            payload: { category: 'building', key, playerId }
        });
        return;
    }
}

function countQueuedAndInProgress(player: GameState['players'][number], key: string): number {
    let count = 0;

    const queues = [player.queues.building, player.queues.infantry, player.queues.vehicle, player.queues.air];
    for (const queue of queues) {
        if (queue.current === key) {
            count++;
        }
        for (const queuedKey of queue.queued || []) {
            if (queuedKey === key) {
                count++;
            }
        }
    }

    return count;
}

function countPlannedBuilds(actions: Action[], key: string): number {
    let count = 0;
    for (const action of actions) {
        if (!isActionType(action, 'START_BUILD')) continue;
        if (action.payload.key === key) {
            count++;
        }
    }
    return count;
}

function getProjectedUnitCount(
    key: string,
    state: GameState,
    playerId: number,
    myUnits: Entity[],
    actions: Action[]
): number {
    const player = state.players[playerId];
    if (!player) return 0;

    const existing = myUnits.filter(unit => unit.key === key && !unit.dead).length;
    const queued = countQueuedAndInProgress(player, key);
    const planned = countPlannedBuilds(actions, key);
    return existing + queued + planned;
}

function countEnemyVehicles(enemies: Entity[]): number {
    return enemies.filter(enemy => {
        if (enemy.type !== 'UNIT' || enemy.dead) return false;
        const unitData = RULES.units[enemy.key];
        return Boolean(unitData && isUnitData(unitData) && unitData.type === 'vehicle');
    }).length;
}

function hasCapturableBuildingInRange(enemies: Entity[], baseCenter: Vector): boolean {
    return findCaptureOpportunities(enemies, baseCenter, ENGINEER_CAPTURE_SCAN_DISTANCE).length > 0;
}

function chooseSpecialistBuildKey(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    myUnits: Entity[],
    enemies: Entity[],
    baseCenter: Vector
): 'engineer' | 'hijacker' | null {
    const player = state.players[playerId];
    if (!player) return null;

    const projectedEngineer = getProjectedUnitCount('engineer', state, playerId, myUnits, actions);
    const canQueueEngineer = projectedEngineer < SPECIALIST_CAP_ENGINEER &&
        hasCapturableBuildingInRange(enemies, baseCenter) &&
        checkPrerequisites('engineer', myBuildings);
    if (canQueueEngineer) {
        const engineerCost = RULES.units.engineer?.cost ?? 500;
        if (player.credits >= engineerCost + 250) {
            return 'engineer';
        }
    }

    const enemyVehicleCount = countEnemyVehicles(enemies);
    const hijackerTarget = enemyVehicleCount >= 4
        ? 2
        : enemyVehicleCount >= 2
            ? 1
            : 0;
    const cappedHijackerTarget = Math.min(SPECIALIST_CAP_HIJACKER, hijackerTarget);
    const projectedHijackers = getProjectedUnitCount('hijacker', state, playerId, myUnits, actions);
    const canQueueHijacker = cappedHijackerTarget > 0 &&
        projectedHijackers < cappedHijackerTarget &&
        checkPrerequisites('hijacker', myBuildings);
    if (canQueueHijacker) {
        const hijackerCost = RULES.units.hijacker?.cost ?? 600;
        if (player.credits >= hijackerCost + 250) {
            return 'hijacker';
        }
    }

    return null;
}

function rewriteInfantryBuildForSpecialists(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    myUnits: Entity[],
    enemies: Entity[],
    baseCenter: Vector,
    specialistGateOpen: boolean
): Action[] {
    if (!specialistGateOpen) return actions;
    if (actions.some(action =>
        isActionType(action, 'START_BUILD') &&
        action.payload.category === 'infantry' &&
        (action.payload.key === 'engineer' || action.payload.key === 'hijacker')
    )) {
        return actions;
    }

    const specialistKey = chooseSpecialistBuildKey(actions, state, playerId, myBuildings, myUnits, enemies, baseCenter);
    if (!specialistKey) return actions;

    const rewritten: Action[] = [];
    let replaced = false;
    for (const action of actions) {
        if (!replaced &&
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'infantry') {
            rewritten.push({
                type: 'START_BUILD',
                payload: { category: 'infantry', key: specialistKey, playerId }
            });
            replaced = true;
            continue;
        }
        rewritten.push(action);
    }

    return rewritten;
}

function queueSpecialInfantry(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    myUnits: Entity[],
    enemies: Entity[],
    baseCenter: Vector,
    phase: Phase,
    specialistGateOpen: boolean
): void {
    const player = state.players[playerId];
    if (!player) return;
    if (!hasProductionBuildingFor('infantry', myBuildings)) return;
    if (player.queues.infantry.current) return;
    if (actions.some(isInfantryBuildAction)) return;

    if (specialistGateOpen) {
        const specialistKey = chooseSpecialistBuildKey(actions, state, playerId, myBuildings, myUnits, enemies, baseCenter);
        if (specialistKey) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'infantry', key: specialistKey, playerId }
            });
            return;
        }
    }

    const preferred = choosePreferredInfantry(phase, myBuildings, player.credits, state.tick);
    if (!preferred) return;

    actions.push({
        type: 'START_BUILD',
        payload: { category: 'infantry', key: preferred, playerId }
    });
}

function queueVehicleIfPossible(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[]
): void {
    const player = state.players[playerId];
    if (!player) return;
    if (!hasProductionBuildingFor('vehicle', myBuildings)) return;
    if (player.queues.vehicle.current) return;

    const hasQueuedVehicle = actions.some(action =>
        isActionType(action, 'START_BUILD') && action.payload.category === 'vehicle'
    );
    if (hasQueuedVehicle) return;

    const preferred = choosePreferredVehicle(myBuildings, player.credits, state.tick);
    if (!preferred) return;

    const cost = RULES.units[preferred]?.cost ?? 1200;
    if (player.credits < cost + 200) return;

    actions.push({
        type: 'START_BUILD',
        payload: { category: 'vehicle', key: preferred, playerId }
    });
}

function removeDemoTruckBuildActions(actions: Action[]): Action[] {
    return actions.filter(action =>
        !(
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'vehicle' &&
            action.payload.key === 'demo_truck'
        )
    );
}

function enforceSpecialistCaps(
    actions: Action[],
    state: GameState,
    playerId: number,
    myUnits: Entity[]
): Action[] {
    const player = state.players[playerId];
    if (!player) return actions;

    let projectedEngineer = myUnits.filter(unit => unit.key === 'engineer' && !unit.dead).length +
        countQueuedAndInProgress(player, 'engineer');
    let projectedHijacker = myUnits.filter(unit => unit.key === 'hijacker' && !unit.dead).length +
        countQueuedAndInProgress(player, 'hijacker');

    const filtered: Action[] = [];
    for (const action of actions) {
        if (!isActionType(action, 'START_BUILD') || action.payload.category !== 'infantry') {
            filtered.push(action);
            continue;
        }

        if (action.payload.key === 'engineer') {
            if (projectedEngineer >= SPECIALIST_CAP_ENGINEER) {
                continue;
            }
            projectedEngineer++;
        }

        if (action.payload.key === 'hijacker') {
            if (projectedHijacker >= SPECIALIST_CAP_HIJACKER) {
                continue;
            }
            projectedHijacker++;
        }

        filtered.push(action);
    }

    return filtered;
}

function applyProductionPacing(
    actions: Action[],
    tick: number,
    isSafeForPacing: boolean,
    runtime: ReturnType<typeof getSentinelOpportunistRuntimeState>
): Action[] {
    const paced: Action[] = [];

    for (const action of actions) {
        if (!isActionType(action, 'START_BUILD')) {
            paced.push(action);
            continue;
        }

        if (action.payload.category === 'infantry') {
            const canStart = !isSafeForPacing || tick - runtime.lastInfantryStartTick >= INFANTRY_START_INTERVAL;
            if (!canStart) {
                continue;
            }
            runtime.lastInfantryStartTick = tick;
            paced.push(action);
            continue;
        }

        if (action.payload.category === 'vehicle') {
            const canStart = !isSafeForPacing || tick - runtime.lastVehicleStartTick >= VEHICLE_START_INTERVAL;
            if (!canStart) {
                continue;
            }
            runtime.lastVehicleStartTick = tick;
            paced.push(action);
            continue;
        }

        paced.push(action);
    }

    return paced;
}

function isInfantryUnit(unit: Entity): boolean {
    if (unit.type !== 'UNIT' || unit.dead) return false;
    const data = RULES.units[unit.key];
    return Boolean(data && isUnitData(data) && data.type === 'infantry');
}

function maintainBaseGarrison(
    state: GameState,
    aiState: AIPlayerState,
    combatUnits: Entity[],
    baseCenter: Vector,
    phase: Phase
): { garrison: Entity[]; expeditionary: Entity[] } {
    const fraction = phase === 'fortify'
        ? GARRISON_FRACTION_FORTIFY
        : phase === 'expansion'
            ? GARRISON_FRACTION_EXPANSION
            : GARRISON_FRACTION_ASSAULT;

    const minimum = phase === 'fortify'
        ? GARRISON_MIN_FORTIFY
        : phase === 'expansion'
            ? GARRISON_MIN_EXPANSION
            : GARRISON_MIN_ASSAULT;

    const desiredGarrisonSize = Math.min(
        combatUnits.length,
        Math.max(minimum, Math.ceil(combatUnits.length * fraction))
    );

    aiState.defenseGroup = aiState.defenseGroup.filter(id => {
        const entity = state.entities[id];
        return entity && !entity.dead;
    });

    const combatIds = new Set(combatUnits.map(unit => unit.id));
    aiState.defenseGroup = aiState.defenseGroup.filter(id => combatIds.has(id));

    while (aiState.defenseGroup.length > desiredGarrisonSize) {
        aiState.defenseGroup.pop();
    }

    if (aiState.defenseGroup.length < desiredGarrisonSize) {
        const garrisonSet = new Set(aiState.defenseGroup);
        const candidates = combatUnits
            .filter(unit =>
                !garrisonSet.has(unit.id) &&
                !aiState.attackGroup.includes(unit.id) &&
                !aiState.harassGroup.includes(unit.id)
            )
            .sort((a, b) => a.pos.dist(baseCenter) - b.pos.dist(baseCenter));

        for (const candidate of candidates) {
            if (aiState.defenseGroup.length >= desiredGarrisonSize) break;
            aiState.defenseGroup.push(candidate.id);
        }
    }

    const garrisonSet = new Set<EntityId>(aiState.defenseGroup);
    return {
        garrison: combatUnits.filter(unit => garrisonSet.has(unit.id)),
        expeditionary: combatUnits.filter(unit => !garrisonSet.has(unit.id))
    };
}

function handleGarrisonPatrol(
    aiState: AIPlayerState,
    garrison: Entity[],
    baseCenter: Vector
): Action[] {
    const actions: Action[] = [];

    if (aiState.threatsNearBase.length > 0) return actions;

    const idleGarrison = garrison.filter(unit => {
        const combatUnit = unit as UnitEntity;
        return !combatUnit.movement.moveTarget && !combatUnit.combat.targetId;
    });

    if (idleGarrison.length === 0) return actions;

    const farFromBase = idleGarrison.filter(unit => unit.pos.dist(baseCenter) > GARRISON_PATROL_RADIUS);
    for (let i = 0; i < farFromBase.length; i++) {
        const angle = (i / Math.max(1, farFromBase.length)) * Math.PI * 2;
        const targetX = baseCenter.x + Math.cos(angle) * (GARRISON_PATROL_RADIUS * 0.65);
        const targetY = baseCenter.y + Math.sin(angle) * (GARRISON_PATROL_RADIUS * 0.65);
        actions.push({
            type: 'COMMAND_MOVE',
            payload: {
                unitIds: [farFromBase[i].id],
                x: targetX,
                y: targetY
            }
        });
    }

    return actions;
}

function isDefenseBuilding(building: Entity): boolean {
    if (building.type !== 'BUILDING' || building.dead) return false;
    return Boolean(RULES.buildings[building.key]?.isDefense);
}

function isCombatUnitKey(key: string): boolean {
    if (NON_COMBAT_UNIT_KEYS.has(key)) return false;
    const unitData = RULES.units[key];
    return Boolean(unitData && unitData.damage > 0);
}

function findStrictRushTarget(
    state: GameState,
    cache: ReturnType<typeof createEntityCache>,
    playerId: number,
    baseCenter: Vector,
    myCombatCount: number,
    expeditionaryCount: number,
    aiState: AIPlayerState
): { ownerId: number; targetPos: Vector } | null {
    if (state.tick < STRICT_RUSH_MIN_TICK) return null;
    if (expeditionaryCount < STRICT_RUSH_MIN_EXPEDITIONARY) return null;

    const enemyOwnerIds = Array.from(cache.byOwner.keys()).filter(id => id !== playerId && id !== -1);
    let best: { ownerId: number; targetPos: Vector } | null = null;
    let bestScore = -Infinity;

    for (const ownerId of enemyOwnerIds) {
        const enemyBuildings = getBuildingsForOwner(cache, ownerId);
        if (enemyBuildings.length === 0) continue;

        const enemyUnits = getUnitsForOwner(cache, ownerId);
        const enemyCombatUnits = enemyUnits.filter(unit => isCombatUnitKey(unit.key));
        const enemyDefenses = enemyBuildings.filter(building => Boolean(RULES.buildings[building.key]?.isDefense));

        const ratio = myCombatCount / Math.max(1, enemyCombatUnits.length);
        if (ratio < STRICT_RUSH_COMBAT_RATIO) continue;

        const enemyRefineries = enemyBuildings.filter(building => building.key === 'refinery').length;
        const boomScore = aiState.enemyIntelligence.boomScores[ownerId] || 0;
        const isVulnerable = enemyDefenses.length <= 1 || boomScore >= 25 || enemyRefineries >= 3;
        if (!isVulnerable) continue;

        const primaryTarget =
            enemyBuildings.find(building => building.key === 'conyard') ||
            enemyBuildings.find(building => building.key === 'factory') ||
            enemyBuildings.find(building => building.key === 'tech') ||
            enemyBuildings.find(building => building.key === 'refinery') ||
            enemyBuildings[0];

        const score = ratio * 120 + boomScore * 6 - enemyDefenses.length * 30 - primaryTarget.pos.dist(baseCenter) * 0.45;
        if (score > bestScore) {
            bestScore = score;
            best = { ownerId, targetPos: primaryTarget.pos };
        }
    }

    return best;
}

function getPushWindowStartTick(tick: number): number | null {
    if (tick < PUSH_WINDOW_START_TICK) return null;
    const delta = tick - PUSH_WINDOW_START_TICK;
    return tick - (delta % PUSH_WINDOW_INTERVAL);
}

function isInPushWindow(tick: number): boolean {
    if (tick < PUSH_WINDOW_START_TICK) return false;
    const delta = tick - PUSH_WINDOW_START_TICK;
    return (delta % PUSH_WINDOW_INTERVAL) < PUSH_WINDOW_DURATION;
}

function shouldForcePush(
    tick: number,
    hasImmediateThreat: boolean,
    combatCount: number,
    defenseCount: number,
    credits: number,
    enemyCombatCount: number
): boolean {
    const requiredCombatCount = Math.max(PUSH_MIN_COMBAT_UNITS, Math.ceil(enemyCombatCount * 1.1));
    return isInPushWindow(tick) &&
        !hasImmediateThreat &&
        combatCount >= requiredCombatCount &&
        defenseCount >= PUSH_MIN_DEFENSES &&
        credits >= PUSH_MIN_CREDITS;
}

function isSpecialistGateOpen(
    aiState: AIPlayerState,
    hasImmediateThreat: boolean,
    credits: number,
    combatCount: number
): boolean {
    return !hasImmediateThreat &&
        aiState.threatLevel < SPECIALIST_MAX_THREAT_LEVEL &&
        credits >= SPECIALIST_MIN_CREDITS &&
        combatCount >= SPECIALIST_MIN_COMBAT_UNITS;
}

export function computeSentinelOpportunistAiActions(state: GameState, playerId: number, sharedCache?: EntityCache): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const aiState = getAIState(playerId);
    const runtime = getSentinelOpportunistRuntimeState(playerId);

    const cache = sharedCache ?? createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId);

    const hasMCV = myUnits.some(unit => unit.key === 'mcv');
    if (myBuildings.length === 0 && !hasMCV) {
        return actions;
    }

    const harvesters = myUnits.filter(unit => unit.key === 'harvester');
    const combatUnits = myUnits.filter(unit =>
        unit.key !== 'harvester' &&
        unit.key !== 'mcv' &&
        unit.key !== 'engineer' &&
        unit.key !== 'hijacker' &&
        unit.key !== 'demo_truck'
    );

    const infantry = myUnits.filter(isInfantryUnit);
    const defenses = myBuildings.filter(isDefenseBuilding);
    const enemyCombatCount = enemies.filter(unit => unit.type === 'UNIT' && isCombatUnitKey(unit.key)).length;
    const hasFactory = myBuildings.some(building => building.key === 'factory' && !building.dead);

    const phase = determinePhase(state.tick, infantry.length, defenses.length, combatUnits.length);
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
    const { garrison, expeditionary } = maintainBaseGarrison(state, aiState, combatUnits, baseCenter, phase);

    if (!isDummy) {
        actions.push(...handleHarvesterSafety(
            state,
            playerId,
            harvesters,
            combatUnits,
            baseCenter,
            enemies,
            aiState,
            cache,
            player.difficulty
        ));

        const reactionDelayPassed = hasImmediateThreat &&
            (state.tick - aiState.lastThreatDetectedTick >= difficultyMods.reactionDelay);

        if (reactionDelayPassed && combatUnits.length > 0) {
            actions.push(...handleDefense(state, playerId, aiState, combatUnits, baseCenter, sentinelOpportunistPersonality));
        }

        actions.push(...handleGarrisonPatrol(aiState, garrison, baseCenter));
    }

    const pushWindowStart = getPushWindowStartTick(state.tick);
    if (pushWindowStart !== null && pushWindowStart !== runtime.lastPushWindowStartTick) {
        runtime.lastPushWindowStartTick = pushWindowStart;
    }

    if (!isFullComputeTick) {
        const canPushOffTick = !isDummy &&
            expeditionary.length > 0 &&
            enemies.length > 0 &&
            shouldForcePush(state.tick, hasImmediateThreat, combatUnits.length, defenses.length, player.credits, enemyCombatCount);

        if (canPushOffTick) {
            runtime.lastPushActivationTick = state.tick;
            actions.push(...handleAttack(
                state,
                playerId,
                aiState,
                expeditionary,
                enemies,
                baseCenter,
                sentinelOpportunistPersonality,
                true
            ));
        }

        let throttledActions = removeDemoTruckBuildActions(actions);
        throttledActions = enforceSpecialistCaps(throttledActions, state, playerId, myUnits);
        const pacingSafe = !hasImmediateThreat && defenses.length >= getTargetDefensesForPhase(phase);
        throttledActions = applyProductionPacing(throttledActions, state.tick, pacingSafe, runtime);
        return throttledActions;
    }

    updateStrategy(
        aiState,
        state.tick,
        myBuildings,
        combatUnits,
        enemies,
        aiState.threatsNearBase,
        sentinelOpportunistPersonality,
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

    const strictRushTarget = findStrictRushTarget(
        state,
        cache,
        playerId,
        baseCenter,
        combatUnits.length,
        expeditionary.length,
        aiState
    );

    const forcePush = enemies.length > 0 &&
        expeditionary.length > 0 &&
        shouldForcePush(state.tick, hasImmediateThreat, combatUnits.length, defenses.length, player.credits, enemyCombatCount);

    if (forcePush) {
        aiState.strategy = 'attack';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = expeditionary.map(unit => unit.id);
        aiState.harassGroup = [];
        runtime.lastPushActivationTick = state.tick;
    } else if (strictRushTarget) {
        aiState.strategy = 'attack';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = expeditionary.map(unit => unit.id);
        aiState.harassGroup = [];
        aiState.vengeanceScores[strictRushTarget.ownerId] = Math.max(
            aiState.vengeanceScores[strictRushTarget.ownerId] || 0,
            STRICT_RUSH_VENGEANCE_BOOST
        );
    } else if (!hasImmediateThreat) {
        aiState.strategy = 'buildup';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = [];
        aiState.harassGroup = [];
        aiState.offensiveGroups = [];
    }

    if (player.readyToPlace) {
        actions.push(...handleBuildingPlacement(state, playerId, myBuildings, player));
    }

    actions.push(...handleEmergencySell(state, playerId, myBuildings, player, aiState));
    actions.push(...handleLastResortSell(state, playerId, myBuildings, player, aiState));
    actions.push(...handleAllInSell(state, playerId, myBuildings, aiState));

    let economyActions = handleEconomy(
        state,
        playerId,
        myBuildings,
        player,
        sentinelOpportunistPersonality,
        aiState,
        enemies,
        cache
    );

    economyActions = enforceProductionBias(
        economyActions,
        playerId,
        phase,
        myBuildings,
        player.credits,
        state.tick
    );
    const specialistGateOpen = isSpecialistGateOpen(aiState, hasImmediateThreat, player.credits, combatUnits.length);
    economyActions = rewriteInfantryBuildForSpecialists(
        economyActions,
        state,
        playerId,
        myBuildings,
        myUnits,
        enemies,
        baseCenter,
        specialistGateOpen
    );
    economyActions = removeDemoTruckBuildActions(economyActions);

    actions.push(...economyActions);
    actions.push(...handleMCVOperations(state, playerId, aiState, myBuildings, myUnits));
    actions.push(...handleInductionRigOperations(state, playerId, myBuildings, myUnits));

    queueDefenseIfPossible(actions, state, playerId, myBuildings, phase, defenses.length);
    ensureExtraBarracks(actions, state, playerId, myBuildings, phase);
    ensureTechChain(actions, state, playerId, myBuildings);

    queueSpecialInfantry(actions, state, playerId, myBuildings, myUnits, enemies, baseCenter, phase, specialistGateOpen);

    if (hasFactory) {
        queueVehicleIfPossible(actions, state, playerId, myBuildings);
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
        let throttledActions = removeDemoTruckBuildActions(actions);
        throttledActions = enforceSpecialistCaps(throttledActions, state, playerId, myUnits);
        const pacingSafe = !hasImmediateThreat && defenses.length >= getTargetDefensesForPhase(phase);
        throttledActions = applyProductionPacing(throttledActions, state.tick, pacingSafe, runtime);
        return throttledActions;
    }

    const isRushing = strictRushTarget !== null;
    const ignoreSizeLimit = forcePush || isRushing;

    if (aiState.strategy === 'attack' || aiState.strategy === 'all_in') {
        actions.push(...handleAttack(
            state,
            playerId,
            aiState,
            expeditionary,
            enemies,
            baseCenter,
            sentinelOpportunistPersonality,
            ignoreSizeLimit
        ));
    } else if (aiState.strategy === 'harass') {
        actions.push(...handleHarass(state, playerId, aiState, expeditionary, enemies));
    } else {
        actions.push(...handleRally(state, playerId, aiState, expeditionary, baseCenter, enemies));
    }

    actions.push(...handleScouting(state, playerId, aiState, expeditionary, enemies, baseCenter));
    actions.push(...handleMicro(state, combatUnits, enemies, baseCenter, sentinelOpportunistPersonality, myBuildings, player.difficulty));
    actions.push(...handleUnitRepair(state, playerId, combatUnits, myBuildings));

    const engineers = myUnits.filter(unit => unit.key === 'engineer' && !unit.dead);
    if (engineers.length > 0) {
        actions.push(...handleEngineerCapture(state, playerId, aiState, engineers, enemies, baseCenter));
    }

    if (enemies.length > 0) {
        actions.push(...handleAirStrikes(state, playerId, enemies, aiState));
        actions.push(...handleHijackerAssault(state, playerId, enemies, aiState, baseCenter));
    }

    let finalActions = removeDemoTruckBuildActions(actions);
    finalActions = enforceSpecialistCaps(finalActions, state, playerId, myUnits);
    const pacingSafe = !hasImmediateThreat && defenses.length >= getTargetDefensesForPhase(phase);
    finalActions = applyProductionPacing(finalActions, state.tick, pacingSafe, runtime);

    return finalActions;
}

function resetSentinelOpportunistAI(playerId?: number): void {
    resetAIState(playerId);
    resetSentinelOpportunistRuntimeState(playerId);
}

export const SentinelOpportunistAIImplementation: AIImplementation = {
    id: 'sentinel_opportunist',
    name: 'Sentinel Opportunist',
    description: 'Defense-first macro AI with paced production, timed push windows, and opportunistic engineers/hijackers.',
    computeActions: ({ state, playerId, entityCache }) => computeSentinelOpportunistAiActions(state, playerId, entityCache),
    reset: resetSentinelOpportunistAI
};

import { GameState, Action, Entity, isActionType } from '../../../types.js';
import { createEntityCache, getEnemiesOf, getBuildingsForOwner, getUnitsForOwner } from '../../../perf.js';
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
    handleEngineerCapture
} from '../../action_combat.js';
import { updateHarvesterAI } from '../../harvester/index.js';
import { AIImplementation } from '../../contracts.js';
import { AIPersonality, RULES } from '../../../../data/schemas/index.js';

const COMMIT_REFINERIES = 4;
const COMMIT_TANKS = 8;
const COMMIT_HEAVIES = 3;
const FORCE_COMMIT_TICK = 25200;
const FORCE_COMMIT_MIN_TANKS = 5;

const TANK_KEYS = new Set(['heavy', 'light']);

type VehicleStartBuildAction = Extract<Action, { type: 'START_BUILD' }> & {
    payload: { category: 'vehicle'; key: string; playerId: number };
};

type StartBuildAction = Extract<Action, { type: 'START_BUILD' }>;

const ecoTankAllInPersonality: AIPersonality = {
    aggression_bias: 1.3,
    retreat_threshold: 0.2,
    attack_threshold: 6,
    harass_threshold: 999,
    rally_offset: 220,
    build_order_priority: ['power', 'refinery', 'barracks', 'factory', 'refinery', 'power'],
    unit_preferences: {
        infantry: ['rocket', 'rifle', 'grenadier'],
        vehicle: ['heavy', 'light', 'flame_tank']
    },
    harvester_ratio: 2.0,
    credit_buffer: 200,
    kite_aggressiveness: 0.35,
    defense_investment: 1,
    max_chase_distance: 500,
    min_attack_group_size: 4,
    max_attack_group_size: 20
};

function isTankUnit(unit: Entity): boolean {
    return unit.type === 'UNIT' && TANK_KEYS.has(unit.key) && !unit.dead;
}

function isDefenseBuildAction(action: Action): boolean {
    if (!isActionType(action, 'START_BUILD')) return false;
    if (action.payload.category !== 'building') return false;
    return Boolean(RULES.buildings[action.payload.key]?.isDefense);
}

function isInfantryBuildAction(action: Action): action is StartBuildAction {
    return isActionType(action, 'START_BUILD') && action.payload.category === 'infantry';
}

function isBarracksBuildAction(action: Action): action is StartBuildAction {
    return isActionType(action, 'START_BUILD') &&
        action.payload.category === 'building' &&
        action.payload.key === 'barracks';
}

function isVehicleBuildAction(action: Action): action is VehicleStartBuildAction {
    return isActionType(action, 'START_BUILD') && action.payload.category === 'vehicle';
}

function isTankVehicleBuildAction(action: Action): boolean {
    return isVehicleBuildAction(action) && TANK_KEYS.has(action.payload.key);
}

function removeProactiveDefenseBuilds(actions: Action[], hasImmediateThreat: boolean): Action[] {
    if (hasImmediateThreat) {
        return actions;
    }

    return actions.filter(action => !isDefenseBuildAction(action));
}

function removeInfantryAndExtraBarracksBuilds(actions: Action[], myBuildings: Entity[]): Action[] {
    const existingBarracks = myBuildings.filter(b => b.key === 'barracks' && !b.dead).length;

    return actions.filter(action => {
        if (isInfantryBuildAction(action)) {
            return false;
        }
        if (isBarracksBuildAction(action) && existingBarracks >= 1) {
            return false;
        }
        return true;
    });
}

function choosePreferredTank(myBuildings: Entity[], credits: number): 'heavy' | 'light' | null {
    const canBuildHeavy = checkPrerequisites('heavy', myBuildings);
    const canBuildLight = checkPrerequisites('light', myBuildings);

    if (!canBuildHeavy && !canBuildLight) {
        return null;
    }

    const heavyCost = RULES.units['heavy']?.cost || 1600;
    if (canBuildHeavy && (credits >= heavyCost || !canBuildLight)) {
        return 'heavy';
    }

    if (canBuildLight) {
        return 'light';
    }

    return canBuildHeavy ? 'heavy' : null;
}

function enforceTankProductionBias(
    actions: Action[],
    playerId: number,
    myBuildings: Entity[],
    credits: number
): Action[] {
    const preferredTank = choosePreferredTank(myBuildings, credits);
    if (!preferredTank) {
        return actions;
    }

    let hasTankQueued = actions.some(isTankVehicleBuildAction);
    if (hasTankQueued) {
        return actions;
    }

    let replaced = false;
    const mapped = actions.map(action => {
        if (!isVehicleBuildAction(action)) return action;
        if (action.payload.key === 'harvester') return action;

        if (!replaced) {
            replaced = true;
            hasTankQueued = true;
            return {
                type: 'START_BUILD',
                payload: { category: 'vehicle', key: preferredTank, playerId }
            } satisfies Action;
        }

        return null;
    }).filter((action): action is Action => action !== null);

    return mapped;
}

function queueTankIfPossible(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[]
): void {
    const player = state.players[playerId];
    if (!player) return;
    if (!hasProductionBuildingFor('vehicle', myBuildings)) return;
    if (player.queues.vehicle.current) return;
    if (actions.some(isTankVehicleBuildAction)) return;

    const preferredTank = choosePreferredTank(myBuildings, player.credits);
    if (!preferredTank) return;

    actions.push({
        type: 'START_BUILD',
        payload: { category: 'vehicle', key: preferredTank, playerId }
    });
}

export function computeEcoTankAllInAiActions(state: GameState, playerId: number): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const aiState = getAIState(playerId);

    const cache = createEntityCache(state.entities);
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
        u.key !== 'demo_truck'
    );
    const tanks = myUnits.filter(isTankUnit);
    const heavies = tanks.filter(unit => unit.key === 'heavy');
    const refineries = myBuildings.filter(b => b.key === 'refinery' && !b.dead);

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

    const ecoHarvesterTarget = Math.max(
        Math.ceil(refineries.length * (ecoTankAllInPersonality.harvester_ratio ?? 2)),
        2
    );
    const underEcoGoals = refineries.length < COMMIT_REFINERIES || harvesters.length < ecoHarvesterTarget;

    const commitByThresholds = refineries.length >= COMMIT_REFINERIES &&
        tanks.length >= COMMIT_TANKS &&
        heavies.length >= COMMIT_HEAVIES;
    const commitByTime = state.tick >= FORCE_COMMIT_TICK && tanks.length >= FORCE_COMMIT_MIN_TANKS;
    const shouldCommitNow = enemies.length > 0 && (commitByThresholds || commitByTime);

    if (shouldCommitNow && aiState.allInStartTick === 0) {
        aiState.allInStartTick = state.tick;
    }

    const inCommitPush = aiState.allInStartTick > 0;
    const isDummy = player.difficulty === 'dummy';

    if (!isDummy) {
        actions.push(...handleHarvesterSafety(state, playerId, harvesters, combatUnits, baseCenter, enemies, aiState, cache, player.difficulty));

        const reactionDelayPassed = hasImmediateThreat &&
            (state.tick - aiState.lastThreatDetectedTick >= difficultyMods.reactionDelay);

        if (reactionDelayPassed && combatUnits.length > 0) {
            actions.push(...handleDefense(state, playerId, aiState, combatUnits, baseCenter, ecoTankAllInPersonality));
        }
    }

    if (!isFullComputeTick) {
        if (!isDummy && inCommitPush && combatUnits.length > 0 && enemies.length > 0) {
            actions.push(...handleAttack(state, playerId, aiState, combatUnits, enemies, baseCenter, ecoTankAllInPersonality, true));
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
        ecoTankAllInPersonality,
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

    if (!inCommitPush && aiState.strategy === 'all_in') {
        aiState.strategy = 'buildup';
        aiState.allInStartTick = 0;
    }

    if (!inCommitPush && underEcoGoals) {
        aiState.investmentPriority = 'economy';
    }

    if (!inCommitPush && !hasImmediateThreat) {
        aiState.strategy = 'buildup';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = [];
        aiState.harassGroup = [];
        aiState.offensiveGroups = [];
    }

    if (inCommitPush) {
        aiState.strategy = 'attack';
        aiState.lastStrategyChange = state.tick;
        aiState.attackGroup = combatUnits.map(unit => unit.id);
        aiState.harassGroup = [];
    }

    if (player.readyToPlace) {
        actions.push(...handleBuildingPlacement(state, playerId, myBuildings, player));
    }

    actions.push(...handleEmergencySell(state, playerId, myBuildings, player, aiState));
    actions.push(...handleLastResortSell(state, playerId, myBuildings, player, aiState));

    if (!inCommitPush) {
        let economyActions = handleEconomy(
            state,
            playerId,
            myBuildings,
            player,
            ecoTankAllInPersonality,
            aiState,
            enemies
        );
        economyActions = removeProactiveDefenseBuilds(economyActions, hasImmediateThreat);
        economyActions = removeInfantryAndExtraBarracksBuilds(economyActions, myBuildings);

        if (!underEcoGoals) {
            economyActions = enforceTankProductionBias(economyActions, playerId, myBuildings, player.credits);
        }

        actions.push(...economyActions);
        actions.push(...handleMCVOperations(state, playerId, aiState, myBuildings, myUnits));
        actions.push(...handleInductionRigOperations(state, playerId, myBuildings, myUnits));
    } else {
        queueTankIfPossible(actions, state, playerId, myBuildings);
    }

    actions.push(...handleBuildingRepair(state, playerId, myBuildings, player, aiState));
    actions.push(...handleHarvesterGathering(state, playerId, harvesters, aiState.harvestersUnderAttack, aiState, player.difficulty));

    if (!inCommitPush && !underEcoGoals) {
        queueTankIfPossible(actions, state, playerId, myBuildings);
    }

    const harvesterResult = updateHarvesterAI(
        aiState.harvesterAI,
        playerId,
        state,
        player.difficulty
    );
    aiState.harvesterAI = harvesterResult.harvesterAI;
    actions.push(...harvesterResult.actions);

    if (isDummy) {
        actions.push(...handleRally(state, playerId, aiState, combatUnits, baseCenter, enemies));
        return actions;
    }

    if (inCommitPush) {
        actions.push(...handleAttack(state, playerId, aiState, combatUnits, enemies, baseCenter, ecoTankAllInPersonality, true));
    } else if (aiState.strategy === 'attack' || aiState.strategy === 'all_in') {
        actions.push(...handleAttack(state, playerId, aiState, combatUnits, enemies, baseCenter, ecoTankAllInPersonality, false));
    } else if (aiState.strategy === 'harass') {
        actions.push(...handleHarass(state, playerId, aiState, combatUnits, enemies));
    } else {
        actions.push(...handleRally(state, playerId, aiState, combatUnits, baseCenter, enemies));
    }

    actions.push(...handleScouting(state, playerId, aiState, combatUnits, enemies, baseCenter));
    actions.push(...handleMicro(state, combatUnits, enemies, baseCenter, ecoTankAllInPersonality, myBuildings, player.difficulty));
    actions.push(...handleUnitRepair(state, playerId, combatUnits, myBuildings));

    const engineers = myUnits.filter(u => u.key === 'engineer' && !u.dead);
    if (engineers.length > 0) {
        actions.push(...handleEngineerCapture(state, playerId, aiState, engineers, enemies, baseCenter));
    }

    if (enemies.length > 0) {
        actions.push(...handleAirStrikes(state, playerId, enemies, aiState));
        actions.push(...handleDemoTruckAssault(state, playerId, enemies, aiState));
    }

    return actions;
}

export const ecoTankAllInAIImplementation: AIImplementation = {
    id: 'eco_tank_all_in',
    name: 'Eco Tank All-In',
    description: 'Fast economy into heavy tank massing, then committed attack pressure.',
    computeActions: ({ state, playerId }) => computeEcoTankAllInAiActions(state, playerId),
    reset: resetAIState
};

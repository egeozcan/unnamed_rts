import { Action, Entity, GameState, isActionType } from '../../../types.js';
import { createEntityCache, EntityCache, getBuildingsForOwner, getEnemiesOf, getUnitsForOwner } from '../../../perf.js';
import { RULES } from '../../../../data/schemas/index.js';
import { AIImplementation, AIImplementationDifficulty } from '../../contracts.js';
import { computeAuroraTitanSnapshotAiActions } from './titan_core_snapshot.js';
import { checkPrerequisites, hasProductionBuildingFor } from '../../utils.js';
import { getAIState, resetAIState } from '../../state.js';

type RuntimeState = {
    lastRallyTick: number;
    lastPressureTick: number;
};

const runtimeByPlayer = new Map<number, RuntimeState>();

const NON_COMBAT_KEYS = new Set([
    'harvester',
    'mcv',
    'engineer',
    'induction_rig',
    'demo_truck',
    'hijacker',
    'harrier'
]);

const BASE_THREAT_RADIUS = 420;
const RALLY_COOLDOWN = 180;
const PRESSURE_COOLDOWN = 75;
const PRESSURE_COOLDOWN_CAUTIOUS = 140;

function getRuntimeState(playerId: number, tick: number): RuntimeState {
    const existing = runtimeByPlayer.get(playerId);
    if (existing && tick > 0) {
        return existing;
    }

    const created: RuntimeState = {
        lastRallyTick: 0,
        lastPressureTick: 0
    };
    runtimeByPlayer.set(playerId, created);
    return created;
}

function isCombatUnit(entity: Entity): boolean {
    return entity.type === 'UNIT' && !entity.dead && !NON_COMBAT_KEYS.has(entity.key);
}

type TacticalProfile = {
    heavyProfile: boolean;
    cautiousDefense: boolean;
    cautiousPressure: boolean;
    economyConservative: boolean;
};

function deriveTacticalProfile(
    state: GameState,
    playerId: number,
    combatCount: number,
    enemyCombatCount: number,
    enemyDefenseCount: number,
    enemyFactoryCount: number,
    enemyTechCount: number,
    localThreatCount: number
): TacticalProfile {
    const earlyGame = state.tick < 9000;
    const behindArmy = combatCount + 1 < enemyCombatCount;
    const sideCompensate = playerId === 1;
    const nearbyThreat = localThreatCount >= (sideCompensate ? 1 : 2);

    const enemyAdvancedMacro = enemyFactoryCount >= 2 || enemyTechCount > 0;
    const enemyEntrenched = enemyDefenseCount >= 2;
    const heavyProfile = enemyAdvancedMacro ||
        enemyEntrenched ||
        enemyCombatCount >= 8 ||
        behindArmy ||
        (sideCompensate && state.tick < 6500 && enemyFactoryCount >= 1);

    const cautiousDefense = earlyGame &&
        (nearbyThreat || behindArmy || enemyCombatCount >= (sideCompensate ? 5 : 6));
    const cautiousPressure = nearbyThreat ||
        (behindArmy && state.tick < (sideCompensate ? 14000 : 12000));
    const economyConservative = (sideCompensate && (nearbyThreat || enemyCombatCount >= combatCount)) ||
        (behindArmy && state.tick < 12000);

    return { heavyProfile, cautiousDefense, cautiousPressure, economyConservative };
}

function hasQueuedBuildOfCategory(actions: Action[], category: 'building' | 'vehicle' | 'infantry'): boolean {
    return actions.some(action =>
        isActionType(action, 'START_BUILD') &&
        action.payload.category === category
    );
}

function pickClosestTo(entities: Entity[], from: Entity): Entity | null {
    if (entities.length === 0) return null;
    let best = entities[0];
    let bestDist = best.pos.dist(from.pos);
    for (let i = 1; i < entities.length; i++) {
        const dist = entities[i].pos.dist(from.pos);
        if (dist < bestDist) {
            best = entities[i];
            bestDist = dist;
        }
    }
    return best;
}

function pickPressureTarget(
    state: GameState,
    enemies: Entity[],
    baseCenterRef: Entity,
    heavyProfile: boolean
): Entity | null {
    const enemyBuildings = enemies.filter(e => e.type === 'BUILDING' && !e.dead);
    const enemyHarvesters = enemies.filter(e => e.type === 'UNIT' && e.key === 'harvester' && !e.dead);

    const earlyPriority = heavyProfile
        ? ['harvester', 'refinery', 'factory', 'conyard', 'power', 'barracks']
        : ['harvester', 'refinery', 'factory', 'conyard', 'power', 'barracks'];
    const latePriority = heavyProfile
        ? ['factory', 'conyard', 'tech', 'refinery', 'power', 'barracks', 'airforce_command']
        : ['conyard', 'factory', 'refinery', 'tech', 'power', 'barracks', 'airforce_command'];
    const priorities = state.tick < 7000 ? earlyPriority : latePriority;

    for (const key of priorities) {
        if (key === 'harvester') {
            const target = pickClosestTo(enemyHarvesters, baseCenterRef);
            if (target) return target;
            continue;
        }
        const matches = enemyBuildings.filter(b => b.key === key);
        const target = pickClosestTo(matches, baseCenterRef);
        if (target) return target;
    }

    return pickClosestTo(enemyBuildings, baseCenterRef) ||
        pickClosestTo(enemies.filter(isCombatUnit), baseCenterRef) ||
        enemies.find(e => !e.dead) ||
        null;
}

function getLocalThreatCount(enemies: Entity[], baseCenterRef: Entity): number {
    let count = 0;
    for (const enemy of enemies) {
        if (enemy.type !== 'UNIT' || enemy.dead || enemy.key === 'harvester') continue;
        if (enemy.pos.dist(baseCenterRef.pos) <= BASE_THREAT_RADIUS) {
            count++;
        }
    }
    return count;
}

function filterHydraActions(
    actions: Action[],
    state: GameState,
    enemyDefenseCount: number,
    enemyCombatCount: number,
    combatCount: number
): Action[] {
    const filtered: Action[] = [];

    for (const action of actions) {
        if (!isActionType(action, 'START_BUILD')) {
            filtered.push(action);
            continue;
        }

        const payload = action.payload;
        if (payload.category === 'infantry') {
            // Early specialist spam tends to lose tempo in macro mirrors.
            if ((payload.key === 'engineer' || payload.key === 'hijacker') &&
                (state.tick < 9000 || combatCount < 8)) {
                continue;
            }
            filtered.push(action);
            continue;
        }

        if (payload.category === 'vehicle') {
            if (payload.key === 'demo_truck') {
                const shouldAllowDemo =
                    state.tick >= 9000 &&
                    combatCount >= 10 &&
                    enemyDefenseCount >= 2 &&
                    enemyCombatCount >= 8;
                if (!shouldAllowDemo) {
                    continue;
                }
            }
            if (payload.key === 'induction_rig' && (state.tick < 13000 || enemyCombatCount > 0)) {
                continue;
            }
            filtered.push(action);
            continue;
        }

        if (payload.category === 'building') {
            if (payload.key === 'service_depot' && state.tick < 9000) {
                continue;
            }
            filtered.push(action);
            continue;
        }

        filtered.push(action);
    }

    return filtered;
}

function retargetProductionActions(
    actions: Action[],
    state: GameState,
    myBuildings: Entity[],
    dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed',
    enemyCombatCount: number
): Action[] {
    const antiArmorMode = dominantArmor === 'heavy' ||
        (dominantArmor === 'mixed' && enemyCombatCount >= 9);
    if (!antiArmorMode) {
        return actions;
    }

    const hasTech = myBuildings.some(b => b.key === 'tech' && !b.dead);

    return actions.map(action => {
        if (!isActionType(action, 'START_BUILD')) {
            return action;
        }

        if (action.payload.category === 'infantry' &&
            action.payload.key !== 'rocket' &&
            checkPrerequisites('rocket', myBuildings)) {
            return {
                ...action,
                payload: {
                    ...action.payload,
                    key: 'rocket'
                }
            };
        }

        if (action.payload.category === 'vehicle') {
            const replacement =
                (hasTech && state.tick >= 5200 && checkPrerequisites('mlrs', myBuildings)) ? 'mlrs' :
                    checkPrerequisites('heavy', myBuildings) ? 'heavy' :
                        null;
            if (replacement && action.payload.key !== replacement) {
                return {
                    ...action,
                    payload: {
                        ...action.payload,
                        key: replacement
                    }
                };
            }
        }

        return action;
    });
}

function maybeQueueMacroBuilding(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    heavyProfile: boolean,
    cautiousDefense: boolean,
    economyConservative: boolean,
    combatCount: number,
    enemyCombatCount: number,
    enemyFactoryCount: number,
    localThreatCount: number
): void {
    const player = state.players[playerId];
    if (!player) return;
    if (player.queues.building.current || player.readyToPlace || hasQueuedBuildOfCategory(actions, 'building')) {
        return;
    }

    const hasConyard = myBuildings.some(b => b.key === 'conyard' && !b.dead);
    if (!hasConyard) return;

    let totalPower = 0;
    let totalDrain = 0;
    for (const b of myBuildings) {
        if (b.dead) continue;
        const data = RULES.buildings[b.key];
        if (!data) continue;
        totalPower += data.power || 0;
        totalDrain += data.drain || 0;
    }

    if (totalDrain > totalPower - 30 && checkPrerequisites('power', myBuildings)) {
        actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId } });
        return;
    }

    const defenseCount = myBuildings.filter(
        b => !b.dead && Boolean(RULES.buildings[b.key]?.isDefense)
    ).length;
    const earlyDefensePressure = state.tick >= 1600 &&
        state.tick <= 9000 &&
        (localThreatCount > 0 || enemyCombatCount >= 4 || enemyFactoryCount >= 1);
    const targetDefenseCount = localThreatCount >= 3 && enemyCombatCount >= 8 && state.tick < 7000 ? 2 : 1;
    if ((cautiousDefense || earlyDefensePressure) &&
        defenseCount < targetDefenseCount &&
        checkPrerequisites('turret', myBuildings)) {
            actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'turret', playerId } });
            return;
    }

    const factoryCount = myBuildings.filter(b => b.key === 'factory' && !b.dead).length;
    let targetFactoryCount = economyConservative ? 1 : 2;
    if (!economyConservative &&
        heavyProfile &&
        state.tick >= 7000 &&
        localThreatCount === 0 &&
        combatCount >= enemyCombatCount - 1 &&
        player.credits >= 1200) {
        targetFactoryCount = 3;
    }
    if (state.tick >= 2400 && factoryCount < targetFactoryCount && checkPrerequisites('factory', myBuildings)) {
        actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'factory', playerId } });
        return;
    }

    const barracksCount = myBuildings.filter(b => b.key === 'barracks' && !b.dead).length;
    if (!economyConservative &&
        heavyProfile &&
        state.tick >= 5600 &&
        localThreatCount === 0 &&
        combatCount >= enemyCombatCount &&
        player.credits >= 900 &&
        barracksCount < 2 &&
        checkPrerequisites('barracks', myBuildings)) {
        actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'barracks', playerId } });
        return;
    }

    const hasTech = myBuildings.some(b => b.key === 'tech' && !b.dead);
    if (!economyConservative &&
        heavyProfile &&
        !hasTech &&
        state.tick >= 4200 &&
        player.credits >= 2200 &&
        localThreatCount === 0 &&
        combatCount >= enemyCombatCount - 1 &&
        checkPrerequisites('tech', myBuildings)) {
        actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'tech', playerId } });
    }
}

function maybeQueueFallbackProduction(
    actions: Action[],
    state: GameState,
    playerId: number,
    myBuildings: Entity[],
    dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed',
    heavyProfile: boolean
): void {
    const player = state.players[playerId];
    if (!player) return;

    if (!player.queues.infantry.current &&
        hasProductionBuildingFor('infantry', myBuildings) &&
        !hasQueuedBuildOfCategory(actions, 'infantry')) {
        const infantryKey =
            checkPrerequisites('rocket', myBuildings) ? 'rocket' :
                (dominantArmor === 'infantry' && checkPrerequisites('grenadier', myBuildings)) ? 'grenadier' :
                    'rifle';
        actions.push({
            type: 'START_BUILD',
            payload: { category: 'infantry', key: infantryKey, playerId }
        });
    }

    if (!player.queues.vehicle.current &&
        hasProductionBuildingFor('vehicle', myBuildings) &&
        !hasQueuedBuildOfCategory(actions, 'vehicle')) {
        const hasTech = myBuildings.some(b => b.key === 'tech' && !b.dead);
        const vehicleKey =
            (heavyProfile && hasTech && checkPrerequisites('mlrs', myBuildings)) ? 'mlrs' :
                (heavyProfile && hasTech && checkPrerequisites('artillery', myBuildings)) ? 'artillery' :
                ((heavyProfile || dominantArmor === 'heavy') && checkPrerequisites('heavy', myBuildings)) ? 'heavy' :
                    (dominantArmor === 'infantry' && checkPrerequisites('flame_tank', myBuildings)) ? 'flame_tank' :
                        checkPrerequisites('light', myBuildings) ? 'light' :
                            null;

        if (vehicleKey) {
            actions.push({
                type: 'START_BUILD',
                payload: { category: 'vehicle', key: vehicleKey, playerId }
            });
        }
    }
}

function maybeForcePressure(
    actions: Action[],
    state: GameState,
    runtime: RuntimeState,
    combatUnits: Entity[],
    enemies: Entity[],
    target: Entity | null,
    localThreatCount: number,
    heavyProfile: boolean,
    cautiousPressure: boolean
): void {
    if (!target) return;
    if (combatUnits.length < 3) return;
    const pressureCooldown = cautiousPressure ? PRESSURE_COOLDOWN_CAUTIOUS : PRESSURE_COOLDOWN;
    if (state.tick - runtime.lastPressureTick < pressureCooldown) return;

    const enemyCombatCount = enemies.filter(isCombatUnit).length;
    const hasAdvantage = combatUnits.length >= enemyCombatCount + 1;
    if (cautiousPressure) {
        const hasStrongAdvantage = combatUnits.length >= enemyCombatCount + 2;
        const latePush = state.tick >= 9000 && combatUnits.length >= 8;
        if (localThreatCount > 0) return;
        if (!hasStrongAdvantage && !latePush) return;
    } else if (heavyProfile) {
        if (localThreatCount > 0 && !hasAdvantage) return;
    } else if (localThreatCount > 0 && !hasAdvantage) {
        return;
    }

    let pressureUnits = combatUnits;
    if (localThreatCount > 0 || cautiousPressure) {
        const reserveCount = combatUnits.length >= 6 ? 2 : 1;
        const byTargetDistance = [...combatUnits].sort(
            (a, b) => a.pos.dist(target.pos) - b.pos.dist(target.pos)
        );
        if (byTargetDistance.length - reserveCount >= 3) {
            pressureUnits = byTargetDistance.slice(0, byTargetDistance.length - reserveCount);
        }
    }

    if (pressureUnits.length < 3) return;

    const unitIds = pressureUnits.map(unit => unit.id);
    actions.push({
        type: 'COMMAND_ATTACK',
        payload: {
            unitIds,
            targetId: target.id
        }
    });

    if (pressureUnits.length >= 6) {
        actions.push({
            type: 'COMMAND_ATTACK_MOVE',
            payload: {
                unitIds,
                x: target.pos.x,
                y: target.pos.y
            }
        });
    }

    runtime.lastPressureTick = state.tick;
}

function maybeSetRallyPoints(
    actions: Action[],
    state: GameState,
    myBuildings: Entity[],
    enemies: Entity[],
    baseCenterRef: Entity,
    localThreatCount: number,
    target: Entity | null,
    runtime: RuntimeState
): void {
    if (!target) return;
    if (state.tick - runtime.lastRallyTick < RALLY_COOLDOWN) return;

    let rallyTarget = target;
    if (localThreatCount > 0) {
        const nearbyThreats = enemies.filter(
            enemy =>
                enemy.type === 'UNIT' &&
                !enemy.dead &&
                enemy.key !== 'harvester' &&
                enemy.pos.dist(baseCenterRef.pos) <= BASE_THREAT_RADIUS
        );
        rallyTarget = pickClosestTo(nearbyThreats, baseCenterRef) || baseCenterRef;
    }

    runtime.lastRallyTick = state.tick;
    for (const building of myBuildings) {
        if (building.key !== 'factory' && building.key !== 'barracks' && building.key !== 'airforce_command') {
            continue;
        }
        actions.push({
            type: 'SET_RALLY_POINT',
            payload: {
                buildingId: building.id,
                x: rallyTarget.pos.x,
                y: rallyTarget.pos.y
            }
        });
    }
}

function isOwnedUnit(state: GameState, entityId: string, playerId: number): boolean {
    const entity = state.entities[entityId];
    return Boolean(entity && entity.type === 'UNIT' && !entity.dead && entity.owner === playerId);
}

function isOwnedBuilding(state: GameState, entityId: string, playerId: number): boolean {
    const entity = state.entities[entityId];
    return Boolean(entity && entity.type === 'BUILDING' && !entity.dead && entity.owner === playerId);
}

function sanitizeAuroraActions(actions: Action[], state: GameState, playerId: number): Action[] {
    return actions.filter(action => {
        switch (action.type) {
            case 'START_BUILD':
            case 'PLACE_BUILDING':
            case 'CANCEL_BUILD':
            case 'QUEUE_UNIT':
            case 'DEQUEUE_UNIT':
                return action.payload.playerId === playerId;
            case 'SET_PRIMARY_BUILDING':
                return action.payload.playerId === playerId &&
                    isOwnedBuilding(state, action.payload.buildingId, playerId);
            case 'SELL_BUILDING':
            case 'START_REPAIR':
            case 'STOP_REPAIR':
            case 'SET_RALLY_POINT':
                return isOwnedBuilding(state, action.payload.buildingId, playerId);
            case 'COMMAND_MOVE':
            case 'COMMAND_ATTACK':
            case 'COMMAND_ATTACK_MOVE':
            case 'SET_STANCE':
                return action.payload.unitIds.length > 0 &&
                    action.payload.unitIds.every(unitId => isOwnedUnit(state, unitId, playerId));
            case 'DEPLOY_MCV':
            case 'DEPLOY_INDUCTION_RIG':
                return isOwnedUnit(state, action.payload.unitId, playerId);
            default:
                return true;
        }
    });
}

function maybeEnforceLocalDefense(
    actions: Action[],
    combatUnits: Entity[],
    enemies: Entity[],
    baseCenterRef: Entity,
    localThreatCount: number,
    enemyCombatCount: number
): Action[] {
    if (combatUnits.length === 0 || localThreatCount === 0) {
        return actions;
    }

    const shouldHold = localThreatCount >= 2 || combatUnits.length <= enemyCombatCount;
    if (!shouldHold) {
        return actions;
    }

    const nearbyThreats = enemies.filter(
        enemy => isCombatUnit(enemy) && enemy.pos.dist(baseCenterRef.pos) <= BASE_THREAT_RADIUS
    );
    const focusThreat = pickClosestTo(nearbyThreats, baseCenterRef);
    if (!focusThreat) {
        return actions;
    }

    const defenderIds = combatUnits.map(unit => unit.id);
    const defenderIdSet = new Set(defenderIds);

    const filtered = actions.filter(action => {
        if (action.type === 'COMMAND_ATTACK' || action.type === 'COMMAND_ATTACK_MOVE') {
            return !action.payload.unitIds.some(unitId => defenderIdSet.has(unitId));
        }
        return true;
    });

    return [
        {
            type: 'COMMAND_ATTACK',
            payload: {
                unitIds: defenderIds,
                targetId: focusThreat.id
            }
        },
        ...filtered
    ];
}

export function computeAuroraSovereignAiActions(
    state: GameState,
    playerId: number,
    difficulty: AIImplementationDifficulty,
    sharedCache?: EntityCache
): Action[] {
    void difficulty;

    const player = state.players[playerId];
    if (!player) return [];

    const cache = sharedCache ?? createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId);
    const combatUnits = myUnits.filter(isCombatUnit);

    // Delegate core behavior to vendored Titan snapshot.
    let actions = computeAuroraTitanSnapshotAiActions(state, playerId, cache);

    if (myBuildings.length === 0 && myUnits.every(unit => unit.key !== 'mcv')) {
        return actions;
    }

    const baseCenterRef = myBuildings[0] || myUnits[0];
    if (!baseCenterRef) {
        return actions;
    }

    const enemyDefenseCount = enemies.filter(
        e => e.type === 'BUILDING' && !e.dead && Boolean(RULES.buildings[e.key]?.isDefense)
    ).length;
    const enemyCombatCount = enemies.filter(isCombatUnit).length;
    const enemyFactoryCount = enemies.filter(e => e.type === 'BUILDING' && !e.dead && e.key === 'factory').length;
    const enemyTechCount = enemies.filter(e => e.type === 'BUILDING' && !e.dead && e.key === 'tech').length;
    const localThreatCount = getLocalThreatCount(enemies, baseCenterRef);
    const tacticalProfile = deriveTacticalProfile(
        state,
        playerId,
        combatUnits.length,
        enemyCombatCount,
        enemyDefenseCount,
        enemyFactoryCount,
        enemyTechCount,
        localThreatCount
    );

    const aiState = getAIState(playerId);
    actions = filterHydraActions(actions, state, enemyDefenseCount, enemyCombatCount, combatUnits.length);
    actions = retargetProductionActions(
        actions,
        state,
        myBuildings,
        aiState.enemyIntelligence.dominantArmor,
        enemyCombatCount
    );

    maybeQueueMacroBuilding(
        actions,
        state,
        playerId,
        myBuildings,
        tacticalProfile.heavyProfile,
        tacticalProfile.cautiousDefense,
        tacticalProfile.economyConservative,
        combatUnits.length,
        enemyCombatCount,
        enemyFactoryCount,
        localThreatCount
    );
    maybeQueueFallbackProduction(
        actions,
        state,
        playerId,
        myBuildings,
        aiState.enemyIntelligence.dominantArmor,
        tacticalProfile.heavyProfile
    );

    const runtime = getRuntimeState(playerId, state.tick);
    const target = pickPressureTarget(state, enemies, baseCenterRef, tacticalProfile.heavyProfile);

    maybeForcePressure(
        actions,
        state,
        runtime,
        combatUnits,
        enemies,
        target,
        localThreatCount,
        tacticalProfile.heavyProfile,
        tacticalProfile.cautiousPressure
    );
    maybeSetRallyPoints(
        actions,
        state,
        myBuildings,
        enemies,
        baseCenterRef,
        localThreatCount,
        target,
        runtime
    );
    actions = maybeEnforceLocalDefense(
        actions,
        combatUnits,
        enemies,
        baseCenterRef,
        localThreatCount,
        enemyCombatCount
    );
    return sanitizeAuroraActions(actions, state, playerId);
}

export const AuroraSovereignAIImplementation: AIImplementation = {
    id: 'aurora_sovereign',
    name: 'Aurora Sovereign, Warden of the Ninth Dawn',
    description: 'A relentless strategist that forces decisive timing pushes and anti-stalemate finishers.',
    computeActions: ({ state, playerId, difficulty, entityCache }) =>
        computeAuroraSovereignAiActions(state, playerId, difficulty, entityCache),
    reset: (playerId?: number) => {
        if (playerId === undefined) {
            runtimeByPlayer.clear();
            resetAIState();
            return;
        }
        runtimeByPlayer.delete(playerId);
        resetAIState(playerId);
    }
};

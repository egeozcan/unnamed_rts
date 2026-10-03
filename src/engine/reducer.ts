import {
    Action, EntityId, GameState, PLAYER_COLORS, Vector
} from './types';
import { isDemoTruck } from './type-guards';
import { isEnemy } from './teams';
import { createPlayerState } from './reducers/helpers';
import { tick } from './reducers/game_loop';
import { startBuild, cancelBuild, queueUnit, dequeueUnit } from './reducers/production';
import { placeBuilding, sellBuilding, startRepair, stopRepair, setRallyPoint, setPrimaryBuilding } from './reducers/buildings';
import { deployMCV, deployInductionRig, commandMove, commandAttack, commandAttackMove, commandUngarrison, commandStop, setStance } from './reducers/units';

// Re-export specific helpers that are used elsewhere (e.g. in tests or UI)
export { createPlayerState, canBuild, calculatePower, createEntity, getRuleData, createProjectile } from './reducers/helpers';
export { tick } from './reducers/game_loop';
export { placeBuilding, sellBuilding } from './reducers/buildings';
export { updateUnit, deployMCV, deployInductionRig, commandAttackMove, commandUngarrison, setStance } from './reducers/units';

export const INITIAL_STATE: GameState = {
    running: false,
    mode: 'menu',
    difficulty: 'easy',
    tick: 0,
    camera: { x: 0, y: 0 },
    zoom: 1.0,
    entities: {},
    projectiles: [],
    particles: [],
    selection: [],
    placingBuilding: null,
    sellMode: false,
    repairMode: false,
    players: {
        0: createPlayerState(0, false, 'medium', PLAYER_COLORS[0]),
        1: createPlayerState(1, true, 'hard', PLAYER_COLORS[1])  // AI uses hard for baseline behavior
    },
    winner: null,
    config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
    debugMode: false,
    showMinimap: true,
    showBirdsEye: false,
    notification: null,
    attackMoveMode: false,
    fogOfWar: {}
};

export function update(state: GameState, action: Action): GameState {
    switch (action.type) {
        case 'TICK':
            return tick(state);
        case 'START_BUILD':
            return startBuild(state, action.payload);
        case 'PLACE_BUILDING':
            return placeBuilding(state, action.payload);
        case 'CANCEL_BUILD':
            return cancelBuild(state, action.payload);
        case 'CANCEL_PLACEMENT':
            return { ...state, placingBuilding: null };
        case 'COMMAND_MOVE': {
            if (state.headless) {
                // Headless simulations don't render command indicators.
                return commandMove(state, action.payload);
            }
            const newState = commandMove(state, action.payload);
            // Only show indicator for human commands (units in selection)
            const isHumanCommand = action.payload.unitIds.some(id => state.selection.includes(id));
            return {
                ...newState,
                commandIndicator: isHumanCommand ? {
                    pos: new Vector(action.payload.x, action.payload.y),
                    type: 'move',
                    startTick: state.tick
                } : state.commandIndicator
            };
        }
        case 'COMMAND_ATTACK': {
            if (state.headless) {
                // Headless simulations don't render command indicators.
                return commandAttack(state, action.payload);
            }
            const target = state.entities[action.payload.targetId];
            const newState = commandAttack(state, action.payload);
            // Only show indicator for human commands (units in selection)
            const isHumanCommand = action.payload.unitIds.some(id => state.selection.includes(id));
            // Show what actually happened: red on the target if anyone now attacks it, green where the
            // units are heading if they only move (e.g. a right-click on a rock or your own building),
            // and nothing if no unit took the order
            const indicator = isHumanCommand && target ? describeAttackOrder(state, newState, action.payload.unitIds, action.payload.targetId) : null;
            return {
                ...newState,
                commandIndicator: indicator ? { ...indicator, startTick: state.tick } : state.commandIndicator
            };
        }
        case 'SELECT_UNITS':
            // A new selection drops attack-move mode: it was armed for the old one
            return { ...state, selection: action.payload, attackMoveMode: false };
        case 'SELL_BUILDING':
            return sellBuilding(state, action.payload);
        case 'TOGGLE_SELL_MODE':
            return { ...state, sellMode: !state.sellMode, repairMode: false };
        case 'TOGGLE_REPAIR_MODE':
            return { ...state, repairMode: !state.repairMode, sellMode: false };
        case 'START_REPAIR':
            return startRepair(state, action.payload);
        case 'STOP_REPAIR':
            return stopRepair(state, action.payload);
        case 'TOGGLE_DEBUG':
            return { ...state, debugMode: !state.debugMode };
        case 'TOGGLE_MINIMAP':
            return { ...state, showMinimap: !state.showMinimap };
        case 'TOGGLE_BIRDS_EYE':
            return { ...state, showBirdsEye: !state.showBirdsEye };
        case 'DEPLOY_MCV':
            return deployMCV(state, action.payload);
        case 'DEPLOY_INDUCTION_RIG':
            return deployInductionRig(state, action.payload);
        case 'QUEUE_UNIT':
            return queueUnit(state, action.payload);
        case 'DEQUEUE_UNIT':
            return dequeueUnit(state, action.payload);
        case 'COMMAND_ATTACK_MOVE': {
            if (state.headless) {
                // Headless simulations don't render command indicators.
                return commandAttackMove(state, action.payload);
            }
            const newState = commandAttackMove(state, action.payload);
            // Only show indicator for human commands (units in selection)
            const isHumanCommand = action.payload.unitIds.some(id => state.selection.includes(id));
            return {
                ...newState,
                commandIndicator: isHumanCommand ? {
                    pos: new Vector(action.payload.x, action.payload.y),
                    type: 'attack_move',
                    startTick: state.tick
                } : state.commandIndicator
            };
        }
        case 'COMMAND_STOP':
            return commandStop(state, action.payload);
        case 'COMMAND_UNGARRISON':
            return commandUngarrison(state, action.payload);
        case 'SET_STANCE':
            return setStance(state, action.payload);
        case 'TOGGLE_ATTACK_MOVE_MODE':
            return { ...state, attackMoveMode: !state.attackMoveMode };
        case 'SET_RALLY_POINT':
            return setRallyPoint(state, action.payload);
        case 'SET_PRIMARY_BUILDING':
            return setPrimaryBuilding(state, action.payload);
        default:
            return state;
    }
}

/**
 * The indicator for a right-click order on `targetId`, judged from what the order changed: red on an
 * enemy target that someone now attacks; otherwise green - where the units are heading if they were
 * sent somewhere (a rock, your own building...), or on the target itself for harvesting, boarding,
 * docking or repairs. Nothing if no unit took the order.
 */
function describeAttackOrder(before: GameState, after: GameState, unitIds: EntityId[], targetId: EntityId): { pos: Vector; type: 'attack' | 'move' } | null {
    const target = after.entities[targetId] ?? before.entities[targetId];
    const commander = before.entities[unitIds[0]];
    const targetIsEnemy = !!target && !!commander && target.owner !== -1 && isEnemy(before, target.owner, commander.owner);
    let sumX = 0, sumY = 0, moved = 0, changed = false, attacking = false;
    // (All of the commander's units, not just `unitIds`: a selected Air-Force Command launches its Harriers)
    const ordered = new Set(unitIds);
    for (const id in after.entities) {
        const unit = after.entities[id];
        const prev = before.entities[id];
        if (unit.type !== 'UNIT' || !commander || unit.owner !== commander.owner) continue;
        if (prev === unit && !ordered.has(id)) continue;
        if (unit.combat?.targetId === targetId || (isDemoTruck(unit) && unit.demoTruck.detonationTargetId === targetId)) {
            attacking = true;
        }
        if (prev === unit) continue;
        changed = true;
        const dest = unit.movement.moveTarget;
        if (dest && (!prev || prev.type !== 'UNIT' || prev.movement.moveTarget !== dest)) {
            sumX += dest.x;
            sumY += dest.y;
            moved++;
        }
    }
    if (targetIsEnemy && attacking) return { pos: target.pos, type: 'attack' };
    if (!changed && !attacking) return null;
    if (!targetIsEnemy && moved > 0 && !attacking) return { pos: new Vector(sumX / moved, sumY / moved), type: 'move' };
    return target ? { pos: target.pos, type: targetIsEnemy && attacking ? 'attack' : 'move' } : null;
}

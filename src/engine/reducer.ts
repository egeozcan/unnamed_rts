import {
    Action, GameState, PLAYER_COLORS, Vector
} from './types';
import { createPlayerState } from './reducers/helpers';
import { tick } from './reducers/game_loop';
import { startBuild, cancelBuild, queueUnit, dequeueUnit } from './reducers/production';
import { placeBuilding, sellBuilding, startRepair, stopRepair, setRallyPoint, setPrimaryBuilding } from './reducers/buildings';
import { deployMCV, deployInductionRig, commandMove, commandAttack, commandAttackMove, setStance } from './reducers/units';

// Re-export specific helpers that are used elsewhere (e.g. in tests or UI)
export { createPlayerState, canBuild, calculatePower, createEntity, getRuleData, createProjectile } from './reducers/helpers';
export { tick } from './reducers/game_loop';
export { placeBuilding, sellBuilding } from './reducers/buildings';
export { updateUnit, deployMCV, deployInductionRig, commandAttackMove, setStance } from './reducers/units';

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
    attackMoveMode: false
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
            const target = state.entities[action.payload.targetId];
            const newState = commandAttack(state, action.payload);
            // Only show indicator for human commands (units in selection)
            const isHumanCommand = action.payload.unitIds.some(id => state.selection.includes(id));
            return {
                ...newState,
                commandIndicator: isHumanCommand && target ? {
                    pos: target.pos,
                    type: 'attack',
                    startTick: state.tick
                } : state.commandIndicator
            };
        }
        case 'SELECT_UNITS':
            return { ...state, selection: action.payload };
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
            const newState = commandAttackMove(state, action.payload);
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

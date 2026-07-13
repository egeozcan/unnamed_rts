import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { computeAiActionsForPlayer } from '../../src/engine/ai/controller.js';
import { getAIImplementation, getAIImplementationOptions } from '../../src/engine/ai/registry.js';
import { Action, BuildingKey, Entity, EntityId, GameState, UnitKey, isActionType } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit, createTestHarvester, createTestResource } from '../../src/engine/test-utils.js';

const ENGINEER_CONYARD_RUSH_ID = 'engineer_conyard_rush';

function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number
): Entity {
    if (type === 'BUILDING') {
        return createTestBuilding({ id, owner, key: key as BuildingKey, x, y });
    }
    if (type === 'RESOURCE') {
        return createTestResource({ id, x, y });
    }
    if (key === 'harvester') {
        return createTestHarvester({ id, owner, x, y });
    }
    return createTestCombatUnit({
        id,
        owner,
        key: key as Exclude<UnitKey, 'harvester' | 'harrier' | 'demo_truck'>,
        x,
        y
    });
}

function createState(
    entities: Record<EntityId, Entity>,
    tick: number,
    aiCredits: number,
    aiDifficulty: 'dummy' | 'easy' | 'medium' | 'hard' = 'hard'
): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        tick,
        entities,
        players: {
            0: createPlayerState(0, false, 'medium', '#4488ff'),
            1: {
                ...createPlayerState(1, true, aiDifficulty, '#ff4444', ENGINEER_CONYARD_RUSH_ID),
                credits: aiCredits
            }
        }
    } as GameState & { players: Record<number, ReturnType<typeof createPlayerState>> };
}

function resetEngineerConyardRushState(): void {
    getAIImplementation(ENGINEER_CONYARD_RUSH_ID)?.reset?.();
}

function getLatestSingleUnitAttackTarget(actions: ReturnType<typeof computeAiActionsForPlayer>, unitId: EntityId): EntityId | null {
    let targetId: EntityId | null = null;
    for (const action of actions) {
        if (!isActionType(action, 'COMMAND_ATTACK')) continue;
        if (action.payload.unitIds.length !== 1) continue;
        if (action.payload.unitIds[0] !== unitId) continue;
        targetId = action.payload.targetId;
    }
    return targetId;
}

function assertEngineerRushActionsAreOwned(actions: ReturnType<typeof computeAiActionsForPlayer>, state: GameState, playerId: number): void {
    for (const action of actions) {
        if (isActionType(action, 'START_BUILD') ||
            isActionType(action, 'PLACE_BUILDING') ||
            isActionType(action, 'CANCEL_BUILD')) {
            expect(action.payload.playerId).toBe(playerId);
        }

        if (isActionType(action, 'COMMAND_ATTACK') ||
            isActionType(action, 'COMMAND_MOVE') ||
            isActionType(action, 'COMMAND_ATTACK_MOVE') ||
            isActionType(action, 'COMMAND_UNGARRISON') ||
            isActionType(action, 'SET_STANCE')) {
            for (const unitId of action.payload.unitIds) {
                const unit = state.entities[unitId];
                expect(unit?.type).toBe('UNIT');
                expect(unit?.owner).toBe(playerId);
            }
        }

        if (isActionType(action, 'SELL_BUILDING') ||
            isActionType(action, 'START_REPAIR') ||
            isActionType(action, 'STOP_REPAIR')) {
            expect(action.payload.playerId).toBe(playerId);
            const building = state.entities[action.payload.buildingId];
            expect(building?.type).toBe('BUILDING');
            expect(building?.owner).toBe(playerId);
        }

        if (isActionType(action, 'SET_RALLY_POINT')) {
            const building = state.entities[action.payload.buildingId];
            expect(building?.type).toBe('BUILDING');
            expect(building?.owner).toBe(playerId);
        }

        if (isActionType(action, 'SET_PRIMARY_BUILDING')) {
            expect(action.payload.playerId).toBe(playerId);
            const building = state.entities[action.payload.buildingId];
            expect(building?.type).toBe('BUILDING');
            expect(building?.owner).toBe(playerId);
        }

        if (isActionType(action, 'DEPLOY_MCV') || isActionType(action, 'DEPLOY_INDUCTION_RIG')) {
            const unit = state.entities[action.payload.unitId];
            expect(unit?.type).toBe('UNIT');
            expect(unit?.owner).toBe(playerId);
        }
    }
}

describe('Engineer Conyard Rush AI', () => {
    beforeEach(() => {
        resetEngineerConyardRushState();
    });

    it('registers in AI registry with selector option', () => {
        const implementation = getAIImplementation(ENGINEER_CONYARD_RUSH_ID);
        expect(implementation).toBeDefined();
        expect(implementation?.name).toBe('Engineer Conyard Rush');

        const options = getAIImplementationOptions();
        expect(options.some(option => option.id === ENGINEER_CONYARD_RUSH_ID)).toBe(true);
    });

    it('emits only own-unit and own-building control actions', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 250, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_apc: createEntity('ai_apc', 1, 'UNIT', 'apc', 540, 430),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 520, 450),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 980, 680),
            enemy_apc: createEntity('enemy_apc', 0, 'UNIT', 'apc', 900, 600),
            enemy_engineer: createEntity('enemy_engineer', 0, 'UNIT', 'engineer', 920, 600)
        };

        const state = createState(entities, 31, 7000);
        const actions = computeAiActionsForPlayer(state, 1);

        assertEngineerRushActionsAreOwned(actions, state, 1);
    });

    it('drops invalid enemy-owned control actions from the final action list', async () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 520, 450),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620),
            enemy_engineer: createEntity('enemy_engineer', 0, 'UNIT', 'engineer', 920, 600)
        };
        const state = createState(entities, 31, 7000);
        const validCapture: Action = {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: ['ai_engineer'], targetId: 'enemy_conyard' }
        };
        const staleOwnUnitAttack: Action = {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: ['ai_engineer'], targetId: 'already_gone' }
        };
        const unsafeActions: Action[] = [
            validCapture,
            staleOwnUnitAttack,
            {
                type: 'COMMAND_ATTACK',
                payload: { unitIds: ['enemy_engineer'], targetId: 'ai_conyard' }
            },
            {
                type: 'SELL_BUILDING',
                payload: { buildingId: 'enemy_conyard', playerId: 1 }
            },
            {
                type: 'START_BUILD',
                payload: { category: 'vehicle', key: 'apc', playerId: 0 }
            }
        ];
        const implementationModule = await import('../../src/engine/ai/implementations/engineer_conyard_rush/index.js') as unknown as {
            sanitizeEngineerConyardRushActions?: (actions: Action[], state: GameState, playerId: number) => Action[];
        };
        const sanitize = implementationModule.sanitizeEngineerConyardRushActions;

        expect(typeof sanitize).toBe('function');
        if (!sanitize) return;

        expect(sanitize(unsafeActions, state, 1)).toEqual([validCapture, staleOwnUnitAttack]);
    });

    it('issues engineer capture commands against enemy conyards', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            ai_harvester: createEntity('ai_harvester', 1, 'UNIT', 'harvester', 350, 470),
            ore_1: createEntity('ore_1', -1, 'RESOURCE', 'ore', 600, 520),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 980, 680)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 4000), 1);
        expect(actions.some(action =>
            isActionType(action, 'COMMAND_ATTACK') &&
            action.payload.unitIds.includes('ai_engineer') &&
            action.payload.targetId === 'enemy_conyard'
        )).toBe(true);
    });

    it('splits the first two engineers between the enemy conyard and barracks', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer_1: createEntity('ai_engineer_1', 1, 'UNIT', 'engineer', 460, 430),
            ai_engineer_2: createEntity('ai_engineer_2', 1, 'UNIT', 'engineer', 470, 440),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 940, 650)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 4000), 1);
        const targets = new Set([
            getLatestSingleUnitAttackTarget(actions, 'ai_engineer_1'),
            getLatestSingleUnitAttackTarget(actions, 'ai_engineer_2')
        ]);

        expect(targets).toEqual(new Set(['enemy_conyard', 'enemy_barracks']));
    });

    it('replaces ordinary idle-lane production with engineers and APCs during a base raid', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 250, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_harvester: createEntity('ai_harvester', 1, 'UNIT', 'harvester', 350, 470),
            ai_harvester_2: createEntity('ai_harvester_2', 1, 'UNIT', 'harvester', 380, 480),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 8000), 1);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'infantry' &&
            action.payload.key === 'engineer'
        )).toBe(true);
        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'vehicle' &&
            action.payload.key === 'apc'
        )).toBe(true);
    });

    it('holds an untransported engineer instead of sending it alone into a defended base', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 300, 300),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 240, 260),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 360, 320),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 260, 380),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 390, 350),
            close_conyard: createEntity('close_conyard', 0, 'BUILDING', 'conyard', 760, 420),
            close_turret_1: createEntity('close_turret_1', 0, 'BUILDING', 'turret', 690, 400),
            close_turret_2: createEntity('close_turret_2', 0, 'BUILDING', 'turret', 790, 460),
            far_conyard: createEntity('far_conyard', 2, 'BUILDING', 'conyard', 1040, 520)
        };
        const state = {
            ...createState(entities, 31, 5000),
            players: {
                0: createPlayerState(0, true, 'hard', '#4488ff'),
                1: createPlayerState(1, true, 'hard', '#ff4444', ENGINEER_CONYARD_RUSH_ID),
                2: createPlayerState(2, true, 'hard', '#44ff88')
            }
        } as GameState;

        const actions = computeAiActionsForPlayer(state, 1);

        expect(actions).toContainEqual({
            type: 'COMMAND_MOVE',
            payload: { unitIds: ['ai_engineer'], x: 390, y: 350 }
        });
    });

    it('preserves active pre-capture building work instead of forcing barracks', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 250, 300),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_harvester: createEntity('ai_harvester', 1, 'UNIT', 'harvester', 350, 470),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620)
        };
        const basePlayer = createPlayerState(1, true, 'hard', '#ff4444', ENGINEER_CONYARD_RUSH_ID);
        const state = {
            ...createState(entities, 2600, 6500),
            players: {
                0: createPlayerState(0, true, 'hard', '#4488ff'),
                1: {
                    ...basePlayer,
                    credits: 6500,
                    queues: {
                        ...basePlayer.queues,
                        building: { current: 'refinery', progress: 40, invested: 800, queued: [] }
                    }
                }
            }
        } as GameState;

        const actions = computeAiActionsForPlayer(state, 1);
        const cancelIndex = actions.findIndex(action =>
            isActionType(action, 'CANCEL_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'building'
        );
        const barracksStart = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'building' &&
            action.payload.key === 'barracks'
        );

        expect(cancelIndex).toBe(-1);
        expect(barracksStart).toBeUndefined();
    });

    it('does not force cleanup production when enemy conyards are gone', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 500, 500),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 430, 450),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 570, 500),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 620, 560),
            ai_refinery_1: createEntity('ai_refinery_1', 1, 'BUILDING', 'refinery', 500, 620),
            ai_refinery_2: createEntity('ai_refinery_2', 1, 'BUILDING', 'refinery', 610, 650),
            ai_harv_1: createEntity('ai_harv_1', 1, 'UNIT', 'harvester', 550, 650),
            ai_harv_2: createEntity('ai_harv_2', 1, 'UNIT', 'harvester', 580, 680),
            ai_harv_3: createEntity('ai_harv_3', 1, 'UNIT', 'harvester', 620, 680),
            ai_harv_4: createEntity('ai_harv_4', 1, 'UNIT', 'harvester', 650, 690),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 1300, 900),
            enemy_factory: createEntity('enemy_factory', 0, 'BUILDING', 'factory', 1360, 960)
        };
        for (let i = 0; i < 8; i++) {
            entities[`enemy_gren_${i}`] = createEntity(`enemy_gren_${i}`, 0, 'UNIT', 'grenadier', 1000 + i * 20, 900);
        }

        const basePlayer = createPlayerState(1, true, 'hard', '#ff4444', ENGINEER_CONYARD_RUSH_ID);
        const state = {
            ...createState(entities, 14020, 5000),
            players: {
                0: createPlayerState(0, true, 'hard', '#4488ff'),
                1: {
                    ...basePlayer,
                    credits: 5000,
                    queues: {
                        ...basePlayer.queues,
                        infantry: { current: 'rifle', progress: 20, invested: 20, queued: [] },
                        vehicle: { current: 'light', progress: 20, invested: 150, queued: [] }
                    }
                }
            }
        } as GameState;

        const actions = computeAiActionsForPlayer(state, 1);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'infantry' &&
            action.payload.key === 'engineer'
        )).toBe(false);
        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'vehicle' &&
            action.payload.key === 'apc'
        )).toBe(false);
        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'vehicle' &&
            action.payload.key === 'flame_tank'
        )).toBe(false);
        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'infantry' &&
            action.payload.key === 'flamer'
        )).toBe(false);
    });

    it('boards engineers into APC when transport capacity is available', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_apc: createEntity('ai_apc', 1, 'UNIT', 'apc', 540, 430),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 520, 450),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 4000), 1);
        expect(getLatestSingleUnitAttackTarget(actions, 'ai_engineer')).toBe('ai_apc');
    });

    it('drives loaded APCs toward enemy conyards until unload range', () => {
        const engineer = createEntity('ai_engineer', 1, 'UNIT', 'engineer', 540, 430);
        const engineer2 = createEntity('ai_engineer_2', 1, 'UNIT', 'engineer', 540, 430);
        if (engineer.type !== 'UNIT') {
            throw new Error('expected engineer unit');
        }
        if (engineer2.type !== 'UNIT') {
            throw new Error('expected engineer unit');
        }

        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_apc: createEntity('ai_apc', 1, 'UNIT', 'apc', 540, 430),
            ai_engineer: {
                ...engineer,
                movement: { ...engineer.movement, transportId: 'ai_apc' }
            },
            ai_engineer_2: {
                ...engineer2,
                movement: { ...engineer2.movement, transportId: 'ai_apc' }
            },
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 4000), 1);
        expect(actions).toContainEqual({
            type: 'COMMAND_MOVE',
            payload: { unitIds: ['ai_apc'], x: 940, y: 620 }
        });
    });

    it('holds an APC until a complete two-engineer package is aboard', () => {
        const engineer = createEntity('ai_engineer', 1, 'UNIT', 'engineer', 540, 430);
        if (engineer.type !== 'UNIT') throw new Error('expected engineer unit');
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_apc: createEntity('ai_apc', 1, 'UNIT', 'apc', 540, 430),
            ai_engineer: { ...engineer, movement: { ...engineer.movement, transportId: 'ai_apc' } },
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 4000), 1);
        expect(actions).toContainEqual({
            type: 'SET_STANCE',
            payload: { unitIds: ['ai_apc'], stance: 'hold_ground' }
        });
        expect(actions).toContainEqual({
            type: 'COMMAND_MOVE',
            payload: { unitIds: ['ai_apc'], x: 540, y: 430 }
        });
        expect(actions.some(action =>
            isActionType(action, 'COMMAND_UNGARRISON') && action.payload.unitIds.includes('ai_apc')
        )).toBe(false);
    });

    it('sends a bounded two-unit escort screen with a complete raid package', () => {
        const engineer1 = createEntity('ai_engineer_1', 1, 'UNIT', 'engineer', 540, 430);
        const engineer2 = createEntity('ai_engineer_2', 1, 'UNIT', 'engineer', 540, 430);
        if (engineer1.type !== 'UNIT' || engineer2.type !== 'UNIT') throw new Error('expected engineer units');
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_apc: createEntity('ai_apc', 1, 'UNIT', 'apc', 540, 430),
            ai_engineer_1: { ...engineer1, movement: { ...engineer1.movement, transportId: 'ai_apc' } },
            ai_engineer_2: { ...engineer2, movement: { ...engineer2.movement, transportId: 'ai_apc' } },
            escort_1: createEntity('escort_1', 1, 'UNIT', 'rifle', 520, 410),
            escort_2: createEntity('escort_2', 1, 'UNIT', 'grenadier', 525, 415),
            escort_3: createEntity('escort_3', 1, 'UNIT', 'rifle', 300, 300),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 6000), 1);
        const escortAction = actions.find(action =>
            isActionType(action, 'COMMAND_ATTACK_MOVE') &&
            action.payload.x === 940 &&
            action.payload.y === 620 &&
            action.payload.unitIds.length === 2 &&
            action.payload.unitIds.includes('escort_1') &&
            action.payload.unitIds.includes('escort_2')
        );
        expect(escortAction).toBeDefined();
        if (escortAction && isActionType(escortAction, 'COMMAND_ATTACK_MOVE')) {
            expect(new Set(escortAction.payload.unitIds)).toEqual(new Set(['escort_1', 'escort_2']));
        }
    });

    it('does not queue redundant APCs when current APC capacity already covers projected engineers', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 240, 260),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_apc_1: createEntity('ai_apc_1', 1, 'UNIT', 'apc', 520, 430),
            ai_apc_2: createEntity('ai_apc_2', 1, 'UNIT', 'apc', 550, 430),
            ai_engineer_1: createEntity('ai_engineer_1', 1, 'UNIT', 'engineer', 500, 450),
            ai_engineer_2: createEntity('ai_engineer_2', 1, 'UNIT', 'engineer', 510, 460),
            ai_engineer_3: createEntity('ai_engineer_3', 1, 'UNIT', 'engineer', 520, 470),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 7000), 1);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'vehicle' &&
            action.payload.key === 'apc'
        )).toBe(false);
    });

    it('does not inject APC production when the vehicle lane is already busy', () => {
        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 500, 500),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 430, 450),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 570, 500),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 620, 560),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 500, 620),
            ai_harv: createEntity('ai_harv', 1, 'UNIT', 'harvester', 550, 650),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 1200, 900)
        };

        const basePlayer = createPlayerState(1, true, 'hard', '#ff4444', ENGINEER_CONYARD_RUSH_ID);
        const state = {
            ...createState(entities, 4000, 8000),
            players: {
                0: createPlayerState(0, true, 'hard', '#4488ff'),
                1: {
                    ...basePlayer,
                    credits: 8000,
                    queues: {
                        ...basePlayer.queues,
                        vehicle: { current: 'light', progress: 20, invested: 150, queued: [] }
                    }
                }
            }
        } as GameState;

        const actions = computeAiActionsForPlayer(state, 1);
        const apcStart = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'vehicle' &&
            action.payload.key === 'apc'
        );

        expect(apcStart).toBeUndefined();
    });

    it('unloads loaded APCs only when close enough for immediate engineer entry pressure', () => {
        const engineer = createEntity('ai_engineer', 1, 'UNIT', 'engineer', 790, 620);
        const engineer2 = createEntity('ai_engineer_2', 1, 'UNIT', 'engineer', 790, 620);
        if (engineer.type !== 'UNIT') {
            throw new Error('expected engineer unit');
        }
        if (engineer2.type !== 'UNIT') {
            throw new Error('expected engineer unit');
        }

        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_apc: createEntity('ai_apc', 1, 'UNIT', 'apc', 790, 620),
            ai_engineer: {
                ...engineer,
                movement: { ...engineer.movement, transportId: 'ai_apc' }
            },
            ai_engineer_2: {
                ...engineer2,
                movement: { ...engineer2.movement, transportId: 'ai_apc' }
            },
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 4000), 1);

        expect(actions.some(action =>
            isActionType(action, 'COMMAND_UNGARRISON') &&
            action.payload.unitIds.includes('ai_apc')
        )).toBe(false);
        expect(actions).toContainEqual({
            type: 'COMMAND_MOVE',
            payload: { unitIds: ['ai_apc'], x: 900, y: 620 }
        });
    });

    it('unloads APC passengers near enemy conyards and reissues capture command', () => {
        const engineer = createEntity('ai_engineer', 1, 'UNIT', 'engineer', 860, 620);
        const engineer2 = createEntity('ai_engineer_2', 1, 'UNIT', 'engineer', 860, 620);
        if (engineer.type !== 'UNIT') {
            throw new Error('expected engineer unit');
        }
        if (engineer2.type !== 'UNIT') {
            throw new Error('expected engineer unit');
        }

        const entities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_apc: createEntity('ai_apc', 1, 'UNIT', 'apc', 860, 620),
            ai_engineer: {
                ...engineer,
                movement: { ...engineer.movement, transportId: 'ai_apc' }
            },
            ai_engineer_2: {
                ...engineer2,
                movement: { ...engineer2.movement, transportId: 'ai_apc' }
            },
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 4000), 1);
        expect(actions.some(action =>
            isActionType(action, 'COMMAND_UNGARRISON') &&
            action.payload.unitIds.includes('ai_apc')
        )).toBe(true);
        expect(getLatestSingleUnitAttackTarget(actions, 'ai_engineer')).toBe('enemy_conyard');
        expect(getLatestSingleUnitAttackTarget(actions, 'ai_engineer_2')).toBe('enemy_conyard');
    });

    it('sells captured enemy conyards after ownership transfer', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620)
        };

        computeAiActionsForPlayer(createState(baseEntities, 31, 4000), 1);

        const capturedEntities: Record<EntityId, Entity> = {
            ...baseEntities,
            enemy_conyard: createEntity('enemy_conyard', 1, 'BUILDING', 'conyard', 900, 620)
        };
        const actions = computeAiActionsForPlayer(createState(capturedEntities, 34, 4000), 1);

        expect(actions.some(action =>
            isActionType(action, 'SELL_BUILDING') &&
            action.payload.buildingId === 'enemy_conyard' &&
            action.payload.playerId === 1
        )).toBe(true);
    });

    it('uses a captured barracks to produce two replacement engineers before selling it', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer_1: createEntity('ai_engineer_1', 1, 'UNIT', 'engineer', 460, 430),
            ai_engineer_2: createEntity('ai_engineer_2', 1, 'UNIT', 'engineer', 470, 440),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 940, 650),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 980, 690)
        };
        computeAiActionsForPlayer(createState(baseEntities, 31, 6000), 1);

        const capturedEntities: Record<EntityId, Entity> = {
            ...baseEntities,
            ai_engineer_1: { ...baseEntities.ai_engineer_1, dead: true },
            ai_engineer_2: { ...baseEntities.ai_engineer_2, dead: true },
            enemy_conyard: createEntity('enemy_conyard', 1, 'BUILDING', 'conyard', 900, 620),
            enemy_barracks: createEntity('enemy_barracks', 1, 'BUILDING', 'barracks', 940, 650)
        };
        const capturedActions = computeAiActionsForPlayer(createState(capturedEntities, 34, 6000), 1);
        expect(capturedActions).toContainEqual({
            type: 'SET_PRIMARY_BUILDING',
            payload: { buildingId: 'enemy_barracks', category: 'infantry', playerId: 1 }
        });
        expect(capturedActions.some(action =>
            isActionType(action, 'SELL_BUILDING') && action.payload.buildingId === 'enemy_barracks'
        )).toBe(false);

        const oneReplacement = {
            ...capturedEntities,
            replacement_1: createEntity('replacement_1', 1, 'UNIT', 'engineer', 940, 650)
        };
        const oneReplacementActions = computeAiActionsForPlayer(createState(oneReplacement, 37, 6000), 1);
        expect(oneReplacementActions.some(action =>
            isActionType(action, 'SELL_BUILDING') && action.payload.buildingId === 'enemy_barracks'
        )).toBe(false);

        const twoReplacements = {
            ...oneReplacement,
            replacement_2: createEntity('replacement_2', 1, 'UNIT', 'engineer', 945, 655)
        };
        const twoReplacementActions = computeAiActionsForPlayer(createState(twoReplacements, 40, 6000), 1);
        expect(twoReplacementActions).toContainEqual({
            type: 'SELL_BUILDING',
            payload: { buildingId: 'enemy_barracks', playerId: 1 }
        });
    });

    it('liquidates a critically damaged captured barracks instead of losing the refund', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy_barracks: createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 940, 650),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 980, 690)
        };
        computeAiActionsForPlayer(createState(baseEntities, 31, 4000), 1);

        const capturedBarracks = createEntity('enemy_barracks', 1, 'BUILDING', 'barracks', 940, 650);
        const capturedState = createState({
            ...baseEntities,
            ai_engineer: { ...baseEntities.ai_engineer, dead: true },
            enemy_barracks: { ...capturedBarracks, hp: Math.floor(capturedBarracks.maxHp * 0.2) }
        }, 34, 4000);
        const actions = computeAiActionsForPlayer(capturedState, 1);

        expect(actions).toContainEqual({
            type: 'SELL_BUILDING',
            payload: { buildingId: 'enemy_barracks', playerId: 1 }
        });
    });

    it('pauses failed raid replacement until recovery and two escorts are ready', () => {
        const engineer1 = createEntity('ai_engineer_1', 1, 'UNIT', 'engineer', 540, 430);
        const engineer2 = createEntity('ai_engineer_2', 1, 'UNIT', 'engineer', 540, 430);
        if (engineer1.type !== 'UNIT' || engineer2.type !== 'UNIT') throw new Error('expected engineer units');
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 250, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_harvester_1: createEntity('ai_harvester_1', 1, 'UNIT', 'harvester', 340, 470),
            ai_harvester_2: createEntity('ai_harvester_2', 1, 'UNIT', 'harvester', 370, 480),
            ai_apc: createEntity('ai_apc', 1, 'UNIT', 'apc', 540, 430),
            ai_engineer_1: { ...engineer1, movement: { ...engineer1.movement, transportId: 'ai_apc' } },
            ai_engineer_2: { ...engineer2, movement: { ...engineer2.movement, transportId: 'ai_apc' } },
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620)
        };
        computeAiActionsForPlayer(createState(baseEntities, 31, 8000), 1);

        const failedEntities: Record<EntityId, Entity> = {
            ...baseEntities,
            ai_apc: { ...baseEntities.ai_apc, dead: true },
            ai_engineer_1: { ...baseEntities.ai_engineer_1, dead: true },
            ai_engineer_2: { ...baseEntities.ai_engineer_2, dead: true }
        };
        const recoveryActions = computeAiActionsForPlayer(createState(failedEntities, 200, 8000), 1);
        expect(recoveryActions.some(action =>
            isActionType(action, 'START_BUILD') &&
            (action.payload.key === 'engineer' || action.payload.key === 'apc')
        )).toBe(false);

        const noEscortActions = computeAiActionsForPlayer(createState(failedEntities, 2200, 8000), 1);
        expect(noEscortActions.some(action =>
            isActionType(action, 'START_BUILD') &&
            (action.payload.key === 'engineer' || action.payload.key === 'apc')
        )).toBe(false);

        const escortedEntities = {
            ...failedEntities,
            escort_1: createEntity('escort_1', 1, 'UNIT', 'rifle', 500, 400),
            escort_2: createEntity('escort_2', 1, 'UNIT', 'grenadier', 510, 410)
        };
        const retryActions = computeAiActionsForPlayer(createState(escortedEntities, 2203, 8000), 1);
        expect(retryActions.some(action =>
            isActionType(action, 'START_BUILD') && action.payload.key === 'engineer'
        )).toBe(true);
        expect(retryActions.some(action =>
            isActionType(action, 'START_BUILD') && action.payload.key === 'apc'
        )).toBe(true);
    });

    it('reserves capture-sale proceeds from discretionary building starts until the next package is funded', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power: createEntity('ai_power', 1, 'BUILDING', 'power', 250, 300),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 980, 690)
        };
        computeAiActionsForPlayer(createState(baseEntities, 31, 6000), 1);
        const capturedState = createState({
            ...baseEntities,
            ai_engineer: { ...baseEntities.ai_engineer, dead: true },
            enemy_conyard: createEntity('enemy_conyard', 1, 'BUILDING', 'conyard', 900, 620)
        }, 34, 6000);

        const actions = computeAiActionsForPlayer(capturedState, 1);
        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') && action.payload.category === 'building'
        )).toBe(false);
        expect(actions).toContainEqual({
            type: 'SELL_BUILDING',
            payload: { buildingId: 'enemy_conyard', playerId: 1 }
        });
    });

    it('delegates post-capture macro without continuing rush production', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 180, 300),
            ai_power_2: createEntity('ai_power_2', 1, 'BUILDING', 'power', 180, 380),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620)
        };

        const scoutingBase = createState(baseEntities, 31, 6000);
        const scoutingState = {
            ...scoutingBase,
            players: {
                ...scoutingBase.players,
                1: { ...scoutingBase.players[1], maxPower: 1200, usedPower: 100 }
            }
        } as GameState;
        computeAiActionsForPlayer(scoutingState, 1);

        const capturedEntities: Record<EntityId, Entity> = {
            ...baseEntities,
            enemy_conyard: createEntity('enemy_conyard', 1, 'BUILDING', 'conyard', 900, 620)
        };
        const capturedBase = createState(capturedEntities, 34, 6000);
        const capturedState = {
            ...capturedBase,
            players: {
                ...capturedBase.players,
                1: { ...capturedBase.players[1], maxPower: 1200, usedPower: 100 }
            }
        } as GameState;

        const actions = computeAiActionsForPlayer(capturedState, 1);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'infantry' &&
            action.payload.key === 'engineer'
        )).toBe(false);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'vehicle' &&
            action.payload.key === 'apc'
        )).toBe(false);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'building' &&
            action.payload.key === 'power'
        )).toBe(false);
    });

    it('preserves Aurora-selected post-capture building starts', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 180, 300),
            ai_power_2: createEntity('ai_power_2', 1, 'BUILDING', 'power', 180, 380),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_pillbox: createEntity('ai_pillbox', 1, 'BUILDING', 'pillbox', 560, 430),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620)
        };

        computeAiActionsForPlayer(createState(baseEntities, 31, 7000), 1);

        const capturedState = createState(
            {
                ...baseEntities,
                enemy_conyard: createEntity('enemy_conyard', 1, 'BUILDING', 'conyard', 900, 620)
            },
            34,
            7000
        );
        const actions = computeAiActionsForPlayer(capturedState, 1);
        const firstBuildingStart = actions.find(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'building'
        );

        expect(firstBuildingStart).toMatchObject({
            type: 'START_BUILD',
            payload: { category: 'building', key: 'factory', playerId: 1 }
        });
    });

    it('uses actual building power instead of stale player counters after capture', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 180, 300),
            ai_power_2: createEntity('ai_power_2', 1, 'BUILDING', 'power', 180, 380),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620)
        };

        const scoutingBase = createState(baseEntities, 31, 6000);
        const scoutingState = {
            ...scoutingBase,
            players: {
                ...scoutingBase.players,
                1: { ...scoutingBase.players[1], maxPower: 0, usedPower: 0 }
            }
        } as GameState;
        computeAiActionsForPlayer(scoutingState, 1);

        const capturedEntities: Record<EntityId, Entity> = {
            ...baseEntities,
            enemy_conyard: createEntity('enemy_conyard', 1, 'BUILDING', 'conyard', 900, 620)
        };
        const capturedBase = createState(capturedEntities, 34, 6000);
        const capturedState = {
            ...capturedBase,
            players: {
                ...capturedBase.players,
                1: { ...capturedBase.players[1], maxPower: 0, usedPower: 0 }
            }
        } as GameState;

        const actions = computeAiActionsForPlayer(capturedState, 1);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'building' &&
            action.payload.key === 'power'
        )).toBe(false);
    });

    it('places a carried power plant once and queues defense behind it after capture', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620)
        };

        const scoutingBase = createState(baseEntities, 31, 6000);
        const scoutingState = {
            ...scoutingBase,
            players: {
                ...scoutingBase.players,
                1: { ...scoutingBase.players[1], maxPower: 1200, usedPower: 100 }
            }
        } as GameState;
        computeAiActionsForPlayer(scoutingState, 1);

        const capturedEntities: Record<EntityId, Entity> = {
            ...baseEntities,
            enemy_conyard: createEntity('enemy_conyard', 1, 'BUILDING', 'conyard', 900, 620)
        };
        const capturedBase = createState(capturedEntities, 34, 6000);
        const capturedState = {
            ...capturedBase,
            players: {
                ...capturedBase.players,
                1: {
                    ...capturedBase.players[1],
                    maxPower: 1200,
                    usedPower: 100,
                    readyToPlace: 'power'
                }
            }
        } as GameState;

        const actions = computeAiActionsForPlayer(capturedState, 1);
        const placePowerIndex = actions.findIndex(action =>
            isActionType(action, 'PLACE_BUILDING') &&
            action.payload.playerId === 1 &&
            action.payload.key === 'power'
        );

        expect(placePowerIndex).toBeGreaterThanOrEqual(0);
        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'building' &&
            action.payload.key === 'power'
        )).toBe(false);
    });

    it('finishes one in-progress power plant without queuing more power after capture', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy0_conyard: createEntity('enemy0_conyard', 0, 'BUILDING', 'conyard', 900, 620),
            enemy2_conyard: createEntity('enemy2_conyard', 2, 'BUILDING', 'conyard', 1120, 700)
        };

        const baseAiPlayer = createPlayerState(1, true, 'hard', '#ff4444', ENGINEER_CONYARD_RUSH_ID);
        const scoutingState = {
            ...createState(baseEntities, 31, 6000),
            players: {
                0: createPlayerState(0, false, 'medium', '#4488ff'),
                1: { ...baseAiPlayer, credits: 6000, maxPower: 1200, usedPower: 100 },
                2: createPlayerState(2, false, 'medium', '#44ff88')
            }
        } as GameState;
        computeAiActionsForPlayer(scoutingState, 1);

        const capturedState = {
            ...createState(
                {
                    ...baseEntities,
                    enemy0_conyard: createEntity('enemy0_conyard', 1, 'BUILDING', 'conyard', 900, 620)
                },
                34,
                6000
            ),
            players: {
                0: createPlayerState(0, false, 'medium', '#4488ff'),
                1: {
                    ...baseAiPlayer,
                    credits: 6000,
                    maxPower: 1200,
                    usedPower: 100,
                    queues: {
                        ...baseAiPlayer.queues,
                        building: { current: 'power', progress: 50, invested: 150, queued: [] }
                    }
                },
                2: createPlayerState(2, false, 'medium', '#44ff88')
            }
        } as GameState;

        const actions = computeAiActionsForPlayer(capturedState, 1);

        expect(actions.some(action =>
            isActionType(action, 'CANCEL_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'building'
        )).toBe(false);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'building' &&
            action.payload.key === 'power'
        )).toBe(false);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'vehicle' &&
            action.payload.key === 'harvester'
        )).toBe(true);

        expect(getLatestSingleUnitAttackTarget(actions, 'ai_engineer')).toBe('enemy2_conyard');
    });

    it('continues conyard capture pressure after first capture if other enemies still have conyards', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_power_1: createEntity('ai_power_1', 1, 'BUILDING', 'power', 180, 300),
            ai_power_2: createEntity('ai_power_2', 1, 'BUILDING', 'power', 180, 380),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy0_conyard: createEntity('enemy0_conyard', 0, 'BUILDING', 'conyard', 900, 620),
            enemy2_conyard: createEntity('enemy2_conyard', 2, 'BUILDING', 'conyard', 1120, 700)
        };

        const players = {
            0: createPlayerState(0, false, 'medium', '#4488ff'),
            1: {
                ...createPlayerState(1, true, 'hard', '#ff4444', ENGINEER_CONYARD_RUSH_ID),
                maxPower: 1200,
                usedPower: 100
            },
            2: createPlayerState(2, false, 'medium', '#44ff88')
        };

        const scoutingState = {
            ...createState(baseEntities, 31, 6000),
            players
        } as GameState;
        computeAiActionsForPlayer(scoutingState, 1);

        const capturedState = {
            ...createState(
                {
                    ...baseEntities,
                    enemy0_conyard: createEntity('enemy0_conyard', 1, 'BUILDING', 'conyard', 900, 620)
                },
                34,
                6000
            ),
            players
        } as GameState;
        const actions = computeAiActionsForPlayer(capturedState, 1);

        expect(getLatestSingleUnitAttackTarget(actions, 'ai_engineer')).toBe('enemy2_conyard');
    });

    it('captures and sells enemy refineries after construction yards are gone', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 920, 650)
        };

        const captureActions = computeAiActionsForPlayer(createState(baseEntities, 31, 4000), 1);
        expect(getLatestSingleUnitAttackTarget(captureActions, 'ai_engineer')).toBe('enemy_refinery');

        const capturedState = createState(
            {
                ...baseEntities,
                enemy_refinery: createEntity('enemy_refinery', 1, 'BUILDING', 'refinery', 920, 650)
            },
            34,
            4000
        );
        const actions = computeAiActionsForPlayer(capturedState, 1);

        expect(actions.some(action =>
            isActionType(action, 'SELL_BUILDING') &&
            action.payload.buildingId === 'enemy_refinery' &&
            action.payload.playerId === 1
        )).toBe(true);
    });

    it('does not sell its original conyard after recapturing it', () => {
        const initialEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620)
        };
        computeAiActionsForPlayer(createState(initialEntities, 31, 4000), 1);

        const lostEntities: Record<EntityId, Entity> = {
            ...initialEntities,
            ai_conyard: createEntity('ai_conyard', 0, 'BUILDING', 'conyard', 320, 320)
        };
        computeAiActionsForPlayer(createState(lostEntities, 34, 4000), 1);

        const recapturedEntities: Record<EntityId, Entity> = {
            ...initialEntities,
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320)
        };
        const actions = computeAiActionsForPlayer(createState(recapturedEntities, 37, 4000), 1);

        expect(actions.some(action =>
            isActionType(action, 'SELL_BUILDING') &&
            action.payload.buildingId === 'ai_conyard'
        )).toBe(false);
    });

    it('holds solo engineers for synchronized transport across repeated raid decisions', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            enemy0_conyard: createEntity('enemy0_conyard', 0, 'BUILDING', 'conyard', 900, 620),
            enemy2_conyard: createEntity('enemy2_conyard', 2, 'BUILDING', 'conyard', 1120, 700)
        };

        const playersWithEnemyTwo = {
            0: createPlayerState(0, false, 'medium', '#4488ff'),
            1: createPlayerState(1, true, 'hard', '#ff4444', ENGINEER_CONYARD_RUSH_ID),
            2: createPlayerState(2, false, 'medium', '#44ff88')
        };

        const firstState = {
            ...createState(
                {
                    ...baseEntities,
                    ai_engineer_1: createEntity('ai_engineer_1', 1, 'UNIT', 'engineer', 460, 430)
                },
                31,
                4000
            ),
            players: playersWithEnemyTwo
        } as GameState;

        const firstActions = computeAiActionsForPlayer(firstState, 1);
        expect(firstActions).toContainEqual({
            type: 'COMMAND_MOVE',
            payload: { unitIds: ['ai_engineer_1'], x: 460, y: 430 }
        });

        const secondState = {
            ...createState(
                {
                    ...baseEntities,
                    ai_engineer_2: createEntity('ai_engineer_2', 1, 'UNIT', 'engineer', 465, 435)
                },
                34,
                4000
            ),
            players: playersWithEnemyTwo
        } as GameState;

        const secondActions = computeAiActionsForPlayer(secondState, 1);
        expect(secondActions).toContainEqual({
            type: 'COMMAND_MOVE',
            payload: { unitIds: ['ai_engineer_2'], x: 465, y: 435 }
        });
    });
});

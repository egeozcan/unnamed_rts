import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { computeAiActionsForPlayer } from '../../src/engine/ai/controller.js';
import { getAIImplementation, getAIImplementationOptions } from '../../src/engine/ai/registry.js';
import { BuildingKey, Entity, EntityId, GameState, UnitKey, isActionType } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit, createTestHarvester, createTestResource } from '../../src/engine/test-utils.js';

const ENGINEER_CONYARD_RUSH_ID = 'engineer_conyard_rush';
const DEFENSE_KEYS = new Set(['turret', 'pillbox', 'sam_site', 'obelisk']);

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
        if (engineer.type !== 'UNIT') {
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
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 940, 620)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 4000), 1);
        expect(getLatestSingleUnitAttackTarget(actions, 'ai_apc')).toBe('enemy_conyard');
    });

    it('unloads APC passengers near enemy conyards and reissues capture command', () => {
        const engineer = createEntity('ai_engineer', 1, 'UNIT', 'engineer', 860, 620);
        if (engineer.type !== 'UNIT') {
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
            enemy_conyard: createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 900, 620)
        };

        const actions = computeAiActionsForPlayer(createState(entities, 31, 4000), 1);
        expect(actions.some(action =>
            isActionType(action, 'COMMAND_UNGARRISON') &&
            action.payload.unitIds.includes('ai_apc')
        )).toBe(true);
        expect(getLatestSingleUnitAttackTarget(actions, 'ai_engineer')).toBe('enemy_conyard');
    });

    it('keeps captured enemy conyards after ownership transfer', () => {
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
        )).toBe(false);
    });

    it('shifts to defense and economy builds after a successful conyard capture', () => {
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
            action.payload.category === 'building' &&
            DEFENSE_KEYS.has(action.payload.key)
        )).toBe(true);

        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'vehicle' &&
            action.payload.key === 'harvester'
        )).toBe(true);

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
            DEFENSE_KEYS.has(action.payload.key)
        )).toBe(true);

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
        const defenseBuildIndex = actions.findIndex(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.playerId === 1 &&
            action.payload.category === 'building' &&
            DEFENSE_KEYS.has(action.payload.key)
        );

        expect(placePowerIndex).toBeGreaterThanOrEqual(0);
        expect(defenseBuildIndex).toBeGreaterThan(placePowerIndex);
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
        expect(actions.some(action =>
            isActionType(action, 'START_BUILD') &&
            action.payload.category === 'building' &&
            DEFENSE_KEYS.has(action.payload.key)
        )).toBe(true);
    });

    it('sells captured enemy refineries for cash swing', () => {
        const baseEntities: Record<EntityId, Entity> = {
            ai_conyard: createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 320, 320),
            ai_barracks: createEntity('ai_barracks', 1, 'BUILDING', 'barracks', 420, 350),
            ai_factory: createEntity('ai_factory', 1, 'BUILDING', 'factory', 500, 360),
            ai_refinery: createEntity('ai_refinery', 1, 'BUILDING', 'refinery', 300, 420),
            ai_engineer: createEntity('ai_engineer', 1, 'UNIT', 'engineer', 460, 430),
            enemy_refinery: createEntity('enemy_refinery', 0, 'BUILDING', 'refinery', 920, 650)
        };

        computeAiActionsForPlayer(createState(baseEntities, 31, 4000), 1);

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

    it('rotates engineers one-by-one across enemy players that still have conyards', () => {
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
        const firstTargetId = getLatestSingleUnitAttackTarget(firstActions, 'ai_engineer_1');
        expect(firstTargetId).not.toBeNull();

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
        const secondTargetId = getLatestSingleUnitAttackTarget(secondActions, 'ai_engineer_2');
        expect(secondTargetId).not.toBeNull();

        const firstTargetOwner = firstTargetId ? firstState.entities[firstTargetId]?.owner ?? null : null;
        const secondTargetOwner = secondTargetId ? secondState.entities[secondTargetId]?.owner ?? null : null;
        expect(firstTargetOwner).not.toBe(secondTargetOwner);

        const ownerSet = new Set([firstTargetOwner, secondTargetOwner]);
        expect(ownerSet.has(0)).toBe(true);
        expect(ownerSet.has(2)).toBe(true);
    });
});

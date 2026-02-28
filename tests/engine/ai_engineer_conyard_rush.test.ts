import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { computeAiActionsForPlayer } from '../../src/engine/ai/controller.js';
import { getAIImplementation, getAIImplementationOptions } from '../../src/engine/ai/registry.js';
import { BuildingKey, Entity, EntityId, GameState, UnitKey, isActionType } from '../../src/engine/types.js';
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

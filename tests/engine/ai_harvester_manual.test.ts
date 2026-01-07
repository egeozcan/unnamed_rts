import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState } from '../../src/engine/ai/index.js';
import { GameState, Entity, EntityId, Vector, UnitKey, BuildingKey } from '../../src/engine/types';
import { INITIAL_STATE } from '../../src/engine/reducer';
import {
    createTestHarvester,
    createTestCombatUnit,
    createTestBuilding,
    createTestResource
} from '../../src/engine/test-utils';

// Helper to create minimal entity
function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number,
    overrides?: {
        hp?: number;
        maxHp?: number;
        dead?: boolean;
        targetId?: EntityId | null;
        lastAttackerId?: EntityId | null;
        moveTarget?: Vector | null;
        cargo?: number;
        resourceTargetId?: EntityId | null;
        baseTargetId?: EntityId | null;
        manualMode?: boolean;
        placedTick?: number;
        isRepairing?: boolean;
    }
): Entity {
    if (type === 'BUILDING') {
        return createTestBuilding({
            id, owner, key: key as BuildingKey, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp, dead: overrides?.dead,
            targetId: overrides?.targetId, placedTick: overrides?.placedTick,
            isRepairing: overrides?.isRepairing
        });
    } else if (type === 'RESOURCE') {
        return createTestResource({ id, x, y, hp: overrides?.hp });
    } else if (key === 'harvester') {
        return createTestHarvester({
            id, owner, x, y, hp: overrides?.hp, dead: overrides?.dead,
            targetId: overrides?.targetId, moveTarget: overrides?.moveTarget,
            cargo: overrides?.cargo, resourceTargetId: overrides?.resourceTargetId,
            baseTargetId: overrides?.baseTargetId, manualMode: overrides?.manualMode
        });
    } else {
        return createTestCombatUnit({
            id, owner, key: key as Exclude<UnitKey, 'harvester' | 'harrier'>, x, y,
            hp: overrides?.hp, maxHp: overrides?.maxHp, dead: overrides?.dead,
            targetId: overrides?.targetId, lastAttackerId: overrides?.lastAttackerId,
            moveTarget: overrides?.moveTarget
        });
    }
}

// Helper to create test state
function createTestState(entities: Record<EntityId, Entity>): GameState {
    let state: GameState = {
        ...INITIAL_STATE,
        running: true,
        mode: 'game' as const,
        entities: entities as Record<EntityId, Entity>
    };

    // Initialize players
    const players: Record<number, any> = {};
    for (let i = 0; i < 2; i++) {
        players[i] = {
            id: i,
            isAi: i > 0, // Player 1 is AI
            difficulty: 'medium' as const,
            color: '#ff0000',
            credits: 1000,
            maxPower: 100,
            usedPower: 0,
            queues: {
                building: { current: null, progress: 0, invested: 0 },
                infantry: { current: null, progress: 0, invested: 0 },
                vehicle: { current: null, progress: 0, invested: 0 },
                air: { current: null, progress: 0, invested: 0 }
            },
            readyToPlace: null
        };
    }
    state = { ...state, players };
    return state;
}

describe('AI Harvester Manual Mode Recovery', () => {
    beforeEach(() => {
        resetAIState();
    });

    it('should command idle harvesters in manual mode to resume harvesting', () => {
        const entities: Record<EntityId, Entity> = {};

        // Player 1 has a harvester that is idle and in manual mode (e.g. after fleeing)
        // manualMode: true means it won't auto-acquire resources
        entities['harv_1'] = createEntity('harv_1', 1, 'UNIT', 'harvester', 500, 500, {
            manualMode: true,
            moveTarget: null,
            resourceTargetId: null,
            baseTargetId: null
        });

        // Add an ore resource nearby
        entities['ore_1'] = createEntity('ore_1', -1, 'RESOURCE', 'ore', 550, 500);

        // Add a refinery so harvester has a "home" (though logic mainly checks for resources)
        entities['ref_1'] = createEntity('ref_1', 1, 'BUILDING', 'refinery', 600, 500);

        let state = createTestState(entities);
        // Ensure it's tick 0 or multiple of 30 to trigger AI
        state = { ...state, tick: 31 }; // tick % 3 === 1 for player 1 AI

        const actions = computeAiActions(state, 1);

        // Expect a COMMAND_ATTACK action targeting the ore
        // This command will reset manualMode to false in the reducer
        const attackActions = actions.filter(a =>
            a.type === 'COMMAND_ATTACK' &&
            a.payload.unitIds.includes('harv_1') &&
            a.payload.targetId === 'ore_1'
        );

        expect(attackActions.length).toBe(1);
    });

    it('should NOT command harvester if it is moving (has moveTarget)', () => {
        const entities: Record<EntityId, Entity> = {};

        // Harvester is moving (fleeing or traversing)
        entities['harv_1'] = createEntity('harv_1', 1, 'UNIT', 'harvester', 500, 500, {
            manualMode: true,
            moveTarget: new Vector(400, 400),
            resourceTargetId: null
        });

        entities['ore_1'] = createEntity('ore_1', -1, 'RESOURCE', 'ore', 550, 500);
        entities['ref_1'] = createEntity('ref_1', 1, 'BUILDING', 'refinery', 600, 500);

        let state = createTestState(entities);
        state = { ...state, tick: 31 }; // tick % 3 === 1 for player 1 AI

        const actions = computeAiActions(state, 1);

        // Should NOT interrupt movement
        const attackActions = actions.filter(a =>
            a.type === 'COMMAND_ATTACK' &&
            a.payload.unitIds.includes('harv_1')
        );

        expect(attackActions.length).toBe(0);
    });

    it('should NOT command harvester if it has a resource target (already working)', () => {
        const entities: Record<EntityId, Entity> = {};

        // Harvester is already working (manualMode could be false or true if manual target set? 
        // Logic checks !resourceTargetId)
        entities['harv_1'] = createEntity('harv_1', 1, 'UNIT', 'harvester', 500, 500, {
            manualMode: false,
            resourceTargetId: 'ore_1'
        });

        entities['ore_1'] = createEntity('ore_1', -1, 'RESOURCE', 'ore', 550, 500);
        entities['ref_1'] = createEntity('ref_1', 1, 'BUILDING', 'refinery', 600, 500);

        let state = createTestState(entities);
        state = { ...state, tick: 31 }; // tick % 3 === 1 for player 1 AI

        const actions = computeAiActions(state, 1);

        const attackActions = actions.filter(a =>
            a.type === 'COMMAND_ATTACK' &&
            a.payload.unitIds.includes('harv_1')
        );

        expect(attackActions.length).toBe(0);
    });

    it('should prioritize fleeing over resuming work if threatened', () => {
        const entities: Record<EntityId, Entity> = {};

        // Harvester is idle/manual but THREATENED
        entities['harv_1'] = createEntity('harv_1', 1, 'UNIT', 'harvester', 500, 500, {
            manualMode: true,
            moveTarget: null,
            resourceTargetId: null
        });

        entities['ore_1'] = createEntity('ore_1', -1, 'RESOURCE', 'ore', 550, 500);
        entities['ref_1'] = createEntity('ref_1', 1, 'BUILDING', 'refinery', 600, 500);

        // Enemy tank right next to harvester
        entities['tank_1'] = createEntity('tank_1', 0, 'UNIT', 'medium', 510, 510);

        let state = createTestState(entities);
        state = { ...state, tick: 31 }; // tick % 3 === 1 for player 1 AI

        const actions = computeAiActions(state, 1);

        // Should have MOVE command (flee), NOT ATTACK command (work)
        const moveActions = actions.filter(a =>
            a.type === 'COMMAND_MOVE' &&
            a.payload.unitIds.includes('harv_1')
        );

        const attackActions = actions.filter(a =>
            a.type === 'COMMAND_ATTACK' &&
            a.payload.unitIds.includes('harv_1') &&
            (a.payload.targetId === 'ore_1') // Targeting ore
        );

        // Note: It might attack the enemy if desperate? No, harvesters flee.
        // But logic for "flee or work" is exclusive in my code (if/else).

        expect(moveActions.length).toBeGreaterThan(0);
        expect(attackActions.length).toBe(0);
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { INITIAL_STATE, createPlayerState, update } from '../../src/engine/reducer.js';
import { EntityId, Entity, GameState, Vector, UnitEntity } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit } from '../../src/engine/test-utils.js';
import { getSpatialGrid } from '../../src/engine/spatial.js';

function createBaseState(): GameState {
    const state: GameState = {
        ...INITIAL_STATE,
        running: true,
        mode: 'game',
        config: { width: 2000, height: 2000, resourceDensity: 'medium', rockDensity: 'medium' },
        players: {
            0: createPlayerState(0, false, 'medium'),
            1: createPlayerState(1, true, 'medium')
        },
        entities: {}
    };

    const p0Conyard = createTestBuilding({ id: 'cy0', owner: 0, key: 'conyard', x: 120, y: 120 });
    const p1Conyard = createTestBuilding({ id: 'cy1', owner: 1, key: 'conyard', x: 1880, y: 1880 });
    return {
        ...state,
        entities: {
            ...state.entities,
            [p0Conyard.id]: p0Conyard,
            [p1Conyard.id]: p1Conyard
        }
    };
}

function tickN(state: GameState, ticks: number): GameState {
    let next = state;
    for (let i = 0; i < ticks; i++) {
        next = update(next, { type: 'TICK' });
    }
    return next;
}

function passengerIds(state: GameState, transportId: EntityId): EntityId[] {
    return Object.values(state.entities)
        .filter((entity): entity is UnitEntity =>
            entity.type === 'UNIT' &&
            !entity.dead &&
            entity.movement.transportId === transportId
        )
        .map(entity => entity.id);
}

describe('Transport Garrison (APC)', () => {
    beforeEach(() => {
        getSpatialGrid().clear();
    });

    it('boards infantry into friendly APC when already in entry range', () => {
        let state = createBaseState();

        const apc = createTestCombatUnit({ id: 'apc1', owner: 0, key: 'apc', x: 500, y: 500, hp: 300, maxHp: 300 });
        const rifle = createTestCombatUnit({ id: 'rifle1', owner: 0, key: 'rifle', x: 515, y: 500, hp: 100, maxHp: 100 });
        state = { ...state, entities: { ...state.entities, [apc.id]: apc, [rifle.id]: rifle } };

        state = update(state, {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: [rifle.id], targetId: apc.id }
        });
        state = tickN(state, 2);

        const updatedRifle = state.entities[rifle.id] as UnitEntity;
        expect(updatedRifle.movement.transportId).toBe(apc.id);
    });

    it('moves infantry toward APC and boards when out of range', () => {
        let state = createBaseState();

        const apc = createTestCombatUnit({ id: 'apc1', owner: 0, key: 'apc', x: 900, y: 500, hp: 300, maxHp: 300 });
        const rifle = createTestCombatUnit({ id: 'rifle1', owner: 0, key: 'rifle', x: 300, y: 500, hp: 100, maxHp: 100 });
        state = { ...state, entities: { ...state.entities, [apc.id]: apc, [rifle.id]: rifle } };

        state = update(state, {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: [rifle.id], targetId: apc.id }
        });
        state = tickN(state, 420);

        const updatedRifle = state.entities[rifle.id] as UnitEntity;
        expect(updatedRifle.movement.transportId).toBe(apc.id);
    });

    it('does not allow non-infantry units to board APC', () => {
        let state = createBaseState();

        const apc = createTestCombatUnit({ id: 'apc1', owner: 0, key: 'apc', x: 500, y: 500, hp: 300, maxHp: 300 });
        const tank = createTestCombatUnit({ id: 'tank1', owner: 0, key: 'light', x: 515, y: 500, hp: 400, maxHp: 400 });
        state = { ...state, entities: { ...state.entities, [apc.id]: apc, [tank.id]: tank } };

        state = update(state, {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: [tank.id], targetId: apc.id }
        });
        state = tickN(state, 20);

        const updatedTank = state.entities[tank.id] as UnitEntity;
        expect(updatedTank.movement.transportId).toBeFalsy();
    });

    it('does not allow boarding enemy APC', () => {
        let state = createBaseState();

        const enemyApc = createTestCombatUnit({ id: 'apc_enemy', owner: 1, key: 'apc', x: 500, y: 500, hp: 300, maxHp: 300 });
        const rifle = createTestCombatUnit({ id: 'rifle1', owner: 0, key: 'rifle', x: 515, y: 500, hp: 100, maxHp: 100 });
        state = { ...state, entities: { ...state.entities, [enemyApc.id]: enemyApc, [rifle.id]: rifle } };

        state = update(state, {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: [rifle.id], targetId: enemyApc.id }
        });
        state = tickN(state, 20);

        const updatedRifle = state.entities[rifle.id] as UnitEntity;
        expect(updatedRifle.movement.transportId).toBeFalsy();
    });

    it('enforces APC capacity 5 (6th infantry remains outside)', () => {
        let state = createBaseState();

        const apc = createTestCombatUnit({ id: 'apc1', owner: 0, key: 'apc', x: 700, y: 700, hp: 300, maxHp: 300 });
        const entities: Record<EntityId, Entity> = { ...state.entities, [apc.id]: apc };
        const infantryIds: string[] = [];
        for (let i = 0; i < 6; i++) {
            const infantry = createTestCombatUnit({
                id: `rifle_${i}`,
                owner: 0,
                key: 'rifle',
                x: 700 + (i * 8),
                y: 745,
                hp: 100,
                maxHp: 100
            });
            entities[infantry.id] = infantry;
            infantryIds.push(infantry.id);
        }
        state = { ...state, entities };

        state = update(state, {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: infantryIds, targetId: apc.id }
        });
        state = tickN(state, 120);

        const loaded = passengerIds(state, apc.id);
        expect(loaded.length).toBe(5);
    });

    it('COMMAND_UNGARRISON unloads every passenger', () => {
        let state = createBaseState();

        const apc = createTestCombatUnit({ id: 'apc1', owner: 0, key: 'apc', x: 600, y: 600, hp: 300, maxHp: 300 });
        const rifle1 = createTestCombatUnit({ id: 'rifle1', owner: 0, key: 'rifle', x: 600, y: 600 });
        const rifle2 = createTestCombatUnit({ id: 'rifle2', owner: 0, key: 'rifle', x: 600, y: 600 });
        const rifle3 = createTestCombatUnit({ id: 'rifle3', owner: 0, key: 'rifle', x: 600, y: 600 });

        state = {
            ...state,
            entities: {
                ...state.entities,
                [apc.id]: apc,
                [rifle1.id]: { ...rifle1, movement: { ...rifle1.movement, transportId: apc.id } },
                [rifle2.id]: { ...rifle2, movement: { ...rifle2.movement, transportId: apc.id } },
                [rifle3.id]: { ...rifle3, movement: { ...rifle3.movement, transportId: apc.id } }
            }
        };

        state = update(state, {
            type: 'COMMAND_UNGARRISON',
            payload: { unitIds: [apc.id] }
        });

        for (const id of [rifle1.id, rifle2.id, rifle3.id]) {
            const infantry = state.entities[id] as UnitEntity;
            expect(infantry.movement.transportId).toBeFalsy();
            expect(infantry.pos.dist(apc.pos)).toBeLessThanOrEqual(apc.radius + 30);
        }
    });

    it('garrisoned infantry does not fire while transported', () => {
        let state = createBaseState();

        const apc = createTestCombatUnit({ id: 'apc1', owner: 0, key: 'apc', x: 500, y: 500, hp: 300, maxHp: 300 });
        const rifle = createTestCombatUnit({ id: 'rifle1', owner: 0, key: 'rifle', x: 500, y: 500, targetId: 'enemy1' });
        const enemy = createTestCombatUnit({ id: 'enemy1', owner: 1, key: 'rifle', x: 700, y: 500, hp: 100, maxHp: 100 });
        state = {
            ...state,
            entities: {
                ...state.entities,
                [apc.id]: apc,
                [rifle.id]: { ...rifle, movement: { ...rifle.movement, transportId: apc.id } },
                [enemy.id]: enemy
            }
        };

        const initialEnemyHp = (state.entities[enemy.id] as UnitEntity).hp;
        state = tickN(state, 120);

        const updatedEnemy = state.entities[enemy.id] as UnitEntity;
        expect(updatedEnemy.hp).toBe(initialEnemyHp);
    });

    it('destroyed APC ejects passengers with 60% max HP damage and 5% HP floor', () => {
        let state = createBaseState();

        const apc = createTestCombatUnit({ id: 'apc1', owner: 0, key: 'apc', x: 700, y: 700, hp: 0, maxHp: 300, dead: true });
        const healthy = createTestCombatUnit({ id: 'rifle_full', owner: 0, key: 'rifle', x: 700, y: 700, hp: 100, maxHp: 100 });
        const lowHp = createTestCombatUnit({ id: 'rifle_low', owner: 0, key: 'rifle', x: 700, y: 700, hp: 10, maxHp: 100 });

        state = {
            ...state,
            entities: {
                ...state.entities,
                [apc.id]: apc,
                [healthy.id]: { ...healthy, movement: { ...healthy.movement, transportId: apc.id } },
                [lowHp.id]: { ...lowHp, movement: { ...lowHp.movement, transportId: apc.id } }
            }
        };

        state = update(state, { type: 'TICK' });

        const healthyAfter = state.entities[healthy.id] as UnitEntity;
        const lowAfter = state.entities[lowHp.id] as UnitEntity;

        expect(healthyAfter.movement.transportId).toBeFalsy();
        expect(healthyAfter.hp).toBe(40); // 100 - 60
        expect(healthyAfter.dead).toBe(false);

        expect(lowAfter.movement.transportId).toBeFalsy();
        expect(lowAfter.hp).toBe(5); // 5% floor
        expect(lowAfter.dead).toBe(false);
    });

    it('ownership mismatch ejects passengers without damage', () => {
        let state = createBaseState();

        const apc = createTestCombatUnit({ id: 'apc1', owner: 1, key: 'apc', x: 900, y: 900, hp: 300, maxHp: 300 });
        const enemyPassenger = createTestCombatUnit({ id: 'rifle_enemy', owner: 0, key: 'rifle', x: 900, y: 900, hp: 70, maxHp: 100 });
        const ownerPassenger = createTestCombatUnit({ id: 'rifle_owner', owner: 1, key: 'rifle', x: 900, y: 900, hp: 80, maxHp: 100 });
        state = {
            ...state,
            entities: {
                ...state.entities,
                [apc.id]: apc,
                [enemyPassenger.id]: { ...enemyPassenger, movement: { ...enemyPassenger.movement, transportId: apc.id } },
                [ownerPassenger.id]: { ...ownerPassenger, movement: { ...ownerPassenger.movement, transportId: apc.id } }
            }
        };

        state = update(state, { type: 'TICK' });

        const enemyAfter = state.entities[enemyPassenger.id] as UnitEntity;
        const ownerAfter = state.entities[ownerPassenger.id] as UnitEntity;

        expect(enemyAfter.hp).toBe(70);
        expect(enemyAfter.movement.transportId).toBeFalsy();
        expect(ownerAfter.movement.transportId).toBe(apc.id);
    });
});

import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from '../../src/engine/reducer.js';
import { Vector, type Action, type Entity, type GameState } from '../../src/engine/types.js';
import { createTestCombatUnit } from '../../src/engine/test-utils.js';
import { dropNoOpStanceActions } from '../../src/engine/ai/implementations/engineer_conyard_rush/index.js';

function unitWith(id: string, stance: 'hold_ground' | 'aggressive', home: Vector | null, transportId: string | null = null): Entity {
    const base = createTestCombatUnit({ id, owner: 0 });
    return {
        ...base,
        movement: { ...base.movement, transportId },
        combat: { ...base.combat, stance, stanceHomePos: home }
    } as Entity;
}

function stateWith(entities: Entity[]): GameState {
    const record: Record<string, Entity> = {};
    for (const e of entities) record[e.id] = e;
    return { ...INITIAL_STATE, entities: record } as GameState;
}

const stance = (unitIds: string[], s: 'hold_ground' | 'aggressive'): Action =>
    ({ type: 'SET_STANCE', payload: { unitIds, stance: s } });

describe('dropNoOpStanceActions', () => {
    const state = stateWith([
        unitWith('a', 'hold_ground', null),
        unitWith('b', 'aggressive', null),
        unitWith('c', 'hold_ground', new Vector(10, 10)),
        unitWith('apc', 'hold_ground', null),
        unitWith('d', 'hold_ground', null, 'apc')
    ]);
    const move: Action = { type: 'COMMAND_MOVE', payload: { unitIds: ['b'], x: 50, y: 50 } };
    const actions: Action[] = [
        stance(['a', 'b', 'c', 'd'], 'hold_ground'),
        move,
        stance(['b'], 'hold_ground'),
        stance(['a'], 'aggressive'),
        stance(['a'], 'hold_ground')
    ];

    it('drops only stance writes that change nothing', () => {
        expect(dropNoOpStanceActions(actions, state)).toEqual([
            stance(['b', 'c', 'd'], 'hold_ground'),
            move,
            stance(['a'], 'aggressive'),
            stance(['a'], 'hold_ground')
        ]);
    });

    it('produces the same unit state as applying every action', () => {
        const apply = (list: Action[]) => list.reduce((s, a) => update(s, a), state);
        const full = apply(actions);
        const deduped = apply(dropNoOpStanceActions(actions, state));
        for (const id of ['a', 'b', 'c', 'd']) {
            expect(deduped.entities[id]).toEqual(full.entities[id]);
        }
    });

    it('returns the same list when there is no SET_STANCE', () => {
        expect(dropNoOpStanceActions([move], state)).toEqual([move]);
    });
});

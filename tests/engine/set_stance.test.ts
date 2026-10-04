import { describe, it, expect } from 'vitest';
import { INITIAL_STATE } from '../../src/engine/reducer';
import { type GameState, type Entity, type EntityId, type CombatUnit } from '../../src/engine/types';
import { createTestCombatUnit } from '../../src/engine/test-utils';
import { setStance } from '../../src/engine/reducers/units';

function stateWith(units: Entity[]): GameState {
    const entities: Record<EntityId, Entity> = {};
    for (const u of units) entities[u.id] = u;
    return { ...INITIAL_STATE, running: true, entities };
}

describe('setStance', () => {
    it('returns the same state when every unit already has the stance', () => {
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        const once = setStance(stateWith([unit]), { unitIds: ['u'], stance: 'hold_ground' });
        expect((once.entities['u'] as CombatUnit).combat.stance).toBe('hold_ground');
        expect(setStance(once, { unitIds: ['u'], stance: 'hold_ground' })).toBe(once);
    });

    it('still clears a stale stance home position on a same-stance write', () => {
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        const base = setStance(stateWith([unit]), { unitIds: ['u'], stance: 'hold_ground' });
        const u = base.entities['u'] as CombatUnit;
        const withHome = { ...base, entities: { u: { ...u, combat: { ...u.combat, stanceHomePos: u.pos } } } };
        const next = setStance(withHome, { unitIds: ['u'], stance: 'hold_ground' });
        expect(next).not.toBe(withHome);
        expect((next.entities['u'] as CombatUnit).combat.stanceHomePos).toBeNull();
    });
});

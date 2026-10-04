import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, tick } from '../../src/engine/reducer';
import { type GameState, Vector, type Entity, type EntityId, type CombatUnit } from '../../src/engine/types';
import { createTestCombatUnit } from '../../src/engine/test-utils';

function stateWith(units: Entity[]): GameState {
    const entities: Record<EntityId, Entity> = {};
    for (const u of units) entities[u.id] = u;
    return { ...INITIAL_STATE, running: true, entities };
}

describe('idle units scatter for a stuck ally (per-tick stuck-mover prefilter)', () => {
    it('scatters when a stuck same-owner mover is pushing into it', () => {
        const idle = createTestCombatUnit({ id: 'idle', owner: 0, x: 500, y: 500 });
        const mover = createTestCombatUnit({ id: 'mover', owner: 0, x: 475, y: 500, moveTarget: new Vector(900, 500), stuckTimer: 20 });
        const next = tick(stateWith([idle, mover]));
        expect((next.entities['idle'] as CombatUnit).movement.moveTarget).not.toBeNull();
    });

    it('does not scatter for a stuck mover of another owner, or one that is not stuck', () => {
        const idle = createTestCombatUnit({ id: 'idle', owner: 0, x: 500, y: 500 });
        const enemyMover = createTestCombatUnit({ id: 'mover', owner: 1, x: 475, y: 500, moveTarget: new Vector(900, 500), stuckTimer: 20 });
        const a = tick(stateWith([idle, enemyMover]));
        // (it may acquire the enemy as a target, but must not get a scatter move order)
        expect((a.entities['idle'] as CombatUnit).movement.moveTarget).toBeNull();

        const freshMover = createTestCombatUnit({ id: 'mover', owner: 0, x: 475, y: 500, moveTarget: new Vector(900, 500), stuckTimer: 5 });
        const b = tick(stateWith([idle, freshMover]));
        expect((b.entities['idle'] as CombatUnit).movement.moveTarget).toBeNull();
    });
});

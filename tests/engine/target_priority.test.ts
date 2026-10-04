import { describe, it, expect, beforeEach } from 'vitest';
import { createTestCombatUnit, resetTestEntityCounter } from '../../src/engine/test-utils';
import { createPlayerState, INITIAL_STATE, tick, update } from '../../src/engine/reducer';
import { CombatUnit, Entity, GameState } from '../../src/engine/types';

beforeEach(() => resetTestEntityCounter());

// Everyone is tough so nothing dies while we watch who targets what
function unit(id: string, owner: number, key: CombatUnit['key'], x: number, y = 500): CombatUnit {
    return createTestCombatUnit({ id, owner, key, x, y, hp: 100000 });
}

function makeState(entities: Entity[]): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        headless: true,
        players: {
            0: createPlayerState(0, false, 'medium'),
            1: createPlayerState(1, false, 'medium')
        },
        entities: Object.fromEntries(entities.map(e => [e.id, e]))
    };
}

function targetOf(state: GameState, id: string): string | null {
    const e = state.entities[id];
    return e.type === 'UNIT' ? e.combat.targetId : null;
}

describe('counter-aware target priority', () => {
    it('a rocket soldier picks the tank over a nearer rifleman', () => {
        let state = makeState([unit('rocket', 0, 'rocket', 500), unit('rifle', 1, 'rifle', 600), unit('tank', 1, 'heavy', 700)]);
        state = tick(state);
        expect(targetOf(state, 'rocket')).toBe('tank');
    });

    it('a flame tank picks infantry over a nearer heavy tank', () => {
        let state = makeState([unit('flamer', 0, 'flame_tank', 500), unit('tank', 1, 'heavy', 560), unit('rifle', 1, 'rifle', 575)]);
        state = tick(state);
        expect(targetOf(state, 'flamer')).toBe('rifle');
    });

    it('still takes the only target around, however poor a match', () => {
        let state = makeState([unit('flamer', 0, 'flame_tank', 500), unit('tank', 1, 'heavy', 560)]);
        state = tick(state);
        expect(targetOf(state, 'flamer')).toBe('tank');
    });

    it('switches an auto-picked target when a much better one comes into range', () => {
        let state = makeState([unit('rocket', 0, 'rocket', 500), unit('rifle', 1, 'rifle', 600)]);
        state = tick(state);
        expect(targetOf(state, 'rocket')).toBe('rifle');

        state = { ...state, entities: { ...state.entities, tank: unit('tank', 1, 'heavy', 650) } };
        for (let i = 0; i < 25; i++) state = tick(state);
        expect(targetOf(state, 'rocket')).toBe('tank');
    });

    it('never overrides an explicit attack order', () => {
        let state = makeState([unit('rocket', 0, 'rocket', 500), unit('rifle', 1, 'rifle', 600), unit('tank', 1, 'heavy', 650)]);
        state = update(state, { type: 'COMMAND_ATTACK', payload: { unitIds: ['rocket'], targetId: 'rifle' } });
        for (let i = 0; i < 100; i++) {
            state = tick(state);
            expect(targetOf(state, 'rocket')).toBe('rifle');
        }
    });

    it('does not flip between equally good targets', () => {
        let state = makeState([unit('rocket', 0, 'rocket', 500), unit('t1', 1, 'heavy', 650, 470), unit('t2', 1, 'heavy', 650, 530)]);
        const seen = new Set<string | null>();
        for (let i = 0; i < 200; i++) {
            state = tick(state);
            seen.add(targetOf(state, 'rocket'));
        }
        expect(seen.size).toBe(1);
    });
});

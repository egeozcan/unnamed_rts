import { describe, it, expect, beforeEach } from 'vitest';
import { createTestCombatUnit, resetTestEntityCounter } from '../../src/engine/test-utils';
import { createPlayerState, INITIAL_STATE, tick } from '../../src/engine/reducer';
import { type GameState } from '../../src/engine/types';

beforeEach(() => resetTestEntityCounter());

function makeState(rocketX: number, heliX: number): GameState {
    // A tough rocket soldier so the helicopter can't kill it before it gets a shot off
    const rocket = createTestCombatUnit({ id: 'rocket', owner: 0, key: 'rocket', x: rocketX, y: 500, hp: 2000 });
    const heli = createTestCombatUnit({ id: 'heli', owner: 1, key: 'heli', x: heliX, y: 500, hp: 2000 });
    return {
        ...INITIAL_STATE,
        running: true,
        headless: true,
        players: {
            0: createPlayerState(0, false, 'medium'),
            1: createPlayerState(1, false, 'medium')
        },
        entities: { rocket, heli }
    };
}

describe('ground anti-air vs aircraft just outside weapon range', () => {
    it('steps into range and damages a helicopter ~270px away instead of freezing', () => {
        // Rocket range is 240 and units auto-acquire up to range + 50
        let state = makeState(500, 770);
        for (let i = 0; i < 200; i++) state = tick(state);

        const heli = state.entities['heli'];
        const rocket = state.entities['rocket'];
        expect(heli.hp).toBeLessThan(heli.maxHp);
        expect(rocket.pos.x).toBeGreaterThan(500);
    });

    it('drops an aircraft well out of range instead of chasing it across the map', () => {
        let state = makeState(500, 900);
        const rocket0 = state.entities['rocket'];
        if (rocket0.type !== 'UNIT') throw new Error('expected unit');
        state = { ...state, entities: { ...state.entities, rocket: { ...rocket0, combat: { ...rocket0.combat, targetId: 'heli' } } } };
        for (let i = 0; i < 30; i++) state = tick(state);

        const rocket = state.entities['rocket'];
        if (rocket.type !== 'UNIT') throw new Error('expected unit');
        expect(rocket.combat.targetId).toBeNull();
        expect(rocket.pos.x).toBeCloseTo(500, 0);
    });
});

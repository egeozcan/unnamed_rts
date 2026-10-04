import { describe, it, expect, beforeEach } from 'vitest';
import { Vector, VISUAL_EVENT_TTL, type CombatUnit, type Entity, type EntityId, type GameState } from '../../src/engine/types';
import { INITIAL_STATE, createPlayerState, update } from '../../src/engine/reducer';
import { RULES } from '../../src/data/schemas/index';
import { AIM_TOLERANCE, applyMovementInertia, getTurretTurnRate, stepTurret } from '../../src/engine/inertia';
import { createTestBuilding, createTestCombatUnit, resetTestEntityCounter } from '../../src/engine/test-utils';

function createState(entities: Record<EntityId, Entity>, headless = false): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        mode: 'game',
        headless,
        entities: {
            // Keep both players alive so the match doesn't end
            base0: createTestBuilding({ id: 'base0', owner: 0, key: 'conyard', x: 100, y: 100 }),
            base1: createTestBuilding({ id: 'base1', owner: 1, key: 'conyard', x: 2900, y: 2900 }),
            ...entities
        },
        players: {
            0: createPlayerState(0, false, 'easy'),
            1: createPlayerState(1, true, 'easy')
        },
        config: { ...INITIAL_STATE.config, width: 3000, height: 3000 }
    };
}

function run(state: GameState, ticks: number): GameState {
    for (let i = 0; i < ticks; i++) state = update(state, { type: 'TICK' });
    return state;
}

describe('weapon inertia', () => {
    beforeEach(() => resetTestEntityCounter());

    it('turns turrets at most turretTurn degrees per tick', () => {
        const rate = getTurretTurnRate('heavy')!;
        expect(rate).toBeCloseTo((RULES.units.heavy.turretTurn! * Math.PI) / 180);
        expect(stepTurret(0, Math.PI / 2, rate)).toBeCloseTo(rate);
        expect(stepTurret(0, -Math.PI / 2, rate)).toBeCloseTo(-rate);
        expect(stepTurret(0, rate / 2, rate)).toBeCloseTo(rate / 2);
        // Takes the short way round across ±π
        expect(stepTurret(Math.PI - 0.01, -Math.PI + 0.01, rate)).toBeCloseTo(-Math.PI + 0.01);
    });

    it.each([false, true])('holds fire until the turret has swung onto the target (headless: %s)', (headless) => {
        // Enemy due west, turret pointing east: needs a half turn first
        const tank = createTestCombatUnit({ id: 'tank', owner: 0, key: 'heavy', x: 1000, y: 1000, targetId: 'enemy', turretAngle: 0 });
        const enemy = createTestCombatUnit({ id: 'enemy', owner: 1, key: 'rifle', x: 850, y: 1000, hp: 5000 });
        let state = createState({ tank, enemy }, headless);

        const ticksToAim = Math.ceil((Math.PI - AIM_TOLERANCE) / getTurretTurnRate('heavy')!);
        state = run(state, ticksToAim - 2);
        expect(state.projectiles).toHaveLength(0);
        expect((state.entities.enemy as CombatUnit).hp).toBe(5000);

        state = run(state, 4);
        const turret = (state.entities.tank as CombatUnit).combat.turretAngle;
        expect(Math.abs(Math.abs(turret) - Math.PI)).toBeLessThanOrEqual(AIM_TOLERANCE);
        expect(state.projectiles.length + (5000 - (state.entities.enemy as CombatUnit).hp)).toBeGreaterThan(0);
    });

    it('lets weapons without a traverse rate fire immediately', () => {
        const heli = createTestCombatUnit({ id: 'heli', owner: 0, key: 'heli', x: 1000, y: 1000, targetId: 'enemy', turretAngle: 0 });
        const enemy = createTestCombatUnit({ id: 'enemy', owner: 1, key: 'rifle', x: 900, y: 1000, hp: 5000 });
        expect(getTurretTurnRate('heli')).toBeNull();
        const state = run(createState({ heli, enemy }), 1);
        expect(state.projectiles.length).toBeGreaterThan(0);
    });
});

describe('movement inertia', () => {
    beforeEach(() => resetTestEntityCounter());

    it('builds up speed over accelTicks from a standstill', () => {
        const { speed, accelTicks } = RULES.units.heavy;
        let state = createState({ tank: createTestCombatUnit({ id: 'tank', owner: 0, key: 'heavy', x: 500, y: 1000 }) });
        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: ['tank'], x: 1500, y: 1000 } });

        state = run(state, 1);
        const first = (state.entities.tank as CombatUnit).movement.currentSpeed!;
        expect(first).toBeCloseTo(speed / accelTicks!, 5);

        state = run(state, accelTicks! + 2);
        expect((state.entities.tank as CombatUnit).movement.currentSpeed).toBeCloseTo(speed, 5);
    });

    it('bleeds speed off in sharp turns, but never stops dead', () => {
        const ahead = new Vector(2, 0);
        expect(applyMovementInertia('heavy', ahead, new Vector(2, 0), 2).mag()).toBeCloseTo(2);
        const reversing = applyMovementInertia('heavy', new Vector(-2, 0), new Vector(2, 0), 2).mag();
        expect(reversing).toBeLessThan(1);
        expect(reversing).toBeGreaterThan(0.5);
    });

    it('leaves aircraft and the speed of already-moving units alone', () => {
        const desired = new Vector(0, 6);
        expect(applyMovementInertia('heli', desired, undefined, 0)).toBe(desired);
        expect(applyMovementInertia('light', new Vector(2.8, 0), new Vector(2.8, 0), 2.8).mag()).toBeCloseTo(2.8);
    });
});

describe('visual events', () => {
    beforeEach(() => resetTestEntityCounter());

    it('records shots, impacts and kills for the renderer', () => {
        const tank = createTestCombatUnit({ id: 'tank', owner: 0, key: 'light', x: 1000, y: 1000, targetId: 'enemy', turretAngle: Math.PI });
        const enemy = createTestCombatUnit({ id: 'enemy', owner: 1, key: 'rifle', x: 900, y: 1000, hp: 1 });
        const state = run(createState({ tank, enemy }), 20);

        const kinds = (state.visualEvents ?? []).map(e => e.kind);
        expect(kinds).toContain('fire');
        expect(kinds).toContain('impact');
        const destroyed = state.visualEvents!.find(e => e.kind === 'destroyed');
        expect(destroyed).toMatchObject({ key: 'rifle', owner: 1, entityType: 'UNIT', air: false });
    });

    it('forgets events after VISUAL_EVENT_TTL ticks', () => {
        const tank = createTestCombatUnit({ id: 'tank', owner: 0, key: 'light', x: 1000, y: 1000, targetId: 'enemy', turretAngle: Math.PI });
        const enemy = createTestCombatUnit({ id: 'enemy', owner: 1, key: 'rifle', x: 900, y: 1000, hp: 1 });
        const state = run(createState({ tank, enemy }), 20 + VISUAL_EVENT_TTL);
        for (const event of state.visualEvents ?? []) {
            expect(event.tick).toBeGreaterThan(state.tick - VISUAL_EVENT_TTL);
        }
    });

    it('does not record an impact for a shot cancelled because its target vanished', () => {
        const tank = createTestCombatUnit({ id: 'tank', owner: 0, key: 'stealth', x: 1000, y: 1000, targetId: 'enemy', turretAngle: Math.PI });
        const enemy = createTestCombatUnit({ id: 'enemy', owner: 1, key: 'engineer', x: 800, y: 1000, hp: 5000 });
        let state = createState({ tank, enemy });
        for (let i = 0; i < 10 && state.projectiles.length === 0; i++) state = run(state, 1);
        expect(state.projectiles.length).toBeGreaterThan(0);

        // The target leaves the game (e.g. sold, or loaded into a transport elsewhere) mid-flight
        const { enemy: _gone, ...rest } = state.entities;
        state = run({ ...state, entities: rest, visualEvents: [] }, 5);
        expect(state.projectiles).toHaveLength(0);
        expect((state.visualEvents ?? []).filter(e => e.kind === 'impact')).toHaveLength(0);
    });

    it('records nothing in headless simulation', () => {
        const tank = createTestCombatUnit({ id: 'tank', owner: 0, key: 'light', x: 1000, y: 1000, targetId: 'enemy', turretAngle: Math.PI });
        const enemy = createTestCombatUnit({ id: 'enemy', owner: 1, key: 'rifle', x: 900, y: 1000, hp: 1 });
        const state = run(createState({ tank, enemy }, true), 20);
        expect(state.visualEvents ?? []).toHaveLength(0);
    });
});

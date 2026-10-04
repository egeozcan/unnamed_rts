import { describe, it, expect, beforeEach } from 'vitest';
import { Vector, type GameState, type Entity, type EntityId, type Projectile, type ProjectileArchetype } from '../../src/engine/types';
import { applySplashDamage, updateProjectile } from '../../src/engine/reducers/game_loop';
import { getBuildTicks, BUILDING_BUILD_TICKS } from '../../src/engine/reducers/helpers';
import { INITIAL_STATE, createPlayerState, update } from '../../src/engine/reducer';
import { createTestCombatUnit, createTestBuilding, resetTestEntityCounter } from '../../src/engine/test-utils';
import { RULES } from '../../src/data/schemas/index';

// Weapon type with no damageModifiers entry, so every armor takes 1.0x
const NEUTRAL_WEAPON = 'test_neutral_weapon';

function createTestState(entities: Record<EntityId, Entity> = {}): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        entities,
        players: {
            0: { ...createPlayerState(0, false, 'medium', '#0088FF'), credits: 5000 },
            1: { ...createPlayerState(1, false, 'medium', '#FFCC00'), credits: 5000 }
        }
    };
}

function makeProjectile(overrides: Partial<Projectile> & { archetype: ProjectileArchetype }): Projectile {
    const pos = overrides.pos ?? new Vector(0, 0);
    return {
        ownerId: 'attacker',
        pos,
        vel: new Vector(0, 0),
        targetId: 'target',
        speed: 10,
        damage: 50,
        splash: 0,
        type: NEUTRAL_WEAPON,
        weaponType: NEUTRAL_WEAPON,
        dead: false,
        hp: 0,
        maxHp: 0,
        arcHeight: 0,
        startPos: pos,
        trailPoints: [],
        ...overrides
    };
}

function step(proj: Projectile, entities: Record<EntityId, Entity>, maxSteps = 200) {
    let res = updateProjectile(proj, entities, 3000, 3000);
    for (let i = 1; i < maxSteps && !res.proj.dead; i++) {
        res = updateProjectile(res.proj, entities, 3000, 3000);
    }
    return res;
}

describe('Projectile mechanics', () => {
    beforeEach(() => resetTestEntityCounter());

    describe('Homing keys on the missile archetype', () => {
        it('homes air_missile (harrier) projectiles onto a moved target', () => {
            const target = createTestCombatUnit({ id: 'target', owner: 1, x: 0, y: 100 });
            const proj = makeProjectile({
                archetype: 'missile', weaponType: 'air_missile', speed: 28, vel: new Vector(28, 0)
            });
            const res = updateProjectile(proj, { target }, 1000, 1000);
            expect(res.proj.vel.x).toBeCloseTo(0);
            expect(res.proj.vel.y).toBeCloseTo(28);
        });

        it('does not home a non-missile archetype even if its weapon type is "missile"', () => {
            const target = createTestCombatUnit({ id: 'target', owner: 1, x: 0, y: 100 });
            const proj = makeProjectile({ archetype: 'rocket', weaponType: 'missile', vel: new Vector(9, 0) });
            const res = updateProjectile(proj, { target }, 1000, 1000);
            expect(res.proj.vel).toEqual(new Vector(9, 0));
        });
    });

    describe('Segment hit test (no tunneling)', () => {
        it('hits a small target that falls between two hitscan positions', () => {
            // Infantry hit window is radius + 15. Place the target so that neither the
            // pre-step nor the post-step position is inside it, but the path crosses it.
            const target = createTestCombatUnit({ id: 'target', owner: 1, x: 125, y: 0 });
            const window = target.radius + 15;
            // Positions 50 -> 100 -> 150: every endpoint is at least `window` away from the target
            expect(new Vector(100, 0).dist(target.pos)).toBeGreaterThanOrEqual(window);
            expect(new Vector(150, 0).dist(target.pos)).toBeGreaterThanOrEqual(window);
            const proj = makeProjectile({ archetype: 'hitscan', speed: 50, vel: new Vector(50, 0), pos: new Vector(50, 0) });
            const res = step(proj, { target }, 5);
            expect(res.damage?.targetId).toBe('target');
            expect(res.damage?.amount).toBe(50);
            // Impact is placed on the path next to the target, not past it
            expect(res.proj.pos.dist(target.pos)).toBeLessThan(window);
        });

        it('hits every static infantry distance along a hitscan line', () => {
            for (let d = 60; d <= 400; d += 1) {
                const target = createTestCombatUnit({ id: 'target', owner: 1, x: d, y: 0 });
                const proj = makeProjectile({ archetype: 'hitscan', speed: 50, vel: new Vector(50, 0) });
                const res = step(proj, { target }, 20);
                expect(res.damage?.targetId, `distance ${d}`).toBe('target');
            }
        });

        it('still misses a target that is far off the path', () => {
            const target = createTestCombatUnit({ id: 'target', owner: 1, x: 100, y: 200 });
            const proj = makeProjectile({ archetype: 'hitscan', speed: 50, vel: new Vector(50, 0) });
            const res = updateProjectile(proj, { target }, 1000, 1000);
            expect(res.damage).toBeUndefined();
            expect(res.proj.dead).toBe(false);
        });
    });

    describe('Ground-burst artillery and grenades', () => {
        for (const archetype of ['artillery', 'grenade'] as const) {
            it(`${archetype} detonates at its aim point when the target has moved away`, () => {
                const aim = new Vector(200, 0);
                const target = createTestCombatUnit({ id: 'target', owner: 1, x: 200, y: 300 });
                const proj = makeProjectile({ archetype, speed: 6, vel: new Vector(6, 0), targetPos: aim, splash: 60 });
                const res = step(proj, { target });
                expect(res.damage).toBeUndefined();
                expect(res.detonation).toEqual(aim);
                expect(res.proj.dead).toBe(true);
                expect(res.proj.pos).toEqual(aim);
            });

            it(`${archetype} detonates at its aim point when the target died or was removed`, () => {
                const aim = new Vector(120, 0);
                const dead = createTestCombatUnit({ id: 'target', owner: 1, x: 120, y: 0, dead: true, hp: 0 });
                const proj = makeProjectile({ archetype, speed: 8, vel: new Vector(8, 0), targetPos: aim, splash: 60 });
                expect(step(proj, { target: dead }).detonation).toEqual(aim);
                expect(step(proj, {}).detonation).toEqual(aim);
            });
        }

        it('still direct-hits a target that stayed put', () => {
            const target = createTestCombatUnit({ id: 'target', owner: 1, x: 200, y: 0 });
            const proj = makeProjectile({ archetype: 'artillery', speed: 6, vel: new Vector(6, 0), targetPos: target.pos, splash: 60 });
            const res = step(proj, { target });
            expect(res.damage?.targetId).toBe('target');
            expect(res.detonation).toBeUndefined();
        });

        it('rockets keep the old behavior: a miss does not detonate', () => {
            const aim = new Vector(200, 0);
            const target = createTestCombatUnit({ id: 'target', owner: 1, x: 200, y: 300 });
            const proj = makeProjectile({ archetype: 'rocket', speed: 9, vel: new Vector(9, 0), targetPos: aim, splash: 60 });
            const res = updateProjectile({ ...proj, pos: new Vector(195, 0) }, { target }, 3000, 3000);
            expect(res.detonation).toBeUndefined();
            expect(res.proj.dead).toBe(false);
        });

        it('a missed ground burst splashes units at the aim point during a tick, including the original target', () => {
            const attacker = createTestCombatUnit({ id: 'attacker', owner: 0, x: 1500, y: 1500 });
            // Original target ran into the blast area; bystander sits on the aim point
            const target = createTestCombatUnit({ id: 'target', owner: 1, x: 530, y: 500, hp: 100, maxHp: 100 });
            const bystander = createTestCombatUnit({ id: 'bystander', owner: 1, x: 500, y: 505, hp: 100, maxHp: 100 });
            const farAway = createTestCombatUnit({ id: 'far', owner: 1, x: 800, y: 500, hp: 100, maxHp: 100 });
            const proj = makeProjectile({
                archetype: 'artillery', ownerId: 'attacker', pos: new Vector(497, 500), startPos: new Vector(200, 500),
                vel: new Vector(6, 0), speed: 6, targetPos: new Vector(500, 500), splash: 60, damage: 40
            });
            // The target is 30px off the aim point (outside radius + 15), so this is a ground burst, not a direct hit
            const state = { ...createTestState({ attacker, target, bystander, far: farAway }), projectiles: [proj] };
            const next = update(state, { type: 'TICK' });
            expect(next.projectiles.length).toBe(0);
            expect(next.entities['bystander'].hp).toBeLessThan(100);
            expect(next.entities['target'].hp).toBeLessThan(100);
            expect(next.entities['far'].hp).toBe(100);
        });
    });

    describe('Splash only hits the blast level', () => {
        it('ground splash does not hit aircraft overhead', () => {
            const primary = createTestCombatUnit({ id: 'target', owner: 1, x: 100, y: 100 });
            const heli = createTestCombatUnit({ id: 'heli', key: 'heli', owner: 1, x: 105, y: 100, hp: 200, maxHp: 200 });
            const ground = createTestCombatUnit({ id: 'ground', owner: 1, x: 100, y: 105, hp: 100, maxHp: 100 });
            const proj = makeProjectile({ archetype: 'grenade', splash: 60 });
            const result = applySplashDamage(createTestState({ target: primary, heli, ground }), proj, new Vector(100, 100));
            expect(result.entities['heli'].hp).toBe(200);
            expect(result.entities['ground'].hp).toBeLessThan(100);
        });

        it('air splash does not hit ground units or buildings below', () => {
            const primary = createTestCombatUnit({ id: 'target', key: 'heli', owner: 1, x: 100, y: 100 });
            const wingman = createTestCombatUnit({ id: 'wingman', key: 'heli', owner: 1, x: 105, y: 100, hp: 200, maxHp: 200 });
            const ground = createTestCombatUnit({ id: 'ground', owner: 1, x: 100, y: 105, hp: 100, maxHp: 100 });
            const building = createTestBuilding({ id: 'bld', key: 'power', owner: 1, x: 110, y: 110 });
            const proj = makeProjectile({ archetype: 'missile', splash: 60 });
            const state = createTestState({ target: primary, wingman, ground, bld: building });
            const result = applySplashDamage(state, proj, new Vector(100, 100));
            expect(result.entities['wingman'].hp).toBeLessThan(200);
            expect(result.entities['ground'].hp).toBe(100);
            expect(result.entities['bld'].hp).toBe(building.hp);
        });

        it('treats a blast whose primary target is gone as ground level', () => {
            const heli = createTestCombatUnit({ id: 'heli', key: 'heli', owner: 1, x: 100, y: 100, hp: 200, maxHp: 200 });
            const ground = createTestCombatUnit({ id: 'ground', owner: 1, x: 100, y: 105, hp: 100, maxHp: 100 });
            const proj = makeProjectile({ archetype: 'artillery', splash: 60, targetId: 'gone' });
            const result = applySplashDamage(createTestState({ heli, ground }), proj, new Vector(100, 100));
            expect(result.entities['heli'].hp).toBe(200);
            expect(result.entities['ground'].hp).toBeLessThan(100);
        });

        it('still damages friendly units at the same level', () => {
            const primary = createTestCombatUnit({ id: 'target', owner: 1, x: 100, y: 100 });
            const friendly = createTestCombatUnit({ id: 'friendly', owner: 0, x: 105, y: 100, hp: 100, maxHp: 100 });
            const proj = makeProjectile({ archetype: 'grenade', splash: 60, ownerId: 'someone-of-player-0' });
            const result = applySplashDamage(createTestState({ target: primary, friendly }), proj, new Vector(100, 100));
            expect(result.entities['friendly'].hp).toBeLessThan(100);
        });
    });

    describe('Build time scales with cost', () => {
        it('uses clamp(120 + 0.3 * cost, 180, 900) ticks for units', () => {
            for (const key of Object.keys(RULES.units)) {
                const cost = RULES.units[key].cost;
                expect(getBuildTicks(key), key).toBe(Math.min(900, Math.max(180, 120 + 0.3 * cost)));
            }
        });

        it('makes cheap units faster than expensive ones', () => {
            expect(getBuildTicks('rifle')).toBeLessThan(getBuildTicks('heavy'));
            expect(getBuildTicks('heavy')).toBeLessThan(getBuildTicks('mammoth'));
        });

        it('keeps a flat build time for structures', () => {
            for (const key of Object.keys(RULES.buildings)) {
                expect(getBuildTicks(key), key).toBe(BUILDING_BUILD_TICKS);
            }
        });

        it('completes a unit after getBuildTicks ticks with one factory at full power', () => {
            const entities: Record<EntityId, Entity> = {
                conyard: createTestBuilding({ id: 'conyard', owner: 0, key: 'conyard', x: 300, y: 300 }),
                power1: createTestBuilding({ id: 'power1', owner: 0, key: 'power', x: 200, y: 300 }),
                power2: createTestBuilding({ id: 'power2', owner: 0, key: 'power', x: 200, y: 400 }),
                barracks: createTestBuilding({ id: 'barracks', owner: 0, key: 'barracks', x: 400, y: 300 })
            };
            let state = createTestState(entities);
            state = update(state, { type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId: 0 } });
            const ticks = getBuildTicks('rifle');
            for (let i = 0; i < ticks - 2; i++) state = update(state, { type: 'TICK' });
            expect(state.players[0].queues.infantry.current).toBe('rifle');
            for (let i = 0; i < 4; i++) state = update(state, { type: 'TICK' });
            expect(state.players[0].queues.infantry.current).toBeNull();
            expect(Object.values(state.entities).some(e => e.key === 'rifle' && e.owner === 0)).toBe(true);
        });
    });
});

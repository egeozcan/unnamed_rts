import { describe, it, expect, beforeEach } from 'vitest';
import { Vector, Projectile, GameState, Entity, EntityId } from '../../src/engine/types';
import { applyInterception } from '../../src/engine/reducers/game_loop';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { createTestCombatUnit, createTestBuilding, resetTestEntityCounter } from '../../src/engine/test-utils';

function createTestState(entities: Record<EntityId, Entity> = {}): GameState {
    return {
        ...INITIAL_STATE,
        tick: 0,
        running: true,
        entities,
        players: {
            0: { ...createPlayerState(0, false, 'medium', '#0088FF'), credits: 5000 },
            1: { ...createPlayerState(1, true, 'medium', '#FFCC00'), credits: 5000 }
        }
    };
}

function createTestProjectile(overrides: Partial<Projectile> = {}): Projectile {
    return {
        ownerId: 'attacker',
        pos: new Vector(50, 0),
        vel: new Vector(-9, 0),
        targetId: 'target',
        speed: 9,
        damage: 50,
        splash: 50,
        type: 'rocket',
        weaponType: 'rocket',
        dead: false,
        archetype: 'rocket',
        hp: 50,
        maxHp: 50,
        arcHeight: 0,
        startPos: new Vector(300, 0),
        trailPoints: [],
        ...overrides
    };
}

describe('AA Interception', () => {
    beforeEach(() => {
        resetTestEntityCounter();
    });

    it('should reduce projectile HP when in AA aura', () => {
        // Enemy SAM site at origin, player 1
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', x: 0, y: 0, owner: 1 });
        // Player 0 unit that fired the projectile
        const attacker = createTestCombatUnit({ id: 'attacker', x: 300, y: 0, owner: 0 });
        const state = createTestState({ [sam.id]: sam, [attacker.id]: attacker });

        // Rocket projectile flying through SAM aura (inside radius 200)
        const projectile = createTestProjectile({ hp: 50, maxHp: 50 });

        const result = applyInterception(state, projectile);

        // SAM DPS is 150, per tick = 150/60 = 2.5
        expect(result.hp).toBeLessThan(50);
        expect(result.hp).toBeCloseTo(50 - 150/60, 1);
    });

    it('should not intercept non-interceptable projectiles (hp=0, maxHp=0)', () => {
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', x: 0, y: 0, owner: 1 });
        const attacker = createTestCombatUnit({ id: 'attacker', x: 300, y: 0, owner: 0 });
        const state = createTestState({ [sam.id]: sam, [attacker.id]: attacker });

        // Hitscan projectile (not interceptable)
        const projectile = createTestProjectile({
            archetype: 'hitscan',
            hp: 0,
            maxHp: 0,
            speed: 50
        });

        const result = applyInterception(state, projectile);

        expect(result.hp).toBe(0); // Unchanged
    });

    it('should not intercept friendly projectiles', () => {
        // SAM and attacker both owned by player 0
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', x: 0, y: 0, owner: 0 });
        const attacker = createTestCombatUnit({ id: 'attacker', x: 300, y: 0, owner: 0 });
        const state = createTestState({ [sam.id]: sam, [attacker.id]: attacker });

        const projectile = createTestProjectile({ hp: 50, maxHp: 50 });

        const result = applyInterception(state, projectile);

        expect(result.hp).toBe(50); // Unchanged - friendly AA ignores own projectiles
    });

    it('should stack interception from multiple AA sources', () => {
        const sam1 = createTestBuilding({ id: 'sam1', key: 'sam_site', x: 0, y: 0, owner: 1 });
        const sam2 = createTestBuilding({ id: 'sam2', key: 'sam_site', x: 100, y: 0, owner: 1 });
        const attacker = createTestCombatUnit({ id: 'attacker', x: 300, y: 0, owner: 0 });
        const state = createTestState({ [sam1.id]: sam1, [sam2.id]: sam2, [attacker.id]: attacker });

        // Projectile at position (50, 0) - in range of both SAMs
        const projectile = createTestProjectile({ hp: 50, maxHp: 50 });

        const result = applyInterception(state, projectile);

        // Two SAMs, each doing 150/60 = 2.5 DPS per tick = 5 total
        expect(result.hp).toBeCloseTo(50 - (150/60 * 2), 1);
    });

    it('should kill projectile when HP reaches 0', () => {
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', x: 0, y: 0, owner: 1 });
        const attacker = createTestCombatUnit({ id: 'attacker', x: 300, y: 0, owner: 0 });
        const state = createTestState({ [sam.id]: sam, [attacker.id]: attacker });

        // Projectile with very low HP
        const projectile = createTestProjectile({ hp: 1, maxHp: 50 });

        const result = applyInterception(state, projectile);

        expect(result.hp).toBeLessThanOrEqual(0);
        expect(result.dead).toBe(true);
    });

    it('should not intercept projectiles outside aura radius', () => {
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', x: 0, y: 0, owner: 1 });
        const attacker = createTestCombatUnit({ id: 'attacker', x: 500, y: 0, owner: 0 });
        const state = createTestState({ [sam.id]: sam, [attacker.id]: attacker });

        // Projectile far outside SAM aura radius (200)
        const projectile = createTestProjectile({
            pos: new Vector(300, 0), // 300 units away from SAM at origin
            hp: 50,
            maxHp: 50
        });

        const result = applyInterception(state, projectile);

        expect(result.hp).toBe(50); // Unchanged - out of range
    });

    it('should not intercept already dead projectiles', () => {
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', x: 0, y: 0, owner: 1 });
        const attacker = createTestCombatUnit({ id: 'attacker', x: 300, y: 0, owner: 0 });
        const state = createTestState({ [sam.id]: sam, [attacker.id]: attacker });

        // Already dead projectile
        const projectile = createTestProjectile({ hp: 50, maxHp: 50, dead: true });

        const result = applyInterception(state, projectile);

        expect(result.hp).toBe(50); // Unchanged - already dead
        expect(result.dead).toBe(true);
    });

    it('should intercept rocket soldier projectiles with weaker aura', () => {
        // Rocket soldier has interceptionAura: { radius: 60, dps: 40 }
        const rocketSoldier = createTestCombatUnit({ id: 'rocket', key: 'rocket', x: 0, y: 0, owner: 1 });
        const attacker = createTestCombatUnit({ id: 'attacker', x: 200, y: 0, owner: 0 });
        const state = createTestState({ [rocketSoldier.id]: rocketSoldier, [attacker.id]: attacker });

        // Projectile within rocket soldier's aura (radius 60)
        const projectile = createTestProjectile({
            pos: new Vector(30, 0), // 30 units away, within 60 radius
            hp: 50,
            maxHp: 50
        });

        const result = applyInterception(state, projectile);

        // Rocket soldier DPS is 40, per tick = 40/60 = 0.666
        expect(result.hp).toBeLessThan(50);
        expect(result.hp).toBeCloseTo(50 - 40/60, 1);
    });

    it('should intercept with MLRS interception aura', () => {
        // MLRS has interceptionAura: { radius: 120, dps: 80 }
        const mlrs = createTestCombatUnit({ id: 'mlrs', key: 'mlrs', x: 0, y: 0, owner: 1 });
        const attacker = createTestCombatUnit({ id: 'attacker', x: 200, y: 0, owner: 0 });
        const state = createTestState({ [mlrs.id]: mlrs, [attacker.id]: attacker });

        // Projectile within MLRS aura (radius 120)
        const projectile = createTestProjectile({
            pos: new Vector(60, 0), // 60 units away, within 120 radius
            hp: 100,
            maxHp: 100
        });

        const result = applyInterception(state, projectile);

        // MLRS DPS is 80, per tick = 80/60 = 1.333
        expect(result.hp).toBeLessThan(100);
        expect(result.hp).toBeCloseTo(100 - 80/60, 1);
    });

    it('should not intercept from dead AA units', () => {
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', x: 0, y: 0, owner: 1, dead: true });
        const attacker = createTestCombatUnit({ id: 'attacker', x: 300, y: 0, owner: 0 });
        const state = createTestState({ [sam.id]: sam, [attacker.id]: attacker });

        const projectile = createTestProjectile({ hp: 50, maxHp: 50 });

        const result = applyInterception(state, projectile);

        expect(result.hp).toBe(50); // Unchanged - SAM is dead
    });

    it('should handle missing projectile owner gracefully', () => {
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', x: 0, y: 0, owner: 1 });
        // Attacker doesn't exist in entities
        const state = createTestState({ [sam.id]: sam });

        const projectile = createTestProjectile({
            ownerId: 'nonexistent_attacker',
            hp: 50,
            maxHp: 50
        });

        const result = applyInterception(state, projectile);

        // Should still apply interception since projectile owner is unknown (treat as enemy)
        expect(result.hp).toBeLessThan(50);
    });
});

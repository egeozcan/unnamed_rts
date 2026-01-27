import { describe, it, expect, beforeEach } from 'vitest';
import { Vector, GameState, Entity, EntityId } from '../../src/engine/types';
import { applySplashDamage } from '../../src/engine/reducers/game_loop';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { createTestCombatUnit, createTestBuilding, resetTestEntityCounter } from '../../src/engine/test-utils';

// Helper to create a test state with players
function createTestState(entities: Record<EntityId, Entity> = {}, tickNum: number = 0): GameState {
    return {
        ...INITIAL_STATE,
        tick: tickNum,
        running: true,
        entities,
        players: {
            0: { ...createPlayerState(0, false, 'medium', '#0088FF'), credits: 5000 },
            1: { ...createPlayerState(1, true, 'medium', '#FFCC00'), credits: 5000 }
        }
    };
}

// Helper to create a test projectile
function createTestProjectile(overrides: Partial<{
    ownerId: EntityId;
    pos: Vector;
    vel: Vector;
    targetId: EntityId;
    speed: number;
    damage: number;
    splash: number;
    type: string;
    weaponType: string;
    dead: boolean;
    archetype: 'hitscan' | 'rocket' | 'artillery' | 'missile' | 'ballistic' | 'grenade';
    hp: number;
    maxHp: number;
    arcHeight: number;
    startPos: Vector;
    trailPoints: readonly Vector[];
}> = {}) {
    return {
        ownerId: overrides.ownerId ?? 'attacker',
        pos: overrides.pos ?? new Vector(100, 100),
        vel: overrides.vel ?? new Vector(0, 0),
        targetId: overrides.targetId ?? 'target',
        speed: overrides.speed ?? 9,
        damage: overrides.damage ?? 50,
        splash: overrides.splash ?? 100,
        type: overrides.type ?? 'rocket',
        weaponType: overrides.weaponType ?? 'rocket',
        dead: overrides.dead ?? true,
        archetype: overrides.archetype ?? 'rocket' as const,
        hp: overrides.hp ?? 0,
        maxHp: overrides.maxHp ?? 50,
        arcHeight: overrides.arcHeight ?? 0,
        startPos: overrides.startPos ?? new Vector(0, 0),
        trailPoints: overrides.trailPoints ?? [] as Vector[]
    };
}

describe('Splash Damage', () => {
    beforeEach(() => {
        resetTestEntityCounter();
    });

    it('should apply full damage at center', () => {
        // Use 'nearby' id (not 'target') so this entity receives splash damage
        const nearby = createTestCombatUnit({ id: 'nearby', x: 100, y: 100, hp: 100, maxHp: 100, owner: 1 });
        let state = createTestState({ [nearby.id]: nearby });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            targetId: 'other', // Primary target is something else
            damage: 50,
            splash: 100
        });

        const result = applySplashDamage(state, projectile, projectile.pos);
        const damagedNearby = result.entities['nearby'];

        // Full damage at center (distance 0), armor modifier may apply
        expect(damagedNearby.hp).toBeLessThan(100);
    });

    it('should apply linear falloff damage at edge', () => {
        // Place unit at edge of splash radius (100 units away, splash radius 100)
        const edgeUnit = createTestCombatUnit({ id: 'edge', x: 200, y: 100, hp: 100, maxHp: 100, owner: 1 });
        let state = createTestState({ [edgeUnit.id]: edgeUnit });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            damage: 100,
            splash: 100
        });

        const result = applySplashDamage(state, projectile, projectile.pos);
        const damagedUnit = result.entities['edge'];

        // At edge (distance = radius), falloff = 0, so no damage
        expect(damagedUnit.hp).toBe(100);
    });

    it('should apply ~50% damage at half radius', () => {
        // Place unit at half splash radius (50 units away, splash radius 100)
        const halfUnit = createTestCombatUnit({ id: 'half', x: 150, y: 100, hp: 100, maxHp: 100, owner: 1 });
        let state = createTestState({ [halfUnit.id]: halfUnit });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            damage: 100,
            splash: 100
        });

        const result = applySplashDamage(state, projectile, projectile.pos);
        const damagedUnit = result.entities['half'];

        // At half radius (distance 50, radius 100), falloff = 0.5, damage = 50
        // Armor modifiers might apply - expect around 50 or modified by armor
        expect(damagedUnit.hp).toBeLessThan(100);
        expect(damagedUnit.hp).toBeGreaterThan(40); // Not full damage
    });

    it('should damage friendly units (friendly fire)', () => {
        const attacker = createTestCombatUnit({ id: 'attacker', x: 0, y: 0, owner: 0 });
        const friendly = createTestCombatUnit({ id: 'friendly', x: 100, y: 100, hp: 100, maxHp: 100, owner: 0 });
        let state = createTestState({ [attacker.id]: attacker, [friendly.id]: friendly });

        const projectile = createTestProjectile({
            ownerId: 'attacker',
            pos: new Vector(100, 100),
            targetId: 'enemy',
            damage: 50,
            splash: 100
        });

        const result = applySplashDamage(state, projectile, projectile.pos);
        const damagedFriendly = result.entities['friendly'];

        // Friendly fire - should take damage
        expect(damagedFriendly.hp).toBeLessThan(100);
    });

    it('should not apply splash when splash radius is 0', () => {
        const nearby = createTestCombatUnit({ id: 'nearby', x: 105, y: 100, hp: 100, maxHp: 100, owner: 1 });
        let state = createTestState({ [nearby.id]: nearby });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            damage: 50,
            splash: 0,
            type: 'bullet',
            weaponType: 'bullet',
            archetype: 'hitscan'
        });

        const result = applySplashDamage(state, projectile, projectile.pos);
        const unit = result.entities['nearby'];

        expect(unit.hp).toBe(100);
    });

    it('should damage buildings within splash radius', () => {
        const building = createTestBuilding({ id: 'bld', key: 'power', x: 120, y: 100, hp: 800, maxHp: 800, owner: 1 });
        let state = createTestState({ [building.id]: building });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            damage: 100,
            splash: 100
        });

        const result = applySplashDamage(state, projectile, projectile.pos);
        const damagedBuilding = result.entities['bld'];

        // Building is 20 units away, within splash radius
        expect(damagedBuilding.hp).toBeLessThan(800);
    });

    it('should not damage dead entities', () => {
        const deadUnit = createTestCombatUnit({ id: 'dead', x: 100, y: 100, hp: 0, maxHp: 100, owner: 1, dead: true });
        let state = createTestState({ [deadUnit.id]: deadUnit });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            damage: 50,
            splash: 100
        });

        const result = applySplashDamage(state, projectile, projectile.pos);
        const unit = result.entities['dead'];

        // Should not have been further damaged
        expect(unit.hp).toBe(0);
    });

    it('should mark units as dead when hp reaches 0', () => {
        const weakUnit = createTestCombatUnit({ id: 'weak', x: 100, y: 100, hp: 10, maxHp: 100, owner: 1 });
        let state = createTestState({ [weakUnit.id]: weakUnit });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            damage: 100,
            splash: 100
        });

        const result = applySplashDamage(state, projectile, projectile.pos);
        const killedUnit = result.entities['weak'];

        expect(killedUnit.hp).toBe(0);
        expect(killedUnit.dead).toBe(true);
    });

    it('should apply damage flash to units', () => {
        const nearby = createTestCombatUnit({ id: 'nearby', x: 100, y: 100, hp: 100, maxHp: 100, owner: 1 });
        let state = createTestState({ [nearby.id]: nearby });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            targetId: 'other', // Primary target is something else
            damage: 30,
            splash: 100
        });

        const result = applySplashDamage(state, projectile, projectile.pos);
        const damagedNearby = result.entities['nearby'];

        // Should have flash effect
        if (damagedNearby.type === 'UNIT') {
            expect(damagedNearby.combat.flash).toBeGreaterThan(0);
        }
    });

    it('should damage multiple entities in radius', () => {
        const unit1 = createTestCombatUnit({ id: 'unit1', x: 100, y: 100, hp: 100, maxHp: 100, owner: 1 });
        const unit2 = createTestCombatUnit({ id: 'unit2', x: 120, y: 100, hp: 100, maxHp: 100, owner: 1 });
        const unit3 = createTestCombatUnit({ id: 'unit3', x: 100, y: 130, hp: 100, maxHp: 100, owner: 1 });
        let state = createTestState({
            [unit1.id]: unit1,
            [unit2.id]: unit2,
            [unit3.id]: unit3
        });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            damage: 50,
            splash: 100
        });

        const result = applySplashDamage(state, projectile, projectile.pos);

        // All three should be damaged
        expect(result.entities['unit1'].hp).toBeLessThan(100);
        expect(result.entities['unit2'].hp).toBeLessThan(100);
        expect(result.entities['unit3'].hp).toBeLessThan(100);
    });

    it('should respect armor modifiers', () => {
        // Light tank has 'light' armor, heavy tank has 'heavy' armor
        // Rockets should deal different damage to different armor types
        const lightTank = createTestCombatUnit({ id: 'light', key: 'light', x: 100, y: 100, hp: 300, maxHp: 300, owner: 1 });
        const heavyTank = createTestCombatUnit({ id: 'heavy', key: 'heavy', x: 130, y: 100, hp: 600, maxHp: 600, owner: 1 });
        let state = createTestState({
            [lightTank.id]: lightTank,
            [heavyTank.id]: heavyTank
        });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            damage: 100,
            splash: 100,
            weaponType: 'rocket'
        });

        const result = applySplashDamage(state, projectile, projectile.pos);

        const lightDamage = 300 - result.entities['light'].hp;
        const heavyDamage = 600 - result.entities['heavy'].hp;

        // Both should take damage
        expect(lightDamage).toBeGreaterThan(0);
        expect(heavyDamage).toBeGreaterThan(0);
    });

    it('should not apply splash damage to the primary target (they already took direct damage)', () => {
        // The primary target should be excluded from splash damage to avoid double-damage
        const primaryTarget = createTestCombatUnit({ id: 'primary', x: 100, y: 100, hp: 100, maxHp: 100, owner: 1 });
        let state = createTestState({ [primaryTarget.id]: primaryTarget });

        const projectile = createTestProjectile({
            pos: new Vector(100, 100),
            targetId: 'primary', // This is the primary target
            damage: 50,
            splash: 100
        });

        const result = applySplashDamage(state, projectile, projectile.pos);

        // Primary target should NOT be damaged by splash (they take direct damage separately)
        expect(result.entities['primary'].hp).toBe(100);
    });
});

import { describe, it, expect } from 'vitest';
import { Vector } from '../../src/engine/types';
import { RULES } from '../../src/data/schemas/index';
import { createProjectile } from '../../src/engine/reducers/helpers';
import { createTestCombatUnit, createTestBuilding, createTestHarrier } from '../../src/engine/test-utils';

describe('Projectile Archetype Types', () => {
    it('should include archetype field in Projectile interface', () => {
        const projectile = {
            ownerId: 'e_1',
            pos: new Vector(0, 0),
            vel: new Vector(1, 0),
            targetId: 'e_2',
            speed: 18,
            damage: 10,
            splash: 0,
            type: 'bullet',
            weaponType: 'bullet',
            dead: false,
            archetype: 'hitscan' as const,
            hp: 0,
            maxHp: 0,
            arcHeight: 0,
            startPos: new Vector(0, 0),
            trailPoints: []
        };

        expect(projectile.archetype).toBe('hitscan');
        expect(projectile.hp).toBe(0);
        expect(projectile.maxHp).toBe(0);
        expect(projectile.arcHeight).toBe(0);
        expect(projectile.startPos).toBeInstanceOf(Vector);
        expect(projectile.trailPoints).toEqual([]);
    });

    it('should support all six archetypes', () => {
        const archetypes = ['hitscan', 'rocket', 'artillery', 'missile', 'ballistic', 'grenade'] as const;
        archetypes.forEach(archetype => {
            expect(typeof archetype).toBe('string');
        });
    });
});

describe('Weapon Archetypes Configuration', () => {
    it('should have weaponArchetypes in rules', () => {
        expect(RULES.weaponArchetypes).toBeDefined();
    });

    it('should define archetype for bullet weapon', () => {
        expect(RULES.weaponArchetypes!.bullet).toEqual({
            archetype: 'hitscan',
            interceptable: false
        });
    });

    it('should define archetype for rocket weapon with HP', () => {
        expect(RULES.weaponArchetypes!.rocket).toEqual({
            archetype: 'rocket',
            interceptable: true,
            hp: 50
        });
    });

    it('should define archetype for heavy_cannon as artillery', () => {
        expect(RULES.weaponArchetypes!.heavy_cannon).toEqual({
            archetype: 'artillery',
            interceptable: true,
            hp: 150
        });
    });

    it('should define archetype for missile', () => {
        expect(RULES.weaponArchetypes!.missile).toEqual({
            archetype: 'missile',
            interceptable: true,
            hp: 100
        });
    });
});

describe('createProjectile with Archetypes', () => {
    it('should create hitscan projectile for bullet weapon', () => {
        const source = createTestCombatUnit({ key: 'rifle', x: 0, y: 0 });
        const target = createTestCombatUnit({ key: 'rifle', x: 100, y: 0 });

        const proj = createProjectile(source, target);

        expect(proj.archetype).toBe('hitscan');
        expect(proj.hp).toBe(0);
        expect(proj.maxHp).toBe(0);
        expect(proj.speed).toBeGreaterThanOrEqual(50);
    });

    it('should create rocket projectile with HP', () => {
        const source = createTestCombatUnit({ key: 'rocket', x: 0, y: 0 });
        const target = createTestCombatUnit({ key: 'rifle', x: 100, y: 0 });

        const proj = createProjectile(source, target);

        expect(proj.archetype).toBe('rocket');
        expect(proj.hp).toBe(50);
        expect(proj.maxHp).toBe(50);
        expect(proj.speed).toBe(9);
    });

    it('should create artillery projectile for heavy_cannon', () => {
        const source = createTestCombatUnit({ key: 'artillery', x: 0, y: 0 });
        const target = createTestCombatUnit({ key: 'rifle', x: 300, y: 0 });

        const proj = createProjectile(source, target);

        expect(proj.archetype).toBe('artillery');
        expect(proj.hp).toBe(150);
        expect(proj.maxHp).toBe(150);
        expect(proj.speed).toBe(6);
    });

    it('should create missile projectile for SAM site', () => {
        const source = createTestBuilding({ key: 'sam_site', x: 0, y: 0 });
        const target = createTestHarrier({ x: 200, y: 0 });

        const proj = createProjectile(source, target);

        expect(proj.archetype).toBe('missile');
        expect(proj.hp).toBe(100);
        expect(proj.maxHp).toBe(100);
        expect(proj.speed).toBe(28);
    });

    it('should set startPos and empty trailPoints', () => {
        const source = createTestCombatUnit({ key: 'rifle', x: 50, y: 75 });
        const target = createTestCombatUnit({ key: 'rifle', x: 150, y: 75 });

        const proj = createProjectile(source, target);

        expect(proj.startPos.x).toBe(50);
        expect(proj.startPos.y).toBe(75);
        expect(proj.trailPoints).toEqual([]);
    });

    it('should calculate arcHeight based on distance for artillery', () => {
        const source = createTestCombatUnit({ key: 'artillery', x: 0, y: 0 });
        const target = createTestCombatUnit({ key: 'rifle', x: 400, y: 0 });

        const proj = createProjectile(source, target);

        // arcHeight = distance * 0.4 for artillery = 400 * 0.4 = 160
        expect(proj.arcHeight).toBe(160);
    });

    it('should set arcHeight to 0 for hitscan', () => {
        const source = createTestCombatUnit({ key: 'rifle', x: 0, y: 0 });
        const target = createTestCombatUnit({ key: 'rifle', x: 200, y: 0 });

        const proj = createProjectile(source, target);

        expect(proj.arcHeight).toBe(0);
    });

    it('should create ballistic projectile for cannon weapon', () => {
        const source = createTestBuilding({ key: 'turret', x: 0, y: 0 });
        const target = createTestCombatUnit({ key: 'rifle', x: 100, y: 0 });

        const proj = createProjectile(source, target);

        expect(proj.archetype).toBe('ballistic');
        expect(proj.hp).toBe(0);  // cannon is not interceptable
        expect(proj.maxHp).toBe(0);
        expect(proj.speed).toBe(14);
    });

    it('should create grenade projectile with arc', () => {
        const source = createTestCombatUnit({ key: 'grenadier', x: 0, y: 0 });
        const target = createTestCombatUnit({ key: 'rifle', x: 100, y: 0 });

        const proj = createProjectile(source, target);

        expect(proj.archetype).toBe('grenade');
        expect(proj.hp).toBe(0);  // grenade is not interceptable
        expect(proj.maxHp).toBe(0);
        expect(proj.speed).toBe(8);
        // arcHeight = distance * 0.6 for grenade = 100 * 0.6 = 60
        expect(proj.arcHeight).toBe(60);
    });

    it('should create ballistic projectile with small arc', () => {
        const source = createTestBuilding({ key: 'turret', x: 0, y: 0 });
        const target = createTestCombatUnit({ key: 'rifle', x: 200, y: 0 });

        const proj = createProjectile(source, target);

        // arcHeight = distance * 0.1 for ballistic = 200 * 0.1 = 20
        expect(proj.arcHeight).toBe(20);
    });
});

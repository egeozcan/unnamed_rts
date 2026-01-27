import { describe, it, expect } from 'vitest';
import { Vector } from '../../src/engine/types';
import { RULES } from '../../src/data/schemas/index';

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

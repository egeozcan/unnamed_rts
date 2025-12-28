import { describe, it, expect } from 'vitest';
import rules from '../data/rules.json';

const RULES = rules as any;

/**
 * Unit Counter System Tests
 * 
 * Verifies that the rock-paper-scissors damage modifier system works correctly:
 * - Anti-infantry weapons (flame, sniper) are highly effective vs infantry
 * - Missiles and rockets are effective vs heavy armor
 * - Bullets are nearly useless vs heavy armor
 * - Heavy cannons are effective for siege
 */
describe('Unit Counter System - Damage Modifiers', () => {

    describe('Anti-Infantry Weapons', () => {
        it('flame weapons deal bonus damage to infantry', () => {
            const modifier = RULES.damageModifiers.flame.infantry;
            expect(modifier).toBeGreaterThanOrEqual(1.5);
            // Flame should be VERY effective vs infantry
            expect(modifier).toBeLessThanOrEqual(2.0);
        });

        it('sniper weapons deal massive damage to infantry', () => {
            const modifier = RULES.damageModifiers.sniper.infantry;
            expect(modifier).toBeGreaterThanOrEqual(3.0);
            // Sniper should one-shot most infantry
        });

        it('grenade weapons deal bonus damage to infantry', () => {
            const modifier = RULES.damageModifiers.grenade.infantry;
            expect(modifier).toBeGreaterThanOrEqual(1.25);
        });

        it('flame weapons are weak vs heavy armor', () => {
            const modifier = RULES.damageModifiers.flame.heavy;
            expect(modifier).toBeLessThanOrEqual(0.5);
            // Flame tanks should struggle vs mammoth tanks
        });

        it('sniper weapons are nearly useless vs heavy armor', () => {
            const modifier = RULES.damageModifiers.sniper.heavy;
            expect(modifier).toBeLessThanOrEqual(0.1);
        });
    });

    describe('Anti-Vehicle Weapons', () => {
        it('missiles deal bonus damage to heavy armor', () => {
            const modifier = RULES.damageModifiers.missile.heavy;
            expect(modifier).toBeGreaterThanOrEqual(1.25);
        });

        it('heavy cannons deal bonus damage to heavy armor', () => {
            const modifier = RULES.damageModifiers.heavy_cannon.heavy;
            expect(modifier).toBeGreaterThanOrEqual(1.0);
        });

        it('rockets are effective vs medium armor', () => {
            const modifier = RULES.damageModifiers.rocket.medium;
            expect(modifier).toBeGreaterThanOrEqual(1.0);
        });

        it('missiles are weak vs infantry', () => {
            const modifier = RULES.damageModifiers.missile.infantry;
            expect(modifier).toBeLessThanOrEqual(0.3);
        });
    });

    describe('Basic Weapons', () => {
        it('bullets are effective vs infantry', () => {
            const modifier = RULES.damageModifiers.bullet.infantry;
            expect(modifier).toBeGreaterThanOrEqual(0.9);
        });

        it('bullets are nearly useless vs heavy armor', () => {
            const modifier = RULES.damageModifiers.bullet.heavy;
            expect(modifier).toBeLessThanOrEqual(0.15);
        });

        it('bullets are weak vs medium armor', () => {
            const modifier = RULES.damageModifiers.bullet.medium;
            expect(modifier).toBeLessThanOrEqual(0.3);
        });

        it('ap_bullet is effective vs light armor', () => {
            const modifier = RULES.damageModifiers.ap_bullet.light;
            expect(modifier).toBeGreaterThanOrEqual(1.0);
        });
    });

    describe('Siege Weapons', () => {
        it('heavy cannon deals bonus damage to buildings', () => {
            const modifier = RULES.damageModifiers.heavy_cannon.building;
            expect(modifier).toBeGreaterThanOrEqual(1.25);
        });

        it('missiles are effective vs buildings', () => {
            const modifier = RULES.damageModifiers.missile.building;
            expect(modifier).toBeGreaterThanOrEqual(1.0);
        });

        it('bullets are weak vs buildings', () => {
            const modifier = RULES.damageModifiers.bullet.building;
            expect(modifier).toBeLessThanOrEqual(0.3);
        });
    });

    describe('Counter Relationships', () => {
        it('flamer beats rifleman (flame > infantry)', () => {
            // Flamer: 20 damage, flame weapon
            // Rifleman: 60 HP, infantry armor
            const flamerDamage = 20;
            const flameVsInfantryMod = RULES.damageModifiers.flame.infantry;
            const effectiveDamage = flamerDamage * flameVsInfantryMod;

            // Should kill a rifleman in ~2 hits (60 HP / effective damage)
            expect(effectiveDamage).toBeGreaterThanOrEqual(25);
        });

        it('rocket soldier beats heavy tank (rocket > heavy)', () => {
            // Rocket: 35 damage, rocket weapon
            // Heavy Tank: 700 HP, heavy armor
            const rocketDamage = 35;
            const rocketVsHeavyMod = RULES.damageModifiers.rocket.heavy;
            const effectiveDamage = rocketDamage * rocketVsHeavyMod;

            // Should deal at least 30 damage per hit
            expect(effectiveDamage).toBeGreaterThanOrEqual(30);
        });

        it('heavy tank beats flamer (cannon > infantry weapon user)', () => {
            // Heavy Tank: 90 damage, cannon weapon
            // Flamer: 80 HP, infantry armor (but flame weapon does little to heavy)
            const heavyTankDamage = 90;
            const cannonVsInfantryMod = RULES.damageModifiers.cannon.infantry;
            const effectiveDamage = heavyTankDamage * cannonVsInfantryMod;

            // Heavy tank still does decent damage (36) and can take hits
            expect(effectiveDamage).toBeGreaterThan(30);

            // But the flamer's flame does very little damage back to heavy armor
            const flamerVsHeavyMod = RULES.damageModifiers.flame.heavy;
            expect(flamerVsHeavyMod).toBeLessThan(0.5);
        });

        it('rifleman is weak vs heavy tank (bullet vs heavy)', () => {
            // Rifleman: 6 damage, bullet weapon
            // Heavy Tank: 700 HP, heavy armor
            const rifleDamage = 6;
            const bulletVsHeavyMod = RULES.damageModifiers.bullet.heavy;
            const effectiveDamage = rifleDamage * bulletVsHeavyMod;

            // Should be nearly ineffective - require 100+ hits
            expect(700 / effectiveDamage).toBeGreaterThan(100);
        });

        it('mammoth tank is strong vs all (heavy cannon versatility)', () => {
            // Mammoth: 120 damage, heavy_cannon weapon
            const mammothDamage = 120;

            // Decent vs medium
            const vsLight = mammothDamage * RULES.damageModifiers.heavy_cannon.light;
            const vsMedium = mammothDamage * RULES.damageModifiers.heavy_cannon.medium;
            const vsHeavy = mammothDamage * RULES.damageModifiers.heavy_cannon.heavy;

            // Should be at least reasonable vs all armor types
            expect(vsLight).toBeGreaterThan(50);
            expect(vsMedium).toBeGreaterThan(100);
            expect(vsHeavy).toBeGreaterThanOrEqual(120);
        });
    });
});

describe('Unit Armor Assignments', () => {
    it('infantry units have infantry armor', () => {
        const infantryUnits = ['rifle', 'rocket', 'engineer', 'medic', 'sniper', 'flamer', 'grenadier', 'commando'];
        for (const unitKey of infantryUnits) {
            const unit = RULES.units[unitKey];
            expect(unit?.armor).toBe('infantry');
        }
    });

    it('light vehicles have light armor', () => {
        const lightVehicles = ['jeep', 'apc', 'artillery', 'mlrs', 'heli'];
        for (const unitKey of lightVehicles) {
            const unit = RULES.units[unitKey];
            expect(unit?.armor).toBe('light');
        }
    });

    it('medium vehicles have medium armor', () => {
        const mediumVehicles = ['light', 'flame_tank', 'stealth'];
        for (const unitKey of mediumVehicles) {
            const unit = RULES.units[unitKey];
            expect(unit?.armor).toBe('medium');
        }
    });

    it('heavy vehicles have heavy armor', () => {
        const heavyVehicles = ['harvester', 'heavy', 'mammoth', 'mcv'];
        for (const unitKey of heavyVehicles) {
            const unit = RULES.units[unitKey];
            expect(unit?.armor).toBe('heavy');
        }
    });
});

describe('Weapon Type Assignments', () => {
    it('anti-infantry units have appropriate weapons', () => {
        expect(RULES.units.flamer.weaponType).toBe('flame');
        expect(RULES.units.sniper.weaponType).toBe('sniper');
        expect(RULES.units.grenadier.weaponType).toBe('grenade');
        expect(RULES.units.flame_tank.weaponType).toBe('flame');
    });

    it('anti-armor units have appropriate weapons', () => {
        expect(RULES.units.rocket.weaponType).toBe('rocket');
        expect(RULES.units.stealth.weaponType).toBe('missile');
        expect(RULES.units.mlrs.weaponType).toBe('missile');
    });

    it('general purpose units have cannon weapons', () => {
        expect(RULES.units.light.weaponType).toBe('cannon');
        expect(RULES.units.heavy.weaponType).toBe('cannon');
    });

    it('siege units have heavy cannon', () => {
        expect(RULES.units.mammoth.weaponType).toBe('heavy_cannon');
        expect(RULES.units.artillery.weaponType).toBe('heavy_cannon');
    });
});

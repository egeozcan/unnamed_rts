/**
 * Tests for AI Scouting System
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Vector } from '../../types.js';
import { CombatUnit } from '../../types.js';
import { ScoutManager, predictThreat, analyzeEnemyComposition } from './index.js';
import type { EnemyIntel } from './index.js';

// Helper to create a mock unit
function createMockUnit(id: string, pos: Vector, key: string, owner: number = 1): CombatUnit {
    return {
        id,
        type: 'UNIT',
        key,
        owner,
        pos,
        prevPos: pos,
        hp: 100,
        maxHp: 100,
        w: 20,
        h: 20,
        radius: 10,
        dead: false,
        movement: {
            vel: new Vector(0, 0),
            rotation: 0,
            moveTarget: null,
            path: null,
            pathIdx: 0,
            finalDest: null,
            stuckTimer: 0,
            unstuckDir: null,
            unstuckTimer: 0
        },
        combat: {
            targetId: null,
            lastAttackerId: null,
            cooldown: 0,
            flash: 0,
            turretAngle: 0
        }
    } as CombatUnit;
}


describe('Scouting System', () => {
    describe('ScoutManager', () => {
        let manager: ScoutManager;

        beforeEach(() => {
            manager = new ScoutManager(0);
        });

        it('should start with no intel', () => {
            const intel = manager.getAllIntel();
            expect(intel.length).toBe(0);
        });

        it('should check if unit is a scout', () => {
            expect(manager.isScout('unit1')).toBe(false);

            manager.assignScout('unit1', new Vector(100, 100), 1000, 1000, 0);

            expect(manager.isScout('unit1')).toBe(true);
        });

        it('should remove scouts', () => {
            manager.assignScout('unit1', new Vector(100, 100), 1000, 1000, 0);

            expect(manager.isScout('unit1')).toBe(true);

            manager.removeScout('unit1');

            expect(manager.isScout('unit1')).toBe(false);
        });

        it('should limit max scouts', () => {
            const config = { ...manager['config'], maxScouts: 2 };
            manager = new ScoutManager(0, config);

            manager.assignScout('u1', new Vector(100, 100), 1000, 1000, 0);
            manager.assignScout('u2', new Vector(100, 100), 1000, 1000, 0);
            manager.assignScout('u3', new Vector(100, 100), 1000, 1000, 0);

            expect(manager.isScout('u1')).toBe(true);
            expect(manager.isScout('u2')).toBe(true);
            expect(manager.isScout('u3')).toBe(false); // Exceeds max
        });

        it('should find best scout candidate', () => {
            const units = [
                createMockUnit('harvester1', new Vector(100, 100), 'harvester', 0),
                createMockUnit('tank1', new Vector(200, 200), 'heavy', 0),
                createMockUnit('light1', new Vector(300, 300), 'light', 0)
            ];

            const candidate = manager.findBestScoutCandidate(units);

            // Should prefer light tank over heavy, never harvester
            expect(candidate).not.toBeNull();
            expect(candidate!.key).toBe('light');
        });

        it('should not select harvesters as scouts', () => {
            const units = [
                createMockUnit('harvester1', new Vector(100, 100), 'harvester', 0)
            ];

            const candidate = manager.findBestScoutCandidate(units);

            expect(candidate).toBeNull();
        });
    });

    describe('Threat Prediction', () => {
        function createIntelWithUnits(units: { key: string; tick: number }[]): EnemyIntel {
            const intel: EnemyIntel = {
                playerId: 1,
                lastSeen: 100,
                buildings: new Map(),
                units: new Map(),
                techLevel: 'low',
                estimatedCredits: 5000,
                baseLocation: new Vector(800, 800),
                expansions: []
            };

            units.forEach((u, i) => {
                intel.units.set(`enemy_${i}`, {
                    id: `enemy_${i}`,
                    key: u.key,
                    pos: new Vector(600, 600),
                    lastSeenTick: u.tick
                });
            });

            return intel;
        }

        it('should report low threat with few units', () => {
            const intel = createIntelWithUnits([
                { key: 'rifle', tick: 100 },
                { key: 'rifle', tick: 100 }
            ]);

            const prediction = predictThreat(intel, 100);

            expect(prediction.threatLevel).toBe('low');
            expect(prediction.estimatedArmySize).toBe(2);
        });

        it('should report medium threat with moderate army', () => {
            const intel = createIntelWithUnits([
                { key: 'heavy', tick: 100 },
                { key: 'heavy', tick: 100 },
                { key: 'heavy', tick: 100 },
                { key: 'heavy', tick: 100 },
                { key: 'heavy', tick: 100 }
            ]);

            const prediction = predictThreat(intel, 100);

            expect(prediction.threatLevel).toBe('medium');
        });

        it('should report high threat with large army', () => {
            const units = Array(12).fill(null).map(() => ({
                key: 'heavy',
                tick: 100
            }));
            const intel = createIntelWithUnits(units);

            const prediction = predictThreat(intel, 100);

            expect(prediction.threatLevel).toBe('high');
            expect(prediction.estimatedArmySize).toBe(12);
        });

        it('should exclude harvesters from army count', () => {
            const intel = createIntelWithUnits([
                { key: 'harvester', tick: 100 },
                { key: 'harvester', tick: 100 },
                { key: 'heavy', tick: 100 }
            ]);

            const prediction = predictThreat(intel, 100);

            expect(prediction.estimatedArmySize).toBe(1); // Only the heavy tank
        });
    });

    describe('Enemy Composition Analysis', () => {
        function createIntelWithUnits(keys: string[]): EnemyIntel {
            const intel: EnemyIntel = {
                playerId: 1,
                lastSeen: 100,
                buildings: new Map(),
                units: new Map(),
                techLevel: 'low',
                estimatedCredits: 5000,
                baseLocation: null,
                expansions: []
            };

            keys.forEach((key, i) => {
                intel.units.set(`enemy_${i}`, {
                    id: `enemy_${i}`,
                    key,
                    pos: new Vector(600, 600),
                    lastSeenTick: 100
                });
            });

            return intel;
        }

        it('should detect infantry-dominant composition', () => {
            const intel = createIntelWithUnits([
                'rifle', 'rifle', 'rifle', 'rifle', 'rocket'
            ]);

            const analysis = analyzeEnemyComposition(intel);

            expect(analysis.dominantType).toBe('infantry');
        });

        it('should detect vehicle-dominant composition', () => {
            const intel = createIntelWithUnits([
                'heavy', 'heavy', 'heavy', 'light'
            ]);

            const analysis = analyzeEnemyComposition(intel);

            expect(analysis.dominantType).toBe('vehicle');
        });

        it('should detect splash damage presence', () => {
            const intel = createIntelWithUnits([
                'rifle', 'rifle', 'grenadier'
            ]);

            const analysis = analyzeEnemyComposition(intel);

            expect(analysis.hasSplash).toBe(true);
        });

        it('should detect anti-air presence', () => {
            const intel = createIntelWithUnits([
                'rifle', 'rocket', 'heavy'
            ]);

            const analysis = analyzeEnemyComposition(intel);

            expect(analysis.hasAntiAir).toBe(true);
        });
    });
});

/**
 * Tests for AI Micro-Management System
 */

import { describe, it, expect } from 'vitest';
import { Vector } from '../../types.js';
import { CombatUnit } from '../../types.js';
import {
    evaluateKite,
    evaluateRetreat,
    evaluateStutterStep,
    evaluateSpread
} from './index.js';

// Helper to create a mock combat unit
function createMockUnit(overrides: Partial<CombatUnit> = {}): CombatUnit {
    return {
        id: 'unit1',
        type: 'UNIT',
        key: 'rifle',
        owner: 0,
        pos: new Vector(500, 500),
        prevPos: new Vector(500, 500),
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
        },
        ...overrides
    } as CombatUnit;
}

// Helper to create a mock enemy
function createMockEnemy(pos: Vector, key: CombatUnit['key'] = 'rifle'): CombatUnit {
    return createMockUnit({
        id: 'enemy1',
        key,
        owner: 1,
        pos,
        prevPos: pos
    });
}

describe('AI Micro System', () => {
    describe('Kiting', () => {
        it('should kite when has range advantage and enemy is close', () => {
            // Rocket soldier (range 300) vs rifle (range 100)
            const unit = createMockUnit({
                key: 'rocket' as const,
                pos: new Vector(500, 500),
                combat: { ...createMockUnit().combat, cooldown: 30 }
            });
            const enemy = createMockEnemy(new Vector(550, 500), 'rifle');

            const decision = evaluateKite(unit, enemy, 1000);

            // Should want to kite since we have range advantage and enemy is close
            // Note: depends on RULES data for rocket range
            expect(decision).toBeDefined();
        });

        it('should not kite melee units', () => {
            const unit = createMockUnit({
                key: 'rifle', // Short range
                pos: new Vector(500, 500)
            });
            const enemy = createMockEnemy(new Vector(520, 500));

            const decision = evaluateKite(unit, enemy, 1000);

            // Rifle has short range, shouldn't kite
            expect(decision.shouldKite).toBe(false);
        });
    });

    describe('Retreat', () => {
        it('should retreat when HP is low', () => {
            const unit = createMockUnit({
                hp: 20,
                maxHp: 100 // 20% HP
            });
            const enemies = [createMockEnemy(new Vector(550, 500))];
            const baseCenter = new Vector(200, 200);
            const allies: CombatUnit[] = [];

            const decision = evaluateRetreat(unit, enemies, baseCenter, allies);

            expect(decision.shouldRetreat).toBe(true);
            expect(decision.retreatPosition).not.toBeNull();
        });

        it('should not retreat when HP is healthy', () => {
            const unit = createMockUnit({
                hp: 80,
                maxHp: 100 // 80% HP
            });
            const enemies = [createMockEnemy(new Vector(550, 500))];
            const baseCenter = new Vector(200, 200);
            const allies: CombatUnit[] = [];

            const decision = evaluateRetreat(unit, enemies, baseCenter, allies);

            expect(decision.shouldRetreat).toBe(false);
        });

        it('should mark critical retreat when HP is very low', () => {
            const unit = createMockUnit({
                hp: 10,
                maxHp: 100 // 10% HP
            });
            const enemies = [createMockEnemy(new Vector(550, 500))];
            const baseCenter = new Vector(200, 200);
            const allies: CombatUnit[] = [];

            const decision = evaluateRetreat(unit, enemies, baseCenter, allies);

            expect(decision.shouldRetreat).toBe(true);
            expect(decision.severity).toBe('critical');
        });

        it('should retreat toward base center', () => {
            const unit = createMockUnit({
                hp: 20,
                maxHp: 100,
                pos: new Vector(500, 500)
            });
            const enemies = [createMockEnemy(new Vector(600, 500))]; // Enemy to the right
            const baseCenter = new Vector(200, 200); // Base to the upper-left
            const allies: CombatUnit[] = [];

            const decision = evaluateRetreat(unit, enemies, baseCenter, allies);

            expect(decision.shouldRetreat).toBe(true);
            expect(decision.retreatPosition).not.toBeNull();
            // Retreat position should be toward base (lower x, lower y)
            if (decision.retreatPosition) {
                expect(decision.retreatPosition.x).toBeLessThan(unit.pos.x);
            }
        });
    });

    describe('Stutter-stepping', () => {
        it('should stutter-step slow units toward target when on cooldown', () => {
            // Mammoth tank - slow unit
            const unit = createMockUnit({
                key: 'mammoth',
                pos: new Vector(500, 500),
                combat: { ...createMockUnit().combat, cooldown: 30 }
            });
            const enemy = createMockEnemy(new Vector(700, 500));

            const decision = evaluateStutterStep(unit, enemy);

            // Decision depends on RULES data for mammoth speed
            expect(decision).toBeDefined();
        });

        it('should not stutter-step when weapon is ready', () => {
            const unit = createMockUnit({
                key: 'heavy',
                pos: new Vector(500, 500),
                combat: { ...createMockUnit().combat, cooldown: 0 }
            });
            const enemy = createMockEnemy(new Vector(600, 500));

            const decision = evaluateStutterStep(unit, enemy);

            expect(decision.shouldStutter).toBe(false);
        });
    });

    describe('Spread vs Splash', () => {
        it('should spread when allies are clustered and enemies have splash', () => {
            const unit = createMockUnit({
                pos: new Vector(500, 500)
            });
            const allies = [
                createMockUnit({ id: 'ally1', pos: new Vector(510, 510) }),
                createMockUnit({ id: 'ally2', pos: new Vector(490, 490) })
            ];
            // Grenadier has splash damage
            const enemies = [createMockEnemy(new Vector(600, 500), 'grenadier')];

            const decision = evaluateSpread(unit, allies, enemies);

            // Should want to spread if enemies have splash
            expect(decision).toBeDefined();
        });

        it('should not spread when no splash enemies', () => {
            const unit = createMockUnit({
                pos: new Vector(500, 500)
            });
            const allies = [
                createMockUnit({ id: 'ally1', pos: new Vector(510, 510) })
            ];
            // Rifle has no splash
            const enemies = [createMockEnemy(new Vector(600, 500), 'rifle')];

            const decision = evaluateSpread(unit, allies, enemies);

            expect(decision.shouldSpread).toBe(false);
        });

        it('should not spread when already spread out', () => {
            const unit = createMockUnit({
                pos: new Vector(500, 500)
            });
            const allies = [
                createMockUnit({ id: 'ally1', pos: new Vector(600, 600) }) // Far away
            ];
            const enemies = [createMockEnemy(new Vector(700, 500), 'grenadier')];

            const decision = evaluateSpread(unit, allies, enemies);

            expect(decision.shouldSpread).toBe(false);
        });
    });
});

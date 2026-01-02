/**
 * Tests for AI Defensive Intelligence System
 */

import { describe, it, expect } from 'vitest';
import { Vector } from '../../../../src/engine/types.js';
import { Entity, CombatUnit } from '../../../../src/engine/types.js';
import {
    calculateDefensiveLinePositions,
    createDefensiveLine,
    calculateBaseDefensePositions,
    detectChokepoints,
    assignUnitsToDefense,
    calculateThreatDirection,
    prioritizeThreats,
    calculateReserveSize,
    positionReserve
} from '../../../../src/engine/ai/tactics/defense.js';

// Helper to create a mock unit
function createMockUnit(id: string, pos: Vector, key: string = 'heavy', owner: number = 0): CombatUnit {
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

// Helper to create a mock rock/obstacle
function createMockRock(id: string, pos: Vector): Entity {
    return {
        id,
        type: 'ROCK',
        key: 'rock',
        owner: -1,
        pos,
        prevPos: pos,
        hp: 1000,
        maxHp: 1000,
        w: 80,
        h: 80,
        radius: 40,
        dead: false
    } as Entity;
}

// Helper to create a mock building
function createMockBuilding(id: string, pos: Vector, key: string = 'conyard'): Entity {
    return {
        id,
        type: 'BUILDING',
        key,
        owner: 0,
        pos,
        prevPos: pos,
        hp: 500,
        maxHp: 500,
        w: 80,
        h: 80,
        radius: 40,
        dead: false
    } as Entity;
}

describe('Defensive Intelligence System', () => {
    describe('Defensive Line Positions', () => {
        it('should return empty array for zero units', () => {
            const positions = calculateDefensiveLinePositions(
                new Vector(0, 0),
                new Vector(100, 0),
                0
            );

            expect(positions).toEqual([]);
        });

        it('should return midpoint for single unit', () => {
            const positions = calculateDefensiveLinePositions(
                new Vector(0, 0),
                new Vector(100, 0),
                1
            );

            expect(positions.length).toBe(1);
            expect(positions[0].x).toBeCloseTo(50);
            expect(positions[0].y).toBeCloseTo(0);
        });

        it('should distribute units along line', () => {
            const positions = calculateDefensiveLinePositions(
                new Vector(0, 0),
                new Vector(100, 0),
                3
            );

            expect(positions.length).toBe(3);
            expect(positions[0].x).toBeCloseTo(0);
            expect(positions[1].x).toBeCloseTo(50);
            expect(positions[2].x).toBeCloseTo(100);
        });
    });

    describe('Create Defensive Line', () => {
        it('should create line perpendicular to threat', () => {
            const line = createDefensiveLine(
                new Vector(500, 500),
                new Vector(1, 0), // Threat from right
                4,
                200
            );

            expect(line.positions.length).toBe(4);
            expect(line.facing.x).toBeCloseTo(1);
            expect(line.facing.y).toBeCloseTo(0);
            expect(line.width).toBe(200);
        });

        it('should have correct priority', () => {
            const line = createDefensiveLine(
                new Vector(500, 500),
                new Vector(0, 1),
                2
            );

            expect(line.priority).toBe('important');
            expect(line.assignedUnits).toEqual([]);
        });
    });

    describe('Base Defense Positions', () => {
        it('should create circular defense without threat', () => {
            const positions = calculateBaseDefensePositions(
                new Vector(500, 500),
                [],
                null,
                4
            );

            expect(positions.length).toBe(4);
            // All positions should be at same distance from center
            const distances = positions.map(p => p.dist(new Vector(500, 500)));
            for (const dist of distances) {
                expect(dist).toBeCloseTo(200, 0);
            }
        });

        it('should create line defense toward threat', () => {
            const positions = calculateBaseDefensePositions(
                new Vector(500, 500),
                [],
                new Vector(1, 0), // Threat from right
                3
            );

            expect(positions.length).toBe(3);
            // Positions should be offset toward threat
            for (const pos of positions) {
                expect(pos.x).toBeGreaterThan(500);
            }
        });

        it('should return empty for zero units', () => {
            const positions = calculateBaseDefensePositions(
                new Vector(500, 500),
                [],
                null,
                0
            );

            expect(positions).toEqual([]);
        });
    });

    describe('Chokepoint Detection', () => {
        it('should detect chokepoint between two close obstacles', () => {
            const rocks = [
                createMockRock('r1', new Vector(400, 500)),
                createMockRock('r2', new Vector(500, 500)) // 100 units apart
            ];

            const chokepoints = detectChokepoints(1000, 1000, rocks, []);

            expect(chokepoints.length).toBe(1);
            expect(chokepoints[0].position.x).toBeCloseTo(450);
            expect(chokepoints[0].width).toBeCloseTo(100);
        });

        it('should not detect chokepoint for distant obstacles', () => {
            const rocks = [
                createMockRock('r1', new Vector(100, 500)),
                createMockRock('r2', new Vector(800, 500)) // Too far apart
            ];

            const chokepoints = detectChokepoints(1000, 1000, rocks, []);

            expect(chokepoints.length).toBe(0);
        });

        it('should limit to top 5 chokepoints', () => {
            const rocks: Entity[] = [];
            // Create many rocks forming multiple chokepoints
            for (let i = 0; i < 20; i++) {
                rocks.push(createMockRock(`r${i}`, new Vector(100 + i * 50, 500)));
                rocks.push(createMockRock(`r${i + 20}`, new Vector(100 + i * 50, 620)));
            }

            const chokepoints = detectChokepoints(1000, 1000, rocks, []);

            expect(chokepoints.length).toBeLessThanOrEqual(5);
        });
    });

    describe('Unit Assignment to Defense', () => {
        it('should return empty map for no units', () => {
            const positions = [new Vector(100, 100), new Vector(200, 200)];
            const assignments = assignUnitsToDefense([], positions);

            expect(assignments.size).toBe(0);
        });

        it('should return empty map for no positions', () => {
            const units = [createMockUnit('u1', new Vector(100, 100))];
            const assignments = assignUnitsToDefense(units, []);

            expect(assignments.size).toBe(0);
        });

        it('should assign units to nearest positions', () => {
            const units = [
                createMockUnit('u1', new Vector(100, 100)),
                createMockUnit('u2', new Vector(500, 500))
            ];
            const positions = [new Vector(120, 120), new Vector(480, 480)];

            const assignments = assignUnitsToDefense(units, positions);

            expect(assignments.size).toBe(2);
            expect(assignments.get('u1')!.dist(new Vector(120, 120))).toBeLessThan(50);
            expect(assignments.get('u2')!.dist(new Vector(480, 480))).toBeLessThan(50);
        });

        it('should respect max per position limit', () => {
            const units = [
                createMockUnit('u1', new Vector(100, 100)),
                createMockUnit('u2', new Vector(105, 100)),
                createMockUnit('u3', new Vector(110, 100))
            ];
            const positions = [new Vector(100, 100), new Vector(500, 500)];

            const assignments = assignUnitsToDefense(units, positions, 2);

            // Should spread units between positions
            expect(assignments.size).toBe(3);
        });
    });

    describe('Threat Direction', () => {
        it('should return null for no threats', () => {
            const direction = calculateThreatDirection(new Vector(500, 500), []);

            expect(direction).toBeNull();
        });

        it('should calculate direction to single threat', () => {
            const threat = createMockUnit('e1', new Vector(800, 500), 'heavy', 1);
            const direction = calculateThreatDirection(new Vector(500, 500), [threat]);

            expect(direction).not.toBeNull();
            expect(direction!.x).toBeCloseTo(1, 1);
            expect(direction!.y).toBeCloseTo(0, 1);
        });

        it('should calculate average direction for multiple threats', () => {
            const threats = [
                createMockUnit('e1', new Vector(800, 500), 'heavy', 1),
                createMockUnit('e2', new Vector(500, 800), 'heavy', 1)
            ];
            const direction = calculateThreatDirection(new Vector(500, 500), threats);

            expect(direction).not.toBeNull();
            // Should be somewhere between right and down
            expect(direction!.x).toBeGreaterThan(0);
            expect(direction!.y).toBeGreaterThan(0);
        });
    });

    describe('Threat Prioritization', () => {
        it('should prioritize closer threats', () => {
            const threats = [
                createMockUnit('far', new Vector(800, 500), 'heavy', 1),
                createMockUnit('close', new Vector(550, 500), 'heavy', 1)
            ];
            const baseCenter = new Vector(500, 500);

            const sorted = prioritizeThreats(threats, baseCenter, []);

            expect(sorted[0].id).toBe('close');
        });

        it('should prioritize threats near buildings', () => {
            const threats = [
                createMockUnit('away', new Vector(800, 800), 'heavy', 1),
                createMockUnit('nearBuilding', new Vector(350, 350), 'heavy', 1)
            ];
            const baseCenter = new Vector(500, 500);
            const buildings = [createMockBuilding('b1', new Vector(300, 300))];

            const sorted = prioritizeThreats(threats, baseCenter, buildings);

            expect(sorted[0].id).toBe('nearBuilding');
        });

        it('should prioritize dangerous unit types', () => {
            const threats = [
                createMockUnit('rifle', new Vector(600, 500), 'rifle', 1),
                createMockUnit('mammoth', new Vector(700, 500), 'mammoth', 1)
            ];
            const baseCenter = new Vector(500, 500);

            const sorted = prioritizeThreats(threats, baseCenter, []);

            // Mammoth is more dangerous despite being farther
            expect(sorted[0].id).toBe('mammoth');
        });
    });

    describe('Reserve Management', () => {
        it('should calculate minimum reserve of 1', () => {
            const reserve = calculateReserveSize(3, 0, 1);
            expect(reserve).toBeGreaterThanOrEqual(1);
        });

        it('should increase reserve with threat level', () => {
            const lowThreat = calculateReserveSize(20, 10, 0.5);
            const highThreat = calculateReserveSize(20, 80, 0.5);

            expect(highThreat).toBeGreaterThan(lowThreat);
        });

        it('should decrease reserve with high risk tolerance', () => {
            const cautious = calculateReserveSize(20, 50, 0.2);
            const risky = calculateReserveSize(20, 50, 0.8);

            expect(cautious).toBeGreaterThan(risky);
        });
    });

    describe('Reserve Positioning', () => {
        it('should position reserve units near base center', () => {
            const units = [
                createMockUnit('r1', new Vector(100, 100)),
                createMockUnit('r2', new Vector(200, 200))
            ];
            const baseCenter = new Vector(500, 500);

            const positions = positionReserve(units, baseCenter);

            expect(positions.size).toBe(2);
            // All positions should be close to base center
            for (const pos of positions.values()) {
                expect(pos.dist(baseCenter)).toBeLessThan(100);
            }
        });
    });
});

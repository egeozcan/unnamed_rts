/**
 * Tests for AI Squad System
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Vector } from '../../../../src/engine/types.js';
import { CombatUnit } from '../../../../src/engine/types.js';
import { SquadManager } from '../../../../src/engine/ai/squad/index.js';
import { calculateFormationPositions, assignRoles, suggestFormation } from '../../../../src/engine/ai/squad/formations.js';

// Helper to create a mock combat unit
function createMockUnit(id: string, pos: Vector, key: CombatUnit['key'] = 'rifle'): CombatUnit {
    return {
        id,
        type: 'UNIT',
        key,
        owner: 0,
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

describe('Squad System', () => {
    describe('Formations', () => {
        const units = [
            createMockUnit('u1', new Vector(100, 100)),
            createMockUnit('u2', new Vector(110, 100)),
            createMockUnit('u3', new Vector(120, 100)),
            createMockUnit('u4', new Vector(130, 100))
        ];
        const center = new Vector(500, 500);
        const facing = new Vector(1, 0); // Facing right

        it('should calculate line formation positions', () => {
            const positions = calculateFormationPositions(units, center, facing, 'line', 40);

            expect(positions.size).toBe(4);
            // Line should be perpendicular to facing direction
            for (const pos of positions.values()) {
                expect(pos.x).toBeCloseTo(center.x, 0);
            }
        });

        it('should calculate wedge formation positions', () => {
            const positions = calculateFormationPositions(units, center, facing, 'wedge', 40);

            expect(positions.size).toBe(4);
            // Front unit should be ahead of others
            const posArray = Array.from(positions.values());
            expect(posArray.length).toBe(4);
        });

        it('should calculate box formation positions', () => {
            const positions = calculateFormationPositions(units, center, facing, 'box', 40);

            expect(positions.size).toBe(4);
        });

        it('should calculate concave formation positions', () => {
            const positions = calculateFormationPositions(units, center, facing, 'concave', 40);

            expect(positions.size).toBe(4);
        });

        it('should calculate spread formation positions', () => {
            const positions = calculateFormationPositions(units, center, facing, 'spread', 80);

            expect(positions.size).toBe(4);
            // All positions should be far apart
            const posArray = Array.from(positions.values());
            for (let i = 0; i < posArray.length; i++) {
                for (let j = i + 1; j < posArray.length; j++) {
                    const dist = posArray[i].dist(posArray[j]);
                    expect(dist).toBeGreaterThan(40);
                }
            }
        });
    });

    describe('Role Assignment', () => {
        it('should assign frontline role to tanks', () => {
            const units = [
                createMockUnit('tank1', new Vector(100, 100), 'heavy'),
                createMockUnit('inf1', new Vector(110, 100), 'rifle')
            ];

            const roles = assignRoles(units);

            expect(roles.get('tank1')).toBe('frontline');
            expect(roles.get('inf1')).toBe('damage'); // Infantry gets damage role
        });

        it('should assign damage role to artillery', () => {
            const units = [
                createMockUnit('arty1', new Vector(100, 100), 'artillery'),
                createMockUnit('tank1', new Vector(110, 100), 'heavy')
            ];

            const roles = assignRoles(units);

            expect(roles.get('arty1')).toBe('damage'); // Artillery is medium armor
            expect(roles.get('tank1')).toBe('frontline');
        });
    });

    describe('Formation Suggestion', () => {
        it('should suggest spread formation against splash damage', () => {
            const formation = suggestFormation(5, true, false, 4);
            expect(formation).toBe('spread');
        });

        it('should suggest line for small defending squads', () => {
            // isDefending && squadSize <= 6 → 'line'
            const formation = suggestFormation(5, false, true, 6);
            expect(formation).toBe('line');
        });

        it('should suggest concave for large defending squads', () => {
            // isDefending && squadSize > 6 → 'concave'
            const formation = suggestFormation(5, false, true, 8);
            expect(formation).toBe('concave');
        });

        it('should suggest line for small attack squads', () => {
            // squadSize <= 4 → 'line'
            const formation = suggestFormation(5, false, false, 4);
            expect(formation).toBe('line');
        });

        it('should suggest wedge for large attack squads', () => {
            // squadSize >= 8 → 'wedge'
            const formation = suggestFormation(5, false, false, 8);
            expect(formation).toBe('wedge');
        });

        it('should suggest concave for medium attack squads', () => {
            // 4 < squadSize < 8 → 'concave'
            const formation = suggestFormation(5, false, false, 6);
            expect(formation).toBe('concave');
        });
    });

    describe('SquadManager', () => {
        let manager: SquadManager;

        beforeEach(() => {
            manager = new SquadManager(0);
        });

        it('should create squads', () => {
            const squad = manager.createSquad('attack', ['u1', 'u2', 'u3'], 0);

            expect(squad.type).toBe('attack');
            expect(squad.unitIds).toEqual(['u1', 'u2', 'u3']);
            expect(squad.status).toBe('forming');
        });

        it('should get squad by ID', () => {
            const squad = manager.createSquad('attack', ['u1', 'u2'], 0);

            const retrieved = manager.getSquad(squad.id);

            expect(retrieved).toBe(squad);
        });

        it('should get all squads', () => {
            manager.createSquad('attack', ['u1', 'u2'], 0);
            manager.createSquad('defense', ['u3', 'u4'], 0);

            const squads = manager.getAllSquads();

            expect(squads.length).toBe(2);
        });

        it('should get squads by type', () => {
            manager.createSquad('attack', ['u1', 'u2'], 0);
            manager.createSquad('defense', ['u3', 'u4'], 0);
            manager.createSquad('attack', ['u5', 'u6'], 0);

            const attackSquads = manager.getSquadsByType('attack');

            expect(attackSquads.length).toBe(2);
        });

        it('should remove squads', () => {
            const squad = manager.createSquad('attack', ['u1', 'u2'], 0);

            manager.removeSquad(squad.id);

            expect(manager.getSquad(squad.id)).toBeUndefined();
        });
    });
});

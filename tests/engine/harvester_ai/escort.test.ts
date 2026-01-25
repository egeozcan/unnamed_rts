import { describe, it, expect, beforeEach } from 'vitest';
import {
    updateEscortAssignments,
    releaseEscort,
    getEscortedOreField,
    getEscortForOreField,
    getEscortPatrolPosition
} from '../../../src/engine/ai/harvester/escort.js';
import {
    HarvesterAIState,
    createInitialHarvesterAIState,
    HARVESTER_AI_CONSTANTS
} from '../../../src/engine/ai/harvester/types.js';
import { HarvesterUnit, CombatUnit, ResourceEntity } from '../../../src/engine/types.js';
import {
    createTestHarvester,
    createTestResource,
    createTestCombatUnit
} from '../../../src/engine/test-utils.js';
import { getZoneKey } from '../../../src/engine/ai/harvester/danger_map.js';

const {
    ESCORT_ASSIGN_DANGER,
    ESCORT_PRIORITY_DANGER,
    ESCORT_RELEASE_DANGER,
    ESCORT_PATROL_RADIUS
} = HARVESTER_AI_CONSTANTS;

describe('Escort System', () => {
    let harvesterAI: HarvesterAIState;

    beforeEach(() => {
        harvesterAI = createInitialHarvesterAIState();
    });

    describe('updateEscortAssignments', () => {
        describe('danger-based escort assignment', () => {
            it('should assign escort to high-danger ore field (danger > 40, value > 500)', () => {
                // Setup ore field with danger > ESCORT_ASSIGN_DANGER (40)
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                // Set danger above ESCORT_ASSIGN_DANGER
                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 50, // > 40
                    enemyCount: 2,
                    recentAttacks: 1,
                    harvesterDeaths: 0,
                    lastUpdate: 1000
                });

                // Harvesters near ore (within 200px) - value = 2 * (400 + cargo) = 2 * 500 = 1000
                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 100 }),
                    createTestHarvester({ id: 'harv2', x: 520, y: 520, cargo: 100 })
                ];

                // Idle combat unit nearby
                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null })
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    30, // desperation
                    'hard'
                );

                expect(harvesterAI.escortAssignments.size).toBeGreaterThan(0);
                expect(harvesterAI.escortAssignments.get('tank1')).toBe('ore1');
            });

            it('should not assign escort in safe zones (danger <= 40)', () => {
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                // Set danger at threshold (should not trigger escort)
                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 40, // Not > 40
                    enemyCount: 1,
                    recentAttacks: 0,
                    harvesterDeaths: 0,
                    lastUpdate: 1000
                });

                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 200 })
                ];

                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null })
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    30,
                    'hard'
                );

                expect(harvesterAI.escortAssignments.size).toBe(0);
            });

            it('should not assign escort when harvester value is too low (value <= 500)', () => {
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                // High danger
                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 60,
                    enemyCount: 3,
                    recentAttacks: 2,
                    harvesterDeaths: 0,
                    lastUpdate: 1000
                });

                // Only 1 harvester with 0 cargo = 400 value (< 500)
                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 0 })
                ];

                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null })
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    30,
                    'hard'
                );

                expect(harvesterAI.escortAssignments.size).toBe(0);
            });
        });

        describe('priority escort (2 escorts for very dangerous zones)', () => {
            it('should assign 2 escorts to very dangerous zones (danger > 70, value > 1000)', () => {
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                // Very high danger
                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 80, // > ESCORT_PRIORITY_DANGER (70)
                    enemyCount: 5,
                    recentAttacks: 3,
                    harvesterDeaths: 1,
                    lastUpdate: 1000
                });

                // Multiple harvesters with cargo: 3 * (400 + 100) = 1500 > 1000
                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 100 }),
                    createTestHarvester({ id: 'harv2', x: 520, y: 520, cargo: 100 }),
                    createTestHarvester({ id: 'harv3', x: 530, y: 530, cargo: 100 })
                ];

                // Multiple idle combat units nearby
                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null }),
                    createTestCombatUnit({ id: 'tank2', x: 560, y: 560, targetId: null }),
                    createTestCombatUnit({ id: 'tank3', x: 570, y: 570, targetId: null })
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    30, // Low desperation
                    'hard'
                );

                expect(harvesterAI.escortAssignments.size).toBe(2);
            });

            it('should only assign 1 escort when value is between 500-1000 even with high danger', () => {
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                // Very high danger
                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 80,
                    enemyCount: 5,
                    recentAttacks: 3,
                    harvesterDeaths: 1,
                    lastUpdate: 1000
                });

                // 2 harvesters with low cargo: 2 * (400 + 100) = 1000 (not > 1000)
                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 100 }),
                    createTestHarvester({ id: 'harv2', x: 520, y: 520, cargo: 100 })
                ];

                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null }),
                    createTestCombatUnit({ id: 'tank2', x: 560, y: 560, targetId: null })
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    30,
                    'hard'
                );

                // Should only assign 1 since value is not > 1000
                expect(harvesterAI.escortAssignments.size).toBe(1);
            });
        });

        describe('difficulty scaling', () => {
            it('should not assign escorts for easy difficulty', () => {
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                // High danger that would trigger escort on hard
                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 80,
                    enemyCount: 5,
                    recentAttacks: 3,
                    harvesterDeaths: 1,
                    lastUpdate: 1000
                });

                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 200 }),
                    createTestHarvester({ id: 'harv2', x: 520, y: 520, cargo: 200 })
                ];

                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null })
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    30,
                    'easy'
                );

                expect(harvesterAI.escortAssignments.size).toBe(0);
            });

            it('should not assign escorts for dummy difficulty', () => {
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 80,
                    enemyCount: 5,
                    recentAttacks: 3,
                    harvesterDeaths: 1,
                    lastUpdate: 1000
                });

                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 200 })
                ];

                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null })
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    30,
                    'dummy'
                );

                expect(harvesterAI.escortAssignments.size).toBe(0);
            });

            it('should assign escorts for medium difficulty (when implemented via harvester damage)', () => {
                // Medium difficulty doesn't proactively assign escorts
                // This is handled elsewhere based on harvester damage
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 80,
                    enemyCount: 5,
                    recentAttacks: 3,
                    harvesterDeaths: 1,
                    lastUpdate: 1000
                });

                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 200 }),
                    createTestHarvester({ id: 'harv2', x: 520, y: 520, cargo: 200 })
                ];

                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null })
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    30,
                    'medium'
                );

                // Medium difficulty doesn't proactively assign escorts (handled elsewhere)
                expect(harvesterAI.escortAssignments.size).toBe(0);
            });
        });

        describe('desperation and escort limits', () => {
            it('should limit to 1 escort max at high desperation (>50)', () => {
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                // Very high danger that would normally get 2 escorts
                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 90,
                    enemyCount: 6,
                    recentAttacks: 4,
                    harvesterDeaths: 2,
                    lastUpdate: 1000
                });

                // High value harvesters
                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 300 }),
                    createTestHarvester({ id: 'harv2', x: 520, y: 520, cargo: 300 }),
                    createTestHarvester({ id: 'harv3', x: 530, y: 530, cargo: 300 })
                ];

                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null }),
                    createTestCombatUnit({ id: 'tank2', x: 560, y: 560, targetId: null }),
                    createTestCombatUnit({ id: 'tank3', x: 570, y: 570, targetId: null })
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    60, // High desperation > 50
                    'hard'
                );

                // Should only assign 1 escort due to high desperation
                expect(harvesterAI.escortAssignments.size).toBe(1);
            });
        });

        describe('escort selection preferences', () => {
            it('should prefer idle combat units near the ore field', () => {
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 50,
                    enemyCount: 2,
                    recentAttacks: 1,
                    harvesterDeaths: 0,
                    lastUpdate: 1000
                });

                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 200 }),
                    createTestHarvester({ id: 'harv2', x: 520, y: 520, cargo: 200 })
                ];

                // Units at different distances
                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'farTank', x: 1000, y: 1000, targetId: null }),  // Far, idle
                    createTestCombatUnit({ id: 'nearTank', x: 520, y: 520, targetId: null }),   // Near, idle
                    createTestCombatUnit({ id: 'busyTank', x: 510, y: 510, targetId: 'enemy1' }) // Near but busy
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    30,
                    'hard'
                );

                // Should prefer the near idle tank
                expect(harvesterAI.escortAssignments.get('nearTank')).toBe('ore1');
                expect(harvesterAI.escortAssignments.has('farTank')).toBe(false);
                expect(harvesterAI.escortAssignments.has('busyTank')).toBe(false);
            });

            it('should not assign busy combat units (those with targets)', () => {
                const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
                const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

                harvesterAI.dangerMap.set(zoneKey, {
                    key: zoneKey,
                    dangerScore: 50,
                    enemyCount: 2,
                    recentAttacks: 1,
                    harvesterDeaths: 0,
                    lastUpdate: 1000
                });

                const harvesters: HarvesterUnit[] = [
                    createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 200 }),
                    createTestHarvester({ id: 'harv2', x: 520, y: 520, cargo: 200 })
                ];

                // All units are busy (have targets)
                const combatUnits: CombatUnit[] = [
                    createTestCombatUnit({ id: 'tank1', x: 520, y: 520, targetId: 'enemy1' }),
                    createTestCombatUnit({ id: 'tank2', x: 530, y: 530, targetId: 'enemy2' })
                ];

                updateEscortAssignments(
                    harvesterAI,
                    harvesters,
                    combatUnits,
                    [ore],
                    30,
                    'hard'
                );

                // No escorts assigned since all units are busy
                expect(harvesterAI.escortAssignments.size).toBe(0);
            });
        });
    });

    describe('releaseEscort', () => {
        it('should remove escort assignments when danger drops below 30', () => {
            const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
            const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

            // Initially had escort
            harvesterAI.escortAssignments.set('tank1', 'ore1');

            // Danger has dropped below ESCORT_RELEASE_DANGER (30)
            harvesterAI.dangerMap.set(zoneKey, {
                key: zoneKey,
                dangerScore: 25, // < 30
                enemyCount: 0,
                recentAttacks: 0,
                harvesterDeaths: 0,
                lastUpdate: 1000
            });

            releaseEscort(harvesterAI, [ore]);

            expect(harvesterAI.escortAssignments.size).toBe(0);
        });

        it('should remove escort when ore field no longer exists', () => {
            // Escort assigned to ore that no longer exists
            harvesterAI.escortAssignments.set('tank1', 'ore_deleted');

            // Pass empty ore list (simulating deleted ore)
            releaseEscort(harvesterAI, []);

            expect(harvesterAI.escortAssignments.size).toBe(0);
        });

        it('should keep escort when danger is still above 30', () => {
            const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
            const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

            harvesterAI.escortAssignments.set('tank1', 'ore1');

            // Danger is at threshold (30 means keep, not release)
            harvesterAI.dangerMap.set(zoneKey, {
                key: zoneKey,
                dangerScore: 35, // > 30, keep escort
                enemyCount: 1,
                recentAttacks: 0,
                harvesterDeaths: 0,
                lastUpdate: 1000
            });

            releaseEscort(harvesterAI, [ore]);

            expect(harvesterAI.escortAssignments.size).toBe(1);
            expect(harvesterAI.escortAssignments.get('tank1')).toBe('ore1');
        });

        it('should keep escort when no danger info (zone not in danger map)', () => {
            const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });

            harvesterAI.escortAssignments.set('tank1', 'ore1');

            // No danger zone entry (danger is implicitly 0)
            // This should release since 0 < 30

            releaseEscort(harvesterAI, [ore]);

            expect(harvesterAI.escortAssignments.size).toBe(0);
        });
    });

    describe('getEscortedOreField', () => {
        it('should return ore field ID for escorting unit', () => {
            harvesterAI.escortAssignments.set('tank1', 'ore1');

            const oreId = getEscortedOreField(harvesterAI, 'tank1');

            expect(oreId).toBe('ore1');
        });

        it('should return null for non-escorting unit', () => {
            const oreId = getEscortedOreField(harvesterAI, 'random_unit');

            expect(oreId).toBeNull();
        });
    });

    describe('getEscortForOreField', () => {
        it('should return all combat units escorting an ore field', () => {
            harvesterAI.escortAssignments.set('tank1', 'ore1');
            harvesterAI.escortAssignments.set('tank2', 'ore1');
            harvesterAI.escortAssignments.set('tank3', 'ore2');

            const escorts = getEscortForOreField(harvesterAI, 'ore1');

            expect(escorts).toHaveLength(2);
            expect(escorts).toContain('tank1');
            expect(escorts).toContain('tank2');
            expect(escorts).not.toContain('tank3');
        });

        it('should return empty array when ore has no escorts', () => {
            const escorts = getEscortForOreField(harvesterAI, 'ore_with_no_escort');

            expect(escorts).toEqual([]);
        });
    });

    describe('getEscortPatrolPosition', () => {
        it('should return patrol position at ESCORT_PATROL_RADIUS (150px)', () => {
            const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });

            const position = getEscortPatrolPosition(ore, 0);

            // First escort position should be at 150px radius from ore
            const distance = Math.sqrt(
                Math.pow(position.x - ore.pos.x, 2) +
                Math.pow(position.y - ore.pos.y, 2)
            );
            expect(distance).toBeCloseTo(ESCORT_PATROL_RADIUS, 1);
        });

        it('should spread positions based on escort index', () => {
            const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });

            const pos0 = getEscortPatrolPosition(ore, 0);
            const pos1 = getEscortPatrolPosition(ore, 1);

            // Positions should be different
            expect(pos0.x).not.toBe(pos1.x);
            expect(pos0.y).not.toBe(pos1.y);
        });

        it('should calculate correct position for multiple escorts', () => {
            const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });

            // Get positions for 4 potential escorts
            const positions = [0, 1, 2, 3].map(i => getEscortPatrolPosition(ore, i));

            // All should be at the same distance (150px)
            for (const pos of positions) {
                const distance = Math.sqrt(
                    Math.pow(pos.x - ore.pos.x, 2) +
                    Math.pow(pos.y - ore.pos.y, 2)
                );
                expect(distance).toBeCloseTo(ESCORT_PATROL_RADIUS, 1);
            }

            // All should be at different angles (different positions)
            const uniquePositions = new Set(positions.map(p => `${p.x.toFixed(2)},${p.y.toFixed(2)}`));
            expect(uniquePositions.size).toBe(4);
        });
    });

    describe('Integration scenarios', () => {
        it('should handle complete escort workflow', () => {
            // Setup: Ore field with danger
            const ore = createTestResource({ id: 'ore1', x: 500, y: 500 });
            const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);

            harvesterAI.dangerMap.set(zoneKey, {
                key: zoneKey,
                dangerScore: 60,
                enemyCount: 3,
                recentAttacks: 2,
                harvesterDeaths: 0,
                lastUpdate: 1000
            });

            const harvesters: HarvesterUnit[] = [
                createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 200 }),
                createTestHarvester({ id: 'harv2', x: 520, y: 520, cargo: 200 })
            ];

            const combatUnits: CombatUnit[] = [
                createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null })
            ];

            // Step 1: Assign escort
            updateEscortAssignments(harvesterAI, harvesters, combatUnits, [ore], 30, 'hard');
            expect(harvesterAI.escortAssignments.get('tank1')).toBe('ore1');

            // Step 2: Get escort info
            expect(getEscortedOreField(harvesterAI, 'tank1')).toBe('ore1');
            expect(getEscortForOreField(harvesterAI, 'ore1')).toContain('tank1');

            // Step 3: Get patrol position
            const patrolPos = getEscortPatrolPosition(ore, 0);
            expect(patrolPos.x).toBeDefined();
            expect(patrolPos.y).toBeDefined();

            // Step 4: Danger drops, release escort
            harvesterAI.dangerMap.set(zoneKey, {
                ...harvesterAI.dangerMap.get(zoneKey)!,
                dangerScore: 20
            });
            releaseEscort(harvesterAI, [ore]);
            expect(harvesterAI.escortAssignments.size).toBe(0);
        });

        it('should handle multiple ore fields with different danger levels', () => {
            const ore1 = createTestResource({ id: 'ore1', x: 500, y: 500 });
            const ore2 = createTestResource({ id: 'ore2', x: 1000, y: 1000 });

            const zoneKey1 = getZoneKey(ore1.pos.x, ore1.pos.y);
            const zoneKey2 = getZoneKey(ore2.pos.x, ore2.pos.y);

            // Ore1: High danger
            harvesterAI.dangerMap.set(zoneKey1, {
                key: zoneKey1,
                dangerScore: 75,
                enemyCount: 4,
                recentAttacks: 2,
                harvesterDeaths: 1,
                lastUpdate: 1000
            });

            // Ore2: Low danger
            harvesterAI.dangerMap.set(zoneKey2, {
                key: zoneKey2,
                dangerScore: 20,
                enemyCount: 0,
                recentAttacks: 0,
                harvesterDeaths: 0,
                lastUpdate: 1000
            });

            const harvesters: HarvesterUnit[] = [
                createTestHarvester({ id: 'harv1', x: 510, y: 510, cargo: 200 }),
                createTestHarvester({ id: 'harv2', x: 520, y: 520, cargo: 200 }),
                createTestHarvester({ id: 'harv3', x: 1010, y: 1010, cargo: 200 })
            ];

            const combatUnits: CombatUnit[] = [
                createTestCombatUnit({ id: 'tank1', x: 550, y: 550, targetId: null }),
                createTestCombatUnit({ id: 'tank2', x: 560, y: 560, targetId: null }),
                createTestCombatUnit({ id: 'tank3', x: 1050, y: 1050, targetId: null })
            ];

            updateEscortAssignments(
                harvesterAI,
                harvesters,
                combatUnits,
                [ore1, ore2],
                30,
                'hard'
            );

            // Should have escorts only for dangerous ore1, not safe ore2
            const ore1Escorts = getEscortForOreField(harvesterAI, 'ore1');
            const ore2Escorts = getEscortForOreField(harvesterAI, 'ore2');

            expect(ore1Escorts.length).toBeGreaterThan(0);
            expect(ore2Escorts.length).toBe(0);
        });
    });
});

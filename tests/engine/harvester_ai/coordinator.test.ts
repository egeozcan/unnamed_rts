import { describe, it, expect, beforeEach } from 'vitest';
import {
    assignHarvesterRoles,
    getHarvesterRole,
    distributeOreFields,
    manageRefineryQueue,
    getRoleMaxDanger
} from '../../../src/engine/ai/harvester/coordinator.js';
import {
    HarvesterAIState,
    HarvesterRole,
    createInitialHarvesterAIState,
    HARVESTER_AI_CONSTANTS
} from '../../../src/engine/ai/harvester/types.js';
import { HarvesterUnit, BuildingEntity, ResourceEntity } from '../../../src/engine/types.js';
import {
    createTestHarvester,
    createTestResource,
    createTestBuilding
} from '../../../src/engine/test-utils.js';

const { MAX_HARVESTERS_PER_ORE, MAX_HARVESTERS_PER_REFINERY } = HARVESTER_AI_CONSTANTS;

describe('Harvester Coordinator', () => {
    let harvesterAI: HarvesterAIState;

    beforeEach(() => {
        harvesterAI = createInitialHarvesterAIState();
    });

    describe('assignHarvesterRoles', () => {
        describe('role assignment based on harvester state', () => {
            it('should assign "safe" role when harvester HP is below 50%', () => {
                const harvester = createTestHarvester({
                    id: 'harv1',
                    hp: 400,  // 40% HP (maxHp is 1000)
                    cargo: 0
                });

                assignHarvesterRoles(harvesterAI, [harvester], 30, 'hard');

                expect(harvesterAI.harvesterRoles.get('harv1')).toBe('safe');
            });

            it('should assign "safe" role when cargo exceeds 400', () => {
                const harvester = createTestHarvester({
                    id: 'harv1',
                    hp: 1000,  // Full HP
                    cargo: 450  // Above 400 threshold
                });

                assignHarvesterRoles(harvesterAI, [harvester], 30, 'hard');

                expect(harvesterAI.harvesterRoles.get('harv1')).toBe('safe');
            });

            it('should assign "risk-taker" role when desperate (desperation > 70) and cargo < 100', () => {
                const harvester = createTestHarvester({
                    id: 'harv1',
                    hp: 1000,
                    cargo: 50  // Below 100
                });

                assignHarvesterRoles(harvesterAI, [harvester], 80, 'hard');  // High desperation

                expect(harvesterAI.harvesterRoles.get('harv1')).toBe('risk-taker');
            });

            it('should assign "opportunist" role when desperation is between 40-70', () => {
                const harvester = createTestHarvester({
                    id: 'harv1',
                    hp: 1000,
                    cargo: 200  // Above 100 to avoid risk-taker
                });

                assignHarvesterRoles(harvesterAI, [harvester], 55, 'hard');  // Medium desperation

                expect(harvesterAI.harvesterRoles.get('harv1')).toBe('opportunist');
            });

            it('should assign "standard" role for healthy harvester with normal conditions', () => {
                const harvester = createTestHarvester({
                    id: 'harv1',
                    hp: 1000,
                    cargo: 200
                });

                assignHarvesterRoles(harvesterAI, [harvester], 30, 'hard');  // Low desperation

                expect(harvesterAI.harvesterRoles.get('harv1')).toBe('standard');
            });

            it('should prioritize "safe" role over "risk-taker" when both conditions apply', () => {
                // Low HP should trigger safe, even if desperate with low cargo
                const harvester = createTestHarvester({
                    id: 'harv1',
                    hp: 400,  // 40% HP - safe condition
                    cargo: 50  // Low cargo - would be risk-taker if not low HP
                });

                assignHarvesterRoles(harvesterAI, [harvester], 80, 'hard');  // High desperation

                expect(harvesterAI.harvesterRoles.get('harv1')).toBe('safe');
            });
        });

        describe('difficulty scaling', () => {
            it('should not assign roles for easy difficulty', () => {
                const harvester = createTestHarvester({
                    id: 'harv1',
                    hp: 400,  // Would be "safe" on hard
                    cargo: 0
                });

                assignHarvesterRoles(harvesterAI, [harvester], 30, 'easy');

                expect(harvesterAI.harvesterRoles.size).toBe(0);
            });

            it('should not assign roles for dummy difficulty', () => {
                const harvester = createTestHarvester({
                    id: 'harv1',
                    hp: 400,
                    cargo: 0
                });

                assignHarvesterRoles(harvesterAI, [harvester], 30, 'dummy');

                expect(harvesterAI.harvesterRoles.size).toBe(0);
            });

            it('should assign roles for medium difficulty', () => {
                const harvester = createTestHarvester({
                    id: 'harv1',
                    hp: 400,
                    cargo: 0
                });

                assignHarvesterRoles(harvesterAI, [harvester], 30, 'medium');

                expect(harvesterAI.harvesterRoles.get('harv1')).toBe('safe');
            });
        });

        describe('multiple harvesters', () => {
            it('should assign appropriate roles to multiple harvesters', () => {
                const harvesters = [
                    createTestHarvester({ id: 'harv1', hp: 400, cargo: 0 }),   // safe (low HP)
                    createTestHarvester({ id: 'harv2', hp: 1000, cargo: 450 }), // safe (high cargo)
                    createTestHarvester({ id: 'harv3', hp: 1000, cargo: 200 })  // standard
                ];

                assignHarvesterRoles(harvesterAI, harvesters, 30, 'hard');

                expect(harvesterAI.harvesterRoles.get('harv1')).toBe('safe');
                expect(harvesterAI.harvesterRoles.get('harv2')).toBe('safe');
                expect(harvesterAI.harvesterRoles.get('harv3')).toBe('standard');
            });

            it('should update existing roles when called again', () => {
                const harvester = createTestHarvester({ id: 'harv1', hp: 1000, cargo: 200 });

                // First assignment - standard
                assignHarvesterRoles(harvesterAI, [harvester], 30, 'hard');
                expect(harvesterAI.harvesterRoles.get('harv1')).toBe('standard');

                // Update harvester state to be damaged
                const damagedHarvester = createTestHarvester({ id: 'harv1', hp: 400, cargo: 200 });

                // Second assignment - should update to safe
                assignHarvesterRoles(harvesterAI, [damagedHarvester], 30, 'hard');
                expect(harvesterAI.harvesterRoles.get('harv1')).toBe('safe');
            });
        });
    });

    describe('getHarvesterRole', () => {
        it('should return the assigned role', () => {
            harvesterAI.harvesterRoles.set('harv1', 'opportunist');

            expect(getHarvesterRole(harvesterAI, 'harv1')).toBe('opportunist');
        });

        it('should return "standard" as default for unknown harvester', () => {
            expect(getHarvesterRole(harvesterAI, 'unknown_harvester')).toBe('standard');
        });
    });

    describe('distributeOreFields', () => {
        let oreFields: ResourceEntity[];
        let harvesters: HarvesterUnit[];

        beforeEach(() => {
            oreFields = [
                createTestResource({ id: 'ore1', x: 100, y: 100 }),
                createTestResource({ id: 'ore2', x: 200, y: 200 }),
                createTestResource({ id: 'ore3', x: 300, y: 300 })
            ];
            harvesters = [
                createTestHarvester({ id: 'harv1', x: 110, y: 110 }),
                createTestHarvester({ id: 'harv2', x: 210, y: 210 }),
                createTestHarvester({ id: 'harv3', x: 310, y: 310 }),
                createTestHarvester({ id: 'harv4', x: 120, y: 120 })
            ];
        });

        it('should limit harvesters per ore to MAX_HARVESTERS_PER_ORE (3)', () => {
            // 5 harvesters, only 1 ore field
            const manyHarvesters = [
                createTestHarvester({ id: 'harv1' }),
                createTestHarvester({ id: 'harv2' }),
                createTestHarvester({ id: 'harv3' }),
                createTestHarvester({ id: 'harv4' }),
                createTestHarvester({ id: 'harv5' })
            ];
            const singleOre = [createTestResource({ id: 'ore1' })];

            const distribution = distributeOreFields(harvesterAI, manyHarvesters, singleOre, 'hard');

            const harvestersAssigned = distribution.get('ore1') ?? [];
            expect(harvestersAssigned.length).toBeLessThanOrEqual(MAX_HARVESTERS_PER_ORE);
        });

        it('should skip harvesters with baseTargetId (returning to base)', () => {
            const harvestersWithReturning = [
                createTestHarvester({ id: 'harv1', baseTargetId: 'refinery1' }),  // Returning - skip
                createTestHarvester({ id: 'harv2' }),  // Available
                createTestHarvester({ id: 'harv3' })   // Available
            ];
            const singleOre = [createTestResource({ id: 'ore1' })];

            const distribution = distributeOreFields(harvesterAI, harvestersWithReturning, singleOre, 'hard');

            const harvestersAssigned = distribution.get('ore1') ?? [];
            expect(harvestersAssigned).not.toContain('harv1');
        });

        it('should return empty map for easy difficulty', () => {
            const distribution = distributeOreFields(harvesterAI, harvesters, oreFields, 'easy');

            expect(distribution.size).toBe(0);
        });

        it('should return empty map for dummy difficulty', () => {
            const distribution = distributeOreFields(harvesterAI, harvesters, oreFields, 'dummy');

            expect(distribution.size).toBe(0);
        });

        it('should distribute harvesters across multiple ore fields', () => {
            // 6 harvesters, 3 ore fields - should spread out
            const sixHarvesters = [
                createTestHarvester({ id: 'harv1', x: 100, y: 100 }),
                createTestHarvester({ id: 'harv2', x: 100, y: 100 }),
                createTestHarvester({ id: 'harv3', x: 200, y: 200 }),
                createTestHarvester({ id: 'harv4', x: 200, y: 200 }),
                createTestHarvester({ id: 'harv5', x: 300, y: 300 }),
                createTestHarvester({ id: 'harv6', x: 300, y: 300 })
            ];

            const distribution = distributeOreFields(harvesterAI, sixHarvesters, oreFields, 'hard');

            // Each ore should have some harvesters assigned
            let totalAssigned = 0;
            for (const [_, harvesters] of distribution) {
                totalAssigned += harvesters.length;
            }
            // Should have distributed harvesters across ore fields
            expect(totalAssigned).toBeGreaterThan(0);
        });

        it('should update harvesterAI.oreFieldClaims', () => {
            distributeOreFields(harvesterAI, harvesters, oreFields, 'hard');

            // Check that oreFieldClaims was updated
            expect(harvesterAI.oreFieldClaims.size).toBeGreaterThan(0);
        });
    });

    describe('manageRefineryQueue', () => {
        let harvesters: HarvesterUnit[];
        let refineries: BuildingEntity[];

        beforeEach(() => {
            refineries = [
                createTestBuilding({ id: 'ref1', key: 'refinery', x: 100, y: 100 }),
                createTestBuilding({ id: 'ref2', key: 'refinery', x: 500, y: 500 })
            ];
        });

        it('should return empty array for easy difficulty', () => {
            harvesters = [
                createTestHarvester({ id: 'harv1', baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv2', baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv3', baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv4', baseTargetId: 'ref1' })
            ];

            const redirects = manageRefineryQueue(harvesterAI, harvesters, refineries, 'easy');

            expect(redirects).toEqual([]);
        });

        it('should return empty array for dummy difficulty', () => {
            harvesters = [
                createTestHarvester({ id: 'harv1', baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv2', baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv3', baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv4', baseTargetId: 'ref1' })
            ];

            const redirects = manageRefineryQueue(harvesterAI, harvesters, refineries, 'dummy');

            expect(redirects).toEqual([]);
        });

        it('should redirect excess harvesters for medium difficulty (threshold 3)', () => {
            // 4 harvesters going to same refinery, threshold is 3 for medium
            harvesters = [
                createTestHarvester({ id: 'harv1', x: 110, y: 110, baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv2', x: 120, y: 120, baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv3', x: 130, y: 130, baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv4', x: 140, y: 140, baseTargetId: 'ref1' })  // This one exceeds threshold
            ];

            const redirects = manageRefineryQueue(harvesterAI, harvesters, refineries, 'medium');

            // Should redirect 1 harvester (excess over 3)
            expect(redirects.length).toBeGreaterThanOrEqual(1);
        });

        it('should redirect excess harvesters for hard difficulty (threshold 2)', () => {
            // 3 harvesters going to same refinery, threshold is 2 for hard
            harvesters = [
                createTestHarvester({ id: 'harv1', x: 110, y: 110, baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv2', x: 120, y: 120, baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv3', x: 130, y: 130, baseTargetId: 'ref1' })  // Exceeds threshold
            ];

            const redirects = manageRefineryQueue(harvesterAI, harvesters, refineries, 'hard');

            // Should redirect 1 harvester (excess over 2)
            expect(redirects.length).toBe(1);
            expect(redirects[0].newRefineryId).toBe('ref2');  // Redirect to less busy refinery
        });

        it('should not redirect when all refineries are within threshold', () => {
            // Each refinery has 2 harvesters (at threshold for hard)
            harvesters = [
                createTestHarvester({ id: 'harv1', baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv2', baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv3', baseTargetId: 'ref2' }),
                createTestHarvester({ id: 'harv4', baseTargetId: 'ref2' })
            ];

            const redirects = manageRefineryQueue(harvesterAI, harvesters, refineries, 'hard');

            expect(redirects.length).toBe(0);
        });

        it('should update harvesterAI.refineryQueue', () => {
            harvesters = [
                createTestHarvester({ id: 'harv1', baseTargetId: 'ref1' }),
                createTestHarvester({ id: 'harv2', baseTargetId: 'ref2' })
            ];

            manageRefineryQueue(harvesterAI, harvesters, refineries, 'hard');

            // Should have updated refineryQueue
            expect(harvesterAI.refineryQueue.size).toBeGreaterThan(0);
        });
    });

    describe('getRoleMaxDanger', () => {
        it('should return 30 for "safe" role regardless of desperation', () => {
            expect(getRoleMaxDanger('safe', 0)).toBe(30);
            expect(getRoleMaxDanger('safe', 50)).toBe(30);
            expect(getRoleMaxDanger('safe', 100)).toBe(30);
        });

        it('should return 50 + desperation/2 for "standard" role', () => {
            expect(getRoleMaxDanger('standard', 0)).toBe(50);
            expect(getRoleMaxDanger('standard', 20)).toBe(60);
            expect(getRoleMaxDanger('standard', 100)).toBe(100);
        });

        it('should return 70 for "opportunist" role regardless of desperation', () => {
            expect(getRoleMaxDanger('opportunist', 0)).toBe(70);
            expect(getRoleMaxDanger('opportunist', 50)).toBe(70);
            expect(getRoleMaxDanger('opportunist', 100)).toBe(70);
        });

        it('should return 100 for "risk-taker" role regardless of desperation', () => {
            expect(getRoleMaxDanger('risk-taker', 0)).toBe(100);
            expect(getRoleMaxDanger('risk-taker', 50)).toBe(100);
            expect(getRoleMaxDanger('risk-taker', 100)).toBe(100);
        });
    });

    describe('Integration scenarios', () => {
        it('should handle complete fleet management workflow', () => {
            // Setup: Multiple harvesters with different states
            const harvesters = [
                createTestHarvester({ id: 'damaged', hp: 400, cargo: 100 }),     // Should be safe
                createTestHarvester({ id: 'loaded', hp: 1000, cargo: 500 }),     // Should be safe
                createTestHarvester({ id: 'returning', hp: 1000, cargo: 100, baseTargetId: 'ref1' }),  // Returning
                createTestHarvester({ id: 'free1', hp: 1000, cargo: 100, x: 100, y: 100 }),      // Available
                createTestHarvester({ id: 'free2', hp: 1000, cargo: 100, x: 200, y: 200 })       // Available
            ];

            const oreFields = [
                createTestResource({ id: 'ore1', x: 100, y: 100 }),
                createTestResource({ id: 'ore2', x: 200, y: 200 })
            ];

            const refineries = [
                createTestBuilding({ id: 'ref1', key: 'refinery', x: 50, y: 50 }),
                createTestBuilding({ id: 'ref2', key: 'refinery', x: 300, y: 300 })
            ];

            // Step 1: Assign roles
            assignHarvesterRoles(harvesterAI, harvesters, 30, 'hard');
            expect(harvesterAI.harvesterRoles.get('damaged')).toBe('safe');
            expect(harvesterAI.harvesterRoles.get('loaded')).toBe('safe');
            expect(harvesterAI.harvesterRoles.get('free1')).toBe('standard');

            // Step 2: Distribute ore fields
            const oreDistribution = distributeOreFields(harvesterAI, harvesters, oreFields, 'hard');
            // Returning harvester should not be assigned
            for (const [_, assigned] of oreDistribution) {
                expect(assigned).not.toContain('returning');
            }

            // Step 3: Manage refinery queue
            const redirects = manageRefineryQueue(harvesterAI, harvesters, refineries, 'hard');
            // With only 1 harvester returning to ref1, no redirects needed
            expect(redirects.length).toBe(0);
        });

        it('should handle high desperation scenario', () => {
            const harvesters = [
                createTestHarvester({ id: 'harv1', hp: 1000, cargo: 50 }),   // Low cargo in desperation
                createTestHarvester({ id: 'harv2', hp: 1000, cargo: 200 })   // Medium cargo
            ];

            // High desperation (80) should make harv1 a risk-taker
            // harv2 with cargo 200 at desperation 80 (not 40-70) is 'standard' per spec
            assignHarvesterRoles(harvesterAI, harvesters, 80, 'hard');

            expect(harvesterAI.harvesterRoles.get('harv1')).toBe('risk-taker');
            // Desperation 80 is outside 40-70 range, so harv2 is standard (not opportunist)
            expect(harvesterAI.harvesterRoles.get('harv2')).toBe('standard');

            // Check max danger for each role
            const harv1Danger = getRoleMaxDanger(getHarvesterRole(harvesterAI, 'harv1'), 80);
            const harv2Danger = getRoleMaxDanger(getHarvesterRole(harvesterAI, 'harv2'), 80);

            expect(harv1Danger).toBe(100);  // risk-taker
            // standard role: 50 + 80/2 = 90
            expect(harv2Danger).toBe(90);   // standard with high desperation
        });
    });
});

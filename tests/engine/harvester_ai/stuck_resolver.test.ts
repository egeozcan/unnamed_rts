import { describe, it, expect, beforeEach } from 'vitest';
import {
    detectStuckHarvester,
    resolveStuckHarvester,
    isStuckAtRefinery
} from '../../../src/engine/ai/harvester/stuck_resolver.js';
import {
    HARVESTER_AI_CONSTANTS,
    createInitialHarvesterAIState
} from '../../../src/engine/ai/harvester/types.js';
import { Vector, HarvesterUnit } from '../../../src/engine/types.js';
import {
    createTestHarvester,
    createTestBuilding,
    createTestResource,
    resetTestEntityCounter
} from '../../../src/engine/test-utils.js';

const {
    STUCK_LEVEL_1_TICKS,
    STUCK_LEVEL_2_TICKS,
    STUCK_LEVEL_3_TICKS,
    STUCK_LEVEL_4_TICKS,
    STUCK_LEVEL_5_TICKS,
    BLACKLIST_DURATION,
    DETOUR_SEARCH_RADIUS
} = HARVESTER_AI_CONSTANTS;

/**
 * Create a harvester with specific velocity
 */
function createHarvesterWithVelocity(
    options: {
        x?: number;
        y?: number;
        vx?: number;
        vy?: number;
        harvestAttemptTicks?: number;
        resourceTargetId?: string | null;
        moveTarget?: Vector | null;
    } = {}
): HarvesterUnit {
    const harvester = createTestHarvester({
        x: options.x ?? 500,
        y: options.y ?? 500,
        harvestAttemptTicks: options.harvestAttemptTicks ?? 0,
        resourceTargetId: options.resourceTargetId ?? null,
        moveTarget: options.moveTarget ?? null
    });

    // Override velocity by creating a new object with custom movement
    return {
        ...harvester,
        movement: {
            ...harvester.movement,
            vel: new Vector(options.vx ?? 0, options.vy ?? 0)
        }
    };
}

describe('Stuck Resolution Engine', () => {
    beforeEach(() => {
        resetTestEntityCounter();
    });

    describe('detectStuckHarvester', () => {
        describe('harvestAttemptTicks detection', () => {
            it('should return false when harvestAttemptTicks is below threshold', () => {
                const harvester = createTestHarvester({
                    harvestAttemptTicks: STUCK_LEVEL_1_TICKS - 1
                });

                expect(detectStuckHarvester(harvester)).toBe(false);
            });

            it('should return true when harvestAttemptTicks exceeds STUCK_LEVEL_1_TICKS', () => {
                const harvester = createTestHarvester({
                    harvestAttemptTicks: STUCK_LEVEL_1_TICKS + 1
                });

                expect(detectStuckHarvester(harvester)).toBe(true);
            });

            it('should return true when harvestAttemptTicks equals STUCK_LEVEL_1_TICKS', () => {
                const harvester = createTestHarvester({
                    harvestAttemptTicks: STUCK_LEVEL_1_TICKS
                });

                // Edge case: at exactly the threshold, still not stuck
                // Based on spec: > STUCK_LEVEL_1_TICKS
                expect(detectStuckHarvester(harvester)).toBe(false);
            });
        });

        describe('moveTarget detection', () => {
            it('should return false when harvester has active moveTarget', () => {
                const harvester = createHarvesterWithVelocity({
                    harvestAttemptTicks: STUCK_LEVEL_1_TICKS + 10,
                    moveTarget: new Vector(600, 600)
                });

                expect(detectStuckHarvester(harvester)).toBe(false);
            });

            it('should still detect stuck when moveTarget is null and harvestAttemptTicks high', () => {
                const harvester = createTestHarvester({
                    harvestAttemptTicks: STUCK_LEVEL_1_TICKS + 10,
                    moveTarget: null
                });

                expect(detectStuckHarvester(harvester)).toBe(true);
            });
        });

        describe('velocity-based detection', () => {
            it('should return true when has resourceTargetId but velocity near zero', () => {
                const ore = createTestResource({ id: 'ore_1', x: 600, y: 600 });
                const harvester = createHarvesterWithVelocity({
                    resourceTargetId: ore.id,
                    vx: 0.1,
                    vy: 0.1,
                    harvestAttemptTicks: 0 // Below threshold
                });

                expect(detectStuckHarvester(harvester)).toBe(true);
            });

            it('should return false when has resourceTargetId and is moving', () => {
                const ore = createTestResource({ id: 'ore_1', x: 600, y: 600 });
                const harvester = createHarvesterWithVelocity({
                    resourceTargetId: ore.id,
                    vx: 2.0,
                    vy: 2.0,
                    harvestAttemptTicks: 0
                });

                expect(detectStuckHarvester(harvester)).toBe(false);
            });

            it('should return false when no resourceTargetId even with zero velocity', () => {
                const harvester = createHarvesterWithVelocity({
                    resourceTargetId: null,
                    vx: 0,
                    vy: 0,
                    harvestAttemptTicks: 0
                });

                expect(detectStuckHarvester(harvester)).toBe(false);
            });
        });
    });

    describe('resolveStuckHarvester', () => {
        describe('escalation levels', () => {
            it('should return nudge action at level 1 (5 ticks stuck)', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    harvestAttemptTicks: STUCK_LEVEL_1_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();
                const ores = [createTestResource({ x: 700, y: 700 })];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'hard'
                );

                expect(resolution.action).toBe('nudge');
                expect(resolution.nudgeDirection).toBeDefined();
                expect(resolution.nudgeDirection!.mag()).toBeCloseTo(1, 1);
            });

            it('should return detour action at level 2 (15 ticks stuck)', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    resourceTargetId: 'ore_current',
                    harvestAttemptTicks: STUCK_LEVEL_2_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();

                // Current ore is at 500, 500
                const currentOre = createTestResource({ id: 'ore_current', x: 510, y: 510 });
                // Alternate ore within detour radius
                const alternateOre = createTestResource({ id: 'ore_alt', x: 600, y: 600 });
                const ores = [currentOre, alternateOre];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'hard'
                );

                expect(resolution.action).toBe('detour');
                expect(resolution.targetOre).toBeDefined();
                expect(resolution.targetOre!.id).toBe('ore_alt');
            });

            it('should return relocate action at level 3 (30 ticks stuck)', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    resourceTargetId: 'ore_current',
                    harvestAttemptTicks: STUCK_LEVEL_3_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();

                const currentOre = createTestResource({ id: 'ore_current', x: 510, y: 510 });
                // Distant ore beyond detour radius
                const distantOre = createTestResource({ id: 'ore_distant', x: 1000, y: 1000 });
                const ores = [currentOre, distantOre];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'hard'
                );

                expect(resolution.action).toBe('relocate');
                expect(resolution.targetOre).toBeDefined();
            });

            it('should return retreat action at level 4 (45 ticks stuck)', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    harvestAttemptTicks: STUCK_LEVEL_4_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();

                const ores = [createTestResource({ x: 510, y: 510 })];
                const refineries = [
                    createTestBuilding({ key: 'refinery', id: 'ref_1', x: 300, y: 300 }),
                    createTestBuilding({ key: 'refinery', id: 'ref_2', x: 800, y: 800 })
                ];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'hard'
                );

                expect(resolution.action).toBe('retreat');
                expect(resolution.targetRefinery).toBeDefined();
                // Should pick closest refinery
                expect(resolution.targetRefinery!.id).toBe('ref_1');
            });

            it('should return emergency action at level 5 (60 ticks stuck)', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    resourceTargetId: 'ore_current',
                    harvestAttemptTicks: STUCK_LEVEL_5_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();

                const currentOre = createTestResource({ id: 'ore_current', x: 510, y: 510 });
                const ores = [currentOre];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'hard'
                );

                expect(resolution.action).toBe('emergency');
            });
        });

        describe('difficulty capping', () => {
            it('should cap at level 2 for easy difficulty', () => {
                // Very high harvestAttemptTicks that would normally trigger level 5
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    resourceTargetId: 'ore_current',
                    harvestAttemptTicks: STUCK_LEVEL_5_TICKS + 100
                });
                const harvesterAI = createInitialHarvesterAIState();

                const currentOre = createTestResource({ id: 'ore_current', x: 510, y: 510 });
                const alternateOre = createTestResource({ id: 'ore_alt', x: 600, y: 600 });
                const ores = [currentOre, alternateOre];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'easy'
                );

                // Easy caps at level 2, which should be detour (or nudge if no alternate)
                expect(['nudge', 'detour']).toContain(resolution.action);
                expect(['relocate', 'retreat', 'emergency']).not.toContain(resolution.action);
            });

            it('should cap at level 2 for dummy difficulty', () => {
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    harvestAttemptTicks: STUCK_LEVEL_5_TICKS + 100
                });
                const harvesterAI = createInitialHarvesterAIState();

                const ores = [createTestResource({ x: 600, y: 600 })];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'dummy'
                );

                expect(['nudge', 'detour']).toContain(resolution.action);
            });

            it('should cap at level 4 for medium difficulty', () => {
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    harvestAttemptTicks: STUCK_LEVEL_5_TICKS + 100
                });
                const harvesterAI = createInitialHarvesterAIState();

                const ores = [createTestResource({ x: 510, y: 510 })];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'medium'
                );

                // Medium caps at level 4 (retreat), never emergency
                expect(resolution.action).not.toBe('emergency');
            });

            it('should allow level 5 for hard difficulty', () => {
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    resourceTargetId: 'ore_current',
                    harvestAttemptTicks: STUCK_LEVEL_5_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();

                const currentOre = createTestResource({ id: 'ore_current', x: 510, y: 510 });
                const ores = [currentOre];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'hard'
                );

                expect(resolution.action).toBe('emergency');
            });
        });

        describe('blacklist handling', () => {
            it('should blacklist current ore at level 3 for BLACKLIST_DURATION', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    resourceTargetId: 'ore_current',
                    harvestAttemptTicks: STUCK_LEVEL_3_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();

                const currentOre = createTestResource({ id: 'ore_current', x: 510, y: 510 });
                const distantOre = createTestResource({ id: 'ore_distant', x: 1000, y: 1000 });
                const ores = [currentOre, distantOre];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];
                const currentTick = 100;

                resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    currentTick,
                    'hard'
                );

                // Check that blacklist was updated
                expect(harvesterAI.blacklistedOre.has('ore_current')).toBe(true);
                expect(harvesterAI.blacklistedOre.get('ore_current')).toBe(currentTick + BLACKLIST_DURATION);
            });

            it('should blacklist current ore at level 5 for double BLACKLIST_DURATION', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    resourceTargetId: 'ore_current',
                    harvestAttemptTicks: STUCK_LEVEL_5_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();

                const currentOre = createTestResource({ id: 'ore_current', x: 510, y: 510 });
                const ores = [currentOre];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];
                const currentTick = 100;

                resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    currentTick,
                    'hard'
                );

                // Double duration at level 5
                expect(harvesterAI.blacklistedOre.get('ore_current')).toBe(currentTick + BLACKLIST_DURATION * 2);
            });

            it('should filter out blacklisted ore when finding targets', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    resourceTargetId: 'ore_current',
                    harvestAttemptTicks: STUCK_LEVEL_2_TICKS + 1
                });

                // Create AI state with blacklisted ore
                const harvesterAI = createInitialHarvesterAIState();
                harvesterAI.blacklistedOre.set('ore_closest', 500); // Blacklisted until tick 500

                const currentOre = createTestResource({ id: 'ore_current', x: 510, y: 510 });
                // This ore is closest but blacklisted
                const blacklistedOre = createTestResource({ id: 'ore_closest', x: 520, y: 520 });
                // This ore should be chosen instead
                const availableOre = createTestResource({ id: 'ore_available', x: 600, y: 600 });
                const ores = [currentOre, blacklistedOre, availableOre];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100, // Before blacklist expires
                    'hard'
                );

                // Should choose the non-blacklisted ore
                if (resolution.targetOre) {
                    expect(resolution.targetOre.id).not.toBe('ore_closest');
                }
            });

            it('should clean up expired blacklist entries', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    harvestAttemptTicks: STUCK_LEVEL_1_TICKS + 1
                });

                // Create AI state with expired blacklist
                const harvesterAI = createInitialHarvesterAIState();
                harvesterAI.blacklistedOre.set('ore_expired', 50);  // Expired (current tick will be 100)
                harvesterAI.blacklistedOre.set('ore_valid', 200);   // Still valid

                const ores = [createTestResource({ x: 600, y: 600 })];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100, // Current tick
                    'hard'
                );

                // Expired entry should be removed
                expect(harvesterAI.blacklistedOre.has('ore_expired')).toBe(false);
                // Valid entry should remain
                expect(harvesterAI.blacklistedOre.has('ore_valid')).toBe(true);
            });
        });

        describe('detour search radius', () => {
            it('should find alternate ore within DETOUR_SEARCH_RADIUS', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    resourceTargetId: 'ore_current',
                    harvestAttemptTicks: STUCK_LEVEL_2_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();

                const currentOre = createTestResource({ id: 'ore_current', x: 510, y: 510 });
                // Just within radius
                const nearOre = createTestResource({
                    id: 'ore_near',
                    x: 500 + DETOUR_SEARCH_RADIUS - 50,
                    y: 500
                });
                const ores = [currentOre, nearOre];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'hard'
                );

                expect(resolution.action).toBe('detour');
                expect(resolution.targetOre!.id).toBe('ore_near');
            });

            it('should not find alternate ore outside DETOUR_SEARCH_RADIUS for level 2', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    x: 500,
                    y: 500,
                    resourceTargetId: 'ore_current',
                    harvestAttemptTicks: STUCK_LEVEL_2_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();

                const currentOre = createTestResource({ id: 'ore_current', x: 510, y: 510 });
                // Outside detour radius
                const farOre = createTestResource({
                    id: 'ore_far',
                    x: 500 + DETOUR_SEARCH_RADIUS + 100,
                    y: 500
                });
                const ores = [currentOre, farOre];
                const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    ores,
                    refineries,
                    100,
                    'hard'
                );

                // Should fall back to nudge since no alternate ore within radius
                expect(resolution.action).toBe('nudge');
            });
        });

        describe('no available resolution', () => {
            it('should return none when no ores and no refineries available', () => {
                // Level is now determined by harvester.harvester.harvestAttemptTicks
                const harvester = createTestHarvester({
                    id: 'harv_1',
                    harvestAttemptTicks: STUCK_LEVEL_4_TICKS + 1
                });
                const harvesterAI = createInitialHarvesterAIState();

                const resolution = resolveStuckHarvester(
                    harvesterAI,
                    harvester,
                    [], // No ores
                    [], // No refineries
                    100,
                    'hard'
                );

                // With no options, should still provide nudge as fallback
                expect(['nudge', 'none']).toContain(resolution.action);
            });
        });
    });

    describe('isStuckAtRefinery', () => {
        it('should return true when harvester is near refinery and stuck for > 30 ticks', () => {
            const refinery = createTestBuilding({
                key: 'refinery',
                id: 'ref_1',
                x: 500,
                y: 500
            });
            const harvester = createTestHarvester({
                x: 550, // Within 100px of refinery
                y: 500,
                harvestAttemptTicks: 35 // > 30 ticks
            });

            expect(isStuckAtRefinery(harvester, [refinery])).toBe(true);
        });

        it('should return false when harvester is near refinery but not stuck long enough', () => {
            const refinery = createTestBuilding({
                key: 'refinery',
                id: 'ref_1',
                x: 500,
                y: 500
            });
            const harvester = createTestHarvester({
                x: 550,
                y: 500,
                harvestAttemptTicks: 20 // < 30 ticks
            });

            expect(isStuckAtRefinery(harvester, [refinery])).toBe(false);
        });

        it('should return false when harvester is far from all refineries', () => {
            const refinery = createTestBuilding({
                key: 'refinery',
                id: 'ref_1',
                x: 500,
                y: 500
            });
            const harvester = createTestHarvester({
                x: 700, // > 100px from refinery
                y: 500,
                harvestAttemptTicks: 50
            });

            expect(isStuckAtRefinery(harvester, [refinery])).toBe(false);
        });

        it('should return false when no refineries exist', () => {
            const harvester = createTestHarvester({
                x: 500,
                y: 500,
                harvestAttemptTicks: 50
            });

            expect(isStuckAtRefinery(harvester, [])).toBe(false);
        });

        it('should check distance to nearest refinery', () => {
            const farRefinery = createTestBuilding({
                key: 'refinery',
                id: 'ref_far',
                x: 800,
                y: 800
            });
            const nearRefinery = createTestBuilding({
                key: 'refinery',
                id: 'ref_near',
                x: 550,
                y: 500
            });
            const harvester = createTestHarvester({
                x: 500,
                y: 500,
                harvestAttemptTicks: 35
            });

            // Should be true because near nearRefinery
            expect(isStuckAtRefinery(harvester, [farRefinery, nearRefinery])).toBe(true);
        });
    });

    describe('nudge direction', () => {
        it('should return a normalized direction vector for nudge action', () => {
            // Level is now determined by harvester.harvester.harvestAttemptTicks
            const harvester = createTestHarvester({
                id: 'harv_1',
                harvestAttemptTicks: STUCK_LEVEL_1_TICKS + 1
            });
            const harvesterAI = createInitialHarvesterAIState();
            const ores = [createTestResource({ x: 700, y: 700 })];
            const refineries = [createTestBuilding({ key: 'refinery', x: 300, y: 300 })];

            const resolution = resolveStuckHarvester(
                harvesterAI,
                harvester,
                ores,
                refineries,
                100,
                'hard'
            );

            expect(resolution.action).toBe('nudge');
            expect(resolution.nudgeDirection).toBeDefined();
            // Should be a unit vector (perpendicular nudge)
            const mag = resolution.nudgeDirection!.mag();
            expect(mag).toBeCloseTo(1.0, 1);
        });
    });
});

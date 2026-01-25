import { describe, it, expect } from 'vitest';
import {
    calculateDesperationScore,
    getDesperationBehavior
} from '../../../src/engine/ai/harvester/desperation.js';
import { PlayerState } from '../../../src/engine/types.js';
import { HARVESTER_AI_CONSTANTS } from '../../../src/engine/ai/harvester/types.js';

const {
    CREDITS_DESPERATE_THRESHOLD,
    HARVESTER_RATIO_DESPERATE,
    EARLY_GAME_TICKS
} = HARVESTER_AI_CONSTANTS;

/**
 * Create a minimal PlayerState for testing desperation calculator
 */
function createTestPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: 0,
        isAi: true,
        difficulty: 'hard',
        color: '#ff0000',
        credits: 5000,
        maxPower: 100,
        usedPower: 50,
        queues: {
            building: { items: [], active: false, progress: 0, lastUpdate: 0 },
            infantry: { items: [], active: false, progress: 0, lastUpdate: 0 },
            vehicle: { items: [], active: false, progress: 0, lastUpdate: 0 },
            air: { items: [], active: false, progress: 0, lastUpdate: 0 }
        },
        readyToPlace: null,
        ...overrides
    };
}

describe('Desperation Calculator', () => {
    describe('calculateDesperationScore', () => {
        describe('difficulty scaling', () => {
            it('should return fixed 30 for easy difficulty', () => {
                const player = createTestPlayer({ credits: 0 }); // Would be desperate on hard
                const score = calculateDesperationScore(
                    player,
                    0,  // no harvesters
                    2,  // 2 refineries
                    0,  // no income
                    100, // high expenses
                    EARLY_GAME_TICKS + 1000, // late game
                    'easy',
                    10000 // opponent has more credits
                );
                expect(score).toBe(30);
            });

            it('should return fixed 30 for dummy difficulty', () => {
                const player = createTestPlayer({ credits: 0 });
                const score = calculateDesperationScore(
                    player,
                    0,
                    2,
                    0,
                    100,
                    EARLY_GAME_TICKS + 1000,
                    'dummy',
                    10000
                );
                expect(score).toBe(30);
            });

            it('should use only credits and harvester ratio for medium difficulty', () => {
                // Medium uses 55% credits + 45% harvester ratio
                const player = createTestPlayer({ credits: 2500 }); // 50% of desperate threshold
                const score = calculateDesperationScore(
                    player,
                    1,  // 1 harvester
                    1,  // 1 refinery (ratio 1.0, below 1.5 threshold)
                    0,
                    100,
                    0, // early game shouldn't matter for medium
                    'medium',
                    10000 // opponent ahead shouldn't matter for medium
                );
                // credits factor: 50 (50% of threshold)
                // credits contribution: 50 * 0.55 = 27.5
                // harvester ratio factor: (1.5 - 1.0) / 1.5 * 100 = 33.33
                // harvester contribution: 33.33 * 0.45 = 15
                // total: 27.5 + 15 = 42.5
                expect(score).toBeCloseTo(42.5, 0);
            });
        });

        describe('credits factor (35% weight for hard)', () => {
            it('should return high desperation when credits are zero', () => {
                const player = createTestPlayer({ credits: 0 });
                const score = calculateDesperationScore(
                    player,
                    3,   // healthy harvester count
                    2,   // healthy refinery count
                    100, // good income
                    50,  // low expenses
                    EARLY_GAME_TICKS + 1000, // not early game
                    'hard',
                    0    // opponent also broke
                );
                // Credits at 0 = 100 factor, contributes 100 * 0.35 = 35
                // Other factors at minimum add up to something
                expect(score).toBeGreaterThanOrEqual(35);
            });

            it('should return low desperation when wealthy (5000+ credits)', () => {
                const player = createTestPlayer({ credits: 5000 });
                const score = calculateDesperationScore(
                    player,
                    3,
                    2,
                    100,
                    50,
                    EARLY_GAME_TICKS + 1000, // not early game
                    'hard',
                    5000 // same as player
                );
                // Credits at 5000+ = 0 factor, no contribution from credits
                // With healthy harvester ratio, good income, late game, no relative disadvantage
                // Score should be very low
                expect(score).toBeLessThan(30);
            });

            it('should scale linearly between 0 and 5000 credits', () => {
                const player2500 = createTestPlayer({ credits: 2500 });
                const player1250 = createTestPlayer({ credits: 1250 });

                // Same conditions, different credits
                // Use same credits as player for opponent to isolate credits factor
                const score2500 = calculateDesperationScore(
                    player2500, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 2500
                );
                const score1250 = calculateDesperationScore(
                    player1250, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 1250
                );

                // 2500 credits = 50% of threshold, factor = 50
                // 1250 credits = 25% of threshold, factor = 75
                // Difference in credits contribution: (75-50) * 0.35 = 8.75
                expect(score1250 - score2500).toBeCloseTo(8.75, 0);
            });
        });

        describe('income rate factor (25% weight for hard)', () => {
            it('should add desperation when expenses exceed income', () => {
                const player = createTestPlayer({ credits: 5000 }); // wealthy

                const scoreGoodIncome = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                const scoreBadIncome = calculateDesperationScore(
                    player, 3, 2, 50, 100, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                expect(scoreBadIncome).toBeGreaterThan(scoreGoodIncome);
            });

            it('should have zero income factor when income equals or exceeds expenses', () => {
                const player = createTestPlayer({ credits: 5000 });

                const scoreEqualIncome = calculateDesperationScore(
                    player, 3, 2, 100, 100, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                const scoreBetterIncome = calculateDesperationScore(
                    player, 3, 2, 150, 100, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                expect(scoreEqualIncome).toBe(scoreBetterIncome);
            });
        });

        describe('harvester ratio factor (20% weight for hard)', () => {
            it('should add desperation when harvester ratio is below 1.5', () => {
                const player = createTestPlayer({ credits: 5000 });

                // Good ratio: 3 harvesters / 2 refineries = 1.5 (threshold)
                const scoreGoodRatio = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                // Bad ratio: 1 harvester / 2 refineries = 0.5 (below threshold)
                const scoreBadRatio = calculateDesperationScore(
                    player, 1, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                expect(scoreBadRatio).toBeGreaterThan(scoreGoodRatio);
            });

            it('should have zero harvester factor when ratio meets or exceeds 1.5', () => {
                const player = createTestPlayer({ credits: 5000 });

                // Exactly at threshold
                const scoreAtThreshold = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                // Above threshold
                const scoreAboveThreshold = calculateDesperationScore(
                    player, 4, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                expect(scoreAtThreshold).toBe(scoreAboveThreshold);
            });

            it('should handle zero refineries gracefully', () => {
                const player = createTestPlayer({ credits: 5000 });

                // No refineries - should treat as maximum desperation for this factor
                const score = calculateDesperationScore(
                    player, 2, 0, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                // Should add 20% * 100 = 20 from harvester factor
                expect(score).toBeGreaterThanOrEqual(20);
            });
        });

        describe('game phase factor (10% weight for hard)', () => {
            it('should add +20 desperation during early game (< 10800 ticks)', () => {
                const player = createTestPlayer({ credits: 5000 });

                const scoreEarlyGame = calculateDesperationScore(
                    player, 3, 2, 100, 50, 0, 'hard', 5000
                );

                const scoreLateGame = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS + 1, 'hard', 5000
                );

                // Early game adds +20 to the factor, weighted at 10%
                // Difference should be 20 * 0.10 = 2
                expect(scoreEarlyGame - scoreLateGame).toBeCloseTo(2, 0);
            });

            it('should apply early game bonus at any tick below threshold', () => {
                const player = createTestPlayer({ credits: 5000 });

                const scoreAtStart = calculateDesperationScore(
                    player, 3, 2, 100, 50, 0, 'hard', 5000
                );

                const scoreJustBeforeThreshold = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS - 1, 'hard', 5000
                );

                expect(scoreAtStart).toBe(scoreJustBeforeThreshold);
            });
        });

        describe('relative economy factor (10% weight for hard)', () => {
            it('should add desperation when behind opponents', () => {
                const player = createTestPlayer({ credits: 2000 });

                // When opponent has more credits
                const scoreBehind = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                // When opponent has same credits
                const scoreEqual = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 2000
                );

                expect(scoreBehind).toBeGreaterThan(scoreEqual);
            });

            it('should have zero relative factor when ahead of opponent', () => {
                const player = createTestPlayer({ credits: 5000 });

                // Opponent has less
                const scoreAhead = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 2000
                );

                // Opponent has same
                const scoreEqual = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 5000
                );

                expect(scoreAhead).toBe(scoreEqual);
            });

            it('should not add relative factor when opponent credits not provided', () => {
                const player = createTestPlayer({ credits: 1000 });

                const scoreWithOpponent = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard', 10000
                );

                const scoreWithoutOpponent = calculateDesperationScore(
                    player, 3, 2, 100, 50, EARLY_GAME_TICKS + 1000, 'hard'
                    // no opponent credits
                );

                expect(scoreWithOpponent).toBeGreaterThan(scoreWithoutOpponent);
            });
        });

        describe('score clamping', () => {
            it('should clamp score to minimum of 0', () => {
                const player = createTestPlayer({ credits: 10000 }); // very wealthy
                const score = calculateDesperationScore(
                    player, 10, 2, 1000, 0, EARLY_GAME_TICKS + 1000, 'hard', 0
                );
                expect(score).toBeGreaterThanOrEqual(0);
            });

            it('should clamp score to maximum of 100', () => {
                const player = createTestPlayer({ credits: 0 }); // broke
                const score = calculateDesperationScore(
                    player, 0, 5, 0, 1000, 0, 'hard', 100000 // extremely behind
                );
                expect(score).toBeLessThanOrEqual(100);
            });
        });
    });

    describe('getDesperationBehavior', () => {
        describe('very_cautious (0-20)', () => {
            it('should return very_cautious for score of 0', () => {
                const behavior = getDesperationBehavior(0);
                expect(behavior.riskTolerance).toBe('very_cautious');
                expect(behavior.maxAcceptableDanger).toBeLessThan(25);
                expect(behavior.fleeDistanceMultiplier).toBeCloseTo(1.5, 1);
            });

            it('should return very_cautious for score of 20', () => {
                const behavior = getDesperationBehavior(20);
                expect(behavior.riskTolerance).toBe('very_cautious');
                expect(behavior.maxAcceptableDanger).toBeLessThan(25);
                expect(behavior.fleeDistanceMultiplier).toBeCloseTo(1.5, 1);
            });
        });

        describe('balanced (21-50)', () => {
            it('should return balanced for score of 21', () => {
                const behavior = getDesperationBehavior(21);
                expect(behavior.riskTolerance).toBe('balanced');
                expect(behavior.maxAcceptableDanger).toBeLessThan(55);
                expect(behavior.maxAcceptableDanger).toBeGreaterThanOrEqual(20);
                expect(behavior.fleeDistanceMultiplier).toBeCloseTo(1.0, 1);
            });

            it('should return balanced for score of 50', () => {
                const behavior = getDesperationBehavior(50);
                expect(behavior.riskTolerance).toBe('balanced');
                expect(behavior.maxAcceptableDanger).toBeLessThan(55);
                expect(behavior.fleeDistanceMultiplier).toBeCloseTo(1.0, 1);
            });
        });

        describe('aggressive (51-75)', () => {
            it('should return aggressive for score of 51', () => {
                const behavior = getDesperationBehavior(51);
                expect(behavior.riskTolerance).toBe('aggressive');
                expect(behavior.maxAcceptableDanger).toBeLessThan(80);
                expect(behavior.maxAcceptableDanger).toBeGreaterThanOrEqual(50);
                expect(behavior.fleeDistanceMultiplier).toBeCloseTo(0.7, 1);
            });

            it('should return aggressive for score of 75', () => {
                const behavior = getDesperationBehavior(75);
                expect(behavior.riskTolerance).toBe('aggressive');
                expect(behavior.maxAcceptableDanger).toBeLessThan(80);
                expect(behavior.fleeDistanceMultiplier).toBeCloseTo(0.7, 1);
            });
        });

        describe('desperate (76-100)', () => {
            it('should return desperate for score of 76', () => {
                const behavior = getDesperationBehavior(76);
                expect(behavior.riskTolerance).toBe('desperate');
                expect(behavior.maxAcceptableDanger).toBeGreaterThanOrEqual(75);
                expect(behavior.fleeDistanceMultiplier).toBeCloseTo(0.5, 1);
            });

            it('should return desperate for score of 100', () => {
                const behavior = getDesperationBehavior(100);
                expect(behavior.riskTolerance).toBe('desperate');
                expect(behavior.maxAcceptableDanger).toBe(100);
                expect(behavior.fleeDistanceMultiplier).toBeCloseTo(0.5, 1);
            });
        });

        describe('edge cases', () => {
            it('should handle boundary value 20.5 as balanced', () => {
                const behavior = getDesperationBehavior(20.5);
                expect(behavior.riskTolerance).toBe('balanced');
            });

            it('should handle boundary value 50.5 as aggressive', () => {
                const behavior = getDesperationBehavior(50.5);
                expect(behavior.riskTolerance).toBe('aggressive');
            });

            it('should handle boundary value 75.5 as desperate', () => {
                const behavior = getDesperationBehavior(75.5);
                expect(behavior.riskTolerance).toBe('desperate');
            });
        });
    });
});

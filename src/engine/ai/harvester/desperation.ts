/**
 * Desperation Calculator for Harvester AI
 *
 * Calculates a multi-factor desperation score (0-100) that determines
 * harvester risk tolerance. Higher desperation means harvesters are
 * willing to take more risks to gather resources.
 *
 * Factor Weights (for Hard difficulty):
 * - Credits (35%): 0 at 5000+ credits, 100 at 0 credits, linear
 * - Income Rate (25%): Compare income vs expenses
 * - Harvester Ratio (20%): harvesters / refineries (< 1.5 = desperate)
 * - Game Phase (10%): Early game (< 10800 ticks) adds +20 desperation
 * - Relative Economy (10%): Behind opponents = more desperate
 *
 * Difficulty Scaling:
 * - Easy/Dummy: Return fixed 30
 * - Medium: Only uses credits (55%) + harvester ratio (45%)
 * - Hard: Full calculation
 */

import { PlayerState } from '../../types.js';
import { HARVESTER_AI_CONSTANTS } from './types.js';

const {
    CREDITS_DESPERATE_THRESHOLD,
    HARVESTER_RATIO_DESPERATE,
    EARLY_GAME_TICKS
} = HARVESTER_AI_CONSTANTS;

// Weight constants for hard difficulty
const CREDITS_WEIGHT = 0.35;
const INCOME_WEIGHT = 0.25;
const HARVESTER_RATIO_WEIGHT = 0.20;
const GAME_PHASE_WEIGHT = 0.10;
const RELATIVE_ECONOMY_WEIGHT = 0.10;

// Weight constants for medium difficulty
const MEDIUM_CREDITS_WEIGHT = 0.55;
const MEDIUM_HARVESTER_RATIO_WEIGHT = 0.45;

// Fixed score for easy/dummy
const EASY_DUMMY_FIXED_SCORE = 30;

// Early game bonus
const EARLY_GAME_DESPERATION_BONUS = 20;

/**
 * Risk tolerance levels based on desperation
 */
export type RiskTolerance = 'very_cautious' | 'balanced' | 'aggressive' | 'desperate';

/**
 * Desperation behavior parameters
 */
export interface DesperationBehavior {
    maxAcceptableDanger: number;  // 20 at low, 100 at high desperation
    fleeDistanceMultiplier: number;  // 1.5 at low, 0.5 at high
    riskTolerance: RiskTolerance;
}

/**
 * Calculate the desperation score (0-100) based on multiple economic factors.
 *
 * @param player - The player state containing credits
 * @param harvesterCount - Number of active harvesters
 * @param refineryCount - Number of refineries
 * @param incomeRate - Current income rate per tick
 * @param expenseRate - Current expense rate per tick
 * @param currentTick - Current game tick
 * @param difficulty - AI difficulty level
 * @param opponentCredits - Optional: highest opponent credits for relative comparison
 * @returns Desperation score from 0 (comfortable) to 100 (desperate)
 */
export function calculateDesperationScore(
    player: PlayerState,
    harvesterCount: number,
    refineryCount: number,
    incomeRate: number,
    expenseRate: number,
    currentTick: number,
    difficulty: 'dummy' | 'easy' | 'medium' | 'hard',
    opponentCredits?: number
): number {
    // Easy and dummy difficulties use fixed score
    if (difficulty === 'easy' || difficulty === 'dummy') {
        return EASY_DUMMY_FIXED_SCORE;
    }

    // Calculate credits factor (0-100)
    // 0 credits = 100 factor, 5000+ credits = 0 factor
    const creditsFactor = Math.max(0, Math.min(100,
        (1 - player.credits / CREDITS_DESPERATE_THRESHOLD) * 100
    ));

    // Calculate harvester ratio factor (0-100)
    // Ratio below 1.5 adds desperation
    let harvesterRatioFactor: number;
    if (refineryCount === 0) {
        // No refineries = maximum desperation for this factor
        harvesterRatioFactor = 100;
    } else {
        const ratio = harvesterCount / refineryCount;
        if (ratio >= HARVESTER_RATIO_DESPERATE) {
            harvesterRatioFactor = 0;
        } else {
            // Linear scaling: ratio 0 = 100 factor, ratio 1.5 = 0 factor
            harvesterRatioFactor = ((HARVESTER_RATIO_DESPERATE - ratio) / HARVESTER_RATIO_DESPERATE) * 100;
        }
    }

    // Medium difficulty: only use credits and harvester ratio
    if (difficulty === 'medium') {
        const score = (creditsFactor * MEDIUM_CREDITS_WEIGHT) +
                      (harvesterRatioFactor * MEDIUM_HARVESTER_RATIO_WEIGHT);
        return Math.max(0, Math.min(100, score));
    }

    // Hard difficulty: full calculation

    // Calculate income rate factor (0-100)
    // When expenses exceed income, add desperation
    let incomeFactor: number;
    if (incomeRate >= expenseRate) {
        incomeFactor = 0;
    } else {
        // Deficit as percentage of expenses (capped at 100%)
        const deficit = expenseRate - incomeRate;
        incomeFactor = Math.min(100, (deficit / Math.max(1, expenseRate)) * 100);
    }

    // Calculate game phase factor (0-100)
    // Early game adds +20 to factor
    const gamePhaseFactor = currentTick < EARLY_GAME_TICKS ? EARLY_GAME_DESPERATION_BONUS : 0;

    // Calculate relative economy factor (0-100)
    // Being behind opponents adds desperation
    let relativeEconomyFactor = 0;
    if (opponentCredits !== undefined && opponentCredits > player.credits) {
        // Calculate how far behind (as percentage of opponent's credits)
        const deficit = opponentCredits - player.credits;
        relativeEconomyFactor = Math.min(100, (deficit / Math.max(1, opponentCredits)) * 100);
    }

    // Calculate weighted score
    const score = (creditsFactor * CREDITS_WEIGHT) +
                  (incomeFactor * INCOME_WEIGHT) +
                  (harvesterRatioFactor * HARVESTER_RATIO_WEIGHT) +
                  (gamePhaseFactor * GAME_PHASE_WEIGHT) +
                  (relativeEconomyFactor * RELATIVE_ECONOMY_WEIGHT);

    // Clamp to 0-100
    return Math.max(0, Math.min(100, score));
}

/**
 * Get desperation-based behavior parameters for harvesters.
 *
 * Thresholds:
 * - 0-20: very_cautious, danger<20, flee 1.5x
 * - 21-50: balanced, danger<50, flee 1.0x
 * - 51-75: aggressive, danger<75, flee 0.7x
 * - 76-100: desperate, danger<100, flee 0.5x
 *
 * @param desperationScore - The calculated desperation score (0-100)
 * @returns Behavior parameters for harvester decision making
 */
export function getDesperationBehavior(desperationScore: number): DesperationBehavior {
    if (desperationScore <= 20) {
        return {
            maxAcceptableDanger: 20,
            fleeDistanceMultiplier: 1.5,
            riskTolerance: 'very_cautious'
        };
    }

    if (desperationScore <= 50) {
        return {
            maxAcceptableDanger: 50,
            fleeDistanceMultiplier: 1.0,
            riskTolerance: 'balanced'
        };
    }

    if (desperationScore <= 75) {
        return {
            maxAcceptableDanger: 75,
            fleeDistanceMultiplier: 0.7,
            riskTolerance: 'aggressive'
        };
    }

    // 76-100: desperate
    return {
        maxAcceptableDanger: 100,
        fleeDistanceMultiplier: 0.5,
        riskTolerance: 'desperate'
    };
}

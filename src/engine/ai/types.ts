/**
 * AI Type Definitions
 *
 * Core types for the AI system including strategies, state management,
 * and configuration interfaces.
 */

import { EntityId, Vector } from '../types.js';

// ============ STRATEGY TYPES ============

/**
 * AI Strategy - determines high-level behavior
 */
export type AIStrategy = 'buildup' | 'attack' | 'defend' | 'harass' | 'all_in';

/**
 * Investment priority - guides resource allocation
 */
export type InvestmentPriority = 'economy' | 'warfare' | 'defense' | 'balanced';

// ============ GROUP MANAGEMENT ============

/**
 * Offensive Group - manages a coordinated attack force
 */
export interface OffensiveGroup {
    id: string;
    unitIds: EntityId[];
    target: EntityId | null;
    rallyPoint: Vector | null;
    status: 'forming' | 'rallying' | 'attacking' | 'retreating';
    lastOrderTick: number;
}

// ============ INTELLIGENCE ============

/**
 * Enemy intelligence tracking
 */
export interface EnemyIntelligence {
    lastUpdate: number;
    unitCounts: Record<string, number>;
    buildingCounts: Record<string, number>;
    dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed';
}

// ============ AI STATE ============

/**
 * AI State - persistent state for each AI player
 *
 * This tracks everything an AI player needs to remember between ticks:
 * - Current strategy and groups
 * - Threat awareness
 * - Economic evaluation
 * - Enemy intelligence
 * - Behavioral modifiers (vengeance, desperation)
 */
export interface AIPlayerState {
    // Strategy
    strategy: AIStrategy;
    lastStrategyChange: number;

    // Unit groups
    attackGroup: EntityId[];
    harassGroup: EntityId[];
    defenseGroup: EntityId[];
    offensiveGroups: OffensiveGroup[];

    // Threat awareness
    threatsNearBase: EntityId[];
    harvestersUnderAttack: EntityId[];

    // Exploration
    enemyBaseLocation: Vector | null;
    lastScoutTick: number;

    // Production tracking
    lastProductionType: 'infantry' | 'vehicle' | null;

    // Dynamic resource allocation
    investmentPriority: InvestmentPriority;
    economyScore: number;      // 0-100 economic health rating
    threatLevel: number;       // 0-100 military pressure rating
    expansionTarget: Vector | null;  // Distant ore to expand toward
    peaceTicks: number;        // Ticks spent at peace with surplus resources

    // Emergency sell tracking
    lastSellTick: number;

    // Enemy intelligence
    enemyIntelligence: EnemyIntelligence;

    // Vengeance tracking: damage received from each player
    vengeanceScores: Record<number, number>;

    // Stalemate tracking
    lastCombatTick: number;
    stalemateDesperation: number; // 0-100 desperation level

    // All-in mode tracking
    allInStartTick: number;
}

/**
 * Creates a fresh AI player state with default values
 */
export function createAIPlayerState(): AIPlayerState {
    return {
        strategy: 'buildup',
        lastStrategyChange: 0,
        attackGroup: [],
        harassGroup: [],
        defenseGroup: [],
        offensiveGroups: [],
        threatsNearBase: [],
        harvestersUnderAttack: [],
        enemyBaseLocation: null,
        lastScoutTick: 0,
        lastProductionType: null,
        investmentPriority: 'balanced',
        economyScore: 50,
        threatLevel: 0,
        expansionTarget: null,
        peaceTicks: 0,
        lastSellTick: 0,
        enemyIntelligence: {
            lastUpdate: 0,
            unitCounts: {},
            buildingCounts: {},
            dominantArmor: 'mixed'
        },
        vengeanceScores: {},
        lastCombatTick: 0,
        stalemateDesperation: 0,
        allInStartTick: 0
    };
}

// ============ COUNTER-BUILDING ============

/**
 * Counter-building unit preferences
 */
export interface CounterUnits {
    infantry: string[];
    vehicle: string[];
}

// ============ AI CONSTANTS ============

/**
 * Consolidated configuration for all AI behavior constants
 */
export const AI_CONSTANTS = {
    // === DISTANCES ===
    BUILD_RADIUS: 400,              // Distance within which buildings can be placed
    BASE_DEFENSE_RADIUS: 500,       // Radius to consider threats "near base"
    THREAT_DETECTION_RADIUS: 400,   // Radius for detecting nearby threats
    HARVESTER_FLEE_DISTANCE: 200,   // Distance to move when fleeing
    RALLY_DISTANCE: 150,            // Distance from target to rally before attack
    ALLY_DANGER_RADIUS: 120,        // Distance to check for allies under fire (~3 tiles)
    ORE_COVERAGE_RADIUS: 250,       // Refinery considers ore "covered" within this
    ORE_ACCESSIBLE_RADIUS: 600,     // Ore considered accessible within this from buildings

    // === COMBAT ===
    ATTACK_GROUP_MIN_SIZE: 5,       // Minimum units needed for attack group
    HARASS_GROUP_SIZE: 3,           // Size of harass squad
    MAX_CHASE_DISTANCE: 400,        // Max distance to chase fleeing enemies

    // === TIMINGS (in ticks, 60 ticks = 1 second) ===
    STRATEGY_COOLDOWN: 300,         // 5 seconds between strategy changes
    RALLY_TIMEOUT: 300,             // 5 seconds to wait for stragglers at rally point
    SCOUT_INTERVAL: 600,            // 10 seconds between scout attempts
    RECENT_DAMAGE_WINDOW: 60,       // 1 second - time window to consider "under fire"
    INTEL_UPDATE_INTERVAL: 300,     // 5 seconds between enemy intelligence updates
    AI_TICK_INTERVAL: 30,           // AI runs every 30 ticks (0.5 seconds)

    // === PEACE-BREAK (triggers aggressive behavior when wealthy and peaceful) ===
    SURPLUS_CREDIT_THRESHOLD: 4000, // Credits considered "surplus"
    PEACE_BREAK_TICKS: 600,         // 10 seconds of peace before considering attack
    GUARANTEED_PEACE_BREAK_TICKS: 1200, // 20 seconds guaranteed attack
    SURPLUS_DEFENSE_THRESHOLD: 5000, // Credits to trigger extra defense building
    MAX_SURPLUS_TURRETS: 4,         // Maximum turrets to build from surplus

    // === STALEMATE-BREAKER (force risky moves when game stagnates) ===
    STALEMATE_DETECTION_TICK: 18000,      // Start checking for stalemate after 5 minutes
    STALEMATE_NO_COMBAT_THRESHOLD: 6000,  // 100 seconds without combat = stalemate
    STALEMATE_LOW_ARMY_THRESHOLD: 2,      // Less than this many combat units = stuck
    DESPERATE_ATTACK_TICK: 36000,         // After 10 minutes, attack with anything
    HARVESTER_ATTACK_THRESHOLD: 3,        // Need at least this many harvesters to suicide attack

    // === ALL-IN MODE SELL PHASES (progressive selling for final push) ===
    ALL_IN_PHASE1_TICKS: 1800,      // After 30s in all_in: sell defense buildings
    ALL_IN_PHASE2_TICKS: 3600,      // After 60s in all_in: sell economy buildings
    ALL_IN_PHASE3_TICKS: 5400,      // After 90s in all_in: sell everything

    // === VENGEANCE SYSTEM ===
    VENGEANCE_DECAY: 0.995,         // Decay factor per AI tick (grudges fade slowly)
    VENGEANCE_PER_HIT: 10,          // Base vengeance added per attacked entity
} as const;

// Type for the constants object
export type AIConstantsType = typeof AI_CONSTANTS;

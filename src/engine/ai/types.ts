import { EntityId, Vector } from '../types.js';
import { PersonalityName } from '../../data/schemas/index.js';

// AI Strategy Types
export type AIStrategy = 'buildup' | 'attack' | 'defend' | 'harass' | 'all_in';

// Offensive Group - manages a coordinated attack force
export interface OffensiveGroup {
    id: string;
    unitIds: EntityId[];
    target: EntityId | null;
    rallyPoint: Vector | null;
    status: 'forming' | 'rallying' | 'attacking' | 'retreating';
    lastOrderTick: number;
}

// AI State tracking (per player, stored separately since GameState is immutable)
export type InvestmentPriority = 'economy' | 'warfare' | 'defense' | 'balanced';

export interface AIPlayerState {
    personality: PersonalityName;  // Randomly selected at game start, independent of difficulty
    strategy: AIStrategy;
    lastStrategyChange: number;
    attackGroup: EntityId[];
    harassGroup: EntityId[];
    defenseGroup: EntityId[];
    threatsNearBase: EntityId[];
    harvestersUnderAttack: EntityId[];
    offensiveGroups: OffensiveGroup[];
    enemyBaseLocation: Vector | null;
    lastScoutTick: number;
    lastProductionType: 'infantry' | 'vehicle' | null;
    // Dynamic resource allocation
    investmentPriority: InvestmentPriority;
    economyScore: number;      // 0-100 economic health rating
    threatLevel: number;       // 0-100 military pressure rating
    expansionTarget: Vector | null;  // Distant ore to expand toward
    peaceTicks: number;        // Ticks spent at peace with surplus resources
    // Emergency sell tracking
    lastSellTick: number;      // Last tick when a building was sold
    // Enemy intelligence for counter-building
    enemyIntelligence: {
        lastUpdate: number;
        unitCounts: Record<string, number>;
        buildingCounts: Record<string, number>;
        dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed';
    };
    // Vengeance tracking: damage received from each player (higher = more likely to target)
    vengeanceScores: Record<number, number>;
    // Stalemate tracking: detect when game is stuck and force risky plays
    lastCombatTick: number;       // Last tick when we engaged in combat (attacked or were attacked)
    stalemateDesperation: number; // 0-100 desperation level (higher = more risky behavior)
    // All-in mode tracking
    allInStartTick: number;       // When all_in mode started (0 = not in all_in)
}

export interface CounterUnits {
    infantry: string[];
    vehicle: string[];
}

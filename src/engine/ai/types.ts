import { EntityId, Vector } from '../types.js';
import { PersonalityName } from '../../data/schemas/index.js';
import { HarvesterAIState } from './harvester/types.js';

// AI Strategy Types
export type AIStrategy = 'buildup' | 'attack' | 'defend' | 'harass' | 'all_in';

// Offensive Group - manages a coordinated attack force
export interface OffensiveGroup {
    id: string;
    unitIds: EntityId[];
    target: EntityId | null;
    rallyPoint: Vector | null;
    status: 'forming' | 'rallying' | 'moving' | 'engaging' | 'attacking' | 'retreating' | 'reinforcing';
    lastOrderTick: number;
    // Group health and combat state
    lastHealthCheck: number;           // Tick when health was last evaluated
    avgHealthPercent: number;          // Average HP % of group (0-100)
    // Movement tracking
    moveTarget: Vector | null;         // Current movement destination
    lastRegroupTick: number;           // Last tick when group regrouped
    // En-route combat
    engagedEnemies: EntityId[];        // Enemies currently being fought en route
    preEngageTarget: Vector | null;    // Where we were going before engaging
    // Reinforcement
    needsReinforcements: boolean;      // Group is requesting backup
    reinforcementIds: EntityId[];      // Units en route to reinforce
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
    lastThreatDetectedTick: number;  // When threats were first detected (for reaction delay)
    offensiveGroups: OffensiveGroup[];
    enemyBaseLocation: Vector | null;
    lastScoutTick: number;
    lastProductionType: 'infantry' | 'vehicle' | 'air' | null;
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
        boomScores: Record<number, number>;
    };
    // Vengeance tracking: damage received from each player (higher = more likely to target)
    vengeanceScores: Record<number, number>;
    // Stalemate tracking: detect when game is stuck and force risky plays
    lastCombatTick: number;       // Last tick when we engaged in combat (attacked or were attacked)
    stalemateDesperation: number; // 0-100 desperation level (higher = more risky behavior)
    // All-in mode tracking
    allInStartTick: number;       // When all_in mode started (0 = not in all_in)
    // Doomed mode: no income AND no way to recover (no conyard to build refinery)
    isDoomed: boolean;
    // Harvester AI state
    harvesterAI: HarvesterAIState;
}

export interface CounterUnits {
    infantry: string[];
    vehicle: string[];
}

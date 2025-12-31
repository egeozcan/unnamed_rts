/**
 * AI Module Entry Point
 *
 * This module provides a modular AI system for the RTS game.
 * It handles strategy selection, unit control, economy management,
 * and tactical decision-making for AI players.
 *
 * Architecture:
 * - types.ts: Core type definitions
 * - state.ts: AI state management
 * - strategy/: Strategy selection and transitions
 * - tactics/: Economic and combat tactics
 * - micro/: Unit micro-management (kiting, retreat)
 * - squad/: Squad formations and coordination
 * - scouting/: Intelligence gathering
 * - utils/: Utility functions
 *
 * For backwards compatibility, this module re-exports from the
 * original ai.ts while new features are developed in the modular structure.
 */

// Re-export types
export type {
    AIStrategy,
    AIPlayerState,
    OffensiveGroup,
    InvestmentPriority,
    EnemyIntelligence,
    CounterUnits
} from './types.js';

export { AI_CONSTANTS, createAIPlayerState } from './types.js';

// Re-export state management
export { getAIState, resetAIState, getAllAIStates, setAIState } from './state.js';

// Re-export utilities
export * from './utils/index.js';

// Re-export strategy functions
export { updateStrategy, evaluateInvestmentPriority } from './strategy/index.js';
export * from './strategy/new-strategies.js';

// Re-export micro functions
export {
    evaluateKite,
    evaluateStutterStep,
    evaluateRetreat,
    evaluateSpread,
    processMicro
} from './micro/index.js';

// Re-export squad system
export * from './squad/types.js';
export { calculateFormationPositions, assignRoles, suggestFormation } from './squad/formations.js';
export { SquadManager } from './squad/index.js';

// Re-export scouting system
export {
    ScoutManager,
    DEFAULT_SCOUTING_CONFIG,
    predictThreat,
    analyzeEnemyComposition
} from './scouting/index.js';
export type {
    EnemyIntel,
    BuildingIntel,
    UnitIntel,
    ScoutAssignment,
    ScoutingConfig
} from './scouting/index.js';

// Re-export personality system
export * from './personality/index.js';

// Re-export defensive tactics
export * from './tactics/index.js';

// For now, re-export the main computeAiActions from the original file
// This will be migrated to use the modular components incrementally
export { computeAiActions } from '../ai.js';

/**
 * AI State Management
 *
 * Manages persistent AI state for each player.
 * Currently uses a global store (for backwards compatibility),
 * but designed to be easily migrated to GameState.
 */

import { AIPlayerState, createAIPlayerState } from './types.js';

// Store AI states (keyed by playerId)
const aiStates: Record<number, AIPlayerState> = {};

/**
 * Get or create AI state for a player
 */
export function getAIState(playerId: number): AIPlayerState {
    if (!aiStates[playerId]) {
        aiStates[playerId] = createAIPlayerState();
    }
    return aiStates[playerId];
}

/**
 * Reset AI state (useful for tests and game restarts)
 */
export function resetAIState(playerId?: number): void {
    if (playerId !== undefined) {
        delete aiStates[playerId];
    } else {
        for (const key in aiStates) {
            delete aiStates[key];
        }
    }
}

/**
 * Get all AI states (for debugging/serialization)
 */
export function getAllAIStates(): Record<number, AIPlayerState> {
    return { ...aiStates };
}

/**
 * Set AI state directly (for loading saved games or tests)
 */
export function setAIState(playerId: number, state: AIPlayerState): void {
    aiStates[playerId] = state;
}

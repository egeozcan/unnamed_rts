import { Action, GameState } from '../types.js';
import { EntityCache } from '../perf.js';
import { getAIImplementation, DEFAULT_AI_IMPLEMENTATION_ID } from './registry.js';

const warnedUnknownImplementationIds = new Set<string>();

export function resolveAIImplementationId(state: GameState, playerId: number): string {
    const player = state.players[playerId];
    if (!player?.isAi) {
        return DEFAULT_AI_IMPLEMENTATION_ID;
    }

    const configuredId = player.aiImplementationId || DEFAULT_AI_IMPLEMENTATION_ID;
    if (getAIImplementation(configuredId)) {
        return configuredId;
    }

    if (!warnedUnknownImplementationIds.has(configuredId)) {
        console.warn(`[AI] Unknown implementation "${configuredId}" for player ${playerId}. Falling back to "${DEFAULT_AI_IMPLEMENTATION_ID}".`);
        warnedUnknownImplementationIds.add(configuredId);
    }

    return DEFAULT_AI_IMPLEMENTATION_ID;
}

export function computeAiActionsForPlayer(state: GameState, playerId: number, sharedCache?: EntityCache): Action[] {
    const player = state.players[playerId];
    if (!player) {
        return [];
    }

    const implementationId = resolveAIImplementationId(state, playerId);
    const implementation = getAIImplementation(implementationId);
    if (!implementation) {
        return [];
    }

    return implementation.computeActions({
        state,
        playerId,
        difficulty: player.difficulty,
        entityCache: sharedCache
    });
}

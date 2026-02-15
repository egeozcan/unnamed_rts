import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import {
    DEFAULT_AI_IMPLEMENTATION_ID,
    getAIImplementation,
    getAIImplementationOptions,
    registerAIImplementation
} from '../../src/engine/ai/registry.js';
import { resolveAIImplementationId, computeAiActionsForPlayer } from '../../src/engine/ai/controller.js';
import type { AIImplementation } from '../../src/engine/ai/contracts.js';
import { createEntityCache } from '../../src/engine/perf.js';

describe('AI modularity', () => {
    it('registers classic implementation by default', () => {
        const implementation = getAIImplementation(DEFAULT_AI_IMPLEMENTATION_ID);
        expect(implementation).toBeDefined();
        expect(implementation?.id).toBe(DEFAULT_AI_IMPLEMENTATION_ID);
    });

    it('exposes implementation options for setup UI', () => {
        const options = getAIImplementationOptions();
        expect(options.some(option => option.id === DEFAULT_AI_IMPLEMENTATION_ID)).toBe(true);
        expect(options.some(option => option.id === 'eco_tank_all_in')).toBe(true);
    });

    it('resolves unknown implementation ids to the default implementation', () => {
        const state = {
            ...INITIAL_STATE,
            players: {
                1: createPlayerState(1, true, 'medium', '#ff4444', 'unknown_impl')
            }
        };

        expect(resolveAIImplementationId(state, 1)).toBe(DEFAULT_AI_IMPLEMENTATION_ID);
    });

    it('computes AI actions through the controller without throwing', () => {
        const state = {
            ...INITIAL_STATE,
            tick: 10,
            players: {
                1: createPlayerState(1, true, 'medium', '#ff4444', DEFAULT_AI_IMPLEMENTATION_ID)
            },
            entities: {}
        };

        const actions = computeAiActionsForPlayer(state, 1);
        expect(actions).toEqual([]);
    });

    it('prevents duplicate AI implementation registration', () => {
        const duplicateClassic: AIImplementation = {
            id: DEFAULT_AI_IMPLEMENTATION_ID,
            name: 'Duplicate Classic',
            computeActions: () => []
        };

        expect(() => registerAIImplementation(duplicateClassic)).toThrow('already registered');
    });

    it('passes shared entity cache through controller context', () => {
        const captured: { cache?: ReturnType<typeof createEntityCache> } = {};
        const implementationId = `test_shared_cache_${Date.now()}`;
        registerAIImplementation({
            id: implementationId,
            name: 'Test Shared Cache',
            computeActions: (context) => {
                captured.cache = context.entityCache;
                return [];
            }
        });

        const state = {
            ...INITIAL_STATE,
            players: {
                1: createPlayerState(1, true, 'medium', '#ff4444', implementationId)
            },
            entities: {}
        };

        const sharedCache = createEntityCache(state.entities);
        computeAiActionsForPlayer(state, 1, sharedCache);
        expect(captured.cache).toBe(sharedCache);
    });
});

import { AIImplementation, AIImplementationOption } from './contracts.js';
import { classicAIImplementation } from './implementations/classic/index.js';
// @ai-implementation-imports

export const DEFAULT_AI_IMPLEMENTATION_ID = 'classic';

const aiImplementationRegistry = new Map<string, AIImplementation>();

export function registerAIImplementation(implementation: AIImplementation): void {
    const id = implementation.id.trim();
    if (!id) {
        throw new Error('AI implementation id cannot be empty');
    }
    if (aiImplementationRegistry.has(id)) {
        throw new Error(`AI implementation "${id}" is already registered`);
    }
    aiImplementationRegistry.set(id, implementation);
}

export function getAIImplementation(id: string): AIImplementation | undefined {
    return aiImplementationRegistry.get(id);
}

export function getAIImplementations(): AIImplementation[] {
    return Array.from(aiImplementationRegistry.values());
}

export function getAIImplementationOptions(): AIImplementationOption[] {
    return getAIImplementations().map(implementation => ({
        id: implementation.id,
        name: implementation.name,
        description: implementation.description
    }));
}

export function resetAIImplementations(playerId?: number): void {
    for (const implementation of aiImplementationRegistry.values()) {
        implementation.reset?.(playerId);
    }
}

const builtInImplementations: AIImplementation[] = [
    classicAIImplementation,
    // @ai-implementation-list
];

for (const implementation of builtInImplementations) {
    registerAIImplementation(implementation);
}

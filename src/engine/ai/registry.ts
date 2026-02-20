import { AIImplementation, AIImplementationOption } from './contracts.js';
import { classicAIImplementation } from './implementations/classic/index.js';
import { ecoTankAllInAIImplementation } from './implementations/eco_tank_all_in/index.js';
import { infantryFortressAIImplementation } from './implementations/infantry_fortress/index.js';
import { geniusAIImplementation } from './implementations/genius/index.js';
import { hydraAIImplementation } from './implementations/hydra/index.js';
// @ai-implementation-imports
import { TitanAIImplementation } from './implementations/titan/index.js';
import { SentinelOpportunistAIImplementation } from './implementations/sentinel_opportunist/index.js';
import { SaboteurCircusAIImplementation } from './implementations/saboteur_circus/index.js';
import { AuroraSovereignAIImplementation } from './implementations/aurora_sovereign/index.js';

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
    ecoTankAllInAIImplementation,
    infantryFortressAIImplementation,
    geniusAIImplementation,
    hydraAIImplementation,
    AuroraSovereignAIImplementation,
    SaboteurCircusAIImplementation,
    SentinelOpportunistAIImplementation,
    TitanAIImplementation,
    // @ai-implementation-list
];

for (const implementation of builtInImplementations) {
    registerAIImplementation(implementation);
}

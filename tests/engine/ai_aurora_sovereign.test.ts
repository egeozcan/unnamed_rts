import { describe, it, expect } from 'vitest';
import { getAIImplementation } from '../../src/engine/ai/registry.js';

describe('AuroraSovereign AI scaffolding', () => {
    it('registers in the AI registry', () => {
        const implementation = getAIImplementation('aurora_sovereign');
        expect(implementation).toBeDefined();
        expect(implementation?.id).toBe('aurora_sovereign');
    });
});

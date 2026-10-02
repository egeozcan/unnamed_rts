import { describe, it, expect } from 'vitest';
import { parseAIIdArg, parseChoiceArg, parseIntegerArg, CliArgError } from '../../src/scripts/cli_args';

describe('cli_args', () => {
    it('parses integers strictly', () => {
        expect(parseIntegerArg('--games', '12', 1)).toBe(12);
        expect(() => parseIntegerArg('--games', 'abc')).toThrow(CliArgError);
        expect(() => parseIntegerArg('--games', '3.5')).toThrow(CliArgError);
        expect(() => parseIntegerArg('--games', undefined)).toThrow(CliArgError);
        expect(() => parseIntegerArg('--games', '0', 1)).toThrow(/>= 1/);
    });

    it('validates choices', () => {
        expect(parseChoiceArg('--difficulty', 'hard', ['easy', 'hard'] as const)).toBe('hard');
        expect(() => parseChoiceArg('--difficulty', 'brutal', ['easy', 'hard'] as const)).toThrow(/easy, hard/);
    });

    it('rejects unknown AI implementation ids instead of silently falling back', () => {
        expect(parseAIIdArg('--ai1', 'classic', ['classic', 'hydra'])).toBe('classic');
        expect(() => parseAIIdArg('--ai1', 'clasic', ['classic', 'hydra'])).toThrow(/clasic/);
    });
});

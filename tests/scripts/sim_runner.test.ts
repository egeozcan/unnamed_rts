import { describe, it, expect, vi } from 'vitest';
import { createGameState, runGame, withSeededRandom, deriveGameSeed } from '../../src/scripts/sim_runner';
import { registerAIImplementation, getAIImplementation } from '../../src/engine/ai/registry';

describe('sim_runner AI lifecycle', () => {
    it('resets every registered implementation before a game starts', () => {
        const id = 'sim_runner_reset_probe';
        const reset = vi.fn();
        if (!getAIImplementation(id)) {
            registerAIImplementation({ id, name: 'Probe', computeActions: () => [], reset });
        }
        const probe = getAIImplementation(id)!;
        const spy = vi.spyOn(probe, 'reset');

        const state = createGameState(id, id, 'easy', 'small', 'medium', 'medium');
        runGame(state, 3, false, 0, true);

        expect(spy).toHaveBeenCalled();
        spy.mockRestore();
    });

    it.each([
        ['sentinel_opportunist', 'saboteur_circus'],
        ['engineer_conyard_rush', 'aurora_sovereign'],
    ])('replays identically for the same seed in one process (%s vs %s)', (ai1, ai2) => {
        const play = () => withSeededRandom(deriveGameSeed(1234, 0), () => {
            const state = createGameState(ai1, ai2, 'hard', 'small', 'medium', 'medium');
            const result = runGame(state, 1500, false, 0, true);
            return JSON.stringify(result);
        });

        const first = play();
        // A game with different seed in between must not influence the replay.
        withSeededRandom(deriveGameSeed(99, 1), () => {
            runGame(createGameState(ai1, ai2, 'hard', 'small', 'medium', 'medium'), 600, false, 1, true);
        });
        const second = play();

        expect(second).toBe(first);
    }, 60000);
});

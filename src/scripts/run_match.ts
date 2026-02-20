import { deriveGameSeed, withSeededRandom, createGameState, runGame } from './sim_runner.js';
import '../engine/ai/registry.js';

const [p0_ai, p1_ai, difficulty, mapSize, maxTicks, gameCounter, effectiveSeed] = process.argv.slice(2);

const runOneGame = () => {
    const state = createGameState(
        p0_ai, p1_ai,
        difficulty as 'easy' | 'medium' | 'hard',
        mapSize as 'small' | 'medium' | 'large' | 'huge',
        'medium', 'medium'
    );
    return runGame(state, parseInt(maxTicks, 10), false, parseInt(gameCounter, 10), true);
};

const gameSeed = deriveGameSeed(parseInt(effectiveSeed, 10), parseInt(gameCounter, 10));
const result = withSeededRandom(gameSeed, runOneGame);

// Output the stringified JSON to parse in parent process
console.log(JSON.stringify(result));

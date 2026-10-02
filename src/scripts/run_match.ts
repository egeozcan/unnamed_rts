import { deriveGameSeed, withSeededRandom, createGameState, runGame } from './sim_runner.js';
import { getAIImplementations } from '../engine/ai/registry.js';
import {
    DIFFICULTY_CHOICES,
    MAP_SIZE_CHOICES,
    parseAIIdArg,
    parseChoiceArg,
    parseIntegerArg,
    runCli
} from './cli_args.js';

// Usage: run_match.ts <p0_ai> <p1_ai> <difficulty> <mapSize> <maxTicks> <gameCounter> <seed>
// Invoked by tournament.ts; prints the GameResult as JSON on the last stdout line.
function main(): void {
    const [p0Raw, p1Raw, difficultyRaw, mapSizeRaw, maxTicksRaw, gameCounterRaw, seedRaw] = process.argv.slice(2);

    const knownAIs = getAIImplementations().map(ai => ai.id);
    const p0_ai = parseAIIdArg('<p0_ai>', p0Raw, knownAIs);
    const p1_ai = parseAIIdArg('<p1_ai>', p1Raw, knownAIs);
    const difficulty = parseChoiceArg('<difficulty>', difficultyRaw, DIFFICULTY_CHOICES);
    const mapSize = parseChoiceArg('<mapSize>', mapSizeRaw, MAP_SIZE_CHOICES);
    const maxTicks = parseIntegerArg('<maxTicks>', maxTicksRaw, 1);
    const gameCounter = parseIntegerArg('<gameCounter>', gameCounterRaw, 0);
    const effectiveSeed = parseIntegerArg('<seed>', seedRaw, 0);

    const runOneGame = () => {
        const state = createGameState(p0_ai, p1_ai, difficulty, mapSize, 'medium', 'medium');
        return runGame(state, maxTicks, false, gameCounter, true);
    };

    const gameSeed = deriveGameSeed(effectiveSeed, gameCounter);
    const result = withSeededRandom(gameSeed, runOneGame);

    // Output the stringified JSON to parse in parent process
    console.log(JSON.stringify(result));
}

runCli(main);

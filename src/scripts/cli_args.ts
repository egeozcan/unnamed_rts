/**
 * Small argument-validation helpers shared by the AI harness scripts
 * (simulate_ai, tournament, run_match).
 *
 * The scripts previously used bare parseInt / `as` casts, so a typo such as
 * `--ai1 clasic` or `--games abc` silently produced a meaningless run
 * (unknown AI ids fall back to "classic", NaN game counts yield an empty series).
 */

export class CliArgError extends Error {}

export function parseIntegerArg(flag: string, raw: string | undefined, min = 0): number {
    if (raw === undefined || raw.trim() === '' || !/^-?\d+$/.test(raw.trim())) {
        throw new CliArgError(`${flag} expects an integer, got ${raw === undefined ? 'nothing' : `"${raw}"`}`);
    }
    const value = parseInt(raw, 10);
    if (value < min) {
        throw new CliArgError(`${flag} must be >= ${min}, got ${value}`);
    }
    return value;
}

export function parseChoiceArg<T extends string>(flag: string, raw: string | undefined, choices: readonly T[]): T {
    if (raw === undefined || !(choices as readonly string[]).includes(raw)) {
        throw new CliArgError(`${flag} must be one of: ${choices.join(', ')} (got ${raw === undefined ? 'nothing' : `"${raw}"`})`);
    }
    return raw as T;
}

export function parseAIIdArg(flag: string, raw: string | undefined, knownIds: readonly string[]): string {
    if (raw === undefined || !knownIds.includes(raw)) {
        throw new CliArgError(`${flag} must be a registered AI implementation: ${knownIds.join(', ')} (got ${raw === undefined ? 'nothing' : `"${raw}"`})`);
    }
    return raw;
}

/** Runs a CLI entry point, printing validation errors without a stack trace. */
export function runCli(main: () => void | Promise<void>): void {
    Promise.resolve()
        .then(main)
        .catch(err => {
            if (err instanceof CliArgError) {
                console.error(`Error: ${err.message}`);
                process.exit(2);
            }
            console.error(err);
            process.exit(1);
        });
}

export const DIFFICULTY_CHOICES = ['easy', 'medium', 'hard'] as const;
export const MAP_SIZE_CHOICES = ['small', 'medium', 'large', 'huge'] as const;
export const DENSITY_CHOICES = ['low', 'medium', 'high'] as const;

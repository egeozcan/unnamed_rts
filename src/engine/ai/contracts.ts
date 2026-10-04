import { type Action, type GameState } from '../types.js';
import { type EntityCache } from '../perf.js';

export type AIImplementationDifficulty = 'dummy' | 'easy' | 'medium' | 'hard';

export interface AIImplementationContext {
    readonly state: GameState;
    readonly playerId: number;
    readonly difficulty: AIImplementationDifficulty;
    readonly entityCache?: EntityCache;
}

export interface AIImplementation {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
    computeActions(context: AIImplementationContext): Action[];
    reset?(playerId?: number): void;
}

export interface AIImplementationOption {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
}

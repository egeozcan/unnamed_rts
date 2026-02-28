import { GameState } from './types';

export type TeamId = 'A' | 'B' | 'C' | 'D';

export function sameTeam(state: GameState, p1: number, p2: number): boolean {
    const t1 = state.players[p1]?.team;
    const t2 = state.players[p2]?.team;
    return t1 != null && t1 === t2;
}

export function isAlly(state: GameState, p1: number, p2: number): boolean {
    return p1 === p2 || sameTeam(state, p1, p2);
}

export function isEnemy(state: GameState, p1: number, p2: number): boolean {
    return p1 !== p2 && !sameTeam(state, p1, p2);
}

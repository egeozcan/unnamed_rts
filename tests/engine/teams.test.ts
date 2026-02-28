import { describe, it, expect } from 'vitest';
import { sameTeam, isAlly, isEnemy } from '../../src/engine/teams';
import { GameState, PlayerState } from '../../src/engine/types';

function makeState(players: Record<number, Partial<PlayerState>>): GameState {
    const full: Record<number, PlayerState> = {};
    for (const [id, p] of Object.entries(players)) {
        full[Number(id)] = {
            id: Number(id), isAi: false, difficulty: 'medium', color: '#fff',
            credits: 0, maxPower: 0, usedPower: 0,
            queues: {
                building: { current: null, progress: 0, invested: 0 },
                infantry: { current: null, progress: 0, invested: 0 },
                vehicle: { current: null, progress: 0, invested: 0 },
                air: { current: null, progress: 0, invested: 0 },
            },
            readyToPlace: null,
            team: null,
            ...p,
        } as PlayerState;
    }
    return { players: full } as GameState;
}

describe('sameTeam', () => {
    it('returns true when both players have the same non-null team', () => {
        const state = makeState({ 0: { team: 'A' }, 1: { team: 'A' } });
        expect(sameTeam(state, 0, 1)).toBe(true);
    });

    it('returns false when players have different teams', () => {
        const state = makeState({ 0: { team: 'A' }, 1: { team: 'B' } });
        expect(sameTeam(state, 0, 1)).toBe(false);
    });

    it('returns false when both teams are null (FFA)', () => {
        const state = makeState({ 0: { team: null }, 1: { team: null } });
        expect(sameTeam(state, 0, 1)).toBe(false);
    });

    it('returns false when one team is null', () => {
        const state = makeState({ 0: { team: 'A' }, 1: { team: null } });
        expect(sameTeam(state, 0, 1)).toBe(false);
    });

    it('returns false when player does not exist', () => {
        const state = makeState({ 0: { team: 'A' } });
        expect(sameTeam(state, 0, 5)).toBe(false);
    });
});

describe('isAlly', () => {
    it('returns true for the same player', () => {
        const state = makeState({ 0: { team: null } });
        expect(isAlly(state, 0, 0)).toBe(true);
    });

    it('returns true for teammates', () => {
        const state = makeState({ 0: { team: 'B' }, 1: { team: 'B' } });
        expect(isAlly(state, 0, 1)).toBe(true);
    });

    it('returns false for non-teammates', () => {
        const state = makeState({ 0: { team: 'A' }, 1: { team: 'B' } });
        expect(isAlly(state, 0, 1)).toBe(false);
    });

    it('returns false for FFA players', () => {
        const state = makeState({ 0: { team: null }, 1: { team: null } });
        expect(isAlly(state, 0, 1)).toBe(false);
    });
});

describe('isEnemy', () => {
    it('returns false for the same player', () => {
        const state = makeState({ 0: { team: null } });
        expect(isEnemy(state, 0, 0)).toBe(false);
    });

    it('returns false for teammates', () => {
        const state = makeState({ 0: { team: 'C' }, 1: { team: 'C' } });
        expect(isEnemy(state, 0, 1)).toBe(false);
    });

    it('returns true for different teams', () => {
        const state = makeState({ 0: { team: 'A' }, 1: { team: 'B' } });
        expect(isEnemy(state, 0, 1)).toBe(true);
    });

    it('returns true for FFA players', () => {
        const state = makeState({ 0: { team: null }, 1: { team: null } });
        expect(isEnemy(state, 0, 1)).toBe(true);
    });
});

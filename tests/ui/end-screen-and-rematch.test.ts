// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { formatGameTime, saveRematchConfig, takeRematchConfig, REMATCH_STORAGE_KEY } from '../../src/game-utils';
import { buildEndResultsHtml, getWinningPlayerIds } from '../../src/ui/end-screen';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import type { GameState, SkirmishConfig } from '../../src/engine/types';

function memoryStorage(): Storage {
    const data = new Map<string, string>();
    return {
        get length() { return data.size; },
        clear: () => data.clear(),
        getItem: (k: string) => data.get(k) ?? null,
        key: (i: number) => Array.from(data.keys())[i] ?? null,
        removeItem: (k: string) => { data.delete(k); },
        setItem: (k: string, v: string) => { data.set(k, String(v)); }
    };
}

const config: SkirmishConfig = {
    players: [
        { slot: 0, type: 'human', color: '#4488ff', team: null },
        { slot: 1, type: 'hard', color: '#ff4444', aiImplementationId: 'classic', team: null }
    ],
    mapSize: 'small',
    resourceDensity: 'medium',
    rockDensity: 'low',
    fogOfWarEnabled: true
};

describe('Play Again config hand-off', () => {
    it('round-trips once and is cleared after reading', () => {
        const storage = memoryStorage();
        expect(saveRematchConfig(storage, config)).toBe(true);
        expect(takeRematchConfig(storage)).toEqual(config);
        expect(takeRematchConfig(storage)).toBeNull();
    });

    it('ignores missing storage, garbage and unstartable setups', () => {
        expect(takeRematchConfig(null)).toBeNull();
        const storage = memoryStorage();
        storage.setItem(REMATCH_STORAGE_KEY, '{not json');
        expect(takeRematchConfig(storage)).toBeNull();
        storage.setItem(REMATCH_STORAGE_KEY, JSON.stringify({ ...config, players: [config.players[0]] }));
        expect(takeRematchConfig(storage)).toBeNull();
        storage.setItem(REMATCH_STORAGE_KEY, JSON.stringify({ ...config, mapSize: 'galactic' }));
        expect(takeRematchConfig(storage)).toBeNull();
    });
});

describe('formatGameTime', () => {
    it('formats ticks (60 per game second) as m:ss / h:mm:ss', () => {
        expect(formatGameTime(0)).toBe('0:00');
        expect(formatGameTime(60 * 75)).toBe('1:15');
        expect(formatGameTime(60 * 3725)).toBe('1:02:05');
    });
});

describe('end screen results', () => {
    let state: GameState;

    beforeEach(() => {
        state = {
            ...INITIAL_STATE,
            tick: 60 * 90 + 7, // a fresh tick so the score cache is not reused
            winner: 0,
            players: {
                0: createPlayerState(0, false, 'medium', '#4488ff', 'classic', 'A'),
                1: createPlayerState(1, true, 'hard', '#ff4444', 'classic', 'B'),
                2: createPlayerState(2, true, 'easy', '#44ff88', 'classic', 'A')
            },
            entities: {}
        } as GameState;
    });

    it('counts the winner\'s teammates as winners', () => {
        expect([...getWinningPlayerIds(state)].sort()).toEqual([0, 2]);
        expect(getWinningPlayerIds({ ...state, winner: -1 }).size).toBe(0);
    });

    it('lists every player with game time, scores, difficulty and status', () => {
        document.body.innerHTML = `<div>${buildEndResultsHtml(state, { localPlayerId: 0 })}</div>`;
        expect(document.querySelector('.end-time')?.textContent).toContain('1:30');
        const rows = Array.from(document.querySelectorAll('.end-table tbody tr'));
        expect(rows).toHaveLength(3);
        // Winners first; the local player is called out
        const localRow = rows.find(r => r.classList.contains('local'));
        expect(localRow?.textContent).toContain('You');
        expect(rows.indexOf(localRow!)).toBeLessThan(2);
        expect(rows.slice(0, 2).every(r => r.textContent?.includes('Winner'))).toBe(true);
        expect(rows[2].textContent).toContain('Player 2');
        expect(rows[2].textContent).toContain('Hard');
        expect(rows[2].textContent).toContain('Eliminated');
        expect(document.querySelectorAll('.end-table th')).toHaveLength(4);
    });
});

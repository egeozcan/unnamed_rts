// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameState } from '../../src/engine/types';

const { calculatePlayerScoresMock } = vi.hoisted(() => ({ calculatePlayerScoresMock: vi.fn() }));

vi.mock('../../src/engine/scores.js', () => ({
    calculatePlayerScores: calculatePlayerScoresMock
}));

function state(tick: number): GameState {
    return {
        tick,
        players: { 1: { isAi: true, difficulty: 'hard', team: null, aiImplementationId: 'classic' } }
    } as unknown as GameState;
}

describe('scoreboard toggle and final refresh', () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '';
        const data = new Map<string, string>();
        Object.defineProperty(window, 'localStorage', {
            configurable: true,
            value: {
                getItem: (k: string) => data.get(k) ?? null,
                setItem: (k: string, v: string) => { data.set(k, String(v)); },
                removeItem: (k: string) => { data.delete(k); },
                clear: () => data.clear()
            }
        });
        calculatePlayerScoresMock.mockReset();
        calculatePlayerScoresMock.mockReturnValue([
            { playerId: 1, color: '#f44', military: 1000, economy: 500, total: 1500, isEliminated: false }
        ]);
    });

    it('collapses from its header button, remembers it, and labels the bars', async () => {
        const sb = await import('../../src/ui/scoreboard.js');
        sb.initScoreboard();
        sb.updateScoreboard(state(5), 0);

        const toggle = document.querySelector('.scoreboard-toggle') as HTMLButtonElement;
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(document.querySelector('.scoreboard-legend')?.textContent).toMatch(/Military[\s\S]*Economy/);
        expect(document.querySelector('.score-ai-name')?.textContent).toBe('Hard · Classic');

        toggle.click();
        expect(document.querySelector('.scoreboard')?.classList.contains('collapsed')).toBe(true);
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        expect(window.localStorage.getItem('rts.scoreboardCollapsed')).toBe('1');
    });

    it('re-renders on a forced update even when the tick has not advanced', async () => {
        const sb = await import('../../src/ui/scoreboard.js');
        sb.initScoreboard();
        sb.updateScoreboard(state(100), 0);
        expect(document.querySelectorAll('.score-row')).toHaveLength(1);

        // The last opponent is eliminated on the final tick; the game stops, the tick stays put
        calculatePlayerScoresMock.mockReturnValue([
            { playerId: 1, color: '#f44', military: 0, economy: 0, total: 0, isEliminated: true }
        ]);
        sb.updateScoreboard(state(100), 5000);
        expect(document.querySelectorAll('.score-row')).toHaveLength(1);
        sb.updateScoreboard(state(100), 5000, true);
        expect(document.querySelectorAll('.score-row')).toHaveLength(0);
    });
});

describe('alerts live region', () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '';
    });

    it('shows routine "Unit ready" alerts without announcing them; announces important ones', async () => {
        const alerts = await import('../../src/ui/alerts.js');
        alerts.pushAlert('Unit ready: Rifleman', 'info', 'unit-ready:rifle', 1500);
        expect(document.getElementById('alerts')?.textContent).toContain('Unit ready');
        expect(document.getElementById('alerts')?.getAttribute('aria-live')).toBeNull();
        expect(document.getElementById('alerts-live')?.textContent ?? '').toBe('');

        alerts.pushAlert('Our base is under attack!', 'error', 'base-attack', 20000);
        const live = document.getElementById('alerts-live')!;
        expect(live.getAttribute('aria-live')).toBe('polite');
        expect(live.textContent).toBe('Our base is under attack!');

        // Routine follow-ups right after are rate limited
        alerts.pushAlert('Construction complete: Barracks', 'success');
        expect(live.textContent).toBe('Our base is under attack!');
    });
});

describe('pause and help dialogs', () => {
    beforeEach(() => {
        vi.resetModules();
        document.body.innerHTML = '<button id="opener">open</button>';
    });

    it('are modal dialogs that take focus and hand it back on close', async () => {
        const menu = await import('../../src/ui/pause-menu.js');
        menu.initPauseMenu(() => {}, () => {});
        const opener = document.getElementById('opener') as HTMLButtonElement;
        opener.focus();

        menu.showPauseMenu();
        expect(document.querySelector('.pause-modal')?.getAttribute('aria-modal')).toBe('true');
        expect(document.activeElement?.id).toBe('pause-resume');

        menu.hidePauseMenu();
        expect(document.activeElement).toBe(opener);

        opener.focus();
        menu.showHelp(() => {});
        expect(document.querySelector('.help-modal')?.getAttribute('aria-modal')).toBe('true');
        expect(document.activeElement?.classList.contains('help-tab')).toBe(true);
        menu.closeHelp();
        expect(document.activeElement).toBe(opener);
    });

    it('starts each help tab scrolled to the top', async () => {
        const menu = await import('../../src/ui/pause-menu.js');
        menu.showHelp(() => {});
        const content = document.querySelector('.help-content') as HTMLElement;
        content.scrollTop = 58;
        (document.querySelector('.help-tab[data-tab="shortcuts"]') as HTMLButtonElement).click();
        expect(content.scrollTop).toBe(0);
        expect(document.querySelector('.help-tab[data-tab="shortcuts"]')?.getAttribute('aria-selected')).toBe('true');
    });
});

describe('skirmish setup labels', () => {
    it('names every slot select and describes the slot being edited', async () => {
        document.body.innerHTML = `
            <div class="player-slot">
                <select class="player-team"><option value="">FFA</option></select>
                <select class="player-type"><option value="hard" selected>Hard</option></select>
                <select class="ai-implementation"><option value="classic" selected>Classic</option></select>
            </div>
            <div id="setup-description"></div>`;
        const { enhanceSkirmishSetup } = await import('../../src/ui/skirmish-setup.js');
        enhanceSkirmishSetup([{ id: 'classic', name: 'Classic', description: 'Built-in AI.' }]);

        expect(document.querySelector('.player-team')?.getAttribute('aria-label')).toBe('Player 1 team');
        expect(document.querySelector('.player-type')?.getAttribute('aria-label')).toContain('Player 1');
        expect(document.querySelector('.ai-implementation')?.getAttribute('aria-label')).toBe('Player 1 AI personality');

        document.querySelector('.player-type')!.dispatchEvent(new Event('focus'));
        const text = document.getElementById('setup-description')?.textContent ?? '';
        expect(text).toContain('Hard AI');
        expect(text).toContain('Classic: Built-in AI.');
    });
});

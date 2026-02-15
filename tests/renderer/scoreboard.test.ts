import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calculatePlayerScoresMock } = vi.hoisted(() => ({
    calculatePlayerScoresMock: vi.fn()
}));

vi.mock('../../src/engine/scores.js', () => ({
    calculatePlayerScores: calculatePlayerScoresMock
}));

type ScoreboardModule = typeof import('../../src/ui/scoreboard.js');

function createState(tick: number) {
    return { tick } as import('../../src/engine/types').GameState;
}

describe('Scoreboard cadence', () => {
    let scoreboard: ScoreboardModule;

    beforeEach(async () => {
        vi.resetModules();
        calculatePlayerScoresMock.mockReset();
        calculatePlayerScoresMock.mockReturnValue([{
            playerId: 0,
            color: '#44ff88',
            military: 1200,
            economy: 800,
            total: 2000,
            isEliminated: false
        }]);
        document.body.innerHTML = '';
        scoreboard = await import('../../src/ui/scoreboard.js');
        scoreboard.initScoreboard();
    });

    it('updates for non-multiple tick values when cadence thresholds are met', () => {
        scoreboard.updateScoreboard(createState(7), 0);
        scoreboard.updateScoreboard(createState(27), 130);
        scoreboard.updateScoreboard(createState(47), 260);

        expect(calculatePlayerScoresMock).toHaveBeenCalledTimes(3);
        expect(document.querySelectorAll('.score-row').length).toBe(1);
    });

    it('does not update every frame during lightspeed-like tick jumps', () => {
        scoreboard.updateScoreboard(createState(1), 0);
        scoreboard.updateScoreboard(createState(21), 16);
        scoreboard.updateScoreboard(createState(41), 32);
        scoreboard.updateScoreboard(createState(61), 48);
        scoreboard.updateScoreboard(createState(81), 120);

        expect(calculatePlayerScoresMock).toHaveBeenCalledTimes(2);
    });

    it('recovers cadence after tick regression', () => {
        scoreboard.updateScoreboard(createState(47), 0);
        scoreboard.updateScoreboard(createState(67), 140);
        scoreboard.updateScoreboard(createState(7), 150);
        scoreboard.updateScoreboard(createState(27), 170);
        scoreboard.updateScoreboard(createState(27), 280);

        expect(calculatePlayerScoresMock).toHaveBeenCalledTimes(4);
    });
});

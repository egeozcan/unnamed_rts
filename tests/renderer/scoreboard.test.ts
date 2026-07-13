import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calculatePlayerScoresMock, getAIImplementationMock, getAIStateMock } = vi.hoisted(() => ({
    calculatePlayerScoresMock: vi.fn(),
    getAIImplementationMock: vi.fn(),
    getAIStateMock: vi.fn()
}));

vi.mock('../../src/engine/scores.js', () => ({
    calculatePlayerScores: calculatePlayerScoresMock
}));

vi.mock('../../src/engine/ai/index.js', () => ({
    DEFAULT_AI_IMPLEMENTATION_ID: 'classic',
    getAIImplementation: getAIImplementationMock,
    getAIState: getAIStateMock
}));

type ScoreboardModule = typeof import('../../src/ui/scoreboard.js');

function createState(tick: number, players: Record<number, Partial<import('../../src/engine/types').PlayerState>> = {}) {
    return { tick, players } as import('../../src/engine/types').GameState;
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
        getAIStateMock.mockReset();
        getAIStateMock.mockReturnValue({ personality: 'balanced' });
        getAIImplementationMock.mockReset();
        getAIImplementationMock.mockReturnValue({ id: 'classic', name: 'Classic' });
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

    it('shows compact player team and AI implementation name in each active score row', () => {
        calculatePlayerScoresMock.mockReturnValue([{
            playerId: 1,
            color: '#ff4444',
            military: 30000,
            economy: 20000,
            total: 50000,
            isEliminated: false
        }]);
        getAIStateMock.mockReturnValue({ personality: 'rusher' });
        getAIImplementationMock.mockReturnValue({
            id: 'engineer_conyard_rush',
            name: 'Engineer Conyard Rush'
        });

        scoreboard.updateScoreboard(createState(7, {
            1: {
                isAi: true,
                team: 'B',
                aiImplementationId: 'engineer_conyard_rush'
            }
        }), 0);

        const row = document.querySelector('.score-row');
        expect(row?.textContent).toContain('P2');
        expect(row?.textContent).toContain('(B)');
        expect(row?.textContent).toContain('Engineer Conyard Rush');
        expect(row?.textContent).not.toContain('Team B');
        expect(row?.textContent).not.toContain('rusher');
        expect(getAIImplementationMock).toHaveBeenCalledWith('engineer_conyard_rush');
    });
});

/**
 * End-of-match results: the panel shown over the battlefield when the game is won/lost (or the
 * human was eliminated) - game time, per-player scores and who won.
 */
import { type GameState } from '../engine/types.js';
import { calculatePlayerScores } from '../engine/scores.js';
import { formatGameTime } from '../game-utils.js';
import { escapeHtml, getPlayerAILabel } from './scoreboard.js';

export interface EndResultsOptions {
    /** The local human (still playing or eliminated), or null for an all-AI match. */
    localPlayerId: number | null;
}

/** Players who share the winning side (the winner and its teammates). Empty for a draw / no winner. */
export function getWinningPlayerIds(state: GameState): Set<number> {
    const winners = new Set<number>();
    if (state.winner === null || state.winner === -1) return winners;
    const winnerTeam = state.players[state.winner]?.team ?? null;
    for (const key of Object.keys(state.players)) {
        const id = Number(key);
        if (id === state.winner || (winnerTeam !== null && state.players[id]?.team === winnerTeam)) {
            winners.add(id);
        }
    }
    return winners;
}

function formatScore(value: number): string {
    return value >= 10000 ? `${(value / 1000).toFixed(1)}k` : Math.round(value).toLocaleString('en-US');
}

/** Results markup: game time plus a table of every player's final scores. */
export function buildEndResultsHtml(state: GameState, options: EndResultsOptions): string {
    const scores = calculatePlayerScores(state);
    const winners = getWinningPlayerIds(state);
    const sorted = [...scores].sort((a, b) => {
        const winDiff = Number(winners.has(b.playerId)) - Number(winners.has(a.playerId));
        if (winDiff !== 0) return winDiff;
        const elimDiff = Number(a.isEliminated) - Number(b.isEliminated);
        if (elimDiff !== 0) return elimDiff;
        return b.total - a.total;
    });

    const rows = sorted.map(score => {
        const player = state.players[score.playerId];
        const isLocal = options.localPlayerId === score.playerId;
        const name = isLocal ? 'You' : `Player ${score.playerId + 1}`;
        const aiLabel = getPlayerAILabel(player);
        const team = player?.team ? `Team ${player.team}` : '';
        const detail = [team, aiLabel].filter(Boolean).join(' · ');
        let status = '';
        if (winners.has(score.playerId)) status = '<span class="end-status won">Winner</span>';
        else if (score.isEliminated) status = '<span class="end-status out">Eliminated</span>';
        return `
            <tr class="${isLocal ? 'local' : ''}">
                <td class="end-player">
                    <span class="end-dot" style="background:${escapeHtml(score.color)}"></span>
                    <span class="end-name">${escapeHtml(name)}</span>
                    ${status}
                    ${detail ? `<span class="end-detail">${escapeHtml(detail)}</span>` : ''}
                </td>
                <td>${formatScore(score.military)}</td>
                <td>${formatScore(score.economy)}</td>
                <td class="end-total">${formatScore(score.total)}</td>
            </tr>`;
    }).join('');

    return `
        <div class="end-time">Game time <strong>${formatGameTime(state.tick)}</strong></div>
        <div class="end-table-wrap">
            <table class="end-table">
                <thead><tr><th scope="col">Player</th><th scope="col">Military</th><th scope="col">Economy</th><th scope="col">Score</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

/** Fill the end screen's results panel. */
export function renderEndResults(state: GameState, options: EndResultsOptions): void {
    const el = document.getElementById('end-results');
    if (el) el.innerHTML = buildEndResultsHtml(state, options);
}

/**
 * Keep the end screen over the battlefield (the canvas), not the whole window, so it doesn't run
 * under the sidebar.
 */
export function positionEndScreen(): void {
    const endScreen = document.getElementById('end-screen');
    const canvas = document.getElementById('gameCanvas');
    if (!endScreen || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
        endScreen.style.removeProperty('left');
        endScreen.style.removeProperty('top');
        endScreen.style.removeProperty('width');
        endScreen.style.removeProperty('height');
        return;
    }
    endScreen.style.left = `${rect.left}px`;
    endScreen.style.top = `${rect.top}px`;
    endScreen.style.width = `${rect.width}px`;
    endScreen.style.height = `${rect.height}px`;
}

let resizeListenerAdded = false;

/** Show the end screen over the battlefield and move focus to it. */
export function showEndScreen(): void {
    const endScreen = document.getElementById('end-screen');
    if (!endScreen) return;
    positionEndScreen();
    if (!resizeListenerAdded) {
        resizeListenerAdded = true;
        window.addEventListener('resize', () => {
            if (document.getElementById('end-screen')?.classList.contains('visible')) positionEndScreen();
        });
    }
    endScreen.classList.add('visible');
    // Focus the panel, not a button: a stray Enter (the Deploy MCV key) or Space mid-fight must not
    // trigger Play Again. Tab reaches the buttons.
    if (!endScreen.hasAttribute('tabindex')) endScreen.setAttribute('tabindex', '-1');
    endScreen.focus({ preventScroll: true });
}


import { GameState } from '../engine/types.js';
import { calculatePlayerScores, PlayerScore } from '../engine/scores.js';
import { DEFAULT_AI_IMPLEMENTATION_ID, getAIImplementation } from '../engine/ai/index.js';
import { shouldRunCadencedUpdate } from './cadence.js';

let scoreboardContainer: HTMLElement | null = null;
let lastScoreboardTick = -1;
let lastScoreboardTimeMs = -Infinity;

const SCOREBOARD_MIN_TICK_DELTA = 10;
const SCOREBOARD_MIN_TIME_DELTA_MS = 120;

export function initScoreboard() {
    // Reset cadence state for new games/HMR remounts.
    lastScoreboardTick = -1;
    lastScoreboardTimeMs = -Infinity;

    // Create container if it doesn't exist
    if (!scoreboardContainer) {
        scoreboardContainer = document.createElement('div');
        scoreboardContainer.id = 'scoreboard';
        scoreboardContainer.className = 'scoreboard';
        document.body.appendChild(scoreboardContainer);
    }
}

export function updateScoreboard(state: GameState, nowMs?: number) {
    if (!scoreboardContainer) return;

    const currentTimeMs = nowMs ?? (
        typeof performance !== 'undefined' ? performance.now() : Date.now()
    );
    if (!shouldRunCadencedUpdate({
        currentTick: state.tick,
        currentTimeMs,
        lastTick: lastScoreboardTick,
        lastTimeMs: lastScoreboardTimeMs,
        minTickDelta: SCOREBOARD_MIN_TICK_DELTA,
        minTimeDeltaMs: SCOREBOARD_MIN_TIME_DELTA_MS
    })) {
        return;
    }

    lastScoreboardTick = state.tick;
    lastScoreboardTimeMs = currentTimeMs;

    const scores = calculatePlayerScores(state);
    // Filter out eliminated players (no buildings and no MCV)
    const activeScores = scores.filter(s => !s.isEliminated);
    const maxScore = Math.max(...activeScores.map(s => Math.max(s.military, s.economy)), 1);

    // Build HTML for the scoreboard
    // We rebuild the innerHTML for simplicity, but could optimize to update individual elements if needed
    scoreboardContainer.innerHTML = activeScores.map(score => createPlayerRow(score, maxScore, state)).join('');
}

function createPlayerRow(score: PlayerScore, maxScore: number, state: GameState): string {
    const militaryWidth = (score.military / maxScore) * 100;
    const economyWidth = (score.economy / maxScore) * 100;
    const totalScoreK = (score.total / 1000).toFixed(1) + 'k';
    const player = state.players?.[score.playerId];
    const playerLabel = `P${score.playerId + 1}`;
    const teamLabel = player?.team ? `(${player.team})` : '(FFA)';
    const aiNameLabel = getAINameLabel(player);
    const rowTitleParts = [playerLabel, teamLabel, aiNameLabel].filter(Boolean);

    return `
        <div class="score-row" title="${escapeHtml(rowTitleParts.join(' · '))}">
            <div class="player-indicator" style="background-color: ${score.color}; box-shadow: 0 0 8px ${score.color}"></div>
            <div class="score-details">
                <div class="score-meta">
                    <span class="score-player">${escapeHtml(playerLabel)}</span>
                    <span class="score-team">${escapeHtml(teamLabel)}</span>
                    ${aiNameLabel ? `<span class="score-ai-name">${escapeHtml(aiNameLabel)}</span>` : ''}
                </div>
                <div class="score-bars">
                    <div class="score-bar-container">
                        <div class="score-bar military" style="width: ${militaryWidth}%"></div>
                    </div>
                    <div class="score-bar-container">
                        <div class="score-bar economy" style="width: ${economyWidth}%"></div>
                    </div>
                </div>
            </div>
            <div class="total-score">${totalScoreK}</div>
        </div>
    `;
}

function getAINameLabel(player: GameState['players'][number] | undefined): string {
    if (!player?.isAi) return '';

    const implementationId = player.aiImplementationId || DEFAULT_AI_IMPLEMENTATION_ID;
    return getAIImplementation(implementationId)?.name || implementationId;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function showScoreboard(show: boolean) {
    if (scoreboardContainer) {
        scoreboardContainer.style.display = show ? 'flex' : 'none';
    }
}

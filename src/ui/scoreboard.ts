
import { GameState } from '../engine/types.js';
import { calculatePlayerScores, PlayerScore } from '../engine/scores.js';
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
    scoreboardContainer.innerHTML = activeScores.map(score => createPlayerRow(score, maxScore)).join('');
}

function createPlayerRow(score: PlayerScore, maxScore: number): string {
    const militaryWidth = (score.military / maxScore) * 100;
    const economyWidth = (score.economy / maxScore) * 100;
    const totalScoreK = (score.total / 1000).toFixed(1) + 'k';

    return `
        <div class="score-row">
            <div class="player-indicator" style="background-color: ${score.color}; box-shadow: 0 0 8px ${score.color}"></div>
            <div class="score-bars">
                <div class="score-bar-container">
                    <div class="score-bar military" style="width: ${militaryWidth}%"></div>
                </div>
                <div class="score-bar-container">
                    <div class="score-bar economy" style="width: ${economyWidth}%"></div>
                </div>
            </div>
            <div class="total-score">${totalScoreK}</div>
        </div>
    `;
}

export function showScoreboard(show: boolean) {
    if (scoreboardContainer) {
        scoreboardContainer.style.display = show ? 'flex' : 'none';
    }
}

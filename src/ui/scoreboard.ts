
import { GameState } from '../engine/types.js';
import { calculatePlayerScores, PlayerScore } from '../engine/scores.js';

let scoreboardContainer: HTMLElement | null = null;
let lastUpdateTick = -1;

export function initScoreboard() {
    // Create container if it doesn't exist
    if (!scoreboardContainer) {
        scoreboardContainer = document.createElement('div');
        scoreboardContainer.id = 'scoreboard';
        scoreboardContainer.className = 'scoreboard';
        document.body.appendChild(scoreboardContainer);
    }
}

export function updateScoreboard(state: GameState) {
    if (!scoreboardContainer) return;

    // Throttle updates to every 10 ticks to save DOM operations
    if (state.tick === lastUpdateTick || state.tick % 10 !== 0) return;
    lastUpdateTick = state.tick;

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

import { GameState } from '../engine/types.js';
import { calculatePlayerScores, PlayerScore } from '../engine/scores.js';
import { DEFAULT_AI_IMPLEMENTATION_ID, getAIImplementation } from '../engine/ai/index.js';
import { shouldRunCadencedUpdate } from './cadence.js';

let scoreboardContainer: HTMLElement | null = null;
let scoreRowsContainer: HTMLElement | null = null;
let toggleButton: HTMLButtonElement | null = null;
let lastScoreboardTick = -1;
let lastScoreboardTimeMs = -Infinity;
let lastScoreboardHtml = '';

const SCOREBOARD_MIN_TICK_DELTA = 10;
const SCOREBOARD_MIN_TIME_DELTA_MS = 120;
const COLLAPSED_STORAGE_KEY = 'rts.scoreboardCollapsed';
/** Short landscape screens (phones): the scoreboard would cover half the battlefield, so start collapsed. */
const SHORT_SCREEN_QUERY = '(max-height: 500px)';

const DIFFICULTY_LABELS: Record<string, string> = {
    dummy: 'Dummy',
    easy: 'Easy',
    medium: 'Medium',
    hard: 'Hard'
};

function readCollapsedPreference(): boolean {
    try {
        const stored = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
        if (stored === '1') return true;
        if (stored === '0') return false;
    } catch {
        // Storage blocked: fall through to the screen-size default
    }
    try {
        return typeof window.matchMedia === 'function' && window.matchMedia(SHORT_SCREEN_QUERY).matches;
    } catch {
        return false;
    }
}

function storeCollapsedPreference(collapsed: boolean): void {
    try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
        // Not critical
    }
}

/** Collapse the scoreboard to its header (or expand it again). */
export function setScoreboardCollapsed(collapsed: boolean, remember = true): void {
    if (!scoreboardContainer) return;
    scoreboardContainer.classList.toggle('collapsed', collapsed);
    if (toggleButton) {
        toggleButton.setAttribute('aria-expanded', String(!collapsed));
        toggleButton.title = collapsed ? 'Show scores' : 'Hide scores';
    }
    if (remember) storeCollapsedPreference(collapsed);
}

export function isScoreboardCollapsed(): boolean {
    return scoreboardContainer?.classList.contains('collapsed') ?? false;
}

export function toggleScoreboard(): void {
    setScoreboardCollapsed(!isScoreboardCollapsed());
}

export function initScoreboard() {
    // Reset cadence state for new games/HMR remounts.
    lastScoreboardTick = -1;
    lastScoreboardTimeMs = -Infinity;
    lastScoreboardHtml = '';

    // Create container if it doesn't exist (or was removed, e.g. by a test resetting the DOM)
    if (!scoreboardContainer || !scoreboardContainer.isConnected) {
        scoreboardContainer = document.createElement('div');
        scoreboardContainer.id = 'scoreboard';
        scoreboardContainer.className = 'scoreboard';
        scoreboardContainer.setAttribute('aria-label', 'Scores');
        scoreboardContainer.innerHTML = `
            <div class="scoreboard-header">
                <button type="button" class="scoreboard-toggle" aria-controls="scoreboard-rows" aria-expanded="true">
                    <span class="scoreboard-chevron" aria-hidden="true"></span>Scores
                </button>
                <div class="scoreboard-legend" aria-hidden="true">
                    <span class="legend-swatch military"></span>Military
                    <span class="legend-swatch economy"></span>Economy
                </div>
            </div>
            <div class="score-rows" id="scoreboard-rows"></div>
        `;
        document.body.appendChild(scoreboardContainer);
        scoreRowsContainer = scoreboardContainer.querySelector('.score-rows');
        toggleButton = scoreboardContainer.querySelector('.scoreboard-toggle');
        toggleButton?.addEventListener('click', () => {
            toggleScoreboard();
            // Don't keep focus: Space/Enter are game hotkeys
            toggleButton?.blur();
        });
        setScoreboardCollapsed(readCollapsedPreference(), false);
    }
}

/**
 * Re-render the scoreboard. Throttled to the tick/time cadence unless `force` is set
 * (the game end, when the tick stops advancing but the final result must still show).
 */
export function updateScoreboard(state: GameState, nowMs?: number, force = false) {
    if (!scoreboardContainer || !scoreRowsContainer) return;

    const currentTimeMs = nowMs ?? (
        typeof performance !== 'undefined' ? performance.now() : Date.now()
    );
    if (!force && !shouldRunCadencedUpdate({
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

    // Build HTML for the scoreboard. Replacing innerHTML tears down and re-creates every row (and
    // re-blurs the translucent backdrop), so only do it when the markup actually changed.
    const html = activeScores.map(score => createPlayerRow(score, maxScore, state)).join('');
    if (html === lastScoreboardHtml && scoreRowsContainer.childElementCount > 0) return;
    lastScoreboardHtml = html;
    scoreRowsContainer.innerHTML = html;
}

/** "Medium · Classic" for an AI player, '' for a human. */
export function getPlayerAILabel(player: GameState['players'][number] | undefined): string {
    if (!player?.isAi) return '';
    const difficulty = DIFFICULTY_LABELS[player.difficulty] ?? '';
    const aiName = getAINameLabel(player);
    return [difficulty, aiName].filter(Boolean).join(' · ');
}

function createPlayerRow(score: PlayerScore, maxScore: number, state: GameState): string {
    const militaryWidth = (score.military / maxScore) * 100;
    const economyWidth = (score.economy / maxScore) * 100;
    const totalScoreK = (score.total / 1000).toFixed(1) + 'k';
    const player = state.players?.[score.playerId];
    // The local player is the only human in a skirmish; call them out so they can find themselves
    const playerLabel = player && !player.isAi ? 'You' : `P${score.playerId + 1}`;
    const teamLabel = player?.team ? `(${player.team})` : '(FFA)';
    const aiNameLabel = getPlayerAILabel(player);
    const rowTitleParts = [playerLabel, teamLabel, aiNameLabel].filter(Boolean);
    const militaryK = (score.military / 1000).toFixed(1) + 'k';
    const economyK = (score.economy / 1000).toFixed(1) + 'k';

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
                    <div class="score-bar-container" title="Military ${militaryK}" aria-label="Military ${militaryK}">
                        <div class="score-bar military" style="width: ${militaryWidth}%"></div>
                    </div>
                    <div class="score-bar-container" title="Economy ${economyK}" aria-label="Economy ${economyK}">
                        <div class="score-bar economy" style="width: ${economyWidth}%"></div>
                    </div>
                </div>
            </div>
            <div class="total-score" title="Total score">${totalScoreK}</div>
        </div>
    `;
}

function getAINameLabel(player: GameState['players'][number] | undefined): string {
    if (!player?.isAi) return '';

    const implementationId = player.aiImplementationId || DEFAULT_AI_IMPLEMENTATION_ID;
    return getAIImplementation(implementationId)?.name || implementationId;
}

export function escapeHtml(value: string): string {
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

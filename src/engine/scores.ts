/**
 * Player score calculation utilities.
 * Provides military and economy scores for visual comparison of player strength.
 */

import { GameState, PLAYER_COLORS } from './types.js';
import { RULES } from '../data/schemas/index.js';
import { isUnit, isBuilding } from './type-guards.js';

export interface PlayerScore {
    playerId: number;
    color: string;
    military: number;
    economy: number;
    total: number;
    isEliminated: boolean;
}

// Cache for score calculation - avoids recalculating every frame
let cachedTick = -1;
let cachedScores: PlayerScore[] = [];

// Buildings considered part of military score
const MILITARY_BUILDINGS = new Set(['turret', 'sam_site', 'pillbox', 'obelisk']);

// Buildings considered part of economy score
const ECONOMY_BUILDINGS = new Set(['refinery', 'power', 'conyard', 'factory', 'barracks', 'tech', 'airforce_command', 'service_depot']);

/**
 * Calculate scores for all active players.
 * Results are cached per tick for performance.
 */
export function calculatePlayerScores(state: GameState): PlayerScore[] {
    // Return cached result if tick hasn't changed
    if (cachedTick === state.tick) {
        return cachedScores;
    }

    const playerIds = Object.keys(state.players).map(Number);
    const scores: PlayerScore[] = [];

    for (const playerId of playerIds) {
        const player = state.players[playerId];
        let military = 0;
        let economy = player.credits; // Start with current credits
        let hasBuildings = false;
        let hasMCV = false;

        // Iterate through entities once
        for (const id in state.entities) {
            const entity = state.entities[id];
            if (entity.dead || entity.owner !== playerId) continue;

            const hpRatio = entity.hp / entity.maxHp;

            if (isUnit(entity)) {
                const unitData = RULES.units[entity.key];
                if (!unitData) continue;

                const value = hpRatio * unitData.cost;

                if (entity.key === 'harvester') {
                    // Harvesters contribute to economy, including their cargo
                    const harvester = entity as import('./types.js').HarvesterUnit;
                    economy += value + harvester.harvester.cargo;
                } else if (entity.key === 'mcv') {
                    // MCV is economic (can become a conyard)
                    economy += value;
                    hasMCV = true;
                } else {
                    // Combat units contribute to military
                    military += value;
                }
            } else if (isBuilding(entity)) {
                hasBuildings = true;
                const buildingData = RULES.buildings[entity.key];
                if (!buildingData) continue;

                const value = hpRatio * buildingData.cost;

                if (MILITARY_BUILDINGS.has(entity.key)) {
                    military += value;
                } else if (ECONOMY_BUILDINGS.has(entity.key)) {
                    economy += value;
                }
            }
        }

        // Player is eliminated if they have no buildings AND no MCV
        const isEliminated = !hasBuildings && !hasMCV;

        scores.push({
            playerId,
            color: player.color || PLAYER_COLORS[playerId] || '#888888',
            military: Math.round(military),
            economy: Math.round(economy),
            total: Math.round(military + economy),
            isEliminated
        });
    }

    // Sort by total score descending for display
    scores.sort((a, b) => b.total - a.total);

    // Update cache
    cachedTick = state.tick;
    cachedScores = scores;

    return scores;
}

/**
 * Clear the score cache. Call when loading a new game state.
 */
export function clearScoreCache(): void {
    cachedTick = -1;
    cachedScores = [];
}

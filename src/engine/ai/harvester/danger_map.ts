/**
 * Danger Map System for Harvester AI
 *
 * Tracks zone-based danger for intelligent harvester routing and ore selection.
 * Uses a grid of zones to track:
 * - Current enemy presence
 * - Recent attack events
 * - Harvester death memory
 *
 * Difficulty scaling:
 * - Easy/Dummy: Don't update danger map (harvesters are oblivious)
 * - Medium: Only track current enemy presence (no memory)
 * - Hard: Full calculation with attack and death memory
 */

import { Vector, Entity } from '../../types.js';
import {
    HarvesterAIState,
    DangerZone,
    HARVESTER_AI_CONSTANTS
} from './types.js';

const {
    ZONE_SIZE,
    ENEMY_PRESENCE_WEIGHT,
    RECENT_ATTACK_WEIGHT,
    DEATH_MEMORY_WEIGHT,
    ATTACK_MEMORY_WINDOW,
    DEATH_MEMORY_WINDOW
} = HARVESTER_AI_CONSTANTS;

/**
 * Attack event interface for tracking recent attacks
 */
export interface AttackEvent {
    zoneKey: string;
    tick: number;
}

/**
 * Convert world position to zone key like "2,3"
 */
export function getZoneKey(x: number, y: number): string {
    const zoneX = Math.floor(x / ZONE_SIZE);
    const zoneY = Math.floor(y / ZONE_SIZE);
    return `${zoneX},${zoneY}`;
}

/**
 * Parse zone key back to zone coordinates
 */
export function parseZoneKey(key: string): { x: number; y: number } {
    const [xStr, yStr] = key.split(',');
    return {
        x: parseInt(xStr, 10),
        y: parseInt(yStr, 10)
    };
}

/**
 * Update all zone danger scores based on current game state
 *
 * Difficulty scaling:
 * - Easy/Dummy: Don't update (return early)
 * - Medium: Only use baseDanger (current enemies, no memory)
 * - Hard: Full calculation with attack and death memory
 */
export function updateDangerMap(
    harvesterAI: HarvesterAIState,
    playerId: number,
    enemies: Entity[],
    recentAttackEvents: AttackEvent[],
    currentTick: number,
    difficulty: 'dummy' | 'easy' | 'medium' | 'hard'
): void {
    // Easy and dummy difficulties don't track danger
    if (difficulty === 'easy' || difficulty === 'dummy') {
        return;
    }

    // Track which zones have been updated
    const updatedZones = new Set<string>();

    // Count enemies per zone
    const enemyCountByZone = new Map<string, number>();
    for (const enemy of enemies) {
        if (enemy.dead) continue;
        const zoneKey = getZoneKey(enemy.pos.x, enemy.pos.y);
        enemyCountByZone.set(zoneKey, (enemyCountByZone.get(zoneKey) || 0) + 1);
    }

    // For hard difficulty, also process attack events and death memory
    const attackCountByZone = new Map<string, number>();
    const deathCountByZone = new Map<string, number>();

    if (difficulty === 'hard') {
        // Count recent attacks per zone (within memory window)
        for (const event of recentAttackEvents) {
            const age = currentTick - event.tick;
            if (age <= ATTACK_MEMORY_WINDOW) {
                attackCountByZone.set(event.zoneKey, (attackCountByZone.get(event.zoneKey) || 0) + 1);
                updatedZones.add(event.zoneKey);
            }
        }

        // Count deaths per zone (within memory window)
        for (const death of harvesterAI.harvesterDeaths) {
            const age = currentTick - death.tick;
            if (age <= DEATH_MEMORY_WINDOW) {
                deathCountByZone.set(death.zoneKey, (deathCountByZone.get(death.zoneKey) || 0) + 1);
                updatedZones.add(death.zoneKey);
            }
        }
    }

    // Add enemy zones to updated set
    for (const zoneKey of enemyCountByZone.keys()) {
        updatedZones.add(zoneKey);
    }

    // Update or create danger zones
    for (const zoneKey of updatedZones) {
        const enemyCount = enemyCountByZone.get(zoneKey) || 0;
        const attackCount = attackCountByZone.get(zoneKey) || 0;
        const deathCount = deathCountByZone.get(zoneKey) || 0;

        // Calculate danger score based on difficulty
        let dangerScore: number;

        if (difficulty === 'medium') {
            // Medium: only enemy presence
            dangerScore = enemyCount * ENEMY_PRESENCE_WEIGHT;
        } else {
            // Hard: full calculation
            const baseDanger = enemyCount * ENEMY_PRESENCE_WEIGHT;

            // Attack memory with linear decay
            let attackDanger = 0;
            if (attackCount > 0) {
                // For simplicity, use full weight since we already filtered by window
                // In a more sophisticated system, we'd decay based on age
                attackDanger = attackCount * RECENT_ATTACK_WEIGHT;
            }

            // Death memory (no decay within window)
            const deathDanger = deathCount * DEATH_MEMORY_WEIGHT;

            dangerScore = baseDanger + attackDanger + deathDanger;
        }

        // Clamp to 0-100
        dangerScore = Math.max(0, Math.min(100, dangerScore));

        const dangerZone: DangerZone = {
            key: zoneKey,
            dangerScore,
            enemyCount,
            recentAttacks: difficulty === 'hard' ? attackCount : 0,
            harvesterDeaths: difficulty === 'hard' ? deathCount : 0,
            lastUpdate: currentTick
        };

        harvesterAI.dangerMap.set(zoneKey, dangerZone);
    }

    // Clear zones that are now safe (no enemies, no recent events)
    for (const [zoneKey, zone] of harvesterAI.dangerMap) {
        if (!updatedZones.has(zoneKey)) {
            // Zone has no current enemies or recent events
            // For medium difficulty, clear immediately
            // For hard difficulty, only clear if no memory
            if (difficulty === 'medium') {
                harvesterAI.dangerMap.delete(zoneKey);
            } else if (difficulty === 'hard') {
                // Check if there's still death memory
                const hasDeathMemory = harvesterAI.harvesterDeaths.some(
                    d => d.zoneKey === zoneKey && (currentTick - d.tick) <= DEATH_MEMORY_WINDOW
                );
                const hasAttackMemory = recentAttackEvents.some(
                    e => e.zoneKey === zoneKey && (currentTick - e.tick) <= ATTACK_MEMORY_WINDOW
                );
                if (!hasDeathMemory && !hasAttackMemory) {
                    harvesterAI.dangerMap.delete(zoneKey);
                }
            }
        }
    }

    harvesterAI.dangerMapLastUpdate = currentTick;
}

/**
 * Get danger score (0-100) at a world position
 */
export function getZoneDanger(harvesterAI: HarvesterAIState, x: number, y: number): number {
    const zoneKey = getZoneKey(x, y);
    const zone = harvesterAI.dangerMap.get(zoneKey);
    return zone ? zone.dangerScore : 0;
}

/**
 * Calculate average danger along a path between two points
 *
 * Samples danger at multiple points along the path to get average
 */
export function getPathDanger(
    harvesterAI: HarvesterAIState,
    from: Vector,
    to: Vector
): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // If same position, just return that zone's danger
    if (distance < 1) {
        return getZoneDanger(harvesterAI, from.x, from.y);
    }

    // Sample every ZONE_SIZE/2 pixels along path, minimum 2 samples
    const numSamples = Math.max(2, Math.ceil(distance / (ZONE_SIZE / 2)));
    const sampledZones = new Set<string>();
    let totalDanger = 0;
    let zoneCount = 0;

    for (let i = 0; i <= numSamples; i++) {
        const t = i / numSamples;
        const x = from.x + dx * t;
        const y = from.y + dy * t;
        const zoneKey = getZoneKey(x, y);

        // Only count each zone once
        if (!sampledZones.has(zoneKey)) {
            sampledZones.add(zoneKey);
            totalDanger += getZoneDanger(harvesterAI, x, y);
            zoneCount++;
        }
    }

    return zoneCount > 0 ? totalDanger / zoneCount : 0;
}

/**
 * Find the safest ore to harvest, balancing distance vs danger
 *
 * Scoring formula:
 * - Lower score = better option
 * - score = (distance / 100) + (pathDanger * (1 - desperationScore/100) * dangerWeight)
 *
 * When desperate (high desperationScore), danger matters less
 * When not desperate, danger is weighted more heavily
 */
export function findSafestOre(
    harvesterAI: HarvesterAIState,
    harvester: Entity,
    oreOptions: Entity[],
    desperationScore: number
): Entity | null {
    if (oreOptions.length === 0) {
        return null;
    }

    if (oreOptions.length === 1) {
        return oreOptions[0];
    }

    // Constants for scoring
    const DISTANCE_WEIGHT = 1.0;
    const DANGER_WEIGHT = 3.0; // Danger is weighted more heavily than distance

    // Desperation reduces danger weight (0 desperation = full danger weight, 100 = no danger weight)
    const effectiveDangerWeight = DANGER_WEIGHT * (1 - desperationScore / 100);

    let bestOre: Entity | null = null;
    let bestScore = Infinity;

    for (const ore of oreOptions) {
        // Calculate distance score (normalized by 100 for reasonable scaling)
        const distance = harvester.pos.dist(ore.pos);
        const distanceScore = (distance / 100) * DISTANCE_WEIGHT;

        // Calculate path danger score
        const pathDanger = getPathDanger(harvesterAI, harvester.pos, ore.pos);
        const dangerScore = pathDanger * effectiveDangerWeight;

        const totalScore = distanceScore + dangerScore;

        if (totalScore < bestScore) {
            bestScore = totalScore;
            bestOre = ore;
        }
    }

    return bestOre;
}

/**
 * Record a harvester death for danger memory
 *
 * This information is used to increase danger scores in zones
 * where harvesters have previously been killed.
 */
export function recordHarvesterDeath(
    harvesterAI: HarvesterAIState,
    position: Vector,
    tick: number
): void {
    const zoneKey = getZoneKey(position.x, position.y);

    harvesterAI.harvesterDeaths.push({
        position,
        tick,
        zoneKey
    });
}

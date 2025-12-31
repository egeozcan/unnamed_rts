/**
 * AI Targeting Utilities
 *
 * Focus fire scoring, threat evaluation, and target selection.
 */

import { Entity, EntityId, Vector } from '../../types.js';
import { RULES } from '../../../data/schemas/index.js';
import { CounterUnits, AIPlayerState } from '../types.js';

// ============ COUNTER-BUILDING ============

/**
 * Get counter-building unit preferences based on enemy armor composition.
 * Returns unit lists ordered by effectiveness against the dominant enemy type.
 */
export function getCounterUnits(
    dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed'
): CounterUnits {
    switch (dominantArmor) {
        case 'infantry':
            // Enemy has lots of infantry - use fire and snipers (1.75x and 4x damage)
            return {
                infantry: ['flamer', 'sniper', 'grenadier', 'rifle'],
                vehicle: ['flame_tank', 'apc', 'light']
            };
        case 'heavy':
            // Enemy has heavy armor - missiles and rockets are needed (1.5x and 1.0x)
            return {
                infantry: ['rocket'],
                vehicle: ['mlrs', 'artillery', 'mammoth', 'heavy']
            };
        case 'light':
            // Enemy has light vehicles - cannons and AP bullets work well
            return {
                infantry: ['commando', 'rifle', 'rocket'],
                vehicle: ['light', 'heavy', 'stealth']
            };
        case 'mixed':
        default:
            // Mixed army - build a balanced force
            return {
                infantry: ['rifle', 'rocket', 'flamer'],
                vehicle: ['heavy', 'light', 'flame_tank']
            };
    }
}

// ============ TARGET SCORING ============

/**
 * Score a potential attack target for a unit.
 * Higher score = more attractive target.
 */
export function scoreTarget(
    attacker: Entity,
    target: Entity,
    allies: Entity[],
    baseCenter: Vector,
    aiState: AIPlayerState
): number {
    let score = 100;

    // Distance penalty (prefer closer targets)
    const dist = attacker.pos.dist(target.pos);
    score -= dist * 0.1;

    // Leash distance - heavily penalize targets too far from base
    const distFromBase = target.pos.dist(baseCenter);
    if (distFromBase > 800) {
        score -= (distFromBase - 800) * 0.5;
    }

    // Low HP bonus (finish off weak enemies)
    const hpPercent = target.hp / target.maxHp;
    if (hpPercent < 0.3) {
        score += 100;
    } else if (hpPercent < 0.5) {
        score += 50;
    }

    // Focus fire bonus (attack same target as allies)
    const alliesAttackingSame = allies.filter(a => {
        if (a.type !== 'UNIT') return false;
        // Check if ally has combat component with targetId
        const unit = a as { combat?: { targetId?: EntityId } };
        return unit.combat?.targetId === target.id;
    }).length;
    score += alliesAttackingSame * 100;

    // Threat priority (active attackers)
    if (target.type === 'UNIT') {
        const unit = target as { combat?: { targetId?: EntityId } };
        if (unit.combat?.targetId) {
            score += 150; // Attacking something
        }
    }

    // Vengeance bias (target players who attacked us)
    if (target.owner >= 0 && aiState.vengeanceScores[target.owner]) {
        score += aiState.vengeanceScores[target.owner] * 0.5;
    }

    // Building priority for attacks
    if (target.type === 'BUILDING') {
        const buildingPriority: Record<string, number> = {
            'conyard': 200,
            'factory': 150,
            'barracks': 100,
            'refinery': 80,
            'power': 60,
            'turret': 40,
            'sam_site': 30,
            'pillbox': 20,
            'obelisk': 50,
            'tech': 70
        };
        score += buildingPriority[target.key] || 0;
    }

    return score;
}

/**
 * Select the best target from a list of enemies
 */
export function selectBestTarget(
    attacker: Entity,
    enemies: Entity[],
    allies: Entity[],
    baseCenter: Vector,
    aiState: AIPlayerState
): Entity | null {
    if (enemies.length === 0) return null;

    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;

    for (const enemy of enemies) {
        if (enemy.dead) continue;
        const score = scoreTarget(attacker, enemy, allies, baseCenter, aiState);
        if (score > bestScore) {
            bestScore = score;
            bestTarget = enemy;
        }
    }

    return bestTarget;
}

// ============ THREAT DETECTION ============

/**
 * Detect threats near base and harvesters under attack
 */
export function detectThreats(
    baseCenter: Vector,
    harvesters: Entity[],
    enemies: Entity[],
    myBuildings: Entity[],
    baseDefenseRadius: number,
    threatDetectionRadius: number
): { threatsNearBase: EntityId[]; harvestersUnderAttack: EntityId[] } {
    const threatsNearBase: EntityId[] = [];
    const harvestersUnderAttack: EntityId[] = [];

    // Find enemies near base
    for (const enemy of enemies) {
        if (enemy.pos.dist(baseCenter) < baseDefenseRadius) {
            threatsNearBase.push(enemy.id);
        }
        // Also check if enemies are near any building
        for (const building of myBuildings) {
            if (enemy.pos.dist(building.pos) < threatDetectionRadius) {
                if (!threatsNearBase.includes(enemy.id)) {
                    threatsNearBase.push(enemy.id);
                }
            }
        }
    }

    // Find harvesters under attack
    for (const harv of harvesters) {
        const harvUnit = harv as { combat?: { lastAttackerId?: EntityId } };
        if (harvUnit.combat?.lastAttackerId) {
            harvestersUnderAttack.push(harv.id);
        } else {
            // Check for nearby threats
            for (const enemy of enemies) {
                if (enemy.type === 'UNIT' && enemy.pos.dist(harv.pos) < 200) {
                    harvestersUnderAttack.push(harv.id);
                    break;
                }
            }
        }
    }

    return { threatsNearBase, harvestersUnderAttack };
}

// ============ ENEMY INTELLIGENCE ============

/**
 * Update enemy intelligence for counter-building
 */
export function updateEnemyIntelligence(
    aiState: AIPlayerState,
    enemies: Entity[],
    tick: number,
    updateInterval: number = 300
): void {
    // Only update every N ticks
    if (tick - aiState.enemyIntelligence.lastUpdate < updateInterval) return;

    const unitCounts: Record<string, number> = {};
    const buildingCounts: Record<string, number> = {};
    let infantryCount = 0;
    let lightCount = 0;
    let heavyCount = 0;

    for (const e of enemies) {
        if (e.type === 'UNIT') {
            unitCounts[e.key] = (unitCounts[e.key] || 0) + 1;

            const data = RULES.units?.[e.key];
            if (data) {
                if (data.armor === 'infantry') infantryCount++;
                else if (data.armor === 'light') lightCount++;
                else if (data.armor === 'heavy' || data.armor === 'medium') heavyCount++;
            }
        } else if (e.type === 'BUILDING') {
            buildingCounts[e.key] = (buildingCounts[e.key] || 0) + 1;
        }
    }

    // Determine dominant armor type
    let dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed' = 'mixed';
    const total = infantryCount + lightCount + heavyCount;
    if (total > 0) {
        if (infantryCount > total * 0.6) dominantArmor = 'infantry';
        else if (heavyCount > total * 0.4) dominantArmor = 'heavy';
        else if (lightCount > total * 0.4) dominantArmor = 'light';
    }

    aiState.enemyIntelligence = {
        lastUpdate: tick,
        unitCounts,
        buildingCounts,
        dominantArmor
    };
}

// ============ VENGEANCE TRACKING ============

/**
 * Update vengeance scores (bias toward players who attacked us)
 */
export function updateVengeance(
    entities: Record<string, Entity>,
    playerId: number,
    aiState: AIPlayerState,
    myEntities: Entity[],
    decayFactor: number,
    vengeancePerHit: number
): void {
    // Apply decay to existing vengeance scores
    for (const pid in aiState.vengeanceScores) {
        aiState.vengeanceScores[pid] *= decayFactor;
        if (aiState.vengeanceScores[pid] < 0.1) {
            delete aiState.vengeanceScores[pid];
        }
    }

    // Track damage from attackers
    for (const entity of myEntities) {
        if (entity.type !== 'UNIT') continue;
        const unit = entity as { combat?: { lastAttackerId?: EntityId } };
        if (unit.combat?.lastAttackerId) {
            const attacker = entities[unit.combat.lastAttackerId];
            if (attacker && attacker.owner !== playerId && attacker.owner !== -1) {
                const attackerOwner = attacker.owner;
                aiState.vengeanceScores[attackerOwner] =
                    (aiState.vengeanceScores[attackerOwner] || 0) + vengeancePerHit;
            }
        }
    }
}

/**
 * AI Strategy Module
 *
 * Handles strategy selection and state transitions.
 * Strategies determine high-level AI behavior:
 * - buildup: Focus on economy and army building
 * - attack: Full assault on enemy base
 * - defend: Protect base from threats
 * - harass: Hit-and-run tactics
 * - all_in: Desperate attack with everything
 */

import { Entity, EntityId } from '../../types.js';
import { AIPersonality } from '../../../data/schemas/index.js';
import { AIPlayerState, AI_CONSTANTS } from '../types.js';
import { hasProductionBuildingFor } from '../utils/production.js';

const {
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE,
    STRATEGY_COOLDOWN,
    STALEMATE_DETECTION_TICK,
    STALEMATE_NO_COMBAT_THRESHOLD,
    STALEMATE_LOW_ARMY_THRESHOLD,
    DESPERATE_ATTACK_TICK,
    SURPLUS_CREDIT_THRESHOLD,
    PEACE_BREAK_TICKS,
    GUARANTEED_PEACE_BREAK_TICKS
} = AI_CONSTANTS;

/**
 * Update AI strategy based on current game state
 */
export function updateStrategy(
    aiState: AIPlayerState,
    tick: number,
    buildings: Entity[],
    combatUnits: Entity[],
    enemies: Entity[],
    threatsNearBase: EntityId[],
    personality: AIPersonality,
    credits: number = 0
): void {
    const hasFactory = hasProductionBuildingFor('vehicle', buildings);
    const hasBarracks = hasProductionBuildingFor('infantry', buildings);
    const armySize = combatUnits.length;
    const attackThreshold = personality.attack_threshold || ATTACK_GROUP_MIN_SIZE;
    const harassThreshold = personality.harass_threshold || HARASS_GROUP_SIZE;

    // Priority 1: Defend if threats near base (ALWAYS immediate, no cooldown)
    if (threatsNearBase.length > 0) {
        aiState.peaceTicks = 0;

        if (armySize > 0) {
            if (aiState.strategy !== 'defend') {
                aiState.strategy = 'defend';
                aiState.lastStrategyChange = tick;
            }
            aiState.lastCombatTick = tick;
            aiState.stalemateDesperation = 0;
            return;
        }

        // No army but under attack - increase desperation
        if (tick > STALEMATE_DETECTION_TICK) {
            aiState.stalemateDesperation = Math.min(100, aiState.stalemateDesperation + 5);
        }
    }

    // Stalemate detection and desperate moves
    if (tick > STALEMATE_DETECTION_TICK) {
        const ticksSinceCombat = tick - (aiState.lastCombatTick || 0);

        if (ticksSinceCombat > STALEMATE_NO_COMBAT_THRESHOLD && armySize < STALEMATE_LOW_ARMY_THRESHOLD) {
            aiState.stalemateDesperation = Math.min(100, Math.floor(ticksSinceCombat / 60));
        } else if (armySize >= attackThreshold) {
            aiState.stalemateDesperation = 0;
        }

        // Desperate attack when desperation is high
        if (aiState.stalemateDesperation >= 50 && enemies.length > 0) {
            if (armySize > 0) {
                aiState.strategy = 'all_in';
                aiState.lastStrategyChange = tick;
                if (aiState.allInStartTick === 0) aiState.allInStartTick = tick;
                aiState.attackGroup = combatUnits.map(u => u.id);
                return;
            }
        }

        // Harvester suicide attack trigger
        if (tick > DESPERATE_ATTACK_TICK &&
            aiState.stalemateDesperation >= 80 &&
            armySize === 0 &&
            enemies.length > 0) {
            aiState.strategy = 'all_in';
            aiState.lastStrategyChange = tick;
            if (aiState.allInStartTick === 0) aiState.allInStartTick = tick;
            return;
        }
    }

    // Track peace time with surplus resources
    if (credits >= SURPLUS_CREDIT_THRESHOLD && aiState.threatLevel === 0) {
        aiState.peaceTicks += 30;
    } else {
        aiState.peaceTicks = 0;
    }

    // Check if we need to abort an offensive strategy
    const abortOffense = (aiState.strategy === 'attack' && armySize < attackThreshold) ||
        (aiState.strategy === 'harass' && armySize < harassThreshold);

    if (!abortOffense && tick - aiState.lastStrategyChange < STRATEGY_COOLDOWN) return;

    // Priority 2: Full attack if we have a strong army
    if (armySize >= attackThreshold && hasFactory && enemies.length > 0) {
        if (aiState.strategy !== 'attack') {
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = tick;
            aiState.attackGroup = combatUnits.map(u => u.id);
        }
        return;
    }

    // Priority 2.5: Peace break - force attack when wealthy and peaceful
    const peaceBreakArmyThreshold = Math.max(3, attackThreshold - 2);

    if (aiState.peaceTicks >= PEACE_BREAK_TICKS &&
        credits >= SURPLUS_CREDIT_THRESHOLD &&
        armySize >= peaceBreakArmyThreshold &&
        hasFactory &&
        enemies.length > 0) {

        const shouldBreakPeace = aiState.peaceTicks >= GUARANTEED_PEACE_BREAK_TICKS ||
            credits >= SURPLUS_CREDIT_THRESHOLD * 2;

        if (shouldBreakPeace) {
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = tick;
            aiState.attackGroup = combatUnits.map(u => u.id);
            aiState.peaceTicks = 0;
            return;
        }
    }

    // Priority 3: Harass if we have some units but not enough for full attack
    const harassCapableUnits = combatUnits.filter(u => u.key === 'rifle' || u.key === 'light');
    if (harassCapableUnits.length >= harassThreshold && (hasFactory || hasBarracks) && enemies.length > 0) {
        if (aiState.strategy !== 'harass') {
            aiState.strategy = 'harass';
            aiState.lastStrategyChange = tick;
            aiState.harassGroup = harassCapableUnits.slice(0, HARASS_GROUP_SIZE).map(u => u.id);
        }
        return;
    }

    // Priority 4: All-In / Desperation
    const STALL_TIMEOUT = 4500;
    const LOW_FUNDS = 1000;

    if (aiState.strategy === 'buildup' &&
        tick - aiState.lastStrategyChange > STALL_TIMEOUT &&
        credits < LOW_FUNDS &&
        armySize > 0) {
        aiState.strategy = 'all_in';
        aiState.lastStrategyChange = tick;
        if (aiState.allInStartTick === 0) aiState.allInStartTick = tick;
        aiState.attackGroup = combatUnits.map(u => u.id);
        return;
    }

    // Persist All-In until we recover or die
    if (aiState.strategy === 'all_in') {
        if (credits < 2000) return;
    }

    // Default: Build up
    if (aiState.strategy !== 'buildup') {
        if (aiState.strategy === 'all_in') {
            aiState.allInStartTick = 0;
        }
        aiState.strategy = 'buildup';
        aiState.lastStrategyChange = tick;
        aiState.attackGroup = [];
        aiState.harassGroup = [];
        aiState.offensiveGroups = [];
    }
}

/**
 * Evaluate and update investment priority
 */
export function evaluateInvestmentPriority(
    economyScore: number,
    threatLevel: number,
    armyRatio: number,
    credits: number
): 'economy' | 'warfare' | 'defense' | 'balanced' {
    if (threatLevel > 70) {
        return 'defense';
    } else if (economyScore < 30) {
        return 'economy';
    } else if (armyRatio < 0.6) {
        return 'warfare';
    } else if (credits > 2000 && economyScore < 70) {
        return 'economy';
    } else {
        return 'balanced';
    }
}

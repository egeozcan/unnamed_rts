import { GameState, Entity, EntityId, Vector, HarvesterUnit } from '../types.js';
import { RULES, AIPersonality } from '../../data/schemas/index.js';
import { AIPlayerState } from './types.js';
import {
    AI_CONSTANTS,
    BASE_DEFENSE_RADIUS,
    THREAT_DETECTION_RADIUS,
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE,
    STALEMATE_DETECTION_TICK,
    STALEMATE_NO_COMBAT_THRESHOLD,
    STALEMATE_LOW_ARMY_THRESHOLD,
    DESPERATE_ATTACK_TICK,
    SURPLUS_CREDIT_THRESHOLD,
    PEACE_BREAK_TICKS,
    STRATEGY_COOLDOWN,
    hasProductionBuildingFor
} from './utils.js';

export function detectThreats(
    baseCenter: Vector,
    harvesters: Entity[],
    enemies: Entity[],
    myBuildings: Entity[]
): { threatsNearBase: EntityId[], harvestersUnderAttack: EntityId[] } {
    const threatsNearBase: EntityId[] = [];
    const harvestersUnderAttack: EntityId[] = [];

    // Find enemies near base
    for (const enemy of enemies) {
        if (enemy.pos.dist(baseCenter) < BASE_DEFENSE_RADIUS) {
            threatsNearBase.push(enemy.id);
        }
        // Also check if enemies are near any building
        for (const building of myBuildings) {
            if (enemy.pos.dist(building.pos) < THREAT_DETECTION_RADIUS) {
                if (!threatsNearBase.includes(enemy.id)) {
                    threatsNearBase.push(enemy.id);
                }
            }
        }
    }

    // Find harvesters under attack
    for (const harv of harvesters) {
        const harvUnit = harv as HarvesterUnit;
        if (harvUnit.combat.lastAttackerId) {
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
        // Reset peace counter when under threat
        aiState.peaceTicks = 0;

        // If we have combat units, defend normally
        if (armySize > 0) {
            if (aiState.strategy !== 'defend') {
                aiState.strategy = 'defend';
                aiState.lastStrategyChange = tick;
            }
            // Only reset desperation if we can actually defend
            aiState.lastCombatTick = tick;
            aiState.stalemateDesperation = 0;
            return;
        }

        // NO ARMY but under attack - this is desperate!
        // decrease desperation rapidly when being attacked with no defenders
        if (tick > STALEMATE_DETECTION_TICK) {
            aiState.stalemateDesperation = Math.min(100, aiState.stalemateDesperation + 5);
        }
    }

    // ===== STALEMATE DETECTION AND DESPERATE MOVES =====
    // After the early game, detect if the game has stagnated and force risky plays
    if (tick > STALEMATE_DETECTION_TICK) {
        const ticksSinceCombat = tick - (aiState.lastCombatTick || 0);

        // Update desperation level based on time without combat and army size
        if (ticksSinceCombat > STALEMATE_NO_COMBAT_THRESHOLD && armySize < STALEMATE_LOW_ARMY_THRESHOLD) {
            // Increase desperation: 1 point per 60 ticks (1 second) without combat
            aiState.stalemateDesperation = Math.min(100, Math.floor(ticksSinceCombat / 60));
        } else if (armySize >= attackThreshold) {
            // Reset desperation if we have a proper army
            aiState.stalemateDesperation = 0;
        }

        // DESPERATE ATTACK: When desperation is high and we've been stuck
        // Attack with whatever we have, even if it's just 1-2 units
        if (aiState.stalemateDesperation >= 50 && enemies.length > 0) {
            // Even 1 unit should attack when desperate
            if (armySize > 0) {
                aiState.strategy = 'all_in';
                aiState.lastStrategyChange = tick;
                if (aiState.allInStartTick === 0) aiState.allInStartTick = tick;
                aiState.attackGroup = combatUnits.map(u => u.id);
                return;
            }
        }

        // HARVESTER SUICIDE ATTACK: When extremely desperate (10+ minutes, no army)
        // Use harvesters to break the stalemate - they can damage buildings
        if (tick > DESPERATE_ATTACK_TICK &&
            aiState.stalemateDesperation >= 80 &&
            armySize === 0 &&
            enemies.length > 0) {
            // This will be handled in unit commands - we mark the state for harvester attack
            aiState.strategy = 'all_in';
            aiState.lastStrategyChange = tick;
            if (aiState.allInStartTick === 0) aiState.allInStartTick = tick;
            return;
        }
    }

    // Track peace time with surplus resources
    if (credits >= SURPLUS_CREDIT_THRESHOLD && aiState.threatLevel === 0) {
        aiState.peaceTicks += 30; // Increment by AI tick interval
    } else {
        aiState.peaceTicks = 0;
    }

    // Check if we need to abort an offensive strategy immediately due to army loss
    const abortOffense = (aiState.strategy === 'attack' && armySize < attackThreshold) ||
        (aiState.strategy === 'harass' && armySize < harassThreshold);

    // Other strategy changes have cooldown (unless aborting offense)
    if (!abortOffense && tick - aiState.lastStrategyChange < STRATEGY_COOLDOWN) return;

    // Priority 2: Full attack if we have a strong army
    if (armySize >= attackThreshold && hasFactory && enemies.length > 0) {
        if (aiState.strategy !== 'attack') {
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = tick;
            // Form attack group from all available combat units
            aiState.attackGroup = combatUnits.map(u => u.id);
        }
        return;
    }

    // Priority 2.5: PEACE BREAK - Force attack when wealthy and peaceful for too long
    // ===== MORE DETERMINISTIC PEACE BREAK (Issue #11) =====
    const GUARANTEED_PEACE_BREAK_TICKS = 1200; // 20 seconds guaranteed attack
    const peaceBreakArmyThreshold = Math.max(3, attackThreshold - 2);

    if (aiState.peaceTicks >= PEACE_BREAK_TICKS &&
        credits >= SURPLUS_CREDIT_THRESHOLD &&
        armySize >= peaceBreakArmyThreshold &&
        hasFactory &&
        enemies.length > 0) {

        // Deterministic peace break: attack if peaceful for long enough OR very wealthy
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
            // Form harass group from fastest/lightest units
            aiState.harassGroup = harassCapableUnits.slice(0, HARASS_GROUP_SIZE).map(u => u.id);
        }
        return;
    }

    // Priority 4: All-In / Desperation
    // If we have been stuck in buildup for a long time (75s) and are broke, just attack with what we have
    // This prevents indefinite stalling when economy is dead
    const STALL_TIMEOUT = 4500; // 75 seconds
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
        // If we still have low funds, keep attacking
        if (credits < 2000) return;
        // If we have funds, fall through to switch to buildup/re-evaluate
    }

    // Default: Build up
    if (aiState.strategy !== 'buildup') {
        // Reset all_in tracking when leaving all_in mode
        if (aiState.strategy === 'all_in') {
            aiState.allInStartTick = 0;
        }
        aiState.strategy = 'buildup';
        aiState.lastStrategyChange = tick;
        // Clear offensive groups so units are free to rally
        aiState.attackGroup = [];
        aiState.harassGroup = [];
        aiState.offensiveGroups = [];
    }
}

export function evaluateInvestmentPriority(
    state: GameState,
    playerId: number,
    aiState: AIPlayerState,
    myBuildings: Entity[],
    combatUnits: Entity[],
    enemies: Entity[],
    baseCenter: Vector
): void {
    const player = state.players[playerId];
    if (!player) return;

    // Calculate economy score
    aiState.economyScore = calculateEconomyScore(state, playerId, myBuildings);

    // Calculate threat level
    aiState.threatLevel = calculateThreatLevel(state, playerId, baseCenter, enemies, myBuildings);

    // Calculate army ratio
    const enemyCombatUnits = enemies.filter(e => e.type === 'UNIT' && e.key !== 'harvester' && e.key !== 'mcv');
    const armyRatio = enemyCombatUnits.length > 0
        ? combatUnits.length / enemyCombatUnits.length
        : 2.0; // If no enemy combat units, we're strong

    // Decision matrix
    if (aiState.threatLevel > 70) {
        aiState.investmentPriority = 'defense';
    } else if (aiState.economyScore < 30) {
        aiState.investmentPriority = 'economy';
    } else if (armyRatio < 0.6) {
        aiState.investmentPriority = 'warfare';
    } else if (player.credits > 2000 && aiState.economyScore < 70) {
        aiState.investmentPriority = 'economy'; // Expand with surplus
    } else {
        aiState.investmentPriority = 'balanced';
    }

    // Find expansion target if prioritizing economy
    if (aiState.investmentPriority === 'economy') {
        aiState.expansionTarget = findDistantOre(state, playerId, myBuildings);
    }
}

export function calculateEconomyScore(
    state: GameState,
    playerId: number,
    myBuildings: Entity[]
): number {
    // Count harvesters
    const harvesters = Object.values(state.entities).filter(e =>
        e.owner === playerId && e.type === 'UNIT' && e.key === 'harvester' && !e.dead
    );

    // Count refineries  
    const refineries = myBuildings.filter(b => b.key === 'refinery' && !b.dead);

    // Count nearby ore (within 600 units of any refinery)
    let accessibleOre = 0;
    const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
    for (const ore of allOre) {
        for (const ref of refineries) {
            if (ore.pos.dist(ref.pos) < 600) {
                accessibleOre++;
                break;
            }
        }
    }

    // Ideal: 2 harvesters per refinery, plenty of accessible ore
    const idealHarvesters = Math.max(refineries.length * 2, 1);
    const harvesterRatio = Math.min(harvesters.length / idealHarvesters, 1.5);
    const oreScore = Math.min(accessibleOre / 8, 1.0); // 8 ore nodes = max score

    const score = (harvesterRatio * 50) + (oreScore * 50);
    return Math.max(0, Math.min(100, score));
}

export function calculateThreatLevel(
    _state: GameState,
    _playerId: number,
    baseCenter: Vector,
    enemies: Entity[],
    myBuildings: Entity[]
): number {
    // Count enemies near base
    const nearbyThreats = enemies.filter(e =>
        e.type === 'UNIT' && e.key !== 'harvester' && e.pos.dist(baseCenter) < 600
    );

    // Count our defenses
    const defenses = myBuildings.filter(b => {
        const data = RULES.buildings[b.key];
        return data?.isDefense && !b.dead;
    });

    // High threat if enemies near base and few defenses
    const threatScore = nearbyThreats.length * 25 - defenses.length * 15;
    return Math.max(0, Math.min(100, threatScore));
}

export function findDistantOre(
    state: GameState,
    _playerId: number,
    myBuildings: Entity[]
): Vector | null {
    const allOre = Object.values(state.entities).filter(e =>
        e.type === 'RESOURCE' && !e.dead && e.hp > 200
    );
    const nonDefenseBuildings = myBuildings.filter(b => {
        const data = RULES.buildings[b.key];
        return !data?.isDefense;
    });

    const BUILD_RADIUS = AI_CONSTANTS.BUILD_RADIUS;

    // FIRST: Check if there's already accessible ore within build range that doesn't have a refinery
    // If yes, no need to building walk - just build a refinery there
    for (const ore of allOre) {
        // Check if already covered by a refinery
        const hasNearbyRefinery = myBuildings.some(b =>
            b.key === 'refinery' && b.pos.dist(ore.pos) < 250
        );
        if (hasNearbyRefinery) continue;

        // Check if this ore is within build range of any building
        for (const b of nonDefenseBuildings) {
            // Use BUILD_RADIUS + some buffer for refinery placement
            if (b.pos.dist(ore.pos) < BUILD_RADIUS + 150) {
                // Found accessible ore that's not covered by a refinery
                // No need to building walk - return null so we focus on building refinery instead
                return null;
            }
        }
    }

    // Only look for distant ore if no accessible unclaimed ore exists
    let bestOre: Vector | null = null;
    let bestScore = -Infinity;

    for (const ore of allOre) {
        // Check if already covered by a refinery
        const hasNearbyRefinery = myBuildings.some(b =>
            b.key === 'refinery' && b.pos.dist(ore.pos) < 250
        );
        if (hasNearbyRefinery) continue;

        // Check distance from our buildings (want distant but reachable)
        let minDistToBuilding = Infinity;
        for (const b of nonDefenseBuildings) {
            const d = b.pos.dist(ore.pos);
            if (d < minDistToBuilding) minDistToBuilding = d;
        }

        // Prefer ore that's 400-1200 units away (not too close, not too far)
        if (minDistToBuilding >= 400 && minDistToBuilding <= 1500) {
            const score = 1000 - Math.abs(minDistToBuilding - 800); // Optimal at 800
            if (score > bestScore) {
                bestScore = score;
                bestOre = ore.pos;
            }
        }
    }

    return bestOre;
}

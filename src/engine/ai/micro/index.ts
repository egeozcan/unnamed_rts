/**
 * AI Micro-Management Module
 *
 * Handles fine-grained unit control during combat:
 * - Kiting: Move away from enemies while attacking
 * - Stutter-stepping: Move between attacks for slow units
 * - Retreat: Pull back when low HP
 * - Spread: Avoid splash damage
 */

import { Entity, Vector, Action, GameState, CombatUnit } from '../../types.js';
import { RULES } from '../../../data/schemas/index.js';

// ============ MICRO CONSTANTS ============

export const MICRO_CONSTANTS = {
    // Retreat thresholds
    RETREAT_HP_THRESHOLD: 0.25,        // Retreat below 25% HP
    CRITICAL_HP_THRESHOLD: 0.15,       // Emergency retreat below 15%

    // Kiting parameters
    KITE_RANGE_MINIMUM: 200,           // Only kite if range >= this
    KITE_DISTANCE_RATIO: 0.6,          // Kite when enemy within 60% of range
    KITE_RANGE_ADVANTAGE: 50,          // Need this much range advantage to kite
    OPTIMAL_RANGE_RATIO: 0.8,          // Stay at 80% of max range

    // Stutter-step parameters
    STUTTER_COOLDOWN_THRESHOLD: 15,    // Stutter if cooldown > this ticks

    // Spread parameters (vs splash damage)
    SPREAD_MIN_DISTANCE: 60,           // Minimum distance between allies
    SPLASH_DANGER_RADIUS: 80,          // Consider splash danger within this

    // Speed ratio for kiting decision
    MIN_SPEED_RATIO_FOR_KITE: 0.8,     // Only kite if our speed >= 80% of enemy
} as const;

// ============ KITING SYSTEM ============

export interface KiteDecision {
    shouldKite: boolean;
    kitePosition: Vector | null;
    reason: 'cooldown' | 'range_advantage' | 'retreat' | 'none';
}

/**
 * Evaluate whether a unit should kite and where to go
 */
export function evaluateKite(
    unit: CombatUnit,
    closestEnemy: Entity,
    _tick: number
): KiteDecision {
    const unitData = RULES.units?.[unit.key];
    const enemyData = RULES.units?.[closestEnemy.key];

    if (!unitData) {
        return { shouldKite: false, kitePosition: null, reason: 'none' };
    }

    const unitRange = unitData.range || 100;
    const unitSpeed = unitData.speed || 2;
    const enemyRange = enemyData?.range || 100;
    const enemySpeed = enemyData?.speed || 2;

    const distToEnemy = unit.pos.dist(closestEnemy.pos);

    // Check if we have range advantage
    const hasRangeAdvantage = unitRange > enemyRange + MICRO_CONSTANTS.KITE_RANGE_ADVANTAGE;

    // Check if we're fast enough to kite
    const speedRatio = unitSpeed / enemySpeed;
    const canOutrunEnemy = speedRatio >= MICRO_CONSTANTS.MIN_SPEED_RATIO_FOR_KITE;

    // Only kite ranged units
    if (unitRange < MICRO_CONSTANTS.KITE_RANGE_MINIMUM) {
        return { shouldKite: false, kitePosition: null, reason: 'none' };
    }

    // Check if enemy is too close
    const kiteThreshold = unitRange * MICRO_CONSTANTS.KITE_DISTANCE_RATIO;
    const enemyTooClose = distToEnemy < kiteThreshold;

    // Decision: kite if we have range advantage and enemy is too close
    if (hasRangeAdvantage && enemyTooClose && canOutrunEnemy) {
        // Kite based on cooldown - if on cooldown, definitely kite
        // If ready to fire, consider staying to attack
        const isOnCooldown = unit.combat.cooldown > MICRO_CONSTANTS.STUTTER_COOLDOWN_THRESHOLD;

        if (isOnCooldown) {
            const optimalRange = unitRange * MICRO_CONSTANTS.OPTIMAL_RANGE_RATIO;
            const awayFromEnemy = unit.pos.sub(closestEnemy.pos).norm();
            const kitePos = closestEnemy.pos.add(awayFromEnemy.scale(optimalRange));

            return {
                shouldKite: true,
                kitePosition: kitePos,
                reason: 'cooldown'
            };
        } else {
            // Ready to fire - kite only if very close
            if (distToEnemy < unitRange * 0.4) {
                const optimalRange = unitRange * MICRO_CONSTANTS.OPTIMAL_RANGE_RATIO;
                const awayFromEnemy = unit.pos.sub(closestEnemy.pos).norm();
                const kitePos = closestEnemy.pos.add(awayFromEnemy.scale(optimalRange));

                return {
                    shouldKite: true,
                    kitePosition: kitePos,
                    reason: 'range_advantage'
                };
            }
        }
    }

    return { shouldKite: false, kitePosition: null, reason: 'none' };
}

// ============ STUTTER-STEPPING ============

export interface StutterDecision {
    shouldStutter: boolean;
    movePosition: Vector | null;
}

/**
 * Evaluate whether a slow unit should stutter-step toward enemy
 */
export function evaluateStutterStep(
    unit: CombatUnit,
    targetEnemy: Entity
): StutterDecision {
    const unitData = RULES.units?.[unit.key];
    if (!unitData) {
        return { shouldStutter: false, movePosition: null };
    }

    const unitRange = unitData.range || 100;
    const unitSpeed = unitData.speed || 2;
    const distToTarget = unit.pos.dist(targetEnemy.pos);

    // Only stutter for slow units that need to close distance
    if (unitSpeed > 2.5 || distToTarget <= unitRange) {
        return { shouldStutter: false, movePosition: null };
    }

    // Check if weapon is on cooldown
    const isOnCooldown = unit.combat.cooldown > MICRO_CONSTANTS.STUTTER_COOLDOWN_THRESHOLD;

    if (isOnCooldown) {
        // Move toward target during cooldown
        const toTarget = targetEnemy.pos.sub(unit.pos).norm();
        // Move a fraction of the distance during cooldown
        const moveDistance = Math.min(unitSpeed * 5, distToTarget - unitRange * 0.9);

        if (moveDistance > 10) {
            const movePos = unit.pos.add(toTarget.scale(moveDistance));
            return { shouldStutter: true, movePosition: movePos };
        }
    }

    return { shouldStutter: false, movePosition: null };
}

// ============ RETREAT SYSTEM ============

export interface RetreatDecision {
    shouldRetreat: boolean;
    retreatPosition: Vector | null;
    severity: 'normal' | 'critical';
}

/**
 * Evaluate whether a unit should retreat based on HP
 */
export function evaluateRetreat(
    unit: CombatUnit,
    nearbyEnemies: Entity[],
    baseCenter: Vector,
    allies: Entity[]
): RetreatDecision {
    const hpRatio = unit.hp / unit.maxHp;

    // Check retreat thresholds
    if (hpRatio >= MICRO_CONSTANTS.RETREAT_HP_THRESHOLD) {
        return { shouldRetreat: false, retreatPosition: null, severity: 'normal' };
    }

    const severity = hpRatio < MICRO_CONSTANTS.CRITICAL_HP_THRESHOLD ? 'critical' : 'normal';

    // Calculate retreat direction
    const toBase = baseCenter.sub(unit.pos).norm();

    // Calculate average direction away from enemies
    let enemyDir = new Vector(0, 0);
    for (const enemy of nearbyEnemies) {
        enemyDir = enemyDir.add(enemy.pos.sub(unit.pos));
    }
    const awayFromEnemy = enemyDir.mag() > 0 ? enemyDir.scale(-1).norm() : new Vector(0, 0);

    // Find direction toward allied units (for formation-aware retreat)
    let allyDir = new Vector(0, 0);
    const nearbyAllies = allies.filter(a =>
        a.id !== unit.id && a.pos.dist(unit.pos) < 300
    );
    for (const ally of nearbyAllies) {
        allyDir = allyDir.add(ally.pos.sub(unit.pos));
    }
    const towardAllies = allyDir.mag() > 0 ? allyDir.norm() : new Vector(0, 0);

    // Blend retreat direction
    // Critical: mostly away from enemies
    // Normal: balance between base and allies
    let retreatDir: Vector;
    if (severity === 'critical') {
        retreatDir = awayFromEnemy.scale(0.6).add(toBase.scale(0.4)).norm();
    } else {
        retreatDir = toBase.scale(0.5).add(awayFromEnemy.scale(0.3)).add(towardAllies.scale(0.2)).norm();
    }

    const retreatDistance = severity === 'critical' ? 300 : 200;
    const retreatPos = unit.pos.add(retreatDir.scale(retreatDistance));

    return {
        shouldRetreat: true,
        retreatPosition: retreatPos,
        severity
    };
}

// ============ SPREAD SYSTEM ============

export interface SpreadDecision {
    shouldSpread: boolean;
    spreadPosition: Vector | null;
}

/**
 * Evaluate whether a unit should spread out to avoid splash damage
 */
export function evaluateSpread(
    unit: CombatUnit,
    allies: Entity[],
    enemies: Entity[]
): SpreadDecision {
    // Check if any enemy has splash damage
    const splashEnemies = enemies.filter(e => {
        if (e.type !== 'UNIT') return false;
        const enemyData = RULES.units?.[e.key];
        return enemyData?.splash && enemyData.splash > 0;
    });

    if (splashEnemies.length === 0) {
        return { shouldSpread: false, spreadPosition: null };
    }

    // Check if we're too close to allies
    const nearbyAllies = allies.filter(a =>
        a.id !== unit.id &&
        a.type === 'UNIT' &&
        a.pos.dist(unit.pos) < MICRO_CONSTANTS.SPREAD_MIN_DISTANCE
    );

    if (nearbyAllies.length === 0) {
        return { shouldSpread: false, spreadPosition: null };
    }

    // Calculate spread direction (away from cluster center)
    let clusterCenter = unit.pos;
    for (const ally of nearbyAllies) {
        clusterCenter = clusterCenter.add(ally.pos);
    }
    clusterCenter = new Vector(
        clusterCenter.x / (nearbyAllies.length + 1),
        clusterCenter.y / (nearbyAllies.length + 1)
    );

    const awayFromCluster = unit.pos.sub(clusterCenter);
    if (awayFromCluster.mag() < 5) {
        // We're at the center, pick a random-ish direction based on unit ID
        const angle = (parseInt(unit.id, 36) % 360) * (Math.PI / 180);
        const spreadDir = new Vector(Math.cos(angle), Math.sin(angle));
        const spreadPos = unit.pos.add(spreadDir.scale(MICRO_CONSTANTS.SPREAD_MIN_DISTANCE));
        return { shouldSpread: true, spreadPosition: spreadPos };
    }

    const spreadDir = awayFromCluster.norm();
    const spreadPos = unit.pos.add(spreadDir.scale(MICRO_CONSTANTS.SPREAD_MIN_DISTANCE));

    return { shouldSpread: true, spreadPosition: spreadPos };
}

// ============ MAIN MICRO HANDLER ============

/**
 * Process micro-management for all combat units
 * Returns actions for movement commands
 */
export function processMicro(
    state: GameState,
    combatUnits: Entity[],
    enemies: Entity[],
    baseCenter: Vector
): Action[] {
    const actions: Action[] = [];

    for (const entity of combatUnits) {
        // Skip non-combat units
        if (entity.type !== 'UNIT' || entity.key === 'harvester' || entity.key === 'mcv') {
            continue;
        }

        const unit = entity as CombatUnit;
        const unitData = RULES.units?.[unit.key];
        if (!unitData) continue;

        const unitRange = unitData.range || 100;

        // Find nearby enemies
        const nearbyEnemies = enemies.filter(e =>
            e.type === 'UNIT' && e.pos.dist(unit.pos) < unitRange * 1.5
        );

        if (nearbyEnemies.length === 0) continue;

        // Find closest enemy
        let closestEnemy = nearbyEnemies[0];
        let closestDist = unit.pos.dist(closestEnemy.pos);
        for (const enemy of nearbyEnemies) {
            const d = unit.pos.dist(enemy.pos);
            if (d < closestDist) {
                closestDist = d;
                closestEnemy = enemy;
            }
        }

        // Priority 1: Retreat check
        const retreatDecision = evaluateRetreat(
            unit,
            nearbyEnemies,
            baseCenter,
            combatUnits
        );

        if (retreatDecision.shouldRetreat && retreatDecision.retreatPosition) {
            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: [unit.id],
                    x: retreatDecision.retreatPosition.x,
                    y: retreatDecision.retreatPosition.y
                }
            });
            continue;
        }

        // Priority 2: Kiting check
        const kiteDecision = evaluateKite(unit, closestEnemy, state.tick);

        if (kiteDecision.shouldKite && kiteDecision.kitePosition) {
            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: [unit.id],
                    x: kiteDecision.kitePosition.x,
                    y: kiteDecision.kitePosition.y
                }
            });
            continue;
        }

        // Priority 3: Stutter-stepping for slow melee units
        if (unit.combat.targetId) {
            const target = state.entities[unit.combat.targetId];
            if (target && !target.dead) {
                const stutterDecision = evaluateStutterStep(unit, target);
                if (stutterDecision.shouldStutter && stutterDecision.movePosition) {
                    actions.push({
                        type: 'COMMAND_MOVE',
                        payload: {
                            unitIds: [unit.id],
                            x: stutterDecision.movePosition.x,
                            y: stutterDecision.movePosition.y
                        }
                    });
                    continue;
                }
            }
        }

        // Priority 4: Spread against splash damage
        const spreadDecision = evaluateSpread(unit, combatUnits, enemies);
        if (spreadDecision.shouldSpread && spreadDecision.spreadPosition) {
            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: [unit.id],
                    x: spreadDecision.spreadPosition.x,
                    y: spreadDecision.spreadPosition.y
                }
            });
        }
    }

    return actions;
}

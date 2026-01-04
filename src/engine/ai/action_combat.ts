import { GameState, Action, Entity, UnitEntity, Vector, HarvesterUnit, EntityId } from '../types.js';
import { RULES, AIPersonality } from '../../data/schemas/index.js';
import { AIPlayerState, OffensiveGroup } from './types.js';
import {
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE,
    HARVESTER_FLEE_DISTANCE,
    RALLY_TIMEOUT,
    SCOUT_INTERVAL,
    MAX_CHASE_DISTANCE,
    RECENT_DAMAGE_WINDOW,
    ALLY_DANGER_RADIUS,
    THREAT_DETECTION_RADIUS,
    isUnit,
    getRefineries
} from './utils.js';
import { getGroupCenter } from './state.js';

export function handleAttack(
    state: GameState,
    _playerId: number,
    aiState: AIPlayerState,
    combatUnits: Entity[],
    enemies: Entity[],
    baseCenter: Vector,
    _personality: AIPersonality,
    ignoreSizeLimit: boolean = false
): Action[] {
    const actions: Action[] = [];

    if (enemies.length === 0) return actions;

    // Clean up attack group - remove dead units
    aiState.attackGroup = aiState.attackGroup.filter(id => {
        const unit = state.entities[id];
        return unit && !unit.dead;
    });

    // Add ALL available combat units to attack group during attack phase
    // ensuring we don't steal units from other specialized groups if needed
    // But original logic just added everything not in other groups (or even all combat units?)
    // Original: "Add ALL available combat units to attack group"
    for (const unit of combatUnits) {
        if (!aiState.attackGroup.includes(unit.id) &&
            !aiState.defenseGroup.includes(unit.id) &&
            !aiState.harassGroup.includes(unit.id)) {
            aiState.attackGroup.push(unit.id);
        }
    }

    // Only attack with a group of minimum size
    if (!ignoreSizeLimit && aiState.attackGroup.length < ATTACK_GROUP_MIN_SIZE) {
        // Disband group if too small so units can be rallied/used elsewhere
        aiState.attackGroup = [];
        aiState.offensiveGroups = aiState.offensiveGroups.filter(g => g.id !== 'main_attack');
        return actions;
    }

    // Get group center
    const groupCenter = getGroupCenter(aiState.attackGroup, state.entities);
    if (!groupCenter) return actions;

    // --- Group Cohesion Logic ---
    // Manage offensive group (create if doesn't exist or was cleared)
    let mainGroup = aiState.offensiveGroups.find(g => g.id === 'main_attack');

    // Update group members immediately
    if (mainGroup) {
        mainGroup.unitIds = [...aiState.attackGroup];
    }

    // If we switched strategy and came back, need a fresh group
    if (mainGroup && mainGroup.status === 'attacking') {
        const aliveUnits = mainGroup.unitIds.filter(id => state.entities[id] && !state.entities[id].dead);
        if (!ignoreSizeLimit && aliveUnits.length < ATTACK_GROUP_MIN_SIZE) {
            aiState.offensiveGroups = aiState.offensiveGroups.filter(g => g.id !== 'main_attack');
            mainGroup = undefined;
        }
    }

    if (!mainGroup) {
        mainGroup = {
            id: 'main_attack',
            unitIds: [...aiState.attackGroup],
            target: null, // Will be set by selectBestTarget
            rallyPoint: null,
            status: ignoreSizeLimit ? 'attacking' : 'forming',
            lastOrderTick: state.tick
        };
        aiState.offensiveGroups.push(mainGroup);
    }

    // Calculate rally point if not set
    if (!mainGroup.rallyPoint && aiState.enemyBaseLocation) {
        const toEnemy = aiState.enemyBaseLocation.sub(baseCenter).norm();
        const dist = baseCenter.dist(aiState.enemyBaseLocation);
        const rallyDist = Math.max(Math.min(dist * 0.5, 1000), 400);
        mainGroup.rallyPoint = baseCenter.add(toEnemy.scale(rallyDist));
    } else if (!mainGroup.rallyPoint) {
        mainGroup.rallyPoint = baseCenter.add(new Vector(300, 0));
    }

    // Handle Group State Machine (Forming -> Rallying -> Attacking)
    const cohesionActions = handleGroupCohesion(state, mainGroup, groupCenter);
    if (cohesionActions.length > 0) {
        actions.push(...cohesionActions);
        return actions; // Busy rallying or regrouping
    }

    // If we are here, we are READY TO ATTACK (status === 'attacking' and cohesive)

    // Find best target - prioritize threats and high-value targets
    const bestTarget = selectBestTarget(state, aiState, enemies, groupCenter, combatUnits);

    // --- MULTI-FRONT ATTACK (Simplified from original) ---
    // If army is large enough (10+ units), split into two attack groups
    const MULTI_FRONT_THRESHOLD = 10;

    // Check if multi-front attack is active (large army with 2+ targets)
    if (aiState.attackGroup.length >= MULTI_FRONT_THRESHOLD && enemies.length > 1 && bestTarget) {
        // Find second best target
        const secondBestTarget = selectBestTarget(state, aiState, enemies, groupCenter, combatUnits, [bestTarget.id]);

        if (secondBestTarget) {
            // Split the army: ~60% main, ~40% flank
            const splitIndex = Math.floor(aiState.attackGroup.length * 0.6);
            const mainGroupUnits = aiState.attackGroup.slice(0, splitIndex);
            const flankGroupUnits = aiState.attackGroup.slice(splitIndex);

            // Issue orders to Main Group
            issueAttackOrders(actions, state, mainGroupUnits, bestTarget.id);

            // Issue orders to Flank Group
            issueAttackOrders(actions, state, flankGroupUnits, secondBestTarget.id);

            return actions;
        }
    }

    // Standard Single Front Attack
    if (bestTarget) {
        issueAttackOrders(actions, state, aiState.attackGroup, bestTarget.id);
    } else if (aiState.attackGroup.length > 0 && enemies.length > 0) {
        // Fallback: Attack closest enemy
        issueAttackOrders(actions, state, aiState.attackGroup, enemies[0].id);
    }

    // Track combat
    if (actions.length > 0) {
        aiState.lastCombatTick = state.tick;
    }

    return actions;
}

function handleGroupCohesion(state: GameState, group: OffensiveGroup, groupCenter: Vector): Action[] {
    const actions: Action[] = [];
    // RALLY_TIMEOUT is imported

    // Check group cohesion
    let maxSpread = 0;
    let atRallyCount = 0;
    const aliveUnits = group.unitIds.filter(id => !state.entities[id]?.dead);

    for (const id of aliveUnits) {
        const unit = state.entities[id];
        if (unit) {
            const d = unit.pos.dist(groupCenter);
            if (d > maxSpread) maxSpread = d;
            if (group.rallyPoint && unit.pos.dist(group.rallyPoint) < 200) {
                atRallyCount++;
            }
        }
    }

    const isCohesive = atRallyCount >= aliveUnits.length * 0.7;
    const timedOut = (state.tick - group.lastOrderTick) > RALLY_TIMEOUT;

    // State machine transitions
    if (group.status === 'forming') {
        group.status = 'rallying';
        group.lastOrderTick = state.tick;
    }

    if (group.status === 'rallying') {
        if (isCohesive || timedOut) {
            group.status = 'attacking';
        } else {
            // Move ALL units to rally point
            const unitsToRally = aliveUnits.filter(id => {
                const unit = state.entities[id];
                // Force rally unless already very close
                if (group.rallyPoint && unit.pos.dist(group.rallyPoint) < 100) return false;
                return true;
            });

            if (unitsToRally.length > 0 && group.rallyPoint) {
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: unitsToRally,
                        x: group.rallyPoint.x,
                        y: group.rallyPoint.y
                    }
                });
            }
            return actions;
        }
    }

    // Regrouping logic during attack
    if (group.status === 'attacking') {
        let MAX_ATTACK_SPREAD = 500;

        // Relax spread check if we have a large army (likely multi-front)
        // This prevents regrouping when we intentionally split the army
        if (aliveUnits.length >= 10) { // MULTI_FRONT_THRESHOLD
            MAX_ATTACK_SPREAD = 2000;
        }

        // Check if we need to regroup (only if single front)
        if (maxSpread > MAX_ATTACK_SPREAD) {
            const unitsToRegroup = aliveUnits.filter(id => {
                const unit = state.entities[id];
                if (unit && unit.pos.dist(groupCenter) > 200) return true;
                return false;
            });

            if (unitsToRegroup.length > 0) {
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: unitsToRegroup,
                        x: groupCenter.x,
                        y: groupCenter.y
                    }
                });
                return actions;
            }
        }
    }

    return actions;
}

function selectBestTarget(
    state: GameState,
    aiState: AIPlayerState,
    enemies: Entity[],
    groupCenter: Vector,
    combatUnits: Entity[],
    excludeIds: EntityId[] = []
): Entity | null {
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;

    const targetPriority = ['conyard', 'factory', 'barracks', 'refinery', 'power'];

    // Identify active threats
    const activeThreats = new Set<EntityId>();
    for (const id of aiState.attackGroup) {
        const unit = state.entities[id];
        if (unit && !unit.dead && isUnit(unit) && (unit as UnitEntity).combat.lastAttackerId) {
            activeThreats.add((unit as UnitEntity).combat.lastAttackerId!);
        }
    }

    for (const enemy of enemies) {
        if (excludeIds.includes(enemy.id)) continue;

        let score = 0;
        const distFromGroup = enemy.pos.dist(groupCenter);

        // Leash distance penalty
        if (distFromGroup > MAX_CHASE_DISTANCE * 2) score -= 500;
        else if (distFromGroup > MAX_CHASE_DISTANCE) score -= (distFromGroup - MAX_CHASE_DISTANCE) * 0.5;

        // Threat Scoring
        const isThreat = activeThreats.has(enemy.id);
        if (isThreat) {
            score += 150;
            const hpRatio = enemy.hp / enemy.maxHp;
            if (hpRatio < 0.3) score += 100;
            else if (hpRatio < 0.6) score += 50;
        }

        // Defensive buildings
        if (enemy.type === 'BUILDING' && ['turret', 'pillbox', 'obelisk', 'sam', 'mammoth'].includes(enemy.key)) {
            if (isThreat) score += 100;
            else if (distFromGroup < 300) score += 75;
        }

        // Strategic Value
        if (enemy.type === 'BUILDING') {
            const priorityIndex = targetPriority.indexOf(enemy.key);
            if (priorityIndex >= 0) score += 80 - priorityIndex * 15;
            else score += 30;
        }

        // Unit value
        if (enemy.type === 'UNIT' && enemy.key !== 'harvester') score += 40;

        // Low HP Focus Fire
        const hpRatio = enemy.hp / enemy.maxHp;
        if (hpRatio < 0.2) score += 100;
        else if (hpRatio < 0.5) score += 75;
        else score += (1 - hpRatio) * 50;

        // Distance penalty
        score -= distFromGroup / 25;

        // Focus Fire Bonus (allies attacking same target)
        const alliesAttacking = combatUnits.filter(u => isUnit(u) && (u as UnitEntity).combat.targetId === enemy.id).length;
        if (alliesAttacking >= 3) score += 100 + alliesAttacking * 30;
        else score += alliesAttacking * 25;

        // Vengeance
        const vengeanceBonus = aiState.vengeanceScores[enemy.owner] || 0;
        score += vengeanceBonus * 0.5;

        if (score > bestScore) {
            bestScore = score;
            bestTarget = enemy;
        }
    }

    return bestTarget;
}

function issueAttackOrders(actions: Action[], state: GameState, unitIds: EntityId[], targetId: EntityId) {
    // Only issue orders to units that aren't already attacking this target
    // OR if they are idle
    const unitsNeedingOrders = unitIds.filter(id => {
        const unit = state.entities[id];
        if (!unit || unit.dead || !isUnit(unit)) return false;

        // If already targeting this, good.
        if ((unit as UnitEntity).combat.targetId === targetId) return false;

        // Let's force it to ensure focus fire
        return true;
    });

    if (unitsNeedingOrders.length > 0) {
        actions.push({
            type: 'COMMAND_ATTACK',
            payload: {
                unitIds: unitsNeedingOrders,
                targetId: targetId
            }
        });
    }
}

export function handleDefense(
    state: GameState,
    _playerId: number,
    aiState: AIPlayerState,
    combatUnits: Entity[],
    baseCenter: Vector,
    _personality: AIPersonality
): Action[] {
    const actions: Action[] = [];
    if (aiState.threatsNearBase.length === 0 || combatUnits.length === 0) {
        return actions;
    }

    // Assign available combat units to defense
    const defenders = combatUnits;

    // Sort threats by distance to base center (inner perimeter priority)
    const threats = aiState.threatsNearBase
        .map(id => state.entities[id])
        .filter(t => t && !t.dead)
        .sort((a, b) => a.pos.dist(baseCenter) - b.pos.dist(baseCenter));

    if (threats.length === 0) return actions;

    const primaryThreat = threats[0];

    // Issue attack command
    const unitsNeedingOrders = defenders.filter(u => {
        const unit = u as UnitEntity;
        return unit.combat && unit.combat.targetId !== primaryThreat.id;
    });

    if (unitsNeedingOrders.length > 0) {
        actions.push({
            type: 'COMMAND_ATTACK',
            payload: {
                unitIds: unitsNeedingOrders.map(u => u.id),
                targetId: primaryThreat.id
            }
        });
    }

    return actions;
}

export function handleHarass(
    state: GameState,
    _playerId: number,
    aiState: AIPlayerState,
    combatUnits: Entity[],
    enemies: Entity[]
): Action[] {
    const actions: Action[] = [];

    // Clean up
    aiState.harassGroup = aiState.harassGroup.filter(id => state.entities[id] && !state.entities[id].dead);

    // Refill
    if (aiState.harassGroup.length < HARASS_GROUP_SIZE) {
        const available = combatUnits.filter(u =>
            !aiState.harassGroup.includes(u.id) &&
            (u.key === 'rifle' || u.key === 'light' || u.key === 'jeep')
        );
        for (const unit of available) {
            if (aiState.harassGroup.length >= HARASS_GROUP_SIZE) break;
            aiState.harassGroup.push(unit.id);
        }
    }

    if (aiState.harassGroup.length < 2) return actions;

    // Logic similar to original handleHarass
    const harassTargets = enemies.filter(e =>
        e.key === 'harvester' ||
        (e.type === 'BUILDING' && (e.key === 'refinery' || e.key === 'power'))
    );

    const groupCenter = getGroupCenter(aiState.harassGroup, state.entities);
    if (!groupCenter) return actions;

    let bestTarget: Entity | null = null;
    let bestDist = Infinity;

    for (const target of harassTargets) {
        const dist = target.pos.dist(groupCenter);
        if (dist < bestDist) {
            bestDist = dist;
            bestTarget = target;
        }
    }

    if (!bestTarget && enemies.length > 0) {
        // Fallback to closest enemy
        for (const enemy of enemies) {
            const dist = enemy.pos.dist(groupCenter);
            if (dist < bestDist) {
                bestDist = dist;
                bestTarget = enemy;
            }
        }
    }

    if (bestTarget) {
        const unitsNeedingOrders = aiState.harassGroup.filter(id => {
            const unit = state.entities[id];
            return unit && !isUnit(unit) ? false : (unit as UnitEntity).combat.targetId !== bestTarget!.id;
        });

        if (unitsNeedingOrders.length > 0) {
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: {
                    unitIds: unitsNeedingOrders,
                    targetId: bestTarget.id
                }
            });
        }
    }

    return actions;
}

export function handleRally(
    state: GameState,
    _playerId: number,
    aiState: AIPlayerState,
    combatUnits: Entity[],
    baseCenter: Vector,
    _enemies: Entity[]
): Action[] {
    const actions: Action[] = [];

    if (aiState.strategy === 'attack' || aiState.strategy === 'defend' || aiState.strategy === 'harass' || aiState.strategy === 'all_in') {
        return actions;
    }

    const mapCenter = new Vector(state.config.width / 2, state.config.height / 2);
    const rallyPoint = baseCenter.add(mapCenter.sub(baseCenter).norm().scale(300));

    const freeUnits = combatUnits.filter(u =>
        !aiState.harassGroup.includes(u.id) &&
        !aiState.defenseGroup.includes(u.id) &&
        u.pos.dist(rallyPoint) > 150
    );

    if (freeUnits.length > 0) {
        // Only move if idle
        const idleUnits = freeUnits.filter(u => !(u as UnitEntity).movement.moveTarget && !(u as UnitEntity).combat.targetId);

        if (idleUnits.length > 0) {
            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: idleUnits.map(u => u.id),
                    x: rallyPoint.x,
                    y: rallyPoint.y
                }
            });
        }
    }
    return actions;
}

export function handleScouting(
    state: GameState,
    _playerId: number,
    aiState: AIPlayerState,
    combatUnits: Entity[],
    _enemies: Entity[],
    baseCenter: Vector
): Action[] {
    const actions: Action[] = [];
    if (state.tick - aiState.lastScoutTick < SCOUT_INTERVAL) return actions;
    if (aiState.enemyBaseLocation) return actions;

    const scouts = combatUnits.filter(u =>
        (u.key === 'jeep' || u.key === 'light' || u.key === 'rifle') &&
        !(u as UnitEntity).combat.targetId &&
        !(u as UnitEntity).movement.moveTarget
    );

    if (scouts.length === 0) return actions;

    const scout = scouts[0];
    aiState.lastScoutTick = state.tick;

    const quadrant = Math.floor(state.tick / SCOUT_INTERVAL) % 4;
    const MAP_SIZE = 3000; // estimated/fallback
    const w = state.config.width || MAP_SIZE;
    const h = state.config.height || MAP_SIZE;

    const corners = [
        new Vector(w - 200, 200),
        new Vector(w - 200, h - 200),
        new Vector(200, h - 200),
        new Vector(200, 200)
    ];

    let targetCorner = corners[quadrant];
    let maxDist = 0;
    for (const corner of corners) {
        const dist = corner.dist(baseCenter);
        if (dist > maxDist) {
            maxDist = dist;
            targetCorner = corner;
        }
    }

    actions.push({
        type: 'COMMAND_MOVE',
        payload: {
            unitIds: [scout.id],
            x: targetCorner.x,
            y: targetCorner.y
        }
    });

    return actions;
}

export function handleMicro(
    _state: GameState,
    combatUnits: Entity[],
    enemies: Entity[],
    baseCenter: Vector
): Action[] {
    const actions: Action[] = [];
    const RETREAT_THRESHOLD = 0.25;
    const KITE_RANGE_MINIMUM = 200;
    const KITE_DISTANCE_RATIO = 0.6;

    for (const unit of combatUnits) {
        const u = unit as UnitEntity;
        const unitData = RULES.units?.[unit.key] || {};
        const unitRange = unitData.range || 100;

        const nearbyEnemies = enemies.filter(e =>
            e.type === 'UNIT' && e.pos.dist(unit.pos) < unitRange * 1.5
        );
        if (nearbyEnemies.length === 0) continue;

        const hpRatio = unit.hp / unit.maxHp;

        let closestDest = Infinity;
        let closestEnemy = nearbyEnemies[0];

        for (const e of nearbyEnemies) {
            const d = e.pos.dist(u.pos);
            if (d < closestDest) {
                closestDest = d;
                closestEnemy = e;
            }
        }

        if (hpRatio < RETREAT_THRESHOLD) {
            const toBase = baseCenter.sub(u.pos).norm();
            let enemyDir = new Vector(0, 0);
            for (const e of nearbyEnemies) {
                enemyDir = enemyDir.add(e.pos.sub(u.pos));
            }
            const awayFromEnemy = enemyDir.scale(-1).norm();
            const retreatDir = toBase.scale(0.7).add(awayFromEnemy.scale(0.3)).norm();
            const retreatPos = u.pos.add(retreatDir.scale(200));

            actions.push({
                type: 'COMMAND_MOVE',
                payload: { unitIds: [u.id], x: retreatPos.x, y: retreatPos.y }
            });
            continue;
        }

        if (unitRange >= KITE_RANGE_MINIMUM) {
            const enemyData = RULES.units?.[closestEnemy.key] || {};
            const enemyRange = enemyData.range || 100;
            const hasRangeAdvantage = unitRange > enemyRange + 50;
            const kiteThreshold = unitRange * KITE_DISTANCE_RATIO;

            if (hasRangeAdvantage && closestDest < kiteThreshold) {
                const awayFromEnemy = unit.pos.sub(closestEnemy.pos).norm();
                const optimalRange = unitRange * 0.8;
                const kitePos = closestEnemy.pos.add(awayFromEnemy.scale(optimalRange));

                // Only kite if we improve position (simple check)
                if (unit.pos.dist(closestEnemy.pos) < optimalRange - 30) {
                    actions.push({
                        type: 'COMMAND_MOVE',
                        payload: { unitIds: [unit.id], x: kitePos.x, y: kitePos.y }
                    });
                }
            }
        }
    }
    return actions;
}

// Helper: Check if entity was damaged recently (within RECENT_DAMAGE_WINDOW ticks)
function wasRecentlyDamaged(state: GameState, entity: Entity): boolean {
    if (!isUnit(entity)) return false;
    return (entity as UnitEntity).combat.lastDamageTick !== undefined &&
        (state.tick - (entity as UnitEntity).combat.lastDamageTick!) < RECENT_DAMAGE_WINDOW;
}

export function handleHarvesterSafety(
    state: GameState,
    playerId: number,
    harvesters: Entity[],
    combatUnits: Entity[],
    baseCenter: Vector,
    enemies: Entity[],
    _aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    const MINIMUM_SAFE_DISTANCE = 80;

    for (const harv of harvesters) {
        const harvUnit = harv as HarvesterUnit;

        // Skip if already moving (fleeing)
        if (harvUnit.movement.moveTarget) continue;

        // Skip if on flee cooldown
        if (harvUnit.harvester.fleeCooldownUntilTick && state.tick < harvUnit.harvester.fleeCooldownUntilTick) {
            continue;
        }

        // IMPROVED ECONOMIC PRESSURE LOGIC (Issue #6)
        const hasSignificantCargo = harvUnit.harvester.cargo > 200;
        const isCriticallyBroke = player && player.credits < 300;

        const isLowHp = harvUnit.hp < harvUnit.maxHp * 0.3;

        let nearestThreat: Entity | null = null;
        let nearestDist = Infinity;
        let isDirectAttack = false;

        // Check recent damage (direct attack)
        const harvesterUnderFire = wasRecentlyDamaged(state, harv);

        // Check if any nearby ally (within ALLY_DANGER_RADIUS) was damaged recently
        const alliedUnits = Object.values(state.entities).filter(
            e => e.owner === harv.owner && e.type === 'UNIT' && !e.dead && e.id !== harv.id
        );
        const allyNearbyUnderFire = alliedUnits.some(ally => {
            const dist = ally.pos.dist(harv.pos);
            return dist < ALLY_DANGER_RADIUS && wasRecentlyDamaged(state, ally);
        });

        // Check recent damage (direct attack)
        if (harvUnit.combat.lastAttackerId) {
            const attacker = state.entities[harvUnit.combat.lastAttackerId];
            if (attacker && !attacker.dead) {
                if (harvesterUnderFire || isLowHp) { // ONLY consider direct attacker if we were actually damaged or low hp
                    nearestThreat = attacker;
                    nearestDist = attacker.pos.dist(harv.pos);
                    isDirectAttack = true;
                }
            }
        }

        // Proximity check (if no direct attacker found yet)
        if (!nearestThreat) {
            for (const enemy of enemies) {
                if (enemy.type !== 'UNIT') continue;
                if (enemy.key === 'harvester' && !isLowHp) continue;

                const dist = enemy.pos.dist(harv.pos);
                if (dist < HARVESTER_FLEE_DISTANCE && dist < nearestDist) {
                    nearestDist = dist;
                    nearestThreat = enemy;
                }
            }
        }

        // Decide to flee
        if (nearestThreat) {
            let shouldFlee = isDirectAttack;

            if (!shouldFlee) {
                if (allyNearbyUnderFire) shouldFlee = true;
                else if (nearestDist < MINIMUM_SAFE_DISTANCE) shouldFlee = true;
                else {
                    // Moderate threat distance

                    // Use specific infantry keys instead of 'scout' which caused TS error (scout not in UnitKey?)
                    // Or just check if unit is NOT a vehicle/heavy hitter
                    const isInfantryThreat = ['rifle', 'rocket', 'flamer', 'engineer', 'medic', 'sniper', 'grenadier', 'commando'].includes(nearestThreat.key);

                    if (isCriticallyBroke) shouldFlee = false;
                    else if (hasSignificantCargo) shouldFlee = false;
                    else if (isInfantryThreat) shouldFlee = false;
                    else shouldFlee = true;
                }
            }

            if (shouldFlee) {
                // Smart Flee: Try to find a safe refinery
                const myBuildings = Object.values(state.entities).filter(
                    e => e.type === 'BUILDING' && e.owner === playerId && !e.dead
                );
                const refineries = getRefineries(myBuildings);

                let safeRefinery: Entity | null = null;
                let bestSafeDist = Infinity;

                for (const ref of refineries) {
                    // Is this refinery safe?
                    const nearbyEnemy = enemies.find(e => e.pos.dist(ref.pos) < 500);
                    if (!nearbyEnemy) {
                        const d = harv.pos.dist(ref.pos);
                        if (d < bestSafeDist) {
                            bestSafeDist = d;
                            safeRefinery = ref;
                        }
                    }
                }

                let finalDest: Vector;
                if (safeRefinery) {
                    finalDest = safeRefinery.pos;
                } else {
                    // Panic Flee
                    const fleeDir = harv.pos.sub(nearestThreat.pos).norm();
                    const fleeDest = harv.pos.add(fleeDir.scale(HARVESTER_FLEE_DISTANCE));
                    const toBase = baseCenter.sub(harv.pos).norm();
                    finalDest = fleeDest.add(toBase.scale(100)); // Bias towards base
                }

                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: { unitIds: [harv.id], x: finalDest.x, y: finalDest.y }
                });

                // Dispatch defender - wide search radius
                const nearbyDefenders = findNearestDefender(harv.pos, combatUnits, 3000); // 3000 radius covers most map
                if (nearbyDefenders) {
                    actions.push({
                        type: 'COMMAND_ATTACK',
                        payload: { unitIds: [nearbyDefenders.id], targetId: nearestThreat.id }
                    });
                }
            }
        }
    }
    return actions;
}

export function handleHarvesterSuicideAttack(
    _state: GameState,
    _playerId: number,
    harvesters: Entity[],
    enemies: Entity[],
    combatUnits: Entity[] = []
): Action[] {
    const actions: Action[] = [];

    // Logic: Do NOT suicide harvesters if we still have combat units!
    const activeCombatUnits = combatUnits.filter(u => !u.dead);
    if (activeCombatUnits.length > 0) return actions;

    if (harvesters.length === 0 || enemies.length === 0) return actions;

    // Prioritize buildings
    const priorityTargets = ['conyard', 'factory', 'barracks', 'refinery', 'power'];
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;

    for (const enemy of enemies) {
        if (enemy.type !== 'BUILDING') continue;
        let score = 0;
        const idx = priorityTargets.indexOf(enemy.key);
        if (idx >= 0) score += 100 - idx * 15;
        else score += 20;

        score += (1 - enemy.hp / enemy.maxHp) * 30;

        const avgDist = harvesters.reduce((s, h) => s + h.pos.dist(enemy.pos), 0) / harvesters.length;
        score -= avgDist / 100;

        if (score > bestScore) {
            bestScore = score;
            bestTarget = enemy;
        }
    }

    if (!bestTarget) bestTarget = enemies[0];

    actions.push({
        type: 'COMMAND_ATTACK',
        payload: { unitIds: harvesters.map(h => h.id), targetId: bestTarget.id }
    });

    return actions;
}

export function findNearestDefender(
    pos: Vector,
    combatUnits: Entity[],
    maxDist: number = 500
): Entity | null {
    let nearest: Entity | null = null;
    let minDist = maxDist;

    for (const unit of combatUnits) {
        if (unit.dead) continue;
        const d = unit.pos.dist(pos);
        if (d < minDist) {
            minDist = d;
            nearest = unit;
        }
    }

    return nearest;
}

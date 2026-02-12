import { GameState, Action, Entity, UnitEntity, Vector, HarvesterUnit, EntityId, AirUnit } from '../types.js';
import { RULES, AIPersonality, isUnitData } from '../../data/schemas/index.js';
import { AIPlayerState, OffensiveGroup } from './types.js';
import { DebugEvents } from '../debug/events.js';
import {
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE,
    HARVESTER_FLEE_DISTANCE,
    RALLY_TIMEOUT,
    SCOUT_INTERVAL,
    MAX_CHASE_DISTANCE,
    RECENT_DAMAGE_WINDOW,
    ALLY_DANGER_RADIUS,
    GROUP_COHESION_RADIUS,
    GROUP_REGROUP_INTERVAL,
    GROUP_MOVE_SPREAD_MAX,
    GROUP_RETREAT_HEALTH,
    GROUP_REINFORCE_HEALTH,
    GROUP_ENGAGE_RADIUS,
    GROUP_HEALTH_CHECK_INTERVAL,
    isUnit,
    getRefineries,
    getDifficultyModifiers
} from './utils.js';
import { getGroupCenter } from './state.js';
import { findCaptureOpportunities } from './planning.js';
import { isAirUnit } from '../entity-helpers.js';
import { isDemoTruck } from '../type-guards.js';
import { EntityCache, getUnitsForOwner, getBuildingsForOwner } from '../perf.js';
import { getHarvesterRole } from './harvester/coordinator.js';
import { recordHarvesterDeath } from './harvester/danger_map.js';
import { getDesperationBehavior } from './harvester/desperation.js';
import { HarvesterRole } from './harvester/types.js';

export function handleAttack(
    state: GameState,
    _playerId: number,
    aiState: AIPlayerState,
    combatUnits: Entity[],
    enemies: Entity[],
    baseCenter: Vector,
    personality: AIPersonality,
    ignoreSizeLimit: boolean = false
): Action[] {
    const actions: Action[] = [];

    if (enemies.length === 0) return actions;

    // Get personality-specific group size limits
    const minGroupSize = personality.min_attack_group_size || ATTACK_GROUP_MIN_SIZE;
    const maxGroupSize = personality.max_attack_group_size || 15; // Default max

    // Clean up attack group - remove dead units
    aiState.attackGroup = aiState.attackGroup.filter(id => {
        const unit = state.entities[id];
        return unit && !unit.dead;
    });

    // Add available combat units to attack group (up to max size)
    // Respects personality's max_attack_group_size limit
    for (const unit of combatUnits) {
        if (aiState.attackGroup.length >= maxGroupSize) break; // Respect max size
        if (!aiState.attackGroup.includes(unit.id) &&
            !aiState.defenseGroup.includes(unit.id) &&
            !aiState.harassGroup.includes(unit.id)) {
            aiState.attackGroup.push(unit.id);
        }
    }

    // Only attack with a group of minimum size (personality-specific)
    if (!ignoreSizeLimit && aiState.attackGroup.length < minGroupSize) {
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

    // Prevent "trickle attacks" by controlling when new units join the group
    // Only accept new units during safe phases OR when group critically needs them
    if (mainGroup) {
        const canFreelyAcceptUnits = mainGroup.status === 'forming' ||
            mainGroup.status === 'rallying' ||
            mainGroup.status === 'retreating';

        // Count alive units currently in the group
        const aliveExistingUnits = mainGroup.unitIds.filter(id =>
            state.entities[id] && !state.entities[id].dead
        );

        // Check if group critically needs reinforcements (would disband otherwise)
        const needsCriticalReinforcements = aliveExistingUnits.length < minGroupSize;

        if (canFreelyAcceptUnits || needsCriticalReinforcements) {
            // Accept new units - group is safe or needs help
            mainGroup.unitIds = [...aiState.attackGroup];
        } else {
            // Group is actively attacking/moving with enough units
            // Don't add new units - they stay at base to avoid trickling
            mainGroup.unitIds = aliveExistingUnits;
            // Sync attackGroup to only include units actually in the active group
            aiState.attackGroup = aliveExistingUnits;
        }
    }

    // If we switched strategy and came back, need a fresh group
    if (mainGroup && mainGroup.status === 'attacking') {
        const aliveUnits = mainGroup.unitIds.filter(id => state.entities[id] && !state.entities[id].dead);
        // Only disband if we are critically low AND cannot reinforce
        // If we have plenty of units in global attackGroup, we should reinforce instead of disbanding
        const canReinforce = aiState.attackGroup.length >= minGroupSize;
        if (!ignoreSizeLimit && aliveUnits.length < minGroupSize && !canReinforce) {
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
            lastOrderTick: state.tick,
            // Group health tracking
            lastHealthCheck: state.tick,
            avgHealthPercent: 100,
            // Movement tracking
            moveTarget: null,
            lastRegroupTick: state.tick,
            // En-route combat
            engagedEnemies: [],
            preEngageTarget: null,
            // Reinforcement
            needsReinforcements: false,
            reinforcementIds: []
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

    // Handle Group State Machine (Forming -> Rallying -> Moving -> Attacking)
    // Can also transition to: Engaging (combat en route), Retreating, Reinforcing
    const cohesionActions = handleGroupCohesion(state, mainGroup, groupCenter, aiState, enemies, baseCenter, _playerId);
    if (cohesionActions.length > 0) {
        actions.push(...cohesionActions);
        // If retreating or reinforcing, don't continue to attack logic
        if (mainGroup.status === 'retreating' || mainGroup.status === 'reinforcing') {
            return actions;
        }
        // If rallying, moving, or engaging, also return early
        if (mainGroup.status !== 'attacking') {
            return actions;
        }
    }

    // If we are here, we are READY TO ATTACK (status === 'attacking' and cohesive)

    // Find best target - prioritize threats and high-value targets
    const bestTarget = selectBestTarget(state, aiState, enemies, groupCenter, combatUnits, [], baseCenter);

    // Emit debug event for target selection
    if (import.meta.env?.DEV && bestTarget) {
        DebugEvents.emit('decision', {
            tick: state.tick,
            playerId: _playerId,
            entityId: mainGroup.id,
            data: {
                category: 'combat',
                action: 'select-target',
                reason: `target=${bestTarget.key}:${bestTarget.id.slice(0, 8)}`,
                targetId: bestTarget.id,
                targetKey: bestTarget.key,
                groupSize: aiState.attackGroup.length
            }
        });
    }

    // --- MULTI-FRONT ATTACK (Simplified from original) ---
    // If army is large enough (10+ units), split into two attack groups
    const MULTI_FRONT_THRESHOLD = 10;

    // Check if multi-front attack is active (large army with 2+ targets)
    if (aiState.attackGroup.length >= MULTI_FRONT_THRESHOLD && enemies.length > 1 && bestTarget) {
        // Find second best target
        const secondBestTarget = selectBestTarget(state, aiState, enemies, groupCenter, combatUnits, [bestTarget.id], baseCenter);

        if (secondBestTarget) {
            // Split the army: ~60% main, ~40% flank
            const splitIndex = Math.floor(aiState.attackGroup.length * 0.6);
            const mainGroupUnits = aiState.attackGroup.slice(0, splitIndex);
            const flankGroupUnits = aiState.attackGroup.slice(splitIndex);

            // Issue orders to Main Group
            issueAttackOrders(actions, state, mainGroupUnits, bestTarget.id, _playerId);

            // Issue orders to Flank Group
            issueAttackOrders(actions, state, flankGroupUnits, secondBestTarget.id, _playerId);

            return actions;
        }
    }

    if (bestTarget) {
        issueAttackOrders(actions, state, aiState.attackGroup, bestTarget.id, _playerId);
    } else if (aiState.attackGroup.length > 0) {
        if (enemies.length > 0) {
            // Fallback: Attack closest enemy
            issueAttackOrders(actions, state, aiState.attackGroup, enemies[0].id, _playerId);
        } else if (aiState.enemyBaseLocation) {
            // Fallback: Attack-Move to last known enemy base location
            // This ensures units don't just hang around at the rally point if they can't see enemies yet
            actions.push({
                type: 'COMMAND_ATTACK_MOVE',
                payload: {
                    unitIds: aiState.attackGroup,
                    x: aiState.enemyBaseLocation.x,
                    y: aiState.enemyBaseLocation.y
                }
            });
        }
    }

    // Track combat
    if (actions.length > 0) {
        aiState.lastCombatTick = state.tick;
    }

    return actions;
}

function handleGroupCohesion(
    state: GameState,
    group: OffensiveGroup,
    groupCenter: Vector,
    aiState: AIPlayerState,
    enemies: Entity[],
    baseCenter: Vector,
    playerId: number
): Action[] {
    const actions: Action[] = [];

    // PERF: Pre-fetch all unit references once instead of repeated lookups
    const unitRefs: UnitEntity[] = [];
    const aliveUnits: EntityId[] = [];
    for (const id of group.unitIds) {
        const unit = state.entities[id];
        if (unit && !unit.dead) {
            unitRefs.push(unit as UnitEntity);
            aliveUnits.push(id);
        }
    }

    if (unitRefs.length === 0) return actions;

    // === HEALTH CHECK (periodic) ===
    if (state.tick - group.lastHealthCheck >= GROUP_HEALTH_CHECK_INTERVAL) {
        group.lastHealthCheck = state.tick;
        let totalHp = 0;
        let totalMaxHp = 0;
        // PERF: Use pre-fetched refs instead of repeated lookups
        for (const unit of unitRefs) {
            totalHp += unit.hp;
            totalMaxHp += unit.maxHp;
        }
        group.avgHealthPercent = totalMaxHp > 0 ? (totalHp / totalMaxHp) * 100 : 0;

        // Check for retreat condition
        if (group.avgHealthPercent < GROUP_RETREAT_HEALTH && group.status !== 'retreating') {
            const prevStatus = group.status;
            group.status = 'retreating';
            group.lastOrderTick = state.tick;
            if (import.meta.env?.DEV) {
                DebugEvents.emit('group', {
                    tick: state.tick,
                    playerId: playerId,
                    data: {
                        groupId: group.id,
                        action: 'status-changed',
                        prevStatus,
                        status: 'retreating',
                        reason: `avgHp=${group.avgHealthPercent.toFixed(0)}% < ${GROUP_RETREAT_HEALTH}%`
                    }
                });
            }
        }
        // Check for reinforcement request
        else if (group.avgHealthPercent < GROUP_REINFORCE_HEALTH && !group.needsReinforcements) {
            group.needsReinforcements = true;
        }
    }

    // === DETECT EN-ROUTE THREATS ===
    const nearbyThreats = enemies.filter(e => {
        if (e.dead) return false;
        const dist = e.pos.dist(groupCenter);
        return dist < GROUP_ENGAGE_RADIUS && e.type === 'UNIT';
    });

    // Check if any group member is under attack
    // PERF: Use pre-fetched unitRefs
    const unitsUnderAttack = unitRefs.filter(unit =>
        unit.combat.lastDamageTick && (state.tick - unit.combat.lastDamageTick) < RECENT_DAMAGE_WINDOW
    );

    // === STATE MACHINE ===

    // RETREATING: Move back to base
    if (group.status === 'retreating') {
        // Check if we've recovered enough to stop retreating
        if (group.avgHealthPercent >= GROUP_RETREAT_HEALTH + 20) {
            group.status = 'rallying';
            group.needsReinforcements = false;
            group.lastOrderTick = state.tick;
            if (import.meta.env?.DEV) {
                DebugEvents.emit('group', {
                    tick: state.tick,
                    playerId: playerId,
                    data: {
                        groupId: group.id,
                        action: 'status-changed',
                        prevStatus: 'retreating',
                        status: 'rallying',
                        reason: `avgHp=${group.avgHealthPercent.toFixed(0)}% recovered`
                    }
                });
            }
        } else {
            // Move all units toward base
            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: aliveUnits,
                    x: baseCenter.x,
                    y: baseCenter.y
                }
            });
            return actions;
        }
    }

    // REINFORCING: Wait at current position for reinforcements
    if (group.status === 'reinforcing') {
        // Check if reinforcements have arrived
        const reinforcementsArrived = group.reinforcementIds.filter(id => {
            const unit = state.entities[id];
            return unit && !unit.dead && unit.pos.dist(groupCenter) < GROUP_COHESION_RADIUS;
        });

        if (reinforcementsArrived.length >= group.reinforcementIds.length * 0.7 ||
            (state.tick - group.lastOrderTick) > RALLY_TIMEOUT) {
            // Reinforcements arrived or timed out, resume movement
            group.status = group.preEngageTarget ? 'moving' : 'attacking';
            group.reinforcementIds = [];
            group.needsReinforcements = false;
        }
        return actions; // Wait in place
    }

    // ENGAGING: Fighting enemies encountered en route
    if (group.status === 'engaging') {
        // Update engaged enemies (remove dead ones)
        group.engagedEnemies = group.engagedEnemies.filter(id => {
            const enemy = state.entities[id];
            return enemy && !enemy.dead;
        });

        // Check if engagement is over
        if (group.engagedEnemies.length === 0 && nearbyThreats.length === 0) {
            // Resume movement to previous target
            if (group.preEngageTarget) {
                group.moveTarget = group.preEngageTarget;
                group.preEngageTarget = null;
                group.status = 'moving';
            } else {
                group.status = 'attacking';
            }
        } else {
            // Continue engaging - attack nearest threat
            const sortedThreats = [...nearbyThreats].sort((a, b) =>
                a.pos.dist(groupCenter) - b.pos.dist(groupCenter)
            );
            if (sortedThreats.length > 0) {
                group.engagedEnemies = sortedThreats.slice(0, 3).map(e => e.id);
                issueAttackOrders(actions, state, aliveUnits, sortedThreats[0].id, playerId);
            }
            return actions;
        }
    }

    // Check if we should transition to ENGAGING (threat detected while moving/rallying)
    if ((group.status === 'rallying' || group.status === 'moving') &&
        (nearbyThreats.length > 0 || unitsUnderAttack.length > 0)) {
        // Save current destination before engaging
        const prevStatus = group.status;
        group.preEngageTarget = group.moveTarget || group.rallyPoint;
        group.status = 'engaging';
        group.engagedEnemies = nearbyThreats.map(e => e.id);
        group.lastOrderTick = state.tick;
        if (import.meta.env?.DEV) {
            DebugEvents.emit('group', {
                tick: state.tick,
                playerId: playerId,
                data: {
                    groupId: group.id,
                    action: 'status-changed',
                    prevStatus,
                    status: 'engaging',
                    reason: `threats=${nearbyThreats.length}, unitsUnderAttack=${unitsUnderAttack.length}`
                }
            });
        }
        // Attack the threats
        if (nearbyThreats.length > 0) {
            issueAttackOrders(actions, state, aliveUnits, nearbyThreats[0].id, playerId);
        }
        return actions;
    }

    // FORMING -> RALLYING
    if (group.status === 'forming') {
        group.status = 'rallying';
        group.lastOrderTick = state.tick;
    }

    // RALLYING: Gather at rally point before moving out
    if (group.status === 'rallying') {
        // PERF: Use pre-fetched unitRefs instead of repeated lookups
        let atRallyCount = 0;
        const unitsToRallyIds: EntityId[] = [];
        for (let i = 0; i < unitRefs.length; i++) {
            const unit = unitRefs[i];
            if (group.rallyPoint) {
                const distToRally = unit.pos.dist(group.rallyPoint);
                if (distToRally < GROUP_COHESION_RADIUS) {
                    atRallyCount++;
                }
                if (distToRally >= 100) {
                    // Only add if not already moving toward rally point
                    // This prevents re-commanding units that are in transit, which causes circling
                    const existingTarget = unit.movement.moveTarget;
                    if (!existingTarget || existingTarget.dist(group.rallyPoint!) > 400) {
                        unitsToRallyIds.push(aliveUnits[i]);
                    }
                }
            }
        }

        const isCohesive = atRallyCount >= unitRefs.length * 0.7;
        const timedOut = (state.tick - group.lastOrderTick) > RALLY_TIMEOUT;

        if (isCohesive || timedOut) {
            // Set move target to enemy base and transition to moving
            group.moveTarget = aiState.enemyBaseLocation || group.rallyPoint;
            group.status = 'moving';
            group.lastOrderTick = state.tick;
        } else {
            // Move units to rally point
            if (unitsToRallyIds.length > 0 && group.rallyPoint) {
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: unitsToRallyIds,
                        x: group.rallyPoint.x,
                        y: group.rallyPoint.y
                    }
                });
            }
            return actions;
        }
    }

    // MOVING: Move as a group toward target, waiting for stragglers
    if (group.status === 'moving' && group.moveTarget) {
        // PERF: Calculate spread using pre-fetched unitRefs
        let maxSpread = 0;
        for (const unit of unitRefs) {
            const d = unit.pos.dist(groupCenter);
            if (d > maxSpread) maxSpread = d;
        }

        // Check if group has arrived at target
        const distToTarget = groupCenter.dist(group.moveTarget);
        if (distToTarget < GROUP_COHESION_RADIUS) {
            group.status = 'attacking';
            group.moveTarget = null;
            return actions;
        }

        // Check if we need to wait for stragglers
        const needsRegroup = maxSpread > GROUP_MOVE_SPREAD_MAX &&
            (state.tick - group.lastRegroupTick) >= GROUP_REGROUP_INTERVAL;

        if (needsRegroup) {
            // Wait for stragglers - move front units slower or have stragglers catch up
            group.lastRegroupTick = state.tick;

            // PERF: Find stragglers using pre-fetched unitRefs (single pass)
            const stragglerThreshold = GROUP_MOVE_SPREAD_MAX * 0.6;
            const stragglerIds: EntityId[] = [];
            const frontUnitIds: EntityId[] = [];
            for (let i = 0; i < unitRefs.length; i++) {
                const unit = unitRefs[i];
                if (unit.pos.dist(groupCenter) > stragglerThreshold) {
                    // Only add straggler if not already heading toward group center
                    // This prevents re-commanding and circling
                    const existingTarget = unit.movement.moveTarget;
                    if (!existingTarget || existingTarget.dist(groupCenter) > 100) {
                        stragglerIds.push(aliveUnits[i]);
                    }
                } else {
                    frontUnitIds.push(aliveUnits[i]);
                }
            }

            // Move stragglers toward group center
            if (stragglerIds.length > 0) {
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: stragglerIds,
                        x: groupCenter.x,
                        y: groupCenter.y
                    }
                });
            }

            // Front units continue toward target but slower (by not issuing new commands)
            if (frontUnitIds.length > 0 && stragglerIds.length > unitRefs.length * 0.3) {
                // Too many stragglers - have front units wait
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: frontUnitIds,
                        x: groupCenter.x + (group.moveTarget.x - groupCenter.x) * 0.2,
                        y: groupCenter.y + (group.moveTarget.y - groupCenter.y) * 0.2
                    }
                });
            }
            return actions;
        }

        // Group is cohesive - move toward target
        // Filter out units already heading to the target to prevent re-commanding and circling
        const targetPos = group.moveTarget;
        const unitsNeedingCommand = aliveUnits.filter((_id, i) => {
            const existingTarget = unitRefs[i].movement.moveTarget;
            if (!existingTarget) return true; // Not moving, needs command
            return existingTarget.dist(targetPos) > 400; // Moving to wrong place
        });

        if (unitsNeedingCommand.length > 0) {
            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: unitsNeedingCommand,
                    x: group.moveTarget.x,
                    y: group.moveTarget.y
                }
            });
        }
        return actions;
    }

    // ATTACKING: Already at target, handled by main handleAttack function
    // Just manage straggler exclusion here
    if (group.status === 'attacking') {
        // PERF: Use pre-fetched unitRefs
        let maxSpread = 0;
        for (const unit of unitRefs) {
            const d = unit.pos.dist(groupCenter);
            if (d > maxSpread) maxSpread = d;
        }

        let MAX_ATTACK_SPREAD = 500;
        if (unitRefs.length >= 10) MAX_ATTACK_SPREAD = 2000;

        // If spread is too large during attack, trim stragglers
        if (maxSpread > MAX_ATTACK_SPREAD * 1.25) {
            const straggleThreshold = Math.max(400, maxSpread * 0.4);
            // PERF: Single pass using pre-fetched refs
            const frontLineUnits: EntityId[] = [];
            for (let i = 0; i < unitRefs.length; i++) {
                if (unitRefs[i].pos.dist(groupCenter) <= straggleThreshold) {
                    frontLineUnits.push(aliveUnits[i]);
                }
            }

            if (frontLineUnits.length > 0) {
                group.unitIds = frontLineUnits;
                aiState.attackGroup = frontLineUnits;
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
    excludeIds: EntityId[] = [],
    baseCenter?: Vector
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

    // PERF: Pre-compute target counts for focus-fire scoring (O(n) instead of O(n×m))
    const targetCounts = new Map<EntityId, number>();
    for (const u of combatUnits) {
        if (!isUnit(u)) continue;
        const targetId = (u as UnitEntity).combat.targetId;
        if (targetId) {
            targetCounts.set(targetId, (targetCounts.get(targetId) || 0) + 1);
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
            // Induction rigs are high-priority targets - they steal resources!
            if (enemy.key === 'induction_rig_deployed') {
                score += 120; // Higher than conyard priority
                // Extra aggression if near our base - this is an invasion!
                if (baseCenter) {
                    const distToOurBase = enemy.pos.dist(baseCenter);
                    if (distToOurBase < 800) {
                        score += 200; // Very high priority - they're stealing our wells!
                    } else if (distToOurBase < 1500) {
                        score += 100; // Still prioritize nearby rigs
                    }
                }
            } else {
                const priorityIndex = targetPriority.indexOf(enemy.key);
                if (priorityIndex >= 0) score += 80 - priorityIndex * 15;
                else score += 30;
            }
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
        // PERF: Use pre-computed target counts instead of filtering
        const alliesAttacking = targetCounts.get(enemy.id) || 0;
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

function issueAttackOrders(actions: Action[], state: GameState, unitIds: EntityId[], targetId: EntityId, playerId?: number) {
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

        // Emit debug events for each unit receiving attack command
        if (import.meta.env?.DEV) {
            const target = state.entities[targetId];
            for (const unitId of unitsNeedingOrders) {
                const unit = state.entities[unitId];
                DebugEvents.emit('command', {
                    tick: state.tick,
                    playerId: playerId ?? unit?.owner,
                    entityId: unitId,
                    data: {
                        command: 'attack',
                        source: 'ai',
                        targetId,
                        targetKey: target?.key,
                        reason: 'focus-fire'
                    }
                });
            }
        }
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

        // Emit debug event for defense decision
        if (import.meta.env?.DEV) {
            DebugEvents.emit('decision', {
                tick: state.tick,
                playerId: _playerId,
                data: {
                    category: 'combat',
                    action: 'defend',
                    reason: `threat=${primaryThreat.key}:${primaryThreat.id.slice(0, 8)}`,
                    targetId: primaryThreat.id,
                    targetKey: primaryThreat.key,
                    defenderCount: unitsNeedingOrders.length,
                    threatCount: threats.length
                }
            });
        }
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

            // Emit debug event for harass decision
            if (import.meta.env?.DEV) {
                DebugEvents.emit('decision', {
                    tick: state.tick,
                    playerId: _playerId,
                    data: {
                        category: 'combat',
                        action: 'harass',
                        reason: `target=${bestTarget.key}:${bestTarget.id.slice(0, 8)}`,
                        targetId: bestTarget.id,
                        targetKey: bestTarget.key,
                        harasserCount: unitsNeedingOrders.length
                    }
                });
            }
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

    // In doomed mode during buildup, we MUST rally units aggressively
    // Don't let them wander off attacking individually
    const isDoomedBuildup = aiState.isDoomed && aiState.strategy === 'buildup';

    const mapCenter = new Vector(state.config.width / 2, state.config.height / 2);
    const rallyPoint = baseCenter.add(mapCenter.sub(baseCenter).norm().scale(300));

    // ALWAYS check for stranded units, regardless of strategy
    // Stranded = idle, far from base (>1500), not in any active group
    const STRANDED_DISTANCE = 1500;
    const strandedUnits = combatUnits.filter(u => {
        const unit = u as UnitEntity;
        // Must be idle (no move target, no attack target)
        if (unit.movement.moveTarget || unit.combat.targetId) return false;
        // Must be far from base
        if (unit.pos.dist(baseCenter) < STRANDED_DISTANCE) return false;
        // Must not be in any active group
        if (aiState.attackGroup.includes(u.id)) return false;
        if (aiState.harassGroup.includes(u.id)) return false;
        if (aiState.defenseGroup.includes(u.id)) return false;
        return true;
    });

    if (strandedUnits.length > 0) {
        actions.push({
            type: 'COMMAND_MOVE',
            payload: {
                unitIds: strandedUnits.map(u => u.id),
                x: rallyPoint.x,
                y: rallyPoint.y
            }
        });
    }

    // Skip normal rally logic during active strategies (attack/defend/harass)
    if (!isDoomedBuildup && (aiState.strategy === 'attack' || aiState.strategy === 'defend' || aiState.strategy === 'harass' || aiState.strategy === 'all_in')) {
        return actions;
    }

    const freeUnits = combatUnits.filter(u =>
        !aiState.harassGroup.includes(u.id) &&
        !aiState.defenseGroup.includes(u.id) &&
        u.pos.dist(rallyPoint) > 150
    );

    if (freeUnits.length > 0) {
        if (isDoomedBuildup) {
            // In doomed buildup mode, FORCE all units to rally
            // Even if they're currently attacking, pull them back to group up
            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: freeUnits.map(u => u.id),
                    x: rallyPoint.x,
                    y: rallyPoint.y
                }
            });
        } else {
            // Normal mode: Only move if idle
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
    baseCenter: Vector,
    personality: AIPersonality,
    buildings: Entity[] = [],
    difficulty: 'easy' | 'medium' | 'hard' = 'hard'
): Action[] {
    const actions: Action[] = [];

    // Get difficulty modifiers
    const diffMods = getDifficultyModifiers(difficulty);

    // Easy AI has no micro - skip kiting and smart retreating entirely
    if (!diffMods.microEnabled) {
        return actions;
    }

    // Use personality's retreat threshold, scaled by difficulty
    // Easy AI retreats at higher HP (more cowardly), hard AI at intended threshold
    const baseRetreatThreshold = personality.retreat_threshold;
    const RETREAT_THRESHOLD = Math.min(0.8, baseRetreatThreshold * diffMods.retreatThresholdMultiplier);
    // Derive kite range from personality's kite_aggressiveness
    // Higher kite_aggressiveness = lower threshold = more likely to kite
    const kiteAggr = personality.kite_aggressiveness ?? 0.5;
    const KITE_RANGE_MINIMUM = 150 + Math.round((1 - kiteAggr) * 100);
    const KITE_DISTANCE_RATIO = 0.6;

    // DESPERATION MODE: Check if service depot exists
    // If no depot, damaged units should attack instead of retreating (no oscillation)
    const hasServiceDepot = buildings.some(b => b.key === 'service_depot' && !b.dead);

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
            // DESPERATION MODE: If no service depot, skip retreat - commit to attack
            // This prevents oscillation between retreat and attack
            if (!hasServiceDepot) {
                continue; // Don't retreat, let attack logic handle this unit
            }

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
            const canAttackWhileMoving = unitData.canAttackWhileMoving === true;

            if (hasRangeAdvantage && closestDest < kiteThreshold) {
                const awayFromEnemy = unit.pos.sub(closestEnemy.pos).norm();
                const optimalRange = unitRange * 0.8;
                const kitePos = closestEnemy.pos.add(awayFromEnemy.scale(optimalRange));

                if (canAttackWhileMoving) {
                    // Units that can attack while moving: continuous kiting
                    // Only kite if we improve position (simple check)
                    if (unit.pos.dist(closestEnemy.pos) < optimalRange - 30) {
                        actions.push({
                            type: 'COMMAND_MOVE',
                            payload: { unitIds: [unit.id], x: kitePos.x, y: kitePos.y }
                        });
                    }
                } else {
                    // Units that cannot attack while moving: stop-fire-move pattern
                    // CRITICAL: Don't interrupt unit if it's about to fire (cooldown == 0)
                    // Only move in these cases:
                    // 1. Just fired (cooldown > 90% of rate) - time to reposition
                    // 2. Dangerously close (< 30% of range) - emergency retreat
                    const unitRate = unitData.rate || 30;
                    const justFired = u.combat.cooldown >= unitRate * 0.9;
                    const isCriticallyClose = closestDest < unitRange * 0.3;
                    const readyToFire = u.combat.cooldown === 0;

                    // Never move if ready to fire (let unit shoot first)
                    if (readyToFire) {
                        continue;
                    }

                    // Only reposition after firing or in emergency
                    if (justFired || isCriticallyClose) {
                        // Only move if we're not already at optimal range
                        if (unit.pos.dist(closestEnemy.pos) < optimalRange - 50) {
                            actions.push({
                                type: 'COMMAND_MOVE',
                                payload: { unitIds: [unit.id], x: kitePos.x, y: kitePos.y }
                            });
                        }
                    }
                    // Otherwise stay put and let unit wait for cooldown
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

/**
 * Get role-based flee distance for a harvester.
 *
 * Base distances:
 * - 'safe': 250 pixels (most cautious)
 * - 'standard': 200 pixels (default behavior)
 * - 'risk-taker': 150 pixels (willing to take risks)
 * - 'opportunist': 100 pixels (only flee from immediate threats)
 *
 * Desperation modifier:
 * - High desperation (>70 / 'aggressive' or 'desperate'): 0.75x (flee less)
 * - Low desperation (<30 / 'very_cautious'): 1.25x (flee more)
 * - Otherwise: 1.0x (normal)
 */
function getFleeDistance(role: HarvesterRole, desperationScore: number): number {
    const baseDistance: Record<HarvesterRole, number> = {
        'safe': 250,
        'standard': 200,
        'risk-taker': 150,
        'opportunist': 100
    };

    // Get base distance for role
    const base = baseDistance[role];

    // Modify based on desperation
    const behavior = getDesperationBehavior(desperationScore);
    let modifier = 1.0;
    if (behavior.riskTolerance === 'aggressive' || behavior.riskTolerance === 'desperate') {
        modifier = 0.75;  // High desperation, flee less
    } else if (behavior.riskTolerance === 'very_cautious') {
        modifier = 1.25;  // Low desperation, flee more
    }

    return base * modifier;
}

export function handleHarvesterSafety(
    state: GameState,
    playerId: number,
    harvesters: Entity[],
    combatUnits: Entity[],
    baseCenter: Vector,
    enemies: Entity[],
    aiState: AIPlayerState,
    cache?: EntityCache,
    difficulty: 'dummy' | 'easy' | 'medium' | 'hard' = 'hard'
): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    const MINIMUM_SAFE_DISTANCE = 80;

    for (const harv of harvesters) {
        const harvUnit = harv as HarvesterUnit;

        // Skip if on flee cooldown
        if (harvUnit.harvester.fleeCooldownUntilTick && state.tick < harvUnit.harvester.fleeCooldownUntilTick) {
            continue;
        }

        // IMPROVED ECONOMIC PRESSURE LOGIC (Issue #6)
        const hasSignificantCargo = harvUnit.harvester.cargo > 200;
        const isCriticallyBroke = player && player.credits < 300;

        const isLowHp = harvUnit.hp < harvUnit.maxHp * 0.3;

        // Determine flee distance based on role and desperation (only for medium/hard)
        // Easy/dummy use default distance (no role-based behavior)
        let fleeDistance: number = HARVESTER_FLEE_DISTANCE;
        if (difficulty === 'medium' || difficulty === 'hard') {
            const role = getHarvesterRole(aiState.harvesterAI, harv.id);
            const desperationScore = aiState.harvesterAI.desperationScore;
            fleeDistance = getFleeDistance(role, desperationScore);
        }

        let nearestThreat: Entity | null = null;
        let nearestDist = Infinity;
        let isDirectAttack = false;

        // Check recent damage (direct attack)
        const harvesterUnderFire = wasRecentlyDamaged(state, harv);

        // Check if any nearby ally (within ALLY_DANGER_RADIUS) was damaged recently
        // PERF: Use cache instead of Object.values() to avoid allocation
        const alliedUnits = cache
            ? getUnitsForOwner(cache, harv.owner).filter(e => !e.dead && e.id !== harv.id)
            : Object.values(state.entities).filter(
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
        // Uses role-based flee distance for medium/hard difficulties
        if (!nearestThreat) {
            for (const enemy of enemies) {
                if (enemy.type !== 'UNIT') continue;
                if (enemy.key === 'harvester' && !isLowHp) continue;

                const dist = enemy.pos.dist(harv.pos);
                if (dist < fleeDistance && dist < nearestDist) {
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
                // PERF: Use cache instead of Object.values() to avoid allocation
                const myBuildings = cache
                    ? getBuildingsForOwner(cache, playerId).filter(e => !e.dead)
                    : Object.values(state.entities).filter(
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
                    // BUG FIX: Position outside refinery to avoid isTargetBlocked clearing moveTarget
                    const toRef = safeRefinery.pos.sub(harv.pos);
                    if (toRef.mag() > 1) { // Only adjust if not already at refinery
                        const toRefNorm = toRef.norm();
                        const radius = safeRefinery.radius || 50;
                        finalDest = safeRefinery.pos.sub(toRefNorm.scale(radius + 30));
                    } else {
                        finalDest = safeRefinery.pos;
                    }
                } else {
                    // Panic Flee - uses role-based flee distance
                    const fleeDir = harv.pos.sub(nearestThreat.pos).norm();
                    const fleeDest = harv.pos.add(fleeDir.scale(fleeDistance));
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

/**
 * Detect and record harvester deaths.
 *
 * Call this function each AI tick to track which harvesters have died.
 * Records death positions in the danger map for future path avoidance.
 *
 * @param aiState - The AI player state containing harvesterAI
 * @param previousHarvesterIds - Set of harvester IDs that existed last tick
 * @param currentHarvesters - Current list of live harvesters
 * @param allEntities - All game entities (to get death positions)
 * @param tick - Current game tick
 * @param difficulty - AI difficulty level
 */
export function recordDeadHarvesters(
    aiState: AIPlayerState,
    previousHarvesterIds: Set<EntityId>,
    currentHarvesters: Entity[],
    allEntities: Record<EntityId, Entity>,
    tick: number,
    difficulty: 'dummy' | 'easy' | 'medium' | 'hard'
): void {
    // Only record deaths for hard difficulty (medium doesn't use death memory)
    if (difficulty !== 'hard') {
        return;
    }

    // Build set of current harvester IDs
    const currentIds = new Set(currentHarvesters.map(h => h.id));

    // Find harvesters that existed before but don't exist in current list
    for (const prevId of previousHarvesterIds) {
        if (!currentIds.has(prevId)) {
            // Harvester is missing - check if it's dead
            const entity = allEntities[prevId];
            if (entity && entity.dead) {
                // Record the death at its last known position
                recordHarvesterDeath(aiState.harvesterAI, entity.pos, tick);
            }
        }
    }
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

/**
 * Handle air strikes with harriers.
 * Launches docked harriers at high-value targets like harvesters and production buildings.
 */
export function handleAirStrikes(
    state: GameState,
    playerId: number,
    enemies: Entity[],
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];

    // Find all docked harriers with ammo
    const dockedHarriers: AirUnit[] = [];
    for (const id in state.entities) {
        const entity = state.entities[id];
        if (entity.owner === playerId && !entity.dead && isAirUnit(entity)) {
            if (entity.airUnit.state === 'docked' && entity.airUnit.ammo > 0) {
                dockedHarriers.push(entity);
            }
        }
    }

    if (dockedHarriers.length === 0 || enemies.length === 0) {
        return actions;
    }

    // Define high-value target priorities for air strikes
    const buildingPriorities = ['conyard', 'factory', 'refinery', 'airforce_command', 'barracks', 'power', 'sam_site', 'turret'];
    // High-value combat units to target
    const unitPriorities = ['harvester', 'mcv', 'mammoth', 'medium_tank', 'light_tank', 'rocket_soldier', 'minigunner'];

    // Find best target for air strike
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;

    for (const enemy of enemies) {
        let score = 0;

        // Priority based on type
        if (enemy.type === 'UNIT') {
            const unitPriorityIndex = unitPriorities.indexOf(enemy.key);
            if (unitPriorityIndex >= 0) {
                // Harvesters and MCVs are highest priority (economic damage)
                score += 150 - unitPriorityIndex * 15;
            } else {
                // Other units still get a base score
                score += 30;
            }
        } else if (enemy.type === 'BUILDING') {
            const priorityIndex = buildingPriorities.indexOf(enemy.key);
            if (priorityIndex >= 0) {
                score += 120 - priorityIndex * 12;
            } else {
                // Other buildings still get a base score
                score += 20;
            }
        }

        // Low HP bonus - finish off weakened targets
        const hpRatio = enemy.hp / enemy.maxHp;
        if (hpRatio < 0.3) score += 80;
        else if (hpRatio < 0.5) score += 50;

        // Avoid targets with anti-air defenses nearby
        const hasNearbyAA = enemies.some(e =>
            e.type === 'BUILDING' &&
            (e.key === 'sam_site') &&
            e.pos.dist(enemy.pos) < 300
        );
        if (hasNearbyAA) score -= 80; // Reduced penalty to still allow attacks

        // Prefer targets near enemy base location if known
        if (aiState.enemyBaseLocation) {
            const distToBase = enemy.pos.dist(aiState.enemyBaseLocation);
            if (distToBase < 500) score += 30; // Bonus for targets near enemy base
        }

        if (score > bestScore) {
            bestScore = score;
            bestTarget = enemy;
        }
    }

    if (bestTarget && bestScore > 0) {
        // Launch up to 3 harriers at once for coordinated strikes
        const harriersToLaunch = Math.min(dockedHarriers.length, 3);
        for (let i = 0; i < harriersToLaunch; i++) {
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: {
                    unitIds: [dockedHarriers[i].id],
                    targetId: bestTarget.id
                }
            });
        }

        // Emit debug event for air strike decision
        if (import.meta.env?.DEV) {
            DebugEvents.emit('decision', {
                tick: state.tick,
                playerId: playerId,
                data: {
                    category: 'combat',
                    action: 'air-strike',
                    reason: `target=${bestTarget.key}:${bestTarget.id.slice(0, 8)}, score=${bestScore.toFixed(0)}`,
                    targetId: bestTarget.id,
                    targetKey: bestTarget.key,
                    harrierCount: harriersToLaunch,
                    scores: { targetScore: bestScore }
                }
            });
        }
    }

    return actions;
}

/**
 * Handle demo truck assault - send demo trucks to high-value targets.
 * Demo trucks are suicide units that deal massive area damage on detonation.
 * They should target clustered enemies or high-value buildings.
 */
export function handleDemoTruckAssault(
    state: GameState,
    playerId: number,
    enemies: Entity[],
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];

    // Find all idle demo trucks (not attacking, not dead)
    const idleDemoTrucks: Entity[] = [];
    for (const id in state.entities) {
        const entity = state.entities[id];
        if (entity.owner === playerId && !entity.dead && isDemoTruck(entity)) {
            // Check if not already attacking (no detonation target set)
            if (!entity.demoTruck.detonationTargetId && !entity.demoTruck.detonationTargetPos) {
                idleDemoTrucks.push(entity);
            }
        }
    }

    if (idleDemoTrucks.length === 0 || enemies.length === 0) {
        return actions;
    }

    // Define high-value target priorities for demo truck strikes
    // Buildings are primary targets - demo trucks excel at structure destruction
    const buildingPriorities = ['conyard', 'factory', 'refinery', 'barracks', 'tech', 'airforce_command', 'power'];

    // Find best target for demo truck assault
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;

    for (const enemy of enemies) {
        let score = 0;

        // Buildings are primary targets for demo trucks
        if (enemy.type === 'BUILDING') {
            const priorityIndex = buildingPriorities.indexOf(enemy.key);
            if (priorityIndex >= 0) {
                score += 200 - priorityIndex * 20; // High base score for priority buildings
            } else {
                score += 50; // Other buildings still valuable
            }

            // Defense buildings are harder but still valid targets
            if (['turret', 'pillbox', 'obelisk', 'sam_site'].includes(enemy.key)) {
                score += 30; // Bonus for clearing defenses
            }
        } else if (enemy.type === 'UNIT') {
            // Demo trucks can target units but buildings are preferred
            if (enemy.key === 'harvester') {
                score += 80; // Harvesters are economic damage
            } else if (enemy.key === 'mcv') {
                score += 100; // MCVs are high value
            } else if (enemy.key === 'mammoth') {
                score += 90; // Mammoth tanks are expensive and tough
            } else {
                score += 30; // Other units less valuable for suicide attack
            }
        }

        // Low HP bonus - finish off weakened targets
        const hpRatio = enemy.hp / enemy.maxHp;
        if (hpRatio < 0.3) score += 60;
        else if (hpRatio < 0.5) score += 40;

        // Cluster bonus - demo trucks deal splash damage
        // Count enemies near this target
        let nearbyEnemies = 0;
        for (const other of enemies) {
            if (other.id !== enemy.id && other.pos.dist(enemy.pos) < 100) {
                nearbyEnemies++;
            }
        }
        score += nearbyEnemies * 25; // Bonus per nearby enemy

        // Prefer targets near enemy base location if known
        if (aiState.enemyBaseLocation) {
            const distToBase = enemy.pos.dist(aiState.enemyBaseLocation);
            if (distToBase < 500) score += 50; // Bonus for targets near enemy base
        }

        // Distance penalty (don't send too far)
        const distFromOurUnits = idleDemoTrucks[0].pos.dist(enemy.pos);
        score -= distFromOurUnits / 20; // Light distance penalty

        if (score > bestScore) {
            bestScore = score;
            bestTarget = enemy;
        }
    }

    // Only attack if we found a worthwhile target
    // Minimum score threshold to avoid wasting demo trucks on low-value targets
    if (bestTarget && bestScore > 100) {
        // Send one demo truck at a time (they're expensive)
        actions.push({
            type: 'COMMAND_ATTACK',
            payload: {
                unitIds: [idleDemoTrucks[0].id],
                targetId: bestTarget.id
            }
        });

        // Emit debug event for demo truck assault decision
        if (import.meta.env?.DEV) {
            DebugEvents.emit('decision', {
                tick: state.tick,
                playerId: playerId,
                entityId: idleDemoTrucks[0].id,
                data: {
                    category: 'combat',
                    action: 'demo-truck-assault',
                    reason: `target=${bestTarget.key}:${bestTarget.id.slice(0, 8)}, score=${bestScore.toFixed(0)}`,
                    targetId: bestTarget.id,
                    targetKey: bestTarget.key,
                    scores: { targetScore: bestScore }
                }
            });
        }
    }

    return actions;
}

/**
 * Handle unit repair - move critically damaged units to service depot
 */
export function handleUnitRepair(
    _state: GameState,
    playerId: number,
    combatUnits: Entity[],
    buildings: Entity[]
): Action[] {
    const actions: Action[] = [];

    // Find service depots
    const serviceDepots = buildings.filter(b =>
        b.key === 'service_depot' &&
        !b.dead &&
        b.owner === playerId
    );

    if (serviceDepots.length === 0) return actions;

    const RETREAT_THRESHOLD = 0.4; // Below 40% HP
    // Service depot is 120x120, so edge is 60 from center. Units should park just outside.
    const DEPOT_EDGE_OFFSET = 70; // Distance from depot center to park units
    const DEPOT_PROXIMITY = 50; // Already at depot if within this distance from target position

    // Track units assigned to each depot for congestion handling
    const depotAssignments: Map<string, number> = new Map();

    // First pass: count units already near each depot (including healthy ones waiting)
    for (const depot of serviceDepots) {
        let nearbyCount = 0;
        for (const unit of combatUnits) {
            if (unit.dead || unit.type !== 'UNIT') continue;
            if (unit.key === 'harvester') continue;
            if (isAirUnit(unit as UnitEntity)) continue;

            // Service depot only repairs vehicles, skip infantry
            const unitData = RULES.units[unit.key];
            if (!unitData || !isUnitData(unitData) || unitData.type !== 'vehicle') continue;

            const dist = unit.pos.dist(depot.pos);
            // Count units already near the depot
            if (dist < DEPOT_EDGE_OFFSET + 40) {
                nearbyCount++;
            }
        }
        depotAssignments.set(depot.id, nearbyCount);
    }

    for (const unit of combatUnits) {
        if (unit.dead || unit.type !== 'UNIT') continue;

        // Skip harvesters (they have their own behavior)
        if (unit.key === 'harvester') continue;

        // Skip air units (they need different handling)
        if (isAirUnit(unit as UnitEntity)) continue;

        // Service depot only repairs vehicles, skip infantry
        const unitData = RULES.units[unit.key];
        if (!unitData || !isUnitData(unitData) || unitData.type !== 'vehicle') continue;

        const hpRatio = unit.hp / unit.maxHp;

        // If unit is critically damaged
        if (hpRatio < RETREAT_THRESHOLD) {
            // Find nearest service depot
            let nearestDepot: Entity | null = null;
            let nearestDist = Infinity;

            for (const depot of serviceDepots) {
                const dist = unit.pos.dist(depot.pos);
                if (dist < nearestDist) {
                    nearestDist = dist;
                    nearestDepot = depot;
                }
            }

            if (!nearestDepot) continue;

            // Get congestion count for this depot and increment it
            const congestionIndex = depotAssignments.get(nearestDepot.id) || 0;
            depotAssignments.set(nearestDepot.id, congestionIndex + 1);

            // Calculate target position on depot edge, spread around based on congestion
            // Use congestion index to spread units around the depot (8 positions around)
            const angleOffset = (congestionIndex % 8) * (Math.PI / 4); // 45 degree increments
            const angle = angleOffset;

            const targetX = nearestDepot.pos.x + Math.cos(angle) * DEPOT_EDGE_OFFSET;
            const targetY = nearestDepot.pos.y + Math.sin(angle) * DEPOT_EDGE_OFFSET;

            // Check if unit is already close to its target position
            const distToTarget = Math.sqrt(
                Math.pow(unit.pos.x - targetX, 2) +
                Math.pow(unit.pos.y - targetY, 2)
            );

            // Move to depot edge if not already there
            if (distToTarget > DEPOT_PROXIMITY) {
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: [unit.id],
                        x: targetX,
                        y: targetY
                    }
                });
            }
        }
    }

    return actions;
}

/**
 * Handle engineer capture missions - send engineers to capture valuable enemy buildings
 */
export function handleEngineerCapture(
    state: GameState,
    _playerId: number,
    _aiState: AIPlayerState,
    engineers: Entity[],
    enemies: Entity[],
    baseCenter: Vector
): Action[] {
    const actions: Action[] = [];

    if (engineers.length === 0) return actions;

    // Find capture opportunities sorted by value
    const captureOps = findCaptureOpportunities(enemies, baseCenter);

    if (captureOps.length === 0) return actions;

    // Track which buildings are already being targeted
    const targetedBuildings = new Set<EntityId>();

    for (const engineer of engineers) {
        if (engineer.dead) continue;

        // Check if engineer already has a valid building target
        const engUnit = engineer as UnitEntity;
        if (engUnit.combat?.targetId) {
            const currentTarget = state.entities[engUnit.combat.targetId];
            if (currentTarget && currentTarget.type === 'BUILDING' && !currentTarget.dead) {
                // Already has valid target - mark it as targeted and skip
                targetedBuildings.add(currentTarget.id);
                continue;
            }
        }

        // Find best unassigned capture target
        for (const op of captureOps) {
            const building = op.building;

            // Skip if another engineer is already targeting this
            if (targetedBuildings.has(building.id)) continue;

            // Mark as targeted and order engineer to capture
            targetedBuildings.add(building.id);
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: { unitIds: [engineer.id], targetId: building.id }
            });
            break;
        }
    }

    return actions;
}

/**
 * Handle hijacker assault - send hijackers to steal high-value enemy vehicles
 */
export function handleHijackerAssault(
    state: GameState,
    playerId: number,
    enemies: Entity[],
    _aiState: AIPlayerState,
    _baseCenter: Vector
): Action[] {
    const actions: Action[] = [];

    // Find idle hijackers (owned, alive, no current target)
    const idleHijackers: Entity[] = [];
    for (const id in state.entities) {
        const entity = state.entities[id];
        if (entity.owner === playerId && !entity.dead &&
            entity.type === 'UNIT' && entity.key === 'hijacker') {
            const unit = entity as UnitEntity;
            if (!unit.combat?.targetId) {
                idleHijackers.push(entity);
            }
        }
    }

    if (idleHijackers.length === 0 || enemies.length === 0) {
        return actions;
    }

    // Find enemy vehicles and score them
    const vehicleScores: { entity: Entity; score: number }[] = [];

    const vehicleValueScores: Record<string, number> = {
        mcv: 250,
        mammoth: 200,
        harvester: 180,    // High priority: denies enemy income + gains a free 1000cr unit
        heavy: 150,
        mlrs: 120,
        artillery: 120,
        light: 80,
        flame_tank: 80,
        stealth: 80,
        apc: 60,
        jeep: 60
    };

    for (const enemy of enemies) {
        if (enemy.type !== 'UNIT' || enemy.dead) continue;
        const unitData = RULES.units[enemy.key];
        if (!unitData || !isUnitData(unitData) || unitData.type !== 'vehicle') continue;
        // Skip other hijackers and demo trucks
        if (enemy.key === 'hijacker' || enemy.key === 'demo_truck' || enemy.key === 'induction_rig') continue;

        let score = vehicleValueScores[enemy.key] ?? 50;

        // Low HP bonus
        const hpRatio = enemy.hp / enemy.maxHp;
        if (hpRatio < 0.5) score += 40;

        // Distance penalty from closest hijacker
        const closestDist = Math.min(...idleHijackers.map(h => h.pos.dist(enemy.pos)));
        score -= closestDist / 10;

        vehicleScores.push({ entity: enemy, score });
    }

    if (vehicleScores.length === 0) return actions;

    // Sort by score descending
    vehicleScores.sort((a, b) => b.score - a.score);

    // Assign one hijacker per target
    const targetedVehicles = new Set<EntityId>();

    for (const hijacker of idleHijackers) {
        let bestTarget: Entity | null = null;
        let bestScore = -Infinity;

        for (const { entity, score } of vehicleScores) {
            if (targetedVehicles.has(entity.id)) continue;

            // Per-hijacker distance adjustment
            const dist = hijacker.pos.dist(entity.pos);
            const adjustedScore = score - dist / 10;

            if (adjustedScore > bestScore) {
                bestScore = adjustedScore;
                bestTarget = entity;
            }
        }

        if (bestTarget && bestScore > 0) {
            targetedVehicles.add(bestTarget.id);
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: { unitIds: [hijacker.id], targetId: bestTarget.id }
            });

            if (import.meta.env?.DEV) {
                DebugEvents.emit('decision', {
                    tick: state.tick,
                    playerId,
                    entityId: hijacker.id,
                    data: {
                        category: 'combat',
                        action: 'hijacker-assault',
                        reason: `target=${bestTarget.key}:${bestTarget.id.slice(0, 8)}, score=${bestScore.toFixed(0)}`,
                        targetId: bestTarget.id,
                        targetKey: bestTarget.key,
                        scores: { targetScore: bestScore }
                    }
                });
            }
        }
    }

    return actions;
}

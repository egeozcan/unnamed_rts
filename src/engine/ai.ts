import { GameState, Action, Entity, EntityId, Vector } from './types.js';
import aiConfig from '../data/ai.json';
import rules from '../data/rules.json';

const RULES = rules as any;
const AI_CONFIG = aiConfig as any;

// AI Strategy Types
export type AIStrategy = 'buildup' | 'attack' | 'defend' | 'harass';

// Offensive Group - manages a coordinated attack force
export interface OffensiveGroup {
    id: string;
    unitIds: EntityId[];
    target: EntityId | null;
    rallyPoint: Vector | null;
    status: 'forming' | 'rallying' | 'attacking' | 'retreating';
    lastOrderTick: number;
}

// AI State tracking (per player, stored separately since GameState is immutable)
export interface AIPlayerState {
    strategy: AIStrategy;
    lastStrategyChange: number;
    attackGroup: EntityId[];
    harassGroup: EntityId[];
    defenseGroup: EntityId[];
    threatsNearBase: EntityId[];
    harvestersUnderAttack: EntityId[];
    offensiveGroups: OffensiveGroup[];
    enemyBaseLocation: Vector | null;
    lastScoutTick: number;
}

// Store AI states (keyed by playerId)
const aiStates: Record<number, AIPlayerState> = {};

function getAIState(playerId: number): AIPlayerState {
    if (!aiStates[playerId]) {
        aiStates[playerId] = {
            strategy: 'buildup',
            lastStrategyChange: 0,
            attackGroup: [],
            harassGroup: [],
            defenseGroup: [],
            threatsNearBase: [],
            harvestersUnderAttack: [],
            offensiveGroups: [],
            enemyBaseLocation: null,
            lastScoutTick: 0
        };
    }
    return aiStates[playerId];
}

// Reset AI state (useful for tests)
export function resetAIState(playerId?: number): void {
    if (playerId !== undefined) {
        delete aiStates[playerId];
    } else {
        for (const key in aiStates) {
            delete aiStates[key];
        }
    }
}

// Constants for AI behavior
const BASE_DEFENSE_RADIUS = 500;
const ATTACK_GROUP_MIN_SIZE = 5;
const HARASS_GROUP_SIZE = 3;
const HARVESTER_FLEE_DISTANCE = 300;
const THREAT_DETECTION_RADIUS = 400;
const STRATEGY_COOLDOWN = 300; // 5 seconds at 60 ticks/sec
const RALLY_DISTANCE = 150; // Distance from target to rally before attack


export function computeAiActions(state: GameState, playerId: number): Action[] {
    const actions: Action[] = [];

    // Only run AI every 30 ticks (0.5 seconds) for better responsiveness
    if (state.tick % 30 !== 0) return actions;

    const player = state.players[playerId];
    if (!player) return actions;

    const aiState = getAIState(playerId);
    const myEntities = Object.values(state.entities).filter(e => e.owner === playerId && !e.dead);
    const myBuildings = myEntities.filter(e => e.type === 'BUILDING');
    const myUnits = myEntities.filter(e => e.type === 'UNIT');
    const myHarvesters = myUnits.filter(u => u.key === 'harvester');
    const myCombatUnits = myUnits.filter(u => u.key !== 'harvester');
    const enemies = Object.values(state.entities).filter(e => e.owner !== playerId && e.owner !== -1 && !e.dead);
    const enemyBuildings = enemies.filter(e => e.type === 'BUILDING');
    const enemyUnits = enemies.filter(e => e.type === 'UNIT');

    // Find base center (conyard or average of buildings)
    const baseCenter = findBaseCenter(myBuildings);

    // Discover enemy base location (for attack targeting)
    updateEnemyBaseLocation(aiState, enemyBuildings);

    // Update threat detection
    const { threatsNearBase, harvestersUnderAttack } = detectThreats(
        baseCenter, myHarvesters, enemies, myBuildings
    );
    aiState.threatsNearBase = threatsNearBase;
    aiState.harvestersUnderAttack = harvestersUnderAttack;

    // Strategy decision
    const personality = AI_CONFIG.personalities['balanced'];
    updateStrategy(aiState, state.tick, myBuildings, myCombatUnits, enemies, threatsNearBase, personality);

    // Execute strategy-specific actions

    // 1. Always check for emergency selling if cash is low
    actions.push(...handleEmergencySell(state, playerId, myBuildings, player, aiState));

    // 2. Always handle economy
    actions.push(...handleEconomy(state, playerId, myBuildings, player, personality));

    // 2. Handle harvester defense/fleeing
    actions.push(...handleHarvesterSafety(state, playerId, myHarvesters, myCombatUnits, baseCenter, enemies, aiState));

    // 3. Handle base defense (always check, strategy just goes into full defense mode)
    if (aiState.strategy === 'defend' || threatsNearBase.length > 0) {
        actions.push(...handleDefense(state, playerId, myCombatUnits, threatsNearBase, baseCenter));
    }

    // 4. Handle offensive operations based on strategy
    if (threatsNearBase.length === 0) {
        if (aiState.strategy === 'attack') {
            actions.push(...handleAttack(state, playerId, aiState, myCombatUnits, enemies, baseCenter, personality));
        } else if (aiState.strategy === 'harass') {
            actions.push(...handleHarass(state, playerId, aiState, myCombatUnits, enemyUnits, enemies, baseCenter));
        } else if (aiState.strategy === 'buildup') {
            // Even during buildup, rally units to staging area
            actions.push(...handleRally(state, myCombatUnits, baseCenter, aiState));
        }
    }

    // 5. Place buildings
    if (player.readyToPlace) {
        actions.push(...handleBuildingPlacement(state, playerId, myBuildings, player));
    }

    return actions;
}

function findBaseCenter(buildings: Entity[]): Vector {
    const conyard = buildings.find(b => b.key === 'conyard');
    if (conyard) return conyard.pos;
    if (buildings.length === 0) return new Vector(300, 300);

    let sumX = 0, sumY = 0;
    for (const b of buildings) {
        sumX += b.pos.x;
        sumY += b.pos.y;
    }
    return new Vector(sumX / buildings.length, sumY / buildings.length);
}

function updateEnemyBaseLocation(aiState: AIPlayerState, enemyBuildings: Entity[]): void {
    if (enemyBuildings.length === 0) return;

    // Find enemy production center (conyard > factory > any building)
    const conyard = enemyBuildings.find(b => b.key === 'conyard');
    if (conyard) {
        aiState.enemyBaseLocation = conyard.pos;
        return;
    }

    const factory = enemyBuildings.find(b => b.key === 'factory');
    if (factory) {
        aiState.enemyBaseLocation = factory.pos;
        return;
    }

    // Fallback to center of enemy buildings
    let sumX = 0, sumY = 0;
    for (const b of enemyBuildings) {
        sumX += b.pos.x;
        sumY += b.pos.y;
    }
    aiState.enemyBaseLocation = new Vector(sumX / enemyBuildings.length, sumY / enemyBuildings.length);
}

function detectThreats(
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
        if (harv.lastAttackerId) {
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

function updateStrategy(
    aiState: AIPlayerState,
    tick: number,
    buildings: Entity[],
    combatUnits: Entity[],
    enemies: Entity[],
    threatsNearBase: EntityId[],
    personality: any
): void {
    const hasFactory = buildings.some(b => b.key === 'factory');
    const hasBarracks = buildings.some(b => b.key === 'barracks');
    const armySize = combatUnits.length;
    const attackThreshold = personality.attack_threshold || ATTACK_GROUP_MIN_SIZE;
    const harassThreshold = personality.harass_threshold || HARASS_GROUP_SIZE;

    // Priority 1: Defend if threats near base (ALWAYS immediate, no cooldown)
    if (threatsNearBase.length > 0) {
        if (aiState.strategy !== 'defend') {
            aiState.strategy = 'defend';
            aiState.lastStrategyChange = tick;
        }
        return;
    }

    // Other strategy changes have cooldown
    if (tick - aiState.lastStrategyChange < STRATEGY_COOLDOWN) return;

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

    // Priority 3: Harass if we have some units but not enough for full attack
    if (armySize >= harassThreshold && (hasFactory || hasBarracks) && enemies.length > 0) {
        if (aiState.strategy !== 'harass') {
            aiState.strategy = 'harass';
            aiState.lastStrategyChange = tick;
            // Form harass group from fastest/lightest units
            const lightUnits = combatUnits.filter(u => u.key === 'rifle' || u.key === 'light');
            aiState.harassGroup = lightUnits.slice(0, HARASS_GROUP_SIZE).map(u => u.id);
        }
        return;
    }

    // Default: Build up
    if (aiState.strategy !== 'buildup') {
        aiState.strategy = 'buildup';
        aiState.lastStrategyChange = tick;
    }
}

function handleEconomy(
    _state: GameState,
    playerId: number,
    buildings: Entity[],
    player: any,
    personality: any
): Action[] {
    const actions: Action[] = [];
    const buildOrder = personality.build_order_priority;

    // Build order fulfillment
    for (const item of buildOrder) {
        const having = buildings.some(b => b.key === item);
        const q = player.queues.building;
        const building = q.current === item;

        if (!having && !building) {
            const data = RULES.buildings[item];
            if (data) {
                const reqsMet = (data.req || []).every((r: string) => buildings.some(b => b.key === r));
                if (reqsMet && player.credits >= data.cost) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'building', key: item, playerId } });
                    break;
                }
            }
        }
    }

    // Unit production
    const prefs = personality.unit_preferences;
    if (player.credits > 800 && prefs) {
        if (buildings.some(b => b.key === 'barracks') && !player.queues.infantry.current) {
            const list = prefs.infantry || ['rifle'];
            // Simple: pick first available or cycle? Let's pick first available req-met
            for (const key of list) {
                const data = RULES.units[key];
                const reqsMet = (data?.req || []).every((r: string) => buildings.some(b => b.key === r));
                if (reqsMet && player.credits >= (data?.cost || 0)) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'infantry', key, playerId } });
                    break;
                }
            }
        }
        if (buildings.some(b => b.key === 'factory') && !player.queues.vehicle.current) {
            const list = prefs.vehicle || ['light'];
            for (const key of list) {
                const data = RULES.units[key];
                const reqsMet = (data?.req || []).every((r: string) => buildings.some(b => b.key === r));
                if (reqsMet && player.credits >= (data?.cost || 0)) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key, playerId } });
                    break;
                }
            }
        }
    } else if (player.credits > 800) {
        // Fallback for safety
        if (buildings.some(b => b.key === 'barracks') && !player.queues.infantry.current) {
            actions.push({ type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId } });
        }
        if (buildings.some(b => b.key === 'factory') && !player.queues.vehicle.current) {
            actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'light', playerId } });
        }
    }

    // MCV production for expansion when wealthy
    const mcvCost = RULES.units.mcv?.cost || 3000;
    const hasFactory = buildings.some(b => b.key === 'factory');
    const alreadyBuildingMcv = player.queues.vehicle.current === 'mcv';
    const existingMcvs = Object.values(_state.entities).filter((e: any) =>
        e.owner === playerId && e.key === 'mcv' && !e.dead
    );

    if (hasFactory && !alreadyBuildingMcv && existingMcvs.length === 0 && player.credits > mcvCost + 2000) {
        // Check if there's distant ore worth expanding towards
        const baseCenter = buildings.find(b => b.key === 'conyard')?.pos || buildings[0]?.pos;
        if (baseCenter) {
            const BUILD_RADIUS = 400;
            let hasDistantOre = false;

            for (const e of Object.values(_state.entities)) {
                const entity = e as Entity;
                if (entity.type !== 'RESOURCE' || entity.dead) continue;

                // Check if ore is beyond current build range
                let inRange = false;
                for (const b of buildings) {
                    const bData = RULES.buildings[b.key];
                    if (bData?.isDefense) continue;
                    if (entity.pos.dist(b.pos) < BUILD_RADIUS + 200) {
                        inRange = true;
                        break;
                    }
                }

                if (!inRange && entity.pos.dist(baseCenter) < 1500) {
                    hasDistantOre = true;
                    break;
                }
            }

            if (hasDistantOre) {
                actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'mcv', playerId } });
            }
        }
    }

    return actions;
}

function handleHarvesterSafety(
    state: GameState,
    _playerId: number,
    harvesters: Entity[],
    combatUnits: Entity[],
    baseCenter: Vector,
    enemies: Entity[],
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];

    // Tracks which enemies are already being targeted by a defender in this tick
    const enemiesTargeted = new Set<EntityId>();

    for (const harv of harvesters) {
        // Check if harvester is under threat
        let nearestThreat: Entity | null = null;
        let nearestDist = Infinity;

        // Prioritize the last attacker
        if (harv.lastAttackerId) {
            const attacker = state.entities[harv.lastAttackerId];
            if (attacker && !attacker.dead) {
                // Verify distance - if they ran away, maybe stop worrying
                if (attacker.pos.dist(harv.pos) < THREAT_DETECTION_RADIUS) {
                    nearestThreat = attacker;
                    nearestDist = attacker.pos.dist(harv.pos);
                }
            }
        }

        // Scan for nearby unit threats if no direct attacker yet
        if (!nearestThreat) {
            for (const enemy of enemies) {
                if (enemy.type !== 'UNIT') continue;
                const dist = enemy.pos.dist(harv.pos);
                if (dist < HARVESTER_FLEE_DISTANCE && dist < nearestDist) {
                    nearestDist = dist;
                    nearestThreat = enemy;
                }
            }
        }

        if (nearestThreat) {
            // Smart Flee: Try to find a safe resource area
            // 1. Identify all friendly refineries
            const refineries = state.entities ? Object.values(state.entities).filter(e => e.owner === harv.owner && e.key === 'refinery' && !e.dead) : [];

            let bestSafeSpot: Vector | null = null;
            let bestSafeScore = -Infinity;

            for (const ref of refineries) {
                // Check safety of this refinery area
                // Distance to nearest threat
                let threatDist = Infinity;
                for (const enemy of enemies) {
                    // Check main enemies list
                    const d = enemy.pos.dist(ref.pos);
                    if (d < threatDist) threatDist = d;
                }

                // Also check if this refinery is close to the CURRENT threat
                const distToCurrentThreat = ref.pos.dist(nearestThreat.pos);
                if (distToCurrentThreat < threatDist) threatDist = distToCurrentThreat;

                // If refinery is under threat, skip it
                if (threatDist < 500) continue;

                // Score this spot
                // Prefer closer spots (travel time) but MUST be safe
                // Score = ThreatDist - TravelDist
                const travelDist = harv.pos.dist(ref.pos);
                const score = threatDist * 2 - travelDist;

                if (score > bestSafeScore) {
                    bestSafeScore = score;
                    // Target a resource near this refinery if possible
                    // Or just the refinery dock area
                    // Find resource near ref
                    const resources = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
                    let closestRes: Entity | null = null;
                    let minResDist = Infinity;
                    for (const res of resources) {
                        const rd = res.pos.dist(ref.pos);
                        if (rd < 300 && rd < minResDist) {
                            minResDist = rd;
                            closestRes = res;
                        }
                    }

                    if (closestRes) {
                        bestSafeSpot = closestRes.pos;
                    } else {
                        bestSafeSpot = ref.pos.add(new Vector(0, 60)); // Dock pos
                    }
                }
            }

            let moveTarget: Vector;

            if (bestSafeSpot) {
                moveTarget = bestSafeSpot;
            } else {
                // Fallback: Run Home / Away
                // 1. Flee toward base
                const runAwayPos = harv.pos.add(harv.pos.sub(nearestThreat.pos).norm().scale(150));
                // Bias towards base to avoid running into map corners forever
                const distToBase = harv.pos.dist(baseCenter);
                moveTarget = runAwayPos;

                if (distToBase > 300) {
                    // Vector to base
                    const toBase = baseCenter.sub(harv.pos).norm();
                    // Vector away from threat
                    const awayThreat = harv.pos.sub(nearestThreat.pos).norm();
                    // Average them
                    const safeDir = toBase.add(awayThreat).norm();
                    moveTarget = harv.pos.add(safeDir.scale(150));
                }
            }

            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: [harv.id],
                    x: moveTarget.x,
                    y: moveTarget.y
                }
            });

            // 2. Dispatch Defenders
            if (!enemiesTargeted.has(nearestThreat.id)) {
                // Find nearest idle combat unit
                // Filter units that are NOT in a critical group or are idle
                // We can pull from the attack group if it's not attacking yet?
                // Simplest: Find nearest combat unit that isn't already doing something critical.
                // Or just grab ANY nearest combat unit.

                let potentialDefenders = combatUnits.filter(u =>
                    !u.targetId && // Not currently attacking
                    u.key !== 'harvester' // Should be filtered by combatUnits arg but double check
                );

                if (potentialDefenders.length === 0) {
                    // Steal from attack group if desperate?
                    if (aiState.attackGroup.length > 0) {
                        potentialDefenders = combatUnits.filter(u => aiState.attackGroup.includes(u.id));
                    }
                }

                let bestDefender: EntityId | null = null;
                let bestDefDist = Infinity;

                for (const defender of potentialDefenders) {
                    const d = defender.pos.dist(nearestThreat.pos);
                    if (d < bestDefDist) {
                        bestDefDist = d;
                        bestDefender = defender.id;
                    }
                }

                if (bestDefender) {
                    // Limit distance? If defender is across the map, maybe not.
                    // But if it's the only one, might as well come.
                    if (bestDefDist < 2000) {
                        actions.push({
                            type: 'COMMAND_ATTACK',
                            payload: {
                                unitIds: [bestDefender],
                                targetId: nearestThreat.id
                            }
                        });
                        enemiesTargeted.add(nearestThreat.id);
                    }
                }
            }
        }
    }

    return actions;
}

function handleDefense(
    state: GameState,
    _playerId: number,
    combatUnits: Entity[],
    threats: EntityId[],
    baseCenter: Vector
): Action[] {
    const actions: Action[] = [];

    if (threats.length === 0) return actions;

    // Get idle units near base or all units if base under heavy attack
    // Get idle units near base or all units if base under heavy attack
    const heavyAttack = threats.length >= 3;
    const defenders = heavyAttack
        ? combatUnits.filter(u => !u.targetId || threats.includes(u.targetId))
        : combatUnits.filter(u => {
            if (u.targetId) return false;
            // Local defense: Is this unit near ANY threat?
            // Or near base center?
            if (u.pos.dist(baseCenter) < BASE_DEFENSE_RADIUS * 1.5) return true;
            // Check proximity to threats
            return threats.some(tid => {
                const t = state.entities[tid];
                return t && !t.dead && u.pos.dist(t.pos) < 1000;
            });
        });

    if (defenders.length === 0) return actions;

    // Find closest threat to base
    let closestThreat: EntityId | null = null;
    let closestDist = Infinity;

    for (const threatId of threats) {
        const threat = state.entities[threatId];
        if (threat && !threat.dead) {
            const dist = threat.pos.dist(baseCenter);
            if (dist < closestDist) {
                closestDist = dist;
                closestThreat = threatId;
            }
        }
    }

    if (closestThreat) {
        actions.push({
            type: 'COMMAND_ATTACK',
            payload: {
                unitIds: defenders.map(u => u.id),
                targetId: closestThreat
            }
        });
    }

    return actions;
}

function handleRally(
    _state: GameState,
    combatUnits: Entity[],
    baseCenter: Vector,
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];

    // Calculate rally point - between base and enemy (if known)
    let rallyPoint: Vector;
    if (aiState.enemyBaseLocation) {
        const toEnemy = aiState.enemyBaseLocation.sub(baseCenter).norm();
        rallyPoint = baseCenter.add(toEnemy.scale(200));
    } else {
        // Default rally just outside base
        rallyPoint = new Vector(baseCenter.x + 150, baseCenter.y);
    }

    // Move idle units to rally point
    const idleUnits = combatUnits.filter(u =>
        !u.targetId &&
        !u.moveTarget &&
        u.pos.dist(rallyPoint) > 100 // Not already near rally
    );

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

    return actions;
}

function handleHarass(
    state: GameState,
    _playerId: number,
    aiState: AIPlayerState,
    combatUnits: Entity[],
    enemyUnits: Entity[],
    enemies: Entity[],
    baseCenter: Vector
): Action[] {
    const actions: Action[] = [];

    // Clean up harass group - remove dead units
    aiState.harassGroup = aiState.harassGroup.filter(id => {
        const unit = state.entities[id];
        return unit && !unit.dead;
    });

    // Refill harass group if needed
    if (aiState.harassGroup.length < HARASS_GROUP_SIZE) {
        const available = combatUnits.filter(u =>
            !aiState.harassGroup.includes(u.id) &&
            (u.key === 'rifle' || u.key === 'light')
        );
        for (const unit of available) {
            if (aiState.harassGroup.length >= HARASS_GROUP_SIZE) break;
            aiState.harassGroup.push(unit.id);
        }
    }

    if (aiState.harassGroup.length < 2) return actions;

    // Find target for harass - prefer harvesters and weak units
    const harassTargets = enemies.filter(e =>
        e.key === 'harvester' ||
        (e.type === 'BUILDING' && (e.key === 'refinery' || e.key === 'power'))
    );

    // Get group center
    const groupCenter = getGroupCenter(aiState.harassGroup, state.entities);
    if (!groupCenter) return actions;

    // Find closest harass target
    let bestTarget: Entity | null = null;
    let bestDist = Infinity;

    for (const target of harassTargets) {
        const dist = target.pos.dist(groupCenter);
        if (dist < bestDist) {
            bestDist = dist;
            bestTarget = target;
        }
    }

    // Fallback to any enemy unit
    if (!bestTarget && enemyUnits.length > 0) {
        for (const enemy of enemyUnits) {
            const dist = enemy.pos.dist(groupCenter);
            if (dist < bestDist) {
                bestDist = dist;
                bestTarget = enemy;
            }
        }
    }

    if (bestTarget) {
        // Check group health - retreat if too damaged
        let totalHp = 0, maxHp = 0;
        for (const id of aiState.harassGroup) {
            const unit = state.entities[id];
            if (unit && !unit.dead) {
                totalHp += unit.hp;
                maxHp += unit.maxHp;
            }
        }

        if (maxHp > 0 && totalHp / maxHp < 0.4) {
            // Retreat - too damaged
            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: aiState.harassGroup,
                    x: baseCenter.x,
                    y: baseCenter.y
                }
            });
        } else {
            // Attack
            const unitsNeedingOrders = aiState.harassGroup.filter(id => {
                const unit = state.entities[id];
                if (!unit || unit.dead) return false;
                if (!unit.targetId) return true;
                const target = state.entities[unit.targetId];
                return !target || target.dead;
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
    }

    return actions;
}

function handleAttack(
    state: GameState,
    _playerId: number,
    aiState: AIPlayerState,
    combatUnits: Entity[],
    enemies: Entity[],
    _baseCenter: Vector,
    _personality: any
): Action[] {
    const actions: Action[] = [];

    if (enemies.length === 0) return actions;

    // Clean up attack group - remove dead units
    aiState.attackGroup = aiState.attackGroup.filter(id => {
        const unit = state.entities[id];
        return unit && !unit.dead;
    });

    // Add ALL available combat units to attack group during attack phase
    for (const unit of combatUnits) {
        if (!aiState.attackGroup.includes(unit.id)) {
            aiState.attackGroup.push(unit.id);
        }
    }

    // Only attack with a group of minimum size
    if (aiState.attackGroup.length < ATTACK_GROUP_MIN_SIZE) return actions;

    // Get group center
    const groupCenter = getGroupCenter(aiState.attackGroup, state.entities);
    if (!groupCenter) return actions;

    // Find best target - prioritize high-value targets
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;

    // Target priority from config
    const targetPriority = AI_CONFIG.strategies?.attack?.target_priority ||
        ['conyard', 'factory', 'barracks', 'refinery', 'power'];

    for (const enemy of enemies) {
        let score = 0;

        // Prioritize buildings based on config
        if (enemy.type === 'BUILDING') {
            const priorityIndex = targetPriority.indexOf(enemy.key);
            if (priorityIndex >= 0) {
                score += 200 - priorityIndex * 30;
            } else {
                score += 50; // Generic building
            }
        }

        // Prioritize low HP targets (easier to kill)
        score += (1 - enemy.hp / enemy.maxHp) * 40;

        // Distance penalty - closer is better for group coherence
        const dist = enemy.pos.dist(groupCenter);
        score -= dist / 30;

        // Bonus for attacking what allies are attacking (focus fire)
        const alliesAttacking = combatUnits.filter(u => u.targetId === enemy.id).length;
        score += alliesAttacking * 15;

        if (score > bestScore) {
            bestScore = score;
            bestTarget = enemy;
        }
    }

    if (bestTarget) {
        // Get units that need new orders
        const unitsNeedingOrders = aiState.attackGroup.filter(id => {
            const unit = state.entities[id];
            if (!unit || unit.dead) return false;
            // Give orders if:
            // 1. No current target
            if (!unit.targetId) return true;
            // 2. Current target is dead
            const currentTarget = state.entities[unit.targetId];
            if (!currentTarget || currentTarget.dead) return true;
            // 3. Current target is not the best target and we want to focus fire
            if (unit.targetId !== bestTarget.id && bestScore > 100) return true;
            return false;
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

        // For units that have NO orders and aren't attacking, send them towards the target
        const idleUnits = aiState.attackGroup.filter(id => {
            const unit = state.entities[id];
            return unit && !unit.dead && !unit.targetId && !unit.moveTarget;
        });

        if (idleUnits.length > 0) {
            // Move toward target position (attack-move behavior)
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: {
                    unitIds: idleUnits,
                    targetId: bestTarget.id
                }
            });
        }
    }

    return actions;
}

function getGroupCenter(unitIds: EntityId[], entities: Record<EntityId, Entity>): Vector | null {
    let sumX = 0, sumY = 0, count = 0;
    for (const id of unitIds) {
        const unit = entities[id];
        if (unit && !unit.dead) {
            sumX += unit.pos.x;
            sumY += unit.pos.y;
            count++;
        }
    }
    if (count === 0) return null;
    return new Vector(sumX / count, sumY / count);
}

function handleBuildingPlacement(
    state: GameState,
    playerId: number,
    buildings: Entity[],
    player: any
): Action[] {
    const actions: Action[] = [];
    const key = player.readyToPlace;
    if (!key) return actions;

    const buildingData = RULES.buildings[key];
    if (!buildingData) {
        actions.push({ type: 'CANCEL_BUILD', payload: { category: 'building', playerId } });
        return actions;
    }

    const conyard = buildings.find(b => b.key === 'conyard') || buildings[0];
    const center = conyard ? conyard.pos : new Vector(300, 300);

    // Find the building that extends furthest from base (for expansion)
    let expansionFront: Vector = center;
    for (const b of buildings) {
        const bData = RULES.buildings[b.key];
        if (bData?.isDefense) continue;
        const dist = b.pos.dist(center);
        if (dist > expansionFront.dist(center)) {
            expansionFront = b.pos;
        }
    }

    // Check if there's distant ore worth expanding towards
    const resources = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
    let distantOreTarget: Vector | null = null;
    const BUILD_RADIUS = 400;

    for (const ore of resources) {
        // Check if ore is beyond current build range but within 1500 units
        let inRange = false;
        for (const b of buildings) {
            const bData = RULES.buildings[b.key];
            if (bData?.isDefense) continue;
            if (ore.pos.dist(b.pos) < BUILD_RADIUS + 200) {
                inRange = true;
                break;
            }
        }

        // Check if any refinery already claims this ore
        const hasNearbyRefinery = Object.values(state.entities).some(e =>
            e.type === 'BUILDING' && e.key === 'refinery' && !e.dead && e.pos.dist(ore.pos) < 200
        );

        if (!inRange && !hasNearbyRefinery && ore.pos.dist(center) < 1500) {
            if (!distantOreTarget || ore.pos.dist(center) < distantOreTarget.dist(center)) {
                distantOreTarget = ore.pos;
            }
        }
    }

    // Candidates for placement
    let bestSpot: { x: number, y: number } | null = null;
    let bestScore = -Infinity;

    // Strategies based on building type
    let searchCenter = center;
    let searchRadiusMin = 100;
    let searchRadiusMax = 300;
    let expandingTowardsOre = false;

    if (key === 'refinery') {
        let bestOre: Entity | null = null;
        let minDist = Infinity;
        const MAX_ORE_DISTANCE = 600;

        for (const ore of resources) {
            const dist = ore.pos.dist(center);
            if (dist > MAX_ORE_DISTANCE) continue;

            const allEntities = Object.values(state.entities);
            const hasRefinery = allEntities.some(b =>
                b.type === 'BUILDING' &&
                b.key === 'refinery' &&
                !b.dead &&
                b.pos.dist(ore.pos) < 200
            );

            let effectiveDist = dist;
            if (hasRefinery) effectiveDist += 5000;

            if (effectiveDist < minDist) {
                minDist = effectiveDist;
                bestOre = ore;
            }
        }

        if (bestOre) {
            searchCenter = bestOre.pos;
            searchRadiusMin = 80;
            searchRadiusMax = 180;
        }
    } else if (key === 'barracks' || key === 'factory') {
        searchRadiusMin = 120;
        searchRadiusMax = 350;
    } else if (key === 'power' && distantOreTarget) {
        // Power plants can be used for "building walk" expansion towards distant ore
        const dirToOre = distantOreTarget.sub(expansionFront).norm();
        searchCenter = expansionFront.add(dirToOre.scale(150));
        searchRadiusMin = 80;
        searchRadiusMax = 250;
        expandingTowardsOre = true;
    }

    // Try multiple spots
    const attempts = 50;
    for (let i = 0; i < attempts; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = searchRadiusMin + Math.random() * (searchRadiusMax - searchRadiusMin);
        const x = searchCenter.x + Math.cos(ang) * dist;
        const y = searchCenter.y + Math.sin(ang) * dist;

        // Check if within BUILD_RADIUS of any existing non-defense building
        // Defense buildings (turrets, pillboxes) should not extend build range
        let nearExistingBuilding = false;
        for (const b of buildings) {
            const bData = RULES.buildings[b.key];
            // Skip defense buildings - they shouldn't extend build range
            if (bData?.isDefense) continue;

            if (new Vector(x, y).dist(b.pos) < BUILD_RADIUS) {
                nearExistingBuilding = true;
                break;
            }
        }
        if (!nearExistingBuilding) continue;

        if (isValidPlacement(x, y, buildingData.w, buildingData.h, state, buildings, key)) {
            let score = 0;

            const distToCenter = new Vector(x, y).dist(searchCenter);
            if (key === 'refinery') {
                score -= distToCenter;
            } else if (expandingTowardsOre && distantOreTarget) {
                // Prefer spots closer to distant ore (expansion)
                score -= new Vector(x, y).dist(distantOreTarget) * 0.8;
                score += new Vector(x, y).dist(center) * 0.2;
            } else {
                score -= new Vector(x, y).dist(center) * 0.5;
            }

            // Margin/Spacing preference
            let nearestBldgDist = Infinity;
            for (const b of buildings) {
                const d = b.pos.dist(new Vector(x, y));
                if (d < nearestBldgDist) nearestBldgDist = d;
            }
            if (nearestBldgDist < 80) score -= (80 - nearestBldgDist) * 2;

            if (score > bestScore) {
                bestScore = score;
                bestSpot = { x, y };
            }
        }
    }

    if (bestSpot) {
        actions.push({
            type: 'PLACE_BUILDING',
            payload: { key: key, x: bestSpot.x, y: bestSpot.y, playerId }
        });
    }

    return actions;
}

function isValidPlacement(
    x: number,
    y: number,
    w: number,
    h: number,
    state: GameState,
    _myBuildings: Entity[],
    buildingKey: string
): boolean {
    const margin = 25;
    const mapMargin = 50;

    if (x < mapMargin || x > state.config.width - mapMargin ||
        y < mapMargin || y > state.config.height - mapMargin) {
        return false;
    }

    const myRect = {
        l: x - w / 2 - margin,
        r: x + w / 2 + margin,
        t: y - h / 2 - margin,
        b: y + h / 2 + margin
    };

    const entities = Object.values(state.entities);
    for (const e of entities) {
        if (e.dead) continue;
        // Check buildings, resources, and rocks
        if (e.type === 'BUILDING' || e.type === 'RESOURCE' || e.type === 'ROCK') {
            const eRect = {
                l: e.pos.x - e.w / 2,
                r: e.pos.x + e.w / 2,
                t: e.pos.y - e.h / 2,
                b: e.pos.y + e.h / 2
            };

            if (rectOverlap(myRect, eRect)) return false;
        }

        if (e.key === 'refinery' && e.type === 'BUILDING') {
            const dockRect = {
                l: e.pos.x - 30,
                r: e.pos.x + 30,
                t: e.pos.y + 40,
                b: e.pos.y + 100
            };
            if (rectOverlap(myRect, dockRect)) return false;
        }
    }

    if (buildingKey === 'refinery') {
        const myDockRect = {
            l: x - 30,
            r: x + 30,
            t: y + 40,
            b: y + 100
        };

        for (const e of entities) {
            if (e.dead) continue;
            if (e.type === 'BUILDING' || e.type === 'RESOURCE') {
                const eRect = {
                    l: e.pos.x - e.w / 2,
                    r: e.pos.x + e.w / 2,
                    t: e.pos.y - e.h / 2,
                    b: e.pos.y + e.h / 2
                };
                if (rectOverlap(myDockRect, eRect)) return false;
            }
        }
    }

    return true;
}

function rectOverlap(r1: { l: number, r: number, t: number, b: number }, r2: { l: number, r: number, t: number, b: number }): boolean {
    return !(r2.l > r1.r || r2.r < r1.l || r2.t > r1.b || r2.b < r1.t);
}

function handleEmergencySell(
    _state: GameState,
    playerId: number,
    buildings: Entity[],
    player: any,
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];
    const REFINERY_COST = RULES.buildings.refinery.cost;

    // 1. Identify Critical Needs
    const hasRefinery = buildings.some(b => b.key === 'refinery');
    const hasConyard = buildings.some(b => b.key === 'conyard');

    // If we have no refinery and exist logic didn't build one (likely due to funds), consider selling
    const needsRefinery = hasConyard && !hasRefinery && player.credits < REFINERY_COST;

    // 2. Define Sell Candidates with Priority
    // Lower index = Higher priority to sell
    const sellPriority = ['turret', 'tech', 'barracks', 'factory', 'power'];

    let shouldSell = false;
    let candidates: Entity[] = [];

    // Condition A: Critical Low Funds (Classic Emergency)
    const criticalLow = player.credits <= 200;
    const underAttack = aiState.threatsNearBase.length > 0 || aiState.harvestersUnderAttack.length > 0;

    if (criticalLow && (underAttack || player.credits <= 50)) {
        shouldSell = true;
        // Sell anything except critical
        const critical = ['conyard', 'refinery'];
        candidates = buildings.filter(b => !critical.includes(b.key));
        // Sort by HP (damage)
        candidates.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    }

    // Condition B: Need Refinery (Strategic Sell)
    if (!shouldSell && needsRefinery) {
        // Only sell if existing funds + potential sell gives us enough?
        // Actually, just sell one by one until we have enough.
        // But don't sell if we have NO chance of affording it (e.g. need 2000, have 0, only have 1 turret worth 400).
        // For now, let's just be aggressive: if we need a refinery, sell non-essential stuff.

        shouldSell = true;

        // Filter candidates based on priority
        // We keep Conyard and at least one Power Plant (unless valid fallback)
        const powerPlants = buildings.filter(b => b.key === 'power');

        candidates = buildings.filter(b => {
            if (b.key === 'conyard') return false;
            if (b.key === 'refinery') return false; // Should be none, but for safety
            if (b.key === 'power' && powerPlants.length <= 1) return false; // Keep last power
            return true;
        });

        // Sort candidates by priority
        candidates.sort((a, b) => {
            const pA = sellPriority.indexOf(a.key);
            const pB = sellPriority.indexOf(b.key);
            // If both not in priority list (unknown), treat as low priority (high index)
            const idxA = pA === -1 ? 99 : pA;
            const idxB = pB === -1 ? 99 : pB;

            if (idxA !== idxB) return idxA - idxB;

            // Tie-break: Sell most expensive (to get money faster)? Or least expensive?
            // Creating a refinery is vital. Sell high value stuff.
            const costA = RULES.buildings[a.key]?.cost || 0;
            const costB = RULES.buildings[b.key]?.cost || 0;
            return costB - costA;
        });
    }

    if (shouldSell && candidates.length > 0) {
        const toSell = candidates[0];
        actions.push({
            type: 'SELL_BUILDING',
            payload: {
                buildingId: toSell.id,
                playerId
            }
        });
    }

    return actions;
}

// Export internal functions for testing
export const _testUtils = {
    findBaseCenter,
    detectThreats,
    updateStrategy,
    handleDefense,
    handleAttack,
    handleHarass,
    handleRally,
    handleHarvesterSafety,
    handleEmergencySell,
    getAIState,
    getGroupCenter,
    updateEnemyBaseLocation,
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE,
    BASE_DEFENSE_RADIUS,
    HARVESTER_FLEE_DISTANCE,
    RALLY_DISTANCE
};

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

    // 1. Always handle economy first
    actions.push(...handleEconomy(state, playerId, myBuildings, player, personality));

    // 2. Handle harvester defense/fleeing
    actions.push(...handleHarvesterSafety(state, playerId, myHarvesters, baseCenter, enemies));

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
    if (player.credits > 800) {
        if (buildings.some(b => b.key === 'barracks') && !player.queues.infantry.current) {
            actions.push({ type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId } });
        }
        if (buildings.some(b => b.key === 'factory') && !player.queues.vehicle.current) {
            // Prioritize tanks for army
            actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'light', playerId } });
        }
    }

    return actions;
}

function handleHarvesterSafety(
    state: GameState,
    _playerId: number,
    harvesters: Entity[],
    baseCenter: Vector,
    enemies: Entity[]
): Action[] {
    const actions: Action[] = [];

    for (const harv of harvesters) {
        // Check if harvester is under threat
        let nearestThreat: Entity | null = null;
        let nearestDist = Infinity;

        for (const enemy of enemies) {
            if (enemy.type !== 'UNIT') continue;
            const dist = enemy.pos.dist(harv.pos);
            if (dist < HARVESTER_FLEE_DISTANCE && dist < nearestDist) {
                nearestDist = dist;
                nearestThreat = enemy;
            }
        }

        // Also check if recently attacked
        if (harv.lastAttackerId && !nearestThreat) {
            const attacker = state.entities[harv.lastAttackerId];
            if (attacker && !attacker.dead) {
                nearestThreat = attacker;
            }
        }

        if (nearestThreat) {
            // Flee toward base
            const fleeDir = harv.pos.sub(nearestThreat.pos).norm();
            const fleeTarget = baseCenter.add(fleeDir.scale(100));

            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: [harv.id],
                    x: fleeTarget.x,
                    y: fleeTarget.y
                }
            });
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
    const heavyAttack = threats.length >= 3;
    const defenders = heavyAttack
        ? combatUnits.filter(u => !u.targetId || threats.includes(u.targetId))
        : combatUnits.filter(u => !u.targetId && u.pos.dist(baseCenter) < BASE_DEFENSE_RADIUS * 1.5);

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

    const conyard = buildings.find(b => b.key === 'conyard') || buildings[0];
    if (!conyard) return actions;

    // Try multiple spots with better placement logic
    for (let i = 0; i < 15; i++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = 100 + Math.random() * 150;
        const x = conyard.pos.x + Math.cos(ang) * dist;
        const y = conyard.pos.y + Math.sin(ang) * dist;

        // Basic bounds check
        if (x > 50 && x < state.config.width - 50 && y > 50 && y < state.config.height - 50) {
            actions.push({
                type: 'PLACE_BUILDING',
                payload: { key: player.readyToPlace, x, y, playerId }
            });
            break;
        }
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
    getAIState,
    getGroupCenter,
    updateEnemyBaseLocation,
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE,
    BASE_DEFENSE_RADIUS,
    HARVESTER_FLEE_DISTANCE,
    RALLY_DISTANCE
};

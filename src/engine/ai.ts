import { GameState, Action, Entity, EntityId, Vector } from './types.js';
import aiConfig from '../data/ai.json';
import rules from '../data/rules.json';

const RULES = rules as any;
const AI_CONFIG = aiConfig as any;

// AI Strategy Types
export type AIStrategy = 'buildup' | 'attack' | 'defend' | 'harass';

// AI State tracking (per player, stored separately since GameState is immutable)
export interface AIPlayerState {
    strategy: AIStrategy;
    lastStrategyChange: number;
    attackGroup: EntityId[];
    defenseGroup: EntityId[];
    threatsNearBase: EntityId[];
    harvestersUnderAttack: EntityId[];
}

// Store AI states (keyed by playerId)
const aiStates: Record<number, AIPlayerState> = {};

function getAIState(playerId: number): AIPlayerState {
    if (!aiStates[playerId]) {
        aiStates[playerId] = {
            strategy: 'buildup',
            lastStrategyChange: 0,
            attackGroup: [],
            defenseGroup: [],
            threatsNearBase: [],
            harvestersUnderAttack: []
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
const HARVESTER_FLEE_DISTANCE = 300;
const THREAT_DETECTION_RADIUS = 400;
const STRATEGY_COOLDOWN = 300; // 5 seconds at 60 ticks/sec

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
    // Combat units could be used for future threat assessment

    // Find base center (conyard or average of buildings)
    const baseCenter = findBaseCenter(myBuildings);

    // Update threat detection
    const { threatsNearBase, harvestersUnderAttack } = detectThreats(
        baseCenter, myHarvesters, enemies, myBuildings
    );
    aiState.threatsNearBase = threatsNearBase;
    aiState.harvestersUnderAttack = harvestersUnderAttack;

    // Strategy decision
    updateStrategy(aiState, state.tick, myBuildings, myCombatUnits, enemies, threatsNearBase);

    // Execute strategy-specific actions
    const personality = AI_CONFIG.personalities['balanced'];

    // 1. Always handle economy first
    actions.push(...handleEconomy(state, playerId, myBuildings, player, personality));

    // 2. Handle harvester defense/fleeing
    actions.push(...handleHarvesterSafety(state, playerId, myHarvesters, baseCenter, enemies));

    // 3. Handle base defense
    if (aiState.strategy === 'defend' || threatsNearBase.length > 0) {
        actions.push(...handleDefense(state, playerId, myCombatUnits, threatsNearBase, baseCenter));
    }

    // 4. Handle attack groups
    if (aiState.strategy === 'attack' && threatsNearBase.length === 0) {
        actions.push(...handleAttack(state, playerId, aiState, myCombatUnits, enemies));
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
    _enemies: Entity[],
    threatsNearBase: EntityId[]
): void {
    const hasFactory = buildings.some(b => b.key === 'factory');
    const armySize = combatUnits.length;

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

    // Priority 2: Attack if we have a good army
    if (armySize >= ATTACK_GROUP_MIN_SIZE && hasFactory) {
        if (aiState.strategy !== 'attack') {
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = tick;
            // Form attack group from available units
            aiState.attackGroup = combatUnits.slice(0, Math.min(10, combatUnits.length)).map(u => u.id);
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

function handleAttack(
    state: GameState,
    _playerId: number,
    aiState: AIPlayerState,
    combatUnits: Entity[],
    enemies: Entity[]
): Action[] {
    const actions: Action[] = [];

    if (enemies.length === 0) return actions;

    // Clean up attack group - remove dead units
    aiState.attackGroup = aiState.attackGroup.filter(id => {
        const unit = state.entities[id];
        return unit && !unit.dead;
    });

    // Add more units to attack group if needed
    const idleUnits = combatUnits.filter(u =>
        !u.targetId &&
        !u.moveTarget &&
        !aiState.attackGroup.includes(u.id)
    );

    for (const unit of idleUnits) {
        if (aiState.attackGroup.length < 10) {
            aiState.attackGroup.push(unit.id);
        }
    }

    // Only attack with a group
    if (aiState.attackGroup.length < ATTACK_GROUP_MIN_SIZE) return actions;

    // Find best target - prioritize high-value targets
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;

    for (const enemy of enemies) {
        let score = 0;

        // Prioritize buildings
        if (enemy.type === 'BUILDING') {
            score += 100;
            // Extra priority for production buildings
            if (enemy.key === 'factory' || enemy.key === 'barracks') {
                score += 50;
            }
            if (enemy.key === 'conyard') {
                score += 200;
            }
        }

        // Prioritize low HP targets
        score += (1 - enemy.hp / enemy.maxHp) * 30;

        // Closer is better (for group coherence)
        const groupCenter = getGroupCenter(aiState.attackGroup, state.entities);
        if (groupCenter) {
            const dist = enemy.pos.dist(groupCenter);
            score -= dist / 50;
        }

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
            // Give orders if idle or target is dead
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
    handleHarvesterSafety,
    getAIState,
    ATTACK_GROUP_MIN_SIZE,
    BASE_DEFENSE_RADIUS,
    HARVESTER_FLEE_DISTANCE
};

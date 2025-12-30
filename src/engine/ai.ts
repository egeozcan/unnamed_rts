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
export type InvestmentPriority = 'economy' | 'warfare' | 'defense' | 'balanced';

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
    lastProductionType: 'infantry' | 'vehicle' | null;
    // Dynamic resource allocation
    investmentPriority: InvestmentPriority;
    economyScore: number;      // 0-100 economic health rating
    threatLevel: number;       // 0-100 military pressure rating
    expansionTarget: Vector | null;  // Distant ore to expand toward
    peaceTicks: number;        // Ticks spent at peace with surplus resources
    // Emergency sell tracking
    lastSellTick: number;      // Last tick when a building was sold
    // Enemy intelligence for counter-building
    enemyIntelligence: {
        lastUpdate: number;
        unitCounts: Record<string, number>;
        buildingCounts: Record<string, number>;
        dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed';
    };
    // Vengeance tracking: damage received from each player (higher = more likely to target)
    vengeanceScores: Record<number, number>;
}

// Store AI states (keyed by playerId)
const aiStates: Record<number, AIPlayerState> = {};

export function getAIState(playerId: number): AIPlayerState {
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
            lastScoutTick: 0,
            lastProductionType: null,
            investmentPriority: 'balanced',
            economyScore: 50,
            threatLevel: 0,
            expansionTarget: null,
            peaceTicks: 0,
            lastSellTick: 0,
            enemyIntelligence: {
                lastUpdate: 0,
                unitCounts: {},
                buildingCounts: {},
                dominantArmor: 'mixed'
            },
            vengeanceScores: {}
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
const HARVESTER_FLEE_DISTANCE = 200;
const THREAT_DETECTION_RADIUS = 400;
const STRATEGY_COOLDOWN = 300; // 5 seconds at 60 ticks/sec
const RALLY_DISTANCE = 150; // Distance from target to rally before attack
const RALLY_TIMEOUT = 300; // 5 seconds to wait for stragglers
const SCOUT_INTERVAL = 600; // 10 seconds between scout attempts

// Peace-break constants - triggers aggressive behavior when wealthy and peaceful
const SURPLUS_CREDIT_THRESHOLD = 4000; // Credits considered "surplus"
const PEACE_BREAK_TICKS = 600; // 10 seconds of peace before considering attack
const SURPLUS_DEFENSE_THRESHOLD = 5000; // Credits to trigger extra defense building
const MAX_SURPLUS_TURRETS = 4; // Maximum turrets to build from surplus

/**
 * Check if prerequisites are met for a building or unit.
 * Prerequisites are defined in RULES.prerequisites, NOT on the item's data object.
 * @param key The building or unit key
 * @param playerBuildings Array of buildings the player owns
 * @returns true if all prerequisites are met
 */
function checkPrerequisites(key: string, playerBuildings: Entity[]): boolean {
    const prereqs = RULES.prerequisites[key] || [];
    return prereqs.every((req: string) => playerBuildings.some(b => b.key === req));
}


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
    const myMCVs = myUnits.filter(u => u.key === 'mcv');
    const myHarvesters = myUnits.filter(u => u.key === 'harvester');
    const myCombatUnits = myUnits.filter(u => u.key !== 'harvester' && u.key !== 'mcv');
    const enemies = Object.values(state.entities).filter(e => e.owner !== playerId && e.owner !== -1 && !e.dead);
    const enemyBuildings = enemies.filter(e => e.type === 'BUILDING');
    const enemyUnits = enemies.filter(e => e.type === 'UNIT');

    // EARLY EXIT: Player is eliminated if they have no buildings AND no MCVs
    // Don't run any AI logic for eliminated players - they can't do anything useful
    if (myBuildings.length === 0 && myMCVs.length === 0) {
        return actions;
    }

    // Find base center (conyard or average of buildings)
    const baseCenter = findBaseCenter(myBuildings);

    // Discover enemy base location (for attack targeting)
    updateEnemyBaseLocation(aiState, enemyBuildings);

    // Update enemy intelligence for counter-building (every 300 ticks = 5 seconds)
    updateEnemyIntelligence(aiState, enemies, state.tick);

    // Update vengeance tracking (bias toward players who attacked us)
    updateVengeance(state, playerId, aiState, myEntities);

    // Update threat detection
    const { threatsNearBase, harvestersUnderAttack } = detectThreats(
        baseCenter, myHarvesters, enemies, myBuildings
    );
    aiState.threatsNearBase = threatsNearBase;
    aiState.harvestersUnderAttack = harvestersUnderAttack;

    // Strategy decision
    const personality = AI_CONFIG.personalities['balanced'];
    updateStrategy(aiState, state.tick, myBuildings, myCombatUnits, enemies, threatsNearBase, personality, player.credits);

    // Dynamic resource allocation - evaluate investment priority
    evaluateInvestmentPriority(state, playerId, aiState, myBuildings, myCombatUnits, enemies, baseCenter);

    // Execute strategy-specific actions

    // 1. Handle economy FIRST so we know what we're building
    actions.push(...handleEconomy(state, playerId, myBuildings, player, personality, aiState, enemies));

    // 2. Handle emergency selling AFTER economy - prevents build-then-sell loops
    actions.push(...handleEmergencySell(state, playerId, myBuildings, player, aiState));

    // 3. Handle building repairs when appropriate
    actions.push(...handleBuildingRepair(state, playerId, myBuildings, player, aiState));

    // 4. Handle harvester defense/fleeing
    actions.push(...handleHarvesterSafety(state, playerId, myHarvesters, myCombatUnits, baseCenter, enemies, aiState));

    // 5. Handle MCV operations (movement, deployment)
    actions.push(...handleMCVOperations(state, playerId, aiState, myBuildings, myUnits));

    // 6. Handle base defense (always check, strategy just goes into full defense mode)
    if (aiState.strategy === 'defend' || threatsNearBase.length > 0) {
        actions.push(...handleDefense(state, playerId, myCombatUnits, threatsNearBase, baseCenter));
    }

    // 7. Handle offensive operations based on strategy
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

    // 8. Place buildings
    if (player.readyToPlace) {
        actions.push(...handleBuildingPlacement(state, playerId, myBuildings, player));
    }

    // 9. Scouting (when idle and enemy location unknown)
    if (aiState.strategy === 'buildup' && !aiState.enemyBaseLocation) {
        actions.push(...handleScouting(state, playerId, myCombatUnits, aiState, baseCenter));
    }

    // 10. Micro-management for combat units
    if (aiState.strategy === 'attack' || aiState.strategy === 'harass') {
        actions.push(...handleMicro(state, myCombatUnits, enemies, baseCenter));
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

// ===== ENEMY INTELLIGENCE =====

function updateEnemyIntelligence(aiState: AIPlayerState, enemies: Entity[], tick: number): void {
    // Only update every 300 ticks (5 seconds)
    if (tick - aiState.enemyIntelligence.lastUpdate < 300) return;

    const unitCounts: Record<string, number> = {};
    const buildingCounts: Record<string, number> = {};
    let infantryCount = 0;
    let lightCount = 0;
    let heavyCount = 0;

    for (const e of enemies) {
        if (e.type === 'UNIT') {
            unitCounts[e.key] = (unitCounts[e.key] || 0) + 1;

            // Categorize by armor type
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

// ===== VENGEANCE TRACKING =====
// Track damage received from each player to bias target selection

const VENGEANCE_DECAY = 0.995; // Decay factor per AI tick (grudges fade slowly)
const VENGEANCE_PER_HIT = 10; // Base vengeance added per attacked entity

function updateVengeance(
    state: GameState,
    playerId: number,
    aiState: AIPlayerState,
    myEntities: Entity[]
): void {
    // Apply decay to existing vengeance scores
    for (const pid in aiState.vengeanceScores) {
        aiState.vengeanceScores[pid] *= VENGEANCE_DECAY;
        // Clean up negligible scores
        if (aiState.vengeanceScores[pid] < 0.1) {
            delete aiState.vengeanceScores[pid];
        }
    }

    // Track damage from attackers
    for (const entity of myEntities) {
        if (entity.lastAttackerId) {
            const attacker = state.entities[entity.lastAttackerId];
            if (attacker && attacker.owner !== playerId && attacker.owner !== -1) {
                const attackerOwner = attacker.owner;
                aiState.vengeanceScores[attackerOwner] =
                    (aiState.vengeanceScores[attackerOwner] || 0) + VENGEANCE_PER_HIT;
            }
        }
    }
}

// ===== DYNAMIC RESOURCE ALLOCATION =====

function evaluateInvestmentPriority(
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

function calculateEconomyScore(
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

function calculateThreatLevel(
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

function findDistantOre(
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

    const BUILD_RADIUS = 400; // Distance within which we can place buildings

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
    personality: any,
    credits: number = 0
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
        // Reset peace counter when under threat
        aiState.peaceTicks = 0;
        return;
    }

    // Track peace time with surplus resources
    if (credits >= SURPLUS_CREDIT_THRESHOLD && aiState.threatLevel === 0) {
        aiState.peaceTicks += 30; // Increment by AI tick interval
    } else {
        aiState.peaceTicks = 0;
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
    state: GameState,
    playerId: number,
    buildings: Entity[],
    player: any,
    personality: any,
    aiState: AIPlayerState,
    _enemies: Entity[]
): Action[] {
    const actions: Action[] = [];
    const buildOrder = personality.build_order_priority;

    // ===== CORE CAPABILITY CHECK =====
    // A conyard (deployed MCV) is required to build new buildings
    // Without a conyard, the player cannot queue any building construction
    const hasConyard = buildings.some(b => b.key === 'conyard');

    // ===== INVESTMENT PRIORITY HANDLING =====

    // Count current harvesters and refineries
    const harvesters = Object.values(state.entities).filter(e =>
        e.owner === playerId && e.type === 'UNIT' && e.key === 'harvester' && !e.dead
    );
    const refineries = buildings.filter(b => b.key === 'refinery' && !b.dead);
    const hasFactory = buildings.some(b => b.key === 'factory');
    const buildingQueueEmpty = !player.queues.building.current;
    const vehicleQueueEmpty = !player.queues.vehicle.current;

    // Detect Panic Mode and Combat Mode
    const isPanic = aiState.threatLevel > 75 || (aiState.threatLevel > 50 && player.credits < 1000);
    const isInCombat = aiState.strategy === 'attack' || aiState.strategy === 'defend';

    // PANIC DEFENSE: Prioritize defensive structures over everything else if in panic
    // NOTE: Can only queue buildings if we have a conyard
    if (hasConyard && isPanic && buildingQueueEmpty) {
        const canBuildTurret = buildings.some(b => b.key === 'barracks'); // Turret/Pillbox req

        // Try to build defensive structures if we have funds
        if (canBuildTurret) {
            const turretData = RULES.buildings['turret'];
            const pillboxData = RULES.buildings['pillbox'];

            // Prefer Pillbox if very low funds, otherwise Turret
            // But actually Turret is generally better vs Tanks which are the main threat

            let defToBuild = 'turret';
            if (player.credits < (turretData?.cost || 800) && player.credits >= (pillboxData?.cost || 400)) {
                defToBuild = 'pillbox';
            }

            const data = RULES.buildings[defToBuild];
            if (data && player.credits >= data.cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: defToBuild, playerId } });
                // Don't return, let unit production happen too
            }
        }
    }

    if (aiState.investmentPriority === 'economy' && !isPanic) {
        // ECONOMY PRIORITY: Build harvesters and expand toward ore

        // 1. Build harvesters if we have too few (need 2 per refinery)
        const idealHarvesters = Math.max(refineries.length * 2, 2);
        const canBuildHarvester = refineries.length > 0; // Need refinery for harvesters
        if (harvesters.length < idealHarvesters && hasFactory && vehicleQueueEmpty && canBuildHarvester) {
            const harvData = RULES.units['harvester'];
            const harvReqsMet = checkPrerequisites('harvester', buildings);
            if (harvData && harvReqsMet && player.credits >= harvData.cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'harvester', playerId } });
                return actions; // Focus on harvesters
            }
        }

        // 2. Build refinery near distant ore if we have an expansion target
        // NOTE: Requires conyard to queue buildings
        if (hasConyard && aiState.expansionTarget && buildingQueueEmpty) {
            const refineryData = RULES.buildings['refinery'];
            const canBuildRefinery = buildings.some(b => b.key === 'factory'); // Refinery req

            // Check if we can reach the expansion target with current build range
            const BUILD_RADIUS = 400;
            const nonDefenseBuildings = buildings.filter(b => {
                const bData = RULES.buildings[b.key];
                return !bData?.isDefense;
            });

            let canReachTarget = false;
            for (const b of nonDefenseBuildings) {
                if (b.pos.dist(aiState.expansionTarget) < BUILD_RADIUS + 100) {
                    canReachTarget = true;
                    break;
                }
            }

            // Count existing power plants to limit building walk
            const existingPowerPlants = buildings.filter(b => b.key === 'power').length;
            const MAX_POWER_FOR_EXPANSION = 4; // Limit building walk to 4 power plants

            if (canReachTarget && canBuildRefinery && refineryData && player.credits >= refineryData.cost) {
                // Build refinery near the ore
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'refinery', playerId } });
                return actions;
            } else if (!canReachTarget && buildingQueueEmpty && existingPowerPlants < MAX_POWER_FOR_EXPANSION) {
                // BUILDING WALK: Build power plant toward the ore (limited number)
                const powerData = RULES.buildings['power'];
                if (powerData && player.credits >= powerData.cost) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId } });
                    return actions;
                }
            }
        }

        // 3. Build refinery near accessible unclaimed ore (when expansionTarget is null)
        // This happens when findDistantOre returns null because there's ore within build range
        // that doesn't have a refinery nearby
        // NOTE: Requires conyard to queue buildings
        if (hasConyard && !aiState.expansionTarget && buildingQueueEmpty) {
            const refineryData = RULES.buildings['refinery'];
            const canBuildRefinery = buildings.some(b => b.key === 'factory');
            const BUILD_RADIUS = 400;

            // Check for accessible ore without a refinery
            const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
            const nonDefenseBuildings = buildings.filter(b => {
                const bData = RULES.buildings[b.key];
                return !bData?.isDefense;
            });

            let hasUnclaimedAccessibleOre = false;
            for (const ore of allOre) {
                // Check if ore is within build range
                let isAccessible = false;
                for (const b of nonDefenseBuildings) {
                    if (b.pos.dist(ore.pos) < BUILD_RADIUS + 150) {
                        isAccessible = true;
                        break;
                    }
                }
                if (!isAccessible) continue;

                // Check if ore already has a refinery nearby
                const hasNearbyRefinery = refineries.some(r => r.pos.dist(ore.pos) < 300);
                if (!hasNearbyRefinery) {
                    hasUnclaimedAccessibleOre = true;
                    break;
                }
            }

            if (hasUnclaimedAccessibleOre && canBuildRefinery && refineryData && player.credits >= refineryData.cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'refinery', playerId } });
                return actions;
            }
        }
    } else if (aiState.investmentPriority === 'defense') {
        // DEFENSE PRIORITY: Build turrets
        // NOTE: Requires conyard to queue buildings
        if (hasConyard && buildingQueueEmpty) {
            const turretData = RULES.buildings['turret'];
            const canBuildTurret = buildings.some(b => b.key === 'barracks'); // Turret req
            if (canBuildTurret && turretData && player.credits >= turretData.cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'turret', playerId } });
                // Don't return - continue with unit production for defense
            }
        }
    }

    // ===== PEACETIME ECONOMY EXPANSION =====
    // When not under pressure (low threat), opportunistically build harvesters and refineries
    // This applies to balanced and warfare priorities to strengthen economy during peaceful periods
    const isPeacetime = aiState.threatLevel <= 20 &&
        (aiState.investmentPriority === 'balanced' || aiState.investmentPriority === 'warfare');

    if (isPeacetime) {
        // 1. Build harvesters if below ideal (2 per refinery)
        const idealHarvesters = Math.max(refineries.length * 2, 2);
        const canBuildHarvester = refineries.length > 0;

        if (harvesters.length < idealHarvesters && hasFactory && vehicleQueueEmpty && canBuildHarvester) {
            const harvData = RULES.units['harvester'];
            const harvReqsMet = checkPrerequisites('harvester', buildings);
            // Use a higher credit threshold for peacetime - only spend surplus
            const peacetimeCreditThreshold = 800;
            if (harvData && harvReqsMet && player.credits >= harvData.cost + peacetimeCreditThreshold) {
                actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'harvester', playerId } });
                return actions; // Prioritize harvester production in peacetime
            }
        }

        // 2. Build additional refinery if we have accessible ore without refinery coverage
        // NOTE: Requires conyard to queue buildings
        if (hasConyard && buildingQueueEmpty) {
            const refineryData = RULES.buildings['refinery'];
            const canBuildRefinery = buildings.some(b => b.key === 'factory');
            const BUILD_RADIUS = 400;

            // Find ore patches within build range that don't have a nearby refinery
            const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
            const nonDefenseBuildings = buildings.filter(b => {
                const bData = RULES.buildings[b.key];
                return !bData?.isDefense;
            });

            let hasUnclaimedAccessibleOre = false;
            for (const ore of allOre) {
                // Check if ore is within build range
                let isAccessible = false;
                for (const b of nonDefenseBuildings) {
                    if (b.pos.dist(ore.pos) < BUILD_RADIUS + 150) {
                        isAccessible = true;
                        break;
                    }
                }
                if (!isAccessible) continue;

                // Check if ore already has a refinery nearby
                const hasNearbyRefinery = refineries.some(r => r.pos.dist(ore.pos) < 300);
                if (!hasNearbyRefinery) {
                    hasUnclaimedAccessibleOre = true;
                    break;
                }
            }

            // Build refinery if we have money and unclaimed accessible ore
            // Use higher threshold in peacetime
            const peacetimeRefineryThreshold = 1000;
            if (hasUnclaimedAccessibleOre && canBuildRefinery && refineryData &&
                player.credits >= refineryData.cost + peacetimeRefineryThreshold) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'refinery', playerId } });
                return actions; // Prioritize refinery expansion
            }
        }
    }

    // ===== SURPLUS DEFENSE BUILDING =====
    // When wealthy with no immediate threat, fortify the base with defensive buildings
    // NOTE: Requires conyard to queue buildings
    if (hasConyard && player.credits >= SURPLUS_DEFENSE_THRESHOLD && aiState.threatLevel === 0 && buildingQueueEmpty) {
        const existingTurrets = buildings.filter(b => {
            const bData = RULES.buildings[b.key];
            return bData?.isDefense && !b.dead;
        }).length;

        // Build more defenses if we have surplus and not too many already
        if (existingTurrets < MAX_SURPLUS_TURRETS) {
            const hasBarracks = buildings.some(b => b.key === 'barracks');
            const turretData = RULES.buildings['turret'];

            if (hasBarracks && turretData && player.credits >= turretData.cost) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'turret', playerId } });
                // Don't return - allow unit production to continue
            }
        }
    }

    // ===== SURPLUS PRODUCTION BUILDINGS =====
    // When very wealthy, build extra production buildings to speed up unit production
    // NOTE: Requires conyard to queue buildings
    const SURPLUS_PRODUCTION_THRESHOLD = 6000; // Higher threshold for production buildings
    const MAX_SURPLUS_BARRACKS = 3;
    const MAX_SURPLUS_FACTORIES = 3;

    if (hasConyard && player.credits >= SURPLUS_PRODUCTION_THRESHOLD && aiState.threatLevel <= 20 && buildingQueueEmpty) {
        const existingBarracks = buildings.filter(b => b.key === 'barracks' && !b.dead).length;
        const existingFactories = buildings.filter(b => b.key === 'factory' && !b.dead).length;

        // Prefer factories over barracks (vehicles are stronger)
        if (existingFactories < MAX_SURPLUS_FACTORIES) {
            const factoryData = RULES.buildings['factory'];
            const factoryReqsMet = checkPrerequisites('factory', buildings);
            if (factoryData && factoryReqsMet && player.credits >= factoryData.cost + 2000) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'factory', playerId } });
            }
        } else if (existingBarracks < MAX_SURPLUS_BARRACKS) {
            const barracksData = RULES.buildings['barracks'];
            const barracksReqsMet = checkPrerequisites('barracks', buildings);
            if (barracksData && barracksReqsMet && player.credits >= barracksData.cost + 2000) {
                actions.push({ type: 'START_BUILD', payload: { category: 'building', key: 'barracks', playerId } });
            }
        }
    }

    // ===== STANDARD BUILD ORDER =====
    // NOTE: Can only queue buildings if we have a conyard

    // Build order fulfillment - only if we have a conyard
    if (!hasConyard) {
        // No conyard = cannot build buildings, skip to unit production
    } else for (const item of buildOrder) {
        // Skip economic buildings during active combat (Issue #12)
        if (isInCombat && ['power', 'refinery'].includes(item) && player.credits < 3000) {
            continue;
        }

        const having = buildings.some(b => b.key === item);
        const q = player.queues.building;
        const building = q.current === item;

        if (!having && !building) {
            const data = RULES.buildings[item];
            if (data) {
                const reqsMet = checkPrerequisites(item, buildings);
                if (reqsMet && player.credits >= data.cost) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'building', key: item, playerId } });
                    break;
                }
            }
        }
    }

    // Unit production - STAGGERED for smoother resource usage
    const prefs = personality.unit_preferences;

    // Strategy-based credit thresholds
    let creditThreshold = aiState.strategy === 'attack' ? 500 :
        aiState.strategy === 'defend' ? 600 : 800;

    // Reserve buffer - never drop below this
    let creditBuffer = aiState.strategy === 'attack' ? 300 : 500;

    // Override for Panic Mode
    if (isPanic) {
        creditThreshold = 0; // Spend everything
        creditBuffer = 0;    // No reserves
    }

    const hasBarracks = buildings.some(b => b.key === 'barracks');
    const infantryQueueEmpty = !player.queues.infantry.current;

    // ===== COUNTER-BUILDING LOGIC =====
    // Adjust unit preferences based on enemy armor composition
    // Each counter list is ordered by effectiveness - AI will build first available
    let counterInfantry = prefs?.infantry || ['rifle'];
    let counterVehicle = prefs?.vehicle || ['light'];

    const dominantArmor = aiState.enemyIntelligence.dominantArmor;
    if (dominantArmor === 'infantry') {
        // Enemy has lots of infantry - use fire and snipers (1.75x and 4x damage)
        counterInfantry = ['flamer', 'sniper', 'grenadier', 'rifle'];
        counterVehicle = ['flame_tank', 'apc', 'light'];  // Flame tank + fast units to chase
    } else if (dominantArmor === 'heavy') {
        // Enemy has heavy armor - missiles and rockets are needed (1.5x and 1.0x)
        counterInfantry = ['rocket'];  // Rocket soldiers are key vs heavy
        counterVehicle = ['mlrs', 'artillery', 'mammoth', 'heavy'];  // Artillery/missiles outrange
    } else if (dominantArmor === 'light') {
        // Enemy has light vehicles - cannons and AP bullets work well
        counterInfantry = ['commando', 'rifle', 'rocket'];  // AP bullets (1.25x vs light)
        counterVehicle = ['light', 'heavy', 'stealth'];  // Cannons effective
    } else {
        // Mixed army - build a balanced force
        counterInfantry = ['rifle', 'rocket', 'flamer'];
        counterVehicle = ['heavy', 'light', 'flame_tank'];
    }

    if (player.credits > creditThreshold) {
        // STAGGERED PRODUCTION: Alternate between infantry and vehicles
        // This prevents resource spikes and creates more varied attacks

        // Decide what to build this tick
        let buildInfantry = false;
        let buildVehicle = false;

        if (isPanic) {
            // PANIC: Build EVERYTHING possible
            if (hasBarracks && infantryQueueEmpty) buildInfantry = true;
            if (hasFactory && vehicleQueueEmpty) buildVehicle = true;
        } else {
            // NORMAL: Staggered
            if (hasBarracks && infantryQueueEmpty && hasFactory && vehicleQueueEmpty) {
                // Both available - alternate based on last production
                if (aiState.lastProductionType === 'infantry') {
                    buildVehicle = true;
                } else if (aiState.lastProductionType === 'vehicle') {
                    buildInfantry = true;
                } else {
                    buildVehicle = true; // Default to vehicle
                }
            } else if (hasBarracks && infantryQueueEmpty) {
                buildInfantry = true;
            } else if (hasFactory && vehicleQueueEmpty) {
                buildVehicle = true;
            }
        }

        // Execute infantry production with counter-building
        if (buildInfantry) {
            const list = isPanic
                ? ['rocket', 'rifle'] // Panic: Rocket/Rifle
                : counterInfantry;

            for (const key of list) {
                const data = RULES.units[key];
                const reqsMet = checkPrerequisites(key, buildings);
                const cost = data?.cost || 0;
                // Check against buffer
                if (reqsMet && player.credits >= cost && (player.credits - cost) >= creditBuffer) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'infantry', key, playerId } });
                    aiState.lastProductionType = 'infantry';
                    player.credits -= cost; // Deduct temporarily for next check in this loop
                    break;
                }
            }
        }

        // Execute vehicle production with counter-building
        let vehicleBuilt = false;
        if (buildVehicle) {
            const list = isPanic
                ? ['light', 'jeep']
                : counterVehicle;

            for (const key of list) {
                const data = RULES.units[key];
                const reqsMet = checkPrerequisites(key, buildings);
                const cost = data?.cost || 0;
                // Check against buffer
                if (reqsMet && player.credits >= cost && (player.credits - cost) >= creditBuffer) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'vehicle', key, playerId } });
                    aiState.lastProductionType = 'vehicle';
                    vehicleBuilt = true;
                    break;
                }
            }
        }

        // FALLBACK: If vehicle production was desired but failed (can't afford any vehicles),
        // try infantry production instead. This prevents AI stalling when low on credits.
        if (buildVehicle && !vehicleBuilt && hasBarracks && infantryQueueEmpty) {
            const list = counterInfantry;
            for (const key of list) {
                const data = RULES.units[key];
                const reqsMet = checkPrerequisites(key, buildings);
                const cost = data?.cost || 0;
                if (reqsMet && player.credits >= cost && (player.credits - cost) >= creditBuffer) {
                    actions.push({ type: 'START_BUILD', payload: { category: 'infantry', key, playerId } });
                    aiState.lastProductionType = 'infantry';
                    break;
                }
            }
        }
    }

    // MCV production for expansion when wealthy
    const mcvCost = RULES.units.mcv?.cost || 3000;
    // hasFactory already defined above in unit production section
    const alreadyBuildingMcv = player.queues.vehicle.current === 'mcv';
    const existingMcvs = Object.values(state.entities).filter((e: any) =>
        e.owner === playerId && e.key === 'mcv' && !e.dead
    );

    if (hasFactory && !alreadyBuildingMcv && existingMcvs.length === 0 && player.credits > mcvCost + 2000) {
        // Check if there's distant ore worth expanding towards
        const baseCenter = buildings.find(b => b.key === 'conyard')?.pos || buildings[0]?.pos;
        if (baseCenter) {
            const BUILD_RADIUS = 400;
            let hasDistantOre = false;

            for (const e of Object.values(state.entities)) {
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

// ===== MCV OPERATIONS (Issue #7) =====

function handleMCVOperations(
    state: GameState,
    playerId: number,
    _aiState: AIPlayerState,
    myBuildings: Entity[],
    myUnits: Entity[]
): Action[] {
    const actions: Action[] = [];

    // Find MCVs owned by this player
    const mcvs = myUnits.filter(u => u.key === 'mcv' && !u.dead);
    if (mcvs.length === 0) return actions;

    const BUILD_RADIUS = 400;
    const baseCenter = findBaseCenter(myBuildings);

    // Find expansion location - distant ore that needs a new base
    const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
    let bestExpansionTarget: Vector | null = null;
    let bestScore = -Infinity;

    for (const ore of allOre) {
        // Check if ore is covered by existing buildings
        let inBuildRange = false;
        for (const b of myBuildings) {
            const bData = RULES.buildings[b.key];
            if (bData?.isDefense) continue;
            if (ore.pos.dist(b.pos) < BUILD_RADIUS + 200) {
                inBuildRange = true;
                break;
            }
        }
        if (inBuildRange) continue; // Already covered

        // Check if ore has nearby enemy presence (dangerous)
        let nearbyEnemyThreats = 0;
        for (const e of Object.values(state.entities)) {
            if (e.owner !== playerId && e.owner !== -1 && !e.dead) {
                if (e.pos.dist(ore.pos) < 500) nearbyEnemyThreats++;
            }
        }
        if (nearbyEnemyThreats > 2) continue; // Too dangerous

        // Score: prefer closer ore, penalize dangerous areas
        const distFromBase = ore.pos.dist(baseCenter);
        if (distFromBase > 600 && distFromBase < 1500) {
            const score = 1000 - distFromBase - nearbyEnemyThreats * 100;
            if (score > bestScore) {
                bestScore = score;
                bestExpansionTarget = ore.pos;
            }
        }
    }

    for (const mcv of mcvs) {
        // If MCV has no destination, assign expansion target
        if (!mcv.moveTarget && !mcv.finalDest && bestExpansionTarget) {
            // Move to expansion target (offset from ore so we don't block it)
            const targetPos = bestExpansionTarget.add(new Vector(100, 0));
            actions.push({
                type: 'COMMAND_MOVE',
                payload: { unitIds: [mcv.id], x: targetPos.x, y: targetPos.y }
            });
        }

        // If MCV is near its destination (within 100 units), deploy it
        // Note: This requires a DEPLOY_MCV action in reducer. If not implemented,
        // we can simulate by having MCV build a conyard
        if (mcv.finalDest && mcv.pos.dist(mcv.finalDest) < 100) {
            // Check if there's enough space to deploy
            const deployPos = mcv.pos;
            let canDeploy = true;

            // Check for nearby buildings that would block
            for (const b of Object.values(state.entities)) {
                if (b.dead) continue;
                if (b.type === 'BUILDING' || b.type === 'ROCK') {
                    if (b.pos.dist(deployPos) < 100) {
                        canDeploy = false;
                        break;
                    }
                }
            }

            if (canDeploy) {
                // Issue deploy command (if reducer supports it)
                // For now, we'll use a placeholder - this needs DEPLOY_MCV action
                // actions.push({ type: 'DEPLOY_MCV', payload: { unitId: mcv.id, playerId } });

                // Alternative: Just stop the MCV so it doesn't wander
                // The user may need to implement DEPLOY_MCV in reducer
            }
        }
    }

    return actions;
}

// Helper function to find nearest available defender
function findNearestDefender(
    combatUnits: Entity[],
    threat: Entity,
    aiState: AIPlayerState
): EntityId | null {
    let potentialDefenders = combatUnits.filter(u =>
        !u.targetId && // Not currently attacking
        u.key !== 'harvester' // Should be filtered by combatUnits arg but double check
    );

    if (potentialDefenders.length === 0) {
        // Steal from attack group if desperate
        if (aiState.attackGroup.length > 0) {
            const attackGroupUnits = combatUnits.filter(u => aiState.attackGroup.includes(u.id));
            potentialDefenders = attackGroupUnits;
        }
    }

    let bestDefender: EntityId | null = null;
    let bestDefDist = Infinity;

    for (const defender of potentialDefenders) {
        const d = defender.pos.dist(threat.pos);
        if (d < bestDefDist && d < 2000) { // Limit distance
            bestDefDist = d;
            bestDefender = defender.id;
        }
    }

    return bestDefender;
}

function handleHarvesterSafety(
    state: GameState,
    playerId: number,
    harvesters: Entity[],
    combatUnits: Entity[],
    baseCenter: Vector,
    enemies: Entity[],
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];

    // Tracks which enemies are already being targeted by a defender in this tick
    const enemiesTargeted = new Set<EntityId>();

    // Track which safe spots have already been assigned to harvesters this tick
    const assignedSafeSpots: Vector[] = [];

    // ===== IMPROVED ECONOMIC PRESSURE LOGIC (Issue #6) =====
    // Only ignore threats if:
    // 1. Credits are critically low (<100)
    // 2. AND the harvester has significant cargo to deliver
    const player = state.players[playerId];
    const MINIMUM_SAFE_DISTANCE = 80; // Always flee from threats this close

    for (const harv of harvesters) {
        // Check economic pressure per-harvester based on cargo
        const hasSignificantCargo = harv.cargo > 200;
        const isCriticallyBroke = player && player.credits < 100;
        const isUnderEconomicPressure = isCriticallyBroke && hasSignificantCargo;

        // Reduced flee distance when not directly attacked - be less jumpy
        const PASSIVE_FLEE_DISTANCE = 150;

        // Check if harvester is under threat
        let nearestThreat: Entity | null = null;
        let nearestDist = Infinity;
        let isDirectAttack = false; // Was this harvester directly attacked?

        // Prioritize the last attacker - this is a DIRECT attack, always flee
        if (harv.lastAttackerId) {
            const attacker = state.entities[harv.lastAttackerId];
            if (attacker && !attacker.dead) {
                // Verify distance - if they ran away, maybe stop worrying
                if (attacker.pos.dist(harv.pos) < THREAT_DETECTION_RADIUS) {
                    nearestThreat = attacker;
                    nearestDist = attacker.pos.dist(harv.pos);
                    isDirectAttack = true;
                }
            }
        }

        // Scan for nearby unit threats if no direct attacker yet
        // Use reduced distance for passive detection when under economic pressure
        if (!nearestThreat) {
            const fleeDistance = isUnderEconomicPressure ? PASSIVE_FLEE_DISTANCE : HARVESTER_FLEE_DISTANCE;

            for (const enemy of enemies) {
                if (enemy.type !== 'UNIT') continue;
                const dist = enemy.pos.dist(harv.pos);
                if (dist < fleeDistance && dist < nearestDist) {
                    nearestDist = dist;
                    nearestThreat = enemy;
                }
            }
        }

        // Also check if our destination (refinery) is compromised
        if (!nearestThreat && harv.baseTargetId && !isUnderEconomicPressure) {
            const refinery = state.entities[harv.baseTargetId];
            if (refinery && !refinery.dead) {
                for (const enemy of enemies) {
                    if (enemy.type !== 'UNIT') continue;
                    const dist = enemy.pos.dist(refinery.pos);
                    if (dist < THREAT_DETECTION_RADIUS) {
                        nearestThreat = enemy;
                        nearestDist = dist;
                        break;
                    }
                }
            }
        }

        if (nearestThreat) {
            // ===== MINIMUM SAFE DISTANCE (Issue #6) =====
            // Even under economic pressure, flee from VERY close threats
            if (nearestDist < MINIMUM_SAFE_DISTANCE) {
                isDirectAttack = true; // Treat as direct attack - force flee
            }

            // Under economic pressure AND not directly attacked: skip flee, keep harvesting
            if (isUnderEconomicPressure && !isDirectAttack) {
                // Don't flee - the economy needs resources desperately
                // Still dispatch defenders though
                if (!enemiesTargeted.has(nearestThreat.id)) {
                    const defender = findNearestDefender(combatUnits, nearestThreat, aiState);
                    if (defender) {
                        actions.push({
                            type: 'COMMAND_ATTACK',
                            payload: {
                                unitIds: [defender],
                                targetId: nearestThreat.id
                            }
                        });
                        enemiesTargeted.add(nearestThreat.id);
                    }
                }
                continue; // Skip flee, continue to next harvester
            }

            // Smart Flee: Try to find a safe resource area
            // 1. Identify all friendly refineries
            const refineries = state.entities ? Object.values(state.entities).filter(e => e.owner === harv.owner && e.key === 'refinery' && !e.dead) : [];

            // Collect all safe spots with scores
            const safeSpots: { spot: Vector, score: number, refinery: Entity }[] = [];

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

                // Find resource near ref
                const resources = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
                for (const res of resources) {
                    const rd = res.pos.dist(ref.pos);
                    if (rd < 300) {
                        // Calculate score
                        // Prefer closer spots (travel time) but MUST be safe
                        // Also penalize spots that are already assigned to other harvesters
                        const travelDist = harv.pos.dist(res.pos);
                        let score = threatDist * 2 - travelDist;

                        // Penalty for spots already assigned (encourages spreading)
                        const alreadyAssignedCount = assignedSafeSpots.filter(s =>
                            s.dist(res.pos) < 50
                        ).length;
                        score -= alreadyAssignedCount * 200; // Heavy penalty for crowding

                        safeSpots.push({ spot: res.pos, score, refinery: ref });
                    }
                }

                // Also add refinery dock as fallback
                const dockPos = ref.pos.add(new Vector(0, 60));
                const travelDist = harv.pos.dist(dockPos);
                let score = threatDist * 2 - travelDist - 50; // Slight penalty vs ore
                const alreadyAssignedCount = assignedSafeSpots.filter(s =>
                    s.dist(dockPos) < 50
                ).length;
                score -= alreadyAssignedCount * 200;
                safeSpots.push({ spot: dockPos, score, refinery: ref });
            }

            let moveTarget: Vector;

            // Sort by score and pick the best
            safeSpots.sort((a, b) => b.score - a.score);

            if (safeSpots.length > 0) {
                moveTarget = safeSpots[0].spot;
                assignedSafeSpots.push(moveTarget); // Track assignment
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
    // BUT exclude units that are part of an active offensive group
    const activeUnitIds = new Set<EntityId>();
    aiState.offensiveGroups.forEach(g => g.unitIds.forEach(id => activeUnitIds.add(id)));
    aiState.attackGroup.forEach(id => activeUnitIds.add(id));
    aiState.harassGroup.forEach(id => activeUnitIds.add(id));

    const idleUnits = combatUnits.filter(u =>
        !activeUnitIds.has(u.id) && // Not in an active group
        !u.targetId && // Not currently attacking
        !u.moveTarget && // Not currently moving
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
    baseCenter: Vector,
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

    // --- Group Cohesion Logic ---
    // Manage offensive group (create if doesn't exist or was cleared)
    let mainGroup = aiState.offensiveGroups.find(g => g.id === 'main_attack');

    // Update group members immediately to include any new recruits
    if (mainGroup) {
        mainGroup.unitIds = [...aiState.attackGroup];
    }

    // If we switched strategy and came back, need a fresh group
    if (mainGroup && mainGroup.status === 'attacking') {
        // Check if we should reset for a new attack wave
        // Reset if group is too small (lost units) or all units are at/near target
        const aliveUnits = mainGroup.unitIds.filter(id => {
            const u = state.entities[id];
            return u && !u.dead;
        });
        if (aliveUnits.length < ATTACK_GROUP_MIN_SIZE) {
            // Reset the group for a new wave
            aiState.offensiveGroups = aiState.offensiveGroups.filter(g => g.id !== 'main_attack');
            mainGroup = undefined;
        }
    }

    if (!mainGroup) {
        mainGroup = {
            id: 'main_attack',
            unitIds: [...aiState.attackGroup],
            target: null,
            rallyPoint: null,
            status: 'forming',
            lastOrderTick: state.tick
        };
        aiState.offensiveGroups.push(mainGroup);
    }

    // Calculate rally point if not set
    if (!mainGroup.rallyPoint && aiState.enemyBaseLocation) {
        const toEnemy = aiState.enemyBaseLocation.sub(baseCenter).norm();
        const dist = baseCenter.dist(aiState.enemyBaseLocation);
        // Rally at 50% of distance, at least 400 units from base
        const rallyDist = Math.max(Math.min(dist * 0.5, 1000), 400);
        mainGroup.rallyPoint = baseCenter.add(toEnemy.scale(rallyDist));
    } else if (!mainGroup.rallyPoint) {
        mainGroup.rallyPoint = baseCenter.add(new Vector(300, 0));
    }

    // Check group cohesion: how spread out are units?
    let maxSpread = 0;
    let atRallyCount = 0;
    for (const id of mainGroup.unitIds) {
        const unit = state.entities[id];
        if (unit && !unit.dead) {
            const d = unit.pos.dist(groupCenter);
            if (d > maxSpread) maxSpread = d;
            // Count units near rally point
            if (mainGroup.rallyPoint && unit.pos.dist(mainGroup.rallyPoint) < 200) {
                atRallyCount++;
            }
        }
    }

    const aliveCount = mainGroup.unitIds.filter(id => {
        const u = state.entities[id];
        return u && !u.dead;
    }).length;

    // Cohesive if most units are near rally point
    const isCohesive = atRallyCount >= aliveCount * 0.7; // 70% at rally
    const timedOut = (state.tick - mainGroup.lastOrderTick) > RALLY_TIMEOUT;

    // State machine
    if (mainGroup.status === 'forming') {
        mainGroup.status = 'rallying';
        mainGroup.lastOrderTick = state.tick; // Start rally timer NOW
    }

    if (mainGroup.status === 'rallying') {
        if (isCohesive || timedOut) {
            mainGroup.status = 'attacking';
        } else {
            // Move ALL units to rally point (not just idle ones)
            const unitsToRally = mainGroup.unitIds.filter(id => {
                const unit = state.entities[id];
                if (!unit || unit.dead) return false;
                // Force rally unless already there
                if (mainGroup.rallyPoint && unit.pos.dist(mainGroup.rallyPoint) < 100) return false;
                return true;
            });

            if (unitsToRally.length > 0 && mainGroup.rallyPoint) {
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: unitsToRally,
                        x: mainGroup.rallyPoint.x,
                        y: mainGroup.rallyPoint.y
                    }
                });
            }
            return actions; // Don't attack yet - wait for group
        }
    }

    // --- During attack: Check if group needs to regroup ---
    if (mainGroup.status === 'attacking') {
        // Check if multi-front attack is active (large army with 2+ targets)
        // If so, skip regroup logic - units are intentionally spread between targets
        const MULTI_FRONT_THRESHOLD = 10;
        const aliveUnitsForRegroup = aiState.attackGroup.filter(id => {
            const u = state.entities[id];
            return u && !u.dead;
        });
        const isMultiFront = aliveUnitsForRegroup.length >= MULTI_FRONT_THRESHOLD && enemies.length > 1;

        // Only apply regroup logic for single-front attacks
        if (!isMultiFront) {
            // Calculate current spread from group center
            let maxSpreadFromCenter = 0;
            for (const id of mainGroup.unitIds) {
                const unit = state.entities[id];
                if (unit && !unit.dead) {
                    const d = unit.pos.dist(groupCenter);
                    if (d > maxSpreadFromCenter) maxSpreadFromCenter = d;
                }
            }

            // If group is too spread out (units > 500 apart), force a regroup
            const MAX_ATTACK_SPREAD = 500;
            if (maxSpreadFromCenter > MAX_ATTACK_SPREAD) {
                // Units have scattered - move them toward group center instead of attacking
                const unitsToRegroup = mainGroup.unitIds.filter(id => {
                    const unit = state.entities[id];
                    if (!unit || unit.dead) return false;
                    // Only regroup units that are far from center
                    if (unit.pos.dist(groupCenter) > 200) return true;
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
                    return actions; // Don't issue attack commands - regrouping
                }
            }
        }
    }

    // Find best target - prioritize threats and high-value targets
    let bestTarget: Entity | null = null;
    let bestScore = -Infinity;

    // Target priority from config
    const targetPriority = AI_CONFIG.strategies?.attack?.target_priority ||
        ['conyard', 'factory', 'barracks', 'refinery', 'power'];

    // First, identify which enemies are actively threatening us
    const activeThreats = new Set<EntityId>();
    for (const id of aiState.attackGroup) {
        const unit = state.entities[id];
        if (unit && !unit.dead && unit.lastAttackerId) {
            activeThreats.add(unit.lastAttackerId);
        }
    }

    // Also consider nearby enemy units/defenses as threats
    for (const enemy of enemies) {
        if (enemy.targetId && aiState.attackGroup.includes(enemy.targetId)) {
            activeThreats.add(enemy.id);
        }
    }

    for (const enemy of enemies) {
        let score = 0;

        // ===== LEASH DISTANCE (Issue #4) =====
        // Heavily penalize targets that are too far from group center
        // This prevents units from chasing enemies across the map
        const MAX_CHASE_DISTANCE = 400;
        const distFromGroup = enemy.pos.dist(groupCenter);
        if (distFromGroup > MAX_CHASE_DISTANCE * 2) {
            score -= 500; // Massive penalty for very far targets
        } else if (distFromGroup > MAX_CHASE_DISTANCE) {
            score -= (distFromGroup - MAX_CHASE_DISTANCE) * 0.5;
        }

        // --- THREAT SCORING (highest priority) ---
        const isThreat = activeThreats.has(enemy.id);
        if (isThreat) {
            // This enemy is actively attacking our units - big priority boost
            score += 150;

            // If threat is LOW HP, we can quickly eliminate it - even higher priority
            const hpRatio = enemy.hp / enemy.maxHp;
            if (hpRatio < 0.3) {
                score += 100; // Quick kill opportunity
            } else if (hpRatio < 0.6) {
                score += 50;
            }
        }

        // Defensive buildings that are threats get extra priority
        if (enemy.type === 'BUILDING' && ['turret', 'pillbox', 'obelisk', 'sam'].includes(enemy.key)) {
            if (isThreat) {
                score += 100; // Active defensive building = top priority
            } else {
                // Even non-attacking defenses near our units are dangerous
                if (distFromGroup < 300) {
                    score += 75; // Nearby turret - clear it
                }
            }
        }

        // --- STRATEGIC VALUE SCORING ---
        if (enemy.type === 'BUILDING') {
            const priorityIndex = targetPriority.indexOf(enemy.key);
            if (priorityIndex >= 0) {
                score += 80 - priorityIndex * 15;
            } else {
                score += 30; // Generic building
            }
        }

        // Enemy units that can attack
        if (enemy.type === 'UNIT' && enemy.key !== 'harvester') {
            score += 40; // Combat units are moderate priority
        }

        // ===== IMPROVED FOCUS FIRE (Issue #5) =====
        // Prioritize low HP targets more aggressively to secure kills
        const hpRatio = enemy.hp / enemy.maxHp;
        if (hpRatio < 0.2) {
            score += 100; // Very low HP - secure the kill!
        } else if (hpRatio < 0.5) {
            score += 75; // Half health - good target
        } else {
            score += (1 - hpRatio) * 50;
        }

        // Distance penalty - closer is better for group coherence
        const dist = enemy.pos.dist(groupCenter);
        score -= dist / 25;

        // ===== STRONGER FOCUS FIRE BONUS (Issue #5) =====
        // Much stronger bonus for attacking what allies are attacking
        const alliesAttacking = combatUnits.filter(u => u.targetId === enemy.id).length;
        if (alliesAttacking >= 3) {
            score += 100 + alliesAttacking * 30; // Strong focus fire bonus
        } else {
            score += alliesAttacking * 25;
        }

        // ===== VENGEANCE SCORING =====
        // Prioritize targets from players who have attacked us
        const vengeanceBonus = aiState.vengeanceScores[enemy.owner] || 0;
        score += vengeanceBonus * 0.5; // Scale vengeance influence

        if (score > bestScore) {
            bestScore = score;
            bestTarget = enemy;
        }
    }

    if (bestTarget) {
        // === MULTI-FRONT ATTACK ===
        // If army is large enough (10+ units), split into two attack groups
        const MULTI_FRONT_THRESHOLD = 10;
        const aliveUnits = aiState.attackGroup.filter(id => {
            const u = state.entities[id];
            return u && !u.dead;
        });

        if (aliveUnits.length >= MULTI_FRONT_THRESHOLD && enemies.length > 1) {
            // Find second best target (different from first)
            let secondBestScore = -Infinity;
            let secondBestTarget: Entity | null = null;

            for (const enemy of enemies) {
                if (enemy.id === bestTarget.id) continue; // Skip primary target

                let score = 0;
                // Score buildings higher for secondary target (different objective)
                if (enemy.type === 'BUILDING') {
                    score += 60;
                    const priorityIndex = targetPriority.indexOf(enemy.key);
                    if (priorityIndex >= 0) {
                        score += 50 - priorityIndex * 10;
                    }
                }
                // Prefer targets somewhat distant from primary (true multi-front)
                const distFromPrimary = enemy.pos.dist(bestTarget.pos);
                if (distFromPrimary > 300) {
                    score += 40; // Bonus for spread attacks
                }
                // Low HP bonus still applies
                score += (1 - enemy.hp / enemy.maxHp) * 30;

                if (score > secondBestScore) {
                    secondBestScore = score;
                    secondBestTarget = enemy;
                }
            }

            // Split the army: ~60% main, ~40% flank
            const splitIndex = Math.floor(aliveUnits.length * 0.6);
            const mainGroupUnits = aliveUnits.slice(0, splitIndex);
            const flankGroupUnits = aliveUnits.slice(splitIndex);

            // Main group attacks primary target
            const mainUnitsNeedingOrders = mainGroupUnits.filter(id => {
                const unit = state.entities[id];
                if (!unit || unit.dead) return false;
                if (!unit.targetId) return true;
                const currentTarget = state.entities[unit.targetId];
                if (!currentTarget || currentTarget.dead) return true;
                if (unit.targetId !== bestTarget.id) return true;
                return false;
            });

            if (mainUnitsNeedingOrders.length > 0) {
                actions.push({
                    type: 'COMMAND_ATTACK',
                    payload: {
                        unitIds: mainUnitsNeedingOrders,
                        targetId: bestTarget.id
                    }
                });
            }

            // Flank group attacks secondary target (or primary if no secondary)
            if (secondBestTarget && flankGroupUnits.length > 0) {
                const flankUnitsNeedingOrders = flankGroupUnits.filter(id => {
                    const unit = state.entities[id];
                    if (!unit || unit.dead) return false;
                    if (!unit.targetId) return true;
                    const currentTarget = state.entities[unit.targetId];
                    if (!currentTarget || currentTarget.dead) return true;
                    if (unit.targetId !== secondBestTarget!.id) return true;
                    return false;
                });

                if (flankUnitsNeedingOrders.length > 0) {
                    actions.push({
                        type: 'COMMAND_ATTACK',
                        payload: {
                            unitIds: flankUnitsNeedingOrders,
                            targetId: secondBestTarget.id
                        }
                    });
                }
            }
        } else {
            // Standard single-front attack for smaller armies
            const unitsNeedingOrders = aiState.attackGroup.filter(id => {
                const unit = state.entities[id];
                if (!unit || unit.dead) return false;
                if (!unit.targetId) return true;
                const currentTarget = state.entities[unit.targetId];
                if (!currentTarget || currentTarget.dead) return true;
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
                actions.push({
                    type: 'COMMAND_ATTACK',
                    payload: {
                        unitIds: idleUnits,
                        targetId: bestTarget.id
                    }
                });
            }
        }
    }

    return actions;
}

function handleScouting(
    state: GameState,
    _playerId: number,
    combatUnits: Entity[],
    aiState: AIPlayerState,
    baseCenter: Vector
): Action[] {
    const actions: Action[] = [];

    // Only scout periodically
    if (state.tick - aiState.lastScoutTick < SCOUT_INTERVAL) return actions;

    // Find a fast, idle unit to scout
    const availableScouts = combatUnits.filter(u =>
        !u.targetId && !u.moveTarget &&
        (u.key === 'light' || u.key === 'rifle')
    );

    if (availableScouts.length === 0) return actions;

    const scout = availableScouts[0];
    aiState.lastScoutTick = state.tick;

    // Pick a corner to scout (cycle through quadrants)
    const quadrant = Math.floor(state.tick / SCOUT_INTERVAL) % 4;
    const MAP_SIZE = 3000;
    const corners = [
        new Vector(MAP_SIZE - 200, 200),           // Top-right
        new Vector(MAP_SIZE - 200, MAP_SIZE - 200), // Bottom-right
        new Vector(200, MAP_SIZE - 200),           // Bottom-left
        new Vector(200, 200)                        // Top-left
    ];

    // Pick the corner furthest from base
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

function handleMicro(
    _state: GameState,
    combatUnits: Entity[],
    enemies: Entity[],
    baseCenter: Vector
): Action[] {
    const actions: Action[] = [];
    const RETREAT_THRESHOLD = 0.25; // 25% HP
    const KITE_RANGE_MINIMUM = 200; // Only kite if our range >= this
    const KITE_DISTANCE_RATIO = 0.6; // Kite when enemy within 60% of our range

    for (const unit of combatUnits) {
        const unitData = RULES.units?.[unit.key] || {};
        const unitRange = unitData.range || 100;

        // Skip if no enemies nearby
        const nearbyEnemies = enemies.filter(e =>
            e.type === 'UNIT' && e.pos.dist(unit.pos) < unitRange * 1.5
        );
        if (nearbyEnemies.length === 0) continue;

        const hpRatio = unit.hp / unit.maxHp;
        const closestEnemy = nearbyEnemies.reduce((closest, e) => {
            const d = e.pos.dist(unit.pos);
            return d < e.pos.dist(closest.pos) ? e : closest;
        }, nearbyEnemies[0]);
        const distToClosest = closestEnemy.pos.dist(unit.pos);

        // --- LOW HP RETREAT (Priority 1) ---
        if (hpRatio < RETREAT_THRESHOLD) {
            // Find retreat direction (toward base, away from enemies)
            const toBase = baseCenter.sub(unit.pos).norm();

            // Find average enemy direction
            let enemyDir = new Vector(0, 0);
            for (const enemy of nearbyEnemies) {
                enemyDir = enemyDir.add(enemy.pos.sub(unit.pos));
            }
            const awayFromEnemy = enemyDir.scale(-1).norm();

            // Blend: 70% toward base, 30% away from enemies
            const retreatDir = toBase.scale(0.7).add(awayFromEnemy.scale(0.3)).norm();
            const retreatPos = unit.pos.add(retreatDir.scale(200));

            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: [unit.id],
                    x: retreatPos.x,
                    y: retreatPos.y
                }
            });
            continue; // Don't also kite - retreat takes priority
        }

        // --- RANGED KITING (Priority 2) ---
        // Only apply to ranged units (range >= 200)
        if (unitRange >= KITE_RANGE_MINIMUM) {
            // Get closest enemy's range
            const enemyData = RULES.units?.[closestEnemy.key] || {};
            const enemyRange = enemyData.range || 100;

            // Kite if:
            // 1. Enemy has significantly shorter range (we can outrange them)
            // 2. Enemy is getting too close (within kite threshold)
            const hasRangeAdvantage = unitRange > enemyRange + 50;
            const kiteThreshold = unitRange * KITE_DISTANCE_RATIO;
            const enemyTooClose = distToClosest < kiteThreshold;

            if (hasRangeAdvantage && enemyTooClose) {
                // Calculate kite direction: away from enemy but at optimal range
                const awayFromEnemy = unit.pos.sub(closestEnemy.pos).norm();

                // Move to optimal range (80% of our range - safe buffer)
                const optimalRange = unitRange * 0.8;
                const currentDir = unit.pos.sub(closestEnemy.pos);
                const currentDist = currentDir.mag();

                // Only kite if we'd actually improve our position
                if (currentDist < optimalRange - 30) {
                    const kitePos = closestEnemy.pos.add(awayFromEnemy.scale(optimalRange));

                    actions.push({
                        type: 'COMMAND_MOVE',
                        payload: {
                            unitIds: [unit.id],
                            x: kitePos.x,
                            y: kitePos.y
                        }
                    });
                }
            }
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

    // EARLY CHECK: Cancel build if player has no non-defense buildings
    // Defense buildings (turrets, pillboxes) don't extend build radius
    // If player only has defense buildings (or no buildings), they can't place anything
    const nonDefenseBuildings = buildings.filter(b => {
        const bData = RULES.buildings[b.key];
        return !bData?.isDefense;
    });

    if (nonDefenseBuildings.length === 0) {
        // Cancel the build - no valid placement is possible
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
        const MAX_ORE_DISTANCE = 550; // Max distance from ore to nearby building

        // Get non-defense buildings for distance calculation
        const nonDefenseBuildings = buildings.filter(b => {
            const bData = RULES.buildings[b.key];
            return !bData?.isDefense;
        });

        for (const ore of resources) {
            // Find distance to NEAREST building (not base center)
            // This supports building walk - ore near expansion front is valid
            let minDistToBuilding = Infinity;
            for (const b of nonDefenseBuildings) {
                const d = ore.pos.dist(b.pos);
                if (d < minDistToBuilding) minDistToBuilding = d;
            }

            // Skip ore too far from any building (can't reach)
            if (minDistToBuilding > MAX_ORE_DISTANCE) continue;

            const allEntities = Object.values(state.entities);
            const hasRefinery = allEntities.some(b =>
                b.type === 'BUILDING' &&
                b.key === 'refinery' &&
                !b.dead &&
                b.pos.dist(ore.pos) < 200
            );

            let effectiveDist = minDistToBuilding;
            if (hasRefinery) effectiveDist += 5000; // Strongly avoid already-claimed ore

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
        // BUT only if we don't already have too many power plants
        const existingPowerPlants = buildings.filter(b => b.key === 'power').length;
        const MAX_POWER_FOR_EXPANSION = 5;

        if (existingPowerPlants < MAX_POWER_FOR_EXPANSION) {
            const dirToOre = distantOreTarget.sub(expansionFront).norm();
            searchCenter = expansionFront.add(dirToOre.scale(150));
            searchRadiusMin = 80;
            searchRadiusMax = 250;
            expandingTowardsOre = true;
        }
        // If we already have enough power plants, use default placement
    } else if (buildingData.isDefense) {
        // === STRATEGIC DEFENSIVE BUILDING PLACEMENT ===
        const aiState = getAIState(playerId);
        const refineries = buildings.filter(b => b.key === 'refinery');
        const existingDefenses = buildings.filter(b => {
            const bd = RULES.buildings[b.key];
            return bd?.isDefense;
        });

        // Strategy 1: Place between base and enemy (if known)
        if (aiState.enemyBaseLocation) {
            const dirToEnemy = aiState.enemyBaseLocation.sub(center).norm();
            // Place at 200-400 from base center toward enemy
            searchCenter = center.add(dirToEnemy.scale(250));
            searchRadiusMin = 100;
            searchRadiusMax = 200;
        }

        // Strategy 2: If we have refineries, prioritize protecting them
        if (refineries.length > 0) {
            // Find refinery with least nearby defenses
            let leastDefendedRefinery: Entity | null = null;
            let minDefenses = Infinity;

            for (const ref of refineries) {
                const nearbyDefenses = existingDefenses.filter(d =>
                    d.pos.dist(ref.pos) < 300
                ).length;

                if (nearbyDefenses < minDefenses) {
                    minDefenses = nearbyDefenses;
                    leastDefendedRefinery = ref;
                }
            }

            if (leastDefendedRefinery && minDefenses < 2) {
                // Place defense near this refinery
                searchCenter = leastDefendedRefinery.pos;
                searchRadiusMin = 80;
                searchRadiusMax = 200;
            }
        }

        // Strategy 3: Ensure spacing - avoid clustering defenses
        // (handled in scoring below)
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
            } else if (buildingData.isDefense) {
                // ===== IMPROVED DEFENSE PLACEMENT (Issue #8) =====
                const aiState = getAIState(playerId);
                const spotPos = new Vector(x, y);

                // Get existing defenses for spacing check
                const existingDefenses = buildings.filter(b => {
                    const bd = RULES.buildings[b.key];
                    return bd?.isDefense;
                });

                // ===== STRICT SPACING: Minimum 200 units apart =====
                let tooClose = false;
                for (const def of existingDefenses) {
                    const distToDefense = def.pos.dist(spotPos);
                    if (distToDefense < 200) {
                        score -= (200 - distToDefense) * 5; // Heavy penalty
                        if (distToDefense < 100) {
                            tooClose = true; // Reject completely
                        }
                    }
                }
                if (tooClose) continue; // Skip this spot entirely

                // ===== COVERAGE ANGLE: Prefer covering new directions =====
                if (existingDefenses.length > 0) {
                    // Calculate angle from base center to this spot
                    const spotAngle = Math.atan2(spotPos.y - center.y, spotPos.x - center.x);

                    // Find closest existing defense angle
                    let minAngleDiff = Infinity;
                    for (const def of existingDefenses) {
                        const defAngle = Math.atan2(def.pos.y - center.y, def.pos.x - center.x);
                        let angleDiff = Math.abs(spotAngle - defAngle);
                        if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                        if (angleDiff < minAngleDiff) minAngleDiff = angleDiff;
                    }

                    // Bonus for covering a new angle (>45 degrees from other defenses)
                    if (minAngleDiff > Math.PI / 4) {
                        score += minAngleDiff * 30;
                    }
                }

                // Enemy base direction bonus
                if (aiState.enemyBaseLocation) {
                    const toEnemy = aiState.enemyBaseLocation.sub(center).norm();
                    const spotDir = spotPos.sub(center).norm();
                    const alignment = toEnemy.dot(spotDir);
                    score += alignment * 50;
                }

                // Bonus for being near refineries (protecting economy)
                const refineries = buildings.filter(b => b.key === 'refinery');
                for (const ref of refineries) {
                    const distToRef = ref.pos.dist(spotPos);
                    if (distToRef < 300 && distToRef > 100) {
                        score += 80; // Good distance to protect refinery
                    } else if (distToRef < 100) {
                        score -= 30; // Too close - blocks refinery operations
                    }
                }

                // Moderate distance from base center (150-300 is ideal)
                const distFromCenter = spotPos.dist(center);
                if (distFromCenter > 150 && distFromCenter < 300) {
                    score += 30;
                } else {
                    score -= Math.abs(distFromCenter - 225) * 0.2;
                }
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
    myBuildings: Entity[],
    buildingKey: string
): boolean {
    const margin = 25;
    const mapMargin = 50;
    const BUILD_RADIUS = 400;

    if (x < mapMargin || x > state.config.width - mapMargin ||
        y < mapMargin || y > state.config.height - mapMargin) {
        return false;
    }

    // === BUILD RANGE CHECK ===
    // Must be within BUILD_RADIUS of an existing non-defense building
    if (myBuildings.length > 0) {
        let withinRange = false;
        for (const b of myBuildings) {
            const bData = RULES.buildings[b.key];
            if (bData?.isDefense) continue; // Defense buildings don't extend range
            const dist = Math.sqrt((x - b.pos.x) ** 2 + (y - b.pos.y) ** 2);
            if (dist < BUILD_RADIUS) {
                withinRange = true;
                break;
            }
        }
        if (!withinRange) return false;
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

/**
 * AI Building Repair Logic
 * Strategically repairs damaged buildings based on priority and current game state
 */
function handleBuildingRepair(
    _state: GameState,
    playerId: number,
    buildings: Entity[],
    player: any,
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];

    // Don't repair if we're in a critical emergency (low funds, under attack)
    if (player.credits < 500 && aiState.threatsNearBase.length > 0) {
        return actions;
    }

    // Define repair thresholds and priorities
    // Lower threshold = repair when more damaged
    const repairPriorities: { [key: string]: { threshold: number; priority: number } } = {
        'conyard': { threshold: 0.7, priority: 1 },      // Critical - repair at 70% HP
        'refinery': { threshold: 0.6, priority: 2 },     // Very important - repair at 60% HP
        'factory': { threshold: 0.5, priority: 3 },      // Important - repair at 50% HP
        'barracks': { threshold: 0.5, priority: 4 },     // Important - repair at 50% HP
        'power': { threshold: 0.4, priority: 5 },        // Medium - repair at 40% HP
        'turret': { threshold: 0.4, priority: 6 },       // Defenses during lulls
        'pillbox': { threshold: 0.4, priority: 7 },
        'sam_site': { threshold: 0.4, priority: 8 },
    };

    // Find buildings that need repair
    const damagedBuildings: { entity: Entity; priority: number; threshold: number }[] = [];

    for (const building of buildings) {
        if (building.dead) continue;

        const hpRatio = building.hp / building.maxHp;
        const repairConfig = repairPriorities[building.key] || { threshold: 0.3, priority: 10 };

        // Check if building needs repair and isn't already being repaired
        if (hpRatio < repairConfig.threshold && !building.isRepairing) {

            // Skip non-essential refineries (far from ore)
            if (building.key === 'refinery' && !isRefineryUseful(building, _state)) {
                continue;
            }

            damagedBuildings.push({
                entity: building,
                priority: repairConfig.priority,
                threshold: repairConfig.threshold
            });
        }
    }

    if (damagedBuildings.length === 0) {
        return actions;
    }

    // Sort by priority (lower = more important)
    damagedBuildings.sort((a, b) => a.priority - b.priority);

    // Count how many buildings are already being repaired
    const currentlyRepairing = buildings.filter(b => b.isRepairing).length;
    const maxConcurrentRepairs = player.credits > 2000 ? 2 : 1;

    // Repair logic based on current game state
    const underAttack = aiState.threatsNearBase.length > 0;
    const wealthyEnough = player.credits > 1000;
    const veryWealthy = player.credits > 2000;

    // Start repairs on priority buildings
    for (const damaged of damagedBuildings) {
        if (currentlyRepairing >= maxConcurrentRepairs) break;

        const isProduction = ['conyard', 'refinery', 'factory', 'barracks'].includes(damaged.entity.key);
        const isDefense = ['turret', 'pillbox', 'sam_site'].includes(damaged.entity.key);
        const isPower = damaged.entity.key === 'power';

        // Decide whether to repair based on conditions
        let shouldRepair = false;

        // Always repair production buildings if we can afford it
        if (isProduction && wealthyEnough) {
            shouldRepair = true;
        }

        // Repair defenses only when not under attack (lull in combat)
        if (isDefense && !underAttack && wealthyEnough) {
            shouldRepair = true;
        }

        // Repair power plants when low (prevents power shortage)
        if (isPower && damaged.entity.hp / damaged.entity.maxHp < 0.3 && wealthyEnough) {
            shouldRepair = true;
        }

        // Repair any building if we're very wealthy
        if (veryWealthy && damaged.entity.hp / damaged.entity.maxHp < 0.2) {
            shouldRepair = true;
        }

        if (shouldRepair) {
            actions.push({
                type: 'START_REPAIR',
                payload: {
                    buildingId: damaged.entity.id,
                    playerId
                }
            });
        }
    }

    return actions;
}

function handleEmergencySell(
    _state: GameState,
    playerId: number,
    buildings: Entity[],
    player: any,
    aiState: AIPlayerState
): Action[] {
    const actions: Action[] = [];

    // ===== SELL COOLDOWN (Issue #2) =====
    // Prevent selling multiple buildings in rapid succession
    const SELL_COOLDOWN = 120; // 2 seconds
    if (_state.tick - aiState.lastSellTick < SELL_COOLDOWN) {
        return actions;
    }

    // ===== BUILDING AGE GRACE PERIOD (Issue #1) =====
    // Filter out buildings that were just placed (prevent build-then-sell loops)
    const BUILDING_GRACE_PERIOD = 300; // 5 seconds
    const matureBuildings = buildings.filter(b => {
        const age = _state.tick - (b.placedTick || 0);
        return age >= BUILDING_GRACE_PERIOD;
    });

    const REFINERY_COST = RULES.buildings.refinery.cost;

    // 1. Identify Critical Needs
    const hasRefinery = buildings.some(b => b.key === 'refinery');
    const hasConyard = buildings.some(b => b.key === 'conyard');
    const hasFactory = buildings.some(b => b.key === 'factory');
    const hasBarracks = buildings.some(b => b.key === 'barracks');

    // Check for "Stalemate / Fire Sale" condition
    const harvesters = Object.values(_state.entities).filter(e =>
        e.owner === playerId && e.key === 'harvester' && !e.dead
    );
    const hasIncome = harvesters.length > 0 && hasRefinery;
    const isBroke = player.credits < 200;
    const isStalemate = !hasIncome && isBroke;

    const needsRefinery = hasConyard && !hasRefinery && player.credits < REFINERY_COST;

    // 2. Define Sell Candidates with Priority
    const sellPriority = ['turret', 'pillbox', 'sam_site', 'tech', 'power', 'conyard', 'barracks', 'factory'];

    let shouldSell = false;
    let candidates: Entity[] = [];

    // ===== PROACTIVE USELESS REFINERY SELLING (Issue #3 Enhancement) =====
    // Sell refineries that are far from any ore, even if not damaged
    // This prevents wasted resources on useless buildings
    if (!shouldSell) {
        const uselessRefineries = matureBuildings.filter(b =>
            b.key === 'refinery' && !isRefineryUseful(b, _state)
        );

        // Only sell if we have more than one refinery OR the refinery is really useless
        const allRefineries = buildings.filter(b => b.key === 'refinery');
        if (uselessRefineries.length > 0 && allRefineries.length > 1) {
            shouldSell = true;
            candidates = uselessRefineries;
        }
    }

    // Condition C: Stalemate / "Fire Sale" (Aggressive Sell)
    if (!shouldSell && isStalemate) {
        if (hasFactory || hasBarracks) {
            shouldSell = true;
            candidates = matureBuildings.filter(b => {
                if (b.key === 'factory' && buildings.filter(f => f.key === 'factory').length === 1) return false;
                if (b.key === 'barracks' && !hasFactory && buildings.filter(br => br.key === 'barracks').length === 1) return false;
                return true;
            });

            candidates.sort((a, b) => {
                const idxA = getPriorityIndex(a.key, sellPriority);
                const idxB = getPriorityIndex(b.key, sellPriority);
                if (idxA !== idxB) return idxA - idxB;
                return 0;
            });
        }
    }

    // Condition D: Sell Useless Refineries Under Attack (damaged + useless)
    if (!shouldSell) {
        const uselessDamagedRefinery = matureBuildings.find(b =>
            b.key === 'refinery' &&
            b.hp < b.maxHp &&
            !isRefineryUseful(b, _state)
        );

        if (uselessDamagedRefinery) {
            shouldSell = true;
            candidates = [uselessDamagedRefinery];
        }
    }

    // Condition A: Critical Low Funds (Classic Emergency)
    const criticalLow = player.credits <= 200;
    const underAttack = aiState.threatsNearBase.length > 0 || aiState.harvestersUnderAttack.length > 0;

    if (!shouldSell && criticalLow && (underAttack || player.credits <= 50)) {
        shouldSell = true;
        const critical = ['conyard', 'refinery', 'factory', 'barracks'];
        candidates = matureBuildings.filter(b => !critical.includes(b.key));
        candidates.sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp));
    }

    // Condition B: Need Refinery (Strategic Sell)
    if (!shouldSell && needsRefinery) {
        shouldSell = true;
        const powerPlants = buildings.filter(b => b.key === 'power');

        candidates = matureBuildings.filter(b => {
            if (b.key === 'conyard') return false;
            if (b.key === 'refinery') return false;
            if (b.key === 'power' && powerPlants.length <= 1) return false;
            return true;
        });

        candidates.sort((a, b) => {
            const idxA = getPriorityIndex(a.key, sellPriority);
            const idxB = getPriorityIndex(b.key, sellPriority);
            if (idxA !== idxB) return idxA - idxB;
            const costA = RULES.buildings[a.key]?.cost || 0;
            const costB = RULES.buildings[b.key]?.cost || 0;
            return costB - costA;
        });
    }

    if (shouldSell && candidates.length > 0) {
        const toSell = candidates[0];
        aiState.lastSellTick = _state.tick; // Update cooldown tracker
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

function isRefineryUseful(refinery: Entity, state: GameState): boolean {
    // A refinery is useful if it has ore within reasonable distance
    const USEFUL_ORE_DISTANCE = 600;
    const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);

    for (const ore of allOre) {
        if (refinery.pos.dist(ore.pos) < USEFUL_ORE_DISTANCE) {
            return true;
        }
    }
    return false;
}

function getPriorityIndex(key: string, priorityList: string[]): number {
    const idx = priorityList.indexOf(key);
    return idx === -1 ? 99 : idx;
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
    handleMCVOperations,
    updateEnemyIntelligence,
    updateVengeance,
    getAIState,
    getGroupCenter,
    updateEnemyBaseLocation,
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE,
    BASE_DEFENSE_RADIUS,
    HARVESTER_FLEE_DISTANCE,
    RALLY_DISTANCE,
    VENGEANCE_DECAY,
    VENGEANCE_PER_HIT
};

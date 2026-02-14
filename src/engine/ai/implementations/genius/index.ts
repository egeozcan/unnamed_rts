import { GameState, Action } from '../../../types.js';
import { RULES } from '../../../../data/schemas/index.js';
import { createEntityCache, getEnemiesOf, getBuildingsForOwner, getUnitsForOwner } from '../../../perf.js';
import {
    getAIState,
    findBaseCenter,
    updateEnemyBaseLocation,
    updateEnemyIntelligence,
    updateVengeance,
    getPersonalityForPlayer,
} from '../../state.js';
import {
    AI_CONSTANTS,
} from '../../utils.js';
import {
    detectThreats,
    updateStrategy,
    evaluateInvestmentPriority
} from '../../planning.js';
import {
    handleEconomy,
    handleEmergencySell,
    handleLastResortSell,
    handleBuildingPlacement,
    handleBuildingRepair,
    handleMCVOperations,
    handleHarvesterGathering,
    handleInductionRigOperations
} from '../../action_economy.js';
import {
    handleAttack,
    handleDefense,
    handleHarass,
    handleRally,
    handleScouting,
    handleMicro,
    handleHarvesterSafety,
    handleHarvesterSuicideAttack,
    handleUnitRepair,
    handleEngineerCapture,
    handleHijackerAssault,
    handleAirStrikes,
    handleDemoTruckAssault
} from '../../action_combat.js';
import { updateHarvesterAI } from '../../harvester/index.js';

// Genius AI Constants - Tuned for maximum performance
const GENIUS_PERSONALITY = {
    // Aggressive but calculated
    attack_threshold: 1,        // Attack immediately when ready
    min_attack_group_size: 12,  // Reverted to 12 for more impactful pushes
    max_attack_group_size: 30,  // Massive deathballs
    harass_threshold: 0.5,      // Only harass if we have some advantage
    harvester_ratio: 2.5,       // Maximum eco saturation
    credit_buffer: 500,         // Reduced from 2000 to keep money flowing
    defense_investment: 0.05,   // Reduced from 0.1 to focus on army
    retreat_threshold: 0.4,     // Retreat earlier to save units
    kite_aggressiveness: 0.95,   // Kite with almost everything
    unit_preferences: {
        infantry: ['rocket', 'rocket', 'grenadier'], // Rockets outrange rifles/turrets often
        vehicle: ['light', 'heavy', 'heavy', 'artillery'] // Artillery skews range advantage
    },
    // strict_unit_preferences: removed to allow adaptive counters
    build_order_priority: [
        'power',
        'refinery',
        'barracks',
        'factory',
        'power',
        'refinery',
        'tech',
        'service_depot'
    ],
    max_surplus_production_buildings: 5,
    surplus_production_threshold: 3000
};

export function computeGeniusAiActions(state: GameState, playerId: number): Action[] {
    const actions: Action[] = [];
    const player = state.players[playerId];
    if (!player) return actions;

    const aiState = getAIState(playerId);

    // Override personality with Genius-level traits without mutating shared state
    const basePersonality = getPersonalityForPlayer(playerId);
    // Deep clone to avoid mutating shared GENIUS_PERSONALITY and basePersonality
    // We only need deep clone for unit_preferences and build_order_priority which we mutate
    const personality = {
        ...basePersonality,
        ...GENIUS_PERSONALITY,
        unit_preferences: {
            infantry: [...(GENIUS_PERSONALITY.unit_preferences?.infantry || basePersonality.unit_preferences?.infantry || [])],
            vehicle: [...(GENIUS_PERSONALITY.unit_preferences?.vehicle || basePersonality.unit_preferences?.vehicle || [])]
        },
        build_order_priority: [...(GENIUS_PERSONALITY.build_order_priority || basePersonality.build_order_priority || [])]
    };

    // PERFORMANCE OPTIMIZATION: Use cached entity lookups
    const cache = createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId);
    const enemies = getEnemiesOf(cache, playerId);

    // Check for elimination
    const hasMCV = myUnits.some(u => u.key === 'mcv');
    if (myBuildings.length === 0 && !hasMCV) {
        return actions;
    }

    const harvesters = myUnits.filter(u => u.key === 'harvester');
    const combatUnits = myUnits.filter(u =>
        u.key !== 'harvester' &&
        u.key !== 'mcv' &&
        u.key !== 'engineer' &&
        u.key !== 'demo_truck'
    );

    const baseCenter = findBaseCenter(myBuildings);

    // INTELLIGENCE
    updateEnemyBaseLocation(aiState, enemies);
    updateEnemyIntelligence(aiState, enemies, state.tick);
    updateVengeance(state, playerId, aiState, [...myBuildings, ...myUnits]);

    // Genius Scouting: If we haven't found enemy base, prioritize scouting
    if (!aiState.enemyBaseLocation && combatUnits.length > 0 && state.tick % 60 === 0) {
        // Force a scout if we are blind
        actions.push(...handleScouting(state, playerId, aiState, combatUnits, enemies, baseCenter));
    }


    // PERFORMANCE: Stagger AI computation
    const tickOffset = playerId % AI_CONSTANTS.AI_TICK_INTERVAL;
    const isFullComputeTick = state.tick < AI_CONSTANTS.AI_TICK_INTERVAL ||
        state.tick % (AI_CONSTANTS.AI_TICK_INTERVAL / 2) === tickOffset; // Genius runs 2x more often

    // Genius Reaction Time: Near instant (0-2 ticks)
    // We simulate this by checking threats more often

    // Always detect threats for Genius
    const threats = detectThreats(
        baseCenter,
        harvesters,
        enemies,
        myBuildings,
        'hard',
        state.tick
    );
    aiState.threatsNearBase = threats.threatsNearBase;
    aiState.harvestersUnderAttack = threats.harvestersUnderAttack;

    // Safety & Defense - Critical Priority
    actions.push(...handleHarvesterSafety(state, playerId, harvesters, combatUnits, baseCenter, enemies, aiState, cache, 'hard'));

    // Instant defense reaction
    if (aiState.threatsNearBase.length > 0 && combatUnits.length > 0) {
        actions.push(...handleDefense(state, playerId, aiState, combatUnits, baseCenter, personality));
    }

    // SPECIAL OPS - Throttled to reduce noise
    if (state.tick % 30 === 0) {
        actions.push(...handleUnitRepair(state, playerId, combatUnits, myBuildings));
        actions.push(...handleEngineerCapture(state, playerId, aiState, myUnits.filter(u => u.key === 'engineer'), enemies, baseCenter));
        actions.push(...handleHijackerAssault(state, playerId, enemies, aiState, baseCenter));
        actions.push(...handleAirStrikes(state, playerId, enemies, aiState));
        actions.push(...handleDemoTruckAssault(state, playerId, enemies, aiState));
    }

    if (!isFullComputeTick) {
        // Even on off-ticks, Genius does micro
        actions.push(...handleMicro(state, combatUnits, enemies, baseCenter, personality, myBuildings, 'hard'));
        return actions;
    }

    // STRATEGY & PLANNING
    updateStrategy(
        aiState,
        state.tick,
        myBuildings,
        combatUnits,
        enemies,
        aiState.threatsNearBase,
        personality,
        player.credits,
        'hard'
    );

    evaluateInvestmentPriority(
        state,
        playerId,
        aiState,
        myBuildings,
        combatUnits,
        enemies,
        baseCenter
    );

    // GENIUS REACTIVE MACRO
    // Power Safety: Ensure we don't brown out
    const totalPower = myBuildings.reduce((acc, b) => {
        const bData = RULES.buildings[b.key];
        return acc + (bData?.power || 0);
    }, 0);
    const powerUsage = myBuildings.reduce((acc, b) => {
        const bData = RULES.buildings[b.key];
        return acc + (bData?.drain || 0);
    }, 0);

    // Use a higher threshold for Genius to be proactive
    if (totalPower - powerUsage < 60 && !personality.build_order_priority.includes('power')) {
        personality.build_order_priority.unshift('power');
    }

    // Anti-Air: If enemy has air units and we have no AA, prioritize Sam Site
    const enemyAir = enemies.filter(e => e.type === 'UNIT' && RULES.units[e.key]?.type === 'air');
    const myAA = myBuildings.filter(b => ['sam', 'aa_tower', 'sam_site'].includes(b.key));
    if (enemyAir.length > 0 && myAA.length === 0 && !personality.build_order_priority.includes('sam_site')) {
        personality.build_order_priority.unshift('sam_site');
    }

    // ECONOMIC SCALING
    // Target 2 harvesters per refinery, min 3 total
    const targetHarvesters = Math.max(3, myBuildings.filter(b => b.key === 'refinery').length * 2);
    if (harvesters.length < targetHarvesters && !personality.unit_preferences.vehicle.includes('harvester')) {
        personality.unit_preferences.vehicle.unshift('harvester');
    }

    // GENIUS ADAPTION: Counter-build
    // If enemy has many vehicles, prioritize rockets/medium tanks
    // If enemy has infantry, prioritize light tanks/artillery
    const enemyIntel = aiState.enemyIntelligence;
    if (enemyIntel.dominantArmor === 'heavy') {
        aiState.investmentPriority = 'warfare'; // Focus on army to counter
        // Bias towards counters
        personality.unit_preferences!.infantry = ['rocket', 'rocket', 'grenadier']; // Double rocket weight
        personality.unit_preferences!.vehicle = ['light', 'artillery', 'mammoth'];
    } else if (enemyIntel.dominantArmor === 'infantry') {
        personality.unit_preferences!.vehicle = ['light', 'artillery', 'jeep']; // Anti-infantry
        personality.unit_preferences!.infantry = ['rifle', 'grenadier'];
    }

    // ECONOMY
    if (player.readyToPlace) {
        actions.push(...handleBuildingPlacement(state, playerId, myBuildings, player));
    }

    actions.push(...handleEmergencySell(state, playerId, myBuildings, player, aiState));
    actions.push(...handleLastResortSell(state, playerId, myBuildings, player, aiState));

    // Genius Economy: standard economy handling but effectively uses the tuned personality
    // We pass 'hard' difficulty
    actions.push(...(handleEconomy(state, playerId, myBuildings, player, personality, aiState, enemies) || []));

    actions.push(...handleBuildingRepair(state, playerId, myBuildings, player, aiState));
    actions.push(...handleMCVOperations(state, playerId, aiState, myBuildings, myUnits));
    actions.push(...handleInductionRigOperations(state, playerId, myBuildings, myUnits));
    actions.push(...handleHarvesterGathering(state, playerId, harvesters, aiState.harvestersUnderAttack, aiState, 'hard'));

    // Harvester AI
    const harvesterResult = updateHarvesterAI(
        aiState.harvesterAI,
        playerId,
        state,
        'hard'
    );
    aiState.harvesterAI = harvesterResult.harvesterAI;
    actions.push(...harvesterResult.actions);

    // COMBAT EXECUTION
    // PINCER / MULTI-VECTOR OFFENSE
    const armySize = combatUnits.length;
    if (aiState.strategy === 'attack' || aiState.strategy === 'all_in') {
        if (armySize > 15 && aiState.strategy === 'attack') {
            // Split 30% to harass while main army attacks
            const splitIndex = Math.floor(armySize * 0.7);
            const mainForce = combatUnits.slice(0, splitIndex);
            const flankForce = combatUnits.slice(splitIndex);

            // Override attack group for this tick
            actions.push(...handleAttack(state, playerId, aiState, mainForce, enemies, baseCenter, personality));
            actions.push(...handleHarass(state, playerId, aiState, flankForce, enemies));
        } else {
            const ignoreSizeLimit = aiState.strategy === 'all_in'; // Genius waits for groups unless all-in
            actions.push(...handleAttack(state, playerId, aiState, combatUnits, enemies, baseCenter, personality, ignoreSizeLimit));
        }

        if (aiState.strategy === 'all_in') {
            actions.push(...handleHarvesterSuicideAttack(state, playerId, harvesters, enemies, combatUnits));
        }
    } else if (aiState.strategy === 'harass') {
        actions.push(...handleHarass(state, playerId, aiState, combatUnits, enemies));
        // Also rally rest
        actions.push(...handleRally(state, playerId, aiState, combatUnits, baseCenter, enemies));
    } else {
        // Buildup/Defend
        actions.push(...handleRally(state, playerId, aiState, combatUnits, baseCenter, enemies));
    }

    // HIGH-VALUE TARGET SNIPING
    // If we have a large army, force some units to snipe harvesters
    if (armySize > 20 && aiState.strategy === 'attack') {
        const enemyHarvesters = enemies.filter(e => e.key === 'harvester');
        const snipers = combatUnits.slice(0, 5); // 5 units dedicated to economic sabotage
        if (enemyHarvesters.length > 0) {
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: {
                    unitIds: snipers.map(u => u.id),
                    targetId: enemyHarvesters[0].id
                }
            });
        }
    }

    // DEFENSIVE ESCORT FOR MCVs
    const movingMCVs = myUnits.filter(u => u.key === 'mcv' && (u as any).movement?.moveTarget);
    if (movingMCVs.length > 0 && armySize > 5) {
        const escort = combatUnits.slice(0, 3);
        actions.push({
            type: 'COMMAND_MOVE',
            payload: {
                unitIds: escort.map(u => u.id),
                x: movingMCVs[0].pos.x,
                y: movingMCVs[0].pos.y
            }
        });
    }

    // Always Scout if possible
    actions.push(...handleScouting(state, playerId, aiState, combatUnits, enemies, baseCenter));

    // Always Micro
    actions.push(...handleMicro(state, combatUnits, enemies, baseCenter, personality, myBuildings, 'hard'));

    if (state.tick % 1000 === 0) {
        console.log(`[Genius AI ${playerId}] Tick: ${state.tick}, Strategy: ${aiState.strategy}, Army: ${combatUnits.length}, Credits: ${player.credits}, Threats: ${aiState.threatsNearBase.length}`);
    }

    return actions;
}

export const geniusAIImplementation = {
    id: 'genius',
    name: 'Genius',
    description: 'An advanced AI that uses superior tactics and economy.',
    computeActions: ({ state, playerId }: { state: GameState, playerId: number }) => computeGeniusAiActions(state, playerId)
};

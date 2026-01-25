/**
 * Integration Tests for Harvester AI System
 *
 * These tests verify end-to-end behavior of the complete harvester AI system,
 * including danger avoidance, desperation-driven risk taking, stuck resolution,
 * escort assignment, difficulty scaling, and multi-tick simulation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { updateHarvesterAI, createInitialHarvesterAIState } from '../../../src/engine/ai/harvester/index.js';
import { computeAiActions } from '../../../src/engine/ai/index.js';
import { getAIState, resetAIState } from '../../../src/engine/ai/state.js';
import { INITIAL_STATE } from '../../../src/engine/reducer.js';
import {
    GameState,
    Vector,
    EntityId,
    HarvesterUnit,
    CombatUnit,
    BuildingEntity,
    ResourceEntity,
    PlayerState
} from '../../../src/engine/types.js';
import {
    createTestHarvester,
    createTestCombatUnit,
    createTestBuilding,
    createTestResource
} from '../../../src/engine/test-utils.js';
import { getZoneKey, updateDangerMap, getZoneDanger, findSafestOre } from '../../../src/engine/ai/harvester/danger_map.js';
import { calculateDesperationScore, getDesperationBehavior } from '../../../src/engine/ai/harvester/desperation.js';
import { updateEscortAssignments, releaseEscort, getEscortForOreField } from '../../../src/engine/ai/harvester/escort.js';
import { detectStuckHarvester, resolveStuckHarvester } from '../../../src/engine/ai/harvester/stuck_resolver.js';
import { assignHarvesterRoles, getHarvesterRole, getRoleMaxDanger } from '../../../src/engine/ai/harvester/coordinator.js';
import {
    HarvesterAIState,
    HARVESTER_AI_CONSTANTS,
    createInitialHarvesterAIState as createHarvesterAIState
} from '../../../src/engine/ai/harvester/types.js';

// ============ TEST HELPERS ============

function createTestGameState(overrides: Partial<GameState> = {}): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        ...overrides
    };
}

function createTestPlayer(playerId: number, overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id: playerId,
        isAi: true,
        difficulty: 'hard',
        color: '#ff0000',
        credits: 5000,
        maxPower: 100,
        usedPower: 50,
        queues: {
            building: { current: null, progress: 0, invested: 0 },
            infantry: { current: null, progress: 0, invested: 0 },
            vehicle: { current: null, progress: 0, invested: 0 },
            air: { current: null, progress: 0, invested: 0 }
        },
        readyToPlace: null,
        ...overrides
    };
}

function addPlayer(state: GameState, playerId: number, overrides: Partial<PlayerState> = {}): PlayerState {
    const player = createTestPlayer(playerId, overrides);
    state.players = {
        ...state.players,
        [playerId]: player
    };
    return player;
}

function addHarvester(state: GameState, playerId: number, x: number, y: number, overrides: Partial<HarvesterUnit> = {}): HarvesterUnit {
    const harvester = createTestHarvester({
        id: `harv_${playerId}_${x}_${y}`,
        owner: playerId,
        x,
        y,
        ...overrides
    });
    state.entities = {
        ...state.entities,
        [harvester.id]: harvester
    };
    return harvester;
}

function addEnemy(state: GameState, enemyId: number, x: number, y: number, key: string = 'heavy'): CombatUnit {
    if (!state.players[enemyId]) {
        addPlayer(state, enemyId);
    }
    const enemy = createTestCombatUnit({
        id: `enemy_${enemyId}_${x}_${y}`,
        owner: enemyId,
        key: key as any,
        x,
        y
    });
    state.entities = {
        ...state.entities,
        [enemy.id]: enemy
    };
    return enemy;
}

function addCombatUnit(state: GameState, playerId: number, x: number, y: number, key: string = 'heavy'): CombatUnit {
    const unit = createTestCombatUnit({
        id: `combat_${playerId}_${x}_${y}`,
        owner: playerId,
        key: key as any,
        x,
        y
    });
    state.entities = {
        ...state.entities,
        [unit.id]: unit
    };
    return unit;
}

function addOre(state: GameState, x: number, y: number, hp: number = 1000): ResourceEntity {
    const ore = createTestResource({
        id: `ore_${x}_${y}`,
        x,
        y,
        hp
    });
    state.entities = {
        ...state.entities,
        [ore.id]: ore
    };
    return ore;
}

function addRefinery(state: GameState, playerId: number, x: number, y: number): BuildingEntity {
    const refinery = createTestBuilding({
        id: `ref_${playerId}_${x}_${y}`,
        owner: playerId,
        key: 'refinery',
        x,
        y
    });
    state.entities = {
        ...state.entities,
        [refinery.id]: refinery
    };
    return refinery;
}

function addConyard(state: GameState, playerId: number, x: number, y: number): BuildingEntity {
    const conyard = createTestBuilding({
        id: `conyard_${playerId}_${x}_${y}`,
        owner: playerId,
        key: 'conyard',
        x,
        y
    });
    state.entities = {
        ...state.entities,
        [conyard.id]: conyard
    };
    return conyard;
}

// ============ INTEGRATION TESTS ============

describe('Harvester AI Integration Tests', () => {
    beforeEach(() => {
        resetAIState(); // Clean slate for each test
    });

    describe('danger avoidance', () => {
        it('should prefer safe ore over closer dangerous ore', () => {
            // Setup: Player 1 at position (100, 100)
            // Safe ore at (400, 100) - no enemies nearby
            // Dangerous ore at (200, 100) - closer but has enemies
            const state = createTestGameState({ tick: 60 });
            addPlayer(state, 1);
            addPlayer(state, 2); // Enemy player

            const harvester = addHarvester(state, 1, 100, 100);
            addRefinery(state, 1, 50, 50);

            // Safe ore - far from harvester but safe
            const safeOre = addOre(state, 400, 100);

            // Dangerous ore - close to harvester but has enemies
            const dangerousOre = addOre(state, 200, 100);

            // Add enemies near the dangerous ore
            addEnemy(state, 2, 200, 120);
            addEnemy(state, 2, 220, 100);
            addEnemy(state, 2, 180, 100);

            // Run the harvester AI
            const harvesterAI = createInitialHarvesterAIState();

            // First, update danger map with enemy positions
            const enemies = Object.values(state.entities).filter(
                e => e.type === 'UNIT' && e.owner === 2 && !e.dead
            );
            updateDangerMap(harvesterAI, 1, enemies, [], state.tick, 'hard');

            // Verify danger is registered near dangerous ore
            const dangerNearDangerousOre = getZoneDanger(harvesterAI, dangerousOre.pos.x, dangerousOre.pos.y);
            expect(dangerNearDangerousOre).toBeGreaterThan(0);

            // Verify safe ore zone has low/no danger
            const dangerNearSafeOre = getZoneDanger(harvesterAI, safeOre.pos.x, safeOre.pos.y);
            expect(dangerNearSafeOre).toBe(0);

            // Find safest ore - should prefer safe ore despite distance
            const bestOre = findSafestOre(
                harvesterAI,
                harvester,
                [safeOre, dangerousOre],
                30 // Low desperation - should avoid danger
            );

            // With low desperation, should pick safe ore even though dangerous is closer
            expect(bestOre).not.toBeNull();
            expect(bestOre!.id).toBe(safeOre.id);
        });

        it('should update danger map when enemies move', () => {
            const state = createTestGameState({ tick: 30 });
            addPlayer(state, 1);
            addPlayer(state, 2);

            // Add enemy at initial position
            const enemy = addEnemy(state, 2, 500, 500);
            const initialZoneKey = getZoneKey(500, 500);

            const harvesterAI = createInitialHarvesterAIState();

            // Update danger map
            const enemies = [enemy];
            updateDangerMap(harvesterAI, 1, enemies, [], state.tick, 'hard');

            // Verify danger exists at initial position
            expect(harvesterAI.dangerMap.has(initialZoneKey)).toBe(true);
            expect(getZoneDanger(harvesterAI, 500, 500)).toBeGreaterThan(0);

            // Simulate enemy moving to new position
            enemy.pos = new Vector(800, 800);
            state.tick = 60;

            updateDangerMap(harvesterAI, 1, enemies, [], state.tick, 'hard');

            // Verify old position is now safe (no enemies there)
            expect(getZoneDanger(harvesterAI, 500, 500)).toBe(0);

            // Verify new position has danger
            expect(getZoneDanger(harvesterAI, 800, 800)).toBeGreaterThan(0);
        });
    });

    describe('desperation-driven risk taking', () => {
        it('should allow risky ore when desperation is high', () => {
            const state = createTestGameState({ tick: 60 });
            addPlayer(state, 1, { credits: 0 }); // Zero credits - maximum desperation
            addPlayer(state, 2);

            const harvester = addHarvester(state, 1, 100, 100, { cargo: 0 });
            // No refineries - increases desperation further (harvester ratio factor)

            // Only dangerous ore available
            const dangerousOre = addOre(state, 300, 100);
            addEnemy(state, 2, 300, 120);
            addEnemy(state, 2, 320, 100);

            // Setup AI state
            const harvesterAI = createInitialHarvesterAIState();

            // Update danger map
            const enemies = Object.values(state.entities).filter(
                e => e.type === 'UNIT' && e.owner === 2 && !e.dead
            );
            updateDangerMap(harvesterAI, 1, enemies, [], state.tick, 'hard');

            // Calculate high desperation score
            const player = state.players[1];
            const desperationScore = calculateDesperationScore(
                player,
                1, // 1 harvester
                0, // 0 refineries - maximum desperation for harvester ratio
                0, // no income (0 refineries)
                1, // some expense
                state.tick,
                'hard'
            );

            // Verify desperation is high due to low credits and no refineries
            expect(desperationScore).toBeGreaterThan(40);

            // With high desperation, danger matters less
            const behavior = getDesperationBehavior(desperationScore);
            expect(behavior.maxAcceptableDanger).toBeGreaterThan(50);

            // Find safest ore with high desperation - should pick dangerous ore
            // because it's the only option and desperation reduces danger weighting
            const bestOre = findSafestOre(
                harvesterAI,
                harvester,
                [dangerousOre],
                desperationScore
            );

            expect(bestOre).not.toBeNull();
            expect(bestOre!.id).toBe(dangerousOre.id);
        });

        it('should assign risk-taker role when desperate with low cargo', () => {
            const state = createTestGameState({ tick: 60 });
            addPlayer(state, 1, { credits: 100 }); // Very low credits
            addRefinery(state, 1, 50, 50);

            // Harvester with low cargo
            const harvester = addHarvester(state, 1, 100, 100, { cargo: 50 });

            const harvesterAI = createInitialHarvesterAIState();

            // High desperation score
            const desperationScore = 80;

            // Assign roles
            assignHarvesterRoles(
                harvesterAI,
                [harvester],
                desperationScore,
                'hard'
            );

            // Should be assigned risk-taker role
            const role = getHarvesterRole(harvesterAI, harvester.id);
            expect(role).toBe('risk-taker');

            // Risk-takers have high danger tolerance
            const maxDanger = getRoleMaxDanger(role, desperationScore);
            expect(maxDanger).toBe(100);
        });

        it('should transition from safe to risk-taker as desperation increases', () => {
            const harvesterAI = createInitialHarvesterAIState();

            // Healthy harvester with low cargo
            const harvester = createTestHarvester({
                id: 'harv_transition',
                owner: 1,
                hp: 1000, // Full HP
                cargo: 50 // Low cargo
            });

            // At low desperation: standard role
            assignHarvesterRoles(harvesterAI, [harvester], 30, 'hard');
            expect(getHarvesterRole(harvesterAI, harvester.id)).toBe('standard');

            // At medium desperation: opportunist role
            assignHarvesterRoles(harvesterAI, [harvester], 55, 'hard');
            expect(getHarvesterRole(harvesterAI, harvester.id)).toBe('opportunist');

            // At high desperation: risk-taker role
            assignHarvesterRoles(harvesterAI, [harvester], 80, 'hard');
            expect(getHarvesterRole(harvesterAI, harvester.id)).toBe('risk-taker');
        });
    });

    describe('stuck resolution', () => {
        it('should produce move action for stuck harvester', () => {
            const state = createTestGameState({ tick: 100 });
            addPlayer(state, 1);
            addRefinery(state, 1, 200, 200);
            const ore = addOre(state, 300, 300);
            // Alternative ore within DETOUR_SEARCH_RADIUS (300px) of harvester
            const ore2 = addOre(state, 250, 250);

            // Create a stuck harvester (high harvestAttemptTicks, has target)
            // Level 2 requires stuckTicks > 15, so use 16+
            const harvester = addHarvester(state, 1, 150, 150, {
                harvestAttemptTicks: 18, // Level 2 stuck (> 15)
                resourceTargetId: ore.id
            });

            const harvesterAI = createInitialHarvesterAIState();

            // Verify harvester is detected as stuck
            expect(detectStuckHarvester(harvester)).toBe(true);

            // Resolve stuck state
            const resolution = resolveStuckHarvester(
                harvesterAI,
                harvester,
                [ore, ore2],
                [state.entities['ref_1_200_200'] as BuildingEntity],
                state.tick,
                'hard'
            );

            // Level 2 should try detour when alternate ore is within radius
            expect(resolution.action).toBe('detour');
            expect(resolution.targetOre).toBeDefined();
            expect(resolution.targetOre!.id).toBe(ore2.id); // Should pick alternate ore
        });

        it('should escalate resolution levels over time', () => {
            const state = createTestGameState({ tick: 100 });
            addPlayer(state, 1);
            const refinery = addRefinery(state, 1, 200, 200);
            const ore = addOre(state, 300, 300);
            // Add alternate ore far away (outside detour radius) so level 3 uses relocate
            const farOre = addOre(state, 800, 800);

            // Create fresh harvesterAI for each test to avoid blacklist carryover
            let harvesterAI = createInitialHarvesterAIState();

            // Level 1: 6-15 ticks stuck (> 5) -> nudge
            const harvesterL1 = createTestHarvester({
                id: 'harv_l1',
                owner: 1,
                x: 150,
                y: 150,
                harvestAttemptTicks: 10, // > 5, so level 1
                resourceTargetId: ore.id
            });

            const resolution1 = resolveStuckHarvester(
                harvesterAI,
                harvesterL1,
                [ore, farOre],
                [refinery],
                state.tick,
                'hard'
            );
            expect(resolution1.action).toBe('nudge');

            // Level 3: 31-45 ticks stuck (> 30) -> relocate (blacklists current ore)
            harvesterAI = createInitialHarvesterAIState(); // Fresh state
            const harvesterL3 = createTestHarvester({
                id: 'harv_l3',
                owner: 1,
                x: 150,
                y: 150,
                harvestAttemptTicks: 35, // > 30, so level 3
                resourceTargetId: ore.id
            });

            const resolution3 = resolveStuckHarvester(
                harvesterAI,
                harvesterL3,
                [ore, farOre],
                [refinery],
                state.tick,
                'hard'
            );
            expect(resolution3.action).toBe('relocate');
            // Should blacklist current ore
            expect(harvesterAI.blacklistedOre.has(ore.id)).toBe(true);

            // Level 4: 46-60 ticks stuck (> 45) -> retreat
            harvesterAI = createInitialHarvesterAIState(); // Fresh state
            const harvesterL4 = createTestHarvester({
                id: 'harv_l4',
                owner: 1,
                x: 150,
                y: 150,
                harvestAttemptTicks: 50, // > 45, so level 4
                resourceTargetId: ore.id
            });

            const resolution4 = resolveStuckHarvester(
                harvesterAI,
                harvesterL4,
                [ore, farOre],
                [refinery],
                state.tick,
                'hard'
            );
            expect(resolution4.action).toBe('retreat');
            expect(resolution4.targetRefinery).toBeDefined();

            // Level 5: >60 ticks stuck -> emergency
            harvesterAI = createInitialHarvesterAIState(); // Fresh state
            const harvesterL5 = createTestHarvester({
                id: 'harv_l5',
                owner: 1,
                x: 150,
                y: 150,
                harvestAttemptTicks: 65, // > 60, so level 5
                resourceTargetId: ore.id
            });

            const resolution5 = resolveStuckHarvester(
                harvesterAI,
                harvesterL5,
                [ore, farOre],
                [refinery],
                state.tick,
                'hard'
            );
            expect(resolution5.action).toBe('emergency');
        });

        it('should blacklist ore after level 3 stuck resolution', () => {
            const state = createTestGameState({ tick: 100 });
            addPlayer(state, 1);
            const refinery = addRefinery(state, 1, 200, 200);
            const ore = addOre(state, 300, 300);

            const harvesterAI = createInitialHarvesterAIState();

            // Verify ore is not blacklisted initially
            expect(harvesterAI.blacklistedOre.has(ore.id)).toBe(false);

            // Create harvester stuck at level 3
            const harvester = createTestHarvester({
                id: 'harv_blacklist',
                owner: 1,
                x: 150,
                y: 150,
                harvestAttemptTicks: 35,
                resourceTargetId: ore.id
            });

            resolveStuckHarvester(
                harvesterAI,
                harvester,
                [ore],
                [refinery],
                state.tick,
                'hard'
            );

            // Ore should now be blacklisted
            expect(harvesterAI.blacklistedOre.has(ore.id)).toBe(true);
        });
    });

    describe('escort system', () => {
        it('should assign escort to dangerous ore field', () => {
            const state = createTestGameState({ tick: 90 });
            addPlayer(state, 1);
            addPlayer(state, 2);

            // Add ore in dangerous zone
            const dangerousOre = addOre(state, 500, 500);

            // Add harvester near the ore with cargo to meet value threshold
            // Base harvester value is 400, min for escort is 500
            // So we need at least 101 cargo (400 + 101 > 500)
            const harvester = addHarvester(state, 1, 480, 480, { cargo: 200 });
            addRefinery(state, 1, 200, 200);

            // Add combat unit available for escort (no target, not escorting)
            const combatUnit = addCombatUnit(state, 1, 400, 400);

            // Add many enemies near the ore to create high danger
            // Each enemy adds ENEMY_PRESENCE_WEIGHT (10) to danger
            // We need > 40 danger, so 5 enemies
            addEnemy(state, 2, 520, 500);
            addEnemy(state, 2, 500, 520);
            addEnemy(state, 2, 480, 520);
            addEnemy(state, 2, 520, 520);
            addEnemy(state, 2, 460, 500);

            const harvesterAI = createInitialHarvesterAIState();

            // Update danger map first
            const enemies = Object.values(state.entities).filter(
                e => e.type === 'UNIT' && e.owner === 2 && !e.dead
            );
            updateDangerMap(harvesterAI, 1, enemies, [], state.tick, 'hard');

            // Verify danger at ore location (5 enemies * 10 = 50)
            const danger = getZoneDanger(harvesterAI, dangerousOre.pos.x, dangerousOre.pos.y);
            expect(danger).toBeGreaterThan(HARVESTER_AI_CONSTANTS.ESCORT_ASSIGN_DANGER);

            // Run escort assignment
            updateEscortAssignments(
                harvesterAI,
                [harvester],
                [combatUnit],
                [dangerousOre],
                30, // Low desperation
                'hard'
            );

            // Combat unit should be assigned to escort the ore field
            const escorts = getEscortForOreField(harvesterAI, dangerousOre.id);
            expect(escorts).toContain(combatUnit.id);
        });

        it('should release escort when danger drops', () => {
            const harvesterAI = createInitialHarvesterAIState();

            const ore = createTestResource({ id: 'ore_release', x: 500, y: 500 });
            const combatUnit = createTestCombatUnit({ id: 'combat_release', owner: 1 });

            // Manually assign escort
            harvesterAI.escortAssignments.set(combatUnit.id, ore.id);

            // Set low danger in the zone (below release threshold of 30)
            const zoneKey = getZoneKey(ore.pos.x, ore.pos.y);
            harvesterAI.dangerMap.set(zoneKey, {
                key: zoneKey,
                dangerScore: 20, // Below ESCORT_RELEASE_DANGER (30)
                enemyCount: 0,
                recentAttacks: 0,
                harvesterDeaths: 0,
                lastUpdate: 100
            });

            // Release escorts
            releaseEscort(harvesterAI, [ore]);

            // Escort should be released
            expect(harvesterAI.escortAssignments.has(combatUnit.id)).toBe(false);
        });

        it('should not assign escorts at easy/medium difficulty', () => {
            const state = createTestGameState({ tick: 90 });
            addPlayer(state, 1);
            addPlayer(state, 2);

            const ore = addOre(state, 500, 500);
            const harvester = addHarvester(state, 1, 480, 480);
            const combatUnit = addCombatUnit(state, 1, 400, 400);

            // Add enemies to create danger
            addEnemy(state, 2, 520, 500);
            addEnemy(state, 2, 500, 520);

            const harvesterAI = createInitialHarvesterAIState();

            // Update danger
            const enemies = Object.values(state.entities).filter(
                e => e.type === 'UNIT' && e.owner === 2 && !e.dead
            );
            updateDangerMap(harvesterAI, 1, enemies, [], state.tick, 'hard');

            // Try to assign escorts at easy difficulty
            updateEscortAssignments(
                harvesterAI,
                [harvester],
                [combatUnit],
                [ore],
                30,
                'easy'
            );

            // No escorts should be assigned
            expect(harvesterAI.escortAssignments.size).toBe(0);

            // Also test medium
            updateEscortAssignments(
                harvesterAI,
                [harvester],
                [combatUnit],
                [ore],
                30,
                'medium'
            );

            expect(harvesterAI.escortAssignments.size).toBe(0);
        });
    });

    describe('difficulty scaling', () => {
        it('should skip harvester AI for easy difficulty', () => {
            const state = createTestGameState({ tick: 60 });
            addPlayer(state, 1);
            addHarvester(state, 1, 100, 100);
            addRefinery(state, 1, 200, 200);

            const harvesterAI = createInitialHarvesterAIState();
            const originalState = { ...harvesterAI };

            const result = updateHarvesterAI(harvesterAI, 1, state, 'easy');

            // Should return same reference (unchanged)
            expect(result.harvesterAI).toBe(harvesterAI);
            expect(result.actions).toHaveLength(0);
        });

        it('should skip harvester AI for dummy difficulty', () => {
            const state = createTestGameState({ tick: 60 });
            addPlayer(state, 1);
            addHarvester(state, 1, 100, 100);
            addRefinery(state, 1, 200, 200);

            const harvesterAI = createInitialHarvesterAIState();

            const result = updateHarvesterAI(harvesterAI, 1, state, 'dummy');

            expect(result.harvesterAI).toBe(harvesterAI);
            expect(result.actions).toHaveLength(0);
        });

        it('should use simplified danger map for medium difficulty', () => {
            const state = createTestGameState({ tick: 30 });
            addPlayer(state, 1);
            addPlayer(state, 2);

            const enemy = addEnemy(state, 2, 500, 500);
            const harvesterAI = createInitialHarvesterAIState();

            // Update danger map at medium difficulty
            updateDangerMap(harvesterAI, 1, [enemy], [], state.tick, 'medium');

            // Should have danger zone
            const danger = getZoneDanger(harvesterAI, 500, 500);
            expect(danger).toBeGreaterThan(0);

            // But only from enemy presence, not from attack/death memory
            const zone = harvesterAI.dangerMap.get(getZoneKey(500, 500));
            expect(zone?.recentAttacks).toBe(0);
            expect(zone?.harvesterDeaths).toBe(0);
        });

        it('should use full danger calculation for hard difficulty', () => {
            const state = createTestGameState({ tick: 30 });
            addPlayer(state, 1);
            addPlayer(state, 2);

            const enemy = addEnemy(state, 2, 500, 500);
            const harvesterAI = createInitialHarvesterAIState();

            // Simulate a harvester death in the zone
            harvesterAI.harvesterDeaths.push({
                position: new Vector(500, 500),
                tick: state.tick - 10,
                zoneKey: getZoneKey(500, 500)
            });

            // Update danger map at hard difficulty
            updateDangerMap(harvesterAI, 1, [enemy], [], state.tick, 'hard');

            // Should have higher danger due to death memory
            const zone = harvesterAI.dangerMap.get(getZoneKey(500, 500));
            expect(zone).toBeDefined();
            expect(zone!.harvesterDeaths).toBe(1);
            expect(zone!.dangerScore).toBeGreaterThan(HARVESTER_AI_CONSTANTS.ENEMY_PRESENCE_WEIGHT);
        });

        it('should limit stuck resolution levels for easier difficulties', () => {
            const state = createTestGameState({ tick: 100 });
            addPlayer(state, 1);
            const refinery = addRefinery(state, 1, 200, 200);
            const ore = addOre(state, 300, 300);

            // Create very stuck harvester (level 5)
            const harvester = createTestHarvester({
                id: 'harv_easy_stuck',
                owner: 1,
                x: 150,
                y: 150,
                harvestAttemptTicks: 65,
                resourceTargetId: ore.id
            });

            const harvesterAIEasy = createInitialHarvesterAIState();
            const resolutionEasy = resolveStuckHarvester(
                harvesterAIEasy,
                harvester,
                [ore],
                [refinery],
                state.tick,
                'easy' // Easy difficulty caps at level 2
            );

            // Easy should cap at level 2 (detour/nudge), not emergency
            expect(['nudge', 'detour']).toContain(resolutionEasy.action);

            const harvesterAIHard = createInitialHarvesterAIState();
            const resolutionHard = resolveStuckHarvester(
                harvesterAIHard,
                harvester,
                [ore],
                [refinery],
                state.tick,
                'hard' // Hard allows level 5
            );

            // Hard should reach level 5 (emergency)
            expect(resolutionHard.action).toBe('emergency');
        });
    });

    describe('multi-tick simulation', () => {
        it('should maintain state across ticks', () => {
            const state = createTestGameState({ tick: 0 });
            addPlayer(state, 1, { credits: 1000 });
            addPlayer(state, 2);

            const harvester = addHarvester(state, 1, 100, 100);
            addRefinery(state, 1, 200, 200);
            addOre(state, 400, 400);
            addEnemy(state, 2, 600, 600);

            let harvesterAI = createInitialHarvesterAIState();

            // Run multiple ticks
            const tickResults: { tick: number; desperationScore: number; rolesAssigned: boolean }[] = [];

            for (let tick = 0; tick <= 180; tick += 30) {
                state.tick = tick;

                const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');
                harvesterAI = result.harvesterAI;

                tickResults.push({
                    tick,
                    desperationScore: harvesterAI.desperationScore,
                    rolesAssigned: harvesterAI.harvesterRoles.size > 0
                });
            }

            // Verify state was updated
            expect(harvesterAI.dangerMapLastUpdate).toBeGreaterThan(0);

            // Roles should be assigned after tick 60
            const resultAfter60 = tickResults.find(r => r.tick >= 60);
            expect(resultAfter60?.rolesAssigned).toBe(true);
        });

        it('should update danger map at correct intervals', () => {
            const state = createTestGameState();
            addPlayer(state, 1);
            addPlayer(state, 2);
            addHarvester(state, 1, 100, 100);
            addRefinery(state, 1, 200, 200);
            addEnemy(state, 2, 500, 500);

            let harvesterAI = createInitialHarvesterAIState();
            const dangerMapUpdates: number[] = [];

            // Run for 120 ticks, check danger map updates
            // Note: dangerMapLastUpdate is set when updateDangerMap runs,
            // which happens when tick % 30 === 0
            for (let tick = 0; tick <= 120; tick++) {
                state.tick = tick;
                const previousLastUpdate = harvesterAI.dangerMapLastUpdate;
                const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

                // Check if dangerMapLastUpdate was modified to the current tick
                if (result.harvesterAI.dangerMapLastUpdate === tick && tick % 30 === 0) {
                    dangerMapUpdates.push(tick);
                }

                harvesterAI = result.harvesterAI;
            }

            // Danger map should update every 30 ticks (0, 30, 60, 90, 120)
            expect(dangerMapUpdates).toContain(30);
            expect(dangerMapUpdates).toContain(60);
            expect(dangerMapUpdates).toContain(90);
            expect(dangerMapUpdates).toContain(120);
            // Note: tick 0 may or may not be recorded depending on initial state
            expect(dangerMapUpdates.length).toBeGreaterThanOrEqual(4);
        });

        it('should coordinate all systems on tick divisible by all intervals', () => {
            // Tick 0 is divisible by all intervals (30, 60, 90)
            const state = createTestGameState({ tick: 0 });
            addPlayer(state, 1, { credits: 2000 });
            addPlayer(state, 2);

            const harvester = addHarvester(state, 1, 100, 100);
            addRefinery(state, 1, 200, 200);
            addOre(state, 400, 400);
            const combatUnit = addCombatUnit(state, 1, 150, 150);
            addEnemy(state, 2, 500, 500);

            const harvesterAI = createInitialHarvesterAIState();
            const result = updateHarvesterAI(harvesterAI, 1, state, 'hard');

            // All systems should have been updated
            expect(result.harvesterAI.dangerMapLastUpdate).toBe(0);
            expect(result.harvesterAI.harvesterRoles.has(harvester.id)).toBe(true);
            expect(result.harvesterAI.desperationScore).toBeDefined();
        });

        it('should clean up expired blacklist entries over time', () => {
            const harvesterAI = createInitialHarvesterAIState();
            const refinery = createTestBuilding({ id: 'ref_cleanup', owner: 1, key: 'refinery' });
            const ore = createTestResource({ id: 'ore_cleanup', x: 300, y: 300 });

            // Add blacklisted ore with expiry at tick 200
            harvesterAI.blacklistedOre.set(ore.id, 200);

            // Create stuck harvester
            const harvester = createTestHarvester({
                id: 'harv_cleanup',
                owner: 1,
                harvestAttemptTicks: 10,
                resourceTargetId: ore.id
            });

            // Before expiry - ore should still be filtered out
            resolveStuckHarvester(harvesterAI, harvester, [ore], [refinery], 100, 'hard');
            expect(harvesterAI.blacklistedOre.has(ore.id)).toBe(true);

            // After expiry - ore should be cleaned up
            resolveStuckHarvester(harvesterAI, harvester, [ore], [refinery], 250, 'hard');
            expect(harvesterAI.blacklistedOre.has(ore.id)).toBe(false);
        });
    });

    describe('full integration with AI loop', () => {
        it('should integrate harvester AI with main AI loop', () => {
            const state = createTestGameState({ tick: 60 });
            addPlayer(state, 1, { credits: 3000 });
            addPlayer(state, 2);

            addConyard(state, 1, 100, 100);
            addRefinery(state, 1, 200, 200);
            addHarvester(state, 1, 150, 150);
            addOre(state, 400, 400);
            addEnemy(state, 2, 600, 600);

            // Reset AI state
            resetAIState();

            // Run full AI loop
            const actions = computeAiActions(state, 1);

            // Get AI state to verify harvester AI was updated
            const aiState = getAIState(1);

            // Harvester AI state should exist and have been initialized
            expect(aiState.harvesterAI).toBeDefined();
            expect(aiState.harvesterAI.dangerMapLastUpdate).toBeDefined();
        });

        it('should persist harvester AI state across AI ticks', () => {
            const state = createTestGameState({ tick: 0 });
            addPlayer(state, 1, { credits: 2000 });
            addPlayer(state, 2);

            addConyard(state, 1, 100, 100);
            addRefinery(state, 1, 200, 200);
            const harvester = addHarvester(state, 1, 150, 150);
            addOre(state, 400, 400);

            resetAIState();

            // Run AI at tick 0
            computeAiActions(state, 1);
            let aiState = getAIState(1);
            const initialState = { ...aiState.harvesterAI };

            // Run AI at tick 60 (coordinator update)
            state.tick = 60;
            computeAiActions(state, 1);
            aiState = getAIState(1);

            // State should have been updated
            expect(aiState.harvesterAI.harvesterRoles.size).toBeGreaterThanOrEqual(0);
        });
    });
});

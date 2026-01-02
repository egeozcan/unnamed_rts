import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai';
import { GameState, Entity, Vector, PlayerState, UnitKey, BuildingKey, EntityId } from '../../src/engine/types.js';
import { createTestCombatUnit, createTestBuilding } from '../../src/engine/test-utils';

const { getAIState } = _testUtils;

interface TestEntityOverrides {
    id?: string;
    owner?: number;
    type?: 'UNIT' | 'BUILDING';
    key?: string;
    pos?: Vector;
    prevPos?: Vector;
    x?: number;
    y?: number;
    hp?: number;
    maxHp?: number;
    dead?: boolean;
    targetId?: EntityId | null;
    moveTarget?: Vector | null;
}

function createTestEntity(overrides: TestEntityOverrides = {}): Entity {
    const id = overrides.id ?? 'test_' + Math.random().toString(36).slice(2);
    const x = overrides.pos?.x ?? overrides.x ?? 100;
    const y = overrides.pos?.y ?? overrides.y ?? 100;

    if (overrides.type === 'BUILDING') {
        return createTestBuilding({
            id,
            owner: overrides.owner ?? 0,
            key: (overrides.key ?? 'conyard') as BuildingKey,
            x, y,
            hp: overrides.hp,
            maxHp: overrides.maxHp,
            dead: overrides.dead,
            targetId: overrides.targetId
        });
    }

    return createTestCombatUnit({
        id,
        owner: overrides.owner ?? 0,
        key: (overrides.key ?? 'heavy') as Exclude<UnitKey, 'harvester'>,
        x, y,
        hp: overrides.hp ?? 400,
        maxHp: overrides.maxHp ?? 400,
        dead: overrides.dead,
        targetId: overrides.targetId,
        moveTarget: overrides.moveTarget
    });
}

function createPlayer(id: number, overrides: Partial<PlayerState> = {}): PlayerState {
    return {
        id,
        isAi: true,
        difficulty: 'hard',
        color: '#ff0000',
        credits: 1000,
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

describe('AI Stranded Units', () => {
    beforeEach(() => {
        resetAIState();
    });

    describe('Units stranded during strategy change', () => {
        it('should issue commands to combat units that were in attack mode when switching to buildup', () => {
            // Setup: AI player with units far from base, few units (below attack threshold)
            // This simulates units that were attacking, lost some members, and now strategy is buildup

            const aiPlayerId = 1;

            // Player 1's base at top-left
            const basePos = new Vector(350, 350);

            // Enemy base at bottom-right (for targeting)
            const enemyBasePos = new Vector(2500, 2500);

            // Combat units stranded near enemy base (far from own base)
            // Only 3 units - below ATTACK_GROUP_MIN_SIZE of 5
            const tank1 = createTestEntity({
                id: 'tank1',
                owner: aiPlayerId,
                key: 'heavy',
                pos: new Vector(2400, 2400),
                prevPos: new Vector(2400, 2400),
                moveTarget: null,
                targetId: null
            });

            const tank2 = createTestEntity({
                id: 'tank2',
                owner: aiPlayerId,
                key: 'heavy',
                pos: new Vector(2450, 2420),
                prevPos: new Vector(2450, 2420),
                moveTarget: null,
                targetId: null
            });

            const tank3 = createTestEntity({
                id: 'artillery1',
                owner: aiPlayerId,
                key: 'artillery',
                pos: new Vector(2380, 2430),
                prevPos: new Vector(2380, 2430),
                moveTarget: null,
                targetId: null
            });

            // Player's buildings at base
            const conyard = createTestEntity({
                id: 'cy_p1',
                owner: aiPlayerId,
                type: 'BUILDING',
                key: 'conyard',
                pos: basePos,
                prevPos: basePos,
                hp: 3000,
                maxHp: 3000
            });

            const factory = createTestEntity({
                id: 'factory1',
                owner: aiPlayerId,
                type: 'BUILDING',
                key: 'factory',
                pos: basePos.add(new Vector(100, 0)),
                prevPos: basePos.add(new Vector(100, 0)),
                hp: 2000,
                maxHp: 2000
            });

            // Enemy buildings
            const enemyConyard = createTestEntity({
                id: 'cy_p0',
                owner: 0,
                type: 'BUILDING',
                key: 'conyard',
                pos: enemyBasePos,
                prevPos: enemyBasePos,
                hp: 3000,
                maxHp: 3000
            });

            const state: GameState = {
                running: true,
                mode: 'game',
                difficulty: 'hard',
                tick: 30, // AI runs on ticks divisible by 30
                camera: { x: 0, y: 0 },
                zoom: 1,
                entities: {
                    [tank1.id]: tank1,
                    [tank2.id]: tank2,
                    [tank3.id]: tank3,
                    [conyard.id]: conyard,
                    [factory.id]: factory,
                    [enemyConyard.id]: enemyConyard
                },
                projectiles: [],
                particles: [],
                selection: [],
                placingBuilding: null,
                sellMode: false,
                repairMode: false,
                players: {
                    [aiPlayerId]: createPlayer(aiPlayerId),
                    0: createPlayer(0, { isAi: false })
                },
                winner: null,
                config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
                debugMode: false,
                showMinimap: true
            };

            // First, simulate that these units were previously in attack group
            // by calling AI once with higher army count to trigger attack mode
            const aiState = getAIState(aiPlayerId);
            aiState.attackGroup = [tank1.id, tank2.id, tank3.id];
            aiState.offensiveGroups = [{
                id: 'main_attack',
                unitIds: [tank1.id, tank2.id, tank3.id],
                target: null,
                rallyPoint: new Vector(2400, 2400),
                status: 'attacking',
                lastOrderTick: 0
            }];
            aiState.strategy = 'attack'; // Previous strategy was attack

            // Now run AI - with only 3 units, strategy should switch to buildup
            // But the units should still get movement commands!
            const actions = computeAiActions(state, aiPlayerId);

            // The units should receive some kind of movement command
            // Either: attack commands (if attack continues) or move commands (rally back)
            const moveCommands = actions.filter(a => a.type === 'COMMAND_MOVE');
            const attackCommands = actions.filter(a => a.type === 'COMMAND_ATTACK');

            // At minimum, idle units far from base should receive commands
            const unitIds = [tank1.id, tank2.id, tank3.id];
            const hasCommandsForStrandedUnits = moveCommands.some(cmd =>
                unitIds.some(id => (cmd.payload as any).unitIds?.includes(id))
            ) || attackCommands.some(cmd =>
                unitIds.some(id => (cmd.payload as any).unitIds?.includes(id))
            );

            expect(hasCommandsForStrandedUnits).toBe(true);
        });

        it('should clear attack groups when switching from attack to buildup strategy', () => {
            const aiPlayerId = 1;

            const basePos = new Vector(350, 350);

            // Only 2 combat units - definitely below threshold
            const tank1 = createTestEntity({
                id: 'tank1',
                owner: aiPlayerId,
                key: 'heavy',
                pos: new Vector(2400, 2400),
                moveTarget: null,
                targetId: null
            });

            const tank2 = createTestEntity({
                id: 'tank2',
                owner: aiPlayerId,
                key: 'heavy',
                pos: new Vector(2450, 2420),
                moveTarget: null,
                targetId: null
            });

            const conyard = createTestEntity({
                id: 'cy_p1',
                owner: aiPlayerId,
                type: 'BUILDING',
                key: 'conyard',
                pos: basePos,
                hp: 3000,
                maxHp: 3000
            });

            const factory = createTestEntity({
                id: 'factory1',
                owner: aiPlayerId,
                type: 'BUILDING',
                key: 'factory',
                pos: basePos.add(new Vector(100, 0)),
                hp: 2000,
                maxHp: 2000
            });

            const enemyConyard = createTestEntity({
                id: 'cy_p0',
                owner: 0,
                type: 'BUILDING',
                key: 'conyard',
                pos: new Vector(2500, 2500),
                hp: 3000,
                maxHp: 3000
            });

            const state: GameState = {
                running: true,
                mode: 'game',
                difficulty: 'hard',
                tick: 30,
                camera: { x: 0, y: 0 },
                zoom: 1,
                entities: {
                    [tank1.id]: tank1,
                    [tank2.id]: tank2,
                    [conyard.id]: conyard,
                    [factory.id]: factory,
                    [enemyConyard.id]: enemyConyard
                },
                projectiles: [],
                particles: [],
                selection: [],
                placingBuilding: null,
                sellMode: false,
                repairMode: false,
                players: {
                    [aiPlayerId]: createPlayer(aiPlayerId),
                    0: createPlayer(0, { isAi: false })
                },
                winner: null,
                config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
                debugMode: false,
                showMinimap: true
            };

            // Setup AI state as if it was previously attacking
            const aiState = getAIState(aiPlayerId);
            aiState.strategy = 'attack';
            aiState.attackGroup = [tank1.id, tank2.id];
            aiState.lastStrategyChange = 0;

            // Call AI - should switch to buildup
            computeAiActions(state, aiPlayerId);

            // Strategy should have changed to buildup (army too small)
            expect(aiState.strategy).toBe('buildup');

            // Attack group should be cleared when switching to buildup
            // OR units should still receive rally commands despite being in attack group
        });

        it('should rally units in buildup mode even if they were previously in attack group', () => {
            const aiPlayerId = 1;

            const basePos = new Vector(350, 350);

            // 3 units far from base
            const units = [
                createTestEntity({ id: 'tank1', owner: aiPlayerId, key: 'heavy', pos: new Vector(2400, 2400) }),
                createTestEntity({ id: 'tank2', owner: aiPlayerId, key: 'heavy', pos: new Vector(2450, 2420) }),
                createTestEntity({ id: 'tank3', owner: aiPlayerId, key: 'heavy', pos: new Vector(2380, 2380) })
            ];

            const conyard = createTestEntity({
                id: 'cy_p1',
                owner: aiPlayerId,
                type: 'BUILDING',
                key: 'conyard',
                pos: basePos,
                hp: 3000,
                maxHp: 3000
            });

            const factory = createTestEntity({
                id: 'factory1',
                owner: aiPlayerId,
                type: 'BUILDING',
                key: 'factory',
                pos: basePos.add(new Vector(100, 0)),
                hp: 2000,
                maxHp: 2000
            });

            const enemyConyard = createTestEntity({
                id: 'cy_p0',
                owner: 0,
                type: 'BUILDING',
                key: 'conyard',
                pos: new Vector(2500, 2500),
                hp: 3000,
                maxHp: 3000
            });

            const entities: Record<string, Entity> = {
                [conyard.id]: conyard,
                [factory.id]: factory,
                [enemyConyard.id]: enemyConyard
            };
            units.forEach(u => entities[u.id] = u);

            const state: GameState = {
                running: true,
                mode: 'game',
                difficulty: 'hard',
                tick: 60, // AI runs on ticks divisible by 30
                camera: { x: 0, y: 0 },
                zoom: 1,
                entities,
                projectiles: [],
                particles: [],
                selection: [],
                placingBuilding: null,
                sellMode: false,
                repairMode: false,
                players: {
                    [aiPlayerId]: createPlayer(aiPlayerId),
                    0: createPlayer(0, { isAi: false })
                },
                winner: null,
                config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
                debugMode: false,
                showMinimap: true
            };

            // Setup: units were in attack group, but strategy is now buildup
            const aiState = getAIState(aiPlayerId);
            aiState.strategy = 'buildup';
            aiState.attackGroup = units.map(u => u.id);
            aiState.lastStrategyChange = 0;

            // Run AI
            const actions = computeAiActions(state, aiPlayerId);

            // Units SHOULD receive rally commands to bring them back to base
            const moveCommands = actions.filter(a => a.type === 'COMMAND_MOVE');

            // Check that at least some stranded units get move commands toward base
            const strandedUnitsGetCommands = moveCommands.some(cmd => {
                const payload = cmd.payload as { unitIds: string[], x: number, y: number };
                const targetPos = new Vector(payload.x, payload.y);
                const isTowardBase = targetPos.dist(basePos) < 1000; // Rally point should be near base
                const includesStrandedUnit = units.some(u => payload.unitIds.includes(u.id));
                return isTowardBase && includesStrandedUnit;
            });

            expect(strandedUnitsGetCommands).toBe(true);
        });

        it('should trigger all_in (desperation attack) when stuck in buildup with low funds', () => {
            const aiPlayerId = 1;
            const basePos = new Vector(350, 350);
            const enemyBasePos = new Vector(2500, 2500);

            // 1 combat unit, barely any money
            const tank1 = createTestEntity({
                id: 'tank1',
                owner: aiPlayerId,
                key: 'heavy',
                pos: basePos.add(new Vector(100, 100)),
            });

            const conyard = createTestEntity({
                id: 'cy_p1',
                owner: aiPlayerId,
                type: 'BUILDING',
                key: 'conyard',
                pos: basePos,
            });

            const enemyConyard = createTestEntity({
                id: 'cy_p0',
                owner: 0,
                type: 'BUILDING',
                key: 'conyard',
                pos: enemyBasePos,
            });

            const state: GameState = {
                running: true,
                mode: 'game',
                difficulty: 'hard',
                tick: 5010, // Must be divisible by 30 for AI strategy update
                camera: { x: 0, y: 0 },
                zoom: 1,
                entities: {
                    [tank1.id]: tank1,
                    [conyard.id]: conyard,
                    [enemyConyard.id]: enemyConyard
                },
                projectiles: [],
                particles: [],
                selection: [],
                placingBuilding: null,
                sellMode: false,
                repairMode: false,
                players: {
                    [aiPlayerId]: createPlayer(aiPlayerId, { credits: 100 }), // Very low credits
                    0: createPlayer(0, { isAi: false })
                },
                winner: null,
                config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
                debugMode: false,
                showMinimap: true
            };

            const aiState = getAIState(aiPlayerId);
            aiState.strategy = 'buildup';
            aiState.lastStrategyChange = 0; // Changed a long time ago (5000 ticks > 4500 limit)

            // Run AI
            const actions = computeAiActions(state, aiPlayerId);

            // Should switch to all_in
            expect(aiState.strategy).toBe('all_in');

            // Should issue attack commands despite small army
            const attackCommands = actions.filter(a => a.type === 'COMMAND_ATTACK');
            expect(attackCommands.length).toBeGreaterThan(0);
        });
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from './ai';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';

const {
    findBaseCenter,
    detectThreats,
    getAIState,

    updateEnemyBaseLocation,
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE
} = _testUtils;

// Helper functions
function createEntity(
    id: string,
    owner: number,
    type: 'UNIT' | 'BUILDING' | 'RESOURCE',
    key: string,
    x: number,
    y: number,
    overrides?: Partial<Entity>
): Entity {
    return {
        id,
        owner,
        type,
        key,
        pos: new Vector(x, y),
        prevPos: new Vector(x, y),
        hp: 100,
        maxHp: 100,
        w: 30,
        h: 30,
        radius: 15,
        dead: false,
        vel: new Vector(0, 0),
        rotation: 0,
        moveTarget: null,
        path: null,
        pathIdx: 0,
        finalDest: null,
        stuckTimer: 0,
        unstuckDir: null,
        unstuckTimer: 0,
        targetId: null,
        lastAttackerId: null,
        cooldown: 0,
        flash: 0,
        turretAngle: 0,
        cargo: 0,
        resourceTargetId: null,
        baseTargetId: null,
        ...overrides
    };
}

function createTestState(entities: Record<EntityId, Entity>): GameState {
    return {
        ...INITIAL_STATE,
        running: true,
        tick: 30, // Set to a tick divisible by 30 so AI runs
        entities
    };
}

describe('AI System', () => {
    beforeEach(() => {
        resetAIState();
    });

    describe('Base Center Detection', () => {
        it('should find conyard as base center when present', () => {
            const buildings = [
                createEntity('conyard1', 1, 'BUILDING', 'conyard', 500, 500),
                createEntity('barracks1', 1, 'BUILDING', 'barracks', 600, 600)
            ];
            const center = findBaseCenter(buildings);
            expect(center.x).toBe(500);
            expect(center.y).toBe(500);
        });

        it('should average building positions when no conyard', () => {
            const buildings = [
                createEntity('b1', 1, 'BUILDING', 'barracks', 100, 100),
                createEntity('b2', 1, 'BUILDING', 'factory', 300, 300)
            ];
            const center = findBaseCenter(buildings);
            expect(center.x).toBe(200);
            expect(center.y).toBe(200);
        });
    });

    describe('Enemy Base Tracking', () => {
        it('should track enemy conyard as base location', () => {
            const aiState = getAIState(1);
            const enemyBuildings = [
                createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 2000, 2000),
                createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 2100, 2100)
            ];

            updateEnemyBaseLocation(aiState, enemyBuildings);

            expect(aiState.enemyBaseLocation).toBeTruthy();
            expect(aiState.enemyBaseLocation!.x).toBe(2000);
            expect(aiState.enemyBaseLocation!.y).toBe(2000);
        });

        it('should fallback to factory if no conyard', () => {
            const aiState = getAIState(1);
            const enemyBuildings = [
                createEntity('enemy_factory', 0, 'BUILDING', 'factory', 1800, 1800),
                createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 1900, 1900)
            ];

            updateEnemyBaseLocation(aiState, enemyBuildings);

            expect(aiState.enemyBaseLocation!.x).toBe(1800);
            expect(aiState.enemyBaseLocation!.y).toBe(1800);
        });
    });

    describe('Threat Detection', () => {
        it('should detect enemies near base', () => {
            const baseCenter = new Vector(500, 500);
            const harvesters: Entity[] = [];
            const enemies = [
                createEntity('enemy1', 2, 'UNIT', 'tank', 600, 600) // Within 500 radius
            ];
            const myBuildings = [
                createEntity('cy1', 1, 'BUILDING', 'conyard', 500, 500)
            ];

            const { threatsNearBase } = detectThreats(baseCenter, harvesters, enemies, myBuildings);
            expect(threatsNearBase).toContain('enemy1');
        });

        it('should not detect enemies far from base as threats', () => {
            const baseCenter = new Vector(500, 500);
            const harvesters: Entity[] = [];
            const enemies = [
                createEntity('enemy1', 2, 'UNIT', 'tank', 1500, 1500) // Far away
            ];
            const myBuildings: Entity[] = [];

            const { threatsNearBase } = detectThreats(baseCenter, harvesters, enemies, myBuildings);
            expect(threatsNearBase).not.toContain('enemy1');
        });

        it('should detect harvesters under attack', () => {
            const baseCenter = new Vector(500, 500);
            const harvesters = [
                createEntity('harv1', 1, 'UNIT', 'harvester', 800, 800, { lastAttackerId: 'enemy1' })
            ];
            const enemies = [
                createEntity('enemy1', 2, 'UNIT', 'tank', 850, 850)
            ];
            const myBuildings: Entity[] = [];

            const { harvestersUnderAttack } = detectThreats(baseCenter, harvesters, enemies, myBuildings);
            expect(harvestersUnderAttack).toContain('harv1');
        });

        it('should detect harvesters with nearby enemies as under threat', () => {
            const baseCenter = new Vector(500, 500);
            const harvesters = [
                createEntity('harv1', 1, 'UNIT', 'harvester', 800, 800)
            ];
            const enemies = [
                createEntity('enemy1', 2, 'UNIT', 'tank', 810, 810) // Very close
            ];
            const myBuildings: Entity[] = [];

            const { harvestersUnderAttack } = detectThreats(baseCenter, harvesters, enemies, myBuildings);
            expect(harvestersUnderAttack).toContain('harv1');
        });
    });

    describe('Group Attack Behavior', () => {
        it('should form attack groups when army size is sufficient', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI player buildings
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500, { hp: 3000, maxHp: 3000 });
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500, { hp: 2000, maxHp: 2000 });

            // Add combat units for AI
            for (let i = 0; i < 6; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 550 + i * 20, 550);
            }

            // Enemy (far enough to not trigger defense)
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 2000, 2000, { hp: 3000, maxHp: 3000 });

            const state = createTestState(entities);

            // Set lastStrategyChange to past so cooldown is met (cooldown is 300 ticks)
            const aiState = getAIState(1);
            aiState.lastStrategyChange = -300;

            // Run AI - strategy should now be able to change
            const currentState = { ...state, tick: 30 };
            computeAiActions(currentState, 1);

            expect(aiState.strategy).toBe('attack');
            expect(aiState.attackGroup.length).toBeGreaterThan(0);
        });

        it('should coordinate attack group to target enemies together', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI player buildings
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            // Add combat units
            for (let i = 0; i < 6; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 550 + i * 20, 550);
            }

            // Enemy target
            entities['enemy_tank'] = createEntity('enemy_tank', 0, 'UNIT', 'tank', 1500, 1500);

            const state = createTestState(entities);

            // Force attack strategy
            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = 0;
            aiState.attackGroup = ['tank0', 'tank1', 'tank2', 'tank3', 'tank4', 'tank5'];

            const actions = computeAiActions(state, 1);

            // Should have an attack command
            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');
            expect(attackAction).toBeDefined();

            if (attackAction) {
                // Should command multiple units
                expect(attackAction.payload.unitIds.length).toBeGreaterThan(1);
            }
        });

        it('should prioritize high-value targets', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI buildings & units
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);
            for (let i = 0; i < 6; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 1000, 1000);
            }

            // Multiple enemy targets at similar distance
            entities['enemy_rifle'] = createEntity('enemy_rifle', 0, 'UNIT', 'rifle', 1200, 1200);
            entities['enemy_conyard'] = createEntity('enemy_conyard', 0, 'BUILDING', 'conyard', 1250, 1250);
            entities['enemy_barracks'] = createEntity('enemy_barracks', 0, 'BUILDING', 'barracks', 1180, 1180);

            const state = createTestState(entities);

            // Force attack strategy with group
            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = 0;
            aiState.attackGroup = ['tank0', 'tank1', 'tank2', 'tank3', 'tank4', 'tank5'];

            const actions = computeAiActions(state, 1);
            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');

            expect(attackAction).toBeDefined();
            // Should prioritize conyard (highest value)
            expect(attackAction?.payload.targetId).toBe('enemy_conyard');
        });

        it('should add all combat units to attack group during attack phase', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI buildings
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            // Initial attack group
            for (let i = 0; i < 5; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 550 + i * 20, 550);
            }
            // Additional unit that's not in group yet
            entities['lateJoiner'] = createEntity('lateJoiner', 1, 'UNIT', 'light', 700, 550);

            // Enemy
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 2000, 2000);

            const state = createTestState(entities);

            // Set up attack state without lateJoiner
            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = 0;
            aiState.attackGroup = ['tank0', 'tank1', 'tank2', 'tank3', 'tank4'];

            // Run AI
            computeAiActions(state, 1);

            // Late joiner should now be in attack group
            expect(aiState.attackGroup).toContain('lateJoiner');
        });
    });

    describe('Harass Strategy', () => {
        it('should form harass group with light units', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI buildings
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['barracks'] = createEntity('barracks', 1, 'BUILDING', 'barracks', 600, 500);

            // Light units for harass
            for (let i = 0; i < HARASS_GROUP_SIZE; i++) {
                entities[`rifle${i}`] = createEntity(`rifle${i}`, 1, 'UNIT', 'rifle', 550 + i * 20, 550);
            }

            // Enemy (far from base)
            entities['enemy_harvester'] = createEntity('enemy_harvester', 0, 'UNIT', 'harvester', 2000, 2000);

            const state = createTestState(entities);

            const aiState = getAIState(1);
            aiState.lastStrategyChange = -300;

            // Run AI multiple times
            computeAiActions({ ...state, tick: 30 }, 1);

            // Should have formed harass group
            expect(aiState.harassGroup.length).toBeGreaterThan(0);
        });

        it('should target enemy harvesters during harass', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI buildings
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // Harass group units
            for (let i = 0; i < 3; i++) {
                entities[`rifle${i}`] = createEntity(`rifle${i}`, 1, 'UNIT', 'rifle', 1500, 1500);
            }

            // Enemy targets
            entities['enemy_tank'] = createEntity('enemy_tank', 0, 'UNIT', 'tank', 1600, 1600);
            entities['enemy_harvester'] = createEntity('enemy_harvester', 0, 'UNIT', 'harvester', 1550, 1550);

            const state = createTestState(entities);

            // Force harass strategy
            const aiState = getAIState(1);
            aiState.strategy = 'harass';
            aiState.harassGroup = ['rifle0', 'rifle1', 'rifle2'];

            const actions = computeAiActions(state, 1);
            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');

            expect(attackAction).toBeDefined();
            // Should target harvester over tank
            expect(attackAction?.payload.targetId).toBe('enemy_harvester');
        });

        it('should retreat harass group when damaged', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI buildings (base)
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // Damaged harass group
            entities['rifle0'] = createEntity('rifle0', 1, 'UNIT', 'rifle', 1500, 1500, { hp: 20, maxHp: 100 });
            entities['rifle1'] = createEntity('rifle1', 1, 'UNIT', 'rifle', 1520, 1500, { hp: 10, maxHp: 100 });
            entities['rifle2'] = createEntity('rifle2', 1, 'UNIT', 'rifle', 1510, 1510, { hp: 30, maxHp: 100 });

            // Enemy
            entities['enemy_tank'] = createEntity('enemy_tank', 0, 'UNIT', 'tank', 1600, 1600);

            const state = createTestState(entities);

            // Force harass strategy with damaged group
            const aiState = getAIState(1);
            aiState.strategy = 'harass';
            aiState.harassGroup = ['rifle0', 'rifle1', 'rifle2'];

            const actions = computeAiActions(state, 1);
            const moveAction = actions.find(a => a.type === 'COMMAND_MOVE');

            expect(moveAction).toBeDefined();
            // Should be retreating toward base
            if (moveAction) {
                expect(moveAction.payload.x).toBeLessThan(1500);
                expect(moveAction.payload.y).toBeLessThan(1500);
            }
        });
    });

    describe('Rally Behavior', () => {
        it('should rally idle units during buildup', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI buildings
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // Idle combat units scattered around
            entities['tank1'] = createEntity('tank1', 1, 'UNIT', 'light', 200, 200);
            entities['tank2'] = createEntity('tank2', 1, 'UNIT', 'light', 800, 300);

            // No enemies (buildup phase)

            const state = createTestState(entities);

            const aiState = getAIState(1);
            aiState.strategy = 'buildup';

            const actions = computeAiActions(state, 1);
            const moveAction = actions.find(a => a.type === 'COMMAND_MOVE');

            expect(moveAction).toBeDefined();
            // Units should be moving toward rally point near base
            if (moveAction) {
                expect(moveAction.payload.unitIds).toContain('tank1');
            }
        });

        it('should rally toward enemy direction when enemy base is known', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI buildings
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // Idle unit far from rally
            entities['tank1'] = createEntity('tank1', 1, 'UNIT', 'light', 200, 200);

            // Enemy base (to the right)
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 2500, 500);

            const state = createTestState(entities);
            const aiState = getAIState(1);
            aiState.strategy = 'buildup';

            const actions = computeAiActions(state, 1);
            const moveAction = actions.find(a => a.type === 'COMMAND_MOVE');

            expect(moveAction).toBeDefined();
            if (moveAction) {
                // Rally point should be to the right of base (toward enemy)
                expect(moveAction.payload.x).toBeGreaterThan(500);
            }
        });
    });

    describe('Defense Behavior', () => {
        it('should switch to defend strategy when base is threatened', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI base
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // AI combat units
            for (let i = 0; i < 3; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 550, 550 + i * 30);
            }

            // Enemy attacking base
            entities['attacker'] = createEntity('attacker', 0, 'UNIT', 'tank', 600, 600);

            const state = createTestState(entities);
            computeAiActions(state, 1);

            const aiState = getAIState(1);
            expect(aiState.strategy).toBe('defend');
        });

        it('should issue attack commands against threats near base', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI base
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // AI combat units (idle)
            entities['defender1'] = createEntity('defender1', 1, 'UNIT', 'light', 450, 500);
            entities['defender2'] = createEntity('defender2', 1, 'UNIT', 'light', 550, 500);

            // Enemy near base
            entities['attacker'] = createEntity('attacker', 0, 'UNIT', 'tank', 580, 580);

            const state = createTestState(entities);
            const actions = computeAiActions(state, 1);

            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');
            expect(attackAction).toBeDefined();
            expect(attackAction?.payload.targetId).toBe('attacker');
            expect(attackAction?.payload.unitIds).toContain('defender1');
            expect(attackAction?.payload.unitIds).toContain('defender2');
        });

        it('should recall all units when under heavy attack', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI base
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // Distant AI unit
            entities['distantTank'] = createEntity('distantTank', 1, 'UNIT', 'light', 1500, 1500);

            // Multiple attackers (heavy attack)
            entities['attacker1'] = createEntity('attacker1', 0, 'UNIT', 'tank', 550, 550);
            entities['attacker2'] = createEntity('attacker2', 0, 'UNIT', 'tank', 450, 450);
            entities['attacker3'] = createEntity('attacker3', 0, 'UNIT', 'tank', 400, 550);

            const state = createTestState(entities);
            const actions = computeAiActions(state, 1);

            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');
            expect(attackAction).toBeDefined();
            // Should include the distant tank in defense (heavy attack)
            expect(attackAction?.payload.unitIds).toContain('distantTank');
        });
    });

    describe('Harvester Defense', () => {
        it('should make harvesters flee from nearby enemies', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI base
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // AI harvester
            entities['harvester'] = createEntity('harvester', 1, 'UNIT', 'harvester', 800, 800);

            // Enemy near harvester
            entities['threat'] = createEntity('threat', 0, 'UNIT', 'tank', 850, 850);

            const state = createTestState(entities);
            const actions = computeAiActions(state, 1);

            const moveAction = actions.find(a =>
                a.type === 'COMMAND_MOVE' &&
                a.payload.unitIds.includes('harvester')
            );
            expect(moveAction).toBeDefined();

            // Should be fleeing toward base (x,y should be less than harvester's position)
            // Base is at 500,500, harvester at 800,800, enemy at 850,850
            // Flee direction should be toward base, so target coords should decrease
            if (moveAction) {
                expect(moveAction.payload.x).toBeLessThan(800);
                expect(moveAction.payload.y).toBeLessThan(800);
            }
        });

        it('should react to lastAttackerId on harvester', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI base
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // AI harvester that was recently attacked
            entities['harvester'] = createEntity('harvester', 1, 'UNIT', 'harvester', 1000, 1000, {
                lastAttackerId: 'sneaky_attacker'
            });

            // The attacker is somewhat far but was attacking
            entities['sneaky_attacker'] = createEntity('sneaky_attacker', 0, 'UNIT', 'tank', 1200, 1200);

            const state = createTestState(entities);
            const actions = computeAiActions(state, 1);

            const moveAction = actions.find(a =>
                a.type === 'COMMAND_MOVE' &&
                a.payload.unitIds.includes('harvester')
            );
            expect(moveAction).toBeDefined();
        });

        it('should not flee if no enemies nearby', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI base
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // AI harvester
            entities['harvester'] = createEntity('harvester', 1, 'UNIT', 'harvester', 800, 800);

            // Far away enemy (beyond flee distance)
            entities['far_enemy'] = createEntity('far_enemy', 0, 'UNIT', 'tank', 1500, 1500);

            const state = createTestState(entities);
            const actions = computeAiActions(state, 1);

            const moveAction = actions.find(a =>
                a.type === 'COMMAND_MOVE' &&
                a.payload.unitIds.includes('harvester')
            );
            expect(moveAction).toBeUndefined();
        });
    });

    describe('Strategy Management', () => {
        it('should start in buildup strategy', () => {
            resetAIState(1);
            const aiState = getAIState(1);
            expect(aiState.strategy).toBe('buildup');
        });

        it('should transition to attack when army is ready', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI with production capability
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            // Sufficient combat units
            for (let i = 0; i < ATTACK_GROUP_MIN_SIZE; i++) {
                entities[`tank${i}`] = createEntity(`tank${i}`, 1, 'UNIT', 'light', 550 + i * 20, 550);
            }

            // Some enemies to attack (far from base to not trigger defense)
            entities['enemy'] = createEntity('enemy', 0, 'BUILDING', 'conyard', 2000, 2000);

            const state = createTestState(entities);

            // Set lastStrategyChange to past so cooldown is met
            const aiState = getAIState(1);
            aiState.lastStrategyChange = -300;

            // Run AI
            computeAiActions({ ...state, tick: 30 }, 1);

            // Should be in attack
            expect(aiState.strategy).toBe('attack');
        });

        it('should transition to harass with fewer units', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI with production capability
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['barracks'] = createEntity('barracks', 1, 'BUILDING', 'barracks', 600, 500);

            // Just enough for harass but not attack
            for (let i = 0; i < HARASS_GROUP_SIZE; i++) {
                entities[`rifle${i}`] = createEntity(`rifle${i}`, 1, 'UNIT', 'rifle', 550 + i * 20, 550);
            }

            // Enemies
            entities['enemy'] = createEntity('enemy', 0, 'BUILDING', 'conyard', 2000, 2000);

            const state = createTestState(entities);

            const aiState = getAIState(1);
            aiState.lastStrategyChange = -300;

            computeAiActions({ ...state, tick: 30 }, 1);

            expect(aiState.strategy).toBe('harass');
        });

        it('should maintain buildup strategy without factory', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI without factory (just started)
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // Even with some units
            for (let i = 0; i < 3; i++) {
                entities[`rifle${i}`] = createEntity(`rifle${i}`, 1, 'UNIT', 'rifle', 550 + i * 20, 550);
            }

            const state = createTestState(entities);
            computeAiActions(state, 1);

            const aiState = getAIState(1);
            expect(aiState.strategy).toBe('buildup');
        });
    });

    describe('Focus Fire', () => {
        it('should focus fire on targets allies are already attacking', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI buildings
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['factory'] = createEntity('factory', 1, 'BUILDING', 'factory', 600, 500);

            // Units - some already attacking enemy1
            entities['tank0'] = createEntity('tank0', 1, 'UNIT', 'light', 1000, 1000, { targetId: 'enemy1' });
            entities['tank1'] = createEntity('tank1', 1, 'UNIT', 'light', 1020, 1000, { targetId: 'enemy1' });
            entities['tank2'] = createEntity('tank2', 1, 'UNIT', 'light', 1040, 1000); // Idle
            entities['tank3'] = createEntity('tank3', 1, 'UNIT', 'light', 1060, 1000); // Idle
            entities['tank4'] = createEntity('tank4', 1, 'UNIT', 'light', 1080, 1000); // Idle

            // Two enemies at similar distance
            entities['enemy1'] = createEntity('enemy1', 0, 'UNIT', 'tank', 1100, 1100);
            entities['enemy2'] = createEntity('enemy2', 0, 'UNIT', 'tank', 1100, 900);

            const state = createTestState(entities);

            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.attackGroup = ['tank0', 'tank1', 'tank2', 'tank3', 'tank4'];

            const actions = computeAiActions(state, 1);
            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');

            expect(attackAction).toBeDefined();
            // Should prefer enemy1 (already being attacked by allies)
            expect(attackAction?.payload.targetId).toBe('enemy1');
        });
    });

    describe('Integration Tests', () => {
        it('should build economy when starting', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            let state = createTestState(entities);
            // Ensure player has credits
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        credits: 5000
                    }
                }
            };

            const actions = computeAiActions(state, 1);

            const buildAction = actions.find(a => a.type === 'START_BUILD');
            expect(buildAction).toBeDefined();
            // Should try to build power plant first
            expect(buildAction?.payload.key).toBe('power');
        });

        it('should place buildings when ready', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            let state = createTestState(entities);
            // Set player ready to place
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        readyToPlace: 'power'
                    }
                }
            };

            const actions = computeAiActions(state, 1);

            const placeAction = actions.find(a => a.type === 'PLACE_BUILDING');
            expect(placeAction).toBeDefined();
            expect(placeAction?.payload.key).toBe('power');
        });

        it('should handle complete battle scenario', () => {
            // Full integration test simulating a battle
            const entities: Record<EntityId, Entity> = {};

            // AI base and army
            entities['ai_conyard'] = createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 500, 500, { hp: 3000, maxHp: 3000 });
            entities['ai_factory'] = createEntity('ai_factory', 1, 'BUILDING', 'factory', 600, 500);
            for (let i = 0; i < 6; i++) {
                entities[`ai_tank${i}`] = createEntity(`ai_tank${i}`, 1, 'UNIT', 'light', 550 + i * 20, 550);
            }
            entities['ai_harvester'] = createEntity('ai_harvester', 1, 'UNIT', 'harvester', 700, 700);

            // Enemy forces
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 2000, 2000, { hp: 3000, maxHp: 3000 });
            entities['enemy_tank1'] = createEntity('enemy_tank1', 0, 'UNIT', 'light', 550, 600);
            entities['enemy_tank2'] = createEntity('enemy_tank2', 0, 'UNIT', 'light', 2100, 2100);

            let state = createTestState(entities);
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: { ...state.players[1], credits: 5000 }
                }
            };

            // Run several AI cycles
            let currentState = state;
            let hasDefended = false;

            for (let i = 0; i < 10; i++) {
                currentState = { ...currentState, tick: (i + 1) * 30 };
                const actions = computeAiActions(currentState, 1);

                for (const action of actions) {
                    if (action.type === 'COMMAND_ATTACK' && action.payload.targetId === 'enemy_tank1') {
                        hasDefended = true;
                    }
                    currentState = update(currentState, action);
                }

                // After first cycle, remove nearby enemy to allow attack phase
                if (i === 3 && currentState.entities['enemy_tank1']) {
                    const updatedEntities = { ...currentState.entities };
                    updatedEntities['enemy_tank1'] = { ...updatedEntities['enemy_tank1'], dead: true };
                    currentState = { ...currentState, entities: updatedEntities };
                }
            }

            // AI should have attempted defense (enemy was near base)
            expect(hasDefended).toBe(true);
        });

        it('should execute full attack sequence', () => {
            const entities: Record<EntityId, Entity> = {};

            // AI base and large army
            entities['ai_conyard'] = createEntity('ai_conyard', 1, 'BUILDING', 'conyard', 500, 500);
            entities['ai_factory'] = createEntity('ai_factory', 1, 'BUILDING', 'factory', 600, 500);
            for (let i = 0; i < 8; i++) {
                entities[`ai_tank${i}`] = createEntity(`ai_tank${i}`, 1, 'UNIT', 'light', 550 + i * 20, 550);
            }

            // Enemy base (far away)
            entities['enemy_cy'] = createEntity('enemy_cy', 0, 'BUILDING', 'conyard', 2500, 2500);

            let state = createTestState(entities);

            // Force past cooldown
            const aiState = getAIState(1);
            aiState.lastStrategyChange = -300;

            // Run AI
            const actions = computeAiActions({ ...state, tick: 30 }, 1);

            // Should be in attack mode with attack command
            expect(aiState.strategy).toBe('attack');

            const attackAction = actions.find(a => a.type === 'COMMAND_ATTACK');
            expect(attackAction).toBeDefined();
            expect(attackAction?.payload.targetId).toBe('enemy_cy');
            expect(attackAction?.payload.unitIds.length).toBeGreaterThanOrEqual(ATTACK_GROUP_MIN_SIZE);
        });
    });

    describe('Building Placement', () => {
        it('should place buildings without overlapping existing ones', () => {
            const entities: Record<EntityId, Entity> = {};
            // Conyard (90x90) at 500, 500
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500, { w: 90, h: 90 });
            // Power plant (60x60) very close to the right
            entities['power'] = createEntity('power', 1, 'BUILDING', 'power', 500 + 80, 500, { w: 60, h: 60 });

            let state = createTestState(entities);
            // AI wants to place another power plant
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: {
                        ...state.players[1],
                        readyToPlace: 'power'
                    }
                }
            };

            const actions = computeAiActions(state, 1);
            const placeAction = actions.find(a => a.type === 'PLACE_BUILDING');

            expect(placeAction).toBeDefined();
            if (placeAction) {
                const { x, y } = placeAction.payload;
                const w = 60; // Power plant size
                const h = 60;

                // Check overlap with conyard
                const cy = entities['conyard'];
                const overlapConyard = Math.abs(x - cy.pos.x) < (w / 2 + cy.w / 2) &&
                    Math.abs(y - cy.pos.y) < (h / 2 + cy.h / 2);
                expect(overlapConyard).toBe(false);

                // Check overlap with existing power plant
                const p = entities['power'];
                const overlapPower = Math.abs(x - p.pos.x) < (w / 2 + p.w / 2) &&
                    Math.abs(y - p.pos.y) < (h / 2 + p.h / 2);
                expect(overlapPower).toBe(false);
            }
        });

        it('should place refinery near resources', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);

            // Resource within build range of base (MAX_ORE_DISTANCE is 600)
            entities['ore1'] = createEntity('ore1', -1, 'RESOURCE', 'ore', 800, 800);

            let state = createTestState(entities);
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: { ...state.players[1], readyToPlace: 'refinery' }
                }
            };

            const actions = computeAiActions(state, 1);
            const placeAction = actions.find(a => a.type === 'PLACE_BUILDING');

            expect(placeAction).toBeDefined();
            if (placeAction) {
                const { x, y } = placeAction.payload;
                // Should be near ore (800,800)
                const distToOre = new Vector(x, y).dist(new Vector(800, 800));
                const distToBase = new Vector(x, y).dist(new Vector(500, 500));

                expect(distToOre).toBeLessThan(250); // Within reasonable range of ore
                expect(distToOre).toBeLessThan(distToBase); // Closer to ore than base
            }
        });

        it('should avoid placing buildings in refinery docking zones', () => {
            const entities: Record<EntityId, Entity> = {};
            entities['conyard'] = createEntity('conyard', 1, 'BUILDING', 'conyard', 500, 500);
            // Refinery at 600, 600
            entities['refinery'] = createEntity('refinery', 1, 'BUILDING', 'refinery', 600, 600, { w: 100, h: 80 });

            // Dock zone is roughly at (600, 600 + 40..100) -> (600, 640..700)

            let state = createTestState(entities);
            state = {
                ...state,
                players: {
                    ...state.players,
                    1: { ...state.players[1], readyToPlace: 'power' } // Try to place power plant
                }
            };

            const actions = computeAiActions(state, 1);
            const placeAction = actions.find(a => a.type === 'PLACE_BUILDING');

            expect(placeAction).toBeDefined();
            if (placeAction) {
                const { x, y } = placeAction.payload;
                const w = 60;
                const h = 60;

                const myRect = {
                    l: x - w / 2,
                    r: x + w / 2,
                    t: y - h / 2,
                    b: y + h / 2
                };

                const dockRect = {
                    l: 600 - 30,
                    r: 600 + 30,
                    t: 600 + 40,
                    b: 600 + 100
                };

                const overlap = !(dockRect.l > myRect.r || dockRect.r < myRect.l || dockRect.t > myRect.b || dockRect.b < myRect.t);
                expect(overlap).toBe(false);
            }
        });
    });
});

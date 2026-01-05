import { describe, it, expect, beforeEach } from 'vitest';
import { computeAiActions, resetAIState, _testUtils } from '../../src/engine/ai/index.js';
import { handleAirStrikes } from '../../src/engine/ai/action_combat.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { GameState, Entity, EntityId, AirUnit, isActionType } from '../../src/engine/types';
import {
    createTestHarrier,
    createTestAirforceCommand,
    createTestBuilding,
    createTestCombatUnit,
    createTestHarvester,
    createTestResource,
    resetTestEntityCounter
} from '../../src/engine/test-utils';

const { getAIState, setPersonalityForPlayer } = _testUtils;

// Helper to create test state
function createTestState(entities: Record<EntityId, Entity>, aiCredits: number = 5000): GameState {
    return {
        ...INITIAL_STATE,
        tick: 100,
        entities,
        players: {
            0: { ...createPlayerState(0, false, 'medium', '#0088FF'), credits: 5000 },
            1: { ...createPlayerState(1, true, 'medium', '#FFCC00'), credits: aiCredits }
        }
    };
}

describe('AI Air Strikes', () => {
    beforeEach(() => {
        resetTestEntityCounter();
        resetAIState();
        setPersonalityForPlayer(1, 'balanced');
    });

    describe('handleAirStrikes', () => {
        it('should launch harrier at enemy harvester (high priority target)', () => {
            const airBase = createTestAirforceCommand({
                id: 'base1',
                owner: 1,
                x: 300,
                y: 300,
                slots: ['harrier1', null, null, null, null, null]
            });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 1,
                x: 300,
                y: 300,
                state: 'docked',
                homeBaseId: 'base1',
                dockedSlot: 0,
                ammo: 1
            });
            const enemyHarvester = createTestHarvester({
                id: 'enemy_harv',
                owner: 0,
                x: 800,
                y: 800
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                enemy_harv: enemyHarvester
            };

            const state = createTestState(entities);
            const aiState = getAIState(1);
            aiState.enemyBaseLocation = null;

            const enemies = [enemyHarvester];
            const actions = handleAirStrikes(state, 1, enemies, aiState);

            // Should launch harrier at harvester
            expect(actions.length).toBe(1);
            const action = actions[0];
            expect(isActionType(action, 'COMMAND_ATTACK')).toBe(true);
            if (isActionType(action, 'COMMAND_ATTACK')) {
                expect(action.payload.unitIds).toContain('harrier1');
                expect(action.payload.targetId).toBe('enemy_harv');
            }
        });

        it('should prioritize harvesters over buildings', () => {
            const airBase = createTestAirforceCommand({
                id: 'base1',
                owner: 1,
                x: 300,
                y: 300,
                slots: ['harrier1', null, null, null, null, null]
            });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 1,
                x: 300,
                y: 300,
                state: 'docked',
                homeBaseId: 'base1',
                dockedSlot: 0,
                ammo: 1
            });
            const enemyHarvester = createTestHarvester({
                id: 'enemy_harv',
                owner: 0,
                x: 800,
                y: 800
            });
            const enemyFactory = createTestBuilding({
                id: 'enemy_factory',
                owner: 0,
                key: 'factory',
                x: 900,
                y: 900
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                enemy_harv: enemyHarvester,
                enemy_factory: enemyFactory
            };

            const state = createTestState(entities);
            const aiState = getAIState(1);
            aiState.enemyBaseLocation = null;

            const enemies = [enemyHarvester, enemyFactory];
            const actions = handleAirStrikes(state, 1, enemies, aiState);

            // Should target harvester (higher priority)
            const action = actions[0];
            if (isActionType(action, 'COMMAND_ATTACK')) {
                expect(action.payload.targetId).toBe('enemy_harv');
            }
        });

        it('should not launch harrier without ammo', () => {
            const airBase = createTestAirforceCommand({
                id: 'base1',
                owner: 1,
                x: 300,
                y: 300,
                slots: ['harrier1', null, null, null, null, null]
            });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 1,
                x: 300,
                y: 300,
                state: 'docked',
                homeBaseId: 'base1',
                dockedSlot: 0,
                ammo: 0 // No ammo
            });
            const enemyHarvester = createTestHarvester({
                id: 'enemy_harv',
                owner: 0,
                x: 800,
                y: 800
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                enemy_harv: enemyHarvester
            };

            const state = createTestState(entities);
            const aiState = getAIState(1);

            const enemies = [enemyHarvester];
            const actions = handleAirStrikes(state, 1, enemies, aiState);

            // Should not launch (no ammo)
            expect(actions.length).toBe(0);
        });

        it('should not launch harrier that is already flying', () => {
            const airBase = createTestAirforceCommand({
                id: 'base1',
                owner: 1,
                x: 300,
                y: 300,
                slots: [null, null, null, null, null, null]
            });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 1,
                x: 500,
                y: 500,
                state: 'flying', // Already flying
                homeBaseId: 'base1',
                ammo: 1
            });
            const enemyHarvester = createTestHarvester({
                id: 'enemy_harv',
                owner: 0,
                x: 800,
                y: 800
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                enemy_harv: enemyHarvester
            };

            const state = createTestState(entities);
            const aiState = getAIState(1);

            const enemies = [enemyHarvester];
            const actions = handleAirStrikes(state, 1, enemies, aiState);

            // Should not launch (already flying)
            expect(actions.length).toBe(0);
        });

        it('should avoid targets near SAM sites', () => {
            const airBase = createTestAirforceCommand({
                id: 'base1',
                owner: 1,
                x: 300,
                y: 300,
                slots: ['harrier1', null, null, null, null, null]
            });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 1,
                x: 300,
                y: 300,
                state: 'docked',
                homeBaseId: 'base1',
                dockedSlot: 0,
                ammo: 1
            });
            const enemyHarvester = createTestHarvester({
                id: 'enemy_harv',
                owner: 0,
                x: 800,
                y: 800
            });
            const samSite = createTestBuilding({
                id: 'sam1',
                owner: 0,
                key: 'sam_site',
                x: 850,
                y: 850 // Near harvester
            });
            const safeFactory = createTestBuilding({
                id: 'enemy_factory',
                owner: 0,
                key: 'factory',
                x: 2000,
                y: 2000 // Far from SAM
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                enemy_harv: enemyHarvester,
                sam1: samSite,
                enemy_factory: safeFactory
            };

            const state = createTestState(entities);
            const aiState = getAIState(1);

            const enemies = [enemyHarvester, samSite, safeFactory];
            const actions = handleAirStrikes(state, 1, enemies, aiState);

            // Should prefer factory over harvester (harvester near SAM)
            expect(actions.length).toBe(1);
            const action = actions[0];
            if (isActionType(action, 'COMMAND_ATTACK')) {
                expect(action.payload.targetId).toBe('enemy_factory');
            }
        });

        it('should prefer low HP targets for finishing off', () => {
            const airBase = createTestAirforceCommand({
                id: 'base1',
                owner: 1,
                x: 300,
                y: 300,
                slots: ['harrier1', null, null, null, null, null]
            });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 1,
                x: 300,
                y: 300,
                state: 'docked',
                homeBaseId: 'base1',
                dockedSlot: 0,
                ammo: 1
            });
            const fullHpFactory = createTestBuilding({
                id: 'factory1',
                owner: 0,
                key: 'factory',
                x: 800,
                y: 800,
                hp: 2000,
                maxHp: 2000
            });
            const lowHpFactory = createTestBuilding({
                id: 'factory2',
                owner: 0,
                key: 'factory',
                x: 900,
                y: 900,
                hp: 200, // Low HP
                maxHp: 2000
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                factory1: fullHpFactory,
                factory2: lowHpFactory
            };

            const state = createTestState(entities);
            const aiState = getAIState(1);

            const enemies = [fullHpFactory, lowHpFactory];
            const actions = handleAirStrikes(state, 1, enemies, aiState);

            // Should target low HP factory
            const action = actions[0];
            if (isActionType(action, 'COMMAND_ATTACK')) {
                expect(action.payload.targetId).toBe('factory2');
            }
        });
    });

    describe('AI Integration', () => {
        it('should produce harriers when airforce_command available and wealthy', () => {
            const entities: Record<EntityId, Entity> = {
                conyard: createTestBuilding({ id: 'conyard', owner: 1, key: 'conyard', x: 300, y: 300 }),
                power: createTestBuilding({ id: 'power', owner: 1, key: 'power', x: 350, y: 300 }),
                barracks: createTestBuilding({ id: 'barracks', owner: 1, key: 'barracks', x: 400, y: 300 }),
                factory: createTestBuilding({ id: 'factory', owner: 1, key: 'factory', x: 450, y: 300 }),
                refinery: createTestBuilding({ id: 'refinery', owner: 1, key: 'refinery', x: 500, y: 300 }),
                airforce: createTestAirforceCommand({ id: 'airforce', owner: 1, x: 550, y: 300 }),
                harv1: createTestHarvester({ id: 'harv1', owner: 1, x: 400, y: 400 }),
                harv2: createTestHarvester({ id: 'harv2', owner: 1, x: 420, y: 400 }),
                harv3: createTestHarvester({ id: 'harv3', owner: 1, x: 440, y: 400 }),
                ore: createTestResource({ id: 'ore', x: 500, y: 400 }),
                enemy_conyard: createTestBuilding({ id: 'enemy_conyard', owner: 0, key: 'conyard', x: 2000, y: 2000 })
            };

            // High credits to trigger harrier production
            const state = createTestState(entities, 8000);

            // Reset AI state and set low threat level to avoid panic mode
            const aiState = getAIState(1);
            aiState.threatLevel = 0;
            aiState.strategy = 'buildup';

            const actions = computeAiActions(state, 1);

            // Should consider building harrier
            const airBuildAction = actions.find(a =>
                a.type === 'START_BUILD' &&
                a.payload.category === 'air' &&
                a.payload.key === 'harrier'
            );

            expect(airBuildAction).toBeDefined();
        });

        it('should build airforce_command when very wealthy and maxed on other production', () => {
            const entities: Record<EntityId, Entity> = {
                conyard: createTestBuilding({ id: 'conyard', owner: 1, key: 'conyard', x: 300, y: 300 }),
                power1: createTestBuilding({ id: 'power1', owner: 1, key: 'power', x: 350, y: 300 }),
                power2: createTestBuilding({ id: 'power2', owner: 1, key: 'power', x: 350, y: 400 }),
                barracks1: createTestBuilding({ id: 'barracks1', owner: 1, key: 'barracks', x: 400, y: 300 }),
                barracks2: createTestBuilding({ id: 'barracks2', owner: 1, key: 'barracks', x: 400, y: 350 }),
                barracks3: createTestBuilding({ id: 'barracks3', owner: 1, key: 'barracks', x: 400, y: 400 }),
                factory1: createTestBuilding({ id: 'factory1', owner: 1, key: 'factory', x: 450, y: 300 }),
                factory2: createTestBuilding({ id: 'factory2', owner: 1, key: 'factory', x: 450, y: 400 }),
                factory3: createTestBuilding({ id: 'factory3', owner: 1, key: 'factory', x: 450, y: 500 }),
                refinery: createTestBuilding({ id: 'refinery', owner: 1, key: 'refinery', x: 550, y: 300 }),
                harv1: createTestHarvester({ id: 'harv1', owner: 1, x: 400, y: 500 }),
                harv2: createTestHarvester({ id: 'harv2', owner: 1, x: 420, y: 500 }),
                harv3: createTestHarvester({ id: 'harv3', owner: 1, x: 440, y: 500 }),
                ore: createTestResource({ id: 'ore', x: 500, y: 500 }),
                enemy_conyard: createTestBuilding({ id: 'enemy_conyard', owner: 0, key: 'conyard', x: 2000, y: 2000 })
            };

            // Very high credits for surplus building
            const state = createTestState(entities, 12000);

            // Reset AI state and set low threat level
            const aiState = getAIState(1);
            aiState.threatLevel = 0;
            aiState.strategy = 'buildup';

            const actions = computeAiActions(state, 1);

            // Should consider building airforce_command
            const airforceBuildAction = actions.find(a =>
                a.type === 'START_BUILD' &&
                a.payload.category === 'building' &&
                a.payload.key === 'airforce_command'
            );

            expect(airforceBuildAction).toBeDefined();
        });

        it('should use handleAirStrikes during attack strategy', () => {
            const airBase = createTestAirforceCommand({
                id: 'airforce',
                owner: 1,
                x: 300,
                y: 300,
                slots: ['harrier1', null, null, null, null, null]
            });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 1,
                x: 300,
                y: 300,
                state: 'docked',
                homeBaseId: 'airforce',
                dockedSlot: 0,
                ammo: 1
            });
            const entities: Record<EntityId, Entity> = {
                conyard: createTestBuilding({ id: 'conyard', owner: 1, key: 'conyard', x: 300, y: 300 }),
                power: createTestBuilding({ id: 'power', owner: 1, key: 'power', x: 350, y: 300 }),
                barracks: createTestBuilding({ id: 'barracks', owner: 1, key: 'barracks', x: 400, y: 300 }),
                factory: createTestBuilding({ id: 'factory', owner: 1, key: 'factory', x: 300, y: 400 }),
                airforce: airBase,
                harrier1: harrier,
                // Combat units to reach attack threshold
                tank1: createTestCombatUnit({ id: 'tank1', owner: 1, key: 'heavy', x: 350, y: 400 }),
                tank2: createTestCombatUnit({ id: 'tank2', owner: 1, key: 'heavy', x: 370, y: 400 }),
                tank3: createTestCombatUnit({ id: 'tank3', owner: 1, key: 'heavy', x: 390, y: 400 }),
                tank4: createTestCombatUnit({ id: 'tank4', owner: 1, key: 'heavy', x: 410, y: 400 }),
                tank5: createTestCombatUnit({ id: 'tank5', owner: 1, key: 'heavy', x: 430, y: 400 }),
                harv1: createTestHarvester({ id: 'harv1', owner: 1, x: 400, y: 500 }),
                harv2: createTestHarvester({ id: 'harv2', owner: 1, x: 420, y: 500 }),
                // Enemy harvester (good target)
                enemy_harv: createTestHarvester({ id: 'enemy_harv', owner: 0, x: 800, y: 800 }),
                enemy_conyard: createTestBuilding({ id: 'enemy_conyard', owner: 0, key: 'conyard', x: 2000, y: 2000 })
            };

            const state = createTestState(entities, 5000);

            // Force attack strategy and low threat level
            const aiState = getAIState(1);
            aiState.strategy = 'attack';
            aiState.lastStrategyChange = -300;
            aiState.threatLevel = 0;

            const actions = computeAiActions(state, 1);

            // Should include air strike action
            const airStrikeAction = actions.find(a =>
                a.type === 'COMMAND_ATTACK' &&
                a.payload.unitIds?.includes('harrier1')
            );

            expect(airStrikeAction).toBeDefined();
        });
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { handleHarvesterSafety } from '../../src/engine/ai/action_combat';
import { createTestHarvester, createTestCombatUnit, createTestBuilding, addEntityToState } from '../../src/engine/test-utils';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { createEmptyComposition } from '../../src/engine/ai/counters';
import { type GameState, Vector, type HarvesterUnit } from '../../src/engine/types';
import { type AIPlayerState } from '../../src/engine/ai/types';
import { createInitialHarvesterAIState } from '../../src/engine/ai/harvester/types';

describe('Harvester Flee Bug', () => {
    let state: GameState;
    let aiState: AIPlayerState;

    beforeEach(() => {
        state = {
            ...INITIAL_STATE,
            tick: 100,
            players: {
                1: { ...createPlayerState(1, true), credits: 5000 },
                2: { ...createPlayerState(2, true), credits: 5000 }
            }
        };

        aiState = {
            personality: 'balanced',
            strategy: 'buildup',
            lastStrategyChange: 0,
            attackGroup: [],
            harassGroup: [],
            defenseGroup: [],
            threatsNearBase: [],
            harvestersUnderAttack: [],
            lastThreatDetectedTick: 0,
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
                dominantArmor: 'mixed',
                boomScores: {},
                composition: createEmptyComposition()
            },
            vengeanceScores: {},
            lastCombatTick: 0,
            stalemateDesperation: 0,
            allInStartTick: 0,
            isDoomed: false,
            harvesterAI: createInitialHarvesterAIState()
        };
    });

    it('should flee even when harvester has a moveTarget (moving to ore)', () => {
        // Create harvester that is MOVING toward ore (has moveTarget set)
        const harvester = createTestHarvester({
            id: 'harv1',
            owner: 1,
            x: 500,
            y: 500,
            // Harvester is moving to ore - this is the key condition that was causing the bug
            moveTarget: new Vector(600, 600),
            // Harvester is being directly attacked
            lastAttackerId: 'enemy1',
            lastDamageTick: state.tick - 5 // Recently damaged
        });

        state = addEntityToState(state, harvester);

        // Enemy tank very close and attacking
        const enemy = createTestCombatUnit({
            id: 'enemy1',
            owner: 2,
            key: 'heavy',
            x: 520,
            y: 520
        });
        state = addEntityToState(state, enemy);

        // Add refinery for harvester to flee to
        const refinery = createTestBuilding({
            id: 'ref1',
            owner: 1,
            key: 'refinery',
            x: 200,
            y: 200
        });
        state = addEntityToState(state, refinery);

        const baseCenter = new Vector(200, 200);
        const harvesters = [state.entities['harv1'] as HarvesterUnit];
        const combatUnits: any[] = [];
        const enemies = [state.entities['enemy1']];

        const actions = handleHarvesterSafety(
            state,
            1,
            harvesters,
            combatUnits,
            baseCenter,
            enemies,
            aiState,
            undefined,
            'hard'
        );

        // Should produce a flee action even though harvester has moveTarget
        expect(actions.length).toBeGreaterThan(0);
        expect(actions[0].type).toBe('COMMAND_MOVE');

        // The flee destination should NOT be the original ore target
        const moveAction = actions[0] as { type: string; payload: { x: number; y: number } };
        const fleeDest = new Vector(moveAction.payload.x, moveAction.payload.y);
        const oreDest = new Vector(600, 600);
        expect(fleeDest.dist(oreDest)).toBeGreaterThan(100);
    });

    it('should NOT flee if harvester has moveTarget but is not being attacked and enemy is far', () => {
        // Create harvester that is MOVING toward ore
        const harvester = createTestHarvester({
            id: 'harv1',
            owner: 1,
            x: 500,
            y: 500,
            // Harvester is moving to ore
            moveTarget: new Vector(600, 600),
            // NOT being attacked - no lastAttackerId, no recent damage
            lastAttackerId: null,
            lastDamageTick: undefined
        });

        state = addEntityToState(state, harvester);

        // Enemy far away (outside flee distance)
        const enemy = createTestCombatUnit({
            id: 'enemy1',
            owner: 2,
            key: 'heavy',
            x: 1000,
            y: 1000
        });
        state = addEntityToState(state, enemy);

        const baseCenter = new Vector(200, 200);
        const harvesters = [state.entities['harv1'] as HarvesterUnit];
        const combatUnits: any[] = [];
        const enemies = [state.entities['enemy1']];

        const actions = handleHarvesterSafety(
            state,
            1,
            harvesters,
            combatUnits,
            baseCenter,
            enemies,
            aiState,
            undefined,
            'hard'
        );

        // Should NOT produce flee action - enemy is far away and not attacking
        expect(actions.length).toBe(0);
    });

    it('should flee when enemy is very close even if harvester is moving', () => {
        // Create harvester that is moving
        const harvester = createTestHarvester({
            id: 'harv1',
            owner: 1,
            x: 500,
            y: 500,
            moveTarget: new Vector(600, 600)
        });

        state = addEntityToState(state, harvester);

        // Enemy very close but not directly attacking this harvester
        const enemy = createTestCombatUnit({
            id: 'enemy1',
            owner: 2,
            key: 'heavy',
            x: 510,
            y: 510 // Only 14 pixels away - within MINIMUM_SAFE_DISTANCE of 80
        });
        state = addEntityToState(state, enemy);

        // Add refinery
        const refinery = createTestBuilding({
            id: 'ref1',
            owner: 1,
            key: 'refinery',
            x: 200,
            y: 200
        });
        state = addEntityToState(state, refinery);

        const baseCenter = new Vector(200, 200);
        const harvesters = [state.entities['harv1'] as HarvesterUnit];
        const combatUnits: any[] = [];
        const enemies = [state.entities['enemy1']];

        const actions = handleHarvesterSafety(
            state,
            1,
            harvesters,
            combatUnits,
            baseCenter,
            enemies,
            aiState,
            undefined,
            'hard'
        );

        // Should flee - enemy is dangerously close
        expect(actions.length).toBeGreaterThan(0);
        expect(actions[0].type).toBe('COMMAND_MOVE');
    });
});

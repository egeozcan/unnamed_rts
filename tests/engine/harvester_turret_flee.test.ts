import { describe, it, expect } from 'vitest';
import { handleHarvesterSafety } from '../../src/engine/ai/action_combat';
import { createTestHarvester, createTestBuilding, addEntityToState } from '../../src/engine/test-utils';
import { INITIAL_STATE } from '../../src/engine/reducer';
import { GameState, Vector, HarvesterUnit } from '../../src/engine/types';
import { AIPlayerState } from '../../src/engine/ai/types';
import { createInitialHarvesterAIState } from '../../src/engine/ai/harvester/types';

describe('Harvester Turret Flee - game_state_tick_10424', () => {
    it('should flee when being attacked by enemy turret with low HP', () => {
        // Recreate exact scenario from game_state_tick_10424
        let state: GameState = { ...INITIAL_STATE, tick: 10424 };
        state.players = {
            1: { credits: 5000, power: 100, powerUsed: 50, queues: {} as any },
            6: { credits: 18603, power: 0, powerUsed: 0, queues: {} as any }
        };

        // Harvester harv_p6 - low HP, being attacked by turret
        const harvester = createTestHarvester({
            id: 'harv_p6',
            owner: 6,
            x: 2303,
            y: 1558
        }) as HarvesterUnit;

        // Set exact state from file
        harvester.hp = 298;  // 29.8% HP - low!
        harvester.maxHp = 1000;
        harvester.movement.vel = new Vector(0, 0);  // Not moving
        harvester.movement.moveTarget = null;
        harvester.combat.lastAttackerId = 'turret1';
        harvester.combat.lastDamageTick = 10411;  // 13 ticks ago
        harvester.harvester.cargo = 50;

        state = addEntityToState(state, harvester);

        // Enemy turret that's attacking the harvester
        const turret = createTestBuilding({
            id: 'turret1',
            owner: 1,
            key: 'turret',
            x: 2305,
            y: 1747  // About 189 pixels away
        });
        turret.combat = {
            targetId: 'harv_p6',
            cooldown: 19,
            flash: 0,
            turretAngle: 0
        };
        state = addEntityToState(state, turret);

        // Add a refinery for player 6 to flee to
        const refinery = createTestBuilding({
            id: 'ref6',
            owner: 6,
            key: 'refinery',
            x: 2450,
            y: 796
        });
        state = addEntityToState(state, refinery);

        const aiState: AIPlayerState = {
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
                dominantArmor: 'mixed'
            },
            vengeanceScores: {},
            lastCombatTick: 0,
            stalemateDesperation: 0,
            allInStartTick: 0,
            isDoomed: false,
            harvesterAI: createInitialHarvesterAIState()
        };

        const baseCenter = new Vector(2450, 796);
        const harvesters = [state.entities['harv_p6'] as HarvesterUnit];
        const combatUnits: any[] = [];
        const enemies = [state.entities['turret1']];

        console.log('Harvester state:', {
            hp: harvesters[0].hp,
            maxHp: harvesters[0].maxHp,
            hpPercent: (harvesters[0].hp / harvesters[0].maxHp * 100).toFixed(1) + '%',
            lastDamageTick: harvesters[0].combat.lastDamageTick,
            ticksSinceDamage: state.tick - (harvesters[0].combat.lastDamageTick || 0),
            lastAttackerId: harvesters[0].combat.lastAttackerId,
            moveTarget: harvesters[0].movement.moveTarget
        });

        const actions = handleHarvesterSafety(
            state,
            6,  // Player 6
            harvesters,
            combatUnits,
            baseCenter,
            enemies,
            aiState,
            undefined,
            'hard'
        );

        console.log('Actions produced:', actions);

        // Should produce a flee action
        expect(actions.length).toBeGreaterThan(0);
        expect(actions[0].type).toBe('COMMAND_MOVE');
    });
});

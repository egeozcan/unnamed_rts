import { describe, it, expect } from 'vitest';
import { handleHarvesterSafety } from '../../src/engine/ai/action_combat';
import { createTestHarvester, createTestBuilding, addEntityToState } from '../../src/engine/test-utils';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { createEmptyComposition } from '../../src/engine/ai/counters';
import { type GameState, Vector, type HarvesterUnit } from '../../src/engine/types';
import { type AIPlayerState } from '../../src/engine/ai/types';
import { createInitialHarvesterAIState } from '../../src/engine/ai/harvester/types';

describe('Harvester Turret Flee - game_state_tick_10424', () => {
    it('should flee when being attacked by enemy turret with low HP', () => {
        // Recreate exact scenario from game_state_tick_10424
        let state: GameState = {
            ...INITIAL_STATE,
            tick: 10424,
            players: {
                1: { ...createPlayerState(1, false), credits: 5000 },
                6: { ...createPlayerState(6, true), credits: 18603 }
            }
        };

        // Harvester harv_p6 - low HP, being attacked by turret
        // Exact state from file (maxHp 1000, not moving)
        const harvester = createTestHarvester({
            id: 'harv_p6',
            owner: 6,
            x: 2303,
            y: 1558,
            hp: 298,  // 29.8% HP - low!
            moveTarget: null,
            lastAttackerId: 'turret1',
            lastDamageTick: 10411,  // 13 ticks ago
            cargo: 50
        });

        state = addEntityToState(state, harvester);

        // Enemy turret that's attacking the harvester
        const turret = {
            ...createTestBuilding({
                id: 'turret1',
                owner: 1,
                key: 'turret',
                x: 2305,
                y: 1747  // About 189 pixels away
            }),
            combat: {
                targetId: 'harv_p6',
                lastAttackerId: null,
                cooldown: 19,
                flash: 0,
                turretAngle: 0
            }
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

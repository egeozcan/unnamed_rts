import { describe, it, expect } from 'vitest';
import {
    HarvesterRole,
    DangerZone,
    HarvesterAIState,
    HarvesterDeathRecord,
    StuckLevel,
    HarvesterStuckState,
    HARVESTER_AI_CONSTANTS,
    createInitialHarvesterAIState
} from '../../../src/engine/ai/harvester/types';
import { Vector } from '../../../src/engine/types';

describe('Harvester AI Types', () => {
    describe('HarvesterRole', () => {
        it('should define all harvester role values', () => {
            const roles: HarvesterRole[] = ['safe', 'standard', 'risk-taker', 'opportunist'];
            expect(roles).toHaveLength(4);
            expect(roles).toContain('safe');
            expect(roles).toContain('standard');
            expect(roles).toContain('risk-taker');
            expect(roles).toContain('opportunist');
        });
    });

    describe('DangerZone', () => {
        it('should define DangerZone structure with all required fields', () => {
            const zone: DangerZone = {
                key: '5,3',
                dangerScore: 45,
                enemyCount: 2,
                recentAttacks: 1,
                harvesterDeaths: 0,
                lastUpdate: 100
            };
            expect(zone.key).toBe('5,3');
            expect(zone.dangerScore).toBe(45);
            expect(zone.enemyCount).toBe(2);
            expect(zone.recentAttacks).toBe(1);
            expect(zone.harvesterDeaths).toBe(0);
            expect(zone.lastUpdate).toBe(100);
        });

        it('should allow danger scores from 0 to 100', () => {
            const lowDanger: DangerZone = {
                key: '0,0',
                dangerScore: 0,
                enemyCount: 0,
                recentAttacks: 0,
                harvesterDeaths: 0,
                lastUpdate: 0
            };
            const highDanger: DangerZone = {
                key: '10,10',
                dangerScore: 100,
                enemyCount: 5,
                recentAttacks: 3,
                harvesterDeaths: 2,
                lastUpdate: 500
            };
            expect(lowDanger.dangerScore).toBe(0);
            expect(highDanger.dangerScore).toBe(100);
        });
    });

    describe('HarvesterDeathRecord', () => {
        it('should track harvester death with position and tick', () => {
            const death: HarvesterDeathRecord = {
                position: new Vector(500, 600),
                tick: 1200,
                zoneKey: '2,3'
            };
            expect(death.position.x).toBe(500);
            expect(death.position.y).toBe(600);
            expect(death.tick).toBe(1200);
            expect(death.zoneKey).toBe('2,3');
        });
    });

    describe('StuckLevel', () => {
        it('should define 5 stuck escalation levels', () => {
            const levels: StuckLevel[] = [1, 2, 3, 4, 5];
            expect(levels).toHaveLength(5);
        });
    });

    describe('HarvesterStuckState', () => {
        it('should track per-harvester stuck state', () => {
            const stuckState: HarvesterStuckState = {
                stuckTicks: 20,
                currentLevel: 2,
                lastActionTick: 100,
                blacklistedOre: new Set(['ore1', 'ore2'])
            };
            expect(stuckState.stuckTicks).toBe(20);
            expect(stuckState.currentLevel).toBe(2);
            expect(stuckState.lastActionTick).toBe(100);
            expect(stuckState.blacklistedOre.size).toBe(2);
            expect(stuckState.blacklistedOre.has('ore1')).toBe(true);
        });
    });

    describe('HarvesterAIState', () => {
        it('should define HarvesterAIState with all required maps', () => {
            const state: HarvesterAIState = {
                dangerMap: new Map(),
                dangerMapLastUpdate: 0,
                desperationScore: 30,
                harvesterRoles: new Map(),
                oreFieldClaims: new Map(),
                refineryQueue: new Map(),
                escortAssignments: new Map(),
                blacklistedOre: new Map(),
                stuckStates: new Map(),
                harvesterDeaths: []
            };
            expect(state.desperationScore).toBe(30);
            expect(state.dangerMap).toBeInstanceOf(Map);
            expect(state.harvesterRoles).toBeInstanceOf(Map);
            expect(state.oreFieldClaims).toBeInstanceOf(Map);
            expect(state.refineryQueue).toBeInstanceOf(Map);
            expect(state.escortAssignments).toBeInstanceOf(Map);
            expect(state.blacklistedOre).toBeInstanceOf(Map);
            expect(state.stuckStates).toBeInstanceOf(Map);
            expect(Array.isArray(state.harvesterDeaths)).toBe(true);
        });

        it('should support storing danger zones in dangerMap', () => {
            const state: HarvesterAIState = {
                dangerMap: new Map(),
                dangerMapLastUpdate: 0,
                desperationScore: 30,
                harvesterRoles: new Map(),
                oreFieldClaims: new Map(),
                refineryQueue: new Map(),
                escortAssignments: new Map(),
                blacklistedOre: new Map(),
                stuckStates: new Map(),
                harvesterDeaths: []
            };

            const zone: DangerZone = {
                key: '5,3',
                dangerScore: 75,
                enemyCount: 3,
                recentAttacks: 2,
                harvesterDeaths: 1,
                lastUpdate: 100
            };

            state.dangerMap.set(zone.key, zone);
            expect(state.dangerMap.get('5,3')?.dangerScore).toBe(75);
        });

        it('should support harvester role assignments', () => {
            const state: HarvesterAIState = {
                dangerMap: new Map(),
                dangerMapLastUpdate: 0,
                desperationScore: 50,
                harvesterRoles: new Map(),
                oreFieldClaims: new Map(),
                refineryQueue: new Map(),
                escortAssignments: new Map(),
                blacklistedOre: new Map(),
                stuckStates: new Map(),
                harvesterDeaths: []
            };

            state.harvesterRoles.set('harv1', 'safe');
            state.harvesterRoles.set('harv2', 'risk-taker');

            expect(state.harvesterRoles.get('harv1')).toBe('safe');
            expect(state.harvesterRoles.get('harv2')).toBe('risk-taker');
        });

        it('should support ore field claims with multiple harvesters', () => {
            const state: HarvesterAIState = {
                dangerMap: new Map(),
                dangerMapLastUpdate: 0,
                desperationScore: 30,
                harvesterRoles: new Map(),
                oreFieldClaims: new Map(),
                refineryQueue: new Map(),
                escortAssignments: new Map(),
                blacklistedOre: new Map(),
                stuckStates: new Map(),
                harvesterDeaths: []
            };

            state.oreFieldClaims.set('ore1', ['harv1', 'harv2']);
            state.oreFieldClaims.set('ore2', ['harv3']);

            expect(state.oreFieldClaims.get('ore1')).toEqual(['harv1', 'harv2']);
            expect(state.oreFieldClaims.get('ore2')).toEqual(['harv3']);
        });
    });

    describe('HARVESTER_AI_CONSTANTS', () => {
        it('should define zone configuration constants', () => {
            expect(HARVESTER_AI_CONSTANTS.ZONE_SIZE).toBe(200);
            expect(HARVESTER_AI_CONSTANTS.DANGER_MAP_UPDATE_INTERVAL).toBe(30);
        });

        it('should define danger score weight constants', () => {
            expect(HARVESTER_AI_CONSTANTS.ENEMY_PRESENCE_WEIGHT).toBe(10);
            expect(HARVESTER_AI_CONSTANTS.RECENT_ATTACK_WEIGHT).toBe(15);
            expect(HARVESTER_AI_CONSTANTS.DEATH_MEMORY_WEIGHT).toBe(25);
        });

        it('should define memory decay window constants', () => {
            expect(HARVESTER_AI_CONSTANTS.ATTACK_MEMORY_WINDOW).toBe(300);
            expect(HARVESTER_AI_CONSTANTS.DEATH_MEMORY_WINDOW).toBe(1800);
        });

        it('should define desperation threshold constants', () => {
            expect(HARVESTER_AI_CONSTANTS.DESPERATION_UPDATE_INTERVAL).toBe(60);
            expect(HARVESTER_AI_CONSTANTS.CREDITS_DESPERATE_THRESHOLD).toBe(5000);
            expect(HARVESTER_AI_CONSTANTS.HARVESTER_RATIO_DESPERATE).toBe(1.5);
            expect(HARVESTER_AI_CONSTANTS.EARLY_GAME_TICKS).toBe(10800);
        });

        it('should define coordinator constants', () => {
            expect(HARVESTER_AI_CONSTANTS.COORDINATOR_UPDATE_INTERVAL).toBe(60);
            expect(HARVESTER_AI_CONSTANTS.MAX_HARVESTERS_PER_ORE).toBe(3);
            expect(HARVESTER_AI_CONSTANTS.MAX_HARVESTERS_PER_REFINERY).toBe(2);
        });

        it('should define escort constants', () => {
            expect(HARVESTER_AI_CONSTANTS.ESCORT_UPDATE_INTERVAL).toBe(90);
            expect(HARVESTER_AI_CONSTANTS.ESCORT_PATROL_RADIUS).toBe(150);
            expect(HARVESTER_AI_CONSTANTS.ESCORT_RELEASE_DANGER).toBe(30);
            expect(HARVESTER_AI_CONSTANTS.ESCORT_ASSIGN_DANGER).toBe(40);
            expect(HARVESTER_AI_CONSTANTS.ESCORT_PRIORITY_DANGER).toBe(70);
        });

        it('should define stuck resolution tick thresholds', () => {
            expect(HARVESTER_AI_CONSTANTS.STUCK_LEVEL_1_TICKS).toBe(5);
            expect(HARVESTER_AI_CONSTANTS.STUCK_LEVEL_2_TICKS).toBe(15);
            expect(HARVESTER_AI_CONSTANTS.STUCK_LEVEL_3_TICKS).toBe(30);
            expect(HARVESTER_AI_CONSTANTS.STUCK_LEVEL_4_TICKS).toBe(45);
            expect(HARVESTER_AI_CONSTANTS.STUCK_LEVEL_5_TICKS).toBe(60);
        });

        it('should define stuck resolution cooldown constants', () => {
            expect(HARVESTER_AI_CONSTANTS.STUCK_COOLDOWN_1).toBe(30);
            expect(HARVESTER_AI_CONSTANTS.STUCK_COOLDOWN_2).toBe(60);
            expect(HARVESTER_AI_CONSTANTS.STUCK_COOLDOWN_3).toBe(120);
            expect(HARVESTER_AI_CONSTANTS.STUCK_COOLDOWN_4).toBe(180);
            expect(HARVESTER_AI_CONSTANTS.STUCK_COOLDOWN_5).toBe(300);
        });

        it('should define blacklist and detour constants', () => {
            expect(HARVESTER_AI_CONSTANTS.BLACKLIST_DURATION).toBe(180);
            expect(HARVESTER_AI_CONSTANTS.DETOUR_SEARCH_RADIUS).toBe(300);
        });

        it('should be readonly (const assertion)', () => {
            // TypeScript ensures this at compile time, but we can verify
            // the object exists and has expected shape
            expect(typeof HARVESTER_AI_CONSTANTS).toBe('object');
            expect(Object.keys(HARVESTER_AI_CONSTANTS).length).toBeGreaterThan(20);
        });
    });

    describe('createInitialHarvesterAIState', () => {
        it('should create a fresh HarvesterAIState with default values', () => {
            const state = createInitialHarvesterAIState();

            expect(state.dangerMap).toBeInstanceOf(Map);
            expect(state.dangerMap.size).toBe(0);
            expect(state.dangerMapLastUpdate).toBe(0);
            expect(state.desperationScore).toBe(30);
            expect(state.harvesterRoles).toBeInstanceOf(Map);
            expect(state.harvesterRoles.size).toBe(0);
            expect(state.oreFieldClaims).toBeInstanceOf(Map);
            expect(state.oreFieldClaims.size).toBe(0);
            expect(state.refineryQueue).toBeInstanceOf(Map);
            expect(state.refineryQueue.size).toBe(0);
            expect(state.escortAssignments).toBeInstanceOf(Map);
            expect(state.escortAssignments.size).toBe(0);
            expect(state.blacklistedOre).toBeInstanceOf(Map);
            expect(state.blacklistedOre.size).toBe(0);
            expect(state.stuckStates).toBeInstanceOf(Map);
            expect(state.stuckStates.size).toBe(0);
            expect(state.harvesterDeaths).toEqual([]);
        });

        it('should create independent state instances', () => {
            const state1 = createInitialHarvesterAIState();
            const state2 = createInitialHarvesterAIState();

            state1.dangerMap.set('0,0', {
                key: '0,0',
                dangerScore: 50,
                enemyCount: 1,
                recentAttacks: 0,
                harvesterDeaths: 0,
                lastUpdate: 0
            });

            expect(state1.dangerMap.size).toBe(1);
            expect(state2.dangerMap.size).toBe(0);
        });
    });
});

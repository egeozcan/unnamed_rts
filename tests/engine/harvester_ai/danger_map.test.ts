import { describe, it, expect, beforeEach } from 'vitest';
import {
    getZoneKey,
    parseZoneKey,
    updateDangerMap,
    getZoneDanger,
    getPathDanger,
    findSafestOre,
    recordHarvesterDeath
} from '../../../src/engine/ai/harvester/danger_map.js';
import {
    HarvesterAIState,
    createInitialHarvesterAIState,
    HARVESTER_AI_CONSTANTS
} from '../../../src/engine/ai/harvester/types.js';
import { Vector, Entity, ResourceEntity } from '../../../src/engine/types.js';
import {
    createTestHarvester,
    createTestCombatUnit,
    createTestResource,
    createTestBuilding
} from '../../../src/engine/test-utils.js';

describe('Danger Map System', () => {
    let harvesterAI: HarvesterAIState;

    beforeEach(() => {
        harvesterAI = createInitialHarvesterAIState();
    });

    describe('getZoneKey', () => {
        it('should convert world position to zone key', () => {
            // ZONE_SIZE = 200
            // 150,250 should be zone 0,1
            expect(getZoneKey(150, 250)).toBe('0,1');
        });

        it('should handle zero coordinates', () => {
            expect(getZoneKey(0, 0)).toBe('0,0');
        });

        it('should handle exact zone boundaries', () => {
            // At exactly 200, should be zone 1
            expect(getZoneKey(200, 0)).toBe('1,0');
            expect(getZoneKey(0, 200)).toBe('0,1');
            expect(getZoneKey(200, 200)).toBe('1,1');
        });

        it('should handle large coordinates', () => {
            // 1000,1500 with ZONE_SIZE=200 should be zone 5,7
            expect(getZoneKey(1000, 1500)).toBe('5,7');
        });

        it('should handle coordinates within first zone', () => {
            // 50,100 should be zone 0,0
            expect(getZoneKey(50, 100)).toBe('0,0');
            expect(getZoneKey(199, 199)).toBe('0,0');
        });
    });

    describe('parseZoneKey', () => {
        it('should parse zone key back to coordinates', () => {
            const result = parseZoneKey('2,3');
            expect(result.x).toBe(2);
            expect(result.y).toBe(3);
        });

        it('should handle zero coordinates', () => {
            const result = parseZoneKey('0,0');
            expect(result.x).toBe(0);
            expect(result.y).toBe(0);
        });

        it('should handle large zone coordinates', () => {
            const result = parseZoneKey('15,20');
            expect(result.x).toBe(15);
            expect(result.y).toBe(20);
        });

        it('should be inverse of getZoneKey', () => {
            const key = getZoneKey(450, 750);
            const coords = parseZoneKey(key);
            // Position 450,750 with ZONE_SIZE=200 -> zone 2,3
            expect(coords.x).toBe(2);
            expect(coords.y).toBe(3);
        });
    });

    describe('updateDangerMap', () => {
        it('should not update for easy difficulty', () => {
            const enemies = [createTestCombatUnit({ owner: 1, x: 500, y: 500 })];

            updateDangerMap(harvesterAI, 0, enemies, [], 100, 'easy');

            // Should not have updated any danger zones
            expect(harvesterAI.dangerMap.size).toBe(0);
        });

        it('should not update for dummy difficulty', () => {
            const enemies = [createTestCombatUnit({ owner: 1, x: 500, y: 500 })];

            updateDangerMap(harvesterAI, 0, enemies, [], 100, 'dummy');

            expect(harvesterAI.dangerMap.size).toBe(0);
        });

        it('should detect enemies and increase danger for medium difficulty', () => {
            const enemies = [
                createTestCombatUnit({ owner: 1, x: 500, y: 500 }),
                createTestCombatUnit({ owner: 1, x: 520, y: 520 })
            ];

            updateDangerMap(harvesterAI, 0, enemies, [], 100, 'medium');

            // Zone at 500,500 with ZONE_SIZE=200 is zone 2,2
            const zoneKey = getZoneKey(500, 500);
            expect(harvesterAI.dangerMap.has(zoneKey)).toBe(true);

            const zone = harvesterAI.dangerMap.get(zoneKey)!;
            // 2 enemies * ENEMY_PRESENCE_WEIGHT (10) = 20
            expect(zone.dangerScore).toBe(20);
            expect(zone.enemyCount).toBe(2);
        });

        it('should not include attack memory for medium difficulty', () => {
            // Pre-populate recent attacks
            const attackEvents = [
                { zoneKey: '2,2', tick: 50 },
                { zoneKey: '2,2', tick: 60 }
            ];

            updateDangerMap(harvesterAI, 0, [], attackEvents, 100, 'medium');

            const zoneKey = '2,2';
            // Medium doesn't use attack memory, so if no enemies, danger should be 0
            if (harvesterAI.dangerMap.has(zoneKey)) {
                const zone = harvesterAI.dangerMap.get(zoneKey)!;
                // Medium only uses enemy presence, no memory
                expect(zone.recentAttacks).toBe(0);
            }
        });

        it('should include attack memory for hard difficulty', () => {
            const attackEvents = [
                { zoneKey: '2,2', tick: 50 },
                { zoneKey: '2,2', tick: 60 }
            ];

            updateDangerMap(harvesterAI, 0, [], attackEvents, 100, 'hard');

            const zoneKey = '2,2';
            expect(harvesterAI.dangerMap.has(zoneKey)).toBe(true);

            const zone = harvesterAI.dangerMap.get(zoneKey)!;
            expect(zone.recentAttacks).toBe(2);
            // 2 attacks * RECENT_ATTACK_WEIGHT (15) = 30 (with decay)
            expect(zone.dangerScore).toBeGreaterThan(0);
        });

        it('should decay old attack events', () => {
            // Attack at tick 0, current tick is 350 (past ATTACK_MEMORY_WINDOW of 300)
            const attackEvents = [
                { zoneKey: '2,2', tick: 0 }
            ];

            updateDangerMap(harvesterAI, 0, [], attackEvents, 350, 'hard');

            const zoneKey = '2,2';
            // Attack is too old (350 - 0 > 300), should be filtered out
            if (harvesterAI.dangerMap.has(zoneKey)) {
                const zone = harvesterAI.dangerMap.get(zoneKey)!;
                expect(zone.recentAttacks).toBe(0);
            }
        });

        it('should include death memory for hard difficulty', () => {
            // Record a harvester death
            const deathPosition = new Vector(500, 500);
            recordHarvesterDeath(harvesterAI, deathPosition, 100);

            // Update at tick 200 (within DEATH_MEMORY_WINDOW of 1800)
            updateDangerMap(harvesterAI, 0, [], [], 200, 'hard');

            const zoneKey = getZoneKey(500, 500);
            expect(harvesterAI.dangerMap.has(zoneKey)).toBe(true);

            const zone = harvesterAI.dangerMap.get(zoneKey)!;
            expect(zone.harvesterDeaths).toBe(1);
            // 1 death * DEATH_MEMORY_WEIGHT (25) = 25
            expect(zone.dangerScore).toBe(25);
        });

        it('should clamp danger score to 0-100', () => {
            // Create many enemies to exceed 100
            const enemies: Entity[] = [];
            for (let i = 0; i < 15; i++) {
                enemies.push(createTestCombatUnit({ owner: 1, x: 500 + i, y: 500 }));
            }

            updateDangerMap(harvesterAI, 0, enemies, [], 100, 'hard');

            const zoneKey = getZoneKey(500, 500);
            const zone = harvesterAI.dangerMap.get(zoneKey)!;
            // 15 enemies * 10 = 150, but should be clamped to 100
            expect(zone.dangerScore).toBeLessThanOrEqual(100);
            expect(zone.dangerScore).toBeGreaterThanOrEqual(0);
        });

        it('should update lastUpdate tick', () => {
            const enemies = [createTestCombatUnit({ owner: 1, x: 500, y: 500 })];

            updateDangerMap(harvesterAI, 0, enemies, [], 1234, 'medium');

            expect(harvesterAI.dangerMapLastUpdate).toBe(1234);
        });

        it('should handle full calculation for hard difficulty with all sources', () => {
            // 2 enemies in zone
            const enemies = [
                createTestCombatUnit({ owner: 1, x: 500, y: 500 }),
                createTestCombatUnit({ owner: 1, x: 510, y: 510 })
            ];

            // 1 recent attack (within memory window)
            const attackEvents = [
                { zoneKey: getZoneKey(500, 500), tick: 90 }
            ];

            // 1 death in the zone
            const deathPosition = new Vector(505, 505);
            recordHarvesterDeath(harvesterAI, deathPosition, 50);

            updateDangerMap(harvesterAI, 0, enemies, attackEvents, 100, 'hard');

            const zoneKey = getZoneKey(500, 500);
            const zone = harvesterAI.dangerMap.get(zoneKey)!;

            // Base: 2 enemies * 10 = 20
            // Attack: 1 * 15 * decay factor
            // Death: 1 * 25
            expect(zone.enemyCount).toBe(2);
            expect(zone.recentAttacks).toBe(1);
            expect(zone.harvesterDeaths).toBe(1);
            expect(zone.dangerScore).toBeGreaterThan(40); // Should be > 20 + 25 with some attack contribution
        });
    });

    describe('getZoneDanger', () => {
        it('should return 0 for unknown zone', () => {
            expect(getZoneDanger(harvesterAI, 9999, 9999)).toBe(0);
        });

        it('should return danger score for known zone', () => {
            // Manually set up a danger zone
            const zoneKey = getZoneKey(500, 500);
            harvesterAI.dangerMap.set(zoneKey, {
                key: zoneKey,
                dangerScore: 45,
                enemyCount: 2,
                recentAttacks: 1,
                harvesterDeaths: 1,
                lastUpdate: 100
            });

            expect(getZoneDanger(harvesterAI, 500, 500)).toBe(45);
        });
    });

    describe('getPathDanger', () => {
        beforeEach(() => {
            // Set up some danger zones
            // Zone 2,2 (400-600 area) has danger 30
            harvesterAI.dangerMap.set('2,2', {
                key: '2,2',
                dangerScore: 30,
                enemyCount: 3,
                recentAttacks: 0,
                harvesterDeaths: 0,
                lastUpdate: 100
            });

            // Zone 3,2 (600-800 area) has danger 60
            harvesterAI.dangerMap.set('3,2', {
                key: '3,2',
                dangerScore: 60,
                enemyCount: 6,
                recentAttacks: 0,
                harvesterDeaths: 0,
                lastUpdate: 100
            });
        });

        it('should return 0 for path through safe zones', () => {
            const from = new Vector(100, 100); // Zone 0,0 - safe
            const to = new Vector(150, 150);   // Still zone 0,0 - safe

            expect(getPathDanger(harvesterAI, from, to)).toBe(0);
        });

        it('should return danger for path through dangerous zone', () => {
            const from = new Vector(100, 100); // Zone 0,0 - safe
            const to = new Vector(500, 500);   // Zone 2,2 - danger 30

            const danger = getPathDanger(harvesterAI, from, to);
            expect(danger).toBeGreaterThan(0);
        });

        it('should average danger along path', () => {
            const from = new Vector(500, 500); // Zone 2,2 - danger 30
            const to = new Vector(700, 500);   // Zone 3,2 - danger 60

            const danger = getPathDanger(harvesterAI, from, to);
            // Should be average of zones crossed
            expect(danger).toBeGreaterThan(0);
            expect(danger).toBeLessThanOrEqual(60);
        });

        it('should handle same start and end position', () => {
            const pos = new Vector(500, 500);

            const danger = getPathDanger(harvesterAI, pos, pos);
            expect(danger).toBe(30); // Zone 2,2 has danger 30
        });
    });

    describe('findSafestOre', () => {
        let harvester: ReturnType<typeof createTestHarvester>;
        let safeOre: ResourceEntity;
        let riskyOre: ResourceEntity;

        beforeEach(() => {
            harvester = createTestHarvester({ x: 500, y: 500 });

            // Safe ore - far from danger zones
            safeOre = createTestResource({ id: 'safe_ore', x: 100, y: 100 });

            // Risky ore - in dangerous zone but closer
            riskyOre = createTestResource({ id: 'risky_ore', x: 600, y: 500 });

            // Set up danger zone near risky ore
            harvesterAI.dangerMap.set('3,2', {
                key: '3,2',
                dangerScore: 70,
                enemyCount: 7,
                recentAttacks: 2,
                harvesterDeaths: 1,
                lastUpdate: 100
            });
        });

        it('should prefer safer ore when not desperate', () => {
            const oreOptions = [safeOre, riskyOre];
            const desperationScore = 20; // Low desperation

            const result = findSafestOre(harvesterAI, harvester, oreOptions, desperationScore);

            expect(result).toBe(safeOre);
        });

        it('should accept risky ore when desperate', () => {
            const oreOptions = [riskyOre]; // Only risky ore available
            const desperationScore = 90; // High desperation

            const result = findSafestOre(harvesterAI, harvester, oreOptions, desperationScore);

            expect(result).toBe(riskyOre);
        });

        it('should balance distance vs danger', () => {
            // Make safe ore very far
            const veryFarSafeOre = createTestResource({ id: 'far_safe', x: 2000, y: 2000 });
            const closeDangerousOre = createTestResource({ id: 'close_danger', x: 600, y: 500 });

            const oreOptions = [veryFarSafeOre, closeDangerousOre];
            const desperationScore = 50; // Medium desperation

            // With medium desperation, might choose closer ore even if slightly dangerous
            const result = findSafestOre(harvesterAI, harvester, oreOptions, desperationScore);

            // Result depends on scoring - just verify we get a result
            expect(result).not.toBeNull();
        });

        it('should return null for empty ore options', () => {
            const result = findSafestOre(harvesterAI, harvester, [], 50);
            expect(result).toBeNull();
        });

        it('should return only option when single ore available', () => {
            const result = findSafestOre(harvesterAI, harvester, [safeOre], 50);
            expect(result).toBe(safeOre);
        });

        it('should consider path danger not just destination danger', () => {
            // Ore that is safe itself but requires crossing dangerous zone
            const oreAcrossDanger = createTestResource({ id: 'across', x: 800, y: 500 });

            // Zone between harvester (2,2) and ore (4,2) is dangerous
            harvesterAI.dangerMap.set('3,2', {
                key: '3,2',
                dangerScore: 80,
                enemyCount: 8,
                recentAttacks: 3,
                harvesterDeaths: 2,
                lastUpdate: 100
            });

            const oreOptions = [safeOre, oreAcrossDanger];
            const result = findSafestOre(harvesterAI, harvester, oreOptions, 20);

            // Should prefer safe ore that doesn't require crossing danger
            expect(result).toBe(safeOre);
        });
    });

    describe('recordHarvesterDeath', () => {
        it('should add death record to harvesterDeaths array', () => {
            const position = new Vector(500, 500);

            recordHarvesterDeath(harvesterAI, position, 100);

            expect(harvesterAI.harvesterDeaths.length).toBe(1);
            expect(harvesterAI.harvesterDeaths[0].position.x).toBe(500);
            expect(harvesterAI.harvesterDeaths[0].position.y).toBe(500);
            expect(harvesterAI.harvesterDeaths[0].tick).toBe(100);
        });

        it('should calculate correct zone key for death', () => {
            const position = new Vector(450, 650);

            recordHarvesterDeath(harvesterAI, position, 100);

            // 450,650 with ZONE_SIZE=200 -> zone 2,3
            expect(harvesterAI.harvesterDeaths[0].zoneKey).toBe('2,3');
        });

        it('should accumulate multiple deaths', () => {
            recordHarvesterDeath(harvesterAI, new Vector(500, 500), 100);
            recordHarvesterDeath(harvesterAI, new Vector(600, 600), 200);
            recordHarvesterDeath(harvesterAI, new Vector(700, 700), 300);

            expect(harvesterAI.harvesterDeaths.length).toBe(3);
        });

        it('should affect danger calculation after recording', () => {
            const position = new Vector(500, 500);
            recordHarvesterDeath(harvesterAI, position, 100);

            // Update danger map after death
            updateDangerMap(harvesterAI, 0, [], [], 200, 'hard');

            const zoneKey = getZoneKey(500, 500);
            const zone = harvesterAI.dangerMap.get(zoneKey);

            expect(zone).toBeDefined();
            expect(zone!.harvesterDeaths).toBe(1);
            expect(zone!.dangerScore).toBe(HARVESTER_AI_CONSTANTS.DEATH_MEMORY_WEIGHT);
        });
    });

    describe('Integration scenarios', () => {
        it('should handle typical harvesting scenario', () => {
            const harvester = createTestHarvester({ x: 500, y: 500, owner: 0 });

            // Nearby ore options
            const nearOre = createTestResource({ id: 'near', x: 550, y: 550 });
            const farOre = createTestResource({ id: 'far', x: 1000, y: 1000 });

            // Enemy near the near ore
            const enemy = createTestCombatUnit({ owner: 1, x: 560, y: 560 });

            // Update danger map with enemy
            updateDangerMap(harvesterAI, 0, [enemy], [], 100, 'hard');

            // Find safest ore
            const chosenOre = findSafestOre(harvesterAI, harvester, [nearOre, farOre], 30);

            // With low desperation, should prefer farther but safer ore
            expect(chosenOre).toBe(farOre);
        });

        it('should adapt behavior based on difficulty', () => {
            const harvester = createTestHarvester({ x: 500, y: 500, owner: 0 });
            const nearOre = createTestResource({ id: 'near', x: 550, y: 550 });
            const enemy = createTestCombatUnit({ owner: 1, x: 560, y: 560 });

            // Easy difficulty - danger map not updated
            const easyAI = createInitialHarvesterAIState();
            updateDangerMap(easyAI, 0, [enemy], [], 100, 'easy');

            // Medium difficulty - only enemy presence
            const mediumAI = createInitialHarvesterAIState();
            updateDangerMap(mediumAI, 0, [enemy], [], 100, 'medium');

            // Hard difficulty - full calculation
            const hardAI = createInitialHarvesterAIState();
            recordHarvesterDeath(hardAI, new Vector(560, 560), 50);
            updateDangerMap(hardAI, 0, [enemy], [{ zoneKey: getZoneKey(560, 560), tick: 80 }], 100, 'hard');

            // Easy should have no danger awareness
            expect(getZoneDanger(easyAI, 550, 550)).toBe(0);

            // Medium should have some danger awareness
            const mediumDanger = getZoneDanger(mediumAI, 550, 550);
            expect(mediumDanger).toBeGreaterThan(0);

            // Hard should have highest danger awareness (includes memory)
            const hardDanger = getZoneDanger(hardAI, 550, 550);
            expect(hardDanger).toBeGreaterThan(mediumDanger);
        });
    });
});

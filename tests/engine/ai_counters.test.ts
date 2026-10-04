import { describe, it, expect, beforeEach } from 'vitest';
import {
    UNIT_COUNTERS,
    DEFENSE_COUNTERS,
    analyzeEnemyComposition,
    pickDominantArmor,
    rankCounterUnits,
    getCounterUnits,
    desiredAntiAirSites,
    pickDefenseBuilding,
    wantsCounterTech,
    applyCounterWeights
} from '../../src/engine/ai/counters.js';
import { handleEconomy } from '../../src/engine/ai/action_economy.js';
import { resetAIState, getAIState, updateEnemyIntelligence } from '../../src/engine/ai/state.js';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { AI_CONFIG, RULES } from '../../src/data/schemas/index.js';
import { BuildingKey, Entity, GameState, UnitKey, isActionType } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit, createTestHarrier } from '../../src/engine/test-utils.js';

const ENEMY = 0;
const ME = 1;
let nextId = 0;

function unit(key: UnitKey, owner = ENEMY): Entity {
    nextId++;
    if (key === 'harrier') return createTestHarrier({ id: `u${nextId}`, owner, x: 1000 + nextId, y: 1000 });
    return createTestCombatUnit({ id: `u${nextId}`, owner, key: key as Exclude<UnitKey, 'harvester' | 'harrier' | 'demo_truck'>, x: 1000 + nextId, y: 1000 });
}

function units(key: UnitKey, count: number, owner = ENEMY): Entity[] {
    return Array.from({ length: count }, () => unit(key, owner));
}

function building(key: BuildingKey, owner = ME, x = 500, y = 500): Entity {
    nextId++;
    return createTestBuilding({ id: `b${nextId}`, owner, key, x, y });
}

function unitData(key: string) {
    return RULES.units[key];
}

function canTarget(attacker: string, target: string): boolean {
    const data = unitData(attacker);
    const weapon = data?.weaponType;
    if (!data || !weapon || data.damage <= 0) return false;
    const targeting = RULES.weaponTargeting?.[weapon];
    if (!targeting) return true;
    return unitData(target)?.fly ? targeting.canTargetAir : targeting.canTargetGround;
}

/** Static damage-per-minute per credit of `attacker` against `target`, in target credits. */
function valueKilledPerCredit(attacker: string, target: string): number {
    if (!canTarget(attacker, target)) return 0;
    const a = unitData(attacker);
    const t = unitData(target);
    const armor = t.fly ? 'air' : t.armor;
    const modifier = RULES.damageModifiers?.[a.weaponType!]?.[armor] ?? 1;
    return a.damage * modifier / a.rate! * 60 / a.cost * t.cost / t.hp;
}

describe('AI counter knowledge (counters.ts)', () => {
    beforeEach(() => {
        nextId = 0;
        resetAIState();
    });

    describe('counter table stays consistent with rules.json', () => {
        it('only lists real units', () => {
            for (const [enemy, counters] of Object.entries(UNIT_COUNTERS)) {
                expect(unitData(enemy), enemy).toBeDefined();
                for (const counter of counters) expect(unitData(counter), counter).toBeDefined();
            }
            for (const counter of DEFENSE_COUNTERS) expect(unitData(counter), counter).toBeDefined();
        });

        it('only lists counters that can shoot the enemy unit', () => {
            for (const [enemy, counters] of Object.entries(UNIT_COUNTERS)) {
                for (const counter of counters) {
                    expect(canTarget(counter, enemy), `${counter} vs ${enemy}`).toBe(true);
                }
            }
        });

        it('every counter wins the static trade or outranges the enemy', () => {
            // A counter must kill more value per credit than it loses, unless it fights from
            // outside the enemy's reach (siege, snipers) - range is what wins those trades.
            for (const [enemy, counters] of Object.entries(UNIT_COUNTERS)) {
                for (const counter of counters) {
                    const ours = valueKilledPerCredit(counter, enemy);
                    const theirs = valueKilledPerCredit(enemy, counter);
                    const rangeEdge = unitData(counter).range - unitData(enemy).range;
                    const ok = theirs === 0 || ours >= theirs || rangeEdge >= 50;
                    expect(ok, `${counter} vs ${enemy}: ${ours.toFixed(2)} vs ${theirs.toFixed(2)}, range edge ${rangeEdge}`).toBe(true);
                }
            }
        });

        it('aircraft are countered by ground anti-air', () => {
            for (const air of ['heli', 'harrier']) {
                expect(UNIT_COUNTERS[air][0]).toBeDefined();
                expect(UNIT_COUNTERS[air].every(key => !unitData(key).fly)).toBe(true);
            }
        });
    });

    describe('composition analysis', () => {
        it('classifies helicopters as air and asks for SAM sites', () => {
            const comp = analyzeEnemyComposition([...units('heli', 3), ...units('rifle', 2)]);
            expect(comp.dominantArmor).toBe('air');
            expect(comp.airCount).toBe(3);
            expect(desiredAntiAirSites(comp)).toBeGreaterThanOrEqual(1);
        });

        it('separates medium (light tanks) from heavy armor', () => {
            expect(analyzeEnemyComposition(units('light', 4)).dominantArmor).toBe('medium');
            expect(analyzeEnemyComposition(units('heavy', 3)).dominantArmor).toBe('heavy');
        });

        it('uses a plurality of army value, not an unreachable 60% unit count', () => {
            // 6 rifles + 4 rockets + 1 light tank: infantry holds ~79% of the value
            const comp = analyzeEnemyComposition([...units('rifle', 6), ...units('rocket', 4), unit('light')]);
            expect(comp.dominantArmor).toBe('infantry');
            expect(pickDominantArmor({ infantry: 0.4, light: 0.1, medium: 0.25, heavy: 0.25, air: 0 })).toBe('infantry');
            expect(pickDominantArmor({ infantry: 0.3, light: 0.1, medium: 0.3, heavy: 0.3, air: 0 })).toBe('mixed');
        });

        it('ignores harvesters and other non-army units', () => {
            const comp = analyzeEnemyComposition([
                createTestCombatUnit({ id: 'eng', owner: ENEMY, key: 'engineer', x: 0, y: 0 }),
                createTestCombatUnit({ id: 'mcv', owner: ENEMY, key: 'mcv', x: 0, y: 0 })
            ]);
            expect(comp.armyValue).toBe(0);
            expect(comp.dominantArmor).toBe('mixed');
        });

        it('feeds updateEnemyIntelligence', () => {
            const aiState = getAIState(ME);
            updateEnemyIntelligence(aiState, units('heli', 2), 300);
            expect(aiState.enemyIntelligence.dominantArmor).toBe('air');
            expect(aiState.enemyIntelligence.composition.airCount).toBe(2);
        });
    });

    describe('counter picks', () => {
        it('answers each side of the unit triangles', () => {
            const top = (enemies: Entity[], roster: string[]) =>
                rankCounterUnits(analyzeEnemyComposition(enemies), roster)[0];
            const infantry = ['rocket', 'rifle', 'grenadier', 'flamer'];
            const tanks = ['heavy', 'light', 'stealth', 'flame_tank'];

            expect(top(units('rocket', 8), infantry)).toBe('rifle');          // rifle > rocket
            expect(top(units('heavy', 4), infantry)).toBe('rocket');          // rocket > tanks
            expect(top(units('rifle', 10), tanks)).toBe('flame_tank');        // tanks > rifle
            expect(top(units('light', 4), tanks)).toBe('heavy');              // heavy > light tank
            expect(top(units('stealth', 4), tanks)).toBe('light');            // light tank > missile tank
            expect(top(units('heli', 3), infantry)).toBe('rocket');           // anti-air
            expect(top(units('heli', 3), tanks)).toBe('stealth');             // missile tank shoots up
        });

        it('keeps an AI inside its own roster', () => {
            const ranked = rankCounterUnits(analyzeEnemyComposition(units('heavy', 4)), ['heavy', 'light']);
            expect(ranked.sort()).toEqual(['heavy', 'light']);
        });

        it('falls back to the flavor order when there is nothing to counter', () => {
            expect(rankCounterUnits(analyzeEnemyComposition([]), ['grenadier', 'rocket', 'rifle']))
                .toEqual(['grenadier', 'rocket', 'rifle']);
            const opening = getCounterUnits(analyzeEnemyComposition([]));
            expect(opening.infantry.length).toBeGreaterThan(0);
            expect(opening.vehicle.length).toBeGreaterThan(0);
        });

        it('diversifies when we already own a lot of the top counter', () => {
            const comp = analyzeEnemyComposition([...units('heavy', 2), ...units('rocket', 8)]);
            const before = rankCounterUnits(comp, ['rocket', 'rifle', 'flamer']);
            const after = rankCounterUnits(comp, ['rocket', 'rifle', 'flamer'], units(before[0] as UnitKey, 12, ME));
            expect(after[0]).not.toBe(before[0]);
        });

        it('wants siege against turtles and tech against heavy armor', () => {
            const defenses = Array.from({ length: 5 }, (_, i) => building('turret', ENEMY, 2000 + i * 60, 2000));
            const turtle = analyzeEnemyComposition(defenses);
            expect(rankCounterUnits(turtle, ['heavy', 'light', 'artillery'])[0]).toBe('artillery');
            expect(wantsCounterTech(turtle)).toBe(true);
            expect(wantsCounterTech(analyzeEnemyComposition(units('rifle', 10)))).toBe(false);
        });

        it('weights flavor tables toward counters', () => {
            const comp = analyzeEnemyComposition(units('rocket', 8));
            const weights = applyCounterWeights({ rocket: 5, rifle: 1, grenadier: 3 }, comp, ['rocket', 'rifle', 'grenadier', 'flamer'], 8);
            expect(weights.rifle).toBeGreaterThan(weights.rocket);
            expect(weights.flamer).toBeGreaterThan(0);
        });
    });

    describe('anti-air defenses', () => {
        it('picks SAM sites over turrets until enemy air is covered', () => {
            const comp = analyzeEnemyComposition(units('heli', 4));
            expect(pickDefenseBuilding(comp, [])).toBe('sam_site');
            const sams = Array.from({ length: desiredAntiAirSites(comp) }, () => building('sam_site'));
            expect(pickDefenseBuilding(comp, sams)).toBe('turret');
            expect(pickDefenseBuilding(analyzeEnemyComposition(units('heavy', 4)), [])).toBe('turret');
        });

        it('shared economy queues a SAM site when the enemy fields aircraft', () => {
            const mine = [building('conyard', ME, 500, 500), building('power', ME, 650, 500), building('barracks', ME, 500, 650), building('refinery', ME, 650, 650)];
            const enemies = units('heli', 3);
            const entities: Record<string, Entity> = {};
            for (const e of [...mine, ...enemies]) entities[e.id] = e;
            const state: GameState = {
                ...INITIAL_STATE,
                running: true,
                tick: 600,
                entities,
                players: {
                    [ENEMY]: createPlayerState(ENEMY, true, 'hard'),
                    [ME]: { ...createPlayerState(ME, true, 'hard'), credits: 5000 }
                }
            };
            const aiState = getAIState(ME);
            updateEnemyIntelligence(aiState, enemies, 600);
            const actions = handleEconomy(state, ME, mine, state.players[ME], AI_CONFIG.personalities.balanced, aiState, enemies);
            const sam = actions.find(a => isActionType(a, 'START_BUILD') && a.payload.key === 'sam_site');
            expect(sam).toBeDefined();
        });
    });
});

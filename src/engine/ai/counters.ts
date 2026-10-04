import { type Entity } from '../types.js';
import { RULES } from '../../data/schemas/index.js';

// ===== COUNTER KNOWLEDGE =====
//
// The AI's model of the rock-paper-scissors in rules.json. Every AI reads its
// counter picks from here, so when unit roles change in rules.json this is the
// one table to update (tests/engine/ai_counters.test.ts checks every entry
// against the damage modifiers).
//
// Ordered by equal-budget duel results from `npm run balance:sim -- --matrix`
// (final tuning pass it16, 6000-credit matrix). Unit triangles encoded below:
//   rifle > rocket > tanks > rifle
//   light tank > missile tank (stealth) > heavy/mammoth > light tank
//   flamer / grenadier / flame tank / jeep shred rockets; tanks shred flamers/grenadiers
//   rocket / rifle / APC / MLRS / missile tank and SAM sites shoot down aircraft
//   jeep / APC / light tank raid siege units; siege (artillery/MLRS) breaks turtles

export type ArmorClass = 'infantry' | 'light' | 'medium' | 'heavy' | 'air';
export type DominantArmor = ArmorClass | 'mixed';

export const ARMOR_CLASSES: readonly ArmorClass[] = ['infantry', 'light', 'medium', 'heavy', 'air'];

/** Units that never fight an army and should not shape the enemy composition. */
const NON_ARMY_UNIT_KEYS = new Set(['harvester', 'mcv', 'engineer', 'induction_rig', 'demo_truck', 'hijacker', 'medic']);

/**
 * Enemy unit key -> our counters, best first. Mixes infantry and vehicles; callers
 * filter by what they can (or want to) build.
 */
export const UNIT_COUNTERS: Readonly<Record<string, readonly string[]>> = {
    rifle: ['flame_tank', 'light', 'heavy', 'jeep', 'artillery'],
    rocket: ['rifle', 'artillery', 'jeep', 'flamer', 'grenadier', 'sniper', 'flame_tank'],
    flamer: ['flame_tank', 'heavy', 'jeep', 'light', 'artillery', 'rifle'],
    grenadier: ['flame_tank', 'heavy', 'light', 'artillery'],
    sniper: ['jeep', 'light', 'apc', 'heavy', 'rifle'],
    commando: ['heavy', 'flame_tank', 'jeep', 'sniper', 'artillery'],
    jeep: ['flame_tank', 'light', 'heavy', 'apc', 'stealth'],
    apc: ['flame_tank', 'heavy', 'light'],
    light: ['heavy', 'mammoth', 'rocket'],
    flame_tank: ['heavy', 'light', 'stealth'],
    stealth: ['rocket', 'grenadier', 'flamer', 'apc', 'light', 'commando'],
    heavy: ['mammoth', 'rocket', 'mlrs', 'stealth'],
    mammoth: ['rocket', 'mlrs', 'stealth'],
    artillery: ['light', 'apc', 'heavy', 'flame_tank', 'jeep'],
    mlrs: ['rifle', 'flamer', 'grenadier', 'apc', 'rocket', 'jeep'],
    heli: ['rocket', 'mlrs', 'apc', 'rifle', 'stealth', 'jeep'],
    harrier: ['rifle', 'rocket', 'apc', 'mlrs', 'stealth']
};

/** What breaks static defenses: long-range siege first, then tough line-breakers. */
export const DEFENSE_COUNTERS: readonly string[] = ['artillery', 'mlrs', 'mammoth', 'heavy'];

/** Defenses needed before siege units start paying off. */
export const TURTLE_DEFENSE_COUNT = 3;

/** Score weight by position in a counter list. */
const RANK_WEIGHTS = [1, 0.75, 0.55, 0.4, 0.3, 0.25, 0.2];

export interface EnemyComposition {
    dominantArmor: DominantArmor;
    /** Cost-weighted share of the enemy army per armor class (sums to 1 when armyValue > 0). */
    armorShares: Record<ArmorClass, number>;
    armyValue: number;
    airCount: number;
    defenseCount: number;
    /** Our unit key -> how well it answers the enemy (credits of enemy army it counters). */
    counterScores: Record<string, number>;
}

function emptyShares(): Record<ArmorClass, number> {
    return { infantry: 0, light: 0, medium: 0, heavy: 0, air: 0 };
}

export function createEmptyComposition(): EnemyComposition {
    return {
        dominantArmor: 'mixed',
        armorShares: emptyShares(),
        armyValue: 0,
        airCount: 0,
        defenseCount: 0,
        counterScores: {}
    };
}

export function isArmyUnitKey(key: string): boolean {
    if (NON_ARMY_UNIT_KEYS.has(key)) return false;
    const data = RULES.units[key];
    return Boolean(data && data.damage > 0);
}

function armorClassOf(key: string): ArmorClass | null {
    const data = RULES.units[key];
    if (!data) return null;
    if (data.fly) return 'air';
    const armor = data.armor;
    if (armor === 'infantry' || armor === 'light' || armor === 'medium' || armor === 'heavy') return armor;
    if (armor === 'air') return 'air';
    return null;
}

/**
 * Dominant armor by plurality of army value: the top class wins if it holds 45% of the
 * value, or 35% and half again as much as the runner-up. Otherwise the army is 'mixed'.
 */
export function pickDominantArmor(shares: Record<ArmorClass, number>): DominantArmor {
    const ranked = [...ARMOR_CLASSES].sort((a, b) => shares[b] - shares[a]);
    const top = shares[ranked[0]];
    const second = shares[ranked[1]];
    if (top <= 0) return 'mixed';
    if (top >= 0.45 || (top >= 0.35 && top >= second * 1.5)) return ranked[0];
    return 'mixed';
}

export function analyzeEnemyComposition(enemies: readonly Entity[]): EnemyComposition {
    const composition = createEmptyComposition();
    const unitValue: Record<string, number> = {};

    for (const e of enemies) {
        if (e.dead) continue;
        if (e.type === 'BUILDING') {
            if (RULES.buildings[e.key]?.isDefense) composition.defenseCount++;
            continue;
        }
        if (e.type !== 'UNIT' || !isArmyUnitKey(e.key)) continue;
        const armorClass = armorClassOf(e.key);
        if (!armorClass) continue;
        const value = RULES.units[e.key].cost || 1;
        composition.armorShares[armorClass] += value;
        composition.armyValue += value;
        unitValue[e.key] = (unitValue[e.key] || 0) + value;
        if (armorClass === 'air') composition.airCount++;
    }

    if (composition.armyValue > 0) {
        for (const armorClass of ARMOR_CLASSES) {
            composition.armorShares[armorClass] /= composition.armyValue;
        }
    }
    composition.dominantArmor = pickDominantArmor(composition.armorShares);

    const scores: Record<string, number> = {};
    const addCounters = (counters: readonly string[], value: number) => {
        counters.forEach((key, rank) => {
            const weight = RANK_WEIGHTS[Math.min(rank, RANK_WEIGHTS.length - 1)];
            scores[key] = (scores[key] || 0) + value * weight;
        });
    };
    for (const key in unitValue) {
        const counters = UNIT_COUNTERS[key];
        if (counters) addCounters(counters, unitValue[key]);
    }
    if (composition.defenseCount >= TURTLE_DEFENSE_COUNT) {
        // Treat each defense like an 800-credit unit that only siege answers well.
        addCounters(DEFENSE_COUNTERS, composition.defenseCount * 800);
    }
    composition.counterScores = scores;
    return composition;
}

/** Default picks when there is nothing to counter yet (no enemy army seen). */
const OPENING_PICKS: readonly string[] = ['rocket', 'rifle', 'grenadier', 'light', 'heavy', 'apc'];

/**
 * Rank `candidates` (an AI's allowed unit keys, in its own preference order) by how
 * well they counter the enemy. Units we already own a lot of are discounted so the
 * army keeps a mix instead of collapsing into one counter.
 *
 * Candidates with no counter value keep their relative preference order and come
 * after every candidate that counters something.
 */
export function rankCounterUnits(
    composition: Pick<EnemyComposition, 'counterScores'>,
    candidates: readonly string[],
    ownUnits: readonly Entity[] = []
): string[] {
    const unique = [...new Set(candidates)];
    const ownValue: Record<string, number> = {};
    let ownTotal = 0;
    for (const u of ownUnits) {
        if (u.dead || u.type !== 'UNIT' || !isArmyUnitKey(u.key)) continue;
        const value = RULES.units[u.key]?.cost || 0;
        ownValue[u.key] = (ownValue[u.key] || 0) + value;
        ownTotal += value;
    }

    const scored = unique.map((key, index) => {
        const raw = composition.counterScores[key] || 0;
        const ownShare = ownTotal > 0 ? (ownValue[key] || 0) / ownTotal : 0;
        // Small preference bonus keeps the AI's flavor as a tie-breaker.
        const preference = (unique.length - index) * 1e-6;
        return { key, score: raw / (1 + ownShare * 3) + preference };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map(s => s.key);
}

export interface CounterUnits {
    infantry: string[];
    vehicle: string[];
}

const INFANTRY_COMBAT_KEYS = ['rocket', 'rifle', 'grenadier', 'flamer', 'sniper', 'commando'];
const VEHICLE_COMBAT_KEYS = ['heavy', 'light', 'stealth', 'flame_tank', 'apc', 'jeep', 'artillery', 'mlrs', 'mammoth'];

/**
 * Shared counter-building picks for both production lanes, best first. With no enemy army
 * seen yet it falls back to a general-purpose opening mix.
 */
export function getCounterUnits(
    composition: Pick<EnemyComposition, 'counterScores'>,
    prefs?: { infantry?: string[]; vehicle?: string[] },
    forcePrefs: boolean = false,
    ownUnits: readonly Entity[] = []
): CounterUnits {
    if (forcePrefs && prefs) {
        return {
            infantry: prefs.infantry || [],
            vehicle: prefs.vehicle || []
        };
    }

    const hasCounterData = Object.keys(composition.counterScores).length > 0;
    if (!hasCounterData) {
        return {
            infantry: OPENING_PICKS.filter(k => INFANTRY_COMBAT_KEYS.includes(k)),
            vehicle: OPENING_PICKS.filter(k => VEHICLE_COMBAT_KEYS.includes(k))
        };
    }

    return {
        infantry: rankCounterUnits(composition, INFANTRY_COMBAT_KEYS, ownUnits),
        vehicle: rankCounterUnits(composition, VEHICLE_COMBAT_KEYS, ownUnits)
    };
}

// ===== ANTI-AIR DEFENSES =====

/** Enemy aircraft value (credits) that justifies one SAM site. */
const AIR_VALUE_PER_SAM = 2500;
const MAX_ANTI_AIR_SITES = 4;

/** How many SAM sites we want for the enemy air force we have seen. */
export function desiredAntiAirSites(composition: Pick<EnemyComposition, 'airCount' | 'armorShares' | 'armyValue'>): number {
    if (composition.airCount === 0) return 0;
    const airValue = composition.armorShares.air * composition.armyValue;
    return Math.min(MAX_ANTI_AIR_SITES, Math.max(1, Math.ceil(airValue / AIR_VALUE_PER_SAM)));
}

/** The defense building to put up: SAMs while enemy air outnumbers our anti-air, turrets otherwise. */
export function pickDefenseBuilding(
    composition: Pick<EnemyComposition, 'airCount' | 'armorShares' | 'armyValue'>,
    myBuildings: readonly Entity[]
): 'sam_site' | 'turret' {
    const samCount = myBuildings.filter(b => b.key === 'sam_site' && !b.dead).length;
    return samCount < desiredAntiAirSites(composition) ? 'sam_site' : 'turret';
}

// ===== COUNTER TECH =====

/** Share of the counter value that has to sit behind the Tech Center before we build one. */
const COUNTER_TECH_SHARE = 0.25;

function requiresTech(key: string): boolean {
    return (RULES.units[key]?.prerequisites ?? []).includes('tech');
}

/** True when the units that best answer the enemy (missile tanks, siege) need a Tech Center. */
export function wantsCounterTech(composition: Pick<EnemyComposition, 'counterScores'>): boolean {
    let total = 0;
    let techLocked = 0;
    for (const key in composition.counterScores) {
        const score = composition.counterScores[key];
        total += score;
        if (requiresTech(key)) techLocked += score;
    }
    return total > 0 && techLocked / total >= COUNTER_TECH_SHARE;
}

// ===== WEIGHTED PICKS =====

/**
 * Shift an AI's flavor weights toward units that counter the enemy army: the best
 * counter in `roster` gets `bonus` extra weight, the others proportionally less.
 * Keys outside `roster` keep their base weight. Roster keys missing from `base`
 * start from 0, so a counter the flavor never builds can still be picked.
 */
export function applyCounterWeights(
    base: Readonly<Record<string, number>>,
    composition: Pick<EnemyComposition, 'counterScores'>,
    roster: readonly string[],
    bonus: number
): Record<string, number> {
    const maxScore = Math.max(0, ...roster.map(key => composition.counterScores[key] || 0));
    if (maxScore <= 0) return { ...base };

    const adjusted: Record<string, number> = { ...base };
    for (const key of roster) {
        adjusted[key] = (base[key] || 0) + Math.round(bonus * (composition.counterScores[key] || 0) / maxScore);
    }
    return adjusted;
}

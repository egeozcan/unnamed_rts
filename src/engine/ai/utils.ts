import { GameState, Entity, EntityId, Vector } from '../types.js';
import { RULES } from '../../data/schemas/index.js';
import { CounterUnits } from './types.js';

// ===== AI CONSTANTS =====
// Consolidated configuration object for all AI behavior constants
export const AI_CONSTANTS = {
    // === DISTANCES ===
    BUILD_RADIUS: 400,              // Distance within which buildings can be placed
    BASE_DEFENSE_RADIUS: 500,       // Radius to consider threats "near base"
    THREAT_DETECTION_RADIUS: 400,   // Radius for detecting nearby threats
    HARVESTER_FLEE_DISTANCE: 200,   // Distance to move when fleeing
    RALLY_DISTANCE: 150,            // Distance from target to rally before attack
    ALLY_DANGER_RADIUS: 120,        // Distance to check for allies under fire (~3 tiles)
    ORE_COVERAGE_RADIUS: 250,       // Refinery considers ore "covered" within this
    ORE_ACCESSIBLE_RADIUS: 600,     // Ore considered accessible within this from buildings

    // === COMBAT ===
    ATTACK_GROUP_MIN_SIZE: 5,       // Minimum units needed for attack group
    HARASS_GROUP_SIZE: 3,           // Size of harass squad
    MAX_CHASE_DISTANCE: 400,        // Max distance to chase fleeing enemies

    // === TIMINGS (in ticks, 60 ticks = 1 second) ===
    AI_TICK_INTERVAL: 3,            // AI players compute every N ticks (staggered by player ID)
    STRATEGY_COOLDOWN: 300,         // 5 seconds between strategy changes
    RALLY_TIMEOUT: 300,             // 5 seconds to wait for stragglers at rally point
    SCOUT_INTERVAL: 600,            // 10 seconds between scout attempts
    RECENT_DAMAGE_WINDOW: 60,       // 1 second - time window to consider "under fire"
    INTEL_UPDATE_INTERVAL: 300,     // 5 seconds between enemy intelligence updates

    // === PEACE-BREAK (triggers aggressive behavior when wealthy and peaceful) ===
    SURPLUS_CREDIT_THRESHOLD: 4000, // Credits considered "surplus"
    PEACE_BREAK_TICKS: 600,         // 10 seconds of peace before considering attack
    GUARANTEED_PEACE_BREAK_TICKS: 1200, // 20 seconds guaranteed attack after peace
    SURPLUS_DEFENSE_THRESHOLD: 5000, // Credits to trigger extra defense building
    MAX_SURPLUS_TURRETS: 4,         // Maximum turrets to build from surplus

    // === STALEMATE-BREAKER (force risky moves when game stagnates) ===
    STALEMATE_DETECTION_TICK: 18000,      // Start checking for stalemate after 5 minutes
    STALEMATE_NO_COMBAT_THRESHOLD: 6000,  // 100 seconds without combat = stalemate
    STALEMATE_LOW_ARMY_THRESHOLD: 2,      // Less than this many combat units = stuck
    DESPERATE_ATTACK_TICK: 36000,         // After 10 minutes, attack with anything
    HARVESTER_ATTACK_THRESHOLD: 3,        // Need at least this many harvesters to suicide attack

    // === ALL-IN MODE SELL PHASES (progressive selling for final push) ===
    ALL_IN_PHASE1_TICKS: 1800,      // After 30s in all_in: sell defense buildings
    ALL_IN_PHASE2_TICKS: 3600,      // After 60s in all_in: sell economy buildings
    ALL_IN_PHASE3_TICKS: 5400,      // After 90s in all_in: sell everything

    // === VENGEANCE SYSTEM ===
    VENGEANCE_DECAY: 0.995,         // Decay factor per AI tick (grudges fade slowly)
    VENGEANCE_PER_HIT: 10,          // Base vengeance added per attacked entity
} as const;

// Destructure commonly used constants for local usage if needed, but exports should use AI_CONSTANTS
// Exporting individual constants for backward compatibility or ease of use
export const {
    AI_TICK_INTERVAL,
    BASE_DEFENSE_RADIUS,
    ATTACK_GROUP_MIN_SIZE,
    HARASS_GROUP_SIZE,
    HARVESTER_FLEE_DISTANCE,
    THREAT_DETECTION_RADIUS,
    STRATEGY_COOLDOWN,
    RALLY_DISTANCE,
    RALLY_TIMEOUT,
    SCOUT_INTERVAL,
    RECENT_DAMAGE_WINDOW,
    ALLY_DANGER_RADIUS,
    SURPLUS_CREDIT_THRESHOLD,
    PEACE_BREAK_TICKS,
    SURPLUS_DEFENSE_THRESHOLD,
    MAX_SURPLUS_TURRETS,
    STALEMATE_DETECTION_TICK,
    STALEMATE_NO_COMBAT_THRESHOLD,
    STALEMATE_LOW_ARMY_THRESHOLD,
    DESPERATE_ATTACK_TICK,
    HARVESTER_ATTACK_THRESHOLD,
    ALL_IN_PHASE1_TICKS,
    ALL_IN_PHASE2_TICKS,
    ALL_IN_PHASE3_TICKS,
    VENGEANCE_PER_HIT,
    VENGEANCE_DECAY,
    MAX_CHASE_DISTANCE
} = AI_CONSTANTS;

export function isUnit(entity: Entity): boolean {
    return entity.type === 'UNIT';
}

// Difficulty modifiers - affect gameplay independently of personality
export const DIFFICULTY_MODIFIERS = {
    easy: {
        resourceBonus: 0.8,      // 80% resource gain from harvesting
        buildSpeedBonus: 0.9,    // 90% build speed
        reactionDelay: 120,      // 2 seconds slower to react to threats (in ticks)
    },
    medium: {
        resourceBonus: 1.0,      // Normal resource gain
        buildSpeedBonus: 1.0,    // Normal build speed
        reactionDelay: 0,        // No delay
    },
    hard: {
        resourceBonus: 1.2,      // 120% resource gain from harvesting
        buildSpeedBonus: 1.15,   // 15% faster builds
        reactionDelay: 0,        // No delay
    }
} as const;

export type DifficultyModifiers = typeof DIFFICULTY_MODIFIERS[keyof typeof DIFFICULTY_MODIFIERS];

export function getDifficultyModifiers(difficulty: 'easy' | 'medium' | 'hard'): DifficultyModifiers {
    return DIFFICULTY_MODIFIERS[difficulty];
}

// Note: getPersonalityForPlayer has been moved to state.ts to avoid circular dependencies

// ===== BUILDING FILTER UTILITIES =====

export function getNonDefenseBuildings(buildings: Entity[]): Entity[] {
    return buildings.filter(b => {
        const data = RULES.buildings[b.key];
        return !data?.isDefense && !b.dead;
    });
}

export function getDefenseBuildings(buildings: Entity[]): Entity[] {
    return buildings.filter(b => {
        const data = RULES.buildings[b.key];
        return data?.isDefense && !b.dead;
    });
}

export function getRefineries(buildings: Entity[]): Entity[] {
    return buildings.filter(b => b.key === 'refinery' && !b.dead);
}

// ===== RESOURCE UTILITIES =====

export function getAllOre(state: GameState): Entity[] {
    return Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
}

export function getAccessibleOre(ore: Entity[], buildings: Entity[], maxDist: number = AI_CONSTANTS.BUILD_RADIUS + 200): Entity[] {
    const nonDefense = getNonDefenseBuildings(buildings);
    return ore.filter(o => nonDefense.some(b => b.pos.dist(o.pos) < maxDist));
}

export function findNearestUncoveredOre(
    state: GameState,
    buildings: Entity[],
    coverageRadius: number = AI_CONSTANTS.ORE_COVERAGE_RADIUS
): Entity | null {
    const refineries = getRefineries(buildings);
    const nonDefense = getNonDefenseBuildings(buildings);
    const allOre = getAllOre(state);

    for (const ore of allOre) {
        // Check if any refinery already covers this ore
        const hasCoverage = refineries.some(r => r.pos.dist(ore.pos) < coverageRadius);
        if (hasCoverage) continue;

        // Check if ore is accessible (within build range of a non-defense building)
        const isAccessible = nonDefense.some(b => b.pos.dist(ore.pos) < AI_CONSTANTS.BUILD_RADIUS + 150);
        if (isAccessible) return ore;
    }
    return null;
}

// Cluster ore into "fields"
export function clusterOreIntoFields(allOre: Entity[], clusterRadius: number = 200): Entity[][] {
    const fields: Entity[][] = [];
    const assigned = new Set<EntityId>();

    for (const ore of allOre) {
        if (assigned.has(ore.id)) continue;

        const field: Entity[] = [ore];
        assigned.add(ore.id);

        let expanded = true;
        while (expanded) {
            expanded = false;
            for (const otherOre of allOre) {
                if (assigned.has(otherOre.id)) continue;

                for (const fieldOre of field) {
                    if (otherOre.pos.dist(fieldOre.pos) < clusterRadius) {
                        field.push(otherOre);
                        assigned.add(otherOre.id);
                        expanded = true;
                        break;
                    }
                }
            }
        }
        fields.push(field);
    }
    return fields;
}

// Check if an ore field is contested
export function isFieldContested(field: Entity[], enemies: Entity[], contestRadius: number = 400): boolean {
    for (const ore of field) {
        for (const enemy of enemies) {
            if (enemy.type === 'UNIT' && ore.pos.dist(enemy.pos) < contestRadius) {
                return true;
            }
        }
    }
    return false;
}

// ===== DISTANCE & BUILD RANGE UTILITIES =====

export function isWithinBuildRange(pos: Vector, buildings: Entity[]): boolean {
    const nonDefense = getNonDefenseBuildings(buildings);
    return nonDefense.some(b => pos.dist(b.pos) < AI_CONSTANTS.BUILD_RADIUS);
}

export function findNearestBuilding(pos: Vector, buildings: Entity[], filterKey?: string): Entity | null {
    let nearest: Entity | null = null;
    let minDist = Infinity;

    for (const b of buildings) {
        if (filterKey && b.key !== filterKey) continue;
        if (b.dead) continue;

        const d = pos.dist(b.pos);
        if (d < minDist) {
            minDist = d;
            nearest = b;
        }
    }
    return nearest;
}

export function rectOverlap(r1: { l: number, r: number, t: number, b: number }, r2: { l: number, r: number, t: number, b: number }): boolean {
    return !(r2.l > r1.r || r2.r < r1.l || r2.t > r1.b || r2.b < r1.t);
}

export function isValidPlacement(
    x: number,
    y: number,
    w: number,
    h: number,
    state: GameState,
    myBuildings: Entity[],
    buildingKey: string
): boolean {
    const margin = 25;
    const mapMargin = 50;
    const BUILD_RADIUS = 400;

    if (x < mapMargin || x > state.config.width - mapMargin ||
        y < mapMargin || y > state.config.height - mapMargin) {
        return false;
    }

    if (myBuildings.length > 0) {
        let withinRange = false;
        for (const b of myBuildings) {
            const bData = RULES.buildings[b.key];
            if (bData?.isDefense) continue;
            const dist = Math.sqrt((x - b.pos.x) ** 2 + (y - b.pos.y) ** 2);
            if (dist < BUILD_RADIUS) {
                withinRange = true;
                break;
            }
        }
        if (!withinRange) return false;
    }

    const myRect = {
        l: x - w / 2 - margin,
        r: x + w / 2 + margin,
        t: y - h / 2 - margin,
        b: y + h / 2 + margin
    };

    const entities = Object.values(state.entities);
    for (const e of entities) {
        if (e.dead) continue;
        if (e.type === 'BUILDING' || e.type === 'RESOURCE' || e.type === 'ROCK') {
            const eRect = {
                l: e.pos.x - e.w / 2,
                r: e.pos.x + e.w / 2,
                t: e.pos.y - e.h / 2,
                b: e.pos.y + e.h / 2
            };
            if (rectOverlap(myRect, eRect)) return false;
        }

        if (e.key === 'refinery' && e.type === 'BUILDING') {
            const dockRect = {
                l: e.pos.x - 30,
                r: e.pos.x + 30,
                t: e.pos.y + 40,
                b: e.pos.y + 100
            };
            if (rectOverlap(myRect, dockRect)) return false;
        }
    }

    if (buildingKey === 'refinery') {
        const myDockRect = {
            l: x - 30,
            r: x + 30,
            t: y + 40,
            b: y + 100
        };

        for (const e of entities) {
            if (e.dead) continue;
            if (e.type === 'BUILDING' || e.type === 'RESOURCE') {
                const eRect = {
                    l: e.pos.x - e.w / 2,
                    r: e.pos.x + e.w / 2,
                    t: e.pos.y - e.h / 2,
                    b: e.pos.y + e.h / 2
                };
                if (rectOverlap(myDockRect, eRect)) return false;
            }
        }
    }

    return true;
}

// ===== COUNTER-BUILDING LOGIC =====

export function getCounterUnits(
    dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed',
    _defaultPrefs?: { infantry?: string[]; vehicle?: string[] }
): CounterUnits {
    switch (dominantArmor) {
        case 'infantry':
            return {
                infantry: ['flamer', 'sniper', 'grenadier', 'rifle'],
                vehicle: ['flame_tank', 'apc', 'light']
            };
        case 'heavy':
            return {
                infantry: ['rocket'],
                vehicle: ['mlrs', 'artillery', 'mammoth', 'heavy']
            };
        case 'light':
            return {
                infantry: ['commando', 'rifle', 'rocket'],
                vehicle: ['light', 'heavy', 'stealth']
            };
        case 'mixed':
        default:
            return {
                infantry: ['rifle', 'rocket', 'flamer'],
                vehicle: ['heavy', 'light', 'flame_tank']
            };
    }
}

export function checkPrerequisites(key: string, playerBuildings: Entity[]): boolean {
    const unitData = RULES.units[key];
    const buildingData = RULES.buildings[key];
    const prereqs = unitData?.prerequisites || buildingData?.prerequisites || [];
    return prereqs.every((req: string) => playerBuildings.some(b => b.key === req));
}

export function hasProductionBuildingFor(category: string, playerBuildings: Entity[]): boolean {
    const validBuildings: string[] = RULES.productionBuildings?.[category] || [];
    return playerBuildings.some(b => validBuildings.includes(b.key) && !b.dead);
}

export function countProductionBuildings(category: string, playerBuildings: Entity[]): number {
    const validBuildings: string[] = RULES.productionBuildings?.[category] || [];
    return playerBuildings.filter(b => validBuildings.includes(b.key) && !b.dead).length;
}

export function getProductionBuildingsFor(category: string): string[] {
    return RULES.productionBuildings?.[category] || [];
}

export function isRefineryUseful(refinery: Entity, state: GameState): boolean {
    const USEFUL_ORE_DISTANCE = 600;
    const CONYARD_COVERAGE_RADIUS = 500; // Same as expansion refinery build logic

    // Check if refinery is near a friendly conyard (expansion base support)
    // This prevents selling refineries built for expansion bases
    const friendlyConyards = Object.values(state.entities).filter(e =>
        e.type === 'BUILDING' && e.key === 'conyard' && e.owner === refinery.owner && !e.dead
    );
    for (const conyard of friendlyConyards) {
        if (refinery.pos.dist(conyard.pos) < CONYARD_COVERAGE_RADIUS) {
            return true; // Refinery supports this conyard/expansion
        }
    }

    // Check if refinery is near ore
    const allOre = Object.values(state.entities).filter(e => e.type === 'RESOURCE' && !e.dead);
    for (const ore of allOre) {
        if (refinery.pos.dist(ore.pos) < USEFUL_ORE_DISTANCE) {
            return true;
        }
    }
    return false;
}

export function getPriorityIndex(key: string, priorityList: string[]): number {
    const idx = priorityList.indexOf(key);
    return idx === -1 ? 99 : idx;
}

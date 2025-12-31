/**
 * AI Spatial Utilities
 *
 * Distance calculations, area queries, and spatial helpers for AI decision-making.
 */

import { Entity, Vector } from '../../types.js';
import { RULES } from '../../../data/schemas/index.js';
import { AI_CONSTANTS } from '../types.js';

// ============ BUILDING FILTERS ============

/**
 * Get all non-defense buildings (excludes turrets, pillboxes, obelisks, SAMs, etc.)
 * Used for determining build range and placement restrictions.
 */
export function getNonDefenseBuildings(buildings: Entity[]): Entity[] {
    return buildings.filter(b => {
        const data = RULES.buildings[b.key];
        return !data?.isDefense && !b.dead;
    });
}

/**
 * Get all defense buildings (turrets, pillboxes, obelisks, SAMs, etc.)
 */
export function getDefenseBuildings(buildings: Entity[]): Entity[] {
    return buildings.filter(b => {
        const data = RULES.buildings[b.key];
        return data?.isDefense && !b.dead;
    });
}

/**
 * Get all refineries from a building list.
 */
export function getRefineries(buildings: Entity[]): Entity[] {
    return buildings.filter(b => b.key === 'refinery' && !b.dead);
}

// ============ RESOURCE UTILITIES ============

/**
 * Get all alive ore resources from the game state.
 */
export function getAllOre(entities: Record<string, Entity>): Entity[] {
    return Object.values(entities).filter(e => e.type === 'RESOURCE' && !e.dead);
}

/**
 * Filter ore that is accessible (within build range of non-defense buildings).
 */
export function getAccessibleOre(
    ore: Entity[],
    buildings: Entity[],
    maxDist: number = AI_CONSTANTS.BUILD_RADIUS + 200
): Entity[] {
    const nonDefense = getNonDefenseBuildings(buildings);
    return ore.filter(o => nonDefense.some(b => b.pos.dist(o.pos) < maxDist));
}

/**
 * Find the nearest uncovered ore (ore without a nearby refinery).
 */
export function findNearestUncoveredOre(
    entities: Record<string, Entity>,
    buildings: Entity[],
    coverageRadius: number = AI_CONSTANTS.ORE_COVERAGE_RADIUS
): Entity | null {
    const refineries = getRefineries(buildings);
    const nonDefense = getNonDefenseBuildings(buildings);
    const allOre = getAllOre(entities);

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

// ============ DISTANCE UTILITIES ============

/**
 * Check if a position is within build range of any non-defense building.
 */
export function isWithinBuildRange(pos: Vector, buildings: Entity[]): boolean {
    const nonDefense = getNonDefenseBuildings(buildings);
    return nonDefense.some(b => pos.dist(b.pos) < AI_CONSTANTS.BUILD_RADIUS);
}

/**
 * Find the nearest building to a position.
 */
export function findNearestBuilding(
    pos: Vector,
    buildings: Entity[],
    filterKey?: string
): Entity | null {
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

/**
 * Find the center of a group of buildings (base center)
 */
export function findBaseCenter(buildings: Entity[]): Vector {
    const conyard = buildings.find(b => b.key === 'conyard');
    if (conyard) return conyard.pos;
    if (buildings.length === 0) return new Vector(300, 300);

    let sumX = 0, sumY = 0;
    for (const b of buildings) {
        sumX += b.pos.x;
        sumY += b.pos.y;
    }
    return new Vector(sumX / buildings.length, sumY / buildings.length);
}

/**
 * Find distant ore for expansion targeting
 */
export function findDistantOre(
    entities: Record<string, Entity>,
    buildings: Entity[]
): Vector | null {
    const allOre = Object.values(entities).filter(e =>
        e.type === 'RESOURCE' && !e.dead && e.hp > 200
    );
    const nonDefenseBuildings = getNonDefenseBuildings(buildings);

    const BUILD_RADIUS = 400;

    // FIRST: Check if there's already accessible ore within build range that doesn't have a refinery
    for (const ore of allOre) {
        const hasNearbyRefinery = buildings.some(b =>
            b.key === 'refinery' && b.pos.dist(ore.pos) < 250
        );
        if (hasNearbyRefinery) continue;

        for (const b of nonDefenseBuildings) {
            if (b.pos.dist(ore.pos) < BUILD_RADIUS + 150) {
                // Found accessible ore that's not covered by a refinery
                return null;
            }
        }
    }

    // Only look for distant ore if no accessible unclaimed ore exists
    let bestOre: Vector | null = null;
    let bestScore = -Infinity;

    for (const ore of allOre) {
        const hasNearbyRefinery = buildings.some(b =>
            b.key === 'refinery' && b.pos.dist(ore.pos) < 250
        );
        if (hasNearbyRefinery) continue;

        let minDistToBuilding = Infinity;
        for (const b of nonDefenseBuildings) {
            const d = b.pos.dist(ore.pos);
            if (d < minDistToBuilding) minDistToBuilding = d;
        }

        // Prefer ore that's 400-1200 units away (not too close, not too far)
        if (minDistToBuilding >= 400 && minDistToBuilding <= 1500) {
            const score = 1000 - Math.abs(minDistToBuilding - 800);
            if (score > bestScore) {
                bestScore = score;
                bestOre = ore.pos;
            }
        }
    }

    return bestOre;
}

/**
 * AI Production Utilities
 *
 * Prerequisites checking, production building queries, and build planning.
 */

import { Entity } from '../../types.js';
import { RULES } from '../../../data/schemas/index.js';

// ============ PREREQUISITES ============

/**
 * Check if prerequisites are met for a building or unit.
 */
export function checkPrerequisites(key: string, playerBuildings: Entity[]): boolean {
    const unitData = RULES.units[key];
    const buildingData = RULES.buildings[key];
    const prereqs = unitData?.prerequisites || buildingData?.prerequisites || [];
    return prereqs.every((req: string) => playerBuildings.some(b => b.key === req && !b.dead));
}

/**
 * Get the list of prerequisites for a building or unit
 */
export function getPrerequisites(key: string): string[] {
    const unitData = RULES.units[key];
    const buildingData = RULES.buildings[key];
    return unitData?.prerequisites || buildingData?.prerequisites || [];
}

/**
 * Get missing prerequisites for a building or unit
 */
export function getMissingPrerequisites(key: string, playerBuildings: Entity[]): string[] {
    const prereqs = getPrerequisites(key);
    return prereqs.filter(req => !playerBuildings.some(b => b.key === req && !b.dead));
}

// ============ PRODUCTION BUILDINGS ============

/**
 * Check if player has a production building for a given category.
 */
export function hasProductionBuildingFor(category: string, playerBuildings: Entity[]): boolean {
    const validBuildings: string[] = RULES.productionBuildings?.[category] || [];
    return playerBuildings.some(b => validBuildings.includes(b.key) && !b.dead);
}

/**
 * Count how many production buildings a player has for a given category.
 */
export function countProductionBuildings(category: string, playerBuildings: Entity[]): number {
    const validBuildings: string[] = RULES.productionBuildings?.[category] || [];
    return playerBuildings.filter(b => validBuildings.includes(b.key) && !b.dead).length;
}

/**
 * Get the list of buildings that enable production for a category.
 */
export function getProductionBuildingsFor(category: string): string[] {
    return RULES.productionBuildings?.[category] || [];
}

// ============ COST QUERIES ============

/**
 * Get the cost of a unit or building
 */
export function getCost(key: string): number {
    const unitData = RULES.units[key];
    const buildingData = RULES.buildings[key];
    return unitData?.cost || buildingData?.cost || 0;
}

/**
 * Check if player can afford a unit or building
 */
export function canAfford(key: string, credits: number): boolean {
    return credits >= getCost(key);
}

// ============ BUILD ORDER HELPERS ============

/**
 * Get the next building to construct based on build order priority
 */
export function getNextBuildOrderItem(
    buildOrderPriority: string[],
    playerBuildings: Entity[],
    credits: number
): string | null {
    for (const key of buildOrderPriority) {
        // Skip if we already have this building
        if (playerBuildings.some(b => b.key === key && !b.dead)) continue;

        // Check prerequisites
        if (!checkPrerequisites(key, playerBuildings)) continue;

        // Check affordability
        if (!canAfford(key, credits)) continue;

        return key;
    }
    return null;
}

/**
 * Get all available units that can be built for a category
 */
export function getAvailableUnits(
    category: 'infantry' | 'vehicle' | 'air',
    playerBuildings: Entity[],
    preferredUnits: string[] = []
): string[] {
    // Get all units for the category (units use 'type' field for category)
    const allUnits = Object.keys(RULES.units).filter(key => {
        const unit = RULES.units[key];
        return unit.type === category;
    });

    // Filter to those with met prerequisites
    const available = allUnits.filter(key => checkPrerequisites(key, playerBuildings));

    // Sort by preference (preferred units first)
    return available.sort((a, b) => {
        const aIndex = preferredUnits.indexOf(a);
        const bIndex = preferredUnits.indexOf(b);
        // -1 means not in preferred list, put at end
        if (aIndex === -1 && bIndex === -1) return 0;
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
    });
}

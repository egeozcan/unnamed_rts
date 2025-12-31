/**
 * Squad Formation System
 *
 * Calculates unit positions for various formation types.
 */

import { Entity, Vector, EntityId } from '../../types.js';
import { RULES } from '../../../data/schemas/index.js';
import { Formation, UnitRole } from './types.js';

// ============ FORMATION CONSTANTS ============

const FORMATION_SPACING = 60; // Default spacing between units

// ============ FORMATION CALCULATIONS ============

/**
 * Calculate positions for units in a formation
 *
 * @param units Units to arrange
 * @param center Center point of the formation
 * @param facing Direction the formation faces (normalized vector)
 * @param formation Type of formation
 * @param spacing Distance between units
 * @returns Map of unit IDs to their target positions
 */
export function calculateFormationPositions(
    units: Entity[],
    center: Vector,
    facing: Vector,
    formation: Formation,
    spacing: number = FORMATION_SPACING
): Map<EntityId, Vector> {
    switch (formation) {
        case 'line':
            return calculateLineFormation(units, center, facing, spacing);
        case 'wedge':
            return calculateWedgeFormation(units, center, facing, spacing);
        case 'box':
            return calculateBoxFormation(units, center, facing, spacing);
        case 'concave':
            return calculateConcaveFormation(units, center, facing, spacing);
        case 'spread':
            return calculateSpreadFormation(units, center, spacing);
        default:
            return calculateLineFormation(units, center, facing, spacing);
    }
}

/**
 * Line formation - units spread perpendicular to movement direction
 * Best for: Charging into combat, maximizing frontline
 */
function calculateLineFormation(
    units: Entity[],
    center: Vector,
    facing: Vector,
    spacing: number
): Map<EntityId, Vector> {
    const positions = new Map<EntityId, Vector>();

    // Sort units by durability (tanks front)
    const sorted = sortByDurability(units);

    // Perpendicular direction to facing
    const perpendicular = new Vector(-facing.y, facing.x);

    const count = sorted.length;
    const halfWidth = ((count - 1) * spacing) / 2;

    for (let i = 0; i < count; i++) {
        const offset = -halfWidth + i * spacing;
        const pos = center.add(perpendicular.scale(offset));
        positions.set(sorted[i].id, pos);
    }

    return positions;
}

/**
 * Wedge formation - V-shape pointing toward enemy
 * Best for: Assaults, tanks in front
 */
function calculateWedgeFormation(
    units: Entity[],
    center: Vector,
    facing: Vector,
    spacing: number
): Map<EntityId, Vector> {
    const positions = new Map<EntityId, Vector>();

    // Sort units by durability (most durable at front/tip)
    const sorted = sortByDurability(units);

    const perpendicular = new Vector(-facing.y, facing.x);

    // First unit at the tip
    if (sorted.length > 0) {
        positions.set(sorted[0].id, center.add(facing.scale(spacing)));
    }

    // Remaining units form the V
    for (let i = 1; i < sorted.length; i++) {
        const row = Math.ceil(i / 2);
        const side = i % 2 === 1 ? 1 : -1;

        // Each row is further back and wider
        const backOffset = -row * spacing * 0.7;
        const sideOffset = row * spacing * side;

        const pos = center
            .add(facing.scale(backOffset))
            .add(perpendicular.scale(sideOffset));
        positions.set(sorted[i].id, pos);
    }

    return positions;
}

/**
 * Box formation - defensive square with fragile units in center
 * Best for: Defending, protecting harvesters
 */
function calculateBoxFormation(
    units: Entity[],
    center: Vector,
    facing: Vector,
    spacing: number
): Map<EntityId, Vector> {
    const positions = new Map<EntityId, Vector>();

    // Sort by durability - tough units on edges
    const sorted = sortByDurability(units);

    const count = sorted.length;
    if (count === 0) return positions;

    // Calculate box dimensions
    const sideLength = Math.ceil(Math.sqrt(count));
    const perpendicular = new Vector(-facing.y, facing.x);

    // Place units in a grid
    for (let i = 0; i < count; i++) {
        const row = Math.floor(i / sideLength);
        const col = i % sideLength;

        // Center the grid
        const rowOffset = (row - (sideLength - 1) / 2) * spacing;
        const colOffset = (col - (sideLength - 1) / 2) * spacing;

        const pos = center
            .add(facing.scale(rowOffset))
            .add(perpendicular.scale(colOffset));
        positions.set(sorted[i].id, pos);
    }

    return positions;
}

/**
 * Concave formation - arc facing enemy for focus fire
 * Best for: Ranged combat, surrounding targets
 */
function calculateConcaveFormation(
    units: Entity[],
    center: Vector,
    facing: Vector,
    spacing: number
): Map<EntityId, Vector> {
    const positions = new Map<EntityId, Vector>();

    // Sort by range (ranged units on flanks)
    const sorted = sortByRange(units);

    const count = sorted.length;
    if (count === 0) return positions;

    // Calculate arc parameters
    const arcAngle = Math.PI * 0.6; // 108 degree arc
    const radius = (count * spacing) / arcAngle;

    // Center of arc is behind the formation center
    const arcCenter = center.add(facing.scale(-radius));

    // Base angle (facing direction)
    const baseAngle = Math.atan2(facing.y, facing.x);

    for (let i = 0; i < count; i++) {
        // Distribute evenly along arc
        const t = count > 1 ? i / (count - 1) : 0.5;
        const angle = baseAngle + arcAngle * (t - 0.5);

        const pos = arcCenter.add(new Vector(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius
        ));
        positions.set(sorted[i].id, pos);
    }

    return positions;
}

/**
 * Spread formation - maximum spacing to avoid splash
 * Best for: Against artillery, area denial
 */
function calculateSpreadFormation(
    units: Entity[],
    center: Vector,
    spacing: number
): Map<EntityId, Vector> {
    const positions = new Map<EntityId, Vector>();

    const count = units.length;
    if (count === 0) return positions;

    // Spread in a circle around center
    const spreadSpacing = spacing * 1.5; // Extra spacing

    if (count === 1) {
        positions.set(units[0].id, center);
        return positions;
    }

    // Calculate radius to achieve desired spacing
    const circumference = count * spreadSpacing;
    const radius = circumference / (2 * Math.PI);

    for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        const pos = center.add(new Vector(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius
        ));
        positions.set(units[i].id, pos);
    }

    return positions;
}

// ============ SORTING UTILITIES ============

/**
 * Sort units by durability (HP * armor factor)
 * Most durable first
 */
function sortByDurability(units: Entity[]): Entity[] {
    return [...units].sort((a, b) => {
        const aData = RULES.units?.[a.key];
        const bData = RULES.units?.[b.key];

        const aArmor = getArmorFactor(aData?.armor || 'none');
        const bArmor = getArmorFactor(bData?.armor || 'none');

        const aDurability = a.maxHp * aArmor;
        const bDurability = b.maxHp * bArmor;

        return bDurability - aDurability; // Descending
    });
}

/**
 * Sort units by range
 * Longest range first
 */
function sortByRange(units: Entity[]): Entity[] {
    return [...units].sort((a, b) => {
        const aData = RULES.units?.[a.key];
        const bData = RULES.units?.[b.key];

        const aRange = aData?.range || 0;
        const bRange = bData?.range || 0;

        return bRange - aRange; // Descending
    });
}

/**
 * Get armor factor for sorting
 */
function getArmorFactor(armor: string): number {
    switch (armor) {
        case 'heavy': return 2.0;
        case 'medium': return 1.5;
        case 'light': return 1.0;
        case 'infantry': return 0.8;
        case 'none': return 0.5;
        default: return 1.0;
    }
}

// ============ ROLE ASSIGNMENT ============

/**
 * Assign roles to units in a squad based on their capabilities
 */
export function assignRoles(units: Entity[]): Map<EntityId, UnitRole> {
    const roles = new Map<EntityId, UnitRole>();

    for (const unit of units) {
        const data = RULES.units?.[unit.key];
        if (!data) {
            roles.set(unit.id, 'damage');
            continue;
        }

        // Determine role based on unit characteristics
        if (data.armor === 'heavy' || data.armor === 'medium') {
            roles.set(unit.id, 'frontline');
        } else if (data.damage < 0) {
            // Negative damage = healer
            roles.set(unit.id, 'support');
        } else if (data.speed > 3.5) {
            // Fast units as scouts
            roles.set(unit.id, 'scout');
        } else {
            roles.set(unit.id, 'damage');
        }
    }

    return roles;
}

// ============ FORMATION ANALYSIS ============

/**
 * Determine the best formation for a situation
 */
export function suggestFormation(
    _enemyCount: number,
    hasEnemySplash: boolean,
    isDefending: boolean,
    squadSize: number
): Formation {
    // Against splash damage, always spread
    if (hasEnemySplash) {
        return 'spread';
    }

    // Defending - use line or concave
    if (isDefending) {
        return squadSize > 6 ? 'concave' : 'line';
    }

    // Large squad attacking - wedge
    if (squadSize >= 8) {
        return 'wedge';
    }

    // Small squad - line for simplicity
    if (squadSize <= 4) {
        return 'line';
    }

    // Medium squad - concave for focus fire
    return 'concave';
}

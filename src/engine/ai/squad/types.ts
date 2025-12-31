/**
 * Squad System Types
 *
 * Defines data structures for coordinated unit groups.
 */

import { EntityId, Vector } from '../../types.js';

// ============ SQUAD TYPES ============

/**
 * Types of squads with different purposes
 */
export type SquadType = 'attack' | 'defense' | 'harass' | 'scout' | 'escort';

/**
 * Squad behavior states
 */
export type SquadStatus = 'forming' | 'moving' | 'engaging' | 'retreating' | 'disbanding';

/**
 * Formation types
 */
export type Formation = 'line' | 'wedge' | 'box' | 'concave' | 'spread';

/**
 * Role assigned to a unit within a squad
 */
export type UnitRole = 'frontline' | 'damage' | 'support' | 'scout';

// ============ SQUAD DATA ============

/**
 * A squad is a coordinated group of units
 */
export interface Squad {
    /** Unique identifier */
    id: string;

    /** Purpose of this squad */
    type: SquadType;

    /** Units in this squad */
    unitIds: EntityId[];

    /** Current behavior state */
    status: SquadStatus;

    /** Current formation */
    formation: Formation;

    /** Target entity or position */
    target: EntityId | Vector | null;

    /** Rally/gathering point */
    rallyPoint: Vector | null;

    /** When the last order was issued */
    lastOrderTick: number;

    /** When the squad was created */
    createdTick: number;

    /** Role assignments for units */
    roles: Map<EntityId, UnitRole>;
}

/**
 * Configuration for squad behavior
 */
export interface SquadConfig {
    /** Minimum units required to form this squad type */
    minSize: number;

    /** Maximum units allowed in squad */
    maxSize: number;

    /** How long to wait for stragglers (ticks) */
    formingTimeout: number;

    /** HP ratio threshold to trigger retreat */
    retreatThreshold: number;

    /** Distance units should be from each other in formation */
    formationSpacing: number;

    /** Preferred formation for this squad type */
    preferredFormation: Formation;
}

// ============ SQUAD DEFAULTS ============

export const DEFAULT_SQUAD_CONFIGS: Record<SquadType, SquadConfig> = {
    attack: {
        minSize: 5,
        maxSize: 20,
        formingTimeout: 300, // 5 seconds
        retreatThreshold: 0.3,
        formationSpacing: 60,
        preferredFormation: 'wedge'
    },
    defense: {
        minSize: 2,
        maxSize: 15,
        formingTimeout: 120, // 2 seconds (faster response)
        retreatThreshold: 0.2, // Fight harder when defending
        formationSpacing: 50,
        preferredFormation: 'line'
    },
    harass: {
        minSize: 3,
        maxSize: 5,
        formingTimeout: 180,
        retreatThreshold: 0.4, // Retreat sooner
        formationSpacing: 80, // More spread
        preferredFormation: 'spread'
    },
    scout: {
        minSize: 1,
        maxSize: 2,
        formingTimeout: 60,
        retreatThreshold: 0.5, // Very cautious
        formationSpacing: 100,
        preferredFormation: 'spread'
    },
    escort: {
        minSize: 2,
        maxSize: 8,
        formingTimeout: 180,
        retreatThreshold: 0.25,
        formationSpacing: 50,
        preferredFormation: 'box'
    }
};

// ============ FACTORY FUNCTIONS ============

/**
 * Create a new squad with default values
 */
export function createSquad(
    id: string,
    type: SquadType,
    unitIds: EntityId[],
    tick: number
): Squad {
    const config = DEFAULT_SQUAD_CONFIGS[type];
    return {
        id,
        type,
        unitIds,
        status: 'forming',
        formation: config.preferredFormation,
        target: null,
        rallyPoint: null,
        lastOrderTick: tick,
        createdTick: tick,
        roles: new Map()
    };
}

/**
 * Generate a unique squad ID
 */
let squadIdCounter = 0;
export function generateSquadId(type: SquadType): string {
    return `${type}_${++squadIdCounter}_${Date.now().toString(36)}`;
}

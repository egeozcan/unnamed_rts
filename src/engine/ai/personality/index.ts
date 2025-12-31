/**
 * Extended AI Personality System
 *
 * Adds new personality traits beyond the base system for more
 * distinctive AI behaviors.
 */

import { ExtendedStrategy } from '../strategy/new-strategies.js';
import { Formation } from '../squad/types.js';

// ============ PERSONALITY TRAITS ============

/**
 * Extended personality traits for nuanced AI behavior
 */
export interface ExtendedPersonalityTraits {
    // === Combat Style ===
    /** 0-1: How much micro-management to perform (kiting, retreat, spread) */
    micro_intensity: number;

    /** 0-1: Willingness to attack in unfavorable situations */
    risk_tolerance: number;

    /** 0-1: How quickly to commit forces once engaged */
    aggression_escalation: number;

    // === Strategic Preferences ===
    /** 0-1: Preference for tech buildings over unit spam */
    tech_preference: number;

    /** 0-1: How eager to expand to new resource nodes */
    expansion_eagerness: number;

    /** 0-1: Investment in defensive structures */
    defense_investment: number;

    // === Intelligence ===
    /** 0-1: How often to scout and gather intel */
    scout_frequency: number;

    /** 0-1: How much to adapt based on enemy composition */
    adaptability: number;

    // === Group Tactics ===
    /** Preferred formation for attacks */
    preferred_formation: Formation;

    /** Preferred strategies (in order of preference) */
    preferred_strategies: ExtendedStrategy[];

    // === Economy ===
    /** Target number of harvesters per refinery */
    harvesters_per_refinery: number;

    /** Credit threshold before spending on military */
    economy_buffer: number;
}

// ============ DEFAULT TRAITS ============

export const DEFAULT_TRAITS: ExtendedPersonalityTraits = {
    micro_intensity: 0.5,
    risk_tolerance: 0.5,
    aggression_escalation: 0.5,
    tech_preference: 0.5,
    expansion_eagerness: 0.5,
    defense_investment: 0.5,
    scout_frequency: 0.3,
    adaptability: 0.5,
    preferred_formation: 'line',
    preferred_strategies: ['buildup', 'attack'],
    harvesters_per_refinery: 2,
    economy_buffer: 500
};

// ============ PERSONALITY ARCHETYPES ============

/**
 * Predefined personality archetypes with distinctive playstyles
 */
export const PERSONALITY_ARCHETYPES: Record<string, ExtendedPersonalityTraits> = {
    /**
     * Micro Master: High micro, harass-focused, hit-and-run tactics
     */
    micro_master: {
        micro_intensity: 1.0,
        risk_tolerance: 0.4,
        aggression_escalation: 0.6,
        tech_preference: 0.3,
        expansion_eagerness: 0.4,
        defense_investment: 0.2,
        scout_frequency: 0.7,
        adaptability: 0.8,
        preferred_formation: 'spread',
        preferred_strategies: ['harass', 'timing_push', 'attack'],
        harvesters_per_refinery: 2,
        economy_buffer: 300
    },

    /**
     * Strategist: High scouting, tech-focused, adapts to enemy
     */
    strategist: {
        micro_intensity: 0.5,
        risk_tolerance: 0.3,
        aggression_escalation: 0.4,
        tech_preference: 0.9,
        expansion_eagerness: 0.6,
        defense_investment: 0.5,
        scout_frequency: 0.9,
        adaptability: 1.0,
        preferred_formation: 'concave',
        preferred_strategies: ['tech_rush', 'air_dominance', 'attack'],
        harvesters_per_refinery: 2,
        economy_buffer: 800
    },

    /**
     * Economist: Maximum economy, delayed but overwhelming force
     */
    economist: {
        micro_intensity: 0.3,
        risk_tolerance: 0.2,
        aggression_escalation: 0.3,
        tech_preference: 0.4,
        expansion_eagerness: 1.0,
        defense_investment: 0.4,
        scout_frequency: 0.4,
        adaptability: 0.5,
        preferred_formation: 'box',
        preferred_strategies: ['eco_boom', 'turtle', 'attack'],
        harvesters_per_refinery: 3,
        economy_buffer: 2000
    },

    /**
     * Berserker: Maximum aggression, early attacks, risky plays
     */
    berserker: {
        micro_intensity: 0.4,
        risk_tolerance: 1.0,
        aggression_escalation: 1.0,
        tech_preference: 0.1,
        expansion_eagerness: 0.2,
        defense_investment: 0.1,
        scout_frequency: 0.2,
        adaptability: 0.2,
        preferred_formation: 'wedge',
        preferred_strategies: ['timing_push', 'attack', 'harass'],
        harvesters_per_refinery: 1,
        economy_buffer: 0
    },

    /**
     * Fortress: Maximum defense, slow but impenetrable
     */
    fortress: {
        micro_intensity: 0.6,
        risk_tolerance: 0.1,
        aggression_escalation: 0.2,
        tech_preference: 0.6,
        expansion_eagerness: 0.3,
        defense_investment: 1.0,
        scout_frequency: 0.5,
        adaptability: 0.4,
        preferred_formation: 'line',
        preferred_strategies: ['turtle', 'defend', 'attack'],
        harvesters_per_refinery: 2,
        economy_buffer: 1500
    },

    /**
     * Opportunist: Adapts quickly, exploits weaknesses
     */
    opportunist: {
        micro_intensity: 0.7,
        risk_tolerance: 0.6,
        aggression_escalation: 0.7,
        tech_preference: 0.5,
        expansion_eagerness: 0.6,
        defense_investment: 0.3,
        scout_frequency: 0.8,
        adaptability: 0.9,
        preferred_formation: 'wedge',
        preferred_strategies: ['harass', 'attack', 'timing_push'],
        harvesters_per_refinery: 2,
        economy_buffer: 400
    }
};

// ============ TRAIT MODIFIERS ============

/**
 * Apply personality traits to modify AI behavior values
 */
export function applyTraitModifiers(
    baseValue: number,
    trait: number,
    traitInfluence: number = 0.5
): number {
    // Trait ranges from 0-1, modifies base value
    const modifier = 0.5 + (trait * traitInfluence);
    return baseValue * modifier;
}

/**
 * Calculate attack threshold based on personality
 */
export function calculateAttackThreshold(
    baseThreshold: number,
    traits: ExtendedPersonalityTraits
): number {
    // Lower threshold for aggressive personalities
    const riskModifier = 1 - (traits.risk_tolerance * 0.4);
    return Math.max(2, Math.floor(baseThreshold * riskModifier));
}

/**
 * Calculate retreat threshold based on personality
 */
export function calculateRetreatThreshold(
    baseThreshold: number,
    traits: ExtendedPersonalityTraits
): number {
    // Higher threshold (retreat sooner) for cautious personalities
    const riskModifier = 1 - (traits.risk_tolerance * 0.5);
    return Math.min(0.6, baseThreshold * riskModifier + 0.1);
}

/**
 * Determine if AI should perform micro in current situation
 */
export function shouldPerformMicro(
    traits: ExtendedPersonalityTraits,
    unitCount: number,
    cpuBudgetRemaining: number
): boolean {
    // Don't micro if too many units (performance)
    if (unitCount > 20 && traits.micro_intensity < 0.8) return false;

    // Don't micro if CPU budget is low
    if (cpuBudgetRemaining < 0.3) return false;

    // Micro based on intensity trait
    return traits.micro_intensity > 0.3;
}

/**
 * Determine how many scouts to assign based on personality
 */
export function calculateScoutCount(
    traits: ExtendedPersonalityTraits,
    availableUnits: number
): number {
    const maxScouts = Math.floor(traits.scout_frequency * 3) + 1;
    const affordable = Math.floor(availableUnits * 0.1); // Max 10% of army as scouts
    return Math.min(maxScouts, affordable, 3);
}

/**
 * Determine defense building count target
 */
export function calculateDefenseTarget(
    traits: ExtendedPersonalityTraits,
    currentDefenses: number,
    credits: number
): number {
    const baseTarget = Math.floor(traits.defense_investment * 6) + 1;
    const canAfford = Math.floor(credits / 800);
    return Math.min(baseTarget, currentDefenses + canAfford);
}

// ============ DIFFICULTY MAPPING ============

/**
 * Map difficulty levels to personality archetypes
 */
export const DIFFICULTY_TO_ARCHETYPE: Record<string, string> = {
    easy: 'economist',    // Slow, methodical, predictable
    medium: 'opportunist', // Adaptive, balanced
    hard: 'strategist'    // Tech-focused, adaptive
};

/**
 * Get extended traits for a difficulty level
 */
export function getTraitsForDifficulty(difficulty: 'easy' | 'medium' | 'hard'): ExtendedPersonalityTraits {
    const archetype = DIFFICULTY_TO_ARCHETYPE[difficulty] || 'opportunist';
    return PERSONALITY_ARCHETYPES[archetype] || DEFAULT_TRAITS;
}

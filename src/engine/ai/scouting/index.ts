/**
 * AI Scouting System
 *
 * Manages intelligence gathering:
 * - Scout assignment and patrol routes
 * - Enemy tracking and intel analysis
 * - Threat prediction
 */

import { Entity, Vector, Action, GameState, EntityId } from '../../types.js';
import { RULES } from '../../../data/schemas/index.js';

// ============ TYPES ============

/**
 * Enemy intel tracking
 */
export interface EnemyIntel {
    playerId: number;
    lastSeen: number;
    buildings: Map<EntityId, BuildingIntel>;
    units: Map<EntityId, UnitIntel>;
    techLevel: 'low' | 'mid' | 'high';
    estimatedCredits: number;
    baseLocation: Vector | null;
    expansions: Vector[];
}

export interface BuildingIntel {
    id: EntityId;
    key: string;
    pos: Vector;
    lastSeenHp: number;
    lastSeenTick: number;
    destroyed: boolean;
}

export interface UnitIntel {
    id: EntityId;
    key: string;
    pos: Vector;
    lastSeenTick: number;
}

/**
 * Scout assignment
 */
export interface ScoutAssignment {
    unitId: EntityId;
    patrolRoute: Vector[];
    currentWaypointIdx: number;
    lastOrderTick: number;
    status: 'patrolling' | 'fleeing' | 'returning';
}

/**
 * Scouting configuration
 */
export interface ScoutingConfig {
    /** Preferred unit types for scouting (fastest first) */
    preferredScouts: string[];
    /** Maximum scouts to assign */
    maxScouts: number;
    /** Patrol waypoint spacing */
    waypointSpacing: number;
    /** How long intel is considered fresh (ticks) */
    intelFreshness: number;
    /** Distance to flee from enemies */
    fleeDistance: number;
}

// ============ DEFAULT CONFIG ============

export const DEFAULT_SCOUTING_CONFIG: ScoutingConfig = {
    preferredScouts: ['jeep', 'light', 'rifle'],
    maxScouts: 2,
    waypointSpacing: 400,
    intelFreshness: 1800, // 30 seconds
    fleeDistance: 300
};

// ============ SCOUT MANAGER ============

/**
 * Manages scouting operations for a player
 */
export class ScoutManager {
    private intel: Map<number, EnemyIntel> = new Map();
    private scouts: Map<EntityId, ScoutAssignment> = new Map();
    private config: ScoutingConfig;

    constructor(_playerId: number, config: ScoutingConfig = DEFAULT_SCOUTING_CONFIG) {
        this.config = config;
    }

    /**
     * Get intel for an enemy player
     */
    getIntel(enemyPlayerId: number): EnemyIntel | undefined {
        return this.intel.get(enemyPlayerId);
    }

    /**
     * Get all enemy intel
     */
    getAllIntel(): EnemyIntel[] {
        return Array.from(this.intel.values());
    }

    /**
     * Update intel from visible entities
     */
    updateIntel(state: GameState, visibleEnemies: Entity[]): void {
        for (const enemy of visibleEnemies) {
            if (enemy.owner < 0) continue; // Skip neutral

            // Get or create intel for this player
            let playerIntel = this.intel.get(enemy.owner);
            if (!playerIntel) {
                playerIntel = this.createEmptyIntel(enemy.owner);
                this.intel.set(enemy.owner, playerIntel);
            }

            playerIntel.lastSeen = state.tick;

            if (enemy.type === 'BUILDING') {
                this.updateBuildingIntel(playerIntel, enemy, state.tick);
            } else if (enemy.type === 'UNIT') {
                this.updateUnitIntel(playerIntel, enemy, state.tick);
            }
        }

        // Update tech levels
        for (const intel of this.intel.values()) {
            this.updateTechLevel(intel);
        }
    }

    private updateBuildingIntel(intel: EnemyIntel, building: Entity, tick: number): void {
        const existing = intel.buildings.get(building.id);

        if (existing) {
            existing.pos = building.pos;
            existing.lastSeenHp = building.hp;
            existing.lastSeenTick = tick;
            existing.destroyed = building.dead;
        } else {
            intel.buildings.set(building.id, {
                id: building.id,
                key: building.key,
                pos: building.pos,
                lastSeenHp: building.hp,
                lastSeenTick: tick,
                destroyed: building.dead
            });
        }

        // Update base location
        if (building.key === 'conyard' || building.key === 'factory') {
            intel.baseLocation = building.pos;
        }

        // Track expansions (refineries far from base)
        if (building.key === 'refinery' && intel.baseLocation) {
            const distFromBase = building.pos.dist(intel.baseLocation);
            if (distFromBase > 600) {
                const isNewExpansion = !intel.expansions.some(e => e.dist(building.pos) < 200);
                if (isNewExpansion) {
                    intel.expansions.push(building.pos);
                }
            }
        }
    }

    private updateUnitIntel(intel: EnemyIntel, unit: Entity, tick: number): void {
        const existing = intel.units.get(unit.id);

        if (existing) {
            existing.pos = unit.pos;
            existing.lastSeenTick = tick;
        } else {
            intel.units.set(unit.id, {
                id: unit.id,
                key: unit.key,
                pos: unit.pos,
                lastSeenTick: tick
            });
        }
    }

    private updateTechLevel(intel: EnemyIntel): void {
        const hasFactory = Array.from(intel.buildings.values()).some(b =>
            b.key === 'factory' && !b.destroyed
        );
        const hasTech = Array.from(intel.buildings.values()).some(b =>
            b.key === 'tech' && !b.destroyed
        );
        const hasAdvancedUnits = Array.from(intel.units.values()).some(u =>
            ['mammoth', 'mlrs', 'artillery', 'heli'].includes(u.key)
        );

        if (hasTech || hasAdvancedUnits) {
            intel.techLevel = 'high';
        } else if (hasFactory) {
            intel.techLevel = 'mid';
        } else {
            intel.techLevel = 'low';
        }
    }

    private createEmptyIntel(playerId: number): EnemyIntel {
        return {
            playerId,
            lastSeen: 0,
            buildings: new Map(),
            units: new Map(),
            techLevel: 'low',
            estimatedCredits: 5000, // Assume starting credits
            baseLocation: null,
            expansions: []
        };
    }

    /**
     * Clean up stale intel
     */
    cleanupStaleIntel(currentTick: number): void {
        for (const intel of this.intel.values()) {
            // Remove stale unit intel (units move around)
            for (const [id, unit] of intel.units) {
                if (currentTick - unit.lastSeenTick > this.config.intelFreshness) {
                    intel.units.delete(id);
                }
            }
        }
    }

    /**
     * Assign a scout unit
     */
    assignScout(
        unitId: EntityId,
        baseCenter: Vector,
        mapWidth: number,
        mapHeight: number,
        tick: number
    ): void {
        if (this.scouts.size >= this.config.maxScouts) return;

        // Generate patrol route
        const route = this.generatePatrolRoute(baseCenter, mapWidth, mapHeight);

        this.scouts.set(unitId, {
            unitId,
            patrolRoute: route,
            currentWaypointIdx: 0,
            lastOrderTick: tick,
            status: 'patrolling'
        });
    }

    /**
     * Remove a scout assignment
     */
    removeScout(unitId: EntityId): void {
        this.scouts.delete(unitId);
    }

    /**
     * Check if a unit is assigned as a scout
     */
    isScout(unitId: EntityId): boolean {
        return this.scouts.has(unitId);
    }

    /**
     * Update scouts and generate movement actions
     */
    updateScouts(state: GameState, enemies: Entity[]): Action[] {
        const actions: Action[] = [];

        for (const [unitId, assignment] of this.scouts) {
            const unit = state.entities[unitId];

            // Remove dead scouts
            if (!unit || unit.dead) {
                this.scouts.delete(unitId);
                continue;
            }

            // Check for nearby enemies - flee if threatened
            const nearbyEnemies = enemies.filter(e =>
                e.type === 'UNIT' && e.pos.dist(unit.pos) < this.config.fleeDistance
            );

            if (nearbyEnemies.length > 0) {
                assignment.status = 'fleeing';

                // Find flee direction (away from enemies)
                let fleeDir = new Vector(0, 0);
                for (const enemy of nearbyEnemies) {
                    fleeDir = fleeDir.add(unit.pos.sub(enemy.pos));
                }
                fleeDir = fleeDir.norm();

                const fleePos = unit.pos.add(fleeDir.scale(this.config.fleeDistance));

                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: [unitId],
                        x: fleePos.x,
                        y: fleePos.y
                    }
                });
                continue;
            }

            // Resume patrolling if was fleeing
            if (assignment.status === 'fleeing') {
                assignment.status = 'patrolling';
            }

            // Continue patrol
            if (assignment.status === 'patrolling' && assignment.patrolRoute.length > 0) {
                const waypoint = assignment.patrolRoute[assignment.currentWaypointIdx];

                // Check if reached waypoint
                if (unit.pos.dist(waypoint) < 50) {
                    // Move to next waypoint
                    assignment.currentWaypointIdx =
                        (assignment.currentWaypointIdx + 1) % assignment.patrolRoute.length;
                }

                const nextWaypoint = assignment.patrolRoute[assignment.currentWaypointIdx];

                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: [unitId],
                        x: nextWaypoint.x,
                        y: nextWaypoint.y
                    }
                });
            }
        }

        return actions;
    }

    /**
     * Generate a patrol route covering the map
     */
    private generatePatrolRoute(
        baseCenter: Vector,
        mapWidth: number,
        mapHeight: number
    ): Vector[] {
        const route: Vector[] = [];
        const spacing = this.config.waypointSpacing;

        // Generate waypoints in a spiral pattern from base
        const directions = [
            new Vector(1, 0),   // Right
            new Vector(0, 1),   // Down
            new Vector(-1, 0),  // Left
            new Vector(0, -1)   // Up
        ];

        let pos = baseCenter;
        let distance = spacing;
        let dirIdx = 0;
        let stepsInDirection = 1;
        let stepsTaken = 0;
        let directionChanges = 0;

        // Generate ~12 waypoints
        for (let i = 0; i < 12; i++) {
            // Move in current direction
            pos = pos.add(directions[dirIdx].scale(distance));

            // Clamp to map bounds
            pos = new Vector(
                Math.max(100, Math.min(mapWidth - 100, pos.x)),
                Math.max(100, Math.min(mapHeight - 100, pos.y))
            );

            route.push(pos);

            stepsTaken++;
            if (stepsTaken >= stepsInDirection) {
                // Change direction
                dirIdx = (dirIdx + 1) % 4;
                stepsTaken = 0;
                directionChanges++;

                // Increase distance every 2 direction changes
                if (directionChanges % 2 === 0) {
                    stepsInDirection++;
                }
            }
        }

        return route;
    }

    /**
     * Find best unit to assign as scout
     */
    findBestScoutCandidate(units: Entity[]): Entity | null {
        // Filter out already assigned scouts
        const available = units.filter(u =>
            !this.scouts.has(u.id) &&
            u.key !== 'harvester' &&
            u.key !== 'mcv'
        );

        if (available.length === 0) return null;

        // Prefer fast, cheap units
        for (const preferredKey of this.config.preferredScouts) {
            const match = available.find(u => u.key === preferredKey);
            if (match) return match;
        }

        // Fallback to first available
        return available[0];
    }
}

// ============ THREAT PREDICTION ============

/**
 * Predict enemy attack based on intel
 */
export function predictThreat(intel: EnemyIntel, currentTick: number): {
    threatLevel: 'low' | 'medium' | 'high';
    estimatedArmySize: number;
    likelyAttackDirection: Vector | null;
} {
    // Count known enemy units
    const recentUnits = Array.from(intel.units.values()).filter(u =>
        currentTick - u.lastSeenTick < 600 // Last 10 seconds
    );

    const combatUnits = recentUnits.filter(u =>
        u.key !== 'harvester' && u.key !== 'mcv'
    );

    const estimatedArmySize = combatUnits.length;

    // Determine threat level
    let threatLevel: 'low' | 'medium' | 'high' = 'low';
    if (estimatedArmySize >= 10 || intel.techLevel === 'high') {
        threatLevel = 'high';
    } else if (estimatedArmySize >= 5) {
        threatLevel = 'medium';
    }

    // Estimate attack direction
    let likelyAttackDirection: Vector | null = null;
    if (intel.baseLocation) {
        // Attack likely comes from enemy base direction
        likelyAttackDirection = intel.baseLocation.norm();
    }

    return {
        threatLevel,
        estimatedArmySize,
        likelyAttackDirection
    };
}

/**
 * Analyze enemy composition for counter-building
 */
export function analyzeEnemyComposition(intel: EnemyIntel): {
    dominantType: 'infantry' | 'vehicle' | 'air' | 'mixed';
    dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed';
    hasSplash: boolean;
    hasAntiAir: boolean;
} {
    const units = Array.from(intel.units.values());

    let infantryCount = 0;
    let vehicleCount = 0;
    let airCount = 0;
    let lightCount = 0;
    let heavyCount = 0;
    let hasSplash = false;
    let hasAntiAir = false;

    for (const unit of units) {
        const data = RULES.units?.[unit.key];
        if (!data) continue;

        // Count by type
        if (data.type === 'infantry') infantryCount++;
        else if (data.type === 'vehicle') vehicleCount++;
        else if (data.type === 'air') airCount++;

        // Count by armor
        if (data.armor === 'infantry') infantryCount++;
        else if (data.armor === 'light') lightCount++;
        else if (data.armor === 'heavy' || data.armor === 'medium') heavyCount++;

        // Check for splash
        if (data.splash && data.splash > 0) hasSplash = true;

        // Check for anti-air
        if (['rocket', 'sam_site'].includes(unit.key)) hasAntiAir = true;
    }

    const total = infantryCount + vehicleCount + airCount;
    let dominantType: 'infantry' | 'vehicle' | 'air' | 'mixed' = 'mixed';
    if (total > 0) {
        if (infantryCount > total * 0.6) dominantType = 'infantry';
        else if (vehicleCount > total * 0.6) dominantType = 'vehicle';
        else if (airCount > total * 0.4) dominantType = 'air';
    }

    const armorTotal = lightCount + heavyCount;
    let dominantArmor: 'infantry' | 'light' | 'heavy' | 'mixed' = 'mixed';
    if (armorTotal > 0) {
        if (lightCount > armorTotal * 0.6) dominantArmor = 'light';
        else if (heavyCount > armorTotal * 0.6) dominantArmor = 'heavy';
    }

    return {
        dominantType,
        dominantArmor,
        hasSplash,
        hasAntiAir
    };
}

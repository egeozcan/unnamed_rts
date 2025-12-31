/**
 * Squad System Module
 *
 * Coordinates groups of units for tactical maneuvers.
 */

import { Entity, Vector, Action, GameState, EntityId } from '../../types.js';
import {
    Squad,
    SquadType,
    createSquad,
    generateSquadId,
    DEFAULT_SQUAD_CONFIGS
} from './types.js';
import {
    calculateFormationPositions,
    assignRoles,
    suggestFormation
} from './formations.js';

// Re-export types
export * from './types.js';
export * from './formations.js';

// ============ SQUAD MANAGER ============

/**
 * Manages all squads for a player
 */
export class SquadManager {
    private squads: Map<string, Squad> = new Map();

    constructor(_playerId: number) {
        // playerId reserved for future use
    }

    /**
     * Create a new squad
     */
    createSquad(type: SquadType, unitIds: EntityId[], tick: number): Squad {
        const id = generateSquadId(type);
        const squad = createSquad(id, type, unitIds, tick);
        squad.roles = assignRoles([] as Entity[]); // Will be populated later
        this.squads.set(id, squad);
        return squad;
    }

    /**
     * Get a squad by ID
     */
    getSquad(id: string): Squad | undefined {
        return this.squads.get(id);
    }

    /**
     * Get all squads
     */
    getAllSquads(): Squad[] {
        return Array.from(this.squads.values());
    }

    /**
     * Get squads by type
     */
    getSquadsByType(type: SquadType): Squad[] {
        return this.getAllSquads().filter(s => s.type === type);
    }

    /**
     * Remove a squad
     */
    removeSquad(id: string): void {
        this.squads.delete(id);
    }

    /**
     * Clean up dead units from all squads
     */
    cleanupDeadUnits(entities: Record<EntityId, Entity>): void {
        for (const squad of this.squads.values()) {
            squad.unitIds = squad.unitIds.filter(id => {
                const unit = entities[id];
                return unit && !unit.dead;
            });

            // Disband empty squads
            if (squad.unitIds.length === 0) {
                squad.status = 'disbanding';
            }
        }

        // Remove disbanded squads
        for (const [id, squad] of this.squads) {
            if (squad.status === 'disbanding') {
                this.squads.delete(id);
            }
        }
    }

    /**
     * Update all squads
     */
    update(state: GameState, enemies: Entity[]): Action[] {
        const actions: Action[] = [];

        this.cleanupDeadUnits(state.entities);

        for (const squad of this.squads.values()) {
            actions.push(...this.updateSquad(squad, state, enemies));
        }

        return actions;
    }

    /**
     * Update a single squad's behavior
     */
    private updateSquad(squad: Squad, state: GameState, enemies: Entity[]): Action[] {
        const actions: Action[] = [];
        const config = DEFAULT_SQUAD_CONFIGS[squad.type];

        // Get alive units
        const aliveUnits = squad.unitIds
            .map(id => state.entities[id])
            .filter((u): u is Entity => u !== undefined && !u.dead);

        if (aliveUnits.length === 0) {
            squad.status = 'disbanding';
            return actions;
        }

        // Check squad health for retreat
        const totalHp = aliveUnits.reduce((sum, u) => sum + u.hp, 0);
        const totalMaxHp = aliveUnits.reduce((sum, u) => sum + u.maxHp, 0);
        const healthRatio = totalHp / totalMaxHp;

        if (healthRatio < config.retreatThreshold && squad.status !== 'retreating') {
            squad.status = 'retreating';
            squad.lastOrderTick = state.tick;
        }

        // State machine
        switch (squad.status) {
            case 'forming':
                actions.push(...this.handleForming(squad, aliveUnits, state, config));
                break;
            case 'moving':
                actions.push(...this.handleMoving(squad, aliveUnits, state, enemies));
                break;
            case 'engaging':
                actions.push(...this.handleEngaging(squad, aliveUnits, state, enemies));
                break;
            case 'retreating':
                actions.push(...this.handleRetreating(squad, aliveUnits, state));
                break;
        }

        return actions;
    }

    /**
     * Handle forming state - gather units at rally point
     */
    private handleForming(
        squad: Squad,
        units: Entity[],
        state: GameState,
        config: typeof DEFAULT_SQUAD_CONFIGS.attack
    ): Action[] {
        const actions: Action[] = [];

        // Set rally point if not set
        if (!squad.rallyPoint) {
            squad.rallyPoint = this.calculateRallyPoint(units);
        }

        // Check if units are gathered
        const gatheredCount = units.filter(u =>
            u.pos.dist(squad.rallyPoint!) < 100
        ).length;

        const isGathered = gatheredCount >= units.length * 0.7;
        const timedOut = state.tick - squad.lastOrderTick > config.formingTimeout;

        if (isGathered || timedOut) {
            // Transition to moving or engaging
            if (squad.target) {
                squad.status = 'moving';
            } else {
                squad.status = 'engaging';
            }
            squad.lastOrderTick = state.tick;
        } else {
            // Move stragglers to rally point
            const stragglers = units.filter(u =>
                u.pos.dist(squad.rallyPoint!) > 100
            );

            if (stragglers.length > 0 && squad.rallyPoint) {
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: stragglers.map(u => u.id),
                        x: squad.rallyPoint.x,
                        y: squad.rallyPoint.y
                    }
                });
            }
        }

        return actions;
    }

    /**
     * Handle moving state - move to target location
     */
    private handleMoving(
        squad: Squad,
        units: Entity[],
        state: GameState,
        enemies: Entity[]
    ): Action[] {
        const actions: Action[] = [];

        if (!squad.target) {
            squad.status = 'engaging';
            return actions;
        }

        // Get target position
        const targetPos = squad.target instanceof Vector
            ? squad.target
            : (state.entities[squad.target as EntityId]?.pos || null);

        if (!targetPos) {
            squad.status = 'engaging';
            return actions;
        }

        // Calculate squad center
        const squadCenter = this.getSquadCenter(units);

        // Check if we're close enough to engage
        const distToTarget = squadCenter.dist(targetPos);
        if (distToTarget < 200) {
            squad.status = 'engaging';
            squad.lastOrderTick = state.tick;
            return actions;
        }

        // Check for nearby enemies - engage if threatened
        const nearbyEnemies = enemies.filter(e =>
            e.pos.dist(squadCenter) < 400
        );
        if (nearbyEnemies.length > 0) {
            squad.status = 'engaging';
            squad.lastOrderTick = state.tick;
            return actions;
        }

        // Move in formation toward target
        const facing = targetPos.sub(squadCenter).norm();
        const formationPositions = calculateFormationPositions(
            units,
            squadCenter.add(facing.scale(100)), // Advance position
            facing,
            squad.formation
        );

        for (const unit of units) {
            const targetFormationPos = formationPositions.get(unit.id);
            if (targetFormationPos && unit.pos.dist(targetFormationPos) > 50) {
                actions.push({
                    type: 'COMMAND_MOVE',
                    payload: {
                        unitIds: [unit.id],
                        x: targetFormationPos.x,
                        y: targetFormationPos.y
                    }
                });
            }
        }

        return actions;
    }

    /**
     * Handle engaging state - fight enemies
     */
    private handleEngaging(
        squad: Squad,
        units: Entity[],
        state: GameState,
        enemies: Entity[]
    ): Action[] {
        const actions: Action[] = [];

        // Find target if not set
        let targetEntity: Entity | null = null;

        if (squad.target) {
            if (squad.target instanceof Vector) {
                // Position target - find nearest enemy to that position
                const nearTarget = enemies.filter(e =>
                    e.pos.dist(squad.target as Vector) < 500
                );
                if (nearTarget.length > 0) {
                    targetEntity = nearTarget[0];
                }
            } else {
                targetEntity = state.entities[squad.target] || null;
            }
        }

        if (!targetEntity || targetEntity.dead) {
            // Find new target - nearest enemy
            const squadCenter = this.getSquadCenter(units);
            let nearestDist = Infinity;
            for (const enemy of enemies) {
                const d = enemy.pos.dist(squadCenter);
                if (d < nearestDist) {
                    nearestDist = d;
                    targetEntity = enemy;
                }
            }
        }

        if (!targetEntity) {
            // No enemies - transition back to moving or forming
            squad.status = 'forming';
            return actions;
        }

        // Update target
        squad.target = targetEntity.id;

        // Issue attack commands
        const unitsNeedingOrders = units.filter(u => {
            if (u.type !== 'UNIT') return false;
            const unit = u as { combat?: { targetId?: EntityId } };
            // Need orders if no target or target is dead
            if (!unit.combat?.targetId) return true;
            const currentTarget = state.entities[unit.combat.targetId];
            if (!currentTarget || currentTarget.dead) return true;
            return false;
        });

        if (unitsNeedingOrders.length > 0) {
            actions.push({
                type: 'COMMAND_ATTACK',
                payload: {
                    unitIds: unitsNeedingOrders.map(u => u.id),
                    targetId: targetEntity.id
                }
            });
        }

        return actions;
    }

    /**
     * Handle retreating state - pull back to safety
     */
    private handleRetreating(
        squad: Squad,
        units: Entity[],
        state: GameState
    ): Action[] {
        const actions: Action[] = [];

        // Find retreat point (back toward base center)
        // For now, just move back from current position
        const squadCenter = this.getSquadCenter(units);
        const retreatDir = squad.rallyPoint
            ? squad.rallyPoint.sub(squadCenter).norm()
            : new Vector(-1, -1).norm();

        const retreatPos = squadCenter.add(retreatDir.scale(300));

        // Check if squad health recovered
        const totalHp = units.reduce((sum, u) => sum + u.hp, 0);
        const totalMaxHp = units.reduce((sum, u) => sum + u.maxHp, 0);
        const healthRatio = totalHp / totalMaxHp;

        if (healthRatio > 0.6) {
            // Health recovered - go back to forming
            squad.status = 'forming';
            squad.lastOrderTick = state.tick;
            return actions;
        }

        // Move all units to retreat position
        actions.push({
            type: 'COMMAND_MOVE',
            payload: {
                unitIds: units.map(u => u.id),
                x: retreatPos.x,
                y: retreatPos.y
            }
        });

        return actions;
    }

    /**
     * Calculate center of a squad
     */
    private getSquadCenter(units: Entity[]): Vector {
        if (units.length === 0) return new Vector(0, 0);

        let sumX = 0, sumY = 0;
        for (const unit of units) {
            sumX += unit.pos.x;
            sumY += unit.pos.y;
        }
        return new Vector(sumX / units.length, sumY / units.length);
    }

    /**
     * Calculate initial rally point for a squad
     */
    private calculateRallyPoint(units: Entity[]): Vector {
        return this.getSquadCenter(units);
    }
}

// ============ CONVENIENCE FUNCTIONS ============

/**
 * Create a simple attack squad and return its actions
 */
export function createAttackSquad(
    units: Entity[],
    target: EntityId | Vector,
    state: GameState,
    enemies: Entity[]
): Action[] {
    const manager = new SquadManager(units[0]?.owner || 0);
    const squad = manager.createSquad('attack', units.map(u => u.id), state.tick);
    squad.target = target;

    // Determine best formation
    const hasSplash = enemies.some(e => {
        if (e.type !== 'UNIT') return false;
        // Check if enemy has splash damage in RULES
        return false; // Simplified for now
    });

    squad.formation = suggestFormation(
        enemies.length,
        hasSplash,
        false,
        units.length
    );

    // Update and return actions
    return manager.update(state, enemies);
}

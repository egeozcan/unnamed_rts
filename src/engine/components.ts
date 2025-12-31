import { Vector, EntityId } from './types.js';

// ============ MOVEMENT COMPONENT ============
// Properties for entities that can move (units only)

export interface MovementComponent {
    readonly vel: Vector;
    readonly rotation: number;
    readonly moveTarget: Vector | null;
    readonly path: Vector[] | null;
    readonly pathIdx: number;
    readonly finalDest: Vector | null;
    readonly stuckTimer: number;
    readonly unstuckDir: Vector | null;
    readonly unstuckTimer: number;
    readonly avgVel?: Vector;
}

// ============ COMBAT COMPONENT ============
// Properties for entities that can engage in combat (units and defense buildings)

export interface CombatComponent {
    readonly targetId: EntityId | null;
    readonly lastAttackerId: EntityId | null;
    readonly lastDamageTick?: number;
    readonly cooldown: number;
    readonly flash: number;
    readonly turretAngle: number;
}

// ============ HARVESTER COMPONENT ============
// Properties specific to harvester units

export interface HarvesterComponent {
    readonly cargo: number;
    readonly resourceTargetId: EntityId | null;
    readonly baseTargetId: EntityId | null;
    readonly dockPos?: Vector;
    readonly manualMode?: boolean;
    readonly harvestAttemptTicks?: number;
    readonly lastDistToOre?: number | null;
    readonly bestDistToOre?: number | null;
    readonly blockedOreId?: EntityId | null;
    readonly blockedOreTimer?: number;
}

// ============ ENGINEER COMPONENT ============
// Properties specific to engineer units (capture/repair)

export interface EngineerComponent {
    readonly captureTargetId?: EntityId | null;
    readonly repairTargetId?: EntityId | null;
}

// ============ BUILDING STATE COMPONENT ============
// Properties specific to buildings

export interface BuildingStateComponent {
    readonly isRepairing?: boolean;
    readonly placedTick?: number;
}

// ============ WELL COMPONENT ============
// Properties specific to ore wells (neutral resource generators)

export interface WellComponent {
    readonly nextSpawnTick: number;      // When to spawn next ore
    readonly currentOreCount: number;    // Ore entities within radius
    readonly totalSpawned: number;       // Lifetime counter
}

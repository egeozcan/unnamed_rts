import { Vector, EntityId } from './types.js';

// ============ ATTACK STANCE ============
// Attack stance for combat units
export type AttackStance = 'aggressive' | 'defensive' | 'hold_ground';

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
    // Progress tracking for flee destinations (harvesters)
    readonly lastDistToMoveTarget?: number;
    readonly bestDistToMoveTarget?: number;
    readonly moveTargetNoProgressTicks?: number;
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
    readonly stance?: AttackStance;  // Default: 'aggressive'
    readonly attackMoveTarget?: Vector | null;  // Destination for attack-move command
    readonly stanceHomePos?: Vector | null;  // Position to return to for defensive stance / attack-move
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
    // Cooldown to prevent flee spam after a flee times out
    readonly fleeCooldownUntilTick?: number;
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
    readonly rallyPoint?: Vector | null;  // Rally point for produced units
}

// ============ WELL COMPONENT ============
// Properties specific to ore wells (neutral resource generators)

export interface WellComponent {
    readonly nextSpawnTick: number;      // When to spawn next ore
    readonly currentOreCount: number;    // Ore entities within radius
    readonly totalSpawned: number;       // Lifetime counter
    readonly isBlocked: boolean;         // True if no valid spawn positions (area occupied by units/buildings)
}

// ============ AIR UNIT COMPONENT ============
// Properties specific to harrier-type air units that dock/reload

export type AirUnitState = 'docked' | 'flying' | 'attacking' | 'returning';

export interface AirUnitComponent {
    readonly ammo: number;                    // Current ammo (0 = needs reload)
    readonly maxAmmo: number;                 // Maximum ammo capacity
    readonly state: AirUnitState;             // Current state in the state machine
    readonly homeBaseId: EntityId | null;     // Air-Force Command this unit belongs to
    readonly dockedSlot: number | null;       // Slot index when docked (0-5)
}

// ============ AIR BASE COMPONENT ============
// Properties specific to Air-Force Command buildings

export interface AirBaseComponent {
    readonly slots: readonly (EntityId | null)[];  // 6 slots, each holds a harrier ID or null
    readonly reloadProgress: number;               // Ticks remaining for current reload
    readonly lastLaunchTick?: number;              // Last tick a harrier was launched (for staggering)
}

// ============ INDUCTION RIG COMPONENT ============
// Properties specific to deployed Induction Rigs (extract credits from wells)

export interface InductionRigComponent {
    readonly wellId: EntityId;                    // The well this rig is extracting from
    readonly accumulatedCredits: number;          // Fractional credits accumulated (paid out when >= 1)
}

// ============ DEMO TRUCK COMPONENT ============
// Properties specific to demolition truck units (suicide vehicle)

export interface DemoTruckComponent {
    readonly detonationTargetId: EntityId | null;  // Entity to drive toward and detonate on
    readonly detonationTargetPos: Vector | null;   // Position to drive toward (for ground targeting)
    readonly hasDetonated: boolean;                // Prevents double-explosion
}

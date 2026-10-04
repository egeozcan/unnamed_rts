import { RULES } from '../data/schemas/index';
import type { Entity, Vector } from './types';

/**
 * Weapon and movement inertia, driven by the optional `turretTurn` and `accelTicks` rules:
 * - turrets traverse at a limited rate and a weapon only fires once it points at its target
 * - ground units build up speed over `accelTicks` and bleed it off in sharp turns
 */

const DEG = Math.PI / 180;

/** A turreted weapon fires once it points within this angle of its target. */
export const AIM_TOLERANCE = 12 * DEG;

/** Building turret angles carry a +90° offset because their 2D sprites point up. */
export const BUILDING_TURRET_OFFSET = Math.PI / 2;

/** Speed kept through a turn never drops below this fraction (tracks pivot rather than stop). */
const MIN_TURN_SPEED_FACTOR = 0.35;

export function wrapAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
}

const turretRates = new Map<string, number | null>();
const accelRates = new Map<string, number | null>();

/** Turret traverse in radians per tick, or null for weapons that aim instantly. */
export function getTurretTurnRate(key: string): number | null {
    let rate = turretRates.get(key);
    if (rate === undefined) {
        const deg = RULES.units[key]?.turretTurn ?? RULES.buildings[key]?.turretTurn;
        rate = deg ? deg * DEG : null;
        turretRates.set(key, rate);
    }
    return rate;
}

/** Speed gained per tick from a standstill, or null for units that reach full speed instantly. */
function getAcceleration(key: string): number | null {
    let accel = accelRates.get(key);
    if (accel === undefined) {
        const unit = RULES.units[key];
        accel = unit?.accelTicks && !unit.fly ? unit.speed / unit.accelTicks : null;
        accelRates.set(key, accel);
    }
    return accel;
}

/** Angle from `entity` to `target` in the entity's turretAngle convention. */
export function aimAngle(entity: Entity, target: { x: number; y: number }): number {
    const angle = Math.atan2(target.y - entity.pos.y, target.x - entity.pos.x);
    return entity.type === 'BUILDING' ? angle + BUILDING_TURRET_OFFSET : angle;
}

/** Turns `current` toward `desired` by at most `rate` (instantly-aiming weapons ease in quickly). */
export function stepTurret(current: number, desired: number, rate: number | null): number {
    const diff = wrapAngle(desired - current);
    if (rate === null) return current + diff * 0.25;
    return wrapAngle(current + Math.max(-rate, Math.min(rate, diff)));
}

/** Whether a weapon with turret angle `turretAngle` may fire at `target`. */
export function isAimedAt(entity: Entity, turretAngle: number, target: { x: number; y: number }): boolean {
    if (getTurretTurnRate(entity.key) === null) return true;
    return Math.abs(wrapAngle(aimAngle(entity, target) - turretAngle)) <= AIM_TOLERANCE;
}

/**
 * The velocity a ground unit actually moves with this tick, given the velocity it wants and how fast it
 * was already going: speed builds up at the unit's acceleration, and turning sharply bleeds speed off.
 */
export function applyMovementInertia(key: string, desired: Vector, lastVel: Vector | undefined, currentSpeed: number): Vector {
    const accel = getAcceleration(key);
    if (accel === null) return desired;
    const desiredSpeed = desired.mag();
    if (desiredSpeed <= 0) return desired;

    let carried = currentSpeed;
    if (carried > 0 && lastVel) {
        const lastSpeed = Math.hypot(lastVel.x, lastVel.y);
        if (lastSpeed > 0) {
            const cos = (lastVel.x * desired.x + lastVel.y * desired.y) / (lastSpeed * desiredSpeed);
            carried *= Math.max(MIN_TURN_SPEED_FACTOR, cos);
        }
    }
    const speed = Math.min(desiredSpeed, carried + accel);
    return speed >= desiredSpeed ? desired : desired.scale(speed / desiredSpeed);
}

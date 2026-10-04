import { RULES } from '../../data/schemas/index.js';
import type { Entity } from '../../engine/types.js';

/**
 * Projection shared by the 3D scene and the 2D overlay.
 *
 * The 3D camera is an orthographic camera tilted CAMERA_TILT_RAD away from straight-down, with its
 * vertical extent stretched by 1/cos(tilt). The result is that the ground plane maps to the screen
 * exactly like the classic top-down renderer does - screen = (world - camera) * zoom - so mouse
 * picking, camera bounds, the minimap and every gameplay system stay untouched. Height only shows up
 * as an upward screen offset of `height * HEIGHT_TO_SCREEN * zoom` pixels.
 *
 * This file must not import three.js: the 2D overlay uses it even before the 3D chunk has loaded.
 */
export const CAMERA_TILT_RAD = (40 * Math.PI) / 180;
export const HEIGHT_TO_SCREEN = Math.tan(CAMERA_TILT_RAD);

/** Flying height of aircraft. Kept low enough that the visual lift stays inside the click radius. */
export const AIR_ALTITUDE = 26;

/** Height of the landing pad deck on the Air-Force Command, where docked harriers sit. */
export const AIRBASE_PAD_HEIGHT = 3;

/** Parking slots on the Air-Force Command, relative to the building centre (shared with the 2D renderer). */
export const AIRBASE_SLOT_OFFSETS: readonly { readonly x: number; readonly y: number }[] = [
    { x: -30, y: -20 }, { x: 0, y: -20 }, { x: 30, y: -20 },
    { x: -30, y: 10 }, { x: 0, y: 10 }, { x: 30, y: 10 },
];

/** Visual model heights (world units) - used for HP bar placement and the models themselves. */
const MODEL_HEIGHTS: Record<string, number> = {
    // Buildings
    conyard: 33,
    power: 38,
    refinery: 37,
    barracks: 24,
    factory: 34,
    turret: 15,
    sam_site: 17,
    pillbox: 13,
    obelisk: 58,
    tech: 31,
    airforce_command: 41,
    service_depot: 22,
    induction_rig_deployed: 41,
    // Vehicles
    harvester: 17,
    jeep: 11,
    apc: 13,
    light: 13,
    heavy: 16,
    flame_tank: 14,
    stealth: 12,
    artillery: 20,
    mlrs: 18,
    mammoth: 19,
    mcv: 19,
    induction_rig: 15,
    demo_truck: 13,
    // Aircraft (model height, excluding altitude)
    heli: 11,
    harrier: 9,
};

const INFANTRY_HEIGHT = 14;

/** True for units that should be drawn in the air. */
export function isFlyingKey(key: string): boolean {
    return RULES.units[key]?.fly === true;
}

export function getModelHeight(entity: Entity): number {
    if (entity.type === 'ROCK') return entity.radius * 0.9;
    if (entity.type === 'RESOURCE') return 8;
    if (entity.type === 'WELL') return 4;
    const height = MODEL_HEIGHTS[entity.key];
    if (height !== undefined) return height;
    if (entity.type === 'UNIT' && RULES.units[entity.key]?.type === 'infantry') return INFANTRY_HEIGHT;
    return 16;
}

export function getAltitude(entity: Entity): number {
    return entity.type === 'UNIT' && isFlyingKey(entity.key) ? AIR_ALTITUDE : 0;
}

/** Screen-space pixels a point `height` world units above the ground is drawn above its ground position. */
export function heightToScreenLift(height: number, zoom: number): number {
    return height * HEIGHT_TO_SCREEN * zoom;
}

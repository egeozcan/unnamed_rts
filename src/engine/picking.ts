import { Entity, EntityId, TILE_SIZE } from './types.js';
import { isTransportedUnit } from './transport.js';

/** Extra world-pixel slack around units so small infantry stay clickable. */
const UNIT_PICK_PADDING = 8;
/** Extra world-pixel slack around building footprints. */
const BUILDING_PICK_PADDING = 4;

/**
 * How far (world units, up the screen) an entity's model is drawn above its ground position.
 * Set by the 3D view so clicks on the top of a tall model hit it; null in the flat 2D view.
 */
let pickLift: ((entity: Entity) => number) | null = null;

export function setPickLift(lift: ((entity: Entity) => number) | null): void {
    pickLift = lift;
}

/**
 * Distance-like score for picking `entity` at (wx, wy), or null when the point misses it.
 * Buildings are hit anywhere inside their footprint; everything else by radius.
 */
function pickScore(entity: Entity, wx: number, wy: number): number | null {
    if (entity.dead) return null;
    if (entity.type === 'UNIT' && isTransportedUnit(entity)) return null;

    const dx = wx - entity.pos.x;
    const rawDy = wy - entity.pos.y;
    // A raised model covers the screen from its ground position up to `lift` above it: measure the
    // vertical distance to that span instead of to the ground point
    const lift = pickLift ? pickLift(entity) : 0;
    const dy = rawDy >= 0 ? rawDy : Math.min(0, rawDy + lift);
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (entity.type === 'BUILDING') {
        if (Math.abs(dx) > entity.w / 2 + BUILDING_PICK_PADDING || Math.abs(dy) > entity.h / 2 + BUILDING_PICK_PADDING) {
            return null;
        }
        // Units standing in front of a building win over the building itself
        return 1000 + dist;
    }

    return dist <= entity.radius + UNIT_PICK_PADDING ? dist : null;
}

/**
 * The entity under the point (wx, wy): the closest unit, otherwise the building whose footprint
 * contains the point. Used by left-click, right-click and the hover cursor so they always agree.
 */
export function pickEntityAt(
    candidates: Iterable<Entity> | Record<EntityId, Entity>,
    wx: number,
    wy: number,
    filter?: (entity: Entity) => boolean
): Entity | null {
    const list: Iterable<Entity> = Symbol.iterator in candidates
        ? candidates as Iterable<Entity>
        : Object.values(candidates as Record<EntityId, Entity>);

    let best: Entity | null = null;
    let bestScore = Infinity;
    for (const entity of list) {
        const score = pickScore(entity, wx, wy);
        if (score === null || score >= bestScore) continue;
        if (filter && !filter(entity)) continue;
        best = entity;
        bestScore = score;
    }
    return best;
}

/**
 * True when `entity` sits on a tile `viewerId` has never explored, so the player must not be
 * able to point at it (cursor, right-click target). Own entities are never hidden.
 */
export function isHiddenByFog(
    state: { fogOfWar?: Record<number, Uint8Array>; config: { width: number } },
    entity: Entity,
    viewerId: number | null
): boolean {
    if (viewerId === null || entity.owner === viewerId) return false;
    const fogGrid = state.fogOfWar?.[viewerId];
    if (!fogGrid) return false;
    const gridW = Math.ceil(state.config.width / TILE_SIZE);
    return fogGrid[Math.floor(entity.pos.y / TILE_SIZE) * gridW + Math.floor(entity.pos.x / TILE_SIZE)] === 0;
}

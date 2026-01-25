import {
    Entity, Vector, UnitEntity, TILE_SIZE
} from '../types';
import { isUnitData } from '../../data/schemas/index';
import { getRuleData } from './helpers';
import { findPath, getGridW, getGridH, collisionGrid } from '../utils';
import { getSpatialGrid } from '../spatial';

/**
 * Helper to ensure a value is a proper Vector instance.
 * JSON deserialization produces plain {x, y} objects, not Vector instances.
 */
function ensureVector(v: Vector | { x: number; y: number } | null): Vector | null {
    if (!v) return null;
    if (v instanceof Vector) return v;
    return new Vector(v.x, v.y);
}

/**
 * Move a unit toward a target position with pathfinding and collision avoidance.
 * Extracted to its own module to avoid circular dependencies.
 */
export function moveToward(entity: UnitEntity, targetParam: Vector, _allEntities: Entity[], skipWhiskerAvoidance = false): UnitEntity {
    // Ensure target is a proper Vector (may be plain object from JSON save)
    const target = ensureVector(targetParam)!;

    const distToTarget = entity.pos.dist(target);
    if (distToTarget < 2) {
        return {
            ...entity,
            movement: { ...entity.movement, vel: new Vector(0, 0), path: null, pathIdx: 0 }
        };
    }

    const unitData = getRuleData(entity.key);
    const speed = (unitData && isUnitData(unitData)) ? unitData.speed : 1;

    // Flying units move directly to target - no pathfinding, no collision avoidance
    const canFly = unitData && isUnitData(unitData) && unitData.fly === true;
    if (canFly) {
        const dir = target.sub(entity.pos).norm();
        const vel = dir.scale(Math.min(speed, distToTarget));
        return {
            ...entity,
            movement: {
                ...entity.movement,
                vel,
                path: null,
                pathIdx: 0,
                finalDest: target,
                stuckTimer: 0
            }
        };
    }

    // Ground units use pathfinding and collision avoidance

    let avgVel = entity.movement.avgVel || new Vector(0, 0);
    // Use intended velocity from last frame, not position delta.
    // Position delta (pos - prevPos) includes collision displacement which causes
    // false stuck detection when collision resolution fights against movement.
    // lastVel is stored in game_loop.ts before vel is cleared after movement application.
    const lastVel = entity.movement.lastVel ? ensureVector(entity.movement.lastVel)! : new Vector(0, 0);
    avgVel = avgVel.scale(0.9).add(lastVel.scale(0.1));

    let stuckTimer = entity.movement.stuckTimer || 0;
    let unstuckDir = ensureVector(entity.movement.unstuckDir);
    let unstuckTimer = entity.movement.unstuckTimer || 0;
    // Convert path vectors from plain objects if loaded from JSON save
    let path = entity.movement.path ? entity.movement.path.map(p => ensureVector(p)!) : null;
    let pathIdx = entity.movement.pathIdx || 0;
    // Convert finalDest to Vector if it's a plain object (e.g., loaded from JSON save)
    let finalDest = ensureVector(entity.movement.finalDest);

    // OPTIMIZATION: Skip pathfinding for very close targets - direct steering is sufficient
    const isCloseTarget = distToTarget < 80;

    // OPTIMIZATION: Increase re-path threshold to reduce pathfinding when chasing moving targets
    // Units will re-path only if target moved >120 units (significant change) or they're stuck
    const targetMovedSignificantly = finalDest && finalDest.dist(target) > 120;

    const needNewPath = !isCloseTarget && (
        !path || path.length === 0 ||
        targetMovedSignificantly ||
        // OPTIMIZATION: Stagger path recalculation when stuck (every 10 ticks)
        (stuckTimer > 30 && stuckTimer % 10 === 0)
    );

    if (needNewPath) {
        const newPath = findPath(entity.pos, target, entity.radius, entity.owner);
        if (newPath && newPath.length > 1) {
            path = newPath;
            pathIdx = 1;
            finalDest = target;
            stuckTimer = 0;
        } else {
            path = null;
            pathIdx = 0;
            finalDest = target;
        }
    } else if (isCloseTarget) {
        // Clear path for close targets - use direct steering
        path = null;
        pathIdx = 0;
    }

    let immediateTarget = target;
    if (path && pathIdx < path.length) {
        immediateTarget = path[pathIdx];
        const waypointDist = entity.pos.dist(immediateTarget);
        if (waypointDist < 25) {
            pathIdx++;
            if (pathIdx < path.length) {
                immediateTarget = path[pathIdx];
            } else {
                immediateTarget = target;
            }
        }
    }

    // Improved stuck detection that catches collision oscillation
    // The old logic only checked avgVel magnitude, but units being pushed back by
    // collisions can have non-zero avgVel while making no progress toward the target.
    const dirToTarget = target.sub(entity.pos).norm();
    const avgVelMag = avgVel.mag();

    // Check if avgVel is pointing away from target (being pushed backward by collisions)
    // Dot product < 0 means moving away from target
    // NOTE: We defer the full isBeingPushedBack check until after isActuallyMovingForward
    // is calculated, since direction reversals can cause avgVel to point backward temporarily
    const velDotDir = avgVel.x * dirToTarget.x + avgVel.y * dirToTarget.y;

    // Check if unit has no path and is far from target (pathfinding failed)
    const hasNoPath = !path || path.length === 0;
    const isPathfindingStuck = hasNoPath && distToTarget > 100;

    // Skip stuck detection during unstuck mode - we're intentionally moving perpendicular
    // so velDotDir will be ~0, which would falsely trigger isLowForwardProgress
    const isInUnstuckMode = unstuckTimer > 0 && unstuckDir;

    // Check if unit is actually moving toward target using lastVel (not avgVel)
    // lastVel is the intended velocity from the previous tick, unaffected by avgVel's
    // exponential averaging. During direction reversals, avgVel can be low due to
    // vector cancellation even when the unit is moving at full speed.
    const lastVelMag = lastVel.mag();
    const lastVelDotDir = lastVel.x * dirToTarget.x + lastVel.y * dirToTarget.y;
    const isActuallyMovingForward = lastVelMag > speed * 0.5 && lastVelDotDir > speed * 0.3;

    // Now calculate isBeingPushedBack, gated by isActuallyMovingForward
    // During direction reversals, avgVel may point backward due to exponential averaging
    // even when the unit is currently moving forward. Only flag as pushed back if
    // we're NOT making actual forward progress.
    const isBeingPushedBack = avgVelMag > 0.05 && velDotDir < -0.02 && !isActuallyMovingForward;

    if (distToTarget > 10 && !isInUnstuckMode) {
        // Stuck conditions:
        // 1. Low avgVel AND not actually moving forward (distinguishes stuck from direction change)
        // 2. Being pushed backward by collisions (also gated by !isActuallyMovingForward)
        // 3. No path and low forward progress
        const isLowVelocity = avgVelMag < speed * 0.15 && !isActuallyMovingForward;
        const isLowForwardProgress = isPathfindingStuck && velDotDir < speed * 0.1;

        if (isLowVelocity || isBeingPushedBack || isLowForwardProgress) {
            // Increment faster when being pushed back or stuck without a path
            const increment = (isBeingPushedBack || isPathfindingStuck) ? 2 : 1;
            stuckTimer += increment;
        } else {
            stuckTimer = Math.max(0, stuckTimer - 2);
        }
    } else if (!isInUnstuckMode) {
        stuckTimer = 0;
    }
    // During unstuck mode, stuckTimer is preserved (not modified)

    // Trigger unstuck behavior - lower threshold when no path available
    // Units stuck without a path need to escape faster to find an alternate route
    const stuckThreshold = isPathfindingStuck ? 12 : 20;
    if (stuckTimer > stuckThreshold) {
        // Longer unstuck duration when no path - need more time to find alternate route
        unstuckTimer = isPathfindingStuck ? 35 : 25;
        // Don't reset stuckTimer to 0 - keep a base value so cumulative stuck time is tracked
        // This allows us to detect repeated unstuck cycles and eventually give up
        stuckTimer = isPathfindingStuck ? 6 : 0;
        const toTarget = target.sub(entity.pos).norm();
        const perpendicular = Math.random() > 0.5
            ? new Vector(-toTarget.y, toTarget.x)
            : new Vector(toTarget.y, -toTarget.x);
        unstuckDir = perpendicular;
        path = null;
        pathIdx = 0;
    }

    // If stuck for a very long time (multiple unstuck cycles) with no path, give up on target
    // This prevents infinite oscillation when target is truly unreachable
    // stuckTimer accumulates: 6 (base after unstuck) + ~12 per cycle = ~18 per cycle
    // After ~3 cycles (~54+ ticks of stuck time), give up
    const giveUpThreshold = 50;
    const shouldGiveUp = isPathfindingStuck && stuckTimer > giveUpThreshold;

    if (unstuckTimer > 0 && unstuckDir) {
        // During unstuck mode, keep stuckTimer steady (don't reset to 0)
        // This tracks cumulative stuck time across multiple unstuck attempts
        return {
            ...entity,
            movement: {
                ...entity.movement,
                vel: unstuckDir.scale(speed * 0.8),
                stuckTimer: stuckTimer,  // Preserve accumulated stuck time
                unstuckTimer: unstuckTimer - 1,
                unstuckDir: unstuckDir,
                avgVel: avgVel,
                path: null,
                pathIdx: 0,
                finalDest
            }
        };
    }

    // Give up on unreachable target after multiple failed unstuck attempts
    if (shouldGiveUp) {
        return {
            ...entity,
            movement: {
                ...entity.movement,
                vel: new Vector(0, 0),
                moveTarget: null,  // Clear the unreachable target
                stuckTimer: 0,
                unstuckTimer: 0,
                unstuckDir: null,
                avgVel: avgVel,
                path: null,
                pathIdx: 0,
                finalDest: null
            }
        };
    }

    const dir = immediateTarget.sub(entity.pos).norm();
    let separation = new Vector(0, 0);
    let entityCount = 0;

    const nearbyEntities = getSpatialGrid().queryRadius(entity.pos.x, entity.pos.y, 60);
    for (const other of nearbyEntities) {
        if (other.id === entity.id || other.dead || other.type === 'RESOURCE') continue;
        const d = entity.pos.dist(other.pos);
        const minDist = entity.radius + other.radius;

        // Soft buffer zone: start gentle avoidance at minDist + 15, increase force as units overlap
        // This prevents the abrupt on/off separation that causes vibration
        const softBuffer = 15;
        const hardBuffer = 3;
        if (d < minDist + softBuffer && d > 0.001) {
            // Smooth weight: 0 at soft buffer edge, 1 at hard overlap
            const softWeight = Math.max(0, (minDist + softBuffer - d) / softBuffer) * 0.3;
            const hardWeight = d < minDist + hardBuffer
                ? Math.max(0, (minDist + hardBuffer - d) / (minDist + hardBuffer)) * 0.7
                : 0;
            const weight = softWeight + hardWeight;
            separation = separation.add(entity.pos.sub(other.pos).norm().scale(weight));
            entityCount++;
        }
    }

    const hasValidPath = path && path.length > 0;
    let avoidanceX = 0;
    let avoidanceY = 0;

    // OPTIMIZATION: Skip whisker avoidance for stationary units or when explicitly skipped
    // Also skip if we have a valid path (pathfinding already avoids obstacles)
    const shouldSkipWhiskers = skipWhiskerAvoidance || (!entity.movement.moveTarget && !entity.combat.targetId && !hasValidPath);

    if (!shouldSkipWhiskers) {
        const angles = hasValidPath ? [0, 0.3, -0.3] : [0, 0.4, -0.4, 0.8, -0.8];
        const gridW = getGridW();
        const gridH = getGridH();
        const checkDist = entity.radius + (hasValidPath ? 10 : 15);

        for (const a of angles) {
            const cos = Math.cos(a);
            const sin = Math.sin(a);
            // OPTIMIZATION: Inline vector math to avoid object allocation
            const wx = dir.x * cos - dir.y * sin;
            const wy = dir.x * sin + dir.y * cos;
            const mag = Math.sqrt(wx * wx + wy * wy);
            const whiskerX = mag > 0.001 ? wx / mag : 0;
            const whiskerY = mag > 0.001 ? wy / mag : 0;

            const checkPosX = entity.pos.x + whiskerX * checkDist;
            const checkPosY = entity.pos.y + whiskerY * checkDist;

            const gx = Math.floor(checkPosX / TILE_SIZE);
            const gy = Math.floor(checkPosY / TILE_SIZE);

            if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
                if (collisionGrid[gy * gridW + gx] === 1) {
                    const baseWeight = hasValidPath ? 1.0 : 2.5;
                    const weight = a === 0 ? baseWeight : baseWeight * 0.6;
                    avoidanceX -= whiskerX * weight;
                    avoidanceY -= whiskerY * weight;
                }
            }
        }
    }

    let finalDir = dir;
    const avoidanceMag = Math.sqrt(avoidanceX * avoidanceX + avoidanceY * avoidanceY);
    if (entityCount > 0 || avoidanceMag > 0.001) {
        // OPTIMIZATION: Inline vector operations to reduce allocations
        const rightX = -dir.y;
        const rightY = dir.x;
        const rightBias = entityCount > 0 ? 0.4 : 0;

        // Project separation perpendicular to target direction to prevent "kiting" behavior.
        // When multiple units cluster to attack the same target, raw separation forces can
        // push them backward away from the target. By removing the backward component,
        // units spread out sideways instead of retreating.
        let sepX = separation.x;
        let sepY = separation.y;
        const sepDotDir = sepX * dir.x + sepY * dir.y;
        if (sepDotDir < 0) {
            // Separation is pointing backward - remove the backward component
            sepX -= sepDotDir * dir.x;
            sepY -= sepDotDir * dir.y;
        }

        // Additional per-axis scaling to reduce oscillation from diagonal clustering.
        // The perpendicular projection above removes backward component parallel to dir,
        // but when dir is diagonal, the resulting perpendicular vector can still have
        // components opposing individual axes. Scale these down to reduce oscillation.
        if ((dir.x > 0.3 && sepX < -0.1) || (dir.x < -0.3 && sepX > 0.1)) {
            sepX *= 0.4;
        }
        if ((dir.y > 0.3 && sepY < -0.1) || (dir.y < -0.3 && sepY > 0.1)) {
            sepY *= 0.4;
        }

        // finalDir = dir + separation*0.8 + avoidance + right*rightBias
        let fdX = dir.x + sepX * 0.8 + avoidanceX + rightX * rightBias;
        let fdY = dir.y + sepY * 0.8 + avoidanceY + rightY * rightBias;
        const fdMag = Math.sqrt(fdX * fdX + fdY * fdY);
        if (fdMag > 0.001) {
            fdX /= fdMag;
            fdY /= fdMag;
        } else if (entityCount > 0) {
            // Combined direction is near-zero (direction and separation cancel out)
            // This happens when units cluster around a target - prioritize escaping the cluster
            // Use separation direction if available, otherwise use perpendicular to target
            const sepMag = separation.mag();
            if (sepMag > 0.001) {
                // Move in separation direction (away from cluster)
                fdX = separation.x / sepMag;
                fdY = separation.y / sepMag;
            } else {
                // Fallback: move perpendicular to target (right side)
                fdX = rightX;
                fdY = rightY;
            }
        }
        finalDir = new Vector(fdX, fdY);

        const dotProduct = fdX * dir.x + fdY * dir.y;
        if (dotProduct < 0) {
            const rightDot = fdX * rightX + fdY * rightY;
            finalDir = new Vector(rightX * (rightDot >= 0 ? 1 : -1), rightY * (rightDot >= 0 ? 1 : -1));
        }
    }

    let newVel = finalDir.scale(speed);
    if (entity.movement.vel.mag() > 0.1 && newVel.mag() > 0.1) {
        const blended = entity.movement.vel.scale(0.6).add(newVel.scale(0.4));
        if (blended.mag() > 0.01) {
            newVel = blended.norm().scale(speed);
        }
    }

    return {
        ...entity,
        movement: {
            ...entity.movement,
            vel: newVel,
            stuckTimer,
            unstuckTimer: 0,
            unstuckDir: null,
            avgVel,
            path,
            pathIdx,
            finalDest
        }
    };
}

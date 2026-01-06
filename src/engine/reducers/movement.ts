import {
    Entity, Vector, UnitEntity, TILE_SIZE
} from '../types';
import { isUnitData } from '../../data/schemas/index';
import { getRuleData } from './helpers';
import { findPath, getGridW, getGridH, collisionGrid } from '../utils';
import { getSpatialGrid } from '../spatial';

/**
 * Move a unit toward a target position with pathfinding and collision avoidance.
 * Extracted to its own module to avoid circular dependencies.
 */
export function moveToward(entity: UnitEntity, target: Vector, _allEntities: Entity[], skipWhiskerAvoidance = false): UnitEntity {
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
    const effectiveVel = entity.pos.sub(entity.prevPos);
    avgVel = avgVel.scale(0.9).add(effectiveVel.scale(0.1));

    let stuckTimer = entity.movement.stuckTimer || 0;
    let unstuckDir = entity.movement.unstuckDir;
    let unstuckTimer = entity.movement.unstuckTimer || 0;
    let path = entity.movement.path;
    let pathIdx = entity.movement.pathIdx || 0;
    let finalDest = entity.movement.finalDest;

    // OPTIMIZATION: Skip pathfinding for very close targets - direct steering is sufficient
    const isCloseTarget = distToTarget < 80;

    const needNewPath = !isCloseTarget && (
        !path || path.length === 0 ||
        (finalDest && finalDest.dist(target) > 20) ||
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

    if (distToTarget > 10) {
        if (avgVel.mag() < speed * 0.15) {
            stuckTimer++;
        } else {
            stuckTimer = Math.max(0, stuckTimer - 2);
        }
    } else {
        stuckTimer = 0;
    }

    if (stuckTimer > 20) {
        unstuckTimer = 25;
        stuckTimer = 0;
        const toTarget = target.sub(entity.pos).norm();
        const perpendicular = Math.random() > 0.5
            ? new Vector(-toTarget.y, toTarget.x)
            : new Vector(toTarget.y, -toTarget.x);
        unstuckDir = perpendicular;
        path = null;
        pathIdx = 0;
    }

    if (unstuckTimer > 0 && unstuckDir) {
        return {
            ...entity,
            movement: {
                ...entity.movement,
                vel: unstuckDir.scale(speed * 0.8),
                stuckTimer: 0,
                unstuckTimer: unstuckTimer - 1,
                unstuckDir: unstuckDir,
                avgVel: avgVel,
                path: null,
                pathIdx: 0,
                finalDest
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

        if (d < minDist + 3 && d > 0.001) {
            const weight = (minDist + 3 - d) / (minDist + 3);
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

        // finalDir = dir + separation*0.8 + avoidance + right*rightBias
        let fdX = dir.x + separation.x * 0.8 + avoidanceX + rightX * rightBias;
        let fdY = dir.y + separation.y * 0.8 + avoidanceY + rightY * rightBias;
        const fdMag = Math.sqrt(fdX * fdX + fdY * fdY);
        if (fdMag > 0.001) {
            fdX /= fdMag;
            fdY /= fdMag;
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

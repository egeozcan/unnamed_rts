/**
 * AI Defensive Intelligence
 *
 * Handles smart positioning and reactive defense:
 * - Defensive line calculation
 * - Chokepoint detection
 * - Dynamic unit redeployment
 */

import { Entity, Vector, EntityId, Action, GameState } from '../../types.js';

// ============ TYPES ============

/**
 * A defensive line is a series of positions to defend
 */
export interface DefensiveLine {
    id: string;
    positions: Vector[];
    assignedUnits: EntityId[];
    priority: 'critical' | 'important' | 'optional';
    facing: Vector; // Direction the line faces
    width: number;
}

/**
 * A chokepoint is a narrow passage on the map
 */
export interface Chokepoint {
    position: Vector;
    width: number; // How narrow the passage is
    facing: Vector; // Direction of the passage
    controlValue: number; // How valuable to control (0-100)
}

/**
 * Defense zone around the base
 */
export interface DefenseZone {
    center: Vector;
    innerRadius: number;  // Core base area
    outerRadius: number;  // Extended defense area
    defensiveLines: DefensiveLine[];
    chokepoints: Chokepoint[];
}

// ============ DEFENSIVE LINE SYSTEM ============

/**
 * Calculate defensive line positions between two points
 */
export function calculateDefensiveLinePositions(
    start: Vector,
    end: Vector,
    unitCount: number,
    _spacing: number = 50
): Vector[] {
    const positions: Vector[] = [];

    if (unitCount <= 0) return positions;
    if (unitCount === 1) {
        // Single unit at midpoint
        const mid = new Vector(
            (start.x + end.x) / 2,
            (start.y + end.y) / 2
        );
        return [mid];
    }

    // Distribute units along the line
    for (let i = 0; i < unitCount; i++) {
        const t = i / (unitCount - 1);
        const pos = new Vector(
            start.x + (end.x - start.x) * t,
            start.y + (end.y - start.y) * t
        );
        positions.push(pos);
    }

    return positions;
}

/**
 * Create a defensive line facing a threat direction
 */
export function createDefensiveLine(
    center: Vector,
    threatDirection: Vector,
    unitCount: number,
    width: number = 300
): DefensiveLine {
    // Calculate line perpendicular to threat direction
    const perpendicular = new Vector(-threatDirection.y, threatDirection.x).norm();

    const halfWidth = width / 2;
    const start = center.add(perpendicular.scale(-halfWidth));
    const end = center.add(perpendicular.scale(halfWidth));

    const positions = calculateDefensiveLinePositions(start, end, unitCount);

    return {
        id: `defense_line_${Date.now()}`,
        positions,
        assignedUnits: [],
        priority: 'important',
        facing: threatDirection.norm(),
        width
    };
}

/**
 * Calculate optimal defensive positions around base
 */
export function calculateBaseDefensePositions(
    baseCenter: Vector,
    _buildings: Entity[],
    threatDirection: Vector | null,
    unitCount: number
): Vector[] {
    const positions: Vector[] = [];

    if (unitCount === 0) return positions;

    // If we know threat direction, create a line facing it
    if (threatDirection) {
        const line = createDefensiveLine(
            baseCenter.add(threatDirection.scale(200)), // Offset toward threat
            threatDirection,
            unitCount,
            Math.min(400, unitCount * 60)
        );
        return line.positions;
    }

    // No known threat - create circular defense
    const radius = 200;
    for (let i = 0; i < unitCount; i++) {
        const angle = (2 * Math.PI * i) / unitCount;
        const pos = baseCenter.add(new Vector(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius
        ));
        positions.push(pos);
    }

    return positions;
}

// ============ CHOKEPOINT DETECTION ============

/**
 * Simple chokepoint detection based on map obstacles
 * Note: Full implementation would require terrain analysis
 */
export function detectChokepoints(
    mapWidth: number,
    mapHeight: number,
    rocks: Entity[],
    buildings: Entity[]
): Chokepoint[] {
    const chokepoints: Chokepoint[] = [];

    // Find areas where rocks/buildings create narrow passages
    const obstacles = [...rocks, ...buildings];

    if (obstacles.length < 2) return chokepoints;

    // Simple algorithm: find pairs of obstacles close together
    // that create a passage
    const MIN_GAP = 80;
    const MAX_GAP = 200;

    for (let i = 0; i < obstacles.length; i++) {
        for (let j = i + 1; j < obstacles.length; j++) {
            const a = obstacles[i];
            const b = obstacles[j];
            const dist = a.pos.dist(b.pos);

            // Check if gap is chokepoint-sized
            if (dist >= MIN_GAP && dist <= MAX_GAP) {
                // Calculate chokepoint position (midpoint)
                const pos = new Vector(
                    (a.pos.x + b.pos.x) / 2,
                    (a.pos.y + b.pos.y) / 2
                );

                // Calculate facing (perpendicular to obstacle line)
                const obstacleDir = b.pos.sub(a.pos).norm();
                const facing = new Vector(-obstacleDir.y, obstacleDir.x);

                // Calculate control value based on position
                const centerDist = pos.dist(new Vector(mapWidth / 2, mapHeight / 2));
                const mapDiagonal = Math.sqrt(mapWidth * mapWidth + mapHeight * mapHeight);
                const controlValue = 100 * (1 - centerDist / mapDiagonal);

                chokepoints.push({
                    position: pos,
                    width: dist,
                    facing,
                    controlValue
                });
            }
        }
    }

    // Sort by control value
    chokepoints.sort((a, b) => b.controlValue - a.controlValue);

    return chokepoints.slice(0, 5); // Return top 5
}

// ============ DYNAMIC REDEPLOYMENT ============

/**
 * Calculate unit assignments for defensive positions
 */
export function assignUnitsToDefense(
    units: Entity[],
    defensivePositions: Vector[],
    maxPerPosition: number = 3
): Map<EntityId, Vector> {
    const assignments = new Map<EntityId, Vector>();

    if (units.length === 0 || defensivePositions.length === 0) {
        return assignments;
    }

    // Sort units by current proximity to defensive positions
    // Prefer units already near defensive positions
    const sortedUnits = [...units].sort((a, b) => {
        const aDist = Math.min(...defensivePositions.map(p => a.pos.dist(p)));
        const bDist = Math.min(...defensivePositions.map(p => b.pos.dist(p)));
        return aDist - bDist;
    });

    // Assign units to positions (distribute evenly)
    const positionCounts = new Map<number, number>();

    for (const unit of sortedUnits) {
        // Find best available position
        let bestPos = defensivePositions[0];
        let bestScore = -Infinity;

        for (let i = 0; i < defensivePositions.length; i++) {
            const pos = defensivePositions[i];
            const currentCount = positionCounts.get(i) || 0;

            if (currentCount >= maxPerPosition) continue;

            // Score based on proximity and available slots
            const dist = unit.pos.dist(pos);
            const slotBonus = (maxPerPosition - currentCount) * 100;
            const score = slotBonus - dist;

            if (score > bestScore) {
                bestScore = score;
                bestPos = pos;
            }
        }

        assignments.set(unit.id, bestPos);

        // Update count for chosen position
        const posIdx = defensivePositions.indexOf(bestPos);
        positionCounts.set(posIdx, (positionCounts.get(posIdx) || 0) + 1);
    }

    return assignments;
}

/**
 * Generate movement actions for defensive redeployment
 */
export function generateDefenseRedeploymentActions(
    state: GameState,
    units: Entity[],
    baseCenter: Vector,
    threatDirection: Vector | null,
    minDistanceToMove: number = 80
): Action[] {
    const actions: Action[] = [];

    // Calculate defensive positions
    const positions = calculateBaseDefensePositions(
        baseCenter,
        [],
        threatDirection,
        units.length
    );

    // Assign units to positions
    const assignments = assignUnitsToDefense(units, positions);

    // Generate move commands for units that need to relocate
    for (const [unitId, targetPos] of assignments) {
        const unit = state.entities[unitId];
        if (!unit) continue;

        const dist = unit.pos.dist(targetPos);
        if (dist > minDistanceToMove) {
            actions.push({
                type: 'COMMAND_MOVE',
                payload: {
                    unitIds: [unitId],
                    x: targetPos.x,
                    y: targetPos.y
                }
            });
        }
    }

    return actions;
}

// ============ THREAT RESPONSE ============

/**
 * Calculate threat direction from nearby enemies
 */
export function calculateThreatDirection(
    baseCenter: Vector,
    threats: Entity[]
): Vector | null {
    if (threats.length === 0) return null;

    // Calculate average direction to threats
    let sumDir = new Vector(0, 0);
    for (const threat of threats) {
        const dir = threat.pos.sub(baseCenter);
        sumDir = sumDir.add(dir);
    }

    const avgDir = sumDir.scale(1 / threats.length);
    if (avgDir.mag() < 1) return null;

    return avgDir.norm();
}

/**
 * Prioritize threats by danger level
 */
export function prioritizeThreats(
    threats: Entity[],
    baseCenter: Vector,
    buildings: Entity[]
): Entity[] {
    return [...threats].sort((a, b) => {
        let aScore = 0;
        let bScore = 0;

        // Distance to base center
        aScore -= a.pos.dist(baseCenter) * 0.1;
        bScore -= b.pos.dist(baseCenter) * 0.1;

        // Proximity to buildings
        for (const building of buildings) {
            if (a.pos.dist(building.pos) < 200) aScore += 50;
            if (b.pos.dist(building.pos) < 200) bScore += 50;
        }

        // Unit type danger
        const aDanger = getUnitDangerLevel(a.key);
        const bDanger = getUnitDangerLevel(b.key);
        aScore += aDanger;
        bScore += bDanger;

        return bScore - aScore; // Higher score = more dangerous
    });
}

/**
 * Get danger level for a unit type
 */
function getUnitDangerLevel(unitKey: string): number {
    const dangerLevels: Record<string, number> = {
        mammoth: 100,
        heavy: 80,
        artillery: 90,
        mlrs: 85,
        light: 50,
        flame_tank: 70,
        heli: 75,
        rocket: 60,
        commando: 70,
        rifle: 30,
        harvester: 10
    };
    return dangerLevels[unitKey] || 40;
}

// ============ RESERVE MANAGEMENT ============

/**
 * Calculate how many units to keep in reserve
 */
export function calculateReserveSize(
    totalUnits: number,
    threatLevel: number,
    riskTolerance: number
): number {
    // Base reserve: 20% of army
    const baseReserve = Math.ceil(totalUnits * 0.2);

    // Increase reserve with threat level
    const threatBonus = Math.floor((threatLevel / 100) * totalUnits * 0.3);

    // Decrease reserve with risk tolerance
    const riskModifier = 1 - (riskTolerance * 0.5);

    return Math.max(1, Math.floor((baseReserve + threatBonus) * riskModifier));
}

/**
 * Position reserve units near base center
 */
export function positionReserve(
    reserveUnits: Entity[],
    baseCenter: Vector
): Map<EntityId, Vector> {
    const positions = new Map<EntityId, Vector>();

    const spacing = 40;
    const cols = Math.ceil(Math.sqrt(reserveUnits.length));

    for (let i = 0; i < reserveUnits.length; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;

        const offsetX = (col - cols / 2) * spacing;
        const offsetY = (row - cols / 2) * spacing;

        const pos = baseCenter.add(new Vector(offsetX, offsetY));
        positions.set(reserveUnits[i].id, pos);
    }

    return positions;
}

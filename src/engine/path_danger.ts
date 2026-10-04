// Shared by the in-thread A* (utils.ts) and the pathfinding worker: keep this module import-free.

// When the goal itself is inside enemy danger (e.g. an attack target under defense cover), every
// route has to cross danger near the end, A* degrades to Dijkstra and runs out of iterations even
// though the goal is reachable. So danger is ignored within the goal's "depth" into danger: the
// Chebyshev distance from the goal to the nearest danger-free tile, capped at this many tiles.
const MAX_DANGER_FREE_GOAL_RADIUS = 8;

/**
 * Radius (Chebyshev, in tiles) around the goal inside which danger costs are ignored: -1 when the
 * goal tile is safe (no exemption), else the distance to the nearest danger-free tile (max 8).
 */
export function dangerFreeGoalRadius(goalGx: number, goalGy: number, gridW: number, gridH: number, dangerGrid: Uint8Array | null | undefined): number {
    if (!dangerGrid) return -1;
    if (goalGx < 0 || goalGx >= gridW || goalGy < 0 || goalGy >= gridH) return -1;
    if (dangerGrid[goalGy * gridW + goalGx] === 0) return -1;
    for (let r = 1; r < MAX_DANGER_FREE_GOAL_RADIUS; r++) {
        const y0 = Math.max(0, goalGy - r), y1 = Math.min(gridH - 1, goalGy + r);
        const x0 = Math.max(0, goalGx - r), x1 = Math.min(gridW - 1, goalGx + r);
        for (let y = y0; y <= y1; y++) {
            const onEdgeRow = y === goalGy - r || y === goalGy + r;
            for (let x = x0; x <= x1; x++) {
                if (!onEdgeRow && x !== goalGx - r && x !== goalGx + r) continue;
                if (dangerGrid[y * gridW + x] === 0) return r;
            }
        }
    }
    return MAX_DANGER_FREE_GOAL_RADIUS;
}

/**
 * Web Worker for A* Pathfinding
 * Runs pathfinding calculations off the main thread
 */

// Types (duplicated here since workers can't import from main thread easily)
const TILE_SIZE = 40;

interface PathNode {
    x: number;
    y: number;
    g: number;
    h: number;
    f: number;
    parent: PathNode | null;
}

interface PathRequest {
    id: number;
    startX: number;
    startY: number;
    goalX: number;
    goalY: number;
    entityRadius: number;
    ownerId?: number;
}

interface PathResult {
    id: number;
    path: { x: number; y: number }[] | null;
}

interface GridUpdate {
    type: 'collision' | 'danger';
    playerId?: number;
    data: Uint8Array | number[];
    gridW: number;
    gridH: number;
}

// Worker state
let collisionGrid: Uint8Array | null = null;
let dangerGrids: Map<number, Uint8Array> = new Map();
let gridW = 0;
let gridH = 0;

// MinHeap for A*
class MinHeap {
    private heap: PathNode[] = [];

    push(node: PathNode): void {
        this.heap.push(node);
        this.bubbleUp(this.heap.length - 1);
    }

    pop(): PathNode | null {
        if (this.heap.length === 0) return null;
        const min = this.heap[0];
        const last = this.heap.pop()!;
        if (this.heap.length > 0) {
            this.heap[0] = last;
            this.bubbleDown(0);
        }
        return min;
    }

    isEmpty(): boolean {
        return this.heap.length === 0;
    }

    private bubbleUp(i: number): void {
        while (i > 0) {
            const parent = Math.floor((i - 1) / 2);
            if (this.heap[parent].f <= this.heap[i].f) break;
            [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
            i = parent;
        }
    }

    private bubbleDown(i: number): void {
        while (true) {
            const left = 2 * i + 1;
            const right = 2 * i + 2;
            let smallest = i;

            if (left < this.heap.length && this.heap[left].f < this.heap[smallest].f) {
                smallest = left;
            }
            if (right < this.heap.length && this.heap[right].f < this.heap[smallest].f) {
                smallest = right;
            }
            if (smallest === i) break;
            [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
            i = smallest;
        }
    }
}

// 8 directions: [dx, dy, cost]
const dirs: [number, number, number][] = [
    [0, -1, 1], [1, -1, 1.41], [1, 0, 1], [1, 1, 1.41],
    [0, 1, 1], [-1, 1, 1.41], [-1, 0, 1], [-1, -1, 1.41]
];

function findPath(request: PathRequest): PathResult {
    if (!collisionGrid) {
        return { id: request.id, path: null };
    }

    const startGx = Math.floor(request.startX / TILE_SIZE);
    const startGy = Math.floor(request.startY / TILE_SIZE);
    const goalGx = Math.floor(request.goalX / TILE_SIZE);
    const goalGy = Math.floor(request.goalY / TILE_SIZE);

    // Check if goal is blocked - find nearest unblocked tile
    let actualGoalGx = goalGx;
    let actualGoalGy = goalGy;

    if (goalGx >= 0 && goalGx < gridW && goalGy >= 0 && goalGy < gridH) {
        if (collisionGrid[goalGy * gridW + goalGx] === 1) {
            let found = false;
            for (let r = 1; r <= 5 && !found; r++) {
                for (let dy = -r; dy <= r && !found; dy++) {
                    for (let dx = -r; dx <= r && !found; dx++) {
                        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
                        const nx = goalGx + dx;
                        const ny = goalGy + dy;
                        if (nx >= 0 && nx < gridW && ny >= 0 && ny < gridH) {
                            if (collisionGrid[ny * gridW + nx] === 0) {
                                actualGoalGx = nx;
                                actualGoalGy = ny;
                                found = true;
                            }
                        }
                    }
                }
            }
        }
    }

    // If start is blocked, return null
    if (startGx >= 0 && startGx < gridW && startGy >= 0 && startGy < gridH) {
        if (collisionGrid[startGy * gridW + startGx] === 1) {
            return { id: request.id, path: null };
        }
    }

    // A* algorithm
    const gridSize = gridW * gridH;
    const openSet = new MinHeap();
    const closedSet = new Uint8Array(gridSize);
    const openMap = new Map<number, PathNode>();
    const dangerGrid = request.ownerId !== undefined ? dangerGrids.get(request.ownerId) : null;

    // Octile heuristic
    const dx0 = Math.abs(actualGoalGx - startGx);
    const dy0 = Math.abs(actualGoalGy - startGy);
    const startH = Math.max(dx0, dy0) + 0.41 * Math.min(dx0, dy0);

    const startNode: PathNode = {
        x: startGx,
        y: startGy,
        g: 0,
        h: startH,
        f: startH,
        parent: null
    };

    const startKey = startGy * gridW + startGx;
    openSet.push(startNode);
    openMap.set(startKey, startNode);

    let iterations = 0;
    const maxIterations = 4000;

    while (!openSet.isEmpty() && iterations < maxIterations) {
        iterations++;
        const current = openSet.pop()!;
        const currentKey = current.y * gridW + current.x;

        if (closedSet[currentKey] === 1) continue;

        if (current.x === actualGoalGx && current.y === actualGoalGy) {
            // Reconstruct path
            const gridPath: { x: number; y: number }[] = [];
            let node: PathNode | null = current;
            while (node) {
                gridPath.unshift({ x: node.x, y: node.y });
                node = node.parent;
            }

            // Convert to world coordinates
            const path: { x: number; y: number }[] = [];
            for (const p of gridPath) {
                path.push({
                    x: p.x * TILE_SIZE + TILE_SIZE / 2,
                    y: p.y * TILE_SIZE + TILE_SIZE / 2
                });
            }

            // Add actual goal position
            path.push({ x: request.goalX, y: request.goalY });

            // Skip smoothing for short paths
            if (path.length <= 4) {
                return { id: request.id, path };
            }

            // Smooth longer paths
            const smoothedPath = smoothPath(path, request.entityRadius);
            return { id: request.id, path: smoothedPath };
        }

        closedSet[currentKey] = 1;
        openMap.delete(currentKey);

        const cx = current.x;
        const cy = current.y;
        const cg = current.g;

        for (let d = 0; d < 8; d++) {
            const dx = dirs[d][0];
            const dy = dirs[d][1];
            const cost = dirs[d][2];

            const nx = cx + dx;
            const ny = cy + dy;

            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;

            const neighborKey = ny * gridW + nx;
            if (closedSet[neighborKey] === 1) continue;
            if (collisionGrid[neighborKey] === 1) continue;

            // Check diagonal corner cutting
            if (dx !== 0 && dy !== 0) {
                if (collisionGrid[cy * gridW + nx] === 1 || collisionGrid[ny * gridW + cx] === 1) continue;
            }

            const dangerCost = dangerGrid ? dangerGrid[neighborKey] : 0;
            const g = cg + cost + dangerCost;
            const existingNode = openMap.get(neighborKey);

            if (!existingNode || g < existingNode.g) {
                const hdx = Math.abs(actualGoalGx - nx);
                const hdy = Math.abs(actualGoalGy - ny);
                const h = Math.max(hdx, hdy) + 0.41 * Math.min(hdx, hdy);

                const newNode: PathNode = {
                    x: nx,
                    y: ny,
                    g,
                    h,
                    f: g + h,
                    parent: current
                };

                if (!existingNode) {
                    openSet.push(newNode);
                    openMap.set(neighborKey, newNode);
                } else {
                    existingNode.g = g;
                    existingNode.f = g + h;
                    existingNode.parent = current;
                }
            }
        }
    }

    return { id: request.id, path: null };
}

function smoothPath(path: { x: number; y: number }[], entityRadius: number): { x: number; y: number }[] {
    if (path.length <= 2) return path;

    const result: { x: number; y: number }[] = [path[0]];
    let current = 0;

    while (current < path.length - 1) {
        let farthest = current + 1;

        for (let i = path.length - 1; i > current + 1; i--) {
            if (hasLineOfSight(path[current], path[i], entityRadius)) {
                farthest = i;
                break;
            }
        }

        result.push(path[farthest]);
        current = farthest;
    }

    return result;
}

function hasLineOfSight(from: { x: number; y: number }, to: { x: number; y: number }, entityRadius: number): boolean {
    if (!collisionGrid) return true;

    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.ceil(dist / (TILE_SIZE / 2));

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = from.x + dx * t;
        const y = from.y + dy * t;

        // Check center point
        const gx = Math.floor(x / TILE_SIZE);
        const gy = Math.floor(y / TILE_SIZE);

        if (gx >= 0 && gx < gridW && gy >= 0 && gy < gridH) {
            if (collisionGrid[gy * gridW + gx] === 1) return false;
        }

        // Check offset points for entity radius
        const offsets = [
            { dx: entityRadius, dy: 0 },
            { dx: -entityRadius, dy: 0 },
            { dx: 0, dy: entityRadius },
            { dx: 0, dy: -entityRadius }
        ];

        for (const offset of offsets) {
            const ox = Math.floor((x + offset.dx) / TILE_SIZE);
            const oy = Math.floor((y + offset.dy) / TILE_SIZE);

            if (ox >= 0 && ox < gridW && oy >= 0 && oy < gridH) {
                if (collisionGrid[oy * gridW + ox] === 1) return false;
            }
        }
    }

    return true;
}

// Message handler
self.onmessage = (e: MessageEvent) => {
    const { type, data } = e.data;

    switch (type) {
        case 'init':
            // Initialize grid dimensions
            gridW = data.gridW;
            gridH = data.gridH;
            collisionGrid = new Uint8Array(gridW * gridH);
            break;

        case 'updateCollision':
            // Update collision grid
            if (data.data instanceof ArrayBuffer) {
                collisionGrid = new Uint8Array(data.data);
            } else {
                collisionGrid = new Uint8Array(data.data);
            }
            gridW = data.gridW;
            gridH = data.gridH;
            break;

        case 'updateDanger':
            // Update danger grid for a specific player
            const playerId = data.playerId;
            if (data.data instanceof ArrayBuffer) {
                dangerGrids.set(playerId, new Uint8Array(data.data));
            } else {
                dangerGrids.set(playerId, new Uint8Array(data.data));
            }
            break;

        case 'findPath':
            // Process path request
            const result = findPath(data as PathRequest);
            self.postMessage({ type: 'pathResult', data: result });
            break;

        case 'findPathBatch':
            // Process multiple path requests
            const results: PathResult[] = [];
            for (const request of data.requests as PathRequest[]) {
                results.push(findPath(request));
            }
            self.postMessage({ type: 'pathResultBatch', data: results });
            break;
    }
};

// Signal that worker is ready
self.postMessage({ type: 'ready' });

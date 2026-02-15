/**
 * Pathfinding Worker Manager
 * Manages communication between main thread and pathfinding web worker
 */

import { Vector } from './types.js';

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

interface PendingRequest {
    resolve: (path: Vector[] | null) => void;
    reject: (error: Error) => void;
    timestamp: number;
}

class PathfindingWorkerManager {
    private worker: Worker | null = null;
    private ready = false;
    private requestId = 0;
    private pendingRequests: Map<number, PendingRequest> = new Map();
    private enabled = true;
    private initPromise: Promise<void> | null = null;
    private collisionGridScratch: Uint8Array | null = null;
    private dangerGridScratchByPlayer = new Map<number, Uint8Array>();

    // Request timeout in ms
    private readonly REQUEST_TIMEOUT = 1000;

    constructor() {
        // Don't initialize in constructor - wait for explicit init
    }

    /**
     * Initialize the worker
     */
    async init(gridW: number, gridH: number): Promise<void> {
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve, reject) => {
            try {
                // Create worker using Vite's worker syntax
                this.worker = new Worker(
                    new URL('./pathfinding.worker.ts', import.meta.url),
                    { type: 'module' }
                );

                this.worker.onmessage = (e: MessageEvent) => {
                    this.handleMessage(e.data);
                    if (e.data.type === 'ready') {
                        // Send init message
                        this.worker!.postMessage({
                            type: 'init',
                            data: { gridW, gridH }
                        });
                        this.ready = true;
                        resolve();
                    }
                };

                this.worker.onerror = (error) => {
                    console.error('[PathWorker] Worker error:', error);
                    this.enabled = false;
                    reject(error);
                };

                // Timeout for worker initialization
                setTimeout(() => {
                    if (!this.ready) {
                        console.warn('[PathWorker] Worker initialization timeout, falling back to sync');
                        this.enabled = false;
                        resolve(); // Resolve anyway to not block
                    }
                }, 2000);
            } catch (error) {
                console.warn('[PathWorker] Failed to create worker, falling back to sync:', error);
                this.enabled = false;
                resolve(); // Resolve anyway to not block
            }
        });

        return this.initPromise;
    }

    /**
     * Check if worker is enabled and ready
     */
    isEnabled(): boolean {
        return this.enabled && this.ready && this.worker !== null;
    }

    /**
     * Handle messages from worker
     */
    private handleMessage(message: { type: string; data: PathResult | PathResult[] }): void {
        if (message.type === 'pathResult') {
            const result = message.data as PathResult;
            this.resolveRequest(result);
        } else if (message.type === 'pathResultBatch') {
            const results = message.data as PathResult[];
            for (const result of results) {
                this.resolveRequest(result);
            }
        }
    }

    /**
     * Resolve a pending request with its result
     */
    private resolveRequest(result: PathResult): void {
        const pending = this.pendingRequests.get(result.id);
        if (pending) {
            this.pendingRequests.delete(result.id);

            if (result.path) {
                // Convert to Vector objects
                const path = result.path.map(p => new Vector(p.x, p.y));
                pending.resolve(path);
            } else {
                pending.resolve(null);
            }
        }
    }

    /**
     * Update collision grid in worker
     */
    updateCollisionGrid(grid: Uint8Array, gridW: number, gridH: number): void {
        if (!this.isEnabled()) return;

        if (!this.collisionGridScratch || this.collisionGridScratch.length !== grid.length) {
            this.collisionGridScratch = new Uint8Array(grid.length);
        }
        this.collisionGridScratch.set(grid);

        this.worker!.postMessage({
            type: 'updateCollision',
            data: {
                data: this.collisionGridScratch,
                gridW,
                gridH
            }
        });
    }

    /**
     * Update danger grid for a specific player
     */
    updateDangerGrid(playerId: number, grid: Uint8Array): void {
        if (!this.isEnabled()) return;

        let scratch = this.dangerGridScratchByPlayer.get(playerId);
        if (!scratch || scratch.length !== grid.length) {
            scratch = new Uint8Array(grid.length);
            this.dangerGridScratchByPlayer.set(playerId, scratch);
        }
        scratch.set(grid);

        this.worker!.postMessage({
            type: 'updateDanger',
            data: {
                playerId,
                data: scratch
            }
        });
    }

    /**
     * Request a path asynchronously
     * Returns a promise that resolves with the path or null
     */
    requestPath(
        start: Vector,
        goal: Vector,
        entityRadius: number,
        ownerId?: number
    ): Promise<Vector[] | null> {
        if (!this.isEnabled()) {
            // Return rejected promise to signal caller should use sync fallback
            return Promise.reject(new Error('Worker not enabled'));
        }

        const id = ++this.requestId;
        const request: PathRequest = {
            id,
            startX: start.x,
            startY: start.y,
            goalX: goal.x,
            goalY: goal.y,
            entityRadius,
            ownerId
        };

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, {
                resolve,
                reject,
                timestamp: Date.now()
            });

            this.worker!.postMessage({
                type: 'findPath',
                data: request
            });

            // Set timeout for this request
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    resolve(null); // Resolve with null on timeout (unit will use direct movement)
                }
            }, this.REQUEST_TIMEOUT);
        });
    }

    /**
     * Request multiple paths at once (batch processing)
     */
    requestPathBatch(
        requests: Array<{
            start: Vector;
            goal: Vector;
            entityRadius: number;
            ownerId?: number;
        }>
    ): Promise<(Vector[] | null)[]> {
        if (!this.isEnabled()) {
            return Promise.reject(new Error('Worker not enabled'));
        }

        const batchRequests: PathRequest[] = [];
        const promises: Promise<Vector[] | null>[] = [];

        for (const req of requests) {
            const id = ++this.requestId;
            batchRequests.push({
                id,
                startX: req.start.x,
                startY: req.start.y,
                goalX: req.goal.x,
                goalY: req.goal.y,
                entityRadius: req.entityRadius,
                ownerId: req.ownerId
            });

            promises.push(new Promise((resolve, reject) => {
                this.pendingRequests.set(id, {
                    resolve,
                    reject,
                    timestamp: Date.now()
                });
            }));
        }

        this.worker!.postMessage({
            type: 'findPathBatch',
            data: { requests: batchRequests }
        });

        // Set timeout for batch
        setTimeout(() => {
            for (const req of batchRequests) {
                if (this.pendingRequests.has(req.id)) {
                    this.pendingRequests.delete(req.id);
                }
            }
        }, this.REQUEST_TIMEOUT);

        return Promise.all(promises);
    }

    /**
     * Clean up stale requests
     */
    cleanupStaleRequests(): void {
        const now = Date.now();
        for (const [id, pending] of this.pendingRequests) {
            if (now - pending.timestamp > this.REQUEST_TIMEOUT) {
                this.pendingRequests.delete(id);
                pending.resolve(null);
            }
        }
    }

    /**
     * Get number of pending requests
     */
    getPendingCount(): number {
        return this.pendingRequests.size;
    }

    /**
     * Terminate the worker
     */
    terminate(): void {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.ready = false;
        }
        this.pendingRequests.clear();
        this.collisionGridScratch = null;
        this.dangerGridScratchByPlayer.clear();
    }
}

// Singleton instance
export const pathfindingWorker = new PathfindingWorkerManager();

// Also export the class for testing
export { PathfindingWorkerManager };

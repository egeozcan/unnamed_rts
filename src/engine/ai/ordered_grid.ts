import type { Entity } from '../types.js';

const KEY_OFFSET = 32768;
const KEY_STRIDE = 65536;

/**
 * Order-preserving uniform grid over a fixed entity list.
 *
 * `queryBox` returns every entity whose position lies strictly within `r` of
 * (x, y) on both axes, in the same relative order as the source list, so a
 * caller that replaces a linear scan with it sees exactly the same sequence
 * (important when results feed floating-point sums or first-wins tie breaks).
 */
export class OrderedEntityGrid {
    private readonly cells = new Map<number, number[]>();
    private readonly scratch: number[] = [];

    constructor(private readonly items: readonly Entity[], private readonly cellSize: number) {
        for (let i = 0; i < items.length; i++) {
            const p = items[i].pos;
            const key = this.key(Math.floor(p.x / cellSize), Math.floor(p.y / cellSize));
            const cell = this.cells.get(key);
            if (cell) cell.push(i);
            else this.cells.set(key, [i]);
        }
    }

    private key(cx: number, cy: number): number {
        return (cx + KEY_OFFSET) * KEY_STRIDE + (cy + KEY_OFFSET);
    }

    /** Entities with |dx| < r and |dy| < r, in source order. */
    queryBox(x: number, y: number, r: number, out: Entity[]): Entity[] {
        const cs = this.cellSize;
        const minCx = Math.floor((x - r) / cs), maxCx = Math.floor((x + r) / cs);
        const minCy = Math.floor((y - r) / cs), maxCy = Math.floor((y + r) / cs);
        const idx = this.scratch;
        idx.length = 0;
        let cellsHit = 0;
        for (let cx = minCx; cx <= maxCx; cx++) {
            for (let cy = minCy; cy <= maxCy; cy++) {
                const cell = this.cells.get(this.key(cx, cy));
                if (!cell) continue;
                cellsHit++;
                for (const i of cell) {
                    const p = this.items[i].pos;
                    const dx = p.x - x;
                    if (dx >= r || dx <= -r) continue;
                    const dy = p.y - y;
                    if (dy >= r || dy <= -r) continue;
                    idx.push(i);
                }
            }
        }
        // Each cell is already ascending; only merge-order across cells
        if (cellsHit > 1 && idx.length > 1) idx.sort((a, b) => a - b);
        for (const i of idx) out.push(this.items[i]);
        return out;
    }
}

import { GameState, TILE_SIZE } from '../types';
import { RULES } from '../../data/schemas/index';
import { isAlly } from '../teams';
import { isTransportedUnit } from '../transport';

/**
 * Create a new fog grid for a given map size.
 * All tiles start as 0 (unseen).
 */
export function createFogGrid(mapWidth: number, mapHeight: number): Uint8Array {
    const gridW = Math.ceil(mapWidth / TILE_SIZE);
    const gridH = Math.ceil(mapHeight / TILE_SIZE);
    return new Uint8Array(gridW * gridH);
}

/**
 * Look up the sightRange for an entity key from rules.json.
 * Returns 0 if not found.
 */
function getSightRange(key: string): number {
    const unitData = RULES.units[key];
    if (unitData?.sightRange) return unitData.sightRange;
    const buildingData = RULES.buildings[key];
    if (buildingData?.sightRange) return buildingData.sightRange;
    return 0;
}

/**
 * Per fog grid: the last (tile, sight) each entity revealed from. Fog is additive-only, so an entity
 * that is still on the same tile with the same sight range cannot reveal anything new and can be
 * skipped without walking its (2r+1)^2 tile neighbourhood again. Keyed on the grid so a fresh game
 * (new Uint8Array) starts with an empty memo.
 */
const revealMemo = new WeakMap<Uint8Array, Map<string, number>>();

/**
 * Update fog of war grids for all human players.
 * Reveals tiles within each owned entity's sight range.
 * Tiles are permanently revealed (additive only, never reset to 0).
 *
 * NOTE: We mutate the Uint8Array in-place for performance.
 * This is safe ONLY because fog is additive-only (tiles go 0 -> 1, never back).
 * If re-fogging is ever added, this must create a new Uint8Array copy.
 *
 * Returns the same fogOfWar record reference if nothing changed,
 * or a new record with updated Uint8Arrays for players whose fog changed.
 */
export function updateFogOfWar(state: GameState): Record<number, Uint8Array> {
    const { fogOfWar, entities, config } = state;

    // Early exit if no fog grids exist (demo/observer mode)
    const playerIds = Object.keys(fogOfWar).map(Number);
    if (playerIds.length === 0) return fogOfWar;

    const gridW = Math.ceil(config.width / TILE_SIZE);
    const gridH = Math.ceil(config.height / TILE_SIZE);

    // Track which players had changes
    let anyChanged = false;
    const result: Record<number, Uint8Array> = {};

    for (const playerId of playerIds) {
        const grid = fogOfWar[playerId];
        if (!grid) continue;

        let changed = false;

        let memo = revealMemo.get(grid);
        if (!memo) {
            memo = new Map();
            revealMemo.set(grid, memo);
        }
        let considered = 0;

        for (const id in entities) {
            const entity = entities[id];
            if (entity.dead) continue;
            if (isTransportedUnit(entity)) continue;
            if (!isAlly(state, entity.owner, playerId)) continue;

            const sightRange = getSightRange(entity.key);
            if (sightRange <= 0) continue;

            const sightTiles = Math.ceil(sightRange / TILE_SIZE);
            const centerTileX = Math.floor(entity.pos.x / TILE_SIZE);
            const centerTileY = Math.floor(entity.pos.y / TILE_SIZE);
            considered++;

            // Skip entities that haven't moved to a new tile since they last revealed.
            // Tile coordinates are clamped so off-map positions can't alias another tile's key.
            const keyX = Math.max(-1, Math.min(gridW, centerTileX));
            const keyY = Math.max(-1, Math.min(gridH, centerTileY));
            const memoKey = ((keyY + 1) * (gridW + 2) + (keyX + 1)) * 1024 + sightTiles;
            if (memo.get(id) === memoKey) continue;
            memo.set(id, memoKey);

            const sightTilesSq = (sightRange / TILE_SIZE) * (sightRange / TILE_SIZE);

            const minTX = Math.max(0, centerTileX - sightTiles);
            const maxTX = Math.min(gridW - 1, centerTileX + sightTiles);
            const minTY = Math.max(0, centerTileY - sightTiles);
            const maxTY = Math.min(gridH - 1, centerTileY + sightTiles);

            for (let ty = minTY; ty <= maxTY; ty++) {
                for (let tx = minTX; tx <= maxTX; tx++) {
                    const idx = ty * gridW + tx;
                    if (grid[idx] === 1) continue; // Already revealed

                    // Circular distance check in tile space
                    const dx = tx - centerTileX;
                    const dy = ty - centerTileY;
                    if (dx * dx + dy * dy <= sightTilesSq) {
                        grid[idx] = 1;
                        changed = true;
                    }
                }
            }
        }

        // Dead / removed entities never get cleaned out of the memo individually; start over when it
        // has grown well past the live entity count (costs one full reveal pass next tick).
        if (memo.size > considered * 2 + 256) memo.clear();

        if (changed) {
            anyChanged = true;
        }
        result[playerId] = grid;
    }

    return anyChanged ? result : fogOfWar;
}

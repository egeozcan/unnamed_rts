import { GameState, TILE_SIZE } from '../types';
import { RULES } from '../../data/schemas/index';

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
 * Update fog of war grids for all human players.
 * Reveals tiles within each owned entity's sight range.
 * Tiles are permanently revealed (additive only, never reset to 0).
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

    // Track which players had changes
    let anyChanged = false;
    const result: Record<number, Uint8Array> = {};

    for (const playerId of playerIds) {
        const grid = fogOfWar[playerId];
        if (!grid) continue;

        let changed = false;

        for (const id in entities) {
            const entity = entities[id];
            if (entity.dead) continue;
            if (entity.owner !== playerId) continue;

            const sightRange = getSightRange(entity.key);
            if (sightRange <= 0) continue;

            const sightTiles = Math.ceil(sightRange / TILE_SIZE);
            const sightTilesSq = (sightRange / TILE_SIZE) * (sightRange / TILE_SIZE);
            const centerTileX = Math.floor(entity.pos.x / TILE_SIZE);
            const centerTileY = Math.floor(entity.pos.y / TILE_SIZE);

            const gridH = Math.ceil(config.height / TILE_SIZE);
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

        if (changed) {
            anyChanged = true;
        }
        result[playerId] = grid;
    }

    return anyChanged ? result : fogOfWar;
}

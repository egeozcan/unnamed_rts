import { describe, it, expect, beforeEach } from 'vitest';
import { createTestBuilding, resetTestEntityCounter } from '../../src/engine/test-utils';
import { createPlayerState, INITIAL_STATE } from '../../src/engine/reducer';
import { createFogGrid, updateFogOfWar } from '../../src/engine/reducers/fog';
import { TILE_SIZE } from '../../src/engine/types';

beforeEach(() => resetTestEntityCounter());

describe('shared fog of war for teams', () => {
    it('ally entities reveal fog for teammate', () => {
        const players: Record<number, any> = {
            0: createPlayerState(0, false, 'medium', '#fff', 'classic', 'A'),
            1: createPlayerState(1, true, 'medium', '#fff', 'classic', 'A'),
        };
        const mapWidth = 400;
        const mapHeight = 400;

        // P1 has a building at (200, 200) — should reveal fog for P0
        const allyBuilding = createTestBuilding({ owner: 1, key: 'conyard', x: 200, y: 200 });

        const fogOfWar: Record<number, Uint8Array> = {
            0: createFogGrid(mapWidth, mapHeight),
        };

        const state = {
            ...INITIAL_STATE,
            players,
            entities: { [allyBuilding.id]: allyBuilding },
            config: { width: mapWidth, height: mapHeight, resourceDensity: 'medium' as const, rockDensity: 'medium' as const },
            fogOfWar,
        };

        const result = updateFogOfWar(state);

        // Tile at building position should be revealed
        const gridW = Math.ceil(mapWidth / TILE_SIZE);
        const tileX = Math.floor(200 / TILE_SIZE);
        const tileY = Math.floor(200 / TILE_SIZE);
        const idx = tileY * gridW + tileX;
        expect(result[0][idx]).toBe(1);
    });

    it('non-ally entities do not reveal fog', () => {
        const players: Record<number, any> = {
            0: createPlayerState(0, false, 'medium', '#fff', 'classic', 'A'),
            2: createPlayerState(2, true, 'medium', '#fff', 'classic', 'B'),
        };
        const mapWidth = 400;
        const mapHeight = 400;

        // P2 has a building — should NOT reveal fog for P0
        const enemyBuilding = createTestBuilding({ owner: 2, key: 'conyard', x: 200, y: 200 });

        const fogOfWar: Record<number, Uint8Array> = {
            0: createFogGrid(mapWidth, mapHeight),
        };

        const state = {
            ...INITIAL_STATE,
            players,
            entities: { [enemyBuilding.id]: enemyBuilding },
            config: { width: mapWidth, height: mapHeight, resourceDensity: 'medium' as const, rockDensity: 'medium' as const },
            fogOfWar,
        };

        const result = updateFogOfWar(state);

        // Tile should NOT be revealed
        const gridW = Math.ceil(mapWidth / TILE_SIZE);
        const tileX = Math.floor(200 / TILE_SIZE);
        const tileY = Math.floor(200 / TILE_SIZE);
        const idx = tileY * gridW + tileX;
        expect(result[0][idx]).toBe(0);
    });

    it('own entities still reveal fog (isAlly includes self)', () => {
        const players: Record<number, any> = {
            0: createPlayerState(0, false, 'medium', '#fff', 'classic', 'A'),
        };
        const mapWidth = 400;
        const mapHeight = 400;

        const ownBuilding = createTestBuilding({ owner: 0, key: 'conyard', x: 200, y: 200 });

        const fogOfWar: Record<number, Uint8Array> = {
            0: createFogGrid(mapWidth, mapHeight),
        };

        const state = {
            ...INITIAL_STATE,
            players,
            entities: { [ownBuilding.id]: ownBuilding },
            config: { width: mapWidth, height: mapHeight, resourceDensity: 'medium' as const, rockDensity: 'medium' as const },
            fogOfWar,
        };

        const result = updateFogOfWar(state);

        const gridW = Math.ceil(mapWidth / TILE_SIZE);
        const tileX = Math.floor(200 / TILE_SIZE);
        const tileY = Math.floor(200 / TILE_SIZE);
        const idx = tileY * gridW + tileX;
        expect(result[0][idx]).toBe(1);
    });
});

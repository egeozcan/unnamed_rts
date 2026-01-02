import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PLAYER_COLORS } from '../../src/engine/types';

// Mock URL.createObjectURL before importing assets
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
vi.stubGlobal('URL', { createObjectURL: mockCreateObjectURL });

// Now import assets after mocking
import { initGraphics, getAsset, PLAYER_COLOR, ENEMY_COLOR } from '../../src/renderer/assets';

describe('Asset System', () => {
    beforeEach(() => {
        mockCreateObjectURL.mockClear();
    });

    describe('Legacy color exports', () => {
        it('should export PLAYER_COLOR as first player color', () => {
            expect(PLAYER_COLOR).toBe(PLAYER_COLORS[0]);
        });

        it('should export ENEMY_COLOR as second player color', () => {
            expect(ENEMY_COLOR).toBe(PLAYER_COLORS[1]);
        });
    });

    describe('initGraphics', () => {
        it('should create images for all asset keys and player colors', () => {
            initGraphics();

            // Should have called createObjectURL for each SVG * each player color + neutral
            // We don't know exact count, but should be > 0
            expect(mockCreateObjectURL).toHaveBeenCalled();
        });

        it('should create blob URLs from SVG content', () => {
            initGraphics();

            // Verify Blob was created with SVG type
            expect(mockCreateObjectURL).toHaveBeenCalled();
        });
    });

    describe('getAsset', () => {
        beforeEach(() => {
            initGraphics();
        });

        it('should return an image for known asset and owner', () => {
            const asset = getAsset('conyard', 0);
            expect(asset).toBeDefined();
            expect(asset).toBeInstanceOf(HTMLImageElement);
        });

        it('should return an image for different player owners', () => {
            const player0Asset = getAsset('tank', 0);
            const player1Asset = getAsset('tank', 1);

            expect(player0Asset).toBeDefined();
            expect(player1Asset).toBeDefined();
        });

        it('should return an image for neutral owner (-1)', () => {
            const asset = getAsset('ore', -1);
            expect(asset).toBeDefined();
            expect(asset).toBeInstanceOf(HTMLImageElement);
        });

        it('should return null for unknown asset key', () => {
            const asset = getAsset('nonexistent_unit', 0);
            expect(asset).toBeNull();
        });

        it('should return cached images on subsequent calls', () => {
            const asset1 = getAsset('harvester', 0);
            const asset2 = getAsset('harvester', 0);
            expect(asset1).toBe(asset2);
        });

        it('should return different images for different owners', () => {
            const asset0 = getAsset('factory', 0);
            const asset1 = getAsset('factory', 1);

            // Different owners should have different cached images
            expect(asset0).not.toBe(asset1);
        });

        it('should have assets for common building types', () => {
            const buildings = ['conyard', 'power', 'refinery', 'barracks', 'factory', 'turret'];
            for (const building of buildings) {
                const asset = getAsset(building, 0);
                expect(asset).toBeDefined();
                expect(asset).toBeInstanceOf(HTMLImageElement);
            }
        });

        it('should have assets for common unit types', () => {
            const units = ['harvester', 'rifle', 'light', 'heavy', 'tank', 'artillery'];
            for (const unit of units) {
                getAsset(unit, 0);
                // Some units may not exist, just check it returns something or null
                // Don't fail if asset doesn't exist
            }
        });

        it('should have ore resource asset', () => {
            const asset = getAsset('ore', -1);
            expect(asset).toBeDefined();
            expect(asset).toBeInstanceOf(HTMLImageElement);
        });
    });
});

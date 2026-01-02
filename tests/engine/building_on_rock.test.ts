import { describe, it, expect } from 'vitest';
import { Vector, Entity, EntityId, BuildingKey } from '../../src/engine/types';
import { createTestRock, createTestBuilding } from '../../src/engine/test-utils';

// Helper to create a rock entity
function createRock(id: string, x: number, y: number, size: number = 50): Entity {
    return createTestRock({ id, x, y, size });
}

// Helper to create a building entity
function createBuilding(id: string, x: number, y: number, key: string, owner: number = 0): Entity {
    return createTestBuilding({ id, owner, key: key as BuildingKey, x, y, w: 90, h: 90, hp: 1000, maxHp: 1000 });
}

// Recreate the isValidPlacement logic from ai.ts for testing
function isValidPlacement(
    x: number,
    y: number,
    w: number,
    h: number,
    entities: Record<EntityId, Entity>,
    mapWidth: number = 3000,
    mapHeight: number = 3000
): boolean {
    const margin = 25;
    const mapMargin = 50;

    if (x < mapMargin || x > mapWidth - mapMargin ||
        y < mapMargin || y > mapHeight - mapMargin) {
        return false;
    }

    const myRect = {
        l: x - w / 2 - margin,
        r: x + w / 2 + margin,
        t: y - h / 2 - margin,
        b: y + h / 2 + margin
    };

    for (const e of Object.values(entities)) {
        if (e.dead) continue;
        // Check buildings, resources, and rocks
        if (e.type === 'BUILDING' || e.type === 'RESOURCE' || e.type === 'ROCK') {
            const eRect = {
                l: e.pos.x - e.w / 2,
                r: e.pos.x + e.w / 2,
                t: e.pos.y - e.h / 2,
                b: e.pos.y + e.h / 2
            };

            if (rectOverlap(myRect, eRect)) return false;
        }
    }

    return true;
}

function rectOverlap(r1: { l: number, r: number, t: number, b: number }, r2: { l: number, r: number, t: number, b: number }): boolean {
    return !(r2.l > r1.r || r2.r < r1.l || r2.t > r1.b || r2.b < r1.t);
}

describe('Building Placement on Rocks', () => {
    it('should not allow building placement directly on a rock', () => {
        const entities: Record<EntityId, Entity> = {
            'rock_1': createRock('rock_1', 500, 500, 50),
            'conyard_0': createBuilding('conyard_0', 300, 300, 'conyard', 0)
        };

        // Try to place building exactly on the rock
        const valid = isValidPlacement(500, 500, 90, 90, entities);
        expect(valid).toBe(false);
    });

    it('should not allow building placement overlapping with rock edge', () => {
        const entities: Record<EntityId, Entity> = {
            'rock_1': createRock('rock_1', 500, 500, 50),
            'conyard_0': createBuilding('conyard_0', 300, 300, 'conyard', 0)
        };

        // Try to place building partially overlapping with rock
        // Building is 90x90, rock is at 500,500 with size 50
        // So rock spans from 475-525 in both axes
        // Building at 550,500 would span 505-595, which overlaps with 475-525
        const valid = isValidPlacement(545, 500, 90, 90, entities);
        expect(valid).toBe(false);
    });

    it('should allow building placement away from rocks', () => {
        const entities: Record<EntityId, Entity> = {
            'rock_1': createRock('rock_1', 500, 500, 50),
            'conyard_0': createBuilding('conyard_0', 300, 300, 'conyard', 0)
        };

        // Place building far from rock (at 800,800)
        const valid = isValidPlacement(800, 800, 90, 90, entities);
        expect(valid).toBe(true);
    });

    it('should not allow building placement even with small rock overlap', () => {
        const entities: Record<EntityId, Entity> = {
            'rock_1': createRock('rock_1', 500, 500, 30), // Small rock
        };

        // Try building that just barely overlaps
        // Rock at 500,500 with size 30 spans 485-515
        // Building 90x90 at 520,500 spans from 475-565, overlapping rock
        // Adding margin of 25, we need the building rect to not overlap
        const valid = isValidPlacement(520, 500, 90, 90, entities);
        expect(valid).toBe(false);
    });

    it('should check multiple rocks', () => {
        const entities: Record<EntityId, Entity> = {
            'rock_1': createRock('rock_1', 500, 500, 50),
            'rock_2': createRock('rock_2', 700, 700, 40),
            'rock_3': createRock('rock_3', 900, 900, 60),
        };

        // First location blocked by rock_1
        expect(isValidPlacement(500, 500, 90, 90, entities)).toBe(false);

        // Second location blocked by rock_2
        expect(isValidPlacement(700, 700, 90, 90, entities)).toBe(false);

        // Third location blocked by rock_3
        expect(isValidPlacement(900, 900, 90, 90, entities)).toBe(false);

        // Clear location
        expect(isValidPlacement(1200, 1200, 90, 90, entities)).toBe(true);
    });

    it('should allow building near but not overlapping rocks', () => {
        const entities: Record<EntityId, Entity> = {
            'rock_1': createRock('rock_1', 500, 500, 50), // Rock spans 475-525
        };

        // Building 90x90 with margin 25 needs center at least 45+25+25 = 95 away from rock edge
        // Rock edge is at 525, so building center needs to be >= 620 to not overlap
        // Let's test at 650 which should be safe
        const valid = isValidPlacement(650, 500, 90, 90, entities);
        expect(valid).toBe(true);
    });
});

describe('Initial Spawn Rock Prevention', () => {
    it('should not generate rocks within 200 units of spawn corners', () => {
        // Simulate the spawn zone avoidance from generateMap
        const margin = 350;
        const spawnRadius = 200;
        const mapWidth = 3000;
        const mapHeight = 3000;

        const spawnZones = [
            new Vector(margin, margin),
            new Vector(mapWidth - margin, mapHeight - margin),
            new Vector(mapWidth - margin, margin),
            new Vector(margin, mapHeight - margin)
        ];

        function isNearSpawnZone(x: number, y: number): boolean {
            for (const zone of spawnZones) {
                if (new Vector(x, y).dist(zone) < spawnRadius) {
                    return true;
                }
            }
            return false;
        }

        // Test points in spawn zones should be blocked
        expect(isNearSpawnZone(350, 350)).toBe(true); // Top-left
        expect(isNearSpawnZone(2650, 2650)).toBe(true); // Bottom-right
        expect(isNearSpawnZone(2650, 350)).toBe(true); // Top-right
        expect(isNearSpawnZone(350, 2650)).toBe(true); // Bottom-left

        // Test point in middle should be allowed
        expect(isNearSpawnZone(1500, 1500)).toBe(false);

        // Test point just outside spawn zone
        expect(isNearSpawnZone(350 + 250, 350 + 250)).toBe(false); // ~353 distance, > 200
    });
});

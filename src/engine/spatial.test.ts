import { describe, it, expect, beforeEach } from 'vitest';
import { Vector } from './types.js';
import { SpatialGrid, getSpatialGrid, rebuildSpatialGrid, queryEntitiesInRadius, findNearestEnemy, findNearestResource } from './spatial.js';

describe('SpatialGrid', () => {
    const createTestEntity = (id: string, x: number, y: number, owner: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE', key: string = 'test', radius: number = 10) => ({
        id, owner, type, key, dead: false,
        pos: new Vector(x, y), prevPos: new Vector(x, y),
        hp: 100, maxHp: 100, w: 20, h: 20, radius,
        vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0,
        finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
        targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0,
        cargo: 0, resourceTargetId: null, baseTargetId: null
    });

    describe('SpatialGrid class', () => {
        let grid: SpatialGrid;

        beforeEach(() => {
            grid = new SpatialGrid(100); // 100 unit cells for easier testing
        });

        it('should insert and query entities', () => {
            const entity = createTestEntity('e1', 150, 150, 0, 'UNIT');
            grid.insert(entity);

            const results = grid.queryRadiusExact(150, 150, 50);
            expect(results.length).toBe(1);
            expect(results[0].id).toBe('e1');
        });

        it('should not insert dead entities', () => {
            const entity = { ...createTestEntity('e1', 150, 150, 0, 'UNIT'), dead: true };
            grid.insert(entity);

            const results = grid.queryRadius(150, 150, 100);
            expect(results.length).toBe(0);
        });

        it('should query only entities within radius', () => {
            grid.insert(createTestEntity('e1', 100, 100, 0, 'UNIT'));
            grid.insert(createTestEntity('e2', 200, 100, 0, 'UNIT'));
            grid.insert(createTestEntity('e3', 500, 500, 0, 'UNIT')); // Far away

            const results = grid.queryRadiusExact(100, 100, 150);
            expect(results.length).toBe(2);
            expect(results.map(e => e.id).sort()).toEqual(['e1', 'e2']);
        });

        it('should rebuild from entity collection', () => {
            const entities = {
                'e1': createTestEntity('e1', 100, 100, 0, 'UNIT'),
                'e2': createTestEntity('e2', 200, 100, 1, 'UNIT'),
            };

            grid.rebuild(entities);

            const results = grid.queryRadiusExact(100, 100, 200);
            expect(results.length).toBe(2);
        });

        it('should rebuild from entity array', () => {
            const entities = [
                createTestEntity('e1', 100, 100, 0, 'UNIT'),
                createTestEntity('e2', 200, 100, 1, 'UNIT'),
            ];

            grid.rebuild(entities);

            const results = grid.queryRadiusExact(100, 100, 200);
            expect(results.length).toBe(2);
        });

        it('should query enemies in radius', () => {
            grid.insert(createTestEntity('e1', 100, 100, 0, 'UNIT'));
            grid.insert(createTestEntity('e2', 120, 100, 1, 'UNIT')); // Enemy
            grid.insert(createTestEntity('e3', 140, 100, 2, 'UNIT')); // Enemy
            grid.insert(createTestEntity('r1', 160, 100, -1, 'RESOURCE')); // Neutral

            const enemies = grid.queryEnemiesInRadius(100, 100, 200, 0);
            expect(enemies.length).toBe(2);
            expect(enemies.every(e => e.owner !== 0 && e.owner !== -1)).toBe(true);
        });

        it('should query by type', () => {
            grid.insert(createTestEntity('u1', 100, 100, 0, 'UNIT'));
            grid.insert(createTestEntity('b1', 120, 100, 0, 'BUILDING'));
            grid.insert(createTestEntity('r1', 140, 100, -1, 'RESOURCE'));

            const units = grid.queryRadiusByType(100, 100, 200, 'UNIT');
            expect(units.length).toBe(1);
            expect(units[0].type).toBe('UNIT');

            const buildings = grid.queryRadiusByType(100, 100, 200, 'BUILDING');
            expect(buildings.length).toBe(1);
            expect(buildings[0].type).toBe('BUILDING');
        });

        it('should find nearest entity matching predicate', () => {
            grid.insert(createTestEntity('e1', 200, 100, 1, 'UNIT')); // Farther
            grid.insert(createTestEntity('e2', 120, 100, 1, 'UNIT')); // Closer

            const nearest = grid.findNearest(100, 100, 300, e => e.owner === 1);
            expect(nearest).not.toBeNull();
            expect(nearest!.id).toBe('e2');
        });

        it('should find nearest enemy', () => {
            grid.insert(createTestEntity('e1', 100, 100, 0, 'UNIT')); // Own unit
            grid.insert(createTestEntity('e2', 200, 100, 1, 'UNIT')); // Enemy, farther
            grid.insert(createTestEntity('e3', 130, 100, 1, 'UNIT')); // Enemy, closer

            const nearest = grid.findNearestEnemy(100, 100, 300, 0);
            expect(nearest).not.toBeNull();
            expect(nearest!.id).toBe('e3');
        });

        it('should find nearest resource', () => {
            grid.insert(createTestEntity('r1', 300, 100, -1, 'RESOURCE')); // Farther
            grid.insert(createTestEntity('r2', 150, 100, -1, 'RESOURCE')); // Closer

            const nearest = grid.findNearestResource(100, 100, 400);
            expect(nearest).not.toBeNull();
            expect(nearest!.id).toBe('r2');
        });

        it('should return null when no entity found', () => {
            const nearest = grid.findNearestEnemy(100, 100, 300, 0);
            expect(nearest).toBeNull();
        });

        it('should count entities in radius', () => {
            grid.insert(createTestEntity('e1', 100, 100, 0, 'UNIT'));
            grid.insert(createTestEntity('e2', 120, 100, 1, 'UNIT'));
            grid.insert(createTestEntity('e3', 140, 100, 1, 'UNIT'));

            const count = grid.countInRadius(100, 100, 200, e => e.owner === 1);
            expect(count).toBe(2);
        });

        it('should clear the grid', () => {
            grid.insert(createTestEntity('e1', 100, 100, 0, 'UNIT'));
            grid.clear();

            const results = grid.queryRadius(100, 100, 200);
            expect(results.length).toBe(0);
        });

        it('should handle entities spanning multiple cells', () => {
            // Large entity at cell boundary
            const largeEntity = createTestEntity('e1', 100, 100, 0, 'UNIT', 'large', 60);
            grid.insert(largeEntity);

            // Query from a cell next to where the center is
            const results = grid.queryRadiusExact(50, 100, 30);
            expect(results.length).toBe(1);
        });
    });

    describe('Global grid functions', () => {
        beforeEach(() => {
            rebuildSpatialGrid({});
        });

        it('should provide singleton grid', () => {
            const grid1 = getSpatialGrid();
            const grid2 = getSpatialGrid();
            expect(grid1).toBe(grid2);
        });

        it('should query using global functions', () => {
            rebuildSpatialGrid({
                'e1': createTestEntity('e1', 100, 100, 0, 'UNIT'),
                'e2': createTestEntity('e2', 150, 100, 1, 'UNIT'),
            });

            const results = queryEntitiesInRadius(100, 100, 100);
            expect(results.length).toBe(2);
        });

        it('should find nearest enemy using global functions', () => {
            rebuildSpatialGrid({
                'e1': createTestEntity('e1', 100, 100, 0, 'UNIT'),
                'e2': createTestEntity('e2', 150, 100, 1, 'UNIT'),
            });

            const nearest = findNearestEnemy(100, 100, 200, 0);
            expect(nearest).not.toBeNull();
            expect(nearest!.owner).toBe(1);
        });

        it('should find nearest resource using global functions', () => {
            rebuildSpatialGrid({
                'r1': createTestEntity('r1', 200, 100, -1, 'RESOURCE'),
            });

            const nearest = findNearestResource(100, 100, 200);
            expect(nearest).not.toBeNull();
            expect(nearest!.type).toBe('RESOURCE');
        });
    });
});

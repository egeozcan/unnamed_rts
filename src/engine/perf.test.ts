import { describe, it, expect } from 'vitest';
import { Vector } from './types.js';
import { createEntityCache, getEntitiesForOwner, getBuildingsForOwner, getUnitsForOwner, ownerHasBuilding, getEnemiesOf } from './perf.js';

describe('EntityCache', () => {
    const createTestEntity = (id: string, owner: number, type: 'UNIT' | 'BUILDING' | 'RESOURCE', key: string, dead = false) => ({
        id, owner, type, key, dead,
        pos: new Vector(100, 100), prevPos: new Vector(100, 100),
        hp: 100, maxHp: 100, w: 20, h: 20, radius: 10,
        vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0,
        finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
        targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0,
        cargo: 0, resourceTargetId: null, baseTargetId: null
    });

    it('should index all entities', () => {
        const entities = {
            'u1': createTestEntity('u1', 0, 'UNIT', 'tank'),
            'u2': createTestEntity('u2', 1, 'UNIT', 'infantry'),
            'b1': createTestEntity('b1', 0, 'BUILDING', 'conyard'),
            'r1': createTestEntity('r1', -1, 'RESOURCE', 'ore')
        };

        const cache = createEntityCache(entities);

        expect(cache.all.length).toBe(4);
        expect(cache.alive.length).toBe(4);
    });

    it('should filter out dead entities from alive list', () => {
        const entities = {
            'u1': createTestEntity('u1', 0, 'UNIT', 'tank', false),
            'u2': createTestEntity('u2', 0, 'UNIT', 'tank', true) // dead
        };

        const cache = createEntityCache(entities);

        expect(cache.all.length).toBe(2);
        expect(cache.alive.length).toBe(1);
    });

    it('should group entities by owner', () => {
        const entities = {
            'u1': createTestEntity('u1', 0, 'UNIT', 'tank'),
            'u2': createTestEntity('u2', 0, 'UNIT', 'infantry'),
            'u3': createTestEntity('u3', 1, 'UNIT', 'tank')
        };

        const cache = createEntityCache(entities);

        expect(getEntitiesForOwner(cache, 0).length).toBe(2);
        expect(getEntitiesForOwner(cache, 1).length).toBe(1);
        expect(getEntitiesForOwner(cache, 2).length).toBe(0); // non-existent owner
    });

    it('should group buildings by owner', () => {
        const entities = {
            'b1': createTestEntity('b1', 0, 'BUILDING', 'conyard'),
            'b2': createTestEntity('b2', 0, 'BUILDING', 'power'),
            'b3': createTestEntity('b3', 1, 'BUILDING', 'conyard'),
            'u1': createTestEntity('u1', 0, 'UNIT', 'tank')
        };

        const cache = createEntityCache(entities);

        expect(getBuildingsForOwner(cache, 0).length).toBe(2);
        expect(getBuildingsForOwner(cache, 1).length).toBe(1);
    });

    it('should group units by owner', () => {
        const entities = {
            'u1': createTestEntity('u1', 0, 'UNIT', 'tank'),
            'u2': createTestEntity('u2', 0, 'UNIT', 'infantry'),
            'b1': createTestEntity('b1', 0, 'BUILDING', 'conyard')
        };

        const cache = createEntityCache(entities);

        expect(getUnitsForOwner(cache, 0).length).toBe(2);
    });

    it('should track which building keys each owner has', () => {
        const entities = {
            'b1': createTestEntity('b1', 0, 'BUILDING', 'conyard'),
            'b2': createTestEntity('b2', 0, 'BUILDING', 'power'),
            'b3': createTestEntity('b3', 1, 'BUILDING', 'barracks')
        };

        const cache = createEntityCache(entities);

        expect(ownerHasBuilding(cache, 0, 'conyard')).toBe(true);
        expect(ownerHasBuilding(cache, 0, 'power')).toBe(true);
        expect(ownerHasBuilding(cache, 0, 'barracks')).toBe(false);
        expect(ownerHasBuilding(cache, 1, 'barracks')).toBe(true);
        expect(ownerHasBuilding(cache, 2, 'anything')).toBe(false); // non-existent owner
    });

    it('should collect resources', () => {
        const entities = {
            'r1': createTestEntity('r1', -1, 'RESOURCE', 'ore'),
            'r2': createTestEntity('r2', -1, 'RESOURCE', 'ore'),
            'u1': createTestEntity('u1', 0, 'UNIT', 'harvester')
        };

        const cache = createEntityCache(entities);

        expect(cache.resources.length).toBe(2);
    });

    it('should find enemies of a player', () => {
        const entities = {
            'u1': createTestEntity('u1', 0, 'UNIT', 'tank'),
            'u2': createTestEntity('u2', 1, 'UNIT', 'tank'),
            'u3': createTestEntity('u3', 2, 'UNIT', 'tank'),
            'r1': createTestEntity('r1', -1, 'RESOURCE', 'ore') // neutral, not an enemy
        };

        const cache = createEntityCache(entities);

        const enemiesOf0 = getEnemiesOf(cache, 0);
        expect(enemiesOf0.length).toBe(2);
        expect(enemiesOf0.every(e => e.owner !== 0 && e.owner !== -1)).toBe(true);
    });

    it('should handle empty entity list', () => {
        const cache = createEntityCache({});

        expect(cache.all.length).toBe(0);
        expect(cache.alive.length).toBe(0);
        expect(getEntitiesForOwner(cache, 0).length).toBe(0);
    });
});

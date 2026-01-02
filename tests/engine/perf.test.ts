import { describe, it, expect } from 'vitest';
import { createEntityCache, getEntitiesForOwner, getBuildingsForOwner, getUnitsForOwner, ownerHasBuilding, getEnemiesOf } from '../../src/engine/perf.js';
import { createTestCombatUnit, createTestBuilding, createTestResource, createTestHarvester } from '../../src/engine/test-utils.js';

describe('EntityCache', () => {
    it('should index all entities', () => {
        const entities = {
            'u1': createTestCombatUnit({ id: 'u1', owner: 0, key: 'heavy' }),
            'u2': createTestCombatUnit({ id: 'u2', owner: 1, key: 'rifle' }),
            'b1': createTestBuilding({ id: 'b1', owner: 0, key: 'conyard' }),
            'r1': createTestResource({ id: 'r1' })
        };

        const cache = createEntityCache(entities);

        expect(cache.all.length).toBe(4);
        expect(cache.alive.length).toBe(4);
    });

    it('should filter out dead entities from alive list', () => {
        const entities = {
            'u1': createTestCombatUnit({ id: 'u1', owner: 0, key: 'heavy', dead: false }),
            'u2': createTestCombatUnit({ id: 'u2', owner: 0, key: 'heavy', dead: true }) // dead
        };

        const cache = createEntityCache(entities);

        expect(cache.all.length).toBe(2);
        expect(cache.alive.length).toBe(1);
    });

    it('should group entities by owner', () => {
        const entities = {
            'u1': createTestCombatUnit({ id: 'u1', owner: 0, key: 'heavy' }),
            'u2': createTestCombatUnit({ id: 'u2', owner: 0, key: 'rifle' }),
            'u3': createTestCombatUnit({ id: 'u3', owner: 1, key: 'heavy' })
        };

        const cache = createEntityCache(entities);

        expect(getEntitiesForOwner(cache, 0).length).toBe(2);
        expect(getEntitiesForOwner(cache, 1).length).toBe(1);
        expect(getEntitiesForOwner(cache, 2).length).toBe(0); // non-existent owner
    });

    it('should group buildings by owner', () => {
        const entities = {
            'b1': createTestBuilding({ id: 'b1', owner: 0, key: 'conyard' }),
            'b2': createTestBuilding({ id: 'b2', owner: 0, key: 'power' }),
            'b3': createTestBuilding({ id: 'b3', owner: 1, key: 'conyard' }),
            'u1': createTestCombatUnit({ id: 'u1', owner: 0, key: 'heavy' })
        };

        const cache = createEntityCache(entities);

        expect(getBuildingsForOwner(cache, 0).length).toBe(2);
        expect(getBuildingsForOwner(cache, 1).length).toBe(1);
    });

    it('should group units by owner', () => {
        const entities = {
            'u1': createTestCombatUnit({ id: 'u1', owner: 0, key: 'heavy' }),
            'u2': createTestCombatUnit({ id: 'u2', owner: 0, key: 'rifle' }),
            'b1': createTestBuilding({ id: 'b1', owner: 0, key: 'conyard' })
        };

        const cache = createEntityCache(entities);

        expect(getUnitsForOwner(cache, 0).length).toBe(2);
    });

    it('should track which building keys each owner has', () => {
        const entities = {
            'b1': createTestBuilding({ id: 'b1', owner: 0, key: 'conyard' }),
            'b2': createTestBuilding({ id: 'b2', owner: 0, key: 'power' }),
            'b3': createTestBuilding({ id: 'b3', owner: 1, key: 'barracks' })
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
            'r1': createTestResource({ id: 'r1' }),
            'r2': createTestResource({ id: 'r2' }),
            'u1': createTestHarvester({ id: 'u1', owner: 0 })
        };

        const cache = createEntityCache(entities);

        expect(cache.resources.length).toBe(2);
    });

    it('should find enemies of a player', () => {
        const entities = {
            'u1': createTestCombatUnit({ id: 'u1', owner: 0, key: 'heavy' }),
            'u2': createTestCombatUnit({ id: 'u2', owner: 1, key: 'heavy' }),
            'u3': createTestCombatUnit({ id: 'u3', owner: 2, key: 'heavy' }),
            'r1': createTestResource({ id: 'r1' }) // neutral, not an enemy
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

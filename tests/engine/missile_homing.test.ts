
import { describe, it, expect } from 'vitest';
import { GameState, Entity, Projectile, Vector } from '../../src/engine/types';
import { updateProjectile } from '../../src/engine/reducers/game_loop';
import { createProjectile } from '../../src/engine/reducers/helpers';
import { createEntity } from '../../src/engine/reducers/helpers';

describe('Missile Logic', () => {
    it('should create missiles with high speed', () => {
        const state = { tick: 0 } as GameState;
        // SAM Site
        const sam = createEntity(0, 0, 1, 'BUILDING', 'sam_site', state);
        const target = createEntity(100, 100, 2, 'UNIT', 'harrier', state);

        const proj = createProjectile(sam, target);

        expect(proj.weaponType).toBe('missile');
        expect(proj.speed).toBe(28); // Standard bullets are 18, rockets 9
    });

    it('should home in on moving targets', () => {
        const state = { tick: 0 } as GameState;
        const sam = createEntity(0, 0, 1, 'BUILDING', 'sam_site', state);

        // Target initially at (100, 0) - directly East
        const target = createEntity(100, 0, 2, 'UNIT', 'harrier', state);

        // Create projectile moving East
        let proj = createProjectile(sam, target);
        expect(proj.vel.x).toBeGreaterThan(0);
        expect(proj.vel.y).toBe(0); // target is directly east

        // Move target to (0, 100) - directly South
        target.pos = new Vector(0, 100); // Teleport target
        const entities = {
            [sam.id]: sam,
            [target.id]: target
        };

        // Update projectile
        const res = updateProjectile(proj, entities, 1000, 1000);

        // Projectile should now have velocity pointing mainly South
        // Original pos (0,0), vel (28, 0)
        // updateProjectile sees target at (0, 100).
        // Direction to target from (0,0) is (0, 1).
        // New Vel should be (0, 28).

        expect(res.proj.vel.x).toBeCloseTo(0);
        expect(res.proj.vel.y).toBeCloseTo(28);
        expect(res.proj.pos.x).toBeCloseTo(0); // Start (0,0) + Vel (0, 28) = (0, 28)
        expect(res.proj.pos.y).toBeCloseTo(28);
    });

    it('should NOT home for non-missile projectiles', () => {
        const state = { tick: 0 } as GameState;
        // Turret (cannon)
        const turret = createEntity(0, 0, 1, 'BUILDING', 'turret', state);
        const target = createEntity(100, 0, 2, 'UNIT', 'light', state);

        // Create projectile moving East
        let proj = createProjectile(turret, target);
        expect(proj.weaponType).toBe('cannon');
        const initialVel = proj.vel; // Should be (18, 0)

        // Move target to (0, 100) - directly South
        target.pos = new Vector(0, 100);
        const entities = {
            [turret.id]: turret,
            [target.id]: target
        };

        // Update projectile
        const res = updateProjectile(proj, entities, 1000, 1000);

        // Should continue straight East
        expect(res.proj.vel.x).toBe(initialVel.x);
        expect(res.proj.vel.y).toBe(initialVel.y);
        expect(res.proj.pos.x).toBe(initialVel.x); // (0,0) + (18,0)
    });
});

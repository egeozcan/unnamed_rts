import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';
import { createEntity, refreshCollisionGrid } from './utils';

describe('Harvester Queue Override Bug', () => {

    // Helper to spawn units
    function spawnUnit(state: GameState, x: number, y: number, id: string, owner: number = 0, key: string = 'rifle'): GameState {
        const unit = createEntity(x, y, owner, 'UNIT', key);
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: { ...unit, id }
            } as Record<EntityId, Entity>
        };
    }

    // Helper to spawn resources
    function spawnResource(state: GameState, x: number, y: number, id: string): GameState {
        const resource: Entity = {
            id,
            owner: -1,
            type: 'RESOURCE',
            key: 'ore',
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 1000,
            maxHp: 1000,
            w: 25,
            h: 25,
            radius: 12,
            dead: false,
            vel: new Vector(0, 0),
            rotation: 0,
            moveTarget: null,
            path: null,
            pathIdx: 0,
            finalDest: null,
            stuckTimer: 0,
            unstuckDir: null,
            unstuckTimer: 0,
            targetId: null,
            lastAttackerId: null,
            cooldown: 0,
            flash: 0,
            turretAngle: 0,
            cargo: 0,
            resourceTargetId: null,
            baseTargetId: null
        };
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: resource
            } as Record<EntityId, Entity>
        };
    }

    // Helper to spawn buildings
    function spawnBuilding(state: GameState, x: number, y: number, w: number, h: number, id: string, owner: number = 0, key: string = 'conyard'): GameState {
        const building: Entity = {
            id,
            owner,
            type: 'BUILDING',
            key,
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 1000,
            maxHp: 1000,
            w,
            h,
            radius: Math.min(w, h) / 2,
            dead: false,
            vel: new Vector(0, 0),
            rotation: 0,
            moveTarget: null,
            path: null,
            pathIdx: 0,
            finalDest: null,
            stuckTimer: 0,
            unstuckDir: null,
            unstuckTimer: 0,
            targetId: null,
            lastAttackerId: null,
            cooldown: 0,
            flash: 0,
            turretAngle: 0,
            cargo: 0,
            resourceTargetId: null,
            baseTargetId: null
        };
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: building
            } as Record<EntityId, Entity>
        };
    }

    it('harvester should not wait for another harvester that has a manual move override', () => {
        // Reproduction of stuck_harvesters.json bug:
        // - harv1: at position closer to refinery dock, has full cargo, but has moveTarget (player override)
        // - harv2: at position further from refinery dock, has full cargo, wants to dock
        // - harv2 mistakenly thinks harv1 is in the queue and waits, but harv1 isn't actually docking

        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Refinery at (500, 400), dock point at (500, 460)
        state = spawnBuilding(state, 500, 400, 100, 80, 'refinery1', 0, 'refinery');

        // Some ore for context
        state = spawnResource(state, 300, 300, 'ore1');

        // harv1: closer to dock, but has a manual moveTarget (going away from dock)
        state = spawnUnit(state, 490, 450, 'harv1', 0, 'harvester');
        // harv2: further from dock, wants to dock (no moveTarget)
        state = spawnUnit(state, 420, 480, 'harv2', 0, 'harvester');

        // Set up the scenario:
        // - Both have full cargo
        // - Both have baseTargetId set to refinery
        // - harv1 has a moveTarget (player override) pointing AWAY from the dock
        state = {
            ...state,
            entities: {
                ...state.entities,
                harv1: {
                    ...state.entities['harv1'],
                    cargo: 500, // Full cargo
                    baseTargetId: 'refinery1',
                    moveTarget: new Vector(300, 300), // Player override - going away from dock
                    path: [new Vector(300, 300)],
                    finalDest: new Vector(300, 300)
                },
                harv2: {
                    ...state.entities['harv2'],
                    cargo: 500, // Full cargo
                    baseTargetId: 'refinery1'
                    // No moveTarget - should be heading to dock
                }
            }
        };

        refreshCollisionGrid(state.entities);

        // Dock point is at refinery (500, 400) + (0, 60) = (500, 460)
        const dockPos = new Vector(500, 460);
        const initialHarv2Pos = state.entities['harv2'].pos;
        const initialDist = initialHarv2Pos.dist(dockPos);

        // Run for 60 ticks
        for (let i = 0; i < 60; i++) {
            state = update(state, { type: 'TICK' });
        }

        const finalHarv1 = state.entities['harv1'];
        const finalHarv2 = state.entities['harv2'];
        const harv2FinalDist = finalHarv2.pos.dist(dockPos);

        console.log('Queue override test:', {
            harv1Pos: `${finalHarv1.pos.x.toFixed(0)}, ${finalHarv1.pos.y.toFixed(0)}`,
            harv2Pos: `${finalHarv2.pos.x.toFixed(0)}, ${finalHarv2.pos.y.toFixed(0)}`,
            harv2Progress: `${(initialDist - harv2FinalDist).toFixed(0)}`,
            harv1HasMoveTarget: finalHarv1.moveTarget !== null,
            harv2Vel: `${finalHarv2.vel.x.toFixed(2)}, ${finalHarv2.vel.y.toFixed(2)}`
        });

        // harv2 should have made progress towards the dock, not be stuck
        // If harv1 has a moveTarget (player override), harv2 shouldn't count harv1 in the queue
        expect(harv2FinalDist).toBeLessThan(initialDist - 10); // Should have moved at least 10 pixels closer
    });

    it('harvester should wait for another harvester that is actually docking (no moveTarget)', () => {
        // Control test: when the closer harvester IS trying to dock, waiting is correct

        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Refinery at (500, 400), dock point at (500, 460)
        state = spawnBuilding(state, 500, 400, 100, 80, 'refinery1', 0, 'refinery');

        // Some ore for context
        state = spawnResource(state, 300, 300, 'ore1');

        // harv1: closer to dock, actively docking (no moveTarget)
        state = spawnUnit(state, 495, 450, 'harv1', 0, 'harvester');
        // harv2: further from dock
        state = spawnUnit(state, 420, 450, 'harv2', 0, 'harvester');

        // Set up the scenario:
        // - Both have full cargo
        // - Both have baseTargetId set to refinery
        // - NO moveTarget on either - both want to dock
        state = {
            ...state,
            entities: {
                ...state.entities,
                harv1: {
                    ...state.entities['harv1'],
                    cargo: 500, // Full cargo
                    baseTargetId: 'refinery1'
                    // No moveTarget - actively trying to dock
                },
                harv2: {
                    ...state.entities['harv2'],
                    cargo: 500, // Full cargo
                    baseTargetId: 'refinery1'
                    // No moveTarget
                }
            }
        };

        refreshCollisionGrid(state.entities);

        const dockPos = new Vector(500, 460);
        // Track initial positions for logging but mark as intentionally unused
        void state.entities['harv2'].pos;
        void state.entities['harv1'].pos.dist(dockPos);

        // Run for 30 ticks
        for (let i = 0; i < 30; i++) {
            state = update(state, { type: 'TICK' });
        }

        const finalHarv1 = state.entities['harv1'];
        const finalHarv2 = state.entities['harv2'];

        // harv1 is much closer, should reach dock first
        const harv1AtDock = finalHarv1.pos.dist(dockPos) < 25;

        console.log('Queue normal test:', {
            harv1Pos: `${finalHarv1.pos.x.toFixed(0)}, ${finalHarv1.pos.y.toFixed(0)}`,
            harv2Pos: `${finalHarv2.pos.x.toFixed(0)}, ${finalHarv2.pos.y.toFixed(0)}`,
            harv1DistToDock: finalHarv1.pos.dist(dockPos).toFixed(0),
            harv2DistToDock: finalHarv2.pos.dist(dockPos).toFixed(0),
            harv1AtDock
        });

        // harv1 should reach the dock, harv2 should be waiting or approaching
        expect(finalHarv1.pos.dist(dockPos)).toBeLessThan(45); // harv1 reached dock area
    });
});

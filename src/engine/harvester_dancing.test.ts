import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';

describe('Harvester Dancing Bug', () => {
    // Helper to spawn units
    function spawnUnit(state: GameState, x: number, y: number, id: string, owner: number = 0, key: string = 'harvester'): GameState {
        const unit: Entity = {
            id,
            owner,
            type: 'UNIT',
            key,
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 1000,
            maxHp: 1000,
            w: 35,
            h: 35,
            radius: 17,
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
                [id]: unit
            } as Record<EntityId, Entity>
        };
    }

    // Helper to spawn buildings
    function spawnBuilding(state: GameState, x: number, y: number, id: string, owner: number = 0, key: string = 'refinery'): GameState {
        const building: Entity = {
            id,
            owner,
            type: 'BUILDING',
            key,
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 1200,
            maxHp: 1200,
            w: 100,
            h: 80,
            radius: 50,
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

    it('should clear moveTarget and go to base when harvester has full cargo, even if not stuck', () => {
        // This test reproduces the bug where harvesters with full cargo keep dancing
        // around a flee destination instead of going to unload

        // Setup: Base state with a refinery and harvesters that have full cargo
        // but are stuck with a moveTarget from flee behavior
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Spawn a refinery for the harvesters
        state = spawnBuilding(state, 500, 500, 'ref1', 0, 'refinery');

        const fleeDestination = new Vector(400, 400); // The position they fled to

        // Spawn harvesters with full cargo (500) and a moveTarget from fleeing
        state = spawnUnit(state, 405, 395, 'harv1', 0, 'harvester');
        state = spawnUnit(state, 410, 400, 'harv2', 0, 'harvester');

        // Set both harvesters to have full cargo and a flee moveTarget
        // stuckTimer is 0 because they're moving (being pushed around by collisions)
        state = {
            ...state,
            entities: {
                ...state.entities,
                harv1: {
                    ...state.entities['harv1'],
                    cargo: 500, // FULL
                    moveTarget: fleeDestination, // Still has flee destination
                    finalDest: fleeDestination,
                    resourceTargetId: null,
                    baseTargetId: null,
                    stuckTimer: 0, // Not stuck (moving)
                },
                harv2: {
                    ...state.entities['harv2'],
                    cargo: 500, // FULL
                    moveTarget: fleeDestination, // Still has flee destination
                    finalDest: fleeDestination,
                    resourceTargetId: null,
                    baseTargetId: null,
                    stuckTimer: 0,
                }
            }
        };

        // Run a few ticks
        for (let i = 0; i < 5; i++) {
            state = update(state, { type: 'TICK' });
        }

        const h1After = state.entities['harv1'];
        const h2After = state.entities['harv2'];

        // The harvesters should have cleared their flee moveTarget
        // and should now have baseTargetId set (going to refinery)
        expect(h1After.moveTarget).toBeNull();
        expect(h2After.moveTarget).toBeNull();
        expect(h1After.baseTargetId).toBe('ref1');
        expect(h2After.baseTargetId).toBe('ref1');
    });

    it('should reproduce the actual game state dancing bug', () => {
        // Load and test with actual game state data pattern
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Spawn refinery at position from actual game state
        state = spawnBuilding(state, 1211, 1328, 'ref1', 0, 'refinery');

        // Multiple harvesters all pointing at the same flee destination
        const fleeDestination = new Vector(1132.188780741458, 1244.8291239116702);

        const harvesterData = [
            { id: 'harv_p0', x: 1162.2, y: 1252.9, cargo: 500 },
            { id: 'harv1', x: 1136.2, y: 1272.7, cargo: 500 },
            { id: 'harv2', x: 1149.8, y: 1222.7, cargo: 500 },
            { id: 'harv3', x: 1085.3, y: 1232.2, cargo: 500 },
            { id: 'harv4', x: 1133.2, y: 1193.4, cargo: 225 },
        ];

        for (const h of harvesterData) {
            state = spawnUnit(state, h.x, h.y, h.id, 0, 'harvester');
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    [h.id]: {
                        ...state.entities[h.id],
                        cargo: h.cargo,
                        moveTarget: fleeDestination,
                        finalDest: fleeDestination,
                        resourceTargetId: null,
                        baseTargetId: null,
                        stuckTimer: 0,
                    }
                }
            };
        }

        // Run multiple ticks - should resolve dancing within reasonable time
        for (let i = 0; i < 10; i++) {
            state = update(state, { type: 'TICK' });
        }

        // Check that full-cargo harvesters are now heading to base
        const fullCargoHarvesters = Object.values(state.entities).filter(
            (e: Entity) => e.key === 'harvester' && e.owner === 0 && e.cargo >= 500
        );

        // At least some full harvesters should have cleared moveTarget and be heading to base
        const headingToBase = fullCargoHarvesters.filter((h: Entity) =>
            h.moveTarget === null && h.baseTargetId !== null
        );

        console.log('Full cargo harvesters heading to base:', headingToBase.length, 'of', fullCargoHarvesters.length);

        expect(headingToBase.length).toBeGreaterThan(0);
    });

    it('should NOT clear moveTarget if harvester has low cargo (still harvesting)', () => {
        // Setup: Harvester with low cargo fleeing - should keep fleeing
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        state = spawnBuilding(state, 500, 500, 'ref1', 0, 'refinery');

        const fleeDestination = new Vector(400, 400);

        // Harvester with low cargo - should continue fleeing if targeted
        state = spawnUnit(state, 380, 380, 'harv1', 0, 'harvester');
        state = {
            ...state,
            entities: {
                ...state.entities,
                harv1: {
                    ...state.entities['harv1'],
                    cargo: 100, // NOT full
                    moveTarget: fleeDestination,
                    resourceTargetId: null,
                    baseTargetId: null,
                    stuckTimer: 0,
                }
            }
        };

        // Run a few ticks
        for (let i = 0; i < 5; i++) {
            state = update(state, { type: 'TICK' });
        }

        const hAfter = state.entities['harv1'];

        // With low cargo, harvester should NOT be heading to base
        // (It should continue toward its moveTarget or find resources)
        expect(hAfter.baseTargetId).toBeNull();
    });
});

import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from '../../src/engine/reducer';
import { GameState, Vector, Entity, EntityId, HarvesterUnit } from '../../src/engine/types';
import { createTestHarvester, createTestBuilding, addEntityToState } from '../../src/engine/test-utils';

describe('Harvester Dancing Bug', () => {
    // Helper to spawn harvesters using test utils
    function spawnHarvester(state: GameState, x: number, y: number, id: string, owner: number = 0): GameState {
        const harvester = createTestHarvester({ id, owner, x, y });
        return addEntityToState(state, harvester);
    }

    // Helper to spawn buildings using test utils
    function spawnBuilding(state: GameState, x: number, y: number, id: string, owner: number = 0, key: string = 'refinery'): GameState {
        const building = createTestBuilding({ id, owner, key: key as 'refinery', x, y });
        return addEntityToState(state, building);
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
        state = spawnHarvester(state, 405, 395, 'harv1', 0);
        state = spawnHarvester(state, 410, 400, 'harv2', 0);

        // Set both harvesters to have full cargo and a flee moveTarget
        // stuckTimer is 0 because they're moving (being pushed around by collisions)
        const harv1 = state.entities['harv1'] as HarvesterUnit;
        const harv2 = state.entities['harv2'] as HarvesterUnit;

        state = {
            ...state,
            entities: {
                ...state.entities,
                harv1: {
                    ...harv1,
                    harvester: {
                        ...harv1.harvester,
                        cargo: 500, // FULL
                        resourceTargetId: null,
                        baseTargetId: null,
                    },
                    movement: {
                        ...harv1.movement,
                        moveTarget: fleeDestination, // Still has flee destination
                        finalDest: fleeDestination,
                        stuckTimer: 0, // Not stuck (moving)
                    }
                } as HarvesterUnit,
                harv2: {
                    ...harv2,
                    harvester: {
                        ...harv2.harvester,
                        cargo: 500, // FULL
                        resourceTargetId: null,
                        baseTargetId: null,
                    },
                    movement: {
                        ...harv2.movement,
                        moveTarget: fleeDestination, // Still has flee destination
                        finalDest: fleeDestination,
                        stuckTimer: 0,
                    }
                } as HarvesterUnit
            }
        };

        // Run a few ticks
        for (let i = 0; i < 5; i++) {
            state = update(state, { type: 'TICK' });
        }

        const h1After = state.entities['harv1'] as HarvesterUnit;
        const h2After = state.entities['harv2'] as HarvesterUnit;

        // The harvesters should have cleared their flee moveTarget
        // and should now have baseTargetId set (going to refinery)
        expect(h1After.movement.moveTarget).toBeNull();
        expect(h2After.movement.moveTarget).toBeNull();
        expect(h1After.harvester.baseTargetId).toBe('ref1');
        expect(h2After.harvester.baseTargetId).toBe('ref1');
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
            state = spawnHarvester(state, h.x, h.y, h.id, 0);
            const harvester = state.entities[h.id] as HarvesterUnit;
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    [h.id]: {
                        ...harvester,
                        harvester: {
                            ...harvester.harvester,
                            cargo: h.cargo,
                            resourceTargetId: null,
                            baseTargetId: null,
                        },
                        movement: {
                            ...harvester.movement,
                            moveTarget: fleeDestination,
                            finalDest: fleeDestination,
                            stuckTimer: 0,
                        }
                    } as HarvesterUnit
                }
            };
        }

        // Run multiple ticks - should resolve dancing within reasonable time
        for (let i = 0; i < 10; i++) {
            state = update(state, { type: 'TICK' });
        }

        // Check that full-cargo harvesters are now heading to base
        const fullCargoHarvesters = Object.values(state.entities).filter(
            (e: Entity) => e.type === 'UNIT' && e.key === 'harvester' && e.owner === 0 && (e as HarvesterUnit).harvester.cargo >= 500
        );

        // At least some full harvesters should have cleared moveTarget and be heading to base
        const headingToBase = fullCargoHarvesters.filter((h: Entity) => {
            const harvester = h as HarvesterUnit;
            return harvester.movement.moveTarget === null && harvester.harvester.baseTargetId !== null;
        });

        console.log('Full cargo harvesters heading to base:', headingToBase.length, 'of', fullCargoHarvesters.length);

        expect(headingToBase.length).toBeGreaterThan(0);
    });

    it('should NOT clear moveTarget if harvester has low cargo (still harvesting)', () => {
        // Setup: Harvester with low cargo fleeing - should keep fleeing
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        state = spawnBuilding(state, 500, 500, 'ref1', 0, 'refinery');

        const fleeDestination = new Vector(400, 400);

        // Harvester with low cargo - should continue fleeing if targeted
        // When fleeing (manual move), manualMode is set to true
        state = spawnHarvester(state, 380, 380, 'harv1', 0);
        const harvester = state.entities['harv1'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                harv1: {
                    ...harvester,
                    harvester: {
                        ...harvester.harvester,
                        cargo: 100, // NOT full
                        resourceTargetId: null,
                        baseTargetId: null,
                        manualMode: true, // Fleeing/move command sets manual mode
                    },
                    movement: {
                        ...harvester.movement,
                        moveTarget: fleeDestination,
                        stuckTimer: 0,
                    }
                } as HarvesterUnit
            }
        };

        // Run a few ticks
        for (let i = 0; i < 5; i++) {
            state = update(state, { type: 'TICK' });
        }

        const hAfter = state.entities['harv1'] as HarvesterUnit;

        // With low cargo, harvester should NOT be heading to base
        // (It should continue toward its moveTarget or find resources)
        expect(hAfter.harvester.baseTargetId).toBeNull();
    });
});

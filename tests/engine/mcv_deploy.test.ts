
import { INITIAL_STATE, update } from '../../src/engine/reducer.js';
import { GameState, Vector } from '../../src/engine/types.js';
import { describe, beforeEach, test, expect } from 'vitest';

describe('MCV Deployment', () => {
    let state: GameState;
    const playerId = 0;
    const mcvId = 'unit_mcv_1';

    beforeEach(() => {
        state = {
            ...INITIAL_STATE,
            players: {
                0: {
                    id: 0,
                    isAi: false,
                    difficulty: 'medium',
                    color: '#ff0000',
                    credits: 1000,
                    maxPower: 100,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            },
            entities: {
                [mcvId]: {
                    id: mcvId,
                    owner: playerId,
                    type: 'UNIT',
                    key: 'mcv',
                    pos: new Vector(500, 500),
                    prevPos: new Vector(500, 500),
                    hp: 1000,
                    maxHp: 1000,
                    w: 45,
                    h: 45,
                    radius: 22.5,
                    dead: false,
                    movement: {
                        vel: new Vector(0, 0),
                        moveTarget: null,
                        path: null,
                        pathIdx: 0,
                        finalDest: null,
                        stuckTimer: 0,
                        rotation: 0,
                        unstuckDir: null,
                        unstuckTimer: 0
                    },
                    combat: {
                        targetId: null,
                        lastAttackerId: null,
                        cooldown: 0,
                        flash: 0,
                        turretAngle: 0
                    }
                }
            },
            selection: [mcvId],
            config: {
                width: 1000,
                height: 1000,
                resourceDensity: 'medium',
                rockDensity: 'medium'
            },
            running: true
        };
    });

    test('should deploy MCV into Construction Yard when valid', () => {
        const action = { type: 'DEPLOY_MCV', payload: { unitId: mcvId } } as const;
        const newState = update(state, action);

        // MCV should be gone
        expect(newState.entities[mcvId]).toBeUndefined();

        // ConYard should exist
        const conyards = Object.values(newState.entities).filter(e => e.type === 'BUILDING' && e.key === 'conyard');
        expect(conyards.length).toBe(1);

        const conyard = conyards[0];
        expect(conyard.owner).toBe(playerId);
        expect(conyard.pos.x).toBe(500);
        expect(conyard.pos.y).toBe(500);

        // Notification should be success
        expect(newState.notification).toEqual({
            text: "Base Established",
            type: 'info',
            tick: newState.tick
        });
    });

    test('should not deploy MCV if out of bounds', () => {
        // Move MCV to edge
        state = {
            ...state,
            entities: {
                ...state.entities,
                [mcvId]: {
                    ...state.entities[mcvId],
                    pos: new Vector(10, 10) // Too close to edge (ConYard is 90x90, needs 45 radius)
                }
            }
        };

        const action = { type: 'DEPLOY_MCV', payload: { unitId: mcvId } } as const;
        const newState = update(state, action);

        // MCV should still affect
        expect(newState.entities[mcvId]).toBeDefined();

        // No ConYard
        const conyards = Object.values(newState.entities).filter(e => e.type === 'BUILDING' && e.key === 'conyard');
        expect(conyards.length).toBe(0);

        // Notification should be error
        expect(newState.notification).toEqual({
            text: "Cannot deploy: Out of bounds",
            type: 'error',
            tick: newState.tick
        });
    });

    test('should not deploy MCV if blocked by another building', () => {
        // Add a blocker building
        const blockerId = 'blocker_1';
        state = {
            ...state,
            entities: {
                ...state.entities,
                [blockerId]: {
                    id: blockerId,
                    owner: playerId,
                    type: 'BUILDING' as const,
                    key: 'power' as const,
                    pos: new Vector(500, 500), // Exact same spot
                    prevPos: new Vector(500, 500),
                    hp: 500,
                    maxHp: 500,
                    w: 60,
                    h: 60,
                    radius: 30,
                    dead: false,
                    building: { isRepairing: false, repairHpBuffer: 0, sellProgress: 0, isSelling: false, placedTick: 0 }
                }
            }
        };

        const action = { type: 'DEPLOY_MCV', payload: { unitId: mcvId } } as const;
        const newState = update(state, action);

        // MCV should still exist
        expect(newState.entities[mcvId]).toBeDefined();

        // Notification should be blocked
        expect(newState.notification).toEqual({
            text: "Cannot deploy: Blocked",
            type: 'error',
            tick: newState.tick
        });
    });

    test('should not deploy MCV if blocked by resource', () => {
        // Add a resource nearby
        const resId = 'res_1';
        state = {
            ...state,
            entities: {
                ...state.entities,
                [resId]: {
                    id: resId,
                    owner: -1,
                    type: 'RESOURCE' as const,
                    key: 'ore' as const,
                    pos: new Vector(530, 500), // Overlapping
                    prevPos: new Vector(530, 500),
                    hp: 100,
                    maxHp: 100,
                    w: 20,
                    h: 20,
                    radius: 10,
                    dead: false
                }
            }
        };

        const action = { type: 'DEPLOY_MCV', payload: { unitId: mcvId } } as const;
        const newState = update(state, action);

        // MCV should still exist
        expect(newState.entities[mcvId]).toBeDefined();
        // Notification should be blocked
        expect(newState.notification).toEqual({
            text: "Cannot deploy: Blocked",
            type: 'error',
            tick: newState.tick
        });
    });
});

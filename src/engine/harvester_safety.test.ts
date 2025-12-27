import { describe, it, expect, beforeEach } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';
import { createEntity } from './utils';
import { computeAiActions, resetAIState } from './ai';

/**
 * Test for oscillating harvester bug.
 * 
 * The bug: When a harvester is full and returning to refinery, if the AI's
 * handleHarvesterSafety detects a threat near the refinery, it issues a
 * COMMAND_MOVE to make the harvester flee. This sets the harvester's moveTarget.
 * 
 * However, the reducer's docking logic checks `if (harvester.cargo >= capacity && !harvester.moveTarget)`.
 * When moveTarget is set, docking is skipped. But the harvester still has baseTargetId set,
 * and when the flee command wears off, it tries to dock again, triggering another flee.
 * 
 * This creates an oscillation between fleeing and attempting to dock.
 */

describe('Oscillating Harvester Bug', () => {
    beforeEach(() => {
        resetAIState();
    });

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

    // Helper to spawn buildings
    function spawnBuilding(state: GameState, x: number, y: number, w: number, h: number, id: string, owner: number = 0, key: string = 'conyard'): GameState {
        const building: Entity = {
            id,
            owner,
            type: 'BUILDING',
            key,
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: key === 'conyard' ? 3000 : 1200,
            maxHp: key === 'conyard' ? 3000 : 1200,
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

    function createTestState(): GameState {
        let state: GameState = { ...INITIAL_STATE, running: true, mode: 'game' as const, entities: {} as Record<EntityId, Entity> };

        // Create player 1 as AI
        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'medium' as const,
                    color: '#ff4444',
                    credits: 1000,
                    maxPower: 100,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0 },
                        infantry: { current: null, progress: 0 },
                        vehicle: { current: null, progress: 0 },
                        air: { current: null, progress: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        // Add conyard for player 1
        state = spawnBuilding(state, 3650, 3650, 90, 90, 'cy_p1', 1, 'conyard');

        // Add refinery for player 1
        state = spawnBuilding(state, 2800, 3600, 100, 80, 'ref_p1', 1, 'refinery');

        // Create a full harvester heading to refinery
        state = spawnUnit(state, 2720, 3510, 'harv_p1', 1, 'harvester');
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...state.entities['harv_p1'],
                    cargo: 500, // FULL cargo
                    resourceTargetId: null,
                    baseTargetId: 'ref_p1' as EntityId, // Targeting refinery
                    avgVel: new Vector(0, 0)
                }
            } as any
        };

        // Create an enemy unit near the refinery (triggering threat detection)
        // THREAT_DETECTION_RADIUS is 400
        state = spawnUnit(state, 2850, 3650, 'enemy_unit', 2, 'rifle');

        return state;
    }

    it('should not cause harvester to oscillate when threat is near refinery', () => {
        let state = createTestState();

        // Record harvester positions over multiple ticks
        const positions: { x: number; y: number; hasMove: boolean; hasDock: boolean }[] = [];

        // Run several ticks and track harvester state
        for (let i = 0; i < 120; i++) {
            // Run AI for player 1
            const aiActions = computeAiActions(state, 1);

            // Apply AI actions
            for (const action of aiActions) {
                state = update(state, action);
            }

            // Tick the game
            state = update(state, { type: 'TICK' });

            // Record harvester state
            const harv = state.entities['harv_p1' as EntityId];
            if (harv && !harv.dead) {
                positions.push({
                    x: harv.pos.x,
                    y: harv.pos.y,
                    hasMove: harv.moveTarget !== null,
                    hasDock: harv.baseTargetId !== null
                });
            }
        }

        // Detect oscillation: Check if the harvester is rapidly switching between
        // having moveTarget and not having it (indicating conflicting commands)
        let moveTargetSwitches = 0;
        for (let i = 1; i < positions.length; i++) {
            if (positions[i].hasMove !== positions[i - 1].hasMove) {
                moveTargetSwitches++;
            }
        }

        // Also check for position oscillation - if the harvester is moving back and forth
        let directionChanges = 0;
        for (let i = 2; i < positions.length; i++) {
            const prevDir = {
                x: positions[i - 1].x - positions[i - 2].x,
                y: positions[i - 1].y - positions[i - 2].y
            };
            const currDir = {
                x: positions[i].x - positions[i - 1].x,
                y: positions[i].y - positions[i - 1].y
            };

            // Check if directions are roughly opposite (dot product negative)
            const dot = prevDir.x * currDir.x + prevDir.y * currDir.y;
            const prevMag = Math.sqrt(prevDir.x ** 2 + prevDir.y ** 2);
            const currMag = Math.sqrt(currDir.x ** 2 + currDir.y ** 2);

            // Both need significant movement
            if (prevMag > 0.5 && currMag > 0.5) {
                // Normalized dot product shows direction similarity
                const normalizedDot = dot / (prevMag * currMag);
                if (normalizedDot < -0.6) { // Mostly opposite direction
                    directionChanges++;
                }
            }
        }

        expect(directionChanges).toBeLessThan(15);
    });

    it('should clear baseTargetId when fleeing so harvester does not try to dock to unsafe refinery', () => {
        let state = createTestState();

        const aiActions = computeAiActions(state, 1);

        for (const action of aiActions) {
            state = update(state, action);
        }

        const harv = state.entities['harv_p1' as EntityId];

        if (harv && harv.moveTarget !== null) {
            expect(harv.baseTargetId).toBeNull();
        }
    });

    // Helper to spawn resources for partial tests
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

    it('should not execute harvest logic when moveTarget is set', () => {
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Setup: Harvester with a moveTarget (fleeing), and an Ore nearby
        state = spawnUnit(state, 100, 100, 'harv1', 1, 'harvester');
        state = spawnResource(state, 200, 100, 'ore1');

        const moveTarget = new Vector(100, 500); // Fleeing South

        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv1': {
                    ...state.entities['harv1'],
                    moveTarget: moveTarget,
                    resourceTargetId: null // Start clean
                }
            }
        };

        // Tick 1
        state = update(state, { type: 'TICK' });

        const h1 = state.entities['harv1'];

        // Expectation:
        // 1. It should NOT have acquired a resourceTargetId (because it is fleeing)
        // 2. It should have a path to moveTarget, not Ore
        expect(h1.resourceTargetId).toBeNull();
    });
});

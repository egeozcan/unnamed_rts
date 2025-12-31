import { describe, it, expect, beforeEach } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId, HarvesterUnit } from './types';
import { createTestHarvester, createTestCombatUnit, createTestBuilding, createTestResource, addEntityToState } from './test-utils';
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
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        // Add conyard for player 1
        const conyard = createTestBuilding({
            id: 'cy_p1' as EntityId,
            owner: 1,
            key: 'conyard',
            x: 3650,
            y: 3650
        });
        state = addEntityToState(state, conyard);

        // Add refinery for player 1
        const refinery = createTestBuilding({
            id: 'ref_p1' as EntityId,
            owner: 1,
            key: 'refinery',
            x: 2800,
            y: 3600
        });
        state = addEntityToState(state, refinery);

        // Create a full harvester heading to refinery
        const harvester = createTestHarvester({
            id: 'harv_p1' as EntityId,
            owner: 1,
            x: 2720,
            y: 3510,
            cargo: 500, // FULL cargo
            resourceTargetId: null,
            baseTargetId: 'ref_p1' as EntityId // Targeting refinery
        });
        state = addEntityToState(state, harvester);

        // Create an enemy unit near the refinery (triggering threat detection)
        // THREAT_DETECTION_RADIUS is 400
        const enemyUnit = createTestCombatUnit({
            id: 'enemy_unit' as EntityId,
            owner: 2,
            key: 'rifle',
            x: 2850,
            y: 3650
        });
        state = addEntityToState(state, enemyUnit);

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
                const harvUnit = harv as HarvesterUnit;
                positions.push({
                    x: harv.pos.x,
                    y: harv.pos.y,
                    hasMove: harvUnit.movement.moveTarget !== null,
                    hasDock: harvUnit.harvester.baseTargetId !== null
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

        const harv = state.entities['harv_p1' as EntityId] as HarvesterUnit;

        if (harv && harv.movement.moveTarget !== null) {
            expect(harv.harvester.baseTargetId).toBeNull();
        }
    });

    it('should not execute harvest logic when moveTarget is set', () => {
        let state: GameState = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Setup: Harvester with a moveTarget (fleeing), and an Ore nearby
        const harvester = createTestHarvester({
            id: 'harv1' as EntityId,
            owner: 1,
            x: 100,
            y: 100,
            moveTarget: new Vector(100, 500), // Fleeing South
            resourceTargetId: null // Start clean
        });
        state = addEntityToState(state, harvester);

        const ore = createTestResource({
            id: 'ore1' as EntityId,
            x: 200,
            y: 100
        });
        state = addEntityToState(state, ore);

        // Tick 1
        state = update(state, { type: 'TICK' });

        const h1 = state.entities['harv1' as EntityId] as HarvesterUnit;

        // Expectation:
        // 1. It should NOT have acquired a resourceTargetId (because it is fleeing)
        // 2. It should have a path to moveTarget, not Ore
        expect(h1.harvester.resourceTargetId).toBeNull();
    });
});

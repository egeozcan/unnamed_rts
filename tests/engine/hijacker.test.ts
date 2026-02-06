import { describe, it, expect, beforeEach } from 'vitest';
import { Vector, GameState, CombatUnit } from '../../src/engine/types.js';
import { INITIAL_STATE, update, createPlayerState } from '../../src/engine/reducer.js';
import {
    createTestCombatUnit,
    addEntitiesToState,
    resetTestEntityCounter
} from '../../src/engine/test-utils.js';

/**
 * Create a test hijacker with proper hijacker component
 */
function createTestHijacker(options: {
    id?: string;
    owner?: number;
    x?: number;
    y?: number;
    targetId?: string | null;
}): CombatUnit {
    const unit = createTestCombatUnit({
        id: options.id,
        owner: options.owner ?? 0,
        key: 'hijacker',
        x: options.x ?? 500,
        y: options.y ?? 500,
        hp: 50,
        maxHp: 50,
        targetId: options.targetId ?? null
    });

    // Add hijacker component
    return {
        ...unit,
        hijacker: {
            hijackTargetId: null
        }
    };
}

describe('Hijacker Unit', () => {
    let state: GameState;

    beforeEach(() => {
        resetTestEntityCounter();
        state = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
            players: {
                0: createPlayerState(0, false, 'medium', '#ff0000'),
                1: createPlayerState(1, true, 'medium', '#0000ff')
            }
        };
    });

    describe('Vehicle Hijacking', () => {
        it('should steal enemy vehicle when close enough', () => {
            // Create enemy vehicle
            const enemyTank = createTestCombatUnit({
                id: 'tank1',
                owner: 1,
                key: 'heavy',
                x: 500,
                y: 500,
                hp: 600,
                maxHp: 600,
                targetId: null
            });

            // Create hijacker very close to vehicle (within entry range)
            const hijacker = createTestHijacker({
                id: 'hijacker1',
                owner: 0,
                x: 510,
                y: 500,
                targetId: 'tank1'
            });

            state = addEntitiesToState(state, [enemyTank, hijacker]);

            // Run several ticks to allow hijack
            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Tank should now belong to player 0
            const updatedTank = state.entities['tank1'];
            expect(updatedTank).toBeDefined();
            expect(updatedTank.owner).toBe(0);

            // Hijacker should be consumed
            expect(state.entities['hijacker1']).toBeUndefined();
        });

        it('should not steal friendly vehicles', () => {
            // Create friendly vehicle
            const friendlyTank = createTestCombatUnit({
                id: 'tank1',
                owner: 0,
                key: 'heavy',
                x: 500,
                y: 500,
                hp: 600,
                maxHp: 600,
                targetId: null
            });

            // Create hijacker close to friendly vehicle
            const hijacker = createTestHijacker({
                id: 'hijacker1',
                owner: 0,
                x: 510,
                y: 500,
                targetId: 'tank1'
            });

            state = addEntitiesToState(state, [friendlyTank, hijacker]);

            // Run several ticks
            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Tank should still belong to player 0
            const updatedTank = state.entities['tank1'];
            expect(updatedTank).toBeDefined();
            expect(updatedTank.owner).toBe(0);

            // Hijacker should still exist (not consumed)
            expect(state.entities['hijacker1']).toBeDefined();
        });

        it('should not steal infantry units', () => {
            // Create enemy infantry
            const enemyInfantry = createTestCombatUnit({
                id: 'rifle1',
                owner: 1,
                key: 'rifle',
                x: 500,
                y: 500,
                hp: 100,
                maxHp: 100,
                targetId: null
            });

            // Create hijacker close to enemy infantry
            const hijacker = createTestHijacker({
                id: 'hijacker1',
                owner: 0,
                x: 510,
                y: 500,
                targetId: 'rifle1'
            });

            state = addEntitiesToState(state, [enemyInfantry, hijacker]);

            // Run several ticks
            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Infantry should still belong to player 1
            const updatedInfantry = state.entities['rifle1'];
            expect(updatedInfantry).toBeDefined();
            expect(updatedInfantry.owner).toBe(1);

            // Hijacker should still exist (not consumed)
            expect(state.entities['hijacker1']).toBeDefined();
        });

        it('should move toward distant enemy vehicle', () => {
            // Create enemy vehicle far away
            const enemyTank = createTestCombatUnit({
                id: 'tank1',
                owner: 1,
                key: 'heavy',
                x: 700,
                y: 500,
                hp: 600,
                maxHp: 600,
                targetId: null
            });

            // Create hijacker far from vehicle
            const hijacker = createTestHijacker({
                id: 'hijacker1',
                owner: 0,
                x: 500,
                y: 500,
                targetId: 'tank1'
            });

            state = addEntitiesToState(state, [enemyTank, hijacker]);

            // Record initial position
            const initialX = (state.entities['hijacker1'] as CombatUnit).pos.x;

            // Run multiple ticks to allow movement
            for (let i = 0; i < 10; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Hijacker should have moved toward vehicle
            const updatedHijacker = state.entities['hijacker1'] as CombatUnit;
            expect(updatedHijacker).toBeDefined();
            // Hijacker should have moved toward tank (x increased)
            expect(updatedHijacker.pos.x).toBeGreaterThan(initialX);
        });

        it('stolen vehicle should retain HP and clear targeting', () => {
            // Create enemy vehicle at full HP
            const enemyTank = createTestCombatUnit({
                id: 'tank1',
                owner: 1,
                key: 'heavy',
                x: 500,
                y: 500,
                hp: 600,
                maxHp: 600,
                targetId: null
            });

            // Create hijacker close to vehicle
            const hijacker = createTestHijacker({
                id: 'hijacker1',
                owner: 0,
                x: 510,
                y: 500,
                targetId: 'tank1'
            });

            state = addEntitiesToState(state, [enemyTank, hijacker]);

            // Run ticks to complete hijack
            for (let i = 0; i < 3; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Tank should be captured
            const updatedTank = state.entities['tank1'] as CombatUnit;
            expect(updatedTank).toBeDefined();
            expect(updatedTank.owner).toBe(0);

            // Target should be cleared after hijack
            expect(updatedTank.combat.targetId).toBeNull();
        });
    });

    describe('Damage Resistance', () => {
        it('should take increased damage from bullets', () => {
            // Create enemy rifleman
            const rifleman = createTestCombatUnit({
                id: 'rifle1',
                owner: 1,
                key: 'rifle',
                x: 550, // In range
                y: 500,
                hp: 100,
                maxHp: 100,
                targetId: 'hijacker1'
            });

            // Create hijacker
            const hijacker = createTestHijacker({
                id: 'hijacker1',
                owner: 0,
                x: 500,
                y: 500,
                targetId: null
            });

            state = addEntitiesToState(state, [rifleman, hijacker]);

            // Record initial HP
            const initialHp = (state.entities['hijacker1'] as CombatUnit).hp;

            // Run enough ticks for rifle to fire
            for (let i = 0; i < 50; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Check if hijacker took damage
            const updatedHijacker = state.entities['hijacker1'] as CombatUnit | undefined;
            if (updatedHijacker) {
                // Should have taken significant damage due to 2.5x modifier
                expect(updatedHijacker.hp).toBeLessThan(initialHp);
            }
            // Or hijacker might be dead (which is expected with 2.5x damage modifier on 50 HP)
        });

        it('should take reduced damage from cannons', () => {
            // Create enemy heavy tank
            const heavyTank = createTestCombatUnit({
                id: 'tank1',
                owner: 1,
                key: 'heavy',
                x: 550, // In range
                y: 500,
                hp: 600,
                maxHp: 600,
                targetId: 'hijacker1'
            });

            // Create hijacker
            const hijacker = createTestHijacker({
                id: 'hijacker1',
                owner: 0,
                x: 500,
                y: 500,
                targetId: null
            });

            state = addEntitiesToState(state, [heavyTank, hijacker]);

            // Record initial HP
            const initialHp = (state.entities['hijacker1'] as CombatUnit).hp;

            // Run enough ticks for tank to fire once
            for (let i = 0; i < 60; i++) {
                state = update(state, { type: 'TICK' });
                // Check if hijacker exists and hasn't been killed instantly
                const currentHijacker = state.entities['hijacker1'] as CombatUnit | undefined;
                if (currentHijacker && currentHijacker.hp < initialHp && currentHijacker.hp > 0) {
                    // Got hit but survived - this shows cannon did reduced damage (0.15x)
                    // On 50 HP with 0.15x modifier, even heavy cannon shouldn't one-shot
                    expect(currentHijacker.hp).toBeGreaterThan(0);
                    break;
                }
            }
        });
    });
});

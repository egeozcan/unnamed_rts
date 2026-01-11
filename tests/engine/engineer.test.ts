import { describe, it, expect, beforeEach } from 'vitest';
import { Vector, GameState, CombatUnit } from '../../src/engine/types.js';
import { INITIAL_STATE, update, createPlayerState } from '../../src/engine/reducer.js';
import {
    createTestBuilding,
    createTestCombatUnit,
    addEntitiesToState,
    resetTestEntityCounter
} from '../../src/engine/test-utils.js';

/**
 * Create a test engineer with proper engineer component
 */
function createTestEngineer(options: {
    id?: string;
    owner?: number;
    x?: number;
    y?: number;
    targetId?: string | null;
}): CombatUnit {
    const unit = createTestCombatUnit({
        id: options.id,
        owner: options.owner ?? 0,
        key: 'engineer',
        x: options.x ?? 500,
        y: options.y ?? 500,
        hp: 100,
        maxHp: 100,
        targetId: options.targetId ?? null
    });

    // Add engineer component
    return {
        ...unit,
        engineer: {
            captureTargetId: null,
            repairTargetId: null
        }
    };
}

describe('Engineer Unit', () => {
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

    describe('Repair Friendly Buildings', () => {
        it('should repair damaged friendly building when entering', () => {
            // Create damaged friendly building (factory: 100x100)
            const building = createTestBuilding({
                id: 'factory1',
                owner: 0,
                key: 'factory',
                x: 500,
                y: 500,
                hp: 1000,
                maxHp: 2000
            });

            // Create engineer inside building bounds (factory is 100x100, so within ±50 of center)
            // Entry buffer is 30px from edge, so engineer at center should definitely work
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 500,
                y: 500, // At building center
                targetId: 'factory1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            // Run several ticks
            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Building should be fully healed
            const updatedBuilding = state.entities['factory1'];
            expect(updatedBuilding.hp).toBe(updatedBuilding.maxHp);

            // Engineer should be consumed (removed from entities - dead entities are cleaned up)
            expect(state.entities['eng1']).toBeUndefined();
        });

        it('should not enter full-health friendly building', () => {
            // Create full-health friendly building
            const building = createTestBuilding({
                id: 'factory1',
                owner: 0,
                key: 'factory',
                x: 500,
                y: 500,
                hp: 2000,
                maxHp: 2000
            });

            // Create engineer at building center
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 500,
                y: 500,
                targetId: 'factory1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            // Run several ticks
            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Engineer should NOT be consumed (still exists and not dead)
            const updatedEngineer = state.entities['eng1'];
            expect(updatedEngineer).toBeDefined();
            expect(updatedEngineer.dead).toBe(false);
        });

        it('should be able to enter from the left side', () => {
            const building = createTestBuilding({
                id: 'factory1',
                owner: 0,
                key: 'factory',
                x: 500,
                y: 500,
                hp: 1000,
                maxHp: 2000
            });

            // Engineer at left edge of building (factory half-width = 50, buffer = 30)
            // So engineer at x=475 is 25px inside left edge = definitely within bounds
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 475,
                y: 500,
                targetId: 'factory1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            expect(state.entities['factory1'].hp).toBe(2000);
            expect(state.entities['eng1']).toBeUndefined(); // Consumed
        });

        it('should be able to enter from the right side', () => {
            const building = createTestBuilding({
                id: 'factory1',
                owner: 0,
                key: 'factory',
                x: 500,
                y: 500,
                hp: 1000,
                maxHp: 2000
            });

            // Engineer at right edge
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 525,
                y: 500,
                targetId: 'factory1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            expect(state.entities['factory1'].hp).toBe(2000);
            expect(state.entities['eng1']).toBeUndefined();
        });

        it('should be able to enter from the top side', () => {
            const building = createTestBuilding({
                id: 'factory1',
                owner: 0,
                key: 'factory',
                x: 500,
                y: 500,
                hp: 1000,
                maxHp: 2000
            });

            // Engineer at top edge
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 500,
                y: 475,
                targetId: 'factory1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            expect(state.entities['factory1'].hp).toBe(2000);
            expect(state.entities['eng1']).toBeUndefined();
        });

        it('should be able to enter from the bottom side', () => {
            const building = createTestBuilding({
                id: 'factory1',
                owner: 0,
                key: 'factory',
                x: 500,
                y: 500,
                hp: 1000,
                maxHp: 2000
            });

            // Engineer at bottom edge
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 500,
                y: 525,
                targetId: 'factory1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            expect(state.entities['factory1'].hp).toBe(2000);
            expect(state.entities['eng1']).toBeUndefined();
        });

        it('should be able to enter rectangular building from narrow side', () => {
            // Barracks is 60x80 - test entering from the narrow (60px) side
            const building = createTestBuilding({
                id: 'barracks1',
                owner: 0,
                key: 'barracks',
                x: 500,
                y: 500,
                hp: 500,
                maxHp: 1000
            });

            // Engineer at narrow left side (half-width = 30)
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 485, // 15px from center on narrow side
                y: 500,
                targetId: 'barracks1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            expect(state.entities['barracks1'].hp).toBe(1000);
            expect(state.entities['eng1']).toBeUndefined();
        });
    });

    describe('Capture Enemy Buildings', () => {
        it('should capture capturable enemy building', () => {
            // Barracks has capturable: true
            const building = createTestBuilding({
                id: 'barracks1',
                owner: 1, // Enemy
                key: 'barracks',
                x: 500,
                y: 500,
                hp: 1000,
                maxHp: 1000
            });

            // Engineer at building center
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 500,
                y: 500,
                targetId: 'barracks1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Building should change ownership
            expect(state.entities['barracks1'].owner).toBe(0);

            // Engineer should be consumed
            expect(state.entities['eng1']).toBeUndefined();
        });

        it('should NOT capture non-capturable building (turret)', () => {
            // Turret does NOT have capturable: true
            // The key thing is that the turret ownership should NOT change
            // (Note: the turret may kill the engineer, that's separate behavior)
            const building = createTestBuilding({
                id: 'turret1',
                owner: 1,
                key: 'turret',
                x: 500,
                y: 500,
                hp: 500,
                maxHp: 500
            });

            // Engineer at turret - turret is 40x40
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 500,
                y: 500,
                targetId: 'turret1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            // Building should NOT change ownership - this is the key assertion
            expect(state.entities['turret1'].owner).toBe(1);
        });

        it('should be able to capture from any direction', () => {
            const building = createTestBuilding({
                id: 'refinery1',
                owner: 1,
                key: 'refinery', // 100x80, capturable
                x: 500,
                y: 500,
                hp: 1200,
                maxHp: 1200
            });

            // Engineer approaching from corner area
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 520, // Slightly right of center
                y: 520, // Slightly below center
                targetId: 'refinery1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            expect(state.entities['refinery1'].owner).toBe(0);
            expect(state.entities['eng1']).toBeUndefined();
        });
    });

    describe('Entry Distance', () => {
        it('should not enter when too far from building', () => {
            const building = createTestBuilding({
                id: 'factory1',
                owner: 0,
                key: 'factory',
                x: 500,
                y: 500,
                hp: 1000,
                maxHp: 2000
            });

            // Engineer too far (factory edge at 450, buffer is 30, so need to be < 420)
            // Engineer at 400 is 50px from edge, outside buffer
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 400,
                y: 500,
                targetId: 'factory1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            // Single tick - engineer should move toward building, not enter
            state = update(state, { type: 'TICK' });

            // Engineer should still exist (too far to enter)
            expect(state.entities['eng1']).toBeDefined();
            expect(state.entities['eng1'].dead).toBe(false);

            // Building should NOT be healed yet
            expect(state.entities['factory1'].hp).toBe(1000);
        });

        it('should enter when at entry buffer distance', () => {
            const building = createTestBuilding({
                id: 'power1',
                owner: 0,
                key: 'power', // 60x60
                x: 500,
                y: 500,
                hp: 400,
                maxHp: 800
            });

            // Power is 60x60, half-width = 30. Edge at 470.
            // Entry buffer = 30, so entry allowed when dx < 30 + 30 = 60
            // Engineer at 450 -> dx = 50, which is < 60, so should enter
            const engineer = createTestEngineer({
                id: 'eng1',
                owner: 0,
                x: 450,
                y: 500,
                targetId: 'power1'
            });

            state = addEntitiesToState(state, [building, engineer]);

            for (let i = 0; i < 5; i++) {
                state = update(state, { type: 'TICK' });
            }

            expect(state.entities['power1'].hp).toBe(800);
            expect(state.entities['eng1']).toBeUndefined();
        });
    });
});

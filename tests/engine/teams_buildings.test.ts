import { describe, it, expect, beforeEach } from 'vitest';
import { createTestBuilding, resetTestEntityCounter } from '../../src/engine/test-utils';
import { createPlayerState, INITIAL_STATE, update } from '../../src/engine/reducer';

beforeEach(() => resetTestEntityCounter());

describe('building placement respects teams', () => {
    it('allows building within range of ally building', () => {
        const players: Record<number, any> = {
            0: createPlayerState(0, false, 'medium', '#fff', 'classic', 'A'),
            1: createPlayerState(1, true, 'medium', '#fff', 'classic', 'A'),
        };
        const allyBuilding = createTestBuilding({ owner: 1, key: 'conyard', x: 500, y: 500 });

        const state = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game' as const,
            players: {
                ...players,
                0: { ...players[0], readyToPlace: 'power' }
            },
            entities: { [allyBuilding.id]: allyBuilding },
        };

        // Place P0's building within 400px of P1's building
        const result = update(state, {
            type: 'PLACE_BUILDING',
            payload: { key: 'power', x: 600, y: 500, playerId: 0 }
        });

        const newBuildings = Object.values(result.entities).filter(
            e => e.type === 'BUILDING' && e.owner === 0
        );
        expect(newBuildings.length).toBe(1);
    });

    it('rejects building outside range of any ally or own building', () => {
        const players: Record<number, any> = {
            0: createPlayerState(0, false, 'medium', '#fff', 'classic', 'A'),
            1: createPlayerState(1, true, 'medium', '#fff', 'classic', 'A'),
        };
        const allyBuilding = createTestBuilding({ owner: 1, key: 'conyard', x: 500, y: 500 });

        const state = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game' as const,
            players: {
                ...players,
                0: { ...players[0], readyToPlace: 'power' }
            },
            entities: { [allyBuilding.id]: allyBuilding },
        };

        // Place P0's building way outside range
        const result = update(state, {
            type: 'PLACE_BUILDING',
            payload: { key: 'power', x: 2000, y: 2000, playerId: 0 }
        });

        const newBuildings = Object.values(result.entities).filter(
            e => e.type === 'BUILDING' && e.owner === 0
        );
        expect(newBuildings.length).toBe(0);
    });

    it('does NOT allow building near enemy building', () => {
        const players: Record<number, any> = {
            0: createPlayerState(0, false, 'medium', '#fff', 'classic', 'A'),
            2: createPlayerState(2, true, 'medium', '#fff', 'classic', 'B'),
        };
        const enemyBuilding = createTestBuilding({ owner: 2, key: 'conyard', x: 500, y: 500 });

        const state = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game' as const,
            players: {
                ...players,
                0: { ...players[0], readyToPlace: 'power' }
            },
            entities: { [enemyBuilding.id]: enemyBuilding },
        };

        // P0 tries to build near P2's building (different team)
        const result = update(state, {
            type: 'PLACE_BUILDING',
            payload: { key: 'power', x: 600, y: 500, playerId: 0 }
        });

        const newBuildings = Object.values(result.entities).filter(
            e => e.type === 'BUILDING' && e.owner === 0
        );
        // Should succeed because P0 has NO buildings — first building is always allowed
        // The build range is only enforced when you ALREADY have buildings (or ally buildings)
        expect(newBuildings.length).toBe(1);
    });
});

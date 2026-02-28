import { describe, it, expect } from 'vitest';
import { update, INITIAL_STATE } from '../../src/engine/reducer';
import { BuildingKey, GameState } from '../../src/engine/types';
import { isValidPlacement } from '../../src/engine/ai/utils';
import { addEntitiesToState, createTestBuilding, createTestWell } from '../../src/engine/test-utils';

function createState(): GameState {
    return JSON.parse(JSON.stringify(INITIAL_STATE));
}

function createBuilding(id: string, owner: number, key: BuildingKey, x: number, y: number) {
    return createTestBuilding({ id, owner, key, x, y });
}

describe('Building Placement on Wells', () => {
    it('AI placement validator rejects spots that overlap an ore well', () => {
        const conyard = createBuilding('cy_0', 0, 'conyard', 250, 500);
        const well = createTestWell({ id: 'well_0', x: 500, y: 500 });

        let state = createState();
        state = addEntitiesToState(state, [conyard, well]);

        expect(isValidPlacement(500, 500, 90, 90, state, [conyard], 'power')).toBe(false);
    });

    it('reducer rejects PLACE_BUILDING when target overlaps an ore well', () => {
        const conyard = createBuilding('cy_0', 0, 'conyard', 250, 500);
        const well = createTestWell({ id: 'well_0', x: 500, y: 500 });

        let state = createState();
        state = addEntitiesToState(state, [conyard, well]);
        state = {
            ...state,
            placingBuilding: 'power',
            players: {
                ...state.players,
                0: {
                    ...state.players[0],
                    readyToPlace: 'power'
                }
            }
        };

        const nextState = update(state, {
            type: 'PLACE_BUILDING',
            payload: { key: 'power', x: 500, y: 500, playerId: 0 }
        });

        const newPowerBuildings = Object.values(nextState.entities).filter(
            e => e.type === 'BUILDING' && e.owner === 0 && e.key === 'power'
        );

        expect(newPowerBuildings).toHaveLength(0);
        expect(nextState.players[0].readyToPlace).toBe('power');
    });

    it('reducer still allows placement near a well when there is no overlap', () => {
        const conyard = createBuilding('cy_0', 0, 'conyard', 250, 500);
        const well = createTestWell({ id: 'well_0', x: 500, y: 500 });

        let state = createState();
        state = addEntitiesToState(state, [conyard, well]);
        state = {
            ...state,
            placingBuilding: 'power',
            players: {
                ...state.players,
                0: {
                    ...state.players[0],
                    readyToPlace: 'power'
                }
            }
        };

        const nextState = update(state, {
            type: 'PLACE_BUILDING',
            payload: { key: 'power', x: 600, y: 500, playerId: 0 }
        });

        const newPowerBuildings = Object.values(nextState.entities).filter(
            e => e.type === 'BUILDING' && e.owner === 0 && e.key === 'power'
        );

        expect(newPowerBuildings).toHaveLength(1);
        expect(nextState.players[0].readyToPlace).toBeNull();
    });
});

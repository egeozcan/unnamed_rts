import { describe, it, expect, beforeEach } from 'vitest';
import { createTestBuilding, createTestCombatUnit, resetTestEntityCounter } from '../../src/engine/test-utils';
import { createPlayerState, INITIAL_STATE, update } from '../../src/engine/reducer';

beforeEach(() => resetTestEntityCounter());

function makeTeamGameState(teamSetup: Record<number, 'A' | 'B' | null>) {
    const players: Record<number, any> = {};
    for (const [id, team] of Object.entries(teamSetup)) {
        players[Number(id)] = createPlayerState(Number(id), true, 'medium', '#fff', 'classic', team);
    }
    return {
        ...INITIAL_STATE,
        running: true,
        mode: 'demo' as const,
        players,
        entities: {},
        headless: true,
    };
}

describe('team victory conditions', () => {
    it('team wins when only players from that team remain', () => {
        const state = makeTeamGameState({ 0: 'A', 1: 'A', 2: 'B' });
        const p0Building = createTestBuilding({ owner: 0, x: 100, y: 100 });
        const p1Building = createTestBuilding({ owner: 1, x: 300, y: 300 });
        // P2 has no buildings or MCVs = eliminated

        const result = update({
            ...state,
            entities: { [p0Building.id]: p0Building, [p1Building.id]: p1Building },
        }, { type: 'TICK' });

        // Winner should be a player from team A
        expect(result.winner === 0 || result.winner === 1).toBe(true);
        expect(result.running).toBe(false);
    });

    it('game continues when two different teams have alive players', () => {
        const state = makeTeamGameState({ 0: 'A', 1: 'B' });
        const p0Building = createTestBuilding({ owner: 0, x: 100, y: 100 });
        const p1Building = createTestBuilding({ owner: 1, x: 500, y: 500 });

        const result = update({
            ...state,
            entities: { [p0Building.id]: p0Building, [p1Building.id]: p1Building },
        }, { type: 'TICK' });

        expect(result.winner).toBeNull();
        expect(result.running).toBe(true);
    });

    it('FFA works as before — last player standing wins', () => {
        const state = makeTeamGameState({ 0: null, 1: null });
        const p0Building = createTestBuilding({ owner: 0, x: 100, y: 100 });
        // P1 eliminated

        const result = update({
            ...state,
            entities: { [p0Building.id]: p0Building },
        }, { type: 'TICK' });

        expect(result.winner).toBe(0);
        expect(result.running).toBe(false);
    });

    it('FFA does not trigger team victory for null-team players', () => {
        const state = makeTeamGameState({ 0: null, 1: null, 2: null });
        const p0Building = createTestBuilding({ owner: 0, x: 100, y: 100 });
        const p1Building = createTestBuilding({ owner: 1, x: 500, y: 500 });
        // P2 eliminated, but P0 and P1 both alive with null teams

        const result = update({
            ...state,
            entities: { [p0Building.id]: p0Building, [p1Building.id]: p1Building },
        }, { type: 'TICK' });

        // Should NOT declare a winner — null teams don't count as same team
        expect(result.winner).toBeNull();
        expect(result.running).toBe(true);
    });

    it('draw when all players eliminated simultaneously', () => {
        const state = makeTeamGameState({ 0: 'A', 1: 'B' });
        // Both players have no buildings or MCVs

        const result = update({
            ...state,
            entities: {},
        }, { type: 'TICK' });

        expect(result.winner).toBe(-1);
        expect(result.running).toBe(false);
    });
});

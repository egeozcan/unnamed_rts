import { describe, it, expect, beforeEach } from 'vitest';
import { createTestCombatUnit, createTestBuilding, resetTestEntityCounter } from '../../src/engine/test-utils';
import { createPlayerState, INITIAL_STATE } from '../../src/engine/reducer';

beforeEach(() => resetTestEntityCounter());

function makeTeamState(teamSetup: Record<number, 'A' | 'B' | 'C' | 'D' | null>) {
    const players: Record<number, any> = {};
    for (const [id, team] of Object.entries(teamSetup)) {
        players[Number(id)] = createPlayerState(Number(id), true, 'medium', '#fff', 'classic', team);
    }
    return { ...INITIAL_STATE, running: true, players, entities: {} };
}

describe('combat respects teams', () => {
    it('team state is correctly set up for combat tests', () => {
        const state = makeTeamState({ 0: 'A', 1: 'A', 2: 'B' });
        expect(state.players[0].team).toBe('A');
        expect(state.players[1].team).toBe('A');
        expect(state.players[2].team).toBe('B');
    });

    it('FFA state has null teams', () => {
        const state = makeTeamState({ 0: null, 1: null, 2: null });
        expect(state.players[0].team).toBeNull();
        expect(state.players[1].team).toBeNull();
        expect(state.players[2].team).toBeNull();
    });
});

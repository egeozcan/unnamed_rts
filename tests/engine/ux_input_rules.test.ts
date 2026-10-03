import { describe, it, expect, beforeEach } from 'vitest';
import { INITIAL_STATE, update, createPlayerState } from '../../src/engine/reducer';
import { GameState, Entity, EntityId, Vector } from '../../src/engine/types';
import {
    createTestBuilding, createTestCombatUnit, createTestDemoTruck, createTestHarvester, createTestResource, createTestRock, resetTestEntityCounter
} from '../../src/engine/test-utils';
import { pickEntityAt, isHiddenByFog } from '../../src/engine/picking';
import { getPlacementError } from '../../src/engine/reducers/buildings';
import { validateSkirmishConfig } from '../../src/game-utils';

function stateWith(entities: Entity[], teams: Record<number, 'A' | 'B' | null> = {}): GameState {
    const record: Record<EntityId, Entity> = {};
    for (const e of entities) record[e.id] = e;
    const players: GameState['players'] = {};
    for (const pid of [0, 1, 2]) {
        players[pid] = createPlayerState(pid, pid !== 0, 'medium', '#fff', undefined, teams[pid] ?? null);
    }
    return { ...INITIAL_STATE, running: true, mode: 'game', entities: record, players };
}

describe('pickEntityAt', () => {
    beforeEach(() => resetTestEntityCounter());

    it('picks the closest unit, not the first one in entity order', () => {
        const a = createTestCombatUnit({ id: 'a', x: 100, y: 100 });
        const b = createTestCombatUnit({ id: 'b', x: 115, y: 100 });
        const c = createTestCombatUnit({ id: 'c', x: 130, y: 100 });
        const entities = { a, b, c };
        expect(pickEntityAt(entities, 115, 100)?.id).toBe('b');
        expect(pickEntityAt(entities, 131, 100)?.id).toBe('c');
        expect(pickEntityAt(entities, 99, 100)?.id).toBe('a');
    });

    it('prefers a unit standing on a building footprint over the building', () => {
        const bld = createTestBuilding({ id: 'bld', key: 'conyard', x: 300, y: 300 });
        const unit = createTestCombatUnit({ id: 'u', x: 320, y: 320 });
        expect(pickEntityAt({ bld, u: unit }, 322, 320)?.id).toBe('u');
        expect(pickEntityAt({ bld, u: unit }, 270, 270)?.id).toBe('bld');
    });

    it('hits buildings anywhere in their footprint (corners included) and misses empty ground', () => {
        const bld = createTestBuilding({ id: 'bld', key: 'conyard', x: 300, y: 300 });
        expect(pickEntityAt({ bld }, 343, 343)?.id).toBe('bld');
        expect(pickEntityAt({ bld }, 400, 400)).toBeNull();
    });

    it('applies the filter after scoring, so a closer enemy does not hide an own unit', () => {
        const own = createTestCombatUnit({ id: 'own', owner: 0, x: 100, y: 100 });
        const enemy = createTestCombatUnit({ id: 'enemy', owner: 1, x: 108, y: 100 });
        expect(pickEntityAt({ own, enemy }, 107, 100, e => e.owner === 0)?.id).toBe('own');
    });
});

describe('right-click on neutral and allied targets', () => {
    beforeEach(() => resetTestEntityCounter());

    it('moves combat units to a rock instead of shooting it', () => {
        const rock = createTestRock({ id: 'rock', x: 400, y: 400 });
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        const next = update(stateWith([rock, unit]), { type: 'COMMAND_ATTACK', payload: { unitIds: ['u'], targetId: 'rock' } });
        const u = next.entities['u'] as typeof unit;
        expect(u.combat.targetId).toBeNull();
        // Goes to the rock, but stops at its edge rather than its (impassable) centre
        expect(Math.hypot(u.movement.moveTarget!.x - 400, u.movement.moveTarget!.y - 400)).toBeLessThan(80);
        expect(Math.hypot(u.movement.moveTarget!.x - 400, u.movement.moveTarget!.y - 400)).toBeGreaterThan(20);
    });

    it('moves combat units onto ore while harvesters still harvest it', () => {
        const ore = createTestResource({ id: 'ore', x: 400, y: 400 });
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        const harv = createTestHarvester({ id: 'h', owner: 0, x: 120, y: 100 });
        const next = update(stateWith([ore, unit, harv]), { type: 'COMMAND_ATTACK', payload: { unitIds: ['u', 'h'], targetId: 'ore' } });
        expect((next.entities['u'] as typeof unit).combat.targetId).toBeNull();
        expect((next.entities['h'] as typeof harv).harvester.resourceTargetId).toBe('ore');
    });

    it('does not attack an allied unit', () => {
        const ally = createTestCombatUnit({ id: 'ally', owner: 1, x: 400, y: 400 });
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        const next = update(stateWith([ally, unit], { 0: 'A', 1: 'A' }), { type: 'COMMAND_ATTACK', payload: { unitIds: ['u'], targetId: 'ally' } });
        expect((next.entities['u'] as typeof unit).combat.targetId).toBeNull();
    });

    it('moves to the clicked point (in formation) when right-clicking an own building', () => {
        const power = createTestBuilding({ id: 'pp', key: 'power', owner: 0, x: 400, y: 400 });
        const a = createTestCombatUnit({ id: 'a', owner: 0, x: 100, y: 100 });
        const b = createTestCombatUnit({ id: 'b', owner: 0, x: 120, y: 100 });
        const next = update(stateWith([power, a, b]), {
            type: 'COMMAND_ATTACK', payload: { unitIds: ['a', 'b'], targetId: 'pp', x: 428, y: 380 }
        });
        const ta = (next.entities['a'] as typeof a).movement.moveTarget!;
        const tb = (next.entities['b'] as typeof b).movement.moveTarget!;
        // Not the building's centre, and not both on the same spot
        expect(ta.x === 400 && ta.y === 400).toBe(false);
        expect(ta.x === tb.x && ta.y === tb.y).toBe(false);
        expect(Math.hypot(ta.x - 428, ta.y - 380)).toBeLessThan(60);
    });

    it('never sends units into the clicked building\'s footprint', () => {
        const factory = createTestBuilding({ id: 'wf', key: 'factory', owner: 0, x: 400, y: 400 });
        const units = Array.from({ length: 10 }, (_, i) => createTestCombatUnit({ id: `u${i}`, owner: 0, x: 100 + i * 15, y: 100 }));
        const next = update({ ...stateWith([factory, ...units]), selection: units.map(u => u.id) }, {
            type: 'COMMAND_ATTACK', payload: { unitIds: units.map(u => u.id), targetId: 'wf', x: 405, y: 395 }
        });
        for (const u of units) {
            const t = (next.entities[u.id] as typeof u).movement.moveTarget!;
            const inside = Math.abs(t.x - 400) < factory.w / 2 + u.radius && Math.abs(t.y - 400) < factory.h / 2 + u.radius;
            expect(inside).toBe(false);
        }
        expect(next.commandIndicator?.type).toBe('move');

        // ...and no two units share a spot
        const slots = units.map(u => (next.entities[u.id] as typeof u).movement.moveTarget!);
        for (let i = 0; i < slots.length; i++) {
            for (let j = i + 1; j < slots.length; j++) {
                expect(slots[i].dist(slots[j])).toBeGreaterThan(5);
            }
        }
    });

    it('a move order recalls an armed demo truck', () => {
        const enemy = createTestBuilding({ id: 'enemy', key: 'power', owner: 1, x: 900, y: 900 });
        const truck = createTestDemoTruck({ id: 't', owner: 0, x: 100, y: 100, detonationTargetId: 'enemy' });
        const next = update(stateWith([enemy, truck]), { type: 'COMMAND_MOVE', payload: { unitIds: ['t'], x: 300, y: 300 } });
        expect((next.entities['t'] as typeof truck).demoTruck.detonationTargetId).toBeNull();
    });

    it('demo trucks do not detonate on allies', () => {
        const ally = createTestBuilding({ id: 'ally', key: 'power', owner: 1, x: 400, y: 400 });
        const truck = createTestDemoTruck({ id: 't', owner: 0, x: 100, y: 100 });
        const state = stateWith([ally, truck], { 0: 'A', 1: 'A' });
        const next = update(state, { type: 'COMMAND_ATTACK', payload: { unitIds: ['t'], targetId: 'ally' } });
        expect((next.entities['t'] as typeof truck).demoTruck.detonationTargetId ?? null).toBeNull();
    });

    it('still attacks enemies', () => {
        const enemy = createTestCombatUnit({ id: 'enemy', owner: 1, x: 400, y: 400 });
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        const next = update(stateWith([enemy, unit]), { type: 'COMMAND_ATTACK', payload: { unitIds: ['u'], targetId: 'enemy' } });
        expect((next.entities['u'] as typeof unit).combat.targetId).toBe('enemy');
    });
});

describe('getPlacementError (shared by the placement ghost and the reducer)', () => {
    beforeEach(() => resetTestEntityCounter());

    const conyard = () => createTestBuilding({ id: 'cy', key: 'conyard', owner: 0, x: 350, y: 350 });

    it('rejects spots overlapping a building and accepts adjacent free ground', () => {
        const state = stateWith([conyard()]);
        // Power plant (60x60) touching the conyard's corner
        expect(getPlacementError(state, 'power', 420, 420, 0)).not.toBeNull();
        // Clear of the conyard
        expect(getPlacementError(state, 'power', 430, 350, 0)).toBeNull();
    });

    it('ignores units (they move out of the way) but not rocks', () => {
        const unit = createTestCombatUnit({ owner: 0, x: 500, y: 350 });
        const rock = createTestRock({ x: 350, y: 500, size: 40 });
        const state = stateWith([conyard(), unit, rock]);
        expect(getPlacementError(state, 'power', 500, 350, 0)).toBeNull();
        expect(getPlacementError(state, 'power', 350, 500, 0)).toMatch(/blocked/);
    });

    it('enforces build range; defenses do not extend it but allied buildings do', () => {
        const turret = createTestBuilding({ id: 't', key: 'turret', owner: 0, x: 700, y: 350 });
        const state = stateWith([conyard(), turret]);
        expect(getPlacementError(state, 'power', 1000, 350, 0)).toMatch(/too far/);

        const allyBase = createTestBuilding({ id: 'ally', key: 'conyard', owner: 1, x: 1100, y: 350 });
        const teamState = stateWith([conyard(), allyBase], { 0: 'A', 1: 'A' });
        expect(getPlacementError(teamState, 'power', 1000, 350, 0)).toBeNull();
    });

    it('PLACE_BUILDING reports the reason to the human player instead of failing silently', () => {
        let state = stateWith([conyard()]);
        state = { ...state, players: { ...state.players, 0: { ...state.players[0], readyToPlace: 'power' } } };
        const next = update(state, { type: 'PLACE_BUILDING', payload: { key: 'power', x: 420, y: 420, playerId: 0 } });
        expect(next.players[0].readyToPlace).toBe('power');
        expect(next.notification?.type).toBe('error');
    });
});

describe('isHiddenByFog', () => {
    it('hides other players\' entities on unexplored tiles only', () => {
        const enemy = createTestCombatUnit({ id: 'e', owner: 1, x: 100, y: 100 });
        const own = createTestCombatUnit({ id: 'o', owner: 0, x: 100, y: 100 });
        const fog = new Uint8Array(Math.ceil(3000 / 40) * Math.ceil(3000 / 40));
        const state = { fogOfWar: { 0: fog }, config: { width: 3000 } };
        expect(isHiddenByFog(state, enemy, 0)).toBe(true);
        expect(isHiddenByFog(state, own, 0)).toBe(false);
        expect(isHiddenByFog(state, enemy, null)).toBe(false);
        fog[Math.floor(100 / 40) * 75 + Math.floor(100 / 40)] = 1;
        expect(isHiddenByFog(state, enemy, 0)).toBe(false);
    });
});

describe('validateSkirmishConfig', () => {
    const player = (slot: number, team: 'A' | 'B' | null) => ({ slot, type: 'medium' as const, color: '#fff', team });

    it('needs two players', () => {
        expect(validateSkirmishConfig({ players: [player(0, null)] })).not.toBeNull();
    });

    it('rejects a setup where everyone shares one team', () => {
        expect(validateSkirmishConfig({ players: [player(0, 'A'), player(1, 'A')] })).toMatch(/same team/);
    });

    it('accepts FFA, team-vs-team and team-vs-solo setups', () => {
        expect(validateSkirmishConfig({ players: [player(0, null), player(1, null)] })).toBeNull();
        expect(validateSkirmishConfig({ players: [player(0, 'A'), player(1, 'B')] })).toBeNull();
        expect(validateSkirmishConfig({ players: [player(0, 'A'), player(1, 'A'), player(2, null)] })).toBeNull();
    });
});

// Keep Vector imported for builders that rely on it at runtime
void Vector;

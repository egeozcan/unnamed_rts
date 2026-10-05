import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { INITIAL_STATE, update, createPlayerState } from '../../src/engine/reducer';
import { type GameState, type Entity, type EntityId, Vector } from '../../src/engine/types';
import {
    createTestBuilding, createTestCombatUnit, createTestDemoTruck, createTestHarvester, createTestResource, createTestRock, createTestWell, resetTestEntityCounter
} from '../../src/engine/test-utils';
import { pickEntityAt, isHiddenByFog, setPickLift } from '../../src/engine/picking';
import { getPlacementError } from '../../src/engine/reducers/buildings';
import { validateSkirmishConfig } from '../../src/game-utils';
import { isMoveHopeless } from '../../src/engine/reducers/movement';

// The engine uses Math.random (spawn jitter, stuck sidestep, entity ids); a seeded PRNG keeps the sims reproducible.
function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

beforeEach(() => {
    vi.spyOn(Math, 'random').mockImplementation(mulberry32(Number(process.env.SEED ?? 12345)));
});

afterEach(() => {
    vi.restoreAllMocks();
});

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

    it('in the 3D view, hits the raised top of a tall model but not empty ground below it', () => {
        const tank = createTestCombatUnit({ id: 't', x: 100, y: 100 });
        const bld = createTestBuilding({ id: 'bld', key: 'conyard', x: 300, y: 300 });
        expect(pickEntityAt({ t: tank }, 100, 70)).toBeNull();
        setPickLift(() => 30);
        try {
            expect(pickEntityAt({ t: tank }, 100, 70)?.id).toBe('t');
            expect(pickEntityAt({ bld }, 300, 300 - bld.h / 2 - 25)?.id).toBe('bld');
            expect(pickEntityAt({ t: tank }, 100, 100 + tank.radius + 10)).toBeNull();
        } finally {
            setPickLift(null);
        }
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

// Both sides need a building, or the game is already over and ticks do nothing
const bases = () => [
    createTestBuilding({ id: 'cy0', key: 'conyard', owner: 0, x: 1400, y: 1400 }),
    createTestBuilding({ id: 'cy1', key: 'conyard', owner: 1, x: 1800, y: 1800 })
];

describe('player orders', () => {
    beforeEach(() => resetTestEntityCounter());

    it('a full harvester follows a human player\'s move order all the way', () => {
        const harv = createTestHarvester({ id: 'h', owner: 0, x: 100, y: 100, cargo: 500 });
        let state = update(stateWith([...bases(), harv]), { type: 'COMMAND_MOVE', payload: { unitIds: ['h'], x: 700, y: 100 } });
        for (let i = 0; i < 600; i++) state = update(state, { type: 'TICK' });
        const h = state.entities['h'] as typeof harv;
        expect(h.pos.x).toBeGreaterThan(650);
        expect(h.harvester.cargo).toBe(500);
    });

    it('an AI flee order on a full harvester is still dropped so it can unload', () => {
        const harv = createTestHarvester({ id: 'h', owner: 1, x: 100, y: 100, cargo: 500 });
        let state = update(stateWith([...bases(), harv]), { type: 'COMMAND_MOVE', payload: { unitIds: ['h'], x: 700, y: 100 } });
        state = update(state, { type: 'TICK' });
        expect((state.entities['h'] as typeof harv).movement.moveTarget).toBeNull();
    });

    it('a short move order doesn\'t resume an interrupted earlier trip', () => {
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        let state = stateWith([...bases(), { ...unit, movement: { ...unit.movement, finalDest: new Vector(1000, 1000) } }]);
        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: ['u'], x: 150, y: 100 } });
        for (let i = 0; i < 400; i++) state = update(state, { type: 'TICK' });
        const u = state.entities['u'] as typeof unit;
        expect(u.movement.moveTarget).toBeNull();
        expect(Math.hypot(u.pos.x - 150, u.pos.y - 100)).toBeLessThan(20);
    });

    it('a unit gives up on a nearby spot it can\'t get any closer to', () => {
        const pp = createTestBuilding({ id: 'pp', key: 'power', owner: 0, x: 400, y: 400 });
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 400, y: 340 });
        // Target inside the building: unreachable
        let state = stateWith([...bases(), pp, unit]);
        state = {
            ...state,
            entities: { ...state.entities, u: { ...unit, movement: { ...unit.movement, moveTarget: new Vector(400, 400), finalDest: new Vector(400, 400) } } }
        };
        for (let i = 0; i < 900; i++) state = update(state, { type: 'TICK' });
        expect((state.entities['u'] as typeof unit).movement.moveTarget).toBeNull();
    });
});

describe('stop and command feedback', () => {
    beforeEach(() => resetTestEntityCounter());

    it('Stop clears move and attack orders', () => {
        const enemy = createTestCombatUnit({ id: 'e', owner: 1, x: 600, y: 600 });
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        let state = update(stateWith([...bases(), enemy, unit]), { type: 'COMMAND_ATTACK', payload: { unitIds: ['u'], targetId: 'e' } });
        expect((state.entities['u'] as typeof unit).combat.targetId).toBe('e');
        state = update(state, { type: 'COMMAND_STOP', payload: { unitIds: ['u'] } });
        const u = state.entities['u'] as typeof unit;
        expect(u.combat.targetId).toBeNull();
        expect(u.movement.moveTarget).toBeNull();
    });

    it('a harvester-only right-click on an enemy shows a move, not an attack', () => {
        const enemy = createTestCombatUnit({ id: 'e', owner: 1, x: 600, y: 600 });
        const harv = createTestHarvester({ id: 'h', owner: 0, x: 100, y: 100 });
        const state = update({ ...stateWith([...bases(), enemy, harv]), selection: ['h'] }, {
            type: 'COMMAND_ATTACK', payload: { unitIds: ['h'], targetId: 'e', x: 600, y: 600 }
        });
        expect(state.commandIndicator?.type).toBe('move');
    });

    it('a combat unit right-clicking an enemy shows an attack on the target', () => {
        const enemy = createTestCombatUnit({ id: 'e', owner: 1, x: 600, y: 600 });
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        const state = update({ ...stateWith([...bases(), enemy, unit]), selection: ['u'] }, {
            type: 'COMMAND_ATTACK', payload: { unitIds: ['u'], targetId: 'e', x: 600, y: 600 }
        });
        expect(state.commandIndicator?.type).toBe('attack');
        expect(state.commandIndicator?.pos.x).toBe(600);
    });

    it('a harvester sent to ore gets a green marker on the ore', () => {
        const ore = createTestResource({ id: 'ore', x: 400, y: 400 });
        const harv = createTestHarvester({ id: 'h', owner: 0, x: 100, y: 100 });
        const state = update({ ...stateWith([...bases(), ore, harv]), selection: ['h'] }, {
            type: 'COMMAND_ATTACK', payload: { unitIds: ['h'], targetId: 'ore', x: 400, y: 400 }
        });
        expect(state.commandIndicator?.type).toBe('move');
    });

    it('re-clicking an enemy the units already attack still shows the attack marker', () => {
        const enemy = createTestCombatUnit({ id: 'e', owner: 1, x: 600, y: 600 });
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        let state = update({ ...stateWith([...bases(), enemy, unit]), selection: ['u'] }, {
            type: 'COMMAND_ATTACK', payload: { unitIds: ['u'], targetId: 'e' }
        });
        state = update({ ...state, commandIndicator: null }, { type: 'COMMAND_ATTACK', payload: { unitIds: ['u'], targetId: 'e' } });
        expect(state.commandIndicator?.type).toBe('attack');
    });

    it('attack-move shows its own indicator, and a new selection drops attack-move mode', () => {
        const unit = createTestCombatUnit({ id: 'u', owner: 0, x: 100, y: 100 });
        let state = update({ ...stateWith([...bases(), unit]), selection: ['u'] }, { type: 'COMMAND_ATTACK_MOVE', payload: { unitIds: ['u'], x: 500, y: 500 } });
        expect(state.commandIndicator?.type).toBe('attack_move');
        state = update(state, { type: 'TOGGLE_ATTACK_MOVE_MODE' });
        expect(state.attackMoveMode).toBe(true);
        state = update(state, { type: 'SELECT_UNITS', payload: [] });
        expect(state.attackMoveMode).toBe(false);
    });
});

describe('isMoveHopeless', () => {
    const unitWith = (dist: number, ticks: number) => {
        const u = createTestCombatUnit({ id: 'u', owner: 0, x: 0, y: 0 });
        return { ...u, movement: { ...u.movement, lastDistToMoveTarget: dist, moveTargetNoProgressTicks: ticks } };
    };
    it('gives up near the spot after ~4 s without progress, anywhere after ~15 s', () => {
        expect(isMoveHopeless(unitWith(50, 400))).toBe(false);
        expect(isMoveHopeless(unitWith(50, 500))).toBe(true);
        expect(isMoveHopeless(unitWith(250, 500))).toBe(false);
        expect(isMoveHopeless(unitWith(250, 2000))).toBe(true);
    });
});

describe('produced units without a rally point', () => {
    it('find spots round the side when a building blocks the doorway', () => {
        const barracks = createTestBuilding({ id: 'brk', key: 'barracks', owner: 0, x: 400, y: 400 });
        // A War Factory right below the Barracks door
        const factory = createTestBuilding({ id: 'wf', key: 'factory', owner: 0, x: 400, y: 400 + barracks.h / 2 + 60 });
        const power = createTestBuilding({ id: 'pp', key: 'power', owner: 0, x: 250, y: 300 });
        let state = stateWith([...bases(), barracks, factory, power]);
        state = { ...state, players: { ...state.players, 0: { ...state.players[0], credits: 5000 } } };
        for (let n = 0; n < 3; n++) {
            state = update(state, { type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId: 0 } });
        }
        for (let i = 0; i < 6000 && Object.values(state.entities).filter(e => e.type === 'UNIT').length < 3; i++) {
            state = update(state, { type: 'TICK' });
        }
        expect(Object.values(state.entities).filter(e => e.type === 'UNIT').length).toBe(3);
        for (let i = 0; i < 1500; i++) state = update(state, { type: 'TICK' });
        const units = Object.values(state.entities).filter(e => e.type === 'UNIT');
        for (let i = 0; i < units.length; i++) {
            for (let j = i + 1; j < units.length; j++) {
                const a = units[i].pos, b = units[j].pos;
                expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(units[i].radius * 2 - 3);
            }
        }
    });

    it('drive out to separate spots in front of the factory instead of stacking', () => {
        const barracks = createTestBuilding({ id: 'brk', key: 'barracks', owner: 0, x: 400, y: 400 });
        const power = createTestBuilding({ id: 'pp', key: 'power', owner: 0, x: 250, y: 300 });
        let state = stateWith([...bases(), barracks, power]);
        state = { ...state, players: { ...state.players, 0: { ...state.players[0], credits: 5000 } } };
        for (let n = 0; n < 4; n++) {
            state = update(state, { type: 'START_BUILD', payload: { category: 'infantry', key: 'rifle', playerId: 0 } });
        }
        for (let i = 0; i < 6000 && Object.values(state.entities).filter(e => e.type === 'UNIT').length < 4; i++) {
            state = update(state, { type: 'TICK' });
        }
        const units = Object.values(state.entities).filter(e => e.type === 'UNIT');
        expect(units.length).toBe(4);
        for (let i = 0; i < 1500; i++) state = update(state, { type: 'TICK' });
        const finalUnits = Object.values(state.entities).filter(e => e.type === 'UNIT');
        for (let i = 0; i < finalUnits.length; i++) {
            // Out of the doorway, below the barracks
            expect(finalUnits[i].pos.y).toBeGreaterThan(400 + barracks.h / 2);
            for (let j = i + 1; j < finalUnits.length; j++) {
                const a = finalUnits[i].pos, b = finalUnits[j].pos;
                expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(finalUnits[i].radius * 2 - 3);
            }
        }
    });
});

// Keep Vector imported for builders that rely on it at runtime
void Vector;

describe('induction rig deploy on arrival', () => {
    beforeEach(() => resetTestEntityCounter());

    it('drives to a far well and deploys there, with the pending deploy kept in game state', () => {
        const rig = createTestCombatUnit({ id: 'rig', key: 'induction_rig', owner: 0, x: 200, y: 200 });
        const well = createTestWell({ id: 'well', x: 600, y: 200 });
        let state = update(stateWith([...bases(), rig, well]), { type: 'COMMAND_DEPLOY_RIG', payload: { unitId: 'rig', wellId: 'well' } });
        expect(state.entities['rig']).toBeDefined();
        // The pending deploy survives a JSON round trip (save/load) because it lives on the unit
        expect(JSON.parse(JSON.stringify(state.entities['rig'])).movement.deployWellId).toBe('well');
        for (let i = 0; i < 1500 && state.entities['rig']; i++) state = update(state, { type: 'TICK' });
        expect(state.entities['rig']).toBeUndefined();
        expect(Object.values(state.entities).some(e => e.key === 'induction_rig_deployed' && e.owner === 0)).toBe(true);
    });

    it('forgets the deploy when given another order', () => {
        const rig = createTestCombatUnit({ id: 'rig', key: 'induction_rig', owner: 0, x: 200, y: 200 });
        const well = createTestWell({ id: 'well', x: 600, y: 200 });
        let state = update(stateWith([...bases(), rig, well]), { type: 'COMMAND_DEPLOY_RIG', payload: { unitId: 'rig', wellId: 'well' } });
        state = update(state, { type: 'COMMAND_MOVE', payload: { unitIds: ['rig'], x: 200, y: 600 } });
        state = update(state, { type: 'TICK' });
        const r = state.entities['rig'];
        expect(r.type === 'UNIT' && r.movement.deployWellId).toBeFalsy();
    });
});

describe('inspecting non-own entities', () => {
    beforeEach(() => resetTestEntityCounter());

    it('keeps the inspected enemy out of the commandable selection', () => {
        const own = createTestCombatUnit({ id: 'own', owner: 0, x: 100, y: 100 });
        const enemy = createTestCombatUnit({ id: 'enemy', owner: 1, x: 400, y: 100 });
        let state = update(stateWith([own, enemy]), { type: 'SELECT_UNITS', payload: ['own'] });
        state = update(state, { type: 'INSPECT_ENTITY', payload: 'enemy' });
        expect(state.selection).toEqual([]);
        expect(state.inspectedId).toBe('enemy');
        state = update(state, { type: 'SELECT_UNITS', payload: ['own'] });
        expect(state.inspectedId).toBeNull();
    });
});

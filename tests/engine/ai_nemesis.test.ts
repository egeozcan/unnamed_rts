import { beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer.js';
import { getAIImplementation, getAIImplementationOptions } from '../../src/engine/ai/registry.js';
import { computeNemesisAiActions, sanitizeNemesisActions } from '../../src/engine/ai/implementations/nemesis/index.js';
import { getNemesisRuntimeState } from '../../src/engine/ai/implementations/nemesis/state.js';
import { Action, BuildingKey, Entity, EntityId, GameState, UnitKey } from '../../src/engine/types.js';
import { createTestBuilding, createTestCombatUnit, createTestHarvester } from '../../src/engine/test-utils.js';
import { RULES } from '../../src/data/schemas/index.js';

const NEMESIS_ID = 'nemesis';
const ME = 1;
const ENEMY = 0;

function building(id: string, owner: number, key: BuildingKey, x: number, y: number): Entity {
    return createTestBuilding({ id, owner, key, x, y });
}

function unit(id: string, owner: number, key: UnitKey, x: number, y: number, extra: { cooldown?: number; hp?: number } = {}): Entity {
    if (key === 'harvester') return createTestHarvester({ id, owner, x, y });
    return createTestCombatUnit({
        id,
        owner,
        key: key as Exclude<UnitKey, 'harvester' | 'harrier' | 'demo_truck'>,
        x,
        y,
        ...extra
    });
}

function createState(entities: Entity[], tick: number, credits: number, playerPatch: Record<string, unknown> = {}): GameState {
    const byId: Record<EntityId, Entity> = {};
    for (const e of entities) byId[e.id] = e;
    return {
        ...INITIAL_STATE,
        running: true,
        mode: 'demo',
        tick,
        entities: byId,
        config: { ...INITIAL_STATE.config, width: 3000, height: 3000 },
        players: {
            [ENEMY]: createPlayerState(ENEMY, true, 'hard', '#4488ff', 'classic'),
            [ME]: { ...createPlayerState(ME, true, 'hard', '#ff4444', NEMESIS_ID), credits, ...playerPatch }
        }
    } as GameState;
}

/** A mid-game base that has finished the scripted opening. */
function airBase(): Entity[] {
    return [
        building('cy', ME, 'conyard', 2400, 2400),
        building('pw1', ME, 'power', 2250, 2400),
        building('pw2', ME, 'power', 2250, 2250),
        building('pw3', ME, 'power', 2400, 2250),
        building('ref1', ME, 'refinery', 2550, 2400),
        building('ref2', ME, 'refinery', 2550, 2250),
        building('ref3', ME, 'refinery', 2550, 2550),
        building('bar', ME, 'barracks', 2400, 2550),
        building('fac', ME, 'factory', 2250, 2550),
        building('tech', ME, 'tech', 2700, 2400),
        building('afc', ME, 'airforce_command', 2700, 2550),
        building('ecy', ENEMY, 'conyard', 400, 400)
    ];
}

function startBuilds(actions: Action[], category: string): string[] {
    return actions
        .filter((a): a is Extract<Action, { type: 'START_BUILD' }> => a.type === 'START_BUILD' && a.payload.category === category)
        .map(a => a.payload.key);
}

describe('Nemesis AI', () => {
    beforeEach(() => {
        getAIImplementation(NEMESIS_ID)?.reset?.();
    });

    it('registers in the AI registry and appears in selector options', () => {
        expect(getAIImplementation(NEMESIS_ID)?.id).toBe(NEMESIS_ID);
        expect(getAIImplementationOptions().some(o => o.id === NEMESIS_ID)).toBe(true);
    });

    it('opens with a power plant', () => {
        const state = createState([
            building('cy', ME, 'conyard', 2400, 2400),
            unit('h', ME, 'harvester', 2480, 2450),
            building('ecy', ENEMY, 'conyard', 400, 400)
        ], 0, 10000);
        expect(startBuilds(computeNemesisAiActions(state, ME), 'building')).toEqual(['power']);
    });

    it('shelves a build that would brown out the base and starts a power plant instead', () => {
        getNemesisRuntimeState(ME).openingDone = true;
        const entities = airBase().filter(e => e.id !== 'pw2' && e.id !== 'pw3');
        const state = createState(entities, 9000, 5000, {
            queues: {
                ...createPlayerState(ME, true, 'hard', '#ff4444').queues,
                building: { current: 'factory', progress: 10, invested: 200, queued: [] }
            }
        });
        const actions = computeNemesisAiActions(state, ME);
        expect(actions.some(a => a.type === 'CANCEL_BUILD' && a.payload.category === 'building')).toBe(true);
        expect(startBuilds(actions, 'building')).toEqual(['power']);
    });

    it('builds helicopters once it has a Tech Center and an Air-Force Command', () => {
        getNemesisRuntimeState(ME).openingDone = true;
        const state = createState(airBase(), 9000, 5000);
        const air = startBuilds(computeNemesisAiActions(state, ME), 'air');
        expect(air).toEqual(['heli']);
    });

    it('focuses every helicopter on the same target', () => {
        getNemesisRuntimeState(ME).openingDone = true;
        const helis = [0, 1, 2, 3].map(i => unit(`heli${i}`, ME, 'heli', 2700 + i * 20, 2700));
        const state = createState([...airBase(), ...helis, unit('eh', ENEMY, 'harvester', 1200, 1200)], 9000, 5000);
        const attacks = computeNemesisAiActions(state, ME)
            .filter((a): a is Extract<Action, { type: 'COMMAND_ATTACK' }> => a.type === 'COMMAND_ATTACK')
            .filter(a => a.payload.unitIds.some(id => id.startsWith('heli')));
        const targets = new Set(attacks.map(a => a.payload.targetId));
        expect(attacks.length).toBe(4);
        expect(targets).toEqual(new Set(['eh']));
    });

    it('kites shorter-ranged anti-air between shots', () => {
        getNemesisRuntimeState(ME).openingDone = true;
        const heliRange = RULES.units.heli.range;
        // Any ground anti-air unit the helicopter outranges (rules-driven, not hardcoded)
        const kiteable = (Object.keys(RULES.units) as UnitKey[]).find(key => {
            const data = RULES.units[key];
            const weapon = data.weaponType;
            return !data.fly && data.damage > 0 && Boolean(weapon) &&
                Boolean(RULES.weaponTargeting?.[weapon!]?.canTargetAir) && data.range < heliRange - 40;
        });
        if (!kiteable) return;
        const threatRange = RULES.units[kiteable].range;
        const heli = unit('heli0', ME, 'heli', 1800 + threatRange - 20, 2000, { cooldown: 10 });
        const threat = unit('er', ENEMY, kiteable, 1800, 2000);
        const state = createState([...airBase(), heli, threat], 9000, 5000);
        const move = computeNemesisAiActions(state, ME)
            .find((a): a is Extract<Action, { type: 'COMMAND_MOVE' }> => a.type === 'COMMAND_MOVE' && a.payload.unitIds.includes('heli0'));
        expect(move).toBeDefined();
        const standOff = Math.hypot(move!.payload.x - 1800, move!.payload.y - 2000);
        expect(standOff).toBeGreaterThan(threatRange); // outside the threat's range
        expect(standOff).toBeLessThan(heliRange); // still inside helicopter range
    });

    it('does not try to kite anti-air that outranges the helicopter', () => {
        getNemesisRuntimeState(ME).openingDone = true;
        const heliRange = RULES.units.heli.range;
        if (RULES.units.rocket.range <= heliRange) return;
        const heli = unit('heli0', ME, 'heli', 2000, 2000, { cooldown: 10 });
        const rocket = unit('er', ENEMY, 'rocket', 1800, 2000);
        const state = createState([...airBase(), heli, rocket], 9000, 5000);
        const kite = computeNemesisAiActions(state, ME)
            .find(a => a.type === 'COMMAND_MOVE' && a.payload.unitIds.includes('heli0'));
        expect(kite).toBeUndefined();
    });

    it('never issues commands for entities it does not own', () => {
        const state = createState(airBase().concat(unit('mine', ME, 'heavy', 2300, 2300), unit('theirs', ENEMY, 'heavy', 600, 600)), 9000, 5000);
        const actions: Action[] = [
            { type: 'COMMAND_MOVE', payload: { unitIds: ['theirs'], x: 0, y: 0 } },
            { type: 'COMMAND_MOVE', payload: { unitIds: ['mine'], x: 0, y: 0 } },
            { type: 'SELL_BUILDING', payload: { buildingId: 'ecy', playerId: ME } },
            { type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId: ENEMY } },
            { type: 'TOGGLE_DEBUG' }
        ];
        const kept = sanitizeNemesisActions(actions, state, ME);
        expect(kept).toEqual([{ type: 'COMMAND_MOVE', payload: { unitIds: ['mine'], x: 0, y: 0 } }]);
    });

    it('only ever acts as its own player in a full decision tick', () => {
        getNemesisRuntimeState(ME).openingDone = true;
        const state = createState([
            ...airBase(),
            unit('heli0', ME, 'heli', 2700, 2700),
            unit('mine', ME, 'heavy', 2300, 2300),
            unit('theirs', ENEMY, 'heavy', 2100, 2100)
        ], 9000, 5000);
        for (const action of computeNemesisAiActions(state, ME)) {
            const payload = (action as { payload?: Record<string, unknown> }).payload ?? {};
            if ('playerId' in payload) expect(payload.playerId).toBe(ME);
            for (const id of (payload.unitIds as EntityId[] | undefined) ?? []) {
                expect(state.entities[id].owner).toBe(ME);
            }
        }
    });
});

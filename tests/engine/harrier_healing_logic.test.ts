
import { describe, it, expect } from 'vitest';
import { GameState, PlayerState, EntityId, AirUnit } from '../../src/engine/types';
import { updateAirBase } from '../../src/engine/reducers/air_units';
import { createEntity } from '../../src/engine/reducers/helpers';

describe('Harrier Docked Logic', () => {
    it('should slowly heal damaged docked harriers', () => {
        const playerId = 1;

        const state: GameState = {
            tick: 100,
            entities: {},
            players: {
                [playerId]: { id: playerId } as PlayerState
            },
            projectiles: [],
            particles: [],
            camera: { x: 0, y: 0 },
            zoom: 1,
            selection: [],
            mode: 'game',
            running: true,
            winner: null,
            notification: null,
            config: { width: 1000, height: 1000, tickRate: 60 }
        } as GameState;

        // Create Air Force Command
        const afc = createEntity(100, 100, playerId, 'BUILDING', 'airforce_command', state);
        state.entities[afc.id] = afc;

        // Create damaged Harrier and dock it
        const h1 = createEntity(0, 0, playerId, 'UNIT', 'harrier', state) as AirUnit;
        const maxHp = h1.maxHp;
        const damage = 50;

        // Manually set HP
        (h1 as any).hp = maxHp - damage;
        (h1 as any).airUnit.state = 'docked';
        (h1 as any).airUnit.homeBaseId = afc.id;
        (h1 as any).airUnit.dockedSlot = 0;
        (h1 as any).airUnit.ammo = 1;
        state.entities[h1.id] = h1;

        // Update base slots
        const newSlots = [...afc.airBase!.slots];
        newSlots[0] = h1.id;
        state.entities[afc.id] = {
            ...afc,
            airBase: { ...afc.airBase!, slots: newSlots }
        };

        const initialHp = h1.hp;

        // Verify initial state
        expect(h1.hp).toBe(maxHp - damage);

        // Run updates
        // Healing runs every 5 ticks.

        // Tick 101: 101 % 5 != 0 -> No Heal
        let res = updateAirBase(state.entities[afc.id] as any, state.entities, 101);
        expect(res.updatedHarriers[h1.id]).toBeUndefined();

        // Tick 105: 105 % 5 == 0 -> Heal
        res = updateAirBase(state.entities[afc.id] as any, state.entities, 105);
        expect(res.updatedHarriers[h1.id]).toBeDefined();
        // Check HP increase (assuming +2 per 5 ticks logic I implemented)
        expect(res.updatedHarriers[h1.id].hp).toBeGreaterThan(initialHp);
        expect(res.updatedHarriers[h1.id].hp).toBe(initialHp + 2);

    });

    it('should heal AND reload if both needed', () => {
        const playerId = 1;
        const state = {
            tick: 100,
            entities: {} as any
        }; // simplified mock

        const afc = createEntity(100, 100, playerId, 'BUILDING', 'airforce_command', state as any);
        const slots = [...afc.airBase!.slots];

        // Damaged AND empty ammo
        const h1 = createEntity(0, 0, playerId, 'UNIT', 'harrier', state as any) as AirUnit;
        (h1 as any).hp = h1.maxHp - 50;
        (h1 as any).airUnit.state = 'docked';
        (h1 as any).airUnit.ammo = 0;
        (h1 as any).airUnit.homeBaseId = afc.id;
        state.entities[h1.id] = h1;

        slots[0] = h1.id;
        const baseWithSlot = { ...afc, airBase: { ...afc.airBase!, slots, reloadProgress: 1 } }; // Almost reloaded

        // Tick 105 (healing tick)
        const res = updateAirBase(baseWithSlot as any, state.entities, 105);

        const updated = res.updatedHarriers[h1.id];
        expect(updated).toBeDefined();

        // Should be healed
        expect(updated.hp).toBe(h1.hp + 2);

        // Should be reloaded (reloadProgress 1 -> 0)
        expect(updated.airUnit.ammo).toBe(h1.airUnit.maxAmmo);
    });
});

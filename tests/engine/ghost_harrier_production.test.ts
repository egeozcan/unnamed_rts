
import { describe, it, expect } from 'vitest';
import { GameState, PlayerState, EntityId, AirUnit, BuildingEntity } from '../../src/engine/types';
import { startBuild } from '../../src/engine/reducers/production';
import { createEntity } from '../../src/engine/reducers/helpers';

describe('Production - Ghost Harrier Check', () => {
    it('should allow production when a ghost harrier exists but a real slot is available', () => {
        const playerId = 1;

        const state: GameState = {
            tick: 100,
            entities: {},
            players: {
                [playerId]: {
                    id: playerId,
                    credits: 5000,
                    queues: {
                        air: { current: null, progress: 0, invested: 0, queued: [] }
                    }
                } as PlayerState
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
        const afc = createEntity(100, 100, playerId, 'BUILDING', 'airforce_command', state) as BuildingEntity;
        // Slots: 5 occupied, 1 null
        const slots: (EntityId | null)[] = [null, null, null, null, null, null];

        // Create 5 valid harriers
        for (let i = 0; i < 5; i++) {
            const h = createEntity(0, 0, playerId, 'UNIT', 'harrier', state) as AirUnit;
            (h as any).airUnit.state = 'docked';
            (h as any).airUnit.homeBaseId = afc.id;
            (h as any).airUnit.dockedSlot = i;
            state.entities[h.id] = h;
            slots[i] = h.id;
        }

        // Create 1 ghost harrier (docked but not in slot)
        const ghost = createEntity(0, 0, playerId, 'UNIT', 'harrier', state) as AirUnit;
        (ghost as any).airUnit.state = 'docked';
        (ghost as any).airUnit.homeBaseId = afc.id;
        (ghost as any).airUnit.dockedSlot = 5; // Claims slot 5
        state.entities[ghost.id] = ghost;

        // Ensure slot 5 is actually empty (or holds someone else, but here empty for clarity of "available space")
        slots[5] = null;

        // Update base with slots
        const updatedAfc = {
            ...afc,
            airBase: { ...afc.airBase!, slots }
        };
        state.entities[afc.id] = updatedAfc;

        // Total Harriers Entity Count: 6 (5 valid + 1 ghost)
        // Total Slots: 6
        // Without fix: 6 >= 6 -> Blocked
        // With fix: Ignored ghost -> 5 < 6 -> Allowed

        const nextState = startBuild(state, { category: 'air', key: 'harrier', playerId });

        const q = nextState.players[playerId].queues.air;

        // Should have started building
        expect(q.current).toBe('harrier');
    });
});

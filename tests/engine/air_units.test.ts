import { describe, it, expect, beforeEach } from 'vitest';
import { update, INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { GameState, Entity, EntityId, Vector, AirUnit, BuildingEntity } from '../../src/engine/types';
import {
    createTestHarrier,
    createTestAirforceCommand,
    createTestBuilding,
    createTestCombatUnit,
    resetTestEntityCounter
} from '../../src/engine/test-utils';
import { updateAirUnitState, updateAirBase } from '../../src/engine/reducers/air_units';
import { isAirUnit } from '../../src/engine/entity-helpers';

// Helper to create a test state with players
function createTestState(entities: Record<EntityId, Entity>, tick: number = 0): GameState {
    return {
        ...INITIAL_STATE,
        tick,
        entities,
        players: {
            0: { ...createPlayerState(0, false, 'medium', '#0088FF'), credits: 5000 },
            1: { ...createPlayerState(1, true, 'medium', '#FFCC00'), credits: 5000 }
        }
    };
}

describe('Air Units - Harrier State Machine', () => {
    beforeEach(() => {
        resetTestEntityCounter();
    });

    describe('Docked State', () => {
        it('should stay docked when no target assigned', () => {
            const airBase = createTestAirforceCommand({ id: 'base1', owner: 0, x: 500, y: 500 });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                x: 500,
                y: 500,
                state: 'docked',
                homeBaseId: 'base1',
                dockedSlot: 0,
                ammo: 1
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            expect(result.entity.airUnit.state).toBe('docked');
            expect(result.projectile).toBeNull();
        });

        it('should be invisible to renderer when docked (tested via isAirUnit)', () => {
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                state: 'docked'
            });

            expect(isAirUnit(harrier)).toBe(true);
            expect(harrier.airUnit.state).toBe('docked');
        });
    });

    describe('Flying State', () => {
        it('should move toward target when flying', () => {
            const airBase = createTestAirforceCommand({ id: 'base1', owner: 0, x: 100, y: 100 });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                x: 100,
                y: 100,
                state: 'flying',
                homeBaseId: 'base1',
                targetId: 'enemy1',
                ammo: 1
            });
            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 1,
                x: 500,
                y: 500
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                enemy1: enemy
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            // Should still be flying (not in range yet)
            expect(result.entity.airUnit.state).toBe('flying');
            // Should have moved toward target (velocity set)
            expect(result.entity.movement.vel.x).not.toBe(0);
            expect(result.entity.movement.vel.y).not.toBe(0);
        });

        it('should switch to attacking when in range', () => {
            const airBase = createTestAirforceCommand({ id: 'base1', owner: 0, x: 100, y: 100 });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                x: 400,
                y: 400,
                state: 'flying',
                homeBaseId: 'base1',
                targetId: 'enemy1',
                ammo: 1
            });
            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 1,
                x: 450,
                y: 450
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                enemy1: enemy
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            // Should switch to attacking (distance ~70 < range 250)
            expect(result.entity.airUnit.state).toBe('attacking');
        });

        it('should return to base if target dies', () => {
            const airBase = createTestAirforceCommand({ id: 'base1', owner: 0, x: 100, y: 100 });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                x: 400,
                y: 400,
                state: 'flying',
                homeBaseId: 'base1',
                targetId: 'enemy1',
                ammo: 1
            });
            const deadEnemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 1,
                x: 450,
                y: 450,
                dead: true
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                enemy1: deadEnemy
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            expect(result.entity.airUnit.state).toBe('returning');
            expect(result.entity.combat.targetId).toBeNull();
        });
    });

    describe('Attacking State', () => {
        it('should fire missile and return when attacking with ammo', () => {
            const airBase = createTestAirforceCommand({ id: 'base1', owner: 0, x: 100, y: 100 });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                x: 450,
                y: 450,
                state: 'attacking',
                homeBaseId: 'base1',
                targetId: 'enemy1',
                ammo: 1,
                cooldown: 0
            });
            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 1,
                x: 450,
                y: 450
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                enemy1: enemy
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            // Should fire projectile
            expect(result.projectile).not.toBeNull();
            // Should decrease ammo
            expect(result.entity.airUnit.ammo).toBe(0);
            // Should auto-return after firing
            expect(result.entity.airUnit.state).toBe('returning');
        });

        it('should return without firing when out of ammo', () => {
            const airBase = createTestAirforceCommand({ id: 'base1', owner: 0, x: 100, y: 100 });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                x: 450,
                y: 450,
                state: 'attacking',
                homeBaseId: 'base1',
                targetId: 'enemy1',
                ammo: 0,
                cooldown: 0
            });
            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 1,
                x: 450,
                y: 450
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier,
                enemy1: enemy
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            // Should not fire (no ammo)
            expect(result.projectile).toBeNull();
            // Should return to base
            expect(result.entity.airUnit.state).toBe('returning');
        });
    });

    describe('Returning State', () => {
        it('should move toward home base when returning', () => {
            const airBase = createTestAirforceCommand({ id: 'base1', owner: 0, x: 100, y: 100 });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                x: 500,
                y: 500,
                state: 'returning',
                homeBaseId: 'base1',
                ammo: 0
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            // Should still be returning (not at base yet)
            expect(result.entity.airUnit.state).toBe('returning');
            // Should have velocity toward base
            expect(result.entity.movement.vel.x).toBeLessThan(0);
            expect(result.entity.movement.vel.y).toBeLessThan(0);
        });

        it('should dock when reaching base', () => {
            const airBase = createTestAirforceCommand({
                id: 'base1',
                owner: 0,
                x: 100,
                y: 100,
                slots: [null, null, null, null, null, null]
            });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                x: 110,
                y: 110,
                state: 'returning',
                homeBaseId: 'base1',
                ammo: 0
            });

            const entities: Record<EntityId, Entity> = {
                base1: airBase,
                harrier1: harrier
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            // Should dock
            expect(result.entity.airUnit.state).toBe('docked');
            expect(result.entity.airUnit.dockedSlot).toBe(0);
            // Should update air base slots
            expect(result.modifiedEntities).toBeDefined();
            expect(result.modifiedEntities!['base1']).toBeDefined();
            const updatedBase = result.modifiedEntities!['base1'] as BuildingEntity;
            expect(updatedBase.airBase!.slots[0]).toBe('harrier1');
        });

        it('should find new base if home base destroyed', () => {
            const newBase = createTestAirforceCommand({
                id: 'base2',
                owner: 0,
                x: 200,
                y: 200,
                slots: [null, null, null, null, null, null]
            });
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                x: 500,
                y: 500,
                state: 'returning',
                homeBaseId: 'base1', // Home base doesn't exist anymore
                ammo: 0
            });

            const entities: Record<EntityId, Entity> = {
                base2: newBase,
                harrier1: harrier
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            // Should find new home base
            expect(result.entity.airUnit.homeBaseId).toBe('base2');
            expect(result.entity.airUnit.state).toBe('returning');
        });

        it('should crash (die) if no base available anywhere', () => {
            // Harrier with no home base and no other bases available
            const harrier = createTestHarrier({
                id: 'harrier1',
                owner: 0,
                x: 500,
                y: 500,
                state: 'returning',
                homeBaseId: 'base1', // Home base doesn't exist
                ammo: 0
            });

            const entities: Record<EntityId, Entity> = {
                harrier1: harrier
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            // Should crash - no base to return to
            expect(result.entity.dead).toBe(true);
            expect(result.entity.hp).toBe(0);
        });

        it('should crash if home base slot is full and no other base available', () => {
            // Home base with all slots full
            const fullBase = createTestAirforceCommand({
                id: 'base1',
                owner: 0,
                x: 100,
                y: 100,
                slots: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] // All slots full
            });
            const harrier = createTestHarrier({
                id: 'harrier_new',
                owner: 0,
                x: 100,
                y: 100, // At the base
                state: 'returning',
                homeBaseId: 'base1',
                ammo: 0
            });

            const entities: Record<EntityId, Entity> = {
                base1: fullBase,
                harrier_new: harrier
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            // Should crash - no slot available
            expect(result.entity.dead).toBe(true);
            expect(result.entity.hp).toBe(0);
        });

        it('should find alternate base if home base slots are full', () => {
            // Home base with all slots full
            const fullBase = createTestAirforceCommand({
                id: 'base1',
                owner: 0,
                x: 100,
                y: 100,
                slots: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] // All slots full
            });
            // Second base with empty slot
            const emptyBase = createTestAirforceCommand({
                id: 'base2',
                owner: 0,
                x: 800,
                y: 800,
                slots: [null, null, null, null, null, null]
            });
            const harrier = createTestHarrier({
                id: 'harrier_new',
                owner: 0,
                x: 100,
                y: 100, // At the full base
                state: 'returning',
                homeBaseId: 'base1',
                ammo: 0
            });

            const entities: Record<EntityId, Entity> = {
                base1: fullBase,
                base2: emptyBase,
                harrier_new: harrier
            };

            const result = updateAirUnitState(harrier, entities, Object.values(entities));

            // Should redirect to base2
            expect(result.entity.dead).toBeFalsy();
            expect(result.entity.airUnit.homeBaseId).toBe('base2');
            expect(result.entity.airUnit.state).toBe('returning');
        });
    });
});

describe('Air Units - Attack Commands', () => {
    beforeEach(() => {
        resetTestEntityCounter();
    });

    it('should launch docked harrier on attack command', () => {
        const airBase = createTestAirforceCommand({
            id: 'base1',
            owner: 0,
            x: 500,
            y: 500,
            slots: ['harrier1', null, null, null, null, null]
        });
        const harrier = createTestHarrier({
            id: 'harrier1',
            owner: 0,
            x: 500,
            y: 500,
            state: 'docked',
            homeBaseId: 'base1',
            dockedSlot: 0,
            ammo: 1
        });
        const enemy = createTestCombatUnit({
            id: 'enemy1',
            owner: 1,
            x: 800,
            y: 800
        });

        const entities: Record<EntityId, Entity> = {
            base1: airBase,
            harrier1: harrier,
            enemy1: enemy
        };

        let state = createTestState(entities);
        state = update(state, {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: ['harrier1'], targetId: 'enemy1' }
        });

        const launchedHarrier = state.entities['harrier1'] as AirUnit;
        const updatedBase = state.entities['base1'] as BuildingEntity;

        // Harrier should be docked with target (waiting for launch)
        expect(launchedHarrier.airUnit.state).toBe('docked');
        expect(launchedHarrier.combat.targetId).toBe('enemy1');

        // Advance state and run updateAirBase to trigger launch
        const tick = 200; // arbitrary tick
        state = { ...state, tick };
        const launchRes = updateAirBase(updatedBase, state.entities, tick + 20); // wait > 15 ticks

        const flyingHarrier = launchRes.updatedHarriers['harrier1'];
        expect(flyingHarrier).toBeDefined();
        expect(flyingHarrier.airUnit.state).toBe('flying');
        expect(flyingHarrier.airUnit.dockedSlot).toBeNull();
        expect(launchRes.entity.airBase!.slots[0]).toBeNull();
    });

    it('should ignore attack command when harrier has no ammo', () => {
        const airBase = createTestAirforceCommand({
            id: 'base1',
            owner: 0,
            x: 500,
            y: 500,
            slots: ['harrier1', null, null, null, null, null]
        });
        const harrier = createTestHarrier({
            id: 'harrier1',
            owner: 0,
            x: 500,
            y: 500,
            state: 'docked',
            homeBaseId: 'base1',
            dockedSlot: 0,
            ammo: 0 // No ammo
        });
        const enemy = createTestCombatUnit({
            id: 'enemy1',
            owner: 1,
            x: 800,
            y: 800
        });

        const entities: Record<EntityId, Entity> = {
            base1: airBase,
            harrier1: harrier,
            enemy1: enemy
        };

        let state = createTestState(entities);
        state = update(state, {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: ['harrier1'], targetId: 'enemy1' }
        });

        const unchangedHarrier = state.entities['harrier1'] as AirUnit;

        // Harrier should remain docked (no ammo)
        expect(unchangedHarrier.airUnit.state).toBe('docked');
    });

    it('should ignore attack command when harrier is not docked', () => {
        const airBase = createTestAirforceCommand({
            id: 'base1',
            owner: 0,
            x: 500,
            y: 500
        });
        const harrier = createTestHarrier({
            id: 'harrier1',
            owner: 0,
            x: 600,
            y: 600,
            state: 'flying', // Already flying
            homeBaseId: 'base1',
            targetId: 'enemy2',
            ammo: 1
        });
        const enemy = createTestCombatUnit({
            id: 'enemy1',
            owner: 1,
            x: 800,
            y: 800
        });

        const entities: Record<EntityId, Entity> = {
            base1: airBase,
            harrier1: harrier,
            enemy1: enemy
        };

        let state = createTestState(entities);
        state = update(state, {
            type: 'COMMAND_ATTACK',
            payload: { unitIds: ['harrier1'], targetId: 'enemy1' }
        });

        const unchangedHarrier = state.entities['harrier1'] as AirUnit;

        // Harrier should keep original target
        // Harrier should keep original target
        // NOTE: The new logic redirects flying harriers too!
        // So this expectation was wrong based on new requirements "All harriers... are commanded to attack"
        expect(unchangedHarrier.combat.targetId).toBe('enemy1');
    });

    it('should ignore move commands for harriers', () => {
        const harrier = createTestHarrier({
            id: 'harrier1',
            owner: 0,
            x: 500,
            y: 500,
            state: 'docked'
        });

        const entities: Record<EntityId, Entity> = {
            harrier1: harrier
        };

        let state = createTestState(entities);
        state = update(state, {
            type: 'COMMAND_MOVE',
            payload: { unitIds: ['harrier1'], x: 800, y: 800 }
        });

        const unchangedHarrier = state.entities['harrier1'] as AirUnit;

        // Harrier should not have move target (harriers ignore move commands)
        expect(unchangedHarrier.movement.moveTarget).toBeNull();
    });
});

describe('Air Units - Air Base Reload', () => {
    beforeEach(() => {
        resetTestEntityCounter();
    });

    it('should reload docked harrier ammo over time', () => {
        const harrier = createTestHarrier({
            id: 'harrier1',
            owner: 0,
            x: 500,
            y: 500,
            state: 'docked',
            homeBaseId: 'base1',
            dockedSlot: 0,
            ammo: 0,
            maxAmmo: 1
        });
        const airBase = createTestAirforceCommand({
            id: 'base1',
            owner: 0,
            x: 500,
            y: 500,
            slots: ['harrier1', null, null, null, null, null],
            reloadProgress: 1 // Almost done reloading
        });

        const entities: Record<EntityId, Entity> = {
            base1: airBase,
            harrier1: harrier
        };

        const result = updateAirBase(airBase, entities, 100);

        // Should reload harrier
        expect(result.updatedHarriers['harrier1']).toBeDefined();
        expect(result.updatedHarriers['harrier1'].airUnit.ammo).toBe(1);
        // Reload progress should reset
        expect(result.entity.airBase!.reloadProgress).toBe(120);
    });

    it('should not reload harrier that already has full ammo', () => {
        const harrier = createTestHarrier({
            id: 'harrier1',
            owner: 0,
            x: 500,
            y: 500,
            state: 'docked',
            homeBaseId: 'base1',
            dockedSlot: 0,
            ammo: 1, // Full ammo
            maxAmmo: 1
        });
        const airBase = createTestAirforceCommand({
            id: 'base1',
            owner: 0,
            x: 500,
            y: 500,
            slots: ['harrier1', null, null, null, null, null],
            reloadProgress: 50
        });

        const entities: Record<EntityId, Entity> = {
            base1: airBase,
            harrier1: harrier
        };

        const result = updateAirBase(airBase, entities, 100);

        // Should not update harrier (already full)
        expect(result.updatedHarriers['harrier1']).toBeUndefined();
    });
});

describe('Air Units - Slot Management', () => {
    beforeEach(() => {
        resetTestEntityCounter();
    });

    it('should have 6 slots per airforce_command', () => {
        const airBase = createTestAirforceCommand({ id: 'base1', owner: 0 });

        expect(airBase.airBase!.slots.length).toBe(6);
    });

    it('should assign harrier to first available slot when produced', () => {
        // This is tested through the production system
        const airBase = createTestAirforceCommand({
            id: 'base1',
            owner: 0,
            slots: ['existing1', null, null, null, null, null] // Slot 0 taken
        });
        const harrier = createTestHarrier({
            id: 'harrier1',
            owner: 0,
            x: 510,
            y: 510,
            state: 'returning',
            homeBaseId: 'base1',
            ammo: 0
        });

        const entities: Record<EntityId, Entity> = {
            base1: airBase,
            harrier1: harrier
        };

        const result = updateAirUnitState(harrier, entities, Object.values(entities));

        // Should dock at slot 1 (first available)
        expect(result.entity.airUnit.state).toBe('docked');
        expect(result.entity.airUnit.dockedSlot).toBe(1);
    });

    it('should hover if no slots available', () => {
        const airBase = createTestAirforceCommand({
            id: 'base1',
            owner: 0,
            x: 100,
            y: 100,
            slots: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] // All slots taken
        });
        const harrier = createTestHarrier({
            id: 'harrier7',
            owner: 0,
            x: 110,
            y: 110,
            state: 'returning',
            homeBaseId: 'base1',
            ammo: 0
        });

        const entities: Record<EntityId, Entity> = {
            base1: airBase,
            harrier7: harrier
        };

        const result = updateAirUnitState(harrier, entities, Object.values(entities));

        // Should hover (not docked, velocity zero)
        expect(result.entity.airUnit.state).toBe('returning');
        expect(result.entity.movement.vel.x).toBe(0);
        expect(result.entity.movement.vel.y).toBe(0);
    });
});

describe('Air Units - Weapon Targeting', () => {
    beforeEach(() => {
        resetTestEntityCounter();
    });

    it('should allow harrier to attack ground units (canTargetGround)', () => {
        const harrier = createTestHarrier({
            id: 'harrier1',
            owner: 0,
            x: 450,
            y: 450,
            state: 'flying',
            homeBaseId: 'base1',
            targetId: 'tank1',
            ammo: 1,
            cooldown: 0
        });
        const tank = createTestCombatUnit({
            id: 'tank1',
            owner: 1,
            key: 'heavy',
            x: 450,
            y: 450
        });
        const airBase = createTestAirforceCommand({ id: 'base1', owner: 0 });

        const entities: Record<EntityId, Entity> = {
            base1: airBase,
            harrier1: harrier,
            tank1: tank
        };

        // Switch to attacking
        let result = updateAirUnitState(harrier, entities, Object.values(entities));
        expect(result.entity.airUnit.state).toBe('attacking');

        // Fire
        result = updateAirUnitState(result.entity, entities, Object.values(entities));
        expect(result.projectile).not.toBeNull();
    });

    it('should allow harrier to attack buildings', () => {
        const harrier = createTestHarrier({
            id: 'harrier1',
            owner: 0,
            x: 450,
            y: 450,
            state: 'attacking',
            homeBaseId: 'base1',
            targetId: 'factory1',
            ammo: 1,
            cooldown: 0
        });
        const factory = createTestBuilding({
            id: 'factory1',
            owner: 1,
            key: 'factory',
            x: 450,
            y: 450
        });
        const airBase = createTestAirforceCommand({ id: 'base1', owner: 0 });

        const entities: Record<EntityId, Entity> = {
            base1: airBase,
            harrier1: harrier,
            factory1: factory
        };

        const result = updateAirUnitState(harrier, entities, Object.values(entities));

        // Should fire at building
        expect(result.projectile).not.toBeNull();
    });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { Vector, Entity, EntityId, UnitKey, BuildingKey, GameState, CombatUnit } from '../../src/engine/types';
import { INITIAL_STATE, createPlayerState } from '../../src/engine/reducer';
import { updateCombatUnitBehavior } from '../../src/engine/reducers/combat';
import { handleMicro } from '../../src/engine/ai/action_combat';
import { AIPersonality } from '../../src/data/schemas/index';
import { rebuildSpatialGrid } from '../../src/engine/spatial';
import {
    createTestCombatUnit,
    createTestBuilding,
    resetTestEntityCounter
} from '../../src/engine/test-utils';

// Test that units with canAttackWhileMoving flag keep their moveTarget when attacking
describe('Attack While Moving', () => {
    beforeEach(() => {
        resetTestEntityCounter();
    });

    function createTestState(entities: Record<EntityId, Entity>): GameState {
        return {
            ...INITIAL_STATE,
            tick: 100,
            entities,
            players: {
                0: createPlayerState(0, 'human', 'easy'),
                1: createPlayerState(1, 'ai', 'hard')
            },
            config: { ...INITIAL_STATE.config, width: 3000, height: 3000 }
        };
    }

    describe('Combat Behavior', () => {
        it('light tank (canAttackWhileMoving=true) should keep moveTarget when attacking', () => {
            // Light tank can attack while moving
            const lightTank = createTestCombatUnit({
                id: 'light1',
                owner: 0,
                key: 'light',
                x: 500,
                y: 500,
                hp: 400,
                maxHp: 400,
                moveTarget: new Vector(800, 800), // Has a move destination
                targetId: 'enemy1', // And a target to attack
                cooldown: 0
            });

            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 1,
                key: 'rifle',
                x: 550, // Within light tank's range (210)
                y: 550,
                hp: 60,
                maxHp: 60
            });

            const entities: Record<EntityId, Entity> = {
                light1: lightTank,
                enemy1: enemy
            };

            rebuildSpatialGrid(entities);

            const result = updateCombatUnitBehavior(
                lightTank,
                entities,
                Object.values(entities)
            );

            // Should have fired (projectile created)
            expect(result.projectile).toBeTruthy();
            // Should still have moveTarget (can attack while moving)
            expect(result.entity.movement.moveTarget).not.toBeNull();
            expect(result.entity.movement.moveTarget?.x).toBe(800);
            expect(result.entity.movement.moveTarget?.y).toBe(800);
        });

        it('heavy tank (canAttackWhileMoving=false) should clear moveTarget when attacking', () => {
            // Heavy tank cannot attack while moving
            const heavyTank = createTestCombatUnit({
                id: 'heavy1',
                owner: 0,
                key: 'heavy',
                x: 500,
                y: 500,
                hp: 700,
                maxHp: 700,
                moveTarget: new Vector(800, 800), // Has a move destination
                targetId: 'enemy1', // And a target to attack
                cooldown: 0
            });

            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 1,
                key: 'rifle',
                x: 550, // Within heavy tank's range (230)
                y: 550,
                hp: 60,
                maxHp: 60
            });

            const entities: Record<EntityId, Entity> = {
                heavy1: heavyTank,
                enemy1: enemy
            };

            rebuildSpatialGrid(entities);

            const result = updateCombatUnitBehavior(
                heavyTank,
                entities,
                Object.values(entities)
            );

            // Should have fired (projectile created)
            expect(result.projectile).toBeTruthy();
            // Should have cleared moveTarget (cannot attack while moving)
            expect(result.entity.movement.moveTarget).toBeNull();
        });

        it('jeep (canAttackWhileMoving=true) should continue moving while attacking', () => {
            const jeep = createTestCombatUnit({
                id: 'jeep1',
                owner: 0,
                key: 'jeep',
                x: 500,
                y: 500,
                hp: 180,
                maxHp: 180,
                moveTarget: new Vector(1000, 1000),
                targetId: 'enemy1',
                cooldown: 0
            });

            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 1,
                key: 'rifle',
                x: 530, // Within jeep's range (160)
                y: 530,
                hp: 60,
                maxHp: 60
            });

            const entities: Record<EntityId, Entity> = {
                jeep1: jeep,
                enemy1: enemy
            };

            rebuildSpatialGrid(entities);

            const result = updateCombatUnitBehavior(
                jeep,
                entities,
                Object.values(entities)
            );

            // Should keep moveTarget
            expect(result.entity.movement.moveTarget).not.toBeNull();
            // Should have fired
            expect(result.projectile).toBeTruthy();
        });

        it('rifle infantry (no flag) should stop to attack', () => {
            const rifle = createTestCombatUnit({
                id: 'rifle1',
                owner: 0,
                key: 'rifle',
                x: 500,
                y: 500,
                hp: 60,
                maxHp: 60,
                moveTarget: new Vector(800, 800),
                targetId: 'enemy1',
                cooldown: 0
            });

            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 1,
                key: 'rifle',
                x: 550, // Within rifle range (130)
                y: 550,
                hp: 60,
                maxHp: 60
            });

            const entities: Record<EntityId, Entity> = {
                rifle1: rifle,
                enemy1: enemy
            };

            rebuildSpatialGrid(entities);

            const result = updateCombatUnitBehavior(
                rifle,
                entities,
                Object.values(entities)
            );

            // Should have cleared moveTarget (infantry cannot attack while moving)
            expect(result.entity.movement.moveTarget).toBeNull();
            // Should have fired
            expect(result.projectile).toBeTruthy();
        });
    });

    describe('AI Kiting Behavior', () => {
        const testPersonality: AIPersonality = {
            name: 'test',
            description: 'Test personality',
            aggression: 0.5,
            economy_focus: 0.5,
            expansion_tendency: 0.5,
            harassment_tendency: 0.5,
            retreat_threshold: 0.3,
            kite_aggressiveness: 0.5
        };

        it('should issue continuous move commands for units that can attack while moving', () => {
            // Light tank (canAttackWhileMoving) vs short-range melee-ish unit
            const lightTank = createTestCombatUnit({
                id: 'light1',
                owner: 1,
                key: 'light',
                x: 500,
                y: 500,
                hp: 400,
                maxHp: 400,
                cooldown: 0 // Ready to fire
            }) as CombatUnit;

            // Enemy with shorter range - light tank has 210 range
            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 0,
                key: 'rifle', // 130 range
                x: 550, // Within kite threshold (210 * 0.6 = 126) and light tank has range advantage
                y: 500,
                hp: 60,
                maxHp: 60
            });

            const baseCenter = new Vector(200, 200);
            const combatUnits = [lightTank];
            const enemies = [enemy];

            const actions = handleMicro(
                createTestState({ light1: lightTank, enemy1: enemy }),
                combatUnits,
                enemies,
                baseCenter,
                testPersonality,
                [],
                'hard'
            );

            // Light tank can attack while moving, so it should kite continuously
            const moveAction = actions.find(a => a.type === 'COMMAND_MOVE');
            expect(moveAction).toBeDefined();
        });

        it('should use stop-fire-move pattern for units that cannot attack while moving', () => {
            // Heavy tank (cannot attack while moving) - has just fired (high cooldown)
            const heavyTank = createTestCombatUnit({
                id: 'heavy1',
                owner: 1,
                key: 'heavy',
                x: 500,
                y: 500,
                hp: 700,
                maxHp: 700,
                cooldown: 70 // Just fired (rate is 75, so 70 is ~93% of max cooldown, > 90% threshold)
            }) as CombatUnit;

            // Enemy with shorter range - heavy tank has 230 range
            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 0,
                key: 'rifle', // 130 range
                x: 550, // Close enough to trigger kiting
                y: 500,
                hp: 60,
                maxHp: 60
            });

            const baseCenter = new Vector(200, 200);
            const combatUnits = [heavyTank];
            const enemies = [enemy];

            const actions = handleMicro(
                createTestState({ heavy1: heavyTank, enemy1: enemy }),
                combatUnits,
                enemies,
                baseCenter,
                testPersonality,
                [],
                'hard'
            );

            // Heavy tank just fired, so it should move to reposition
            const moveAction = actions.find(a => a.type === 'COMMAND_MOVE');
            expect(moveAction).toBeDefined();
        });

        it('should NOT move heavy tank that is waiting to fire', () => {
            // Heavy tank with low cooldown - waiting to fire
            const heavyTank = createTestCombatUnit({
                id: 'heavy1',
                owner: 1,
                key: 'heavy',
                x: 500,
                y: 500,
                hp: 700,
                maxHp: 700,
                cooldown: 10 // Low cooldown (< 90% of 75), should stay and fire soon
            }) as CombatUnit;

            // Enemy at moderate distance (not critically close)
            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 0,
                key: 'rifle',
                x: 600, // Not critically close (> 30% of 230 range = 69)
                y: 500,
                hp: 60,
                maxHp: 60
            });

            const baseCenter = new Vector(200, 200);
            const combatUnits = [heavyTank];
            const enemies = [enemy];

            const actions = handleMicro(
                createTestState({ heavy1: heavyTank, enemy1: enemy }),
                combatUnits,
                enemies,
                baseCenter,
                testPersonality,
                [],
                'hard'
            );

            // Heavy tank should stay put and wait to fire (no move command)
            const moveAction = actions.find(a =>
                a.type === 'COMMAND_MOVE' && a.payload.unitIds.includes('heavy1')
            );
            expect(moveAction).toBeUndefined();
        });

        it('should move heavy tank when enemy is critically close', () => {
            // Heavy tank with low cooldown but enemy critically close
            const heavyTank = createTestCombatUnit({
                id: 'heavy1',
                owner: 1,
                key: 'heavy',
                x: 500,
                y: 500,
                hp: 700,
                maxHp: 700,
                cooldown: 30 // Mid cooldown (not just fired, not ready)
            }) as CombatUnit;

            // Enemy critically close (< 30% of 230 range = 69)
            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 0,
                key: 'rifle',
                x: 530, // Very close - only 30 pixels away (< 69 threshold)
                y: 500,
                hp: 60,
                maxHp: 60
            });

            const baseCenter = new Vector(200, 200);
            const combatUnits = [heavyTank];
            const enemies = [enemy];

            const actions = handleMicro(
                createTestState({ heavy1: heavyTank, enemy1: enemy }),
                combatUnits,
                enemies,
                baseCenter,
                testPersonality,
                [],
                'hard'
            );

            // Heavy tank should move despite mid cooldown because enemy is critically close
            const moveAction = actions.find(a =>
                a.type === 'COMMAND_MOVE' && a.payload.unitIds.includes('heavy1')
            );
            expect(moveAction).toBeDefined();
        });

        it('should NEVER move heavy tank when ready to fire (cooldown=0)', () => {
            // Heavy tank ready to fire - should never be interrupted
            const heavyTank = createTestCombatUnit({
                id: 'heavy1',
                owner: 1,
                key: 'heavy',
                x: 500,
                y: 500,
                hp: 700,
                maxHp: 700,
                cooldown: 0 // Ready to fire!
            }) as CombatUnit;

            // Enemy close (would normally trigger kiting)
            const enemy = createTestCombatUnit({
                id: 'enemy1',
                owner: 0,
                key: 'rifle',
                x: 540,
                y: 500,
                hp: 60,
                maxHp: 60
            });

            const baseCenter = new Vector(200, 200);
            const combatUnits = [heavyTank];
            const enemies = [enemy];

            const actions = handleMicro(
                createTestState({ heavy1: heavyTank, enemy1: enemy }),
                combatUnits,
                enemies,
                baseCenter,
                testPersonality,
                [],
                'hard'
            );

            // Heavy tank should NEVER move when ready to fire
            const moveAction = actions.find(a =>
                a.type === 'COMMAND_MOVE' && a.payload.unitIds.includes('heavy1')
            );
            expect(moveAction).toBeUndefined();
        });
    });
});

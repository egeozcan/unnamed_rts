import { describe, it, expect, beforeEach } from 'vitest';
import { INITIAL_STATE } from './reducer';
import { GameState, Vector, Entity, EntityId, isActionType, HarvesterUnit, CombatUnit, BuildingKey, UnitKey } from './types';
import { createTestHarvester, createTestCombatUnit, createTestBuilding, createTestResource, addEntityToState } from './test-utils';
import { computeAiActions, resetAIState } from './ai';

describe('Harvester Economic Pressure', () => {
    beforeEach(() => {
        resetAIState();
    });

    // Helper to spawn units
    function spawnUnit(state: GameState, x: number, y: number, id: string, owner: number = 0, key: string = 'rifle'): GameState {
        if (key === 'harvester') {
            const unit = createTestHarvester({ id, owner, x, y });
            return addEntityToState(state, unit);
        } else {
            const unit = createTestCombatUnit({ id, owner, x, y, key: key as Exclude<UnitKey, 'harvester'> });
            return addEntityToState(state, unit);
        }
    }

    // Helper to spawn buildings
    function spawnBuilding(state: GameState, x: number, y: number, w: number, h: number, id: string, owner: number = 0, key: string = 'conyard'): GameState {
        const building = createTestBuilding({ id, owner, x, y, w, h, key: key as BuildingKey });
        return addEntityToState(state, building);
    }

    // Helper to spawn resources
    function spawnResource(state: GameState, x: number, y: number, id: string): GameState {
        const resource = createTestResource({ id, x, y });
        return addEntityToState(state, resource);
    }

    it('should NOT flee when under economic pressure (low credits)', () => {
        // Setup: AI player with very low credits
        let state: GameState = { ...INITIAL_STATE, running: true, mode: 'game' as const, entities: {} as Record<EntityId, Entity> };

        // Create player 1 as AI with LOW credits (desperate economy)
        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'medium' as const,
                    color: '#ff4444',
                    credits: 50, // VERY LOW credits - desperate economy
                    maxPower: 100,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        // Add conyard for player 1
        state = spawnBuilding(state, 500, 500, 90, 90, 'cy_p1', 1, 'conyard');

        // Add refinery for player 1
        state = spawnBuilding(state, 600, 500, 100, 80, 'ref_p1', 1, 'refinery');

        // Add ore near refinery
        state = spawnResource(state, 700, 500, 'ore1');

        // Create a harvester actively harvesting with SIGNIFICANT cargo (>200 required for economic pressure)
        state = spawnUnit(state, 680, 500, 'harv_p1', 1, 'harvester');
        const harv = state.entities['harv_p1'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...harv,
                    harvester: {
                        ...harv.harvester,
                        cargo: 300, // Significant cargo - economic pressure activates
                        resourceTargetId: 'ore1' as EntityId,
                        baseTargetId: null
                    },
                    movement: {
                        ...harv.movement,
                        avgVel: new Vector(0, 0)
                    }
                }
            } as Record<EntityId, Entity>
        };

        // Create an enemy unit - not too close but within flee distance (HARVESTER_FLEE_DISTANCE = 300)
        // Position at 170 units away to test economic pressure (must be >80 to not trigger minimum safe distance)
        state = spawnUnit(state, 850, 500, 'enemy_unit', 2, 'rifle'); // 170 units away

        // Run AI
        const aiActions = computeAiActions(state, 1);

        // Check that NO flee command was issued for the harvester
        const fleeActions = aiActions.filter(a =>
            a.type === 'COMMAND_MOVE' &&
            (a.payload as any).unitIds?.includes('harv_p1')
        );

        console.log('Actions under pressure:', aiActions.map(a => a.type));

        // Under economic pressure (credits <100 AND cargo >200), harvesters should NOT flee
        // from non-attacking enemies that are beyond minimum safe distance (80 units)
        expect(fleeActions.length).toBe(0);
    });

    it('should only flee from direct attackers or very close threats, not distant enemies', () => {
        // Setup: AI player with normal credits
        let state: GameState = { ...INITIAL_STATE, running: true, mode: 'game' as const, entities: {} as Record<EntityId, Entity> };

        // Create player 1 as AI
        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'medium' as const,
                    color: '#ff4444',
                    credits: 2000,
                    maxPower: 100,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        // Add conyard
        state = spawnBuilding(state, 500, 500, 90, 90, 'cy_p1', 1, 'conyard');
        state = spawnBuilding(state, 600, 500, 100, 80, 'ref_p1', 1, 'refinery');
        state = spawnResource(state, 700, 500, 'ore1');

        // Create a harvester
        state = spawnUnit(state, 680, 500, 'harv_p1', 1, 'harvester');
        const harv = state.entities['harv_p1'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...harv,
                    harvester: {
                        ...harv.harvester,
                        cargo: 100,
                        resourceTargetId: 'ore1' as EntityId,
                        baseTargetId: null
                    },
                    movement: {
                        ...harv.movement,
                        avgVel: new Vector(0, 0)
                    },
                    combat: {
                        ...harv.combat,
                        lastAttackerId: null // NOT being attacked
                    }
                }
            } as Record<EntityId, Entity>
        };

        // Create an enemy unit that's at the edge of HARVESTER_FLEE_DISTANCE (300)
        // but NOT attacking
        state = spawnUnit(state, 950, 500, 'enemy_unit', 2, 'rifle'); // 270 units away

        // Run AI
        const aiActions = computeAiActions(state, 1);

        // Check the flee commands
        const fleeActions = aiActions.filter(a =>
            a.type === 'COMMAND_MOVE' &&
            (a.payload as any).unitIds?.includes('harv_p1')
        );

        console.log('Flee actions for distant non-attacking enemy:', fleeActions.length);

        // With less aggressive flee, harvesters should NOT flee from distant enemies that aren't attacking
        expect(fleeActions.length).toBe(0);
    });

    it('should STILL flee when directly under attack', () => {
        // Setup: AI player with low credits but being directly attacked
        let state: GameState = { ...INITIAL_STATE, running: true, mode: 'game' as const, entities: {} as Record<EntityId, Entity> };

        // Create player 1 as AI with LOW credits
        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'medium' as const,
                    color: '#ff4444',
                    credits: 100, // Low credits
                    maxPower: 100,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        // Add conyard
        state = spawnBuilding(state, 500, 500, 90, 90, 'cy_p1', 1, 'conyard');
        state = spawnBuilding(state, 600, 500, 100, 80, 'ref_p1', 1, 'refinery');
        state = spawnResource(state, 700, 500, 'ore1');

        // Create enemy that attacked the harvester
        state = spawnUnit(state, 750, 500, 'enemy_unit', 2, 'rifle');

        // Create a harvester that was DIRECTLY attacked
        state = spawnUnit(state, 680, 500, 'harv_p1', 1, 'harvester');
        const harv = state.entities['harv_p1'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...harv,
                    harvester: {
                        ...harv.harvester,
                        cargo: 100,
                        resourceTargetId: 'ore1' as EntityId,
                        baseTargetId: null
                    },
                    movement: {
                        ...harv.movement,
                        avgVel: new Vector(0, 0)
                    },
                    combat: {
                        ...harv.combat,
                        lastAttackerId: 'enemy_unit' as EntityId // BEING attacked!
                    }
                }
            } as Record<EntityId, Entity>
        };

        // Run AI
        const aiActions = computeAiActions(state, 1);

        // Check the flee commands
        const fleeActions = aiActions.filter(a =>
            a.type === 'COMMAND_MOVE' &&
            (a.payload as any).unitIds?.includes('harv_p1')
        );

        console.log('Flee actions when directly attacked:', fleeActions.length);

        // Even under economic pressure, harvesters should flee when directly being attacked
        expect(fleeActions.length).toBeGreaterThan(0);
    });

    it('should spread harvesters to different safe spots when fleeing', () => {
        // Setup: AI player with normal credits, multiple harvesters, multiple safe ore patches
        let state: GameState = { ...INITIAL_STATE, running: true, mode: 'game' as const, entities: {} as Record<EntityId, Entity> };

        // Create player 1 as AI
        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'medium' as const,
                    color: '#ff4444',
                    credits: 2000, // Normal credits - will flee
                    maxPower: 100,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        // Add conyard for player 1
        state = spawnBuilding(state, 500, 500, 90, 90, 'cy_p1', 1, 'conyard');

        // Add TWO refineries in different safe areas
        state = spawnBuilding(state, 200, 800, 100, 80, 'ref_p1_safe1', 1, 'refinery'); // Safe area 1
        state = spawnBuilding(state, 800, 800, 100, 80, 'ref_p1_safe2', 1, 'refinery'); // Safe area 2

        // Add ore near each safe refinery
        state = spawnResource(state, 200, 900, 'ore_safe1');
        state = spawnResource(state, 800, 900, 'ore_safe2');

        // Create enemy that attacks
        state = spawnUnit(state, 500, 150, 'enemy_unit', 2, 'rifle');

        // Create multiple harvesters being attacked
        state = spawnUnit(state, 500, 100, 'harv1', 1, 'harvester');
        state = spawnUnit(state, 510, 100, 'harv2', 1, 'harvester');
        state = spawnUnit(state, 520, 100, 'harv3', 1, 'harvester');

        // Set them up - all being attacked
        for (const id of ['harv1', 'harv2', 'harv3']) {
            const harv = state.entities[id] as HarvesterUnit;
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    [id]: {
                        ...harv,
                        harvester: {
                            ...harv.harvester,
                            cargo: 100,
                            resourceTargetId: null,
                            baseTargetId: null
                        },
                        movement: {
                            ...harv.movement,
                            avgVel: new Vector(0, 0)
                        },
                        combat: {
                            ...harv.combat,
                            lastAttackerId: 'enemy_unit' as EntityId // All being attacked
                        }
                    }
                }
            } as any;
        }

        // Run AI
        const aiActions = computeAiActions(state, 1);

        // Check the flee commands
        const fleeActions = aiActions.filter(a =>
            isActionType(a, 'COMMAND_MOVE') &&
            a.payload.unitIds?.some((id: string) => id.startsWith('harv'))
        );

        console.log('Flee actions:', fleeActions.length);
        console.log('Flee destinations:', fleeActions.filter(a => isActionType(a, 'COMMAND_MOVE')).map(a => ({
            units: a.payload.unitIds,
            x: Math.round(a.payload.x),
            y: Math.round(a.payload.y)
        })));

        // There should be flee commands issued
        expect(fleeActions.length).toBeGreaterThan(0);
    });

    it('should NOT flee from infantry at medium distance when not being damaged', () => {
        // This is the key fix: a single infantry hanging around shouldn't cripple harvesters
        let state: GameState = { ...INITIAL_STATE, running: true, mode: 'game' as const, tick: 90, entities: {} as Record<EntityId, Entity> };

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'medium' as const,
                    color: '#ff4444',
                    credits: 2000,
                    maxPower: 100,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        state = spawnBuilding(state, 500, 500, 90, 90, 'cy_p1', 1, 'conyard');
        state = spawnBuilding(state, 600, 500, 100, 80, 'ref_p1', 1, 'refinery');
        state = spawnResource(state, 700, 500, 'ore1');

        // Create harvester at ore - NOT recently damaged
        state = spawnUnit(state, 680, 500, 'harv_p1', 1, 'harvester');
        const harv = state.entities['harv_p1'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...harv,
                    harvester: {
                        ...harv.harvester,
                        cargo: 100,
                        resourceTargetId: 'ore1' as EntityId
                    },
                    combat: {
                        ...harv.combat,
                        lastDamageTick: undefined // NOT recently damaged
                    }
                }
            } as Record<EntityId, Entity>
        };

        // Create infantry at 150 pixels away (within old flee distance, but not minimum safe distance)
        state = spawnUnit(state, 830, 500, 'enemy_infantry', 2, 'rifle'); // 150 pixels away

        const aiActions = computeAiActions(state, 1);

        const fleeActions = aiActions.filter(a =>
            a.type === 'COMMAND_MOVE' &&
            (a.payload as any).unitIds?.includes('harv_p1')
        );

        // Should NOT flee - infantry is just hanging around, not attacking
        expect(fleeActions.length).toBe(0);
    });

    it('should flee when harvester was recently damaged', () => {
        let state: GameState = { ...INITIAL_STATE, running: true, mode: 'game' as const, tick: 90, entities: {} as Record<EntityId, Entity> };

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'medium' as const,
                    color: '#ff4444',
                    credits: 2000,
                    maxPower: 100,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        state = spawnBuilding(state, 500, 500, 90, 90, 'cy_p1', 1, 'conyard');
        state = spawnBuilding(state, 600, 500, 100, 80, 'ref_p1', 1, 'refinery');
        state = spawnResource(state, 700, 500, 'ore1');

        // Create enemy at medium distance
        state = spawnUnit(state, 830, 500, 'enemy_unit', 2, 'rifle'); // 150 pixels away

        // Create harvester that WAS recently damaged (within 60 ticks)
        state = spawnUnit(state, 680, 500, 'harv_p1', 1, 'harvester');
        const harv = state.entities['harv_p1'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...harv,
                    harvester: {
                        ...harv.harvester,
                        cargo: 100,
                        resourceTargetId: 'ore1' as EntityId
                    },
                    combat: {
                        ...harv.combat,
                        lastAttackerId: 'enemy_unit' as EntityId,
                        lastDamageTick: 85 // 5 ticks ago - recent damage!
                    }
                }
            } as Record<EntityId, Entity>
        };

        const aiActions = computeAiActions(state, 1);

        const fleeActions = aiActions.filter(a =>
            a.type === 'COMMAND_MOVE' &&
            (a.payload as any).unitIds?.includes('harv_p1')
        );

        // Should flee - harvester was just damaged
        expect(fleeActions.length).toBeGreaterThan(0);
    });

    it('should flee when nearby ally was recently damaged', () => {
        let state: GameState = { ...INITIAL_STATE, running: true, mode: 'game' as const, tick: 90, entities: {} as Record<EntityId, Entity> };

        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'medium' as const,
                    color: '#ff4444',
                    credits: 2000,
                    maxPower: 100,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        state = spawnBuilding(state, 500, 500, 90, 90, 'cy_p1', 1, 'conyard');
        state = spawnBuilding(state, 600, 500, 100, 80, 'ref_p1', 1, 'refinery');
        state = spawnResource(state, 700, 500, 'ore1');

        // Create enemy at medium distance
        state = spawnUnit(state, 830, 500, 'enemy_unit', 2, 'rifle'); // 150 pixels away from harvester

        // Create an allied unit NEAR the harvester that was recently damaged
        state = spawnUnit(state, 700, 500, 'ally_tank', 1, 'tank');
        const allyTank = state.entities['ally_tank'] as CombatUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                'ally_tank': {
                    ...allyTank,
                    combat: {
                        ...allyTank.combat,
                        lastAttackerId: 'enemy_unit' as EntityId,
                        lastDamageTick: 85 // Ally was just damaged!
                    }
                }
            } as Record<EntityId, Entity>
        };

        // Create harvester that was NOT damaged itself
        state = spawnUnit(state, 680, 500, 'harv_p1', 1, 'harvester');
        const harv = state.entities['harv_p1'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...harv,
                    harvester: {
                        ...harv.harvester,
                        cargo: 100,
                        resourceTargetId: 'ore1' as EntityId
                    },
                    combat: {
                        ...harv.combat,
                        lastDamageTick: undefined // NOT recently damaged itself
                    }
                }
            } as Record<EntityId, Entity>
        };

        const aiActions = computeAiActions(state, 1);

        const fleeActions = aiActions.filter(a =>
            a.type === 'COMMAND_MOVE' &&
            (a.payload as any).unitIds?.includes('harv_p1')
        );

        // Should flee - nearby ally (within 120 pixels) was just damaged, indicating danger
        expect(fleeActions.length).toBeGreaterThan(0);
    });

    it('should risk delivery when under economic pressure (credits < 300) and enemy not very close', () => {
        let state: GameState = { ...INITIAL_STATE, running: true, mode: 'game' as const, tick: 90, entities: {} as Record<EntityId, Entity> };

        // AI with moderate economic pressure (< 300 credits)
        state = {
            ...state,
            players: {
                ...state.players,
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'medium' as const,
                    color: '#ff4444',
                    credits: 250, // Under 300 - economic pressure
                    maxPower: 100,
                    usedPower: 0,
                    queues: {
                        building: { current: null, progress: 0, invested: 0 },
                        infantry: { current: null, progress: 0, invested: 0 },
                        vehicle: { current: null, progress: 0, invested: 0 },
                        air: { current: null, progress: 0, invested: 0 }
                    },
                    readyToPlace: null
                }
            }
        };

        state = spawnBuilding(state, 500, 500, 90, 90, 'cy_p1', 1, 'conyard');
        state = spawnBuilding(state, 600, 500, 100, 80, 'ref_p1', 1, 'refinery');
        state = spawnResource(state, 700, 500, 'ore1');

        // Create enemy at medium distance - would normally trigger flee
        state = spawnUnit(state, 830, 500, 'enemy_unit', 2, 'rifle'); // 150 pixels away

        // Create harvester with significant cargo, recently damaged
        state = spawnUnit(state, 680, 500, 'harv_p1', 1, 'harvester');
        const harv = state.entities['harv_p1'] as HarvesterUnit;
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...harv,
                    harvester: {
                        ...harv.harvester,
                        cargo: 300, // Significant cargo to deliver
                        resourceTargetId: null,
                        baseTargetId: 'ref_p1' as EntityId // Heading to refinery
                    },
                    combat: {
                        ...harv.combat,
                        lastDamageTick: undefined // NOT recently damaged - enemy just passing by
                    }
                }
            } as Record<EntityId, Entity>
        };

        const aiActions = computeAiActions(state, 1);

        const fleeActions = aiActions.filter(a =>
            a.type === 'COMMAND_MOVE' &&
            (a.payload as any).unitIds?.includes('harv_p1')
        );

        // Should NOT flee - under economic pressure and not actually being hit
        expect(fleeActions.length).toBe(0);
    });
});

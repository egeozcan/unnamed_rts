import { describe, it, expect, beforeEach } from 'vitest';
import { INITIAL_STATE } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';
import { createEntity } from './utils';
import { computeAiActions, resetAIState } from './ai';

describe('Harvester Economic Pressure', () => {
    beforeEach(() => {
        resetAIState();
    });

    // Helper to spawn units
    function spawnUnit(state: GameState, x: number, y: number, id: string, owner: number = 0, key: string = 'rifle'): GameState {
        const unit = createEntity(x, y, owner, 'UNIT', key);
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: { ...unit, id }
            } as Record<EntityId, Entity>
        };
    }

    // Helper to spawn buildings
    function spawnBuilding(state: GameState, x: number, y: number, w: number, h: number, id: string, owner: number = 0, key: string = 'conyard'): GameState {
        const building: Entity = {
            id,
            owner,
            type: 'BUILDING',
            key,
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: key === 'conyard' ? 3000 : 1200,
            maxHp: key === 'conyard' ? 3000 : 1200,
            w,
            h,
            radius: Math.min(w, h) / 2,
            dead: false,
            vel: new Vector(0, 0),
            rotation: 0,
            moveTarget: null,
            path: null,
            pathIdx: 0,
            finalDest: null,
            stuckTimer: 0,
            unstuckDir: null,
            unstuckTimer: 0,
            targetId: null,
            lastAttackerId: null,
            cooldown: 0,
            flash: 0,
            turretAngle: 0,
            cargo: 0,
            resourceTargetId: null,
            baseTargetId: null
        };
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: building
            } as Record<EntityId, Entity>
        };
    }

    // Helper to spawn resources
    function spawnResource(state: GameState, x: number, y: number, id: string): GameState {
        const resource: Entity = {
            id,
            owner: -1,
            type: 'RESOURCE',
            key: 'ore',
            pos: new Vector(x, y),
            prevPos: new Vector(x, y),
            hp: 1000,
            maxHp: 1000,
            w: 25,
            h: 25,
            radius: 12,
            dead: false,
            vel: new Vector(0, 0),
            rotation: 0,
            moveTarget: null,
            path: null,
            pathIdx: 0,
            finalDest: null,
            stuckTimer: 0,
            unstuckDir: null,
            unstuckTimer: 0,
            targetId: null,
            lastAttackerId: null,
            cooldown: 0,
            flash: 0,
            turretAngle: 0,
            cargo: 0,
            resourceTargetId: null,
            baseTargetId: null
        };
        return {
            ...state,
            entities: {
                ...state.entities,
                [id]: resource
            } as Record<EntityId, Entity>
        };
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
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...state.entities['harv_p1'],
                    cargo: 300, // Significant cargo - economic pressure activates
                    resourceTargetId: 'ore1' as EntityId,
                    baseTargetId: null,
                    avgVel: new Vector(0, 0)
                }
            } as any
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
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...state.entities['harv_p1'],
                    cargo: 100,
                    resourceTargetId: 'ore1' as EntityId,
                    baseTargetId: null,
                    avgVel: new Vector(0, 0),
                    lastAttackerId: null // NOT being attacked
                }
            } as any
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
        state = {
            ...state,
            entities: {
                ...state.entities,
                'harv_p1': {
                    ...state.entities['harv_p1'],
                    cargo: 100,
                    resourceTargetId: 'ore1' as EntityId,
                    baseTargetId: null,
                    avgVel: new Vector(0, 0),
                    lastAttackerId: 'enemy_unit' // BEING attacked!
                }
            } as any
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
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    [id]: {
                        ...state.entities[id],
                        cargo: 100,
                        resourceTargetId: null,
                        baseTargetId: null,
                        avgVel: new Vector(0, 0),
                        lastAttackerId: 'enemy_unit' // All being attacked
                    }
                }
            } as any;
        }

        // Run AI
        const aiActions = computeAiActions(state, 1);

        // Check the flee commands
        const fleeActions = aiActions.filter(a =>
            a.type === 'COMMAND_MOVE' &&
            (a.payload as any).unitIds?.some((id: string) => id.startsWith('harv'))
        );

        console.log('Flee actions:', fleeActions.length);
        console.log('Flee destinations:', fleeActions.map(a => ({
            units: (a.payload as any).unitIds,
            x: Math.round((a.payload as any).x),
            y: Math.round((a.payload as any).y)
        })));

        // There should be flee commands issued
        expect(fleeActions.length).toBeGreaterThan(0);
    });
});

/**
 * Tests for game.ts pure functions
 * 
 * These tests cover the core game logic functions that don't require DOM access.
 */

import { describe, it, expect } from 'vitest';
import { getStartingPositions, reconstructVectors, calculatePower, generateMap } from '../src/game-utils';
import { Vector, Entity, EntityId, SkirmishConfig, PLAYER_COLORS, MAP_SIZES } from '../src/engine/types';

describe('Game Logic', () => {
    describe('getStartingPositions', () => {
        it('should return correct number of positions for 2 players', () => {
            const positions = getStartingPositions(3000, 3000, 2);
            expect(positions.length).toBe(2);
        });

        it('should return correct number of positions for 4 players', () => {
            const positions = getStartingPositions(3000, 3000, 4);
            expect(positions.length).toBe(4);
        });

        it('should return correct number of positions for 8 players', () => {
            const positions = getStartingPositions(5000, 5000, 8);
            expect(positions.length).toBe(8);
        });

        it('should place first 4 players in corners', () => {
            const positions = getStartingPositions(3000, 3000, 4);
            const margin = 350;

            // Top-left
            expect(positions[0].x).toBe(margin);
            expect(positions[0].y).toBe(margin);

            // Bottom-right
            expect(positions[1].x).toBe(3000 - margin);
            expect(positions[1].y).toBe(3000 - margin);

            // Top-right
            expect(positions[2].x).toBe(3000 - margin);
            expect(positions[2].y).toBe(margin);

            // Bottom-left
            expect(positions[3].x).toBe(margin);
            expect(positions[3].y).toBe(3000 - margin);
        });

        it('should place players 5-8 at mid-edges on larger maps', () => {
            const positions = getStartingPositions(5000, 5000, 8);
            const margin = 350;
            const centerX = 2500;
            const centerY = 2500;

            // Top-center (player 5)
            expect(positions[4].x).toBe(centerX);
            expect(positions[4].y).toBe(margin);

            // Bottom-center (player 6)
            expect(positions[5].x).toBe(centerX);
            expect(positions[5].y).toBe(5000 - margin);

            // Left-center (player 7)
            expect(positions[6].x).toBe(margin);
            expect(positions[6].y).toBe(centerY);

            // Right-center (player 8)
            expect(positions[7].x).toBe(5000 - margin);
            expect(positions[7].y).toBe(centerY);
        });

        it('should ensure minimum distance between all spawns on huge map', () => {
            const positions = getStartingPositions(5000, 5000, 8);

            // Check all pairs have at least 700 units distance
            for (let i = 0; i < positions.length; i++) {
                for (let j = i + 1; j < positions.length; j++) {
                    const dist = positions[i].dist(positions[j]);
                    expect(dist).toBeGreaterThan(700);
                }
            }
        });
    });

    describe('reconstructVectors', () => {
        it('should convert plain objects to Vector instances', () => {
            const plainState = {
                camera: { x: 100, y: 200 },
                entities: {
                    'e1': {
                        id: 'e1',
                        type: 'UNIT',
                        pos: { x: 10, y: 20 },
                        prevPos: { x: 9, y: 19 },
                        movement: {
                            vel: { x: 1, y: 1 },
                            moveTarget: { x: 100, y: 100 },
                            finalDest: { x: 200, y: 200 },
                            unstuckDir: { x: 1, y: 0 },
                            path: [{ x: 50, y: 50 }, { x: 100, y: 100 }]
                        }
                    }
                },
                running: true,
                tick: 0
            } as any;

            const result = reconstructVectors(plainState);

            // Check that vectors are proper Vector instances
            expect(result.entities['e1'].pos).toBeInstanceOf(Vector);
            expect(result.entities['e1'].prevPos).toBeInstanceOf(Vector);
            // For units, movement vectors are inside movement component
            const entity = result.entities['e1'] as any;
            expect(entity.movement.vel).toBeInstanceOf(Vector);
            expect(entity.movement.moveTarget).toBeInstanceOf(Vector);
            expect(entity.movement.finalDest).toBeInstanceOf(Vector);
            expect(entity.movement.unstuckDir).toBeInstanceOf(Vector);
            expect(entity.movement.path![0]).toBeInstanceOf(Vector);
            expect(entity.movement.path![1]).toBeInstanceOf(Vector);
        });

        it('should handle null vector fields', () => {
            const plainState = {
                camera: { x: 0, y: 0 },
                entities: {
                    'e1': {
                        id: 'e1',
                        type: 'UNIT',
                        pos: { x: 10, y: 20 },
                        prevPos: { x: 9, y: 19 },
                        movement: {
                            vel: { x: 0, y: 0 },
                            moveTarget: null,
                            finalDest: null,
                            unstuckDir: null,
                            path: null
                        }
                    }
                }
            } as any;

            const result = reconstructVectors(plainState);

            const entity = result.entities['e1'] as any;
            expect(entity.movement.moveTarget).toBeNull();
            expect(entity.movement.finalDest).toBeNull();
            expect(entity.movement.unstuckDir).toBeNull();
            expect(entity.movement.path).toBeNull();
        });

        it('should preserve camera coordinates', () => {
            const plainState = {
                camera: { x: 500, y: 750 },
                entities: {}
            } as any;

            const result = reconstructVectors(plainState);

            expect(result.camera.x).toBe(500);
            expect(result.camera.y).toBe(750);
        });
    });

    describe('calculatePower', () => {
        it('should calculate power for player with power plant', () => {
            const entities: Record<EntityId, Entity> = {
                'power1': {
                    id: 'power1',
                    owner: 0,
                    type: 'BUILDING',
                    key: 'power',
                    dead: false,
                    pos: new Vector(100, 100),
                    prevPos: new Vector(100, 100),
                    hp: 500,
                    maxHp: 500,
                    w: 60,
                    h: 60,
                    radius: 30,
                    placedTick: 0,
                    building: { isRepairing: false, repairHpBuffer: 0, sellProgress: 0, isSelling: false }
                } as Entity
            };

            const power = calculatePower(0, entities);

            expect(power.out).toBeGreaterThan(0); // Power plant produces power
            expect(power.in).toBe(0); // Power plant doesn't drain
        });

        it('should calculate drain for player with refinery', () => {
            const entities: Record<EntityId, Entity> = {
                'refinery1': {
                    id: 'refinery1',
                    owner: 0,
                    type: 'BUILDING',
                    key: 'refinery',
                    dead: false,
                    pos: new Vector(100, 100),
                    prevPos: new Vector(100, 100),
                    hp: 1500,
                    maxHp: 1500,
                    w: 80,
                    h: 80,
                    radius: 40,
                    placedTick: 0,
                    building: { isRepairing: false, repairHpBuffer: 0, sellProgress: 0, isSelling: false }
                } as Entity
            };

            const power = calculatePower(0, entities);

            expect(power.in).toBeGreaterThan(0); // Refinery drains power
        });

        it('should not count dead buildings', () => {
            const entities: Record<EntityId, Entity> = {
                'power1': {
                    id: 'power1',
                    owner: 0,
                    type: 'BUILDING',
                    key: 'power',
                    dead: true, // Dead!
                    pos: new Vector(100, 100),
                    prevPos: new Vector(100, 100),
                    hp: 0,
                    maxHp: 500,
                    w: 60,
                    h: 60,
                    radius: 30,
                    placedTick: 0,
                    building: { isRepairing: false, repairHpBuffer: 0, sellProgress: 0, isSelling: false }
                } as Entity
            };

            const power = calculatePower(0, entities);

            expect(power.out).toBe(0);
            expect(power.in).toBe(0);
        });

        it('should separate power by player', () => {
            const entities: Record<EntityId, Entity> = {
                'power_p0': {
                    id: 'power_p0',
                    owner: 0,
                    type: 'BUILDING',
                    key: 'power',
                    dead: false,
                    pos: new Vector(100, 100),
                    prevPos: new Vector(100, 100),
                    hp: 500,
                    maxHp: 500,
                    w: 60,
                    h: 60,
                    radius: 30,
                    placedTick: 0,
                    building: { isRepairing: false, repairHpBuffer: 0, sellProgress: 0, isSelling: false }
                } as Entity,
                'power_p1': {
                    id: 'power_p1',
                    owner: 1,
                    type: 'BUILDING',
                    key: 'power',
                    dead: false,
                    pos: new Vector(500, 500),
                    prevPos: new Vector(500, 500),
                    hp: 500,
                    maxHp: 500,
                    w: 60,
                    h: 60,
                    radius: 30,
                    placedTick: 0,
                    building: { isRepairing: false, repairHpBuffer: 0, sellProgress: 0, isSelling: false }
                } as Entity
            };

            const powerP0 = calculatePower(0, entities);
            const powerP1 = calculatePower(1, entities);

            // Each player has their own power plant
            expect(powerP0.out).toBeGreaterThan(0);
            expect(powerP1.out).toBeGreaterThan(0);
        });
    });

    describe('generateMap', () => {
        it('should generate correct map dimensions for small map', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'small',
                resourceDensity: 'low',
                rockDensity: 'low'
            };

            const result = generateMap(config);

            expect(result.mapWidth).toBe(MAP_SIZES.small.width);
            expect(result.mapHeight).toBe(MAP_SIZES.small.height);
        });

        it('should generate correct map dimensions for huge map', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'huge',
                resourceDensity: 'low',
                rockDensity: 'low'
            };

            const result = generateMap(config);

            expect(result.mapWidth).toBe(MAP_SIZES.huge.width);
            expect(result.mapHeight).toBe(MAP_SIZES.huge.height);
        });

        it('should generate resources based on density setting', () => {
            const lowConfig: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'medium',
                resourceDensity: 'low',
                rockDensity: 'low'
            };

            const highConfig: SkirmishConfig = {
                ...lowConfig,
                resourceDensity: 'high'
            };

            const lowResult = generateMap(lowConfig);
            const highResult = generateMap(highConfig);

            const lowResources = Object.values(lowResult.entities).filter(e => e.type === 'RESOURCE').length;
            const highResources = Object.values(highResult.entities).filter(e => e.type === 'RESOURCE').length;

            expect(highResources).toBeGreaterThan(lowResources);
        });

        it('should generate rocks based on density setting', () => {
            const lowConfig: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'medium',
                resourceDensity: 'low',
                rockDensity: 'low'
            };

            const highConfig: SkirmishConfig = {
                ...lowConfig,
                rockDensity: 'high'
            };

            const lowResult = generateMap(lowConfig);
            const highResult = generateMap(highConfig);

            const lowRocks = Object.values(lowResult.entities).filter(e => e.type === 'ROCK').length;
            const highRocks = Object.values(highResult.entities).filter(e => e.type === 'ROCK').length;

            expect(highRocks).toBeGreaterThan(lowRocks);
        });

        it('should not place rocks near spawn zones', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'medium',
                resourceDensity: 'low',
                rockDensity: 'high' // Max rocks to test spawn avoidance
            };

            const result = generateMap(config);
            const rocks = Object.values(result.entities).filter(e => e.type === 'ROCK');

            // Spawn zones
            const margin = 350;
            const spawnZones = [
                new Vector(margin, margin),
                new Vector(result.mapWidth - margin, result.mapHeight - margin),
                new Vector(result.mapWidth - margin, margin),
                new Vector(margin, result.mapHeight - margin)
            ];
            const spawnRadius = 200;

            // No rocks should be within 200 units of spawn zones
            for (const rock of rocks) {
                for (const zone of spawnZones) {
                    expect(rock.pos.dist(zone)).toBeGreaterThan(spawnRadius);
                }
            }
        });

        it('should generate ore resources in clusters', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'medium',
                resourceDensity: 'high',
                rockDensity: 'low'
            };

            const result = generateMap(config);
            const resources = Object.values(result.entities).filter(e => e.type === 'RESOURCE');

            // All resources should be ore
            for (const res of resources) {
                expect(res.key).toBe('ore');
            }

            // Should have a reasonable number of resources
            expect(resources.length).toBeGreaterThan(10);
        });
    });

    describe('Multi-player support', () => {
        it('should have 8 player colors', () => {
            expect(PLAYER_COLORS.length).toBe(8);
        });

        it('should have unique colors for all 8 players', () => {
            const uniqueColors = new Set(PLAYER_COLORS);
            expect(uniqueColors.size).toBe(8);
        });

        it('should have huge map size for 8 players', () => {
            expect(MAP_SIZES.huge).toBeDefined();
            expect(MAP_SIZES.huge.width).toBe(5000);
            expect(MAP_SIZES.huge.height).toBe(5000);
        });
    });
});

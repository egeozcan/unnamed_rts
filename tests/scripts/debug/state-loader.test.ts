import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Vector, GameState } from '../../../src/engine/types.js';
import {
    rehydrateVectors,
    loadState,
    saveState
} from '../../../src/scripts/debug/state-loader.js';

describe('rehydrateVectors', () => {
    describe('primitive values', () => {
        it('returns null as-is', () => {
            expect(rehydrateVectors(null)).toBe(null);
        });

        it('returns undefined as-is', () => {
            expect(rehydrateVectors(undefined)).toBe(undefined);
        });

        it('returns numbers as-is', () => {
            expect(rehydrateVectors(42)).toBe(42);
            expect(rehydrateVectors(3.14)).toBe(3.14);
        });

        it('returns strings as-is', () => {
            expect(rehydrateVectors('hello')).toBe('hello');
        });

        it('returns booleans as-is', () => {
            expect(rehydrateVectors(true)).toBe(true);
            expect(rehydrateVectors(false)).toBe(false);
        });
    });

    describe('Vector conversion', () => {
        it('converts plain {x, y} object to Vector instance', () => {
            const result = rehydrateVectors({ x: 10, y: 20 });

            expect(result).toBeInstanceOf(Vector);
            expect((result as Vector).x).toBe(10);
            expect((result as Vector).y).toBe(20);
        });

        it('converts {x, y} with decimal values to Vector', () => {
            const result = rehydrateVectors({ x: 10.5, y: 20.75 });

            expect(result).toBeInstanceOf(Vector);
            expect((result as Vector).x).toBe(10.5);
            expect((result as Vector).y).toBe(20.75);
        });

        it('does NOT convert objects with extra properties to Vector', () => {
            const obj = { x: 10, y: 20, z: 30 };
            const result = rehydrateVectors(obj);

            expect(result).not.toBeInstanceOf(Vector);
            expect(result).toEqual({ x: 10, y: 20, z: 30 });
        });

        it('does NOT convert objects with non-numeric x/y to Vector', () => {
            const obj = { x: '10', y: 20 };
            const result = rehydrateVectors(obj);

            expect(result).not.toBeInstanceOf(Vector);
            expect(result).toEqual({ x: '10', y: 20 });
        });

        it('does NOT convert objects with only x to Vector', () => {
            const obj = { x: 10 };
            const result = rehydrateVectors(obj);

            expect(result).not.toBeInstanceOf(Vector);
            expect(result).toEqual({ x: 10 });
        });
    });

    describe('nested objects', () => {
        it('recursively converts nested {x, y} objects to Vectors', () => {
            const obj = {
                pos: { x: 100, y: 200 },
                prevPos: { x: 90, y: 190 }
            };

            const result = rehydrateVectors(obj) as { pos: Vector; prevPos: Vector };

            expect(result.pos).toBeInstanceOf(Vector);
            expect(result.pos.x).toBe(100);
            expect(result.pos.y).toBe(200);
            expect(result.prevPos).toBeInstanceOf(Vector);
            expect(result.prevPos.x).toBe(90);
            expect(result.prevPos.y).toBe(190);
        });

        it('handles deeply nested objects', () => {
            const obj = {
                entities: {
                    'unit-1': {
                        pos: { x: 10, y: 20 },
                        movement: {
                            velocity: { x: 1, y: 2 }
                        }
                    }
                }
            };

            const result = rehydrateVectors(obj) as {
                entities: {
                    'unit-1': {
                        pos: Vector;
                        movement: { velocity: Vector };
                    };
                };
            };

            expect(result.entities['unit-1'].pos).toBeInstanceOf(Vector);
            expect(result.entities['unit-1'].movement.velocity).toBeInstanceOf(Vector);
        });

        it('preserves non-vector properties', () => {
            const obj = {
                id: 'unit-1',
                hp: 100,
                pos: { x: 10, y: 20 }
            };

            const result = rehydrateVectors(obj) as { id: string; hp: number; pos: Vector };

            expect(result.id).toBe('unit-1');
            expect(result.hp).toBe(100);
            expect(result.pos).toBeInstanceOf(Vector);
        });
    });

    describe('arrays', () => {
        it('converts {x, y} objects within arrays to Vectors', () => {
            const arr = [
                { x: 10, y: 20 },
                { x: 30, y: 40 }
            ];

            const result = rehydrateVectors(arr) as Vector[];

            expect(result[0]).toBeInstanceOf(Vector);
            expect(result[0].x).toBe(10);
            expect(result[1]).toBeInstanceOf(Vector);
            expect(result[1].x).toBe(30);
        });

        it('handles arrays of mixed content', () => {
            const arr = [
                42,
                'string',
                { x: 10, y: 20 },
                { name: 'test' }
            ];

            const result = rehydrateVectors(arr) as unknown[];

            expect(result[0]).toBe(42);
            expect(result[1]).toBe('string');
            expect(result[2]).toBeInstanceOf(Vector);
            expect(result[3]).toEqual({ name: 'test' });
        });

        it('handles nested arrays', () => {
            const arr = [
                [{ x: 1, y: 2 }],
                [{ x: 3, y: 4 }]
            ];

            const result = rehydrateVectors(arr) as Vector[][];

            expect(result[0][0]).toBeInstanceOf(Vector);
            expect(result[1][0]).toBeInstanceOf(Vector);
        });
    });
});

describe('loadState and saveState', () => {
    let tempDir: string;
    let tempFile: string;

    beforeAll(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-loader-test-'));
        tempFile = path.join(tempDir, 'test-state.json');
    });

    afterAll(() => {
        // Clean up temp files
        if (fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
        if (fs.existsSync(tempDir)) {
            fs.rmdirSync(tempDir);
        }
    });

    describe('saveState', () => {
        it('saves state to JSON file', () => {
            const mockState = createMockState();

            saveState(mockState, tempFile);

            expect(fs.existsSync(tempFile)).toBe(true);
            const content = fs.readFileSync(tempFile, 'utf8');
            const parsed = JSON.parse(content);
            expect(parsed.tick).toBe(100);
        });

        it('creates parent directories if they do not exist', () => {
            const nestedPath = path.join(tempDir, 'nested', 'dir', 'state.json');
            const mockState = createMockState();

            saveState(mockState, nestedPath);

            expect(fs.existsSync(nestedPath)).toBe(true);

            // Clean up nested directories
            fs.unlinkSync(nestedPath);
            fs.rmdirSync(path.join(tempDir, 'nested', 'dir'));
            fs.rmdirSync(path.join(tempDir, 'nested'));
        });

        it('overwrites existing file', () => {
            const mockState1 = createMockState({ tick: 100 });
            const mockState2 = createMockState({ tick: 200 });

            saveState(mockState1, tempFile);
            saveState(mockState2, tempFile);

            const content = fs.readFileSync(tempFile, 'utf8');
            const parsed = JSON.parse(content);
            expect(parsed.tick).toBe(200);
        });
    });

    describe('loadState', () => {
        it('loads state from JSON file', () => {
            const mockState = createMockState();
            saveState(mockState, tempFile);

            const loaded = loadState(tempFile);

            expect(loaded.tick).toBe(100);
            expect(loaded.running).toBe(true);
        });

        it('throws error if file does not exist', () => {
            const nonExistentPath = path.join(tempDir, 'non-existent.json');

            expect(() => loadState(nonExistentPath)).toThrow(/not found|does not exist/i);
        });

        it('rehydrates vectors in loaded state', () => {
            const mockState = createMockState();
            saveState(mockState, tempFile);

            const loaded = loadState(tempFile);

            // Check that entity positions are Vector instances
            const entity = loaded.entities['unit-1'];
            expect(entity.pos).toBeInstanceOf(Vector);
            expect(entity.pos.x).toBe(100);
            expect(entity.pos.y).toBe(200);
            expect(entity.prevPos).toBeInstanceOf(Vector);
        });

        it('rehydrates nested vectors in components', () => {
            const mockState = createMockState();
            saveState(mockState, tempFile);

            const loaded = loadState(tempFile);

            const unit = loaded.entities['unit-1'] as { movement?: { velocity: Vector } };
            if (unit.movement) {
                expect(unit.movement.velocity).toBeInstanceOf(Vector);
            }
        });

        it('rehydrates vectors in camera', () => {
            const mockState = createMockState();
            saveState(mockState, tempFile);

            const loaded = loadState(tempFile);

            // Camera has x, y but they're separate numbers, not a vector
            expect(loaded.camera.x).toBe(0);
            expect(loaded.camera.y).toBe(0);
        });

        it('rehydrates vectors in projectiles', () => {
            const mockState = createMockStateWithProjectiles();
            saveState(mockState, tempFile);

            const loaded = loadState(tempFile);

            expect(loaded.projectiles[0].pos).toBeInstanceOf(Vector);
            expect(loaded.projectiles[0].vel).toBeInstanceOf(Vector);
        });
    });

    describe('round-trip', () => {
        it('preserves all data through save and load cycle', () => {
            const originalState = createMockState({
                tick: 12345,
                running: false,
                mode: 'demo',
                debugMode: true
            });

            saveState(originalState, tempFile);
            const loadedState = loadState(tempFile);

            expect(loadedState.tick).toBe(12345);
            expect(loadedState.running).toBe(false);
            expect(loadedState.mode).toBe('demo');
            expect(loadedState.debugMode).toBe(true);
        });

        it('Vector methods work after rehydration', () => {
            const mockState = createMockState();
            saveState(mockState, tempFile);

            const loaded = loadState(tempFile);

            const entity = loaded.entities['unit-1'];
            const pos = entity.pos;

            // Test Vector methods
            expect(pos.mag()).toBeGreaterThan(0);
            expect(pos.add(new Vector(10, 10))).toBeInstanceOf(Vector);
            expect(pos.sub(new Vector(10, 10))).toBeInstanceOf(Vector);
            expect(pos.norm()).toBeInstanceOf(Vector);
            expect(pos.scale(2)).toBeInstanceOf(Vector);
            expect(pos.dist(new Vector(0, 0))).toBeGreaterThan(0);
        });
    });
});

// Helper to create mock GameState for testing
function createMockState(overrides: Partial<GameState> = {}): GameState {
    return {
        running: true,
        mode: 'game',
        sellMode: false,
        repairMode: false,
        difficulty: 'easy',
        tick: 100,
        camera: { x: 0, y: 0 },
        zoom: 1,
        entities: {
            'unit-1': {
                id: 'unit-1',
                type: 'UNIT',
                key: 'rifle',
                owner: 1,
                pos: new Vector(100, 200),
                prevPos: new Vector(90, 190),
                hp: 100,
                maxHp: 100,
                w: 20,
                h: 20,
                radius: 10,
                dead: false,
                movement: {
                    velocity: new Vector(1, 0),
                    maxSpeed: 2,
                    rotation: 0,
                    targetRotation: 0,
                    rotationSpeed: 0.1,
                    path: [],
                    destination: null,
                    stuck: false,
                    stuckTicks: 0,
                    intendedVelocity: new Vector(1, 0),
                    lastRecalc: 0
                },
                combat: {
                    targetId: null,
                    cooldown: 0,
                    turretAngle: 0,
                    turretTargetAngle: 0,
                    stance: 'aggressive'
                }
            }
        },
        projectiles: [],
        particles: [],
        selection: [],
        placingBuilding: null,
        players: {
            1: {
                id: 1,
                isAi: false,
                difficulty: 'easy',
                color: '#ff0000',
                credits: 5000,
                maxPower: 100,
                usedPower: 50,
                queues: {
                    building: { current: null, progress: 0, invested: 0 },
                    infantry: { current: null, progress: 0, invested: 0 },
                    vehicle: { current: null, progress: 0, invested: 0 },
                    air: { current: null, progress: 0, invested: 0 }
                },
                readyToPlace: null
            }
        },
        winner: null,
        config: {
            width: 2000,
            height: 2000,
            resourceDensity: 'medium',
            rockDensity: 'medium'
        },
        debugMode: false,
        showMinimap: true,
        showBirdsEye: false,
        attackMoveMode: false,
        ...overrides
    };
}

function createMockStateWithProjectiles(): GameState {
    const state = createMockState();
    return {
        ...state,
        projectiles: [
            {
                ownerId: 'unit-1',
                pos: new Vector(50, 60),
                vel: new Vector(5, 0),
                targetId: 'unit-2',
                speed: 5,
                damage: 10,
                splash: 0,
                type: 'bullet',
                dead: false
            }
        ]
    };
}

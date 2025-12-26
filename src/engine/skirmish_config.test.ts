import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, createPlayerState } from './reducer';
import { GameState, Vector, Entity, EntityId, SkirmishConfig, PLAYER_COLORS, MAP_SIZES, DENSITY_SETTINGS } from './types';

// Helper to create a basic skirmish config
function createSkirmishConfig(numPlayers: number, mapSize: 'small' | 'medium' | 'large' = 'medium'): SkirmishConfig {
    const playerTypes: Array<'human' | 'easy' | 'medium' | 'hard'> = ['human', 'medium', 'easy', 'hard'];
    const players = [];
    for (let i = 0; i < numPlayers; i++) {
        players.push({
            slot: i,
            type: i === 0 ? 'human' as const : playerTypes[i] as 'easy' | 'medium' | 'hard',
            color: PLAYER_COLORS[i]
        });
    }
    return {
        players,
        mapSize,
        resourceDensity: 'medium',
        rockDensity: 'medium'
    };
}

// Get starting positions (matching game.ts logic)
function getStartingPositions(mapWidth: number, mapHeight: number, numPlayers: number): Vector[] {
    const margin = 350;
    const positions = [
        new Vector(margin, margin),
        new Vector(mapWidth - margin, mapHeight - margin),
        new Vector(mapWidth - margin, margin),
        new Vector(margin, mapHeight - margin)
    ];
    return positions.slice(0, numPlayers);
}

// Generate map entities (simplified version for testing)
function generateMapForTest(config: SkirmishConfig): { entities: Record<EntityId, Entity>, mapWidth: number, mapHeight: number } {
    const entities: Record<EntityId, Entity> = {};
    const mapDims = MAP_SIZES[config.mapSize];
    const { width: mapWidth, height: mapHeight } = mapDims;
    const density = DENSITY_SETTINGS[config.resourceDensity];
    const rockSettings = DENSITY_SETTINGS[config.rockDensity];

    // Generate resources in the middle area of the map
    const resourceCount = density.resources;
    for (let i = 0; i < resourceCount; i++) {
        const x = 400 + Math.random() * (mapWidth - 800);
        const y = 400 + Math.random() * (mapHeight - 800);
        const id = 'res_' + i;
        entities[id] = {
            id, owner: -1, type: 'RESOURCE', key: 'ore',
            pos: new Vector(x, y), prevPos: new Vector(x, y),
            hp: 1000, maxHp: 1000, w: 25, h: 25, radius: 12, dead: false,
            vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
            targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
        };
    }

    // Generate rocks
    const rockCount = rockSettings.rocks;
    for (let i = 0; i < rockCount; i++) {
        const x = 300 + Math.random() * (mapWidth - 600);
        const y = 300 + Math.random() * (mapHeight - 600);
        const size = 30 + Math.random() * 40;
        const id = 'rock_' + i;
        entities[id] = {
            id, owner: -1, type: 'ROCK', key: 'rock',
            pos: new Vector(x, y), prevPos: new Vector(x, y),
            hp: 9999, maxHp: 9999, w: size, h: size, radius: size / 2, dead: false,
            vel: new Vector(0, 0), rotation: Math.random() * Math.PI * 2, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
            targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
        };
    }

    return { entities, mapWidth, mapHeight };
}

// Create a full game state from skirmish config
function createGameFromSkirmishConfig(config: SkirmishConfig): GameState {
    const { entities, mapWidth, mapHeight } = generateMapForTest(config);

    // Create player states
    const players: Record<number, any> = {};
    config.players.forEach(p => {
        const isAi = p.type !== 'human';
        const difficulty = (p.type === 'human' ? 'medium' : p.type) as 'easy' | 'medium' | 'hard';
        players[p.slot] = createPlayerState(p.slot, isAi, difficulty, p.color);
    });

    // Get starting positions
    const positions = getStartingPositions(mapWidth, mapHeight, config.players.length);

    // Create base entities for each player
    config.players.forEach((p, idx) => {
        const pos = positions[idx];

        // Construction Yard
        const cyId = `cy_p${p.slot}`;
        entities[cyId] = {
            id: cyId, owner: p.slot, type: 'BUILDING', key: 'conyard',
            pos: pos, prevPos: pos,
            hp: 3000, maxHp: 3000, w: 90, h: 90, radius: 45, dead: false,
            vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
            targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
        };

        // Harvester
        const harvId = `harv_p${p.slot}`;
        const harvPos = pos.add(new Vector(80, 50));
        entities[harvId] = {
            id: harvId, owner: p.slot, type: 'UNIT', key: 'harvester',
            pos: harvPos, prevPos: harvPos,
            hp: 1000, maxHp: 1000, w: 35, h: 35, radius: 17, dead: false,
            vel: new Vector(0, 0), rotation: 0, moveTarget: null, path: null, pathIdx: 0, finalDest: null, stuckTimer: 0, unstuckDir: null, unstuckTimer: 0,
            targetId: null, lastAttackerId: null, cooldown: 0, flash: 0, turretAngle: 0, cargo: 0, resourceTargetId: null, baseTargetId: null
        };
    });

    const isObserverMode = !config.players.some(p => p.type === 'human');

    return {
        ...INITIAL_STATE,
        running: true,
        mode: isObserverMode ? 'demo' : 'game',
        difficulty: 'easy',
        entities: entities,
        players: players,
        config: {
            width: mapWidth,
            height: mapHeight,
            resourceDensity: config.resourceDensity,
            rockDensity: config.rockDensity
        }
    };
}

describe('Skirmish Configuration', () => {
    describe('Player Creation', () => {
        it('should create correct number of players from config', () => {
            const config = createSkirmishConfig(4);
            const state = createGameFromSkirmishConfig(config);

            expect(Object.keys(state.players).length).toBe(4);
            expect(state.players[0]).toBeDefined();
            expect(state.players[1]).toBeDefined();
            expect(state.players[2]).toBeDefined();
            expect(state.players[3]).toBeDefined();
        });

        it('should correctly assign player types and difficulty', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'easy', color: PLAYER_COLORS[1] },
                    { slot: 2, type: 'medium', color: PLAYER_COLORS[2] },
                    { slot: 3, type: 'hard', color: PLAYER_COLORS[3] }
                ],
                mapSize: 'medium',
                resourceDensity: 'medium',
                rockDensity: 'medium'
            };
            const state = createGameFromSkirmishConfig(config);

            expect(state.players[0].isAi).toBe(false);
            expect(state.players[0].difficulty).toBe('medium'); // Human defaults to medium
            expect(state.players[1].isAi).toBe(true);
            expect(state.players[1].difficulty).toBe('easy');
            expect(state.players[2].isAi).toBe(true);
            expect(state.players[2].difficulty).toBe('medium');
            expect(state.players[3].isAi).toBe(true);
            expect(state.players[3].difficulty).toBe('hard');
        });

        it('should assign correct colors to players', () => {
            const config = createSkirmishConfig(4);
            const state = createGameFromSkirmishConfig(config);

            expect(state.players[0].color).toBe('#4488ff');
            expect(state.players[1].color).toBe('#ff4444');
            expect(state.players[2].color).toBe('#44ff88');
            expect(state.players[3].color).toBe('#ffcc44');
        });

        it('should set observer mode when all players are AI', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'easy', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'medium',
                resourceDensity: 'medium',
                rockDensity: 'medium'
            };
            const state = createGameFromSkirmishConfig(config);

            expect(state.mode).toBe('demo');
        });

        it('should set game mode when one player is human', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'medium',
                resourceDensity: 'medium',
                rockDensity: 'medium'
            };
            const state = createGameFromSkirmishConfig(config);

            expect(state.mode).toBe('game');
        });
    });

    describe('Starting Positions', () => {
        it('should place 2 players at opposite corners', () => {
            const config = createSkirmishConfig(2);
            const state = createGameFromSkirmishConfig(config);

            const cy0 = state.entities['cy_p0'];
            const cy1 = state.entities['cy_p1'];

            expect(cy0).toBeDefined();
            expect(cy1).toBeDefined();

            // On medium map (3000x3000) with margin 350
            // Player 0: (350, 350)
            // Player 1: (2650, 2650)
            expect(cy0.pos.x).toBe(350);
            expect(cy0.pos.y).toBe(350);
            expect(cy1.pos.x).toBe(2650);
            expect(cy1.pos.y).toBe(2650);
        });

        it('should place 4 players in all four corners', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] },
                    { slot: 2, type: 'medium', color: PLAYER_COLORS[2] },
                    { slot: 3, type: 'medium', color: PLAYER_COLORS[3] }
                ],
                mapSize: 'large',
                resourceDensity: 'medium',
                rockDensity: 'medium'
            };
            const state = createGameFromSkirmishConfig(config);

            const cy0 = state.entities['cy_p0'];
            const cy1 = state.entities['cy_p1'];
            const cy2 = state.entities['cy_p2'];
            const cy3 = state.entities['cy_p3'];

            expect(cy0).toBeDefined();
            expect(cy1).toBeDefined();
            expect(cy2).toBeDefined();
            expect(cy3).toBeDefined();

            // On large map (4000x4000) with margin 350
            expect(cy0.pos.x).toBe(350);
            expect(cy0.pos.y).toBe(350);
            expect(cy1.pos.x).toBe(3650);
            expect(cy1.pos.y).toBe(3650);
            expect(cy2.pos.x).toBe(3650);
            expect(cy2.pos.y).toBe(350);
            expect(cy3.pos.x).toBe(350);
            expect(cy3.pos.y).toBe(3650);
        });

        it('should position minimum distance between players on large map', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] },
                    { slot: 2, type: 'medium', color: PLAYER_COLORS[2] },
                    { slot: 3, type: 'medium', color: PLAYER_COLORS[3] }
                ],
                mapSize: 'large',
                resourceDensity: 'medium',
                rockDensity: 'medium'
            };
            const state = createGameFromSkirmishConfig(config);

            const conyards = Object.values(state.entities).filter(e => e.key === 'conyard');

            // Check no two conyards are closer than 1000 units
            for (let i = 0; i < conyards.length; i++) {
                for (let j = i + 1; j < conyards.length; j++) {
                    const dist = conyards[i].pos.dist(conyards[j].pos);
                    expect(dist).toBeGreaterThan(1000);
                }
            }
        });
    });

    describe('Entity Creation', () => {
        it('should create conyard and harvester for each player', () => {
            const config = createSkirmishConfig(4);
            const state = createGameFromSkirmishConfig(config);

            for (let i = 0; i < 4; i++) {
                const cy = state.entities[`cy_p${i}`];
                const harv = state.entities[`harv_p${i}`];

                expect(cy).toBeDefined();
                expect(cy.owner).toBe(i);
                expect(cy.type).toBe('BUILDING');
                expect(cy.key).toBe('conyard');
                expect(cy.hp).toBe(3000);

                expect(harv).toBeDefined();
                expect(harv.owner).toBe(i);
                expect(harv.type).toBe('UNIT');
                expect(harv.key).toBe('harvester');
                expect(harv.hp).toBe(1000);
            }
        });

        it('should place harvesters near their construction yards', () => {
            const config = createSkirmishConfig(4);
            const state = createGameFromSkirmishConfig(config);

            for (let i = 0; i < 4; i++) {
                const cy = state.entities[`cy_p${i}`];
                const harv = state.entities[`harv_p${i}`];

                const dist = cy.pos.dist(harv.pos);
                expect(dist).toBeLessThan(150); // Should be close to base
            }
        });

        it('should not overlap harvesters with conyards', () => {
            const config = createSkirmishConfig(4);
            const state = createGameFromSkirmishConfig(config);

            for (let i = 0; i < 4; i++) {
                const cy = state.entities[`cy_p${i}`];
                const harv = state.entities[`harv_p${i}`];

                const dist = cy.pos.dist(harv.pos);
                const minDist = cy.radius + harv.radius;
                expect(dist).toBeGreaterThan(minDist);
            }
        });
    });

    describe('Map Generation', () => {
        it('should generate correct map size for small', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'small',
                resourceDensity: 'medium',
                rockDensity: 'medium'
            };
            const state = createGameFromSkirmishConfig(config);

            expect(state.config.width).toBe(2000);
            expect(state.config.height).toBe(2000);
        });

        it('should generate correct map size for large', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'large',
                resourceDensity: 'medium',
                rockDensity: 'medium'
            };
            const state = createGameFromSkirmishConfig(config);

            expect(state.config.width).toBe(4000);
            expect(state.config.height).toBe(4000);
        });

        it('should generate more resources with high density', () => {
            const lowConfig: SkirmishConfig = {
                players: [{ slot: 0, type: 'human', color: PLAYER_COLORS[0] }, { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }],
                mapSize: 'medium',
                resourceDensity: 'low',
                rockDensity: 'low'
            };
            const highConfig: SkirmishConfig = {
                players: [{ slot: 0, type: 'human', color: PLAYER_COLORS[0] }, { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }],
                mapSize: 'medium',
                resourceDensity: 'high',
                rockDensity: 'low'
            };

            const lowState = createGameFromSkirmishConfig(lowConfig);
            const highState = createGameFromSkirmishConfig(highConfig);

            const lowResources = Object.values(lowState.entities).filter(e => e.type === 'RESOURCE').length;
            const highResources = Object.values(highState.entities).filter(e => e.type === 'RESOURCE').length;

            expect(highResources).toBeGreaterThan(lowResources);
        });

        it('should generate rock obstacles', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'medium', color: PLAYER_COLORS[1] }
                ],
                mapSize: 'medium',
                resourceDensity: 'medium',
                rockDensity: 'high'
            };
            const state = createGameFromSkirmishConfig(config);

            const rocks = Object.values(state.entities).filter(e => e.type === 'ROCK');
            expect(rocks.length).toBeGreaterThan(0);
            expect(rocks.length).toBe(DENSITY_SETTINGS.high.rocks);
        });
    });

    describe('AI Support', () => {
        it('should mark AI players correctly', () => {
            const config: SkirmishConfig = {
                players: [
                    { slot: 0, type: 'human', color: PLAYER_COLORS[0] },
                    { slot: 1, type: 'easy', color: PLAYER_COLORS[1] },
                    { slot: 2, type: 'medium', color: PLAYER_COLORS[2] },
                    { slot: 3, type: 'hard', color: PLAYER_COLORS[3] }
                ],
                mapSize: 'medium',
                resourceDensity: 'medium',
                rockDensity: 'medium'
            };
            const state = createGameFromSkirmishConfig(config);

            const aiPlayers = Object.values(state.players).filter(p => p.isAi);
            expect(aiPlayers.length).toBe(3);
        });

        it('should give AI players correct starting credits', () => {
            const config = createSkirmishConfig(2);
            const state = createGameFromSkirmishConfig(config);

            // Human player 0 should have 3000 credits
            expect(state.players[0].credits).toBe(3000);
            // AI player 1 should have 10000 credits
            expect(state.players[1].credits).toBe(10000);
        });
    });
});

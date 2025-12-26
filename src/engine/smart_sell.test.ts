
import { describe, it, expect } from 'vitest';
import { computeAiActions, resetAIState } from './ai';
import { GameState } from './types';

describe('AI Smart Selling', () => {
    it('should sell buildings to afford a refinery if it is missing', () => {
        resetAIState(1);

        // Setup state: No refinery, low credits, but has expensive other buildings
        const state: GameState = {
            tick: 0,
            players: {
                0: {
                    id: 0,
                    isAi: false,
                    difficulty: 'medium',
                    color: '#4488ff',
                    credits: 10000,
                    maxPower: 1000,
                    usedPower: 0,
                    queues: { building: { current: null, progress: 0 }, infantry: { current: null, progress: 0 }, vehicle: { current: null, progress: 0 }, air: { current: null, progress: 0 } },
                    readyToPlace: null
                },
                1: {
                    id: 1,
                    isAi: true,
                    difficulty: 'medium',
                    color: '#ff4444',
                    credits: 500,
                    maxPower: 1000,
                    usedPower: 0,
                    queues: { building: { current: null, progress: 0 }, infantry: { current: null, progress: 0 }, vehicle: { current: null, progress: 0 }, air: { current: null, progress: 0 } },
                    readyToPlace: null
                }
            },
            entities: {
                // Critical Conyard
                'conyard': {
                    id: 'conyard', owner: 1, type: 'BUILDING', key: 'conyard',
                    pos: { x: 100, y: 100 }, hp: 3000, maxHp: 3000, dead: false,
                    w: 90, h: 90, radius: 45, vel: { x: 0, y: 0 }, rotation: 0, path: null
                } as any,
                // Power Plant (Need power for refinery, so usually keep one, but let's assume we have excess or just 1)
                'power': {
                    id: 'power', owner: 1, type: 'BUILDING', key: 'power',
                    pos: { x: 200, y: 100 }, hp: 800, maxHp: 800, dead: false,
                    w: 60, h: 60, radius: 30, vel: { x: 0, y: 0 }, rotation: 0, path: null
                } as any,
                // Expensive Factory (Cost 2000, Sell 1000)
                'factory': {
                    id: 'factory', owner: 1, type: 'BUILDING', key: 'factory',
                    pos: { x: 300, y: 100 }, hp: 2000, maxHp: 2000, dead: false,
                    w: 100, h: 100, radius: 50, vel: { x: 0, y: 0 }, rotation: 0, path: null
                } as any,
                // Turret (Cost 800, Sell 400)
                'turret': {
                    id: 'turret', owner: 1, type: 'BUILDING', key: 'turret',
                    pos: { x: 400, y: 100 }, hp: 1000, maxHp: 1000, dead: false,
                    w: 40, h: 40, radius: 20, vel: { x: 0, y: 0 }, rotation: 0, path: null
                } as any,
                // Barracks (Cost 500, Sell 250)
                'barracks': {
                    id: 'barracks', owner: 1, type: 'BUILDING', key: 'barracks',
                    pos: { x: 500, y: 100 }, hp: 1000, maxHp: 1000, dead: false,
                    w: 60, h: 80, radius: 30, vel: { x: 0, y: 0 }, rotation: 0, path: null
                } as any
            },
            projectiles: [],
            particles: [],
            selection: [],
            placingBuilding: null,
            running: true,
            mode: 'game',
            sellMode: false,
            difficulty: 'easy',
            camera: { x: 0, y: 0 },
            zoom: 1,
            winner: null,
            config: { width: 1000, height: 1000, resourceDensity: 'medium', rockDensity: 'medium' }
        };

        // Run AI multiple times to simulate decision process
        // 1. First tick -> Should trigger a sell because it needs Refinery (priority)
        // Current credits: 500. Refinery cost: 2000. Missing: 1500.
        // Factory sell: 1000. Turret sell: 400. Barracks sell: 250. Total sellable: 1650.
        // It should sell something. Let's see if it sells the Factory first (highest value / least critical?).

        let actions = computeAiActions(state, 1);

        // It definitely shouldn't be empty if we enable smart selling
        // With current code, it will be empty because credits > 200

        console.log('Actions:', actions);

        const hasSell = actions.some(a => a.type === 'SELL_BUILDING');
        expect(hasSell).toBe(true);
    });
});

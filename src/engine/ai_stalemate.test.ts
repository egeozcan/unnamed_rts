
import { describe, it, expect } from 'vitest';
import { computeAiActions, resetAIState } from './ai';
import { GameState, Entity, Vector } from './types.js';

describe('AI Stalemate Logic', () => {

    // Helper to create a basic state
    const createStalemateState = (credits: number, buildings: Entity[], units: Entity[] = []): GameState => {
        const entityMap: Record<string, Entity> = {};
        buildings.forEach(b => entityMap[b.id] = b);
        units.forEach(u => entityMap[u.id] = u);

        return {
            tick: 0,
            players: {
                0: { id: 0, isAi: false, credits: 10000, difficulty: 'medium', color: '#00F', maxPower: 1000, usedPower: 0, queues: { building: { current: null, progress: 0 }, infantry: { current: null, progress: 0 }, vehicle: { current: null, progress: 0 }, air: { current: null, progress: 0 } }, readyToPlace: null },
                1: { id: 1, isAi: true, credits: credits, difficulty: 'medium', color: '#F00', maxPower: 1000, usedPower: 0, queues: { building: { current: null, progress: 0 }, infantry: { current: null, progress: 0 }, vehicle: { current: null, progress: 0 }, air: { current: null, progress: 0 } }, readyToPlace: null }
            },
            entities: entityMap,
            projectiles: [],
            particles: [],
            selection: [],
            placingBuilding: null,
            running: true,
            mode: 'game',
            sellMode: false,
            repairMode: false,
            difficulty: 'hard',
            camera: { x: 0, y: 0 },
            zoom: 1,
            winner: null,
            config: { width: 2000, height: 2000, resourceDensity: 'medium', rockDensity: 'medium' },
            debugMode: false,
            showMinimap: true
        };
    };

    const createBuilding = (key: string, id: string): Entity => ({
        id, owner: 1, type: 'BUILDING', key,
        pos: new Vector(100, 100), hp: 1000, maxHp: 1000, dead: false,
        w: 50, h: 50, radius: 25, vel: new Vector(0, 0), rotation: 0, path: null,
        flash: 0, cooldown: 0
    } as Entity);

    it('should sell buildings in a stalemate (low funds, no income) to fund units', () => {
        resetAIState(1);

        // Scenario: Player 1 has 0 credits, no harvesters, no refinery.
        // Has: Factory, Conyard, Power, Turret.
        // Expectation: Sell Turret/Power/Conyard to fund units. Keep Factory.

        const buildings = [
            createBuilding('factory', 'b_factory'),
            createBuilding('conyard', 'b_conyard'),
            createBuilding('power', 'b_power'),
            createBuilding('turret', 'b_turret'),
        ];

        const state = createStalemateState(0, buildings);
        const actions = computeAiActions(state, 1);

        // Should sell something
        const sellAction = actions.find(a => a.type === 'SELL_BUILDING');
        expect(sellAction).toBeDefined();

        // Priority is Turret > Power > Conyard
        // So Turret should be sold first
        if (sellAction) {
            expect(sellAction.payload.buildingId).toBe('b_turret');
        }
    });

    it('should NOT sell the last production building (Factory) in a stalemate', () => {
        resetAIState(1);

        // Scenario: Only Factory left. 0 credits.

        const buildings = [
            createBuilding('factory', 'b_factory')
        ];

        const state = createStalemateState(0, buildings);
        const actions = computeAiActions(state, 1);

        // Should NOT sell factory because it's the only way to produce
        const sellAction = actions.find(a => a.type === 'SELL_BUILDING');
        expect(sellAction).toBeUndefined();
    });

    it('should sell Conyard if Factory exists in stalemate', () => {
        resetAIState(1);

        // Scenario: Factory and Conyard. 0 credits.
        // Conyard is useless for production if we are broke and just want to spam units.

        const buildings = [
            createBuilding('factory', 'b_factory'),
            createBuilding('conyard', 'b_conyard')
        ];

        const state = createStalemateState(0, buildings);
        const actions = computeAiActions(state, 1);

        const sellAction = actions.find(a => a.type === 'SELL_BUILDING');
        expect(sellAction).toBeDefined();
        if (sellAction) {
            expect(sellAction.payload.buildingId).toBe('b_conyard');
        }
    });
});

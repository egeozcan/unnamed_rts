import { describe, it, expect } from 'vitest';
import { GameState, Entity, Vector } from './types.js';
import { update, INITIAL_STATE } from './reducer.js';

describe('Win Condition', () => {
    const createBuilding = (id: string, owner: number): Entity => ({
        id,
        owner,
        type: 'BUILDING',
        key: 'conyard',
        pos: new Vector(0, 0),
        prevPos: new Vector(0, 0),
        hp: 100,
        maxHp: 100,
        w: 40,
        h: 40,
        radius: 20,
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
    });

    it('should declare a winner when one player has no buildings left', () => {
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            entities: {
                'p1_conyard': createBuilding('p1_conyard', 0),
                'p2_conyard': createBuilding('p2_conyard', 1)
            }
        };

        // Initially no winner
        expect(state.winner).toBeNull();
        expect(state.running).toBe(true);

        // Tick once to ensure logic runs
        state = update(state, { type: 'TICK' });
        expect(state.winner).toBeNull();
        expect(state.running).toBe(true);

        // Destroy player 2's building
        state = {
            ...state,
            entities: {
                ...state.entities,
                'p2_conyard': { ...state.entities['p2_conyard'], hp: 0, dead: true }
            }
        };

        // Tick again
        state = update(state, { type: 'TICK' });

        // Player 1 should win (owner 0)
        expect(state.winner).toBe(0);
        expect(state.running).toBe(false);
    });

    it('should declare a draw when both players lose all buildings in the same tick', () => {
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            entities: {
                'p1_conyard': createBuilding('p1_conyard', 0),
                'p2_conyard': createBuilding('p2_conyard', 1)
            }
        };

        // Destroy both buildings
        state = {
            ...state,
            entities: {
                ...state.entities,
                'p1_conyard': { ...state.entities['p1_conyard'], hp: 0, dead: true },
                'p2_conyard': { ...state.entities['p2_conyard'], hp: 0, dead: true }
            }
        };

        // Tick
        state = update(state, { type: 'TICK' });

        // Should be a draw (-1)
        expect(state.winner).toBe(-1);
        expect(state.running).toBe(false);
    });

    it('should not declare a winner if a player has no buildings but has an MCV', () => {
        const createMCV = (id: string, owner: number): Entity => ({
            id,
            owner,
            type: 'UNIT',
            key: 'mcv',
            pos: new Vector(0, 0),
            prevPos: new Vector(0, 0),
            hp: 100,
            maxHp: 100,
            w: 40,
            h: 40,
            radius: 20,
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
        });

        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            entities: {
                'p1_conyard': createBuilding('p1_conyard', 0),
                'p2_mcv': createMCV('p2_mcv', 1)
            }
        };

        // Initially no winner
        expect(state.winner).toBeNull();
        expect(state.running).toBe(true);

        // Tick
        state = update(state, { type: 'TICK' });

        // Still no winner because P2 has an MCV
        expect(state.winner).toBeNull();
        expect(state.running).toBe(true);

        // Destroy P1's conyard
        state = {
            ...state,
            entities: {
                ...state.entities,
                'p1_conyard': { ...state.entities['p1_conyard'], hp: 0, dead: true }
            }
        };

        // Tick
        state = update(state, { type: 'TICK' });

        // Player 2 wins because P1 has nothing left
        expect(state.winner).toBe(1);
        expect(state.running).toBe(false);
    });
});


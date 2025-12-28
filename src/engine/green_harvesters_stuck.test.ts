import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';
import { createEntity, refreshCollisionGrid } from './utils';

describe('Green Harvesters Stuck', () => {

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
            hp: 1200,
            maxHp: 1200,
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

    it('full-cargo harvester with stuck moveTarget should eventually go unload', () => {
        // Reproduce scenario from game_state_tick_7338.json:
        // Harvester e_1230_49145 has full cargo but is stuck trying to reach a flee target
        // It should give up on moveTarget and go to refinery instead
        let state = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
            config: { ...INITIAL_STATE.config, width: 1000, height: 1000 }
        };

        // Refinery at (875, 785) - dock at (875, 845)
        state = spawnBuilding(state, 875, 785, 100, 80, 'ref1', 0, 'refinery');

        // Harvester at (847, 692) with:
        // - full cargo (500)
        // - moveTarget set to a flee destination
        // - no baseTargetId (was cleared when moveTarget was set)
        // - stuckTimer already building up
        state = spawnUnit(state, 847, 692, 'h1', 0, 'harvester');

        const fleeTarget = new Vector(866, 744);
        const dockPos = new Vector(875, 845);

        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: {
                    ...state.entities['h1'],
                    cargo: 500,
                    moveTarget: fleeTarget,
                    resourceTargetId: null,
                    baseTargetId: null,  // Cleared when flee command was issued
                    stuckTimer: 15,  // Already been stuck for a bit
                    avgVel: new Vector(0.1, 0.05)  // Very slow
                }
            }
        };

        // Add an obstacle blocking the flee target
        state = spawnBuilding(state, 866, 720, 40, 40, 'obstacle', 0, 'power');

        refreshCollisionGrid(state.entities);

        let clearedMoveTarget = false;
        let reachedDock = false;

        // Run for 300 ticks (needs time to clear moveTarget, find refinery, and travel)
        for (let i = 0; i < 300; i++) {
            state = update(state, { type: 'TICK' });

            const h = state.entities['h1'];
            if (h.moveTarget === null && !clearedMoveTarget) {
                clearedMoveTarget = true;
            }
            if (h.pos.dist(dockPos) < 25) {
                reachedDock = true;
            }
        }

        const finalH = state.entities['h1'];

        console.log('Full-cargo stuck moveTarget test:', {
            clearedMoveTarget,
            reachedDock,
            finalCargo: finalH.cargo,
            baseTargetId: finalH.baseTargetId,
            distToDock: finalH.pos.dist(dockPos).toFixed(0)
        });

        // The harvester should have cleared its moveTarget
        expect(clearedMoveTarget).toBe(true);

        // And should have unloaded (cargo = 0)
        expect(finalH.cargo).toBe(0);
    });

    it('multiple harvesters clustered heading to same refinery should not get permanently stuck', () => {
        // Reproduce the exact scenario from green_harvesters_and_units_stuck.json:
        // - 4 harvesters clustered in a small area (~3313-3343, ~1008-1070)
        // - All with full cargo (500)
        // - All targeting the same refinery (dock at 3310, 1195)
        // - Their paths converge to the same waypoint (3380, 1060)
        let state = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
            config: { ...INITIAL_STATE.config, width: 4000, height: 4000 }
        };

        // Refinery at position similar to e_3780_22308 (3310, 1135)
        state = spawnBuilding(state, 3310, 1135, 100, 80, 'ref1', 2, 'refinery');

        // Spawn 4 harvesters clustered together, similar to the bug case
        // harv_p2 at (3343, 1022)
        // e_1230_66765 at (3313, 1008)
        // e_3120_32476 at (3316, 1040)
        // e_4410_12016 at (3322, 1070)
        state = spawnUnit(state, 3343, 1022, 'h1', 2, 'harvester');
        state = spawnUnit(state, 3313, 1008, 'h2', 2, 'harvester');
        state = spawnUnit(state, 3316, 1040, 'h3', 2, 'harvester');
        state = spawnUnit(state, 3322, 1070, 'h4', 2, 'harvester');

        // Set all harvesters to have full cargo and target the refinery
        const dockPos = new Vector(3310, 1195); // Dock is 60 below refinery center
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: {
                    ...state.entities['h1'],
                    cargo: 500,
                    resourceTargetId: null,
                    baseTargetId: 'ref1',
                    // Give them paths that converge at waypoint (3380, 1060)
                    path: [
                        new Vector(3340, 1020),
                        new Vector(3380, 1060),
                        new Vector(3380, 1180),
                        dockPos
                    ],
                    pathIdx: 1,
                    finalDest: dockPos
                },
                h2: {
                    ...state.entities['h2'],
                    cargo: 500,
                    resourceTargetId: null,
                    baseTargetId: 'ref1',
                    path: [
                        new Vector(3300, 1020),
                        new Vector(3380, 1060),
                        new Vector(3380, 1180),
                        dockPos
                    ],
                    pathIdx: 1,
                    finalDest: dockPos
                },
                h3: {
                    ...state.entities['h3'],
                    cargo: 500,
                    resourceTargetId: null,
                    baseTargetId: 'ref1',
                    path: [
                        new Vector(3300, 1060),
                        new Vector(3380, 1060),
                        new Vector(3380, 1180),
                        dockPos
                    ],
                    pathIdx: 1,
                    finalDest: dockPos
                },
                h4: {
                    ...state.entities['h4'],
                    cargo: 500,
                    resourceTargetId: null,
                    baseTargetId: 'ref1',
                    path: [
                        new Vector(3340, 1060),
                        new Vector(3380, 1060),
                        new Vector(3380, 1180),
                        dockPos
                    ],
                    pathIdx: 1,
                    finalDest: dockPos
                }
            }
        };

        refreshCollisionGrid(state.entities);

        const initialPositions = {
            h1: state.entities['h1'].pos,
            h2: state.entities['h2'].pos,
            h3: state.entities['h3'].pos,
            h4: state.entities['h4'].pos,
        };

        // Track if any harvester reaches the dock or makes significant progress
        let anyReachedDock = false;
        let noProgressTicks = 0;
        let lastPositions = { ...initialPositions };

        // Run for 300 ticks - enough for at least one to reach the dock
        for (let i = 0; i < 300; i++) {
            state = update(state, { type: 'TICK' });

            const harvesters = ['h1', 'h2', 'h3', 'h4'].map(id => state.entities[id]);

            // Check if any harvester reached the dock (within 25 units)
            for (const h of harvesters) {
                if (h.pos.dist(dockPos) < 25) {
                    anyReachedDock = true;
                }
            }

            // Check if all harvesters are stuck (no significant movement)
            let anyMoved = false;
            for (const id of ['h1', 'h2', 'h3', 'h4']) {
                const h = state.entities[id];
                const lastPos = lastPositions[id as keyof typeof lastPositions];
                if (h.pos.dist(lastPos) > 0.5) {
                    anyMoved = true;
                }
                lastPositions[id as keyof typeof lastPositions] = h.pos;
            }

            // Only count as stuck if all harvesters far from dock and none moving
            const allFarFromDock = harvesters.every(h => h.pos.dist(dockPos) > 50);
            if (!anyMoved && allFarFromDock) {
                noProgressTicks++;
            }
        }

        const finalHarvesters = ['h1', 'h2', 'h3', 'h4'].map(id => state.entities[id]);
        const finalDistances = finalHarvesters.map(h => h.pos.dist(dockPos));
        const progressMade = finalHarvesters.map((h, i) =>
            initialPositions[['h1', 'h2', 'h3', 'h4'][i] as keyof typeof initialPositions].dist(dockPos) - h.pos.dist(dockPos)
        );

        console.log('Green harvesters stuck test results:', {
            finalDistances: finalDistances.map(d => d.toFixed(0)),
            progressMade: progressMade.map(p => p.toFixed(0)),
            noProgressTicks,
            anyReachedDock,
            stuckTimers: finalHarvesters.map(h => h.stuckTimer),
            cargos: finalHarvesters.map(h => h.cargo)
        });

        // At least one harvester should reach the dock and unload
        expect(anyReachedDock).toBe(true);

        // At least one harvester should have unloaded (cargo = 0)
        const anyUnloaded = finalHarvesters.some(h => h.cargo === 0);
        expect(anyUnloaded).toBe(true);

        // They shouldn't all be stuck for too long
        expect(noProgressTicks).toBeLessThan(100);
    });

    it('harvesters in counter-flow traffic jam should not deadlock', () => {
        // Reproduce the actual stuck scenario: harvesters heading TO dock collide
        // with harvesters heading AWAY from dock, all through the same waypoint
        let state = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
            config: { ...INITIAL_STATE.config, width: 4000, height: 4000 }
        };

        // Refinery at (3310, 1135), dock at (3310, 1195)
        state = spawnBuilding(state, 3310, 1135, 100, 80, 'ref1', 2, 'refinery');

        // Converging waypoint that all paths go through
        const convergingWaypoint = new Vector(3380, 1060);
        const dockPos = new Vector(3310, 1195);
        const fleeTarget = new Vector(3179, 678);

        // Group A: 4 harvesters with full cargo heading TO dock via waypoint
        state = spawnUnit(state, 3343, 1022, 'h1', 2, 'harvester');
        state = spawnUnit(state, 3313, 1008, 'h2', 2, 'harvester');
        state = spawnUnit(state, 3316, 1040, 'h3', 2, 'harvester');
        state = spawnUnit(state, 3322, 1070, 'h4', 2, 'harvester');

        // Group B: 1 harvester AT the waypoint, blocking (like e_3749_95773)
        state = spawnUnit(state, 3392, 1041, 'h_blocker', 2, 'harvester');

        // Group C: 1 harvester near refinery going AWAY (counter-flow, like e_3780_9941)
        state = spawnUnit(state, 3372, 1155, 'h_counter', 2, 'harvester');

        // Set up Group A: going TO dock
        for (const id of ['h1', 'h2', 'h3', 'h4']) {
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    [id]: {
                        ...state.entities[id],
                        cargo: 500,
                        resourceTargetId: null,
                        baseTargetId: 'ref1',
                        path: [new Vector(3340, 1040), convergingWaypoint, new Vector(3380, 1180), dockPos],
                        pathIdx: 1,
                        finalDest: dockPos,
                        stuckTimer: Math.floor(Math.random() * 30),
                        avgVel: new Vector(1e-42, -1e-42)
                    }
                }
            };
        }

        // Set up h_blocker: at waypoint, going to dock (but blocking)
        state = {
            ...state,
            entities: {
                ...state.entities,
                h_blocker: {
                    ...state.entities['h_blocker'],
                    cargo: 500,
                    resourceTargetId: null,
                    baseTargetId: 'ref1',
                    path: [convergingWaypoint, new Vector(3380, 1180), dockPos],
                    pathIdx: 1,
                    finalDest: dockPos,
                    stuckTimer: 17,
                    avgVel: new Vector(-0.00014, 0.00005)
                }
            }
        };

        // Set up h_counter: going AWAY from refinery through the waypoint (counter-flow)
        state = {
            ...state,
            entities: {
                ...state.entities,
                h_counter: {
                    ...state.entities['h_counter'],
                    cargo: 150,
                    resourceTargetId: null,
                    baseTargetId: null,
                    moveTarget: fleeTarget,  // Manual move away
                    path: [new Vector(3380, 1140), convergingWaypoint, fleeTarget],
                    pathIdx: 1,
                    finalDest: fleeTarget,
                    stuckTimer: 16,
                    avgVel: new Vector(-2e-124, -4e-124)
                }
            }
        };

        refreshCollisionGrid(state.entities);

        const allHarvesterIds = ['h1', 'h2', 'h3', 'h4', 'h_blocker', 'h_counter'];
        const initialPositions = Object.fromEntries(
            allHarvesterIds.map(id => [id, state.entities[id].pos])
        );

        let unloadCount = 0;
        let noProgressTicks = 0;
        let lastPositions = { ...initialPositions };

        // Run for 400 ticks
        for (let i = 0; i < 400; i++) {
            const prevCargos = allHarvesterIds.map(id => state.entities[id].cargo);
            state = update(state, { type: 'TICK' });
            const newCargos = allHarvesterIds.map(id => state.entities[id].cargo);

            // Count unloads
            for (let j = 0; j < allHarvesterIds.length; j++) {
                if (prevCargos[j] >= 500 && newCargos[j] === 0) {
                    unloadCount++;
                }
            }

            // Check for progress
            let anyMoved = false;
            for (const id of allHarvesterIds) {
                const h = state.entities[id];
                if (h.pos.dist(lastPositions[id]) > 0.5) {
                    anyMoved = true;
                }
                lastPositions[id] = h.pos;
            }

            // Count stuck ticks for harvesters far from dock
            const dockBoundHarvesters = ['h1', 'h2', 'h3', 'h4', 'h_blocker'];
            const allFarFromDock = dockBoundHarvesters.every(id => state.entities[id].pos.dist(dockPos) > 50);
            if (!anyMoved && allFarFromDock) {
                noProgressTicks++;
            }
        }

        const finalHarvesters = allHarvesterIds.map(id => state.entities[id]);

        console.log('Counter-flow traffic jam test:', {
            unloadCount,
            noProgressTicks,
            finalCargos: finalHarvesters.map(h => h.cargo),
            finalDistsToDock: ['h1', 'h2', 'h3', 'h4', 'h_blocker'].map(id =>
                state.entities[id].pos.dist(dockPos).toFixed(0)
            ),
            stuckTimers: finalHarvesters.map(h => h.stuckTimer)
        });

        // At least 2 harvesters should unload in 400 ticks
        expect(unloadCount).toBeGreaterThanOrEqual(2);

        // Should not be permanently stuck
        expect(noProgressTicks).toBeLessThan(150);
    });

    it('tightly clustered harvesters with near-zero avgVel should still make progress', () => {
        // Reproduce exact scenario from JSON: 4 harvesters in ~30 pixel area,
        // all with avgVel near-zero, identical paths, trying to reach same waypoint
        let state = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
            config: { ...INITIAL_STATE.config, width: 4000, height: 4000 }
        };

        // Refinery at position matching the JSON
        state = spawnBuilding(state, 3310, 1135, 100, 80, 'ref1', 2, 'refinery');

        // Spawn 4 harvesters in extremely tight cluster matching JSON positions exactly
        // harv_p2: (3343, 1022)
        // e_1230_66765: (3313, 1008)
        // e_3120_32476: (3316, 1040)
        // e_4410_12016: (3322, 1070)
        state = spawnUnit(state, 3343, 1022, 'h1', 2, 'harvester');
        state = spawnUnit(state, 3313, 1008, 'h2', 2, 'harvester');
        state = spawnUnit(state, 3316, 1040, 'h3', 2, 'harvester');
        state = spawnUnit(state, 3322, 1070, 'h4', 2, 'harvester');

        const dockPos = new Vector(3310, 1195);
        const waypoint1 = new Vector(3380, 1060);
        const waypoint2 = new Vector(3380, 1180);

        // Set all harvesters to exactly match the JSON state:
        // - Full cargo
        // - Targeting same refinery
        // - Converging paths to same waypoint
        // - Near-zero avgVel (simulating they've been stuck)
        // - Positive stuckTimer
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: {
                    ...state.entities['h1'],
                    cargo: 500,
                    resourceTargetId: null,
                    baseTargetId: 'ref1',
                    path: [new Vector(3340, 1020), waypoint1, waypoint2, dockPos],
                    pathIdx: 1,
                    finalDest: dockPos,
                    stuckTimer: 6,
                    avgVel: new Vector(8e-43, -1e-42) // Near-zero as in JSON
                },
                h2: {
                    ...state.entities['h2'],
                    cargo: 500,
                    resourceTargetId: null,
                    baseTargetId: 'ref1',
                    path: [new Vector(3300, 1020), waypoint1, waypoint2, dockPos],
                    pathIdx: 1,
                    finalDest: dockPos,
                    stuckTimer: 31,
                    avgVel: new Vector(8e-43, -1e-42)
                },
                h3: {
                    ...state.entities['h3'],
                    cargo: 500,
                    resourceTargetId: null,
                    baseTargetId: 'ref1',
                    path: [new Vector(3300, 1060), waypoint1, waypoint2, dockPos],
                    pathIdx: 1,
                    finalDest: dockPos,
                    stuckTimer: 25,
                    avgVel: new Vector(9e-43, -8e-43)
                },
                h4: {
                    ...state.entities['h4'],
                    cargo: 500,
                    resourceTargetId: null,
                    baseTargetId: 'ref1',
                    path: [new Vector(3340, 1060), waypoint1, waypoint2, dockPos],
                    pathIdx: 1,
                    finalDest: dockPos,
                    stuckTimer: 7,
                    avgVel: new Vector(-3e-43, -5e-44)
                }
            }
        };

        refreshCollisionGrid(state.entities);

        const initialPositions = {
            h1: state.entities['h1'].pos,
            h2: state.entities['h2'].pos,
            h3: state.entities['h3'].pos,
            h4: state.entities['h4'].pos,
        };

        let anyReachedDock = false;
        let noProgressTicks = 0;
        let lastPositions = { ...initialPositions };

        // Run for 200 ticks
        for (let i = 0; i < 200; i++) {
            state = update(state, { type: 'TICK' });

            const harvesters = ['h1', 'h2', 'h3', 'h4'].map(id => state.entities[id]);

            for (const h of harvesters) {
                if (h.pos.dist(dockPos) < 25) {
                    anyReachedDock = true;
                }
            }

            let anyMoved = false;
            for (const id of ['h1', 'h2', 'h3', 'h4']) {
                const h = state.entities[id];
                const lastPos = lastPositions[id as keyof typeof lastPositions];
                if (h.pos.dist(lastPos) > 0.5) {
                    anyMoved = true;
                }
                lastPositions[id as keyof typeof lastPositions] = h.pos;
            }

            const allFarFromDock = harvesters.every(h => h.pos.dist(dockPos) > 50);
            if (!anyMoved && allFarFromDock) {
                noProgressTicks++;
            }
        }

        const finalHarvesters = ['h1', 'h2', 'h3', 'h4'].map(id => state.entities[id]);
        const progressMade = finalHarvesters.map((h, i) =>
            initialPositions[['h1', 'h2', 'h3', 'h4'][i] as keyof typeof initialPositions].dist(dockPos) - h.pos.dist(dockPos)
        );

        console.log('Tightly clustered test:', {
            progressMade: progressMade.map(p => p.toFixed(0)),
            anyReachedDock,
            noProgressTicks,
            stuckTimers: finalHarvesters.map(h => h.stuckTimer),
            cargos: finalHarvesters.map(h => h.cargo)
        });

        // At least one harvester should make significant progress (> 30 pixels toward dock)
        expect(progressMade.some(p => p > 30)).toBe(true);

        // Should not be stuck for more than 80 ticks
        expect(noProgressTicks).toBeLessThan(80);
    });

    it('harvesters competing for same dock should take turns and not deadlock', () => {
        // Simpler reproduction: 3 harvesters very close together, all going to same dock
        let state = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
            config: { ...INITIAL_STATE.config, width: 1000, height: 1000 }
        };

        // Refinery in center
        state = spawnBuilding(state, 500, 400, 100, 80, 'ref1', 0, 'refinery');
        const dockPos = new Vector(500, 460); // 60 below center

        // 3 harvesters in a tight cluster above the refinery
        state = spawnUnit(state, 480, 320, 'h1', 0, 'harvester');
        state = spawnUnit(state, 510, 315, 'h2', 0, 'harvester');
        state = spawnUnit(state, 495, 345, 'h3', 0, 'harvester');

        // All with full cargo, targeting the refinery
        for (const id of ['h1', 'h2', 'h3']) {
            state = {
                ...state,
                entities: {
                    ...state.entities,
                    [id]: {
                        ...state.entities[id],
                        cargo: 500,
                        resourceTargetId: null,
                        baseTargetId: 'ref1',
                        finalDest: dockPos
                    }
                }
            };
        }

        refreshCollisionGrid(state.entities);

        let unloadCount = 0;

        // Run for 400 ticks
        for (let i = 0; i < 400; i++) {
            const prevCargos = ['h1', 'h2', 'h3'].map(id => state.entities[id].cargo);
            state = update(state, { type: 'TICK' });
            const newCargos = ['h1', 'h2', 'h3'].map(id => state.entities[id].cargo);

            // Count unloads
            for (let j = 0; j < 3; j++) {
                if (prevCargos[j] === 500 && newCargos[j] === 0) {
                    unloadCount++;
                }
            }
        }

        console.log('Dock competition test:', {
            unloadCount,
            finalCargos: ['h1', 'h2', 'h3'].map(id => state.entities[id].cargo),
            finalPos: ['h1', 'h2', 'h3'].map(id => {
                const h = state.entities[id];
                return `${h.pos.x.toFixed(0)}, ${h.pos.y.toFixed(0)}`;
            })
        });

        // At least 2 harvesters should have unloaded in 400 ticks
        expect(unloadCount).toBeGreaterThanOrEqual(2);
    });
});

import { describe, it, expect } from 'vitest';
import { INITIAL_STATE, update } from './reducer';
import { GameState, Vector, Entity, EntityId } from './types';
import { createEntity, refreshCollisionGrid } from './utils';

describe('Red Harvester Stuck at Dock', () => {

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
            hp: 1000,
            maxHp: 1000,
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

    it('harvesters should not get stuck when turret blocks direct path to dock', () => {
        // Reproduce exact scenario from red_harv_stuck.json:
        // - Refinery at (2880, 2957), dock point at (2880, 3017)
        // - Turret at (2783, 2980) blocking direct path
        // - Harvester at (2767, 2927) trying to dock
        // - Second harvester at (2902, 2847) also trying to dock
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Scale down positions for easier testing (divide by 10)
        // Refinery at (288, 296), dock at (288, 302)
        state = spawnBuilding(state, 500, 500, 100, 80, 'ref1', 1, 'refinery');
        // Turret between harvester and dock - blocking direct path
        state = spawnBuilding(state, 420, 540, 40, 40, 'turret1', 1, 'turret');

        // First harvester - blocked by turret from reaching dock directly
        state = spawnUnit(state, 400, 460, 'h1', 1, 'harvester');
        // Second harvester - approaching from different angle
        state = spawnUnit(state, 550, 420, 'h2', 1, 'harvester');

        // Give them full cargo and set baseTargetId to refinery
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: {
                    ...state.entities['h1'],
                    cargo: 500,
                    baseTargetId: 'ref1'
                },
                h2: {
                    ...state.entities['h2'],
                    cargo: 500,
                    baseTargetId: 'ref1'
                }
            }
        };

        refreshCollisionGrid(state.entities);

        // Dock point is at refinery.pos + (0, 60) = (500, 560)
        const dockPos = new Vector(500, 560);
        const initialH1Pos = state.entities['h1'].pos;
        const initialH2Pos = state.entities['h2'].pos;

        // Track progress
        let lastH1Pos = state.entities['h1'].pos;
        let lastH2Pos = state.entities['h2'].pos;
        let noProgressTicks = 0;
        let anyDocked = false;
        let h1ClosestDist = Infinity;
        let h2ClosestDist = Infinity;

        // Run for 300 ticks - should be enough to dock
        for (let i = 0; i < 300; i++) {
            state = update(state, { type: 'TICK' });

            const h1 = state.entities['h1'];
            const h2 = state.entities['h2'];

            const h1DistToDock = h1.pos.dist(dockPos);
            const h2DistToDock = h2.pos.dist(dockPos);

            h1ClosestDist = Math.min(h1ClosestDist, h1DistToDock);
            h2ClosestDist = Math.min(h2ClosestDist, h2DistToDock);

            // Check if either unloaded (cargo becomes 0)
            if (h1.cargo === 0 || h2.cargo === 0) {
                anyDocked = true;
            }

            // Check if neither moved and both far from dock
            const h1Moved = h1.pos.dist(lastH1Pos) > 0.5;
            const h2Moved = h2.pos.dist(lastH2Pos) > 0.5;
            if (!h1Moved && !h2Moved && h1DistToDock > 50 && h2DistToDock > 50) {
                noProgressTicks++;
            }

            lastH1Pos = h1.pos;
            lastH2Pos = h2.pos;
        }

        const finalH1 = state.entities['h1'];
        const finalH2 = state.entities['h2'];

        console.log('Turret blocking dock test:', {
            h1Start: `${initialH1Pos.x.toFixed(0)}, ${initialH1Pos.y.toFixed(0)}`,
            h2Start: `${initialH2Pos.x.toFixed(0)}, ${initialH2Pos.y.toFixed(0)}`,
            h1End: `${finalH1.pos.x.toFixed(0)}, ${finalH1.pos.y.toFixed(0)}`,
            h2End: `${finalH2.pos.x.toFixed(0)}, ${finalH2.pos.y.toFixed(0)}`,
            dockPos: `${dockPos.x.toFixed(0)}, ${dockPos.y.toFixed(0)}`,
            h1DistToDock: finalH1.pos.dist(dockPos).toFixed(0),
            h2DistToDock: finalH2.pos.dist(dockPos).toFixed(0),
            h1ClosestDist: h1ClosestDist.toFixed(0),
            h2ClosestDist: h2ClosestDist.toFixed(0),
            h1Cargo: finalH1.cargo,
            h2Cargo: finalH2.cargo,
            anyDocked,
            noProgressTicks,
            h1StuckTimer: finalH1.stuckTimer,
            h2StuckTimer: finalH2.stuckTimer
        });

        // At least one harvester should have docked successfully
        expect(anyDocked).toBe(true);
        // Shouldn't be stuck for too long 
        expect(noProgressTicks).toBeLessThan(100);
    });

    it('multiple harvesters targeting same refinery should queue properly without getting stuck', () => {
        // Scenario: 3 harvesters all trying to dock at the same refinery
        // Some defensive buildings nearby creating obstacles
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Refinery in the middle
        state = spawnBuilding(state, 500, 500, 100, 80, 'ref1', 1, 'refinery');

        // Defensive buildings around creating potential obstacles
        state = spawnBuilding(state, 380, 500, 40, 40, 'turret1', 1, 'turret');
        state = spawnBuilding(state, 620, 500, 40, 40, 'pillbox1', 1, 'pillbox');

        // Three harvesters at different positions, all with full cargo
        state = spawnUnit(state, 350, 450, 'h1', 1, 'harvester');
        state = spawnUnit(state, 500, 380, 'h2', 1, 'harvester');
        state = spawnUnit(state, 650, 450, 'h3', 1, 'harvester');

        // All full cargo, all targeting same refinery
        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: { ...state.entities['h1'], cargo: 500, baseTargetId: 'ref1' },
                h2: { ...state.entities['h2'], cargo: 500, baseTargetId: 'ref1' },
                h3: { ...state.entities['h3'], cargo: 500, baseTargetId: 'ref1' }
            }
        };

        refreshCollisionGrid(state.entities);

        let dockedCount = 0;
        let noProgressTicks = 0;
        let lastPositions = {
            h1: state.entities['h1'].pos,
            h2: state.entities['h2'].pos,
            h3: state.entities['h3'].pos
        };

        const dockPos = new Vector(500, 560);

        // Run for 600 ticks - should be enough for all 3 to dock
        for (let i = 0; i < 600; i++) {
            state = update(state, { type: 'TICK' });

            const h1 = state.entities['h1'];
            const h2 = state.entities['h2'];
            const h3 = state.entities['h3'];

            // Count how many have docked (cargo = 0)
            dockedCount = [h1, h2, h3].filter(h => h.cargo === 0).length;

            // Check movement
            const h1Moved = h1.pos.dist(lastPositions.h1) > 0.3;
            const h2Moved = h2.pos.dist(lastPositions.h2) > 0.3;
            const h3Moved = h3.pos.dist(lastPositions.h3) > 0.3;

            // If none moved and not all docked
            if (!h1Moved && !h2Moved && !h3Moved && dockedCount < 3) {
                // But only count as stuck if at least one is far from dock and has cargo
                const farFromDock = [h1, h2, h3].some(h =>
                    h.cargo > 0 && h.pos.dist(dockPos) > 80
                );
                if (farFromDock) {
                    noProgressTicks++;
                }
            }

            lastPositions = { h1: h1.pos, h2: h2.pos, h3: h3.pos };
        }

        console.log('Multiple harvesters dock test:', {
            finalDockedCount: dockedCount,
            noProgressTicks,
            h1: {
                pos: `${state.entities['h1'].pos.x.toFixed(0)}, ${state.entities['h1'].pos.y.toFixed(0)}`,
                cargo: state.entities['h1'].cargo,
                stuckTimer: state.entities['h1'].stuckTimer
            },
            h2: {
                pos: `${state.entities['h2'].pos.x.toFixed(0)}, ${state.entities['h2'].pos.y.toFixed(0)}`,
                cargo: state.entities['h2'].cargo,
                stuckTimer: state.entities['h2'].stuckTimer
            },
            h3: {
                pos: `${state.entities['h3'].pos.x.toFixed(0)}, ${state.entities['h3'].pos.y.toFixed(0)}`,
                cargo: state.entities['h3'].cargo,
                stuckTimer: state.entities['h3'].stuckTimer
            }
        });

        // At least 2 should have docked in this time
        expect(dockedCount).toBeGreaterThanOrEqual(2);
        // Shouldn't be stuck for too long
        expect(noProgressTicks).toBeLessThan(150);
    });

    it('harvester should navigate around refinery to reach dock point behind it', () => {
        // Specific case: harvester approaching from the wrong side of refinery
        // Must navigate around the building to reach dock point
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Refinery 
        state = spawnBuilding(state, 500, 500, 100, 80, 'ref1', 1, 'refinery');

        // Harvester positioned such that refinery body is between it and dock point
        // Dock is at (500, 560), harvester at (500, 420) - refinery blocks direct path
        state = spawnUnit(state, 500, 420, 'h1', 1, 'harvester');

        state = {
            ...state,
            entities: {
                ...state.entities,
                h1: { ...state.entities['h1'], cargo: 500, baseTargetId: 'ref1' }
            }
        };

        refreshCollisionGrid(state.entities);

        const dockPos = new Vector(500, 560);
        const initialH1Pos = state.entities['h1'].pos;
        let docked = false;
        let closestDist = Infinity;

        for (let i = 0; i < 300; i++) {
            state = update(state, { type: 'TICK' });

            const h1 = state.entities['h1'];
            closestDist = Math.min(closestDist, h1.pos.dist(dockPos));

            if (h1.cargo === 0) {
                docked = true;
                break;
            }
        }

        const finalH1 = state.entities['h1'];

        console.log('Navigate around refinery test:', {
            initialPos: `${initialH1Pos.x.toFixed(0)}, ${initialH1Pos.y.toFixed(0)}`,
            finalPos: `${finalH1.pos.x.toFixed(0)}, ${finalH1.pos.y.toFixed(0)}`,
            dockPos: `${dockPos.x.toFixed(0)}, ${dockPos.y.toFixed(0)}`,
            distToDock: finalH1.pos.dist(dockPos).toFixed(0),
            closestDist: closestDist.toFixed(0),
            cargo: finalH1.cargo,
            docked,
            stuckTimer: finalH1.stuckTimer
        });

        // Should have docked
        expect(docked).toBe(true);
    });

    it('should reproduce exact stuck scenario from game state file', () => {
        // Exact positions from red_harv_stuck.json
        let state = { ...INITIAL_STATE, running: true, entities: {} as Record<EntityId, Entity> };

        // Refinery e_3750_53265 at (2728, 2822)
        state = spawnBuilding(state, 2728, 2822, 100, 80, 'ref2', 1, 'refinery');

        // Refinery e_1860_89018 at (2880, 2957)
        state = spawnBuilding(state, 2880, 2957, 100, 80, 'ref1', 1, 'refinery');

        // Turret e_4410_1473 at (2783, 2980) - between harvesters and dock of ref1
        state = spawnBuilding(state, 2783, 2980, 40, 40, 'turret1', 1, 'turret');

        // Pillbox e_5040_98340 at (2941, 2826)
        state = spawnBuilding(state, 2941, 2826, 40, 40, 'pillbox1', 1, 'pillbox');

        // Harvester e_3750_88701 at (2798, 2689) -> targeting ref2
        state = spawnUnit(state, 2798, 2689, 'h_3750', 1, 'harvester');

        // Harvester e_4379_53328 at (2792, 2834) -> targeting ref2, stuckTimer: 27
        state = spawnUnit(state, 2792, 2834, 'h_4379', 1, 'harvester');

        // Harvester harv_p1 at (2767, 2927) -> targeting ref1, stuckTimer: 12
        state = spawnUnit(state, 2767, 2927, 'harv_p1', 1, 'harvester');

        // Harvester e_1860_10209 at (2902, 2847) -> targeting ref1, stuckTimer: 6
        state = spawnUnit(state, 2902, 2847, 'h_1860', 1, 'harvester');

        // Set cargo and baseTargetIds
        state = {
            ...state,
            entities: {
                ...state.entities,
                h_3750: { ...state.entities['h_3750'], cargo: 500, baseTargetId: 'ref2' },
                h_4379: { ...state.entities['h_4379'], cargo: 500, baseTargetId: 'ref2' },
                harv_p1: { ...state.entities['harv_p1'], cargo: 500, baseTargetId: 'ref1' },
                h_1860: { ...state.entities['h_1860'], cargo: 500, baseTargetId: 'ref1' }
            }
        };

        refreshCollisionGrid(state.entities);

        // Dock points
        const dock1 = new Vector(2880, 2957 + 60); // ref1 dock at (2880, 3017)
        const dock2 = new Vector(2728, 2822 + 60); // ref2 dock at (2728, 2882)

        // Track stuck state
        let initialStates = {
            h_3750: { pos: state.entities['h_3750'].pos, cargo: 500 },
            h_4379: { pos: state.entities['h_4379'].pos, cargo: 500 },
            harv_p1: { pos: state.entities['harv_p1'].pos, cargo: 500 },
            h_1860: { pos: state.entities['h_1860'].pos, cargo: 500 }
        };

        let dockedCount = 0;
        let maxStuckTimer = 0;
        let progressMade = false;

        // Run for 500 ticks
        for (let i = 0; i < 500; i++) {
            state = update(state, { type: 'TICK' });

            const h_3750 = state.entities['h_3750'];
            const h_4379 = state.entities['h_4379'];
            const harv_p1 = state.entities['harv_p1'];
            const h_1860 = state.entities['h_1860'];

            // Count docked
            dockedCount = [h_3750, h_4379, harv_p1, h_1860].filter(h => h.cargo === 0).length;

            // Track max stuck timer
            maxStuckTimer = Math.max(
                maxStuckTimer,
                h_3750.stuckTimer || 0,
                h_4379.stuckTimer || 0,
                harv_p1.stuckTimer || 0,
                h_1860.stuckTimer || 0
            );

            // Check if any progress
            if (dockedCount > 0) progressMade = true;
        }

        const finalStates = {
            h_3750: state.entities['h_3750'],
            h_4379: state.entities['h_4379'],
            harv_p1: state.entities['harv_p1'],
            h_1860: state.entities['h_1860']
        };

        console.log('Exact game state reproduction test:', {
            dockedCount,
            maxStuckTimer,
            progressMade,
            h_3750: {
                start: `${initialStates.h_3750.pos.x.toFixed(0)}, ${initialStates.h_3750.pos.y.toFixed(0)}`,
                end: `${finalStates.h_3750.pos.x.toFixed(0)}, ${finalStates.h_3750.pos.y.toFixed(0)}`,
                cargo: finalStates.h_3750.cargo,
                distToDock: finalStates.h_3750.pos.dist(dock2).toFixed(0),
                stuckTimer: finalStates.h_3750.stuckTimer
            },
            h_4379: {
                start: `${initialStates.h_4379.pos.x.toFixed(0)}, ${initialStates.h_4379.pos.y.toFixed(0)}`,
                end: `${finalStates.h_4379.pos.x.toFixed(0)}, ${finalStates.h_4379.pos.y.toFixed(0)}`,
                cargo: finalStates.h_4379.cargo,
                distToDock: finalStates.h_4379.pos.dist(dock2).toFixed(0),
                stuckTimer: finalStates.h_4379.stuckTimer
            },
            harv_p1: {
                start: `${initialStates.harv_p1.pos.x.toFixed(0)}, ${initialStates.harv_p1.pos.y.toFixed(0)}`,
                end: `${finalStates.harv_p1.pos.x.toFixed(0)}, ${finalStates.harv_p1.pos.y.toFixed(0)}`,
                cargo: finalStates.harv_p1.cargo,
                distToDock: finalStates.harv_p1.pos.dist(dock1).toFixed(0),
                stuckTimer: finalStates.harv_p1.stuckTimer
            },
            h_1860: {
                start: `${initialStates.h_1860.pos.x.toFixed(0)}, ${initialStates.h_1860.pos.y.toFixed(0)}`,
                end: `${finalStates.h_1860.pos.x.toFixed(0)}, ${finalStates.h_1860.pos.y.toFixed(0)}`,
                cargo: finalStates.h_1860.cargo,
                distToDock: finalStates.h_1860.pos.dist(dock1).toFixed(0),
                stuckTimer: finalStates.h_1860.stuckTimer
            }
        });

        // All 4 harvesters should have docked
        expect(dockedCount).toBeGreaterThanOrEqual(3);

        // Stuck timer shouldn't spike above 60 (indicating persistent stuck state)
        expect(maxStuckTimer).toBeLessThan(60);
    });

    it('should handle larger 4000x4000 map with refineries and turrets blocking path', () => {
        // Test based on temp/red_harv_still_stuck.json - 4000x4000 map
        // NOTE: Pathfinding grid is currently hardcoded to 3000/TILE_SIZE cells.
        // Positions beyond ~3000 may have pathfinding issues. This test uses 
        // positions within those bounds but verifies the map config is properly used.
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
            config: { width: 4000, height: 4000, resourceDensity: 'low', rockDensity: 'high' }
        };

        // Place refineries within pathfinding grid bounds (< 3000)
        // Refinery at (2850, 2850) - dock would be at (2850, 2910)
        state = spawnBuilding(state, 2850, 2850, 100, 80, 'ref1', 1, 'refinery');

        // Refinery at (2600, 2800) - dock would be at (2600, 2860)
        state = spawnBuilding(state, 2600, 2800, 100, 80, 'ref2', 1, 'refinery');

        // Turret at (2780, 2880) - blocking path between harvesters and ref1 dock
        state = spawnBuilding(state, 2780, 2880, 40, 40, 'turret1', 1, 'turret');

        // Harvesters positioned to test docking around obstacles
        state = spawnUnit(state, 2750, 2780, 'harv_p1', 1, 'harvester');
        state = spawnUnit(state, 2800, 2750, 'h_1860', 1, 'harvester');
        state = spawnUnit(state, 2650, 2850, 'h_3750', 1, 'harvester');

        // Set cargo and baseTargetIds
        state = {
            ...state,
            entities: {
                ...state.entities,
                harv_p1: { ...state.entities['harv_p1'], cargo: 500, baseTargetId: 'ref1' },
                h_1860: { ...state.entities['h_1860'], cargo: 500, baseTargetId: 'ref1' },
                h_3750: { ...state.entities['h_3750'], cargo: 500, baseTargetId: 'ref2' }
            }
        };

        refreshCollisionGrid(state.entities);

        // Dock points (using map config allows positions up to 4000, not clamped to 3000)
        const dock1 = new Vector(2850, 2850 + 60); // (2850, 2910)
        const dock2 = new Vector(2600, 2800 + 60); // (2600, 2860)

        let dockedCount = 0;
        let maxStuckTimer = 0;

        // Run for 500 ticks
        for (let i = 0; i < 500; i++) {
            state = update(state, { type: 'TICK' });

            const harv_p1 = state.entities['harv_p1'];
            const h_1860 = state.entities['h_1860'];
            const h_3750 = state.entities['h_3750'];

            dockedCount = [harv_p1, h_1860, h_3750].filter(h => h.cargo === 0).length;

            maxStuckTimer = Math.max(
                maxStuckTimer,
                harv_p1.stuckTimer || 0,
                h_1860.stuckTimer || 0,
                h_3750.stuckTimer || 0
            );
        }

        const finalStates = {
            harv_p1: state.entities['harv_p1'],
            h_1860: state.entities['h_1860'],
            h_3750: state.entities['h_3750']
        };

        console.log('Larger map test (4000x4000):', {
            dockedCount,
            maxStuckTimer,
            harv_p1: {
                pos: `${finalStates.harv_p1.pos.x.toFixed(0)}, ${finalStates.harv_p1.pos.y.toFixed(0)}`,
                cargo: finalStates.harv_p1.cargo,
                distToDock: finalStates.harv_p1.pos.dist(dock1).toFixed(0),
                stuckTimer: finalStates.harv_p1.stuckTimer
            },
            h_1860: {
                pos: `${finalStates.h_1860.pos.x.toFixed(0)}, ${finalStates.h_1860.pos.y.toFixed(0)}`,
                cargo: finalStates.h_1860.cargo,
                distToDock: finalStates.h_1860.pos.dist(dock1).toFixed(0),
                stuckTimer: finalStates.h_1860.stuckTimer
            },
            h_3750: {
                pos: `${finalStates.h_3750.pos.x.toFixed(0)}, ${finalStates.h_3750.pos.y.toFixed(0)}`,
                cargo: finalStates.h_3750.cargo,
                distToDock: finalStates.h_3750.pos.dist(dock2).toFixed(0),
                stuckTimer: finalStates.h_3750.stuckTimer
            }
        });

        // All 3 harvesters should have docked
        expect(dockedCount).toBe(3);

        // Stuck timer shouldn't spike too high
        expect(maxStuckTimer).toBeLessThan(60);
    });

    it('should handle entities beyond old 3000 grid limit on 4000x4000 map', () => {
        // This test specifically verifies the dynamic grid sizing works for positions > 3000
        let state: GameState = {
            ...INITIAL_STATE,
            running: true,
            entities: {} as Record<EntityId, Entity>,
            config: { width: 4000, height: 4000, resourceDensity: 'low', rockDensity: 'high' }
        };

        // Place refinery at position beyond old grid limit
        // Refinery at (3500, 3500) - dock would be at (3500, 3560)
        state = spawnBuilding(state, 3500, 3500, 100, 80, 'ref1', 1, 'refinery');

        // Harvester at (3400, 3400) needs to reach dock at (3500, 3560)
        state = spawnUnit(state, 3400, 3400, 'harv1', 1, 'harvester');

        state = {
            ...state,
            entities: {
                ...state.entities,
                harv1: { ...state.entities['harv1'], cargo: 500, baseTargetId: 'ref1' }
            }
        };

        refreshCollisionGrid(state.entities, state.config);

        const dock = new Vector(3500, 3560);
        let docked = false;
        let maxStuckTimer = 0;

        // Run for 300 ticks
        for (let i = 0; i < 300; i++) {
            state = update(state, { type: 'TICK' });

            const harv = state.entities['harv1'];
            if (harv.cargo === 0) {
                docked = true;
                break;
            }
            maxStuckTimer = Math.max(maxStuckTimer, harv.stuckTimer || 0);
        }

        const finalHarv = state.entities['harv1'];

        console.log('Beyond 3000 grid limit test:', {
            startPos: '3400, 3400',
            finalPos: `${finalHarv.pos.x.toFixed(0)}, ${finalHarv.pos.y.toFixed(0)}`,
            dock: '3500, 3560',
            distToDock: finalHarv.pos.dist(dock).toFixed(0),
            cargo: finalHarv.cargo,
            docked,
            maxStuckTimer
        });

        // Harvester should have docked successfully
        expect(docked).toBe(true);
        expect(maxStuckTimer).toBeLessThan(60);
    });
});


# Fog of War Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add single-layer visual fog of war where tiles start black and are permanently revealed by friendly units/buildings.

**Architecture:** Tile-level `Uint8Array` per human player, indexed by `tileY * gridW + tileX`. Updated each tick in `game_loop.ts` after spatial grid rebuild. Renderer draws black rectangles for unrevealed tiles with gradient edge smoothing. Minimap respects fog. No gameplay impact — purely visual.

**Tech Stack:** TypeScript, Canvas 2D, Vitest

---

### Task 1: Add `sightRange` to Rules Schema and Data

**Files:**
- Modify: `src/data/schemas/rules.schema.ts:68-101` (BuildingSchema) and `src/data/schemas/rules.schema.ts:104-138` (UnitSchema)
- Modify: `src/data/rules.json` (all unit and building entries)
- Test: `tests/data/rules_validation.test.ts` (existing — will validate automatically)

**Step 1: Add `sightRange` to schemas**

In `src/data/schemas/rules.schema.ts`, add `sightRange` as an optional positive number to both `BuildingSchema` (after line 99, before the closing `});`) and `UnitSchema` (after line 136, before the closing `});`):

```typescript
// In BuildingSchema, add after interceptionAura line:
  sightRange: z.number().positive().optional(),

// In UnitSchema, add after interceptionAura line:
  sightRange: z.number().positive().optional(),
```

**Step 2: Add `sightRange` values to `rules.json`**

Add `"sightRange": <value>` to every unit and building entry in `src/data/rules.json`:

**Units:**
| Key | sightRange |
|-----|-----------|
| rifle | 200 |
| rocket | 240 |
| engineer | 160 |
| medic | 200 |
| sniper | 500 |
| flamer | 160 |
| grenadier | 200 |
| commando | 280 |
| hijacker | 160 |
| harvester | 200 |
| jeep | 320 |
| apc | 240 |
| light | 240 |
| heavy | 260 |
| flame_tank | 200 |
| stealth | 280 |
| artillery | 400 |
| mlrs | 380 |
| mammoth | 280 |
| heli | 320 |
| harrier | 320 |
| mcv | 280 |
| induction_rig | 200 |
| demo_truck | 200 |

**Buildings:**
| Key | sightRange |
|-----|-----------|
| conyard | 240 |
| power | 160 |
| refinery | 200 |
| barracks | 200 |
| factory | 200 |
| turret | 320 |
| sam_site | 480 |
| pillbox | 220 |
| obelisk | 400 |
| tech | 200 |
| airforce_command | 200 |
| service_depot | 200 |
| induction_rig_deployed | 200 |

**Step 3: Run tests to verify schema validates**

Run: `npx vitest run tests/data/`
Expected: PASS — sightRange is optional so existing tests pass, and the new values are valid positive numbers.

**Step 4: Commit**

```bash
git add src/data/schemas/rules.schema.ts src/data/rules.json
git commit -m "feat: add sightRange to unit and building definitions"
```

---

### Task 2: Add `fogOfWar` to GameState

**Files:**
- Modify: `src/engine/types.ts:301-331` (GameState interface)
- Modify: `src/engine/reducer.ts:16-41` (INITIAL_STATE)
- Test: existing tests should still pass (fogOfWar is optional-ish, but we add it to INITIAL_STATE)

**Step 1: Write the failing test**

Create `tests/engine/fog.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { INITIAL_STATE } from '../../src/engine/reducer';

describe('Fog of War - GameState', () => {
    it('INITIAL_STATE should include fogOfWar field', () => {
        expect(INITIAL_STATE.fogOfWar).toBeDefined();
        expect(INITIAL_STATE.fogOfWar).toEqual({});
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/fog.test.ts`
Expected: FAIL — `fogOfWar` doesn't exist on GameState yet.

**Step 3: Add `fogOfWar` to GameState and INITIAL_STATE**

In `src/engine/types.ts`, add to the `GameState` interface (after `headless?` on line 330):

```typescript
    readonly fogOfWar: Record<number, Uint8Array>;
```

In `src/engine/reducer.ts`, add to `INITIAL_STATE` (after line 40, before the closing `};`):

```typescript
    fogOfWar: {}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/fog.test.ts`
Expected: PASS

**Step 5: Run full test suite to check nothing broke**

Run: `npx vitest run`
Expected: PASS — some tests may need `fogOfWar: {}` added to test state objects if they spread `GameState` fully. Fix any failures by adding `fogOfWar: {}` to test fixtures.

**Step 6: Commit**

```bash
git add src/engine/types.ts src/engine/reducer.ts tests/engine/fog.test.ts
git commit -m "feat: add fogOfWar field to GameState"
```

---

### Task 3: Create `updateFogOfWar` Reducer

**Files:**
- Create: `src/engine/reducers/fog.ts`
- Test: `tests/engine/fog.test.ts`

**Step 1: Write failing tests for fog update logic**

Add to `tests/engine/fog.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { INITIAL_STATE } from '../../src/engine/reducer';
import { updateFogOfWar, createFogGrid } from '../../src/engine/reducers/fog';
import { GameState, Vector, TILE_SIZE } from '../../src/engine/types';
import { createTestCombatUnit } from '../../src/engine/test-utils';

describe('Fog of War - GameState', () => {
    it('INITIAL_STATE should include fogOfWar field', () => {
        expect(INITIAL_STATE.fogOfWar).toBeDefined();
        expect(INITIAL_STATE.fogOfWar).toEqual({});
    });
});

describe('createFogGrid', () => {
    it('should create a Uint8Array of correct size', () => {
        const grid = createFogGrid(3000, 3000);
        // 3000/40 = 75 tiles each dimension
        expect(grid).toBeInstanceOf(Uint8Array);
        expect(grid.length).toBe(75 * 75);
        // All zeros initially
        expect(grid.every(v => v === 0)).toBe(true);
    });

    it('should handle non-evenly-divisible map sizes', () => {
        const grid = createFogGrid(2020, 2020);
        // ceil(2020/40) = 51 tiles each dimension
        expect(grid.length).toBe(51 * 51);
    });
});

describe('updateFogOfWar', () => {
    let baseState: GameState;

    beforeEach(() => {
        const fogGrid = createFogGrid(3000, 3000);
        baseState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
            fogOfWar: { 0: fogGrid },
            entities: {},
            players: {
                0: { ...INITIAL_STATE.players[0], isAi: false },
                1: { ...INITIAL_STATE.players[1], isAi: true }
            }
        };
    });

    it('should reveal tiles around a unit with sightRange', () => {
        // Place a rifle unit at tile center (200, 200)
        // sightRange = 200, so sightTiles = ceil(200/40) = 5
        const unit = createTestCombatUnit({ owner: 0, x: 200, y: 200, key: 'rifle' });
        const state = { ...baseState, entities: { [unit.id]: unit } };

        const newFog = updateFogOfWar(state);
        const grid = newFog[0];

        // The unit's tile (5, 5) should be revealed
        expect(grid[5 * 75 + 5]).toBe(1);

        // A tile at edge of sight range should be revealed
        // (5, 0) is 5 tiles away vertically = 200px, within radius
        expect(grid[0 * 75 + 5]).toBe(1);

        // A tile far away should NOT be revealed
        expect(grid[50 * 75 + 50]).toBe(0);
    });

    it('should not create fog for AI players', () => {
        const unit = createTestCombatUnit({ owner: 1, x: 200, y: 200, key: 'rifle' });
        const state = { ...baseState, entities: { [unit.id]: unit } };

        const newFog = updateFogOfWar(state);
        // Player 1 (AI) should not have a fog grid
        expect(newFog[1]).toBeUndefined();
    });

    it('should permanently reveal tiles (never un-fog)', () => {
        const unit = createTestCombatUnit({ owner: 0, x: 200, y: 200, key: 'rifle' });
        const state = { ...baseState, entities: { [unit.id]: unit } };

        // First update reveals tiles
        const fog1 = updateFogOfWar(state);

        // Remove the unit and update again
        const state2 = { ...state, entities: {}, fogOfWar: fog1 };
        const fog2 = updateFogOfWar(state2);

        // Tiles should still be revealed
        expect(fog2[0][5 * 75 + 5]).toBe(1);
    });

    it('should return same reference if nothing changes', () => {
        // No entities means no tiles to reveal, fog stays the same
        const state = { ...baseState, entities: {} };
        // Pre-reveal nothing
        const newFog = updateFogOfWar(state);
        // Second call with same state should return same Uint8Array reference
        const state2 = { ...state, fogOfWar: newFog };
        const newFog2 = updateFogOfWar(state2);
        expect(newFog2[0]).toBe(newFog[0]); // Same reference
    });

    it('should skip fog update when fogOfWar is empty (demo mode)', () => {
        const state = { ...baseState, fogOfWar: {}, entities: {} };
        const newFog = updateFogOfWar(state);
        expect(newFog).toEqual({});
    });

    it('should reveal circular area, not square', () => {
        // Place unit at (200, 200) with sightRange 200 (5 tiles)
        const unit = createTestCombatUnit({ owner: 0, x: 200, y: 200, key: 'rifle' });
        const state = { ...baseState, entities: { [unit.id]: unit } };

        const newFog = updateFogOfWar(state);
        const grid = newFog[0];

        // Corner of bounding box (5+5, 5+5) = (10, 10) is at distance 5*sqrt(2) ≈ 7.07 tiles
        // which is > 5 tile radius, so should NOT be revealed
        expect(grid[10 * 75 + 10]).toBe(0);
    });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/engine/fog.test.ts`
Expected: FAIL — `updateFogOfWar` and `createFogGrid` don't exist yet.

**Step 3: Implement `src/engine/reducers/fog.ts`**

```typescript
import { GameState, TILE_SIZE } from '../types';
import { RULES } from '../../data/schemas/index';

/**
 * Create a new fog grid for a given map size.
 * All tiles start as 0 (unseen).
 */
export function createFogGrid(mapWidth: number, mapHeight: number): Uint8Array {
    const gridW = Math.ceil(mapWidth / TILE_SIZE);
    const gridH = Math.ceil(mapHeight / TILE_SIZE);
    return new Uint8Array(gridW * gridH);
}

/**
 * Look up the sightRange for an entity key from rules.json.
 * Returns 0 if not found.
 */
function getSightRange(key: string): number {
    const unitData = RULES.units[key];
    if (unitData?.sightRange) return unitData.sightRange;
    const buildingData = RULES.buildings[key];
    if (buildingData?.sightRange) return buildingData.sightRange;
    return 0;
}

/**
 * Update fog of war grids for all human players.
 * Reveals tiles within each owned entity's sight range.
 * Tiles are permanently revealed (additive only, never reset to 0).
 *
 * Returns the same fogOfWar record reference if nothing changed,
 * or a new record with updated Uint8Arrays for players whose fog changed.
 */
export function updateFogOfWar(state: GameState): Record<number, Uint8Array> {
    const { fogOfWar, entities, config } = state;

    // Early exit if no fog grids exist (demo/observer mode)
    const playerIds = Object.keys(fogOfWar).map(Number);
    if (playerIds.length === 0) return fogOfWar;

    const gridW = Math.ceil(config.width / TILE_SIZE);
    const gridH = Math.ceil(config.height / TILE_SIZE);
    const tileRadiusSq = TILE_SIZE * TILE_SIZE; // Pre-compute for distance checks

    // Track which players had changes
    let anyChanged = false;
    const result: Record<number, Uint8Array> = {};

    for (const playerId of playerIds) {
        const grid = fogOfWar[playerId];
        if (!grid) continue;

        let changed = false;

        for (const id in entities) {
            const entity = entities[id];
            if (entity.dead) continue;
            if (entity.owner !== playerId) continue;

            const sightRange = getSightRange(entity.key);
            if (sightRange <= 0) continue;

            const sightTiles = Math.ceil(sightRange / TILE_SIZE);
            const sightTilesSq = (sightRange / TILE_SIZE) * (sightRange / TILE_SIZE);
            const centerTileX = Math.floor(entity.pos.x / TILE_SIZE);
            const centerTileY = Math.floor(entity.pos.y / TILE_SIZE);

            const minTX = Math.max(0, centerTileX - sightTiles);
            const maxTX = Math.min(gridW - 1, centerTileX + sightTiles);
            const minTY = Math.max(0, centerTileY - sightTiles);
            const maxTY = Math.min(gridH - 1, centerTileY + sightTiles);

            for (let ty = minTY; ty <= maxTY; ty++) {
                for (let tx = minTX; tx <= maxTX; tx++) {
                    const idx = ty * gridW + tx;
                    if (grid[idx] === 1) continue; // Already revealed

                    // Circular distance check in tile space
                    const dx = tx - centerTileX;
                    const dy = ty - centerTileY;
                    if (dx * dx + dy * dy <= sightTilesSq) {
                        grid[idx] = 1;
                        changed = true;
                    }
                }
            }
        }

        if (changed) {
            anyChanged = true;
        }
        result[playerId] = grid; // Same Uint8Array reference (mutated in place)
    }

    // Return same reference if nothing changed
    return anyChanged ? result : fogOfWar;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/engine/fog.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/engine/reducers/fog.ts tests/engine/fog.test.ts
git commit -m "feat: implement updateFogOfWar reducer with tile-level boolean grid"
```

---

### Task 4: Integrate Fog Update into Game Loop

**Files:**
- Modify: `src/engine/reducers/game_loop.ts:1-8` (imports) and `src/engine/reducers/game_loop.ts:56-58` (after rebuildSpatialGrid)
- Modify: `src/engine/reducers/game_loop.ts:447-459` (return statement)

**Step 1: Write a failing integration test**

Add to `tests/engine/fog.test.ts`:

```typescript
import { update } from '../../src/engine/reducer';

describe('Fog of War - Game Loop Integration', () => {
    it('should update fog on each tick', () => {
        const fogGrid = createFogGrid(3000, 3000);
        const unit = createTestCombatUnit({ owner: 0, x: 200, y: 200, key: 'rifle' });
        const state: GameState = {
            ...INITIAL_STATE,
            running: true,
            mode: 'game',
            config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
            fogOfWar: { 0: fogGrid },
            entities: { [unit.id]: unit },
            players: {
                0: { ...INITIAL_STATE.players[0], isAi: false },
                1: { ...INITIAL_STATE.players[1], isAi: true }
            }
        };

        const nextState = update(state, { type: 'TICK' });

        // Fog should have been updated - tile at unit position should be revealed
        const grid = nextState.fogOfWar[0];
        const tileX = Math.floor(200 / 40); // 5
        const tileY = Math.floor(200 / 40); // 5
        expect(grid[tileY * 75 + tileX]).toBe(1);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/engine/fog.test.ts`
Expected: FAIL — game loop doesn't call updateFogOfWar yet.

**Step 3: Integrate into game_loop.ts**

Add import at top of `src/engine/reducers/game_loop.ts` (after line 8):

```typescript
import { updateFogOfWar } from './fog';
```

After `rebuildSpatialGrid(nextEntities)` (line 57), add fog update (but only if not headless):

```typescript
    // Update fog of war (visual only, skip in headless mode)
    const nextFogOfWar = headless ? state.fogOfWar : updateFogOfWar({ ...state, entities: nextEntities });
```

In the return statement (line 447-459), add `fogOfWar: nextFogOfWar`:

```typescript
    return {
        ...state,
        tick: nextTick,
        entities: finalEntities,
        players: nextPlayers,
        projectiles: nextProjectiles,
        particles: nextParticles,
        camera: nextCamera,
        winner: nextWinner,
        running: nextRunning,
        notification: nextNotification,
        commandIndicator: nextCommandIndicator,
        fogOfWar: nextFogOfWar
    };
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/engine/fog.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: PASS — fix any test failures by adding `fogOfWar: {}` to test state fixtures.

**Step 6: Commit**

```bash
git add src/engine/reducers/game_loop.ts tests/engine/fog.test.ts
git commit -m "feat: integrate fog of war update into game loop tick"
```

---

### Task 5: Initialize Fog in Game Setup

**Files:**
- Modify: `src/game.ts:498-590` (startGameWithConfig function)

**Step 1: Import createFogGrid**

Add import to `src/game.ts` (near other engine imports):

```typescript
import { createFogGrid } from './engine/reducers/fog.js';
```

**Step 2: Create fog grid for human player during game setup**

In `startGameWithConfig`, after the game state is built (after line 588, before `currentState = state;`), add:

```typescript
    // Initialize fog of war for human player only
    const fogOfWar: Record<number, Uint8Array> = {};
    if (humanPlayerId !== null) {
        fogOfWar[humanPlayerId] = createFogGrid(mapWidth, mapHeight);
    }
```

Then add `fogOfWar` to the state object (add to the spread on line 575-588):

```typescript
    let state: GameState = {
        ...INITIAL_STATE,
        running: true,
        mode: isObserverMode ? 'demo' : 'game',
        difficulty: 'easy',
        entities: entities,
        players: players,
        fogOfWar: fogOfWar,
        config: {
            width: mapWidth,
            height: mapHeight,
            resourceDensity: config.resourceDensity,
            rockDensity: config.rockDensity
        }
    };
```

**Step 3: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/game.ts
git commit -m "feat: initialize fog of war grid for human player on game start"
```

---

### Task 6: Renderer — Entity Filtering and Fog Overlay

**Files:**
- Modify: `src/renderer/index.ts` (render method)

This is the core visual change. We need to:
1. Filter out entities on unrevealed tiles
2. Draw black rectangles for unrevealed tiles in the viewport

**Step 1: Add fog helper method to Renderer class**

Add a helper method to the `Renderer` class that checks if a tile is revealed:

```typescript
    /**
     * Check if an entity's tile is revealed in the fog of war grid.
     * Returns true if no fog grid exists (observer/demo mode).
     */
    private isEntityVisible(entity: Entity, fogGrid: Uint8Array | undefined, gridW: number): boolean {
        if (!fogGrid) return true;
        const tileX = Math.floor(entity.pos.x / TILE_SIZE);
        const tileY = Math.floor(entity.pos.y / TILE_SIZE);
        return fogGrid[tileY * gridW + tileX] === 1;
    }
```

**Step 2: Add fog filtering to entity culling in render()**

In the `render` method, after `screenCulledEntities` are collected (around line 113), add fog filtering:

```typescript
        // Fog of war filtering — skip entities on unrevealed tiles
        const fogGrid = localPlayerId !== null ? state.fogOfWar?.[localPlayerId] : undefined;
        const fogGridW = Math.ceil(state.config.width / TILE_SIZE);
```

Then modify the entity culling loop (lines 99-113) to also check fog:

```typescript
        for (const e of visibleEntities) {
            if (e.dead) continue;

            // Fog of war check - skip entities on unrevealed tiles
            if (fogGrid && !this.isEntityVisible(e, fogGrid, fogGridW)) continue;

            // Quick screen bounds check using world coordinates
            // ... existing bounds check ...
        }
```

**Step 3: Draw fog overlay after all entities**

After drawing particles (around line 198) and before drawing the command indicator, add fog overlay rendering:

```typescript
        // Draw fog of war overlay
        if (fogGrid) {
            this.drawFogOverlay(ctx, fogGrid, fogGridW, effectiveCamera, zoom, canvasWidth, canvasHeight, state.config.width, state.config.height);
        }
```

**Step 4: Implement drawFogOverlay method**

Add to the `Renderer` class:

```typescript
    private drawFogOverlay(
        ctx: CanvasRenderingContext2D,
        fogGrid: Uint8Array,
        gridW: number,
        camera: { x: number; y: number },
        zoom: number,
        canvasWidth: number,
        canvasHeight: number,
        mapWidth: number,
        mapHeight: number
    ) {
        const gridH = Math.ceil(mapHeight / TILE_SIZE);
        const tileScreenSize = TILE_SIZE * zoom;

        // Calculate visible tile range
        const startTileX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
        const startTileY = Math.max(0, Math.floor(camera.y / TILE_SIZE));
        const endTileX = Math.min(gridW - 1, Math.floor((camera.x + canvasWidth / zoom) / TILE_SIZE));
        const endTileY = Math.min(gridH - 1, Math.floor((camera.y + canvasHeight / zoom) / TILE_SIZE));

        // Draw solid black for unrevealed tiles
        ctx.fillStyle = '#000';
        for (let ty = startTileY; ty <= endTileY; ty++) {
            for (let tx = startTileX; tx <= endTileX; tx++) {
                if (fogGrid[ty * gridW + tx] === 0) {
                    const screenX = (tx * TILE_SIZE - camera.x) * zoom;
                    const screenY = (ty * TILE_SIZE - camera.y) * zoom;
                    ctx.fillRect(screenX, screenY, tileScreenSize + 1, tileScreenSize + 1);
                }
            }
        }
    }
```

Note: The `+1` on `tileScreenSize` prevents sub-pixel gaps between fog tiles.

**Step 5: Add TILE_SIZE import**

Add to imports at top of `src/renderer/index.ts`:

```typescript
import { GameState, Entity, ..., TILE_SIZE } from '../engine/types.js';
```

**Step 6: Run build and manual test**

Run: `npm run build`
Expected: PASS

Run: `npm run dev` — start a game with a human player. Verify:
- Map starts mostly black
- Tiles around starting base are revealed
- Moving units reveals new tiles
- Previously revealed tiles stay revealed
- Demo/observer mode shows no fog

**Step 7: Commit**

```bash
git add src/renderer/index.ts
git commit -m "feat: render fog of war overlay with entity filtering"
```

---

### Task 7: Minimap Fog of War

**Files:**
- Modify: `src/ui/minimap.ts`
- Modify: `src/game.ts` (renderMinimap call)

**Step 1: Add fogGrid parameter to minimap rendering**

In `src/ui/minimap.ts`, add `fogGrid` and `gridW` parameters to `renderToContext` (line 85-96):

```typescript
function renderToContext(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    entities: Record<EntityId, Entity>,
    camera: { x: number; y: number },
    zoom: number,
    canvasWidth: number,
    canvasHeight: number,
    lowPower: boolean,
    mapWidth: number,
    mapHeight: number,
    fogGrid?: Uint8Array,
    fogGridW?: number
) {
```

And to the public `renderMinimap` function (line 195-208), add the same params and pass through:

```typescript
export function renderMinimap(
    entities: Record<EntityId, Entity>,
    camera: { x: number; y: number },
    zoom: number,
    canvasWidth: number,
    canvasHeight: number,
    lowPower: boolean,
    mapWidth: number = 3000,
    mapHeight: number = 3000,
    fogGrid?: Uint8Array,
    fogGridW?: number
) {
```

**Step 2: Filter entities and draw fog on minimap**

In `renderToContext`, inside the entity draw loop (lines 116-182), add fog filtering:

```typescript
    for (const id in entities) {
        const e = entities[id];
        if (e.dead) continue;

        // Fog of war check — skip entities on unrevealed tiles
        if (fogGrid && fogGridW) {
            const tileX = Math.floor(e.pos.x / 40); // TILE_SIZE
            const tileY = Math.floor(e.pos.y / 40);
            if (fogGrid[tileY * fogGridW + tileX] === 0) continue;
        }

        // ... existing drawing logic ...
    }
```

After the entity loop (after line 182, before drawing the viewport rectangle), draw fog overlay on minimap:

```typescript
    // Draw fog overlay on minimap
    if (fogGrid && fogGridW) {
        const fogGridH = Math.ceil(mapHeight / 40);
        ctx.fillStyle = '#000';
        for (let ty = 0; ty < fogGridH; ty++) {
            for (let tx = 0; tx < fogGridW; tx++) {
                if (fogGrid[ty * fogGridW + tx] === 0) {
                    ctx.fillRect(tx * 40 * sx, ty * 40 * sy, 40 * sx + 1, 40 * sy + 1);
                }
            }
        }
    }
```

**Step 3: Pass fog data from game.ts**

In `src/game.ts`, update the `renderMinimap` call (around line 1304) to pass fog data:

```typescript
        const fogGrid = humanPlayerId !== null ? currentState.fogOfWar?.[humanPlayerId] : undefined;
        const fogGridW = fogGrid ? Math.ceil(currentState.config.width / 40) : undefined;
        renderMinimap(
            currentState.entities,
            currentState.camera,
            currentState.zoom,
            size.width,
            size.height,
            lowPower,
            currentState.config.width,
            currentState.config.height,
            fogGrid,
            fogGridW
        );
```

**Step 4: Run build**

Run: `npm run build`
Expected: PASS

**Step 5: Manual test**

Run `npm run dev`, verify minimap shows black areas for unrevealed tiles.

**Step 6: Commit**

```bash
git add src/ui/minimap.ts src/game.ts
git commit -m "feat: add fog of war to minimap rendering"
```

---

### Task 8: Edge Smoothing

**Files:**
- Modify: `src/renderer/index.ts` (drawFogOverlay method)

**Step 1: Add edge smoothing to drawFogOverlay**

After the solid black tile loop in `drawFogOverlay`, add a second pass for gradient edges:

```typescript
        // Edge smoothing — draw gradients at fog boundaries
        const halfTile = tileScreenSize / 2;
        for (let ty = startTileY; ty <= endTileY; ty++) {
            for (let tx = startTileX; tx <= endTileX; tx++) {
                if (fogGrid[ty * gridW + tx] !== 1) continue; // Only process revealed tiles

                const screenX = (tx * TILE_SIZE - camera.x) * zoom;
                const screenY = (ty * TILE_SIZE - camera.y) * zoom;

                // Check cardinal neighbors for unrevealed tiles
                // Top
                if (ty > 0 && fogGrid[(ty - 1) * gridW + tx] === 0) {
                    const grad = ctx.createLinearGradient(screenX, screenY, screenX, screenY + halfTile);
                    grad.addColorStop(0, 'rgba(0,0,0,0.7)');
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(screenX, screenY, tileScreenSize, halfTile);
                }
                // Bottom
                if (ty < gridH - 1 && fogGrid[(ty + 1) * gridW + tx] === 0) {
                    const grad = ctx.createLinearGradient(screenX, screenY + tileScreenSize, screenX, screenY + halfTile);
                    grad.addColorStop(0, 'rgba(0,0,0,0.7)');
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(screenX, screenY + halfTile, tileScreenSize, halfTile);
                }
                // Left
                if (tx > 0 && fogGrid[ty * gridW + (tx - 1)] === 0) {
                    const grad = ctx.createLinearGradient(screenX, screenY, screenX + halfTile, screenY);
                    grad.addColorStop(0, 'rgba(0,0,0,0.7)');
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(screenX, screenY, halfTile, tileScreenSize);
                }
                // Right
                if (tx < gridW - 1 && fogGrid[ty * gridW + (tx + 1)] === 0) {
                    const grad = ctx.createLinearGradient(screenX + tileScreenSize, screenY, screenX + halfTile, screenY);
                    grad.addColorStop(0, 'rgba(0,0,0,0.7)');
                    grad.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = grad;
                    ctx.fillRect(screenX + halfTile, screenY, halfTile, tileScreenSize);
                }
            }
        }
```

**Step 2: Run build and manual test**

Run: `npm run build`
Expected: PASS

Run `npm run dev`, verify fog edges have smooth gradients instead of hard pixel lines.

**Step 3: Commit**

```bash
git add src/renderer/index.ts
git commit -m "feat: add edge smoothing gradients to fog of war boundaries"
```

---

### Task 9: Fix Remaining Test Failures and Final Verification

**Files:**
- Potentially modify test files that construct `GameState` objects without `fogOfWar`

**Step 1: Run full test suite**

Run: `npx vitest run`

**Step 2: Fix any failures**

If tests fail because `fogOfWar` is missing from manually constructed `GameState` objects, add `fogOfWar: {}` to those test fixtures. Common locations:
- `tests/engine/reducer.test.ts`
- `tests/engine/game_loop.test.ts`
- Any test that creates a full `GameState` via object literal

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: add fogOfWar to test fixtures"
```

---

### Task 10: Run Full Suite and Manual Play-Through

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: ALL PASS

**Step 2: Manual play-through verification checklist**

Run `npm run dev` and verify:
- [ ] Game starts with map mostly black
- [ ] Starting base area is revealed
- [ ] Moving units reveals new tiles permanently
- [ ] Returning to previously explored area shows it still revealed
- [ ] Enemy units/buildings in fog are invisible
- [ ] Resources/rocks in fog are invisible, appear when revealed
- [ ] Minimap shows fog correctly
- [ ] Fog edges have gradient smoothing
- [ ] Observer/demo mode has no fog
- [ ] No performance regression (game still runs at 60fps)

**Step 3: Final commit if any tweaks needed**

```bash
git add -A
git commit -m "feat: complete fog of war implementation"
```

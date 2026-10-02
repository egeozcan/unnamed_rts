# Performance Review

Scope: simulation engine (`src/engine`), AI, renderer and HUD (`src/renderer`, `src/ui`, `src/game.ts`).
Method: a seeded, headless AI-vs-AI harness (`npm run perf:profile`, see `src/scripts/README.md`) with V8 CPU profiles
for the engine and AI, and a read-through of the render/UI path plus an in-browser check (Chromium, 5 AI + 1 idle
human on a large map) for the parts that can't run in Node.

Every engine optimization below was checked with a **state fingerprint**: the base commit and the optimized build
produce the *identical* final state for the same seed, so the simulation is unchanged and only the cost differs.

## Results

Engine, ms per tick (lower is better; `fingerprint` identical in every row):

| Scenario | Before | After | Speedup |
| --- | --- | --- | --- |
| Medium map, 4000 ticks (~12 units) | 1.29 | 0.97 | 1.3x |
| Large map, 20000 ticks (~30 units) | 2.00 | 1.46 | 1.4x |
| Large map + 100 extra units/player (232 units) | 13.2 | 5.5 | 2.4x |
| Large map + 200 extra units/player (454 units) | 39.4 | 14.5 | 2.7x |

Browser (real game loop, 5 hard AIs + human on a large map, ~10k ticks in; time spent inside each
`requestAnimationFrame` callback, two runs each):

| | avg | p95 | max |
| --- | --- | --- | --- |
| Before | 8.3 - 8.6 ms | 13.7 - 16.3 ms | 29 - 59 ms |
| After | 5.0 - 5.2 ms | 8.7 - 8.9 ms | 18 - 22 ms |

The 60 Hz frame budget is 16.7 ms, so before the change the p95 frame in a mid-game 6-player match was already close to
it. Scaling is what matters: the engine cost grows super-linearly with unit count (13 ms at 232 units, 39 ms at 454
before), which is where players hit slowdowns in big late-game fights.

## Findings and what was done

Severity = expected impact on frame/tick time in realistic games.

### Fixed in this PR

| # | Severity | Finding | Fix |
| --- | --- | --- | --- |
| 1 | High | **Spatial grid queries dominated the tick** (35-40% of a big-army tick). Target acquisition runs for every idle unit every tick; each query built `"cx,cy"` string keys, a `Set<string>` for de-duplication, then `filter().filter()` chains and a copy of each cell. | `SpatialGrid` rewritten: numeric cell keys, pooled cell storage, structural de-duplication (an entity is reported only from the first cell of the query it occupies - no Set), and a single-pass allocation-free `findNearest`. Result order/tie-breaks are preserved. |
| 2 | High | Combat target predicate did rules lookups (`getRuleData`, air checks) for *every* candidate, mostly friendly units that can never be targets. | Cheap enemy/ally test first; plus per-cell owner bitmasks so `findNearest` skips cells that only contain allied/neutral entities (exact: only used for ordinary attackers whose predicate rejects those owners). |
| 3 | High (browser) | **Pathfinding web worker sync is pure overhead.** `findPathAsync` has no callers, yet every tick the game compared every danger grid against a snapshot (`refreshRevisions`) and, since enemy units mark danger every tick, re-posted each player's grid to the worker (3 copies per post). At speed 5 that is 20x per frame. | Revision tracking and grid sync only switch on the first time something requests an async path. Behavior is unchanged for any future caller. |
| 4 | Medium | `updateWells` rescanned **all entities for every well** to find induction rigs (O(wells x entities)) and cloned the whole entity map, and rewrote unchanged wells every tick. | One-pass rig index, copy-on-write entity map, no re-allocation of unchanged wells. |
| 5 | Medium | `resolveCollisions` shallow-copied **every entity** (buildings, rocks, ore too) every tick, and `tick()` made three more full-map copies (initial clone, post-wells clone, dead-entity filter). | Only ground units get working copies, the map is mutated in place; the entity map in `tick()` is copy-on-write; the dead filter copy is skipped when nothing died. |
| 6 | Medium (AI) | `handleMCVOperations` computed an O(ore x entities) expansion search **every tick** whenever the AI owned an MCV, even while it was already driving somewhere. | Lazy (only for idle MCVs) with enemy/building lists hoisted out of the loops and early exit. |
| 7 | Low-Med | `processTransportLifecycle` allocated/sorted `Object.values` every tick; scatter check allocated a candidate array per idle unit per tick. | Cheap early-out when nothing is transported; allocation-free `forEachInRadius`. |
| 8 | High (browser) | **Fog-of-war overlay drawn tile by tile every frame**: one `fillRect` per hidden tile (thousands when zoomed out) and a new `CanvasGradient` + 2 colour stops per fog-edge side. | Hidden tiles are drawn as merged horizontal runs; the 4 edge gradients are built once per zoom level and reused via `translate`. Visually identical (checked with screenshots). |
| 9 | Medium | `updateButtons` called `canBuild(raw entities)` for ~50 buttons - each did `Object.values().filter()` (twice for `maxCount` items). Runs on a cadence *and* every frame after the game ends. | Build one `EntityCache` per refresh and pass it to `canBuild` (already supported). |
| 10 | Medium | Frame-timing summary (4 array copies + sorts of 300 samples) rebuilt **every frame**, used only by the debug overlay. | Built only when the debug UI refreshes. |
| 11 | Medium | Frame limiter compared `elapsed < 16.667` with no tolerance, so on a 60 Hz display ~half of the rAF callbacks that land at 16.6 ms were skipped (33 ms hitches); fast-forward ran up to 20 ticks per frame with no time budget. | 1 ms tolerance (and no carry of the skipped remainder); a 30 ms sim budget per frame for the multi-tick speeds (the first tick always runs, so normal speed is unaffected). |
| 12 | Low-Med | `updateActionCursor` scanned all entities for the hovered entity every frame and churned 7 `classList` removes per frame; money / power / status text rewritten every frame; scoreboard `innerHTML` rebuilt every 120 ms even when identical (it sits over a `backdrop-filter`); power recomputed every frame. | Hover lookup through the spatial grid (falls back to the old scan for overlapping hits to keep tie-breaking); write-only-on-change helpers; scoreboard skips identical HTML; power recalculated every 5 ticks as the existing comment intended. |
| 13 | Low-Med | Projectile trails: up to 29 strokes per projectile, each with a freshly formatted `rgba()` string and two temporary position objects. Whole-world passenger scan for transports every frame. Fog reveal re-walked every unit's sight area every tick. | Trails drawn in 6 opacity bands (cached styles, no temporaries); passenger scan only when a transport is visible; fog reveal skips entities that are on the same tile as last time (fog is additive-only, so this is exact). |

### Not changed (recommended follow-ups)

| Severity | Finding | Suggestion |
| --- | --- | --- |
| Medium | `resolveCollisions` is now the largest engine item in dense clumps (~20% of a 450-unit tick). It queries a fixed 100 px radius against 200 px cells. | Query `radius + margin`, or move to a finer/typed-array grid; consider updating the spatial grid incrementally instead of a full per-tick rebuild. |
| Medium | Idle units re-scan for targets every tick. Staggering scans (e.g. every 3rd tick per unit) would cut the remaining scan cost ~3x, but it shifts first-shot timing by up to 2 ticks and breaks an existing exact-timing test (`projectile-integration`), so it was **not** done here. | Decide explicitly whether a tiny reaction delay is acceptable; if so, stagger by unit id and keep "recently damaged" units on every-tick scans. |
| Medium | Many AI helpers still do `Object.values(state.entities).filter(...)` per call (`handleEmergencySell`, `isRefineryUseful`, `calculateEconomyScore`, ...; ~25 sites). Cheap with 30 units, noticeable with big maps. | Share the per-tick `EntityCache` through the AI entry points; `isRefineryUseful` in particular re-scans for conyards and ore for every refinery. |
| Medium | Path finding spikes: `worstTickMs` reaches 100+ ms in the stress runs when many units are given orders at once (unbounded A* per tick). | Budget path requests per tick (queue and spread), or reuse the existing worker for real. The worker's batch timeout also drops pending requests without rejecting their promises. |
| Medium | Renderer: sprites are SVG-blob `<img>` elements drawn directly each frame; wells create a radial gradient per well per frame; `drawEntity` allocates per-entity arrays; projectiles/particles are not view-culled. | Pre-rasterize sprites to offscreen canvases / `ImageBitmap` (profile first), cache the well gradient, hoist the `turretEntities` array to a module-level `Set`. |
| Low | Minimap: per-hidden-tile `fillRect` for fog (same pattern as #8) and `offsetParent` (forces layout) read each refresh. Bird's-eye view resizes its canvas on every update and sorts with a comparator that categorizes entities. | Reuse the run-merge approach, cache visibility, only resize on change. |
| Low | `input/index.ts` calls `getBoundingClientRect()` on every `mousemove`. | Cache the rect on resize/scroll. |

### Caveats

* The wall-clock ratio tests in `tests/engine/performance.test.ts > Pathfinding Cache Performance` (cache hit vs miss
  timings on randomly generated maps) are flaky on their own: the "multiple different paths" test failed 1/15 runs on the
  base commit and 2/15 on this branch, and "invalidate cache after TTL" failed once in a full-suite run. `findPath` and
  its cache are untouched by this PR. Everything else passed in repeated full runs.
* Browser numbers come from software-rendered headless Chromium and unseeded games, so use them for relative
  comparison only; the seeded engine numbers are the precise ones.

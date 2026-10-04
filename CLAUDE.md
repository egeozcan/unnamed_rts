# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based real-time strategy (RTS) game inspired by Command & Conquer. Pure TypeScript - no game frameworks. Rendered by a three.js 3D view (default) or the classic Canvas 2D view (toggle with V or the menu's Graphics option). Supports up to 8 players (human + AI).

## Commands

```bash
npm run dev          # Start dev server with hot reload
npm run build        # Type check + production build
npm test             # Run all tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Generate coverage report to ./coverage/
```

Single test file: `npx vitest run tests/engine/harvester.test.ts`

Balance (army-vs-army sim, see `npm run balance:sim -- --help`):
```bash
npm run balance:sim -- --matrix --budget 6000 --check          # unit-vs-unit RPS matrix
npm run balance:sim -- --comps src/scripts/balance_comps.json --check   # archetype comps
```
Rerun both after changing `rules.json`; AI counter tables live in `src/engine/ai/counters.ts` and must agree with them.

## Architecture

### State Management
Redux-inspired unidirectional data flow with immutable state:
```
User Input → Action → Reducer (src/engine/reducer.ts) → GameState → Renderer
```

All game state updates go through the reducer. State objects are immutable - updates return new objects.

### Core Files

- **src/game.ts** - Main game loop, orchestrator, handles skirmish setup and player input
- **src/engine/reducer.ts** - Main action dispatcher, delegates to modular reducers in reducers/
- **src/engine/reducers/game_loop.ts** - Tick orchestrator, coordinates all subsystems per frame
- **src/engine/ai/index.ts** - AI entry point, coordinates modular AI subsystems
- **src/engine/types.ts** - Core TypeScript interfaces (Entity, GameState, PlayerState, etc.)
- **src/engine/type-guards.ts** - Type narrowing predicates (isUnit, isBuilding, isHarvester, etc.)
- **src/engine/components.ts** - Entity component definitions (MovementComponent, CombatComponent, etc.)
- **src/engine/spatial.ts** - SpatialGrid class for O(1) neighbor queries
- **src/engine/perf.ts** - EntityCache for per-tick entity lookups
- **src/engine/utils.ts** - A* pathfinding, collision grids, spatial queries
- **src/engine/pathfinding.worker.ts** - Web Worker for offloaded pathfinding calculations
- **src/renderer/index.ts** - Renderer: classic Canvas 2D view, plus the 2D overlay (HP bars, selection, tooltips) drawn on top of the 3D view
- **src/renderer/three/** - 3D view (lazy-loaded three.js): `scene.ts` (instanced scene, fog, shadows, projectiles), `models.ts` (procedural low-poly models), `projection.ts` (tilt, model heights, altitudes - no three.js import)
- **src/data/rules.json** - Game balance data (unit/building stats, costs, prerequisites, damage modifiers)

### Key Concepts

**Entities**: Units (`UNIT`), buildings (`BUILDING`), resources (`RESOURCE`), rocks (`ROCK`). All stored in `state.entities` as Record<EntityId, Entity>.

**Components**: Entity behavior is defined by optional components:
- `MovementComponent` - velocity, rotation, pathfinding, stuck detection
- `CombatComponent` - target, cooldown, turret angle
- `HarvesterComponent` - cargo, resource/base targets, dock position
- `AirUnitComponent` - ammo, docking state, home base
- `BuildingStateComponent` - repair status, placement tick

**Type Guards**: Use type guards for type narrowing: `isUnit()`, `isBuilding()`, `isHarvester()`, `isCombatUnit()`, `isAirUnit()`, etc.

**Players**: `state.players` maps player ID (number) to PlayerState with credits, power, and 4 production queues (building, infantry, vehicle, air).

**Production**: Prerequisites defined in rules.json. Buildings/units require specific structures before they can be built.

**Grid System**: TILE_SIZE = 40 pixels. Collision grid and pathfinding operate on this grid.

**Performance Utilities**:
- `EntityCache` (perf.ts) - Single-pass entity categorization per tick for O(1) lookups
- `SpatialGrid` (spatial.ts) - Cell-based partitioning for efficient neighbor queries

**Game Modes**: `'menu'` (setup screen), `'game'` (human playing), `'demo'` (observer/all-AI)

**3D View**: Purely visual - the simulation stays 2D. The camera is a tilted orthographic camera whose ground plane maps to exactly the same pixels as the 2D view (`(world - camera) * zoom`), so input, picking, camera bounds and the minimap are shared by both views. Height only lifts things up the screen by `height * tan(tilt) * zoom`. Model heights in `projection.ts` must match `models.ts` (enforced by `tests/renderer/three-view.test.ts`), and aircraft altitude must keep the drawn aircraft inside the click radius.

**AI Difficulties**: `'dummy'` (builds but never attacks), `'easy'`, `'medium'`, `'hard'`

**Induction Rig**: A deployable unit that converts ore wells into infinite resource extractors. Built at War Factory, deployed by right-clicking on an ore well.

### Directory Structure
```
src/
├── engine/
│   ├── reducers/           # Modular reducer files
│   │   ├── game_loop.ts    # Main tick orchestrator
│   │   ├── helpers.ts      # Shared utilities (canBuild, createEntity, etc.)
│   │   ├── buildings.ts    # Building placement, sell, repair
│   │   ├── units.ts        # Unit creation and updates
│   │   ├── movement.ts     # A* pathfinding, collision avoidance
│   │   ├── combat.ts       # Combat targeting and attacks
│   │   ├── harvester.ts    # Harvester resource gathering
│   │   ├── air_units.ts    # Air unit state machine
│   │   └── production.ts   # Queue management
│   ├── ai/                 # Modular AI system
│   │   ├── index.ts        # Main AI dispatcher
│   │   ├── types.ts        # AI type definitions
│   │   ├── state.ts        # AI state persistence
│   │   ├── utils.ts        # AI_CONSTANTS and helpers
│   │   ├── planning.ts     # Threat detection
│   │   ├── action_economy.ts  # Economic decisions
│   │   ├── action_combat.ts   # Combat decisions
│   │   └── strategy/       # Strategy selection
│   ├── type-guards.ts      # Type narrowing predicates
│   ├── components.ts       # Entity component definitions
│   ├── entity-helpers.ts   # Immutable update helpers
│   ├── spatial.ts          # Spatial hash grid
│   ├── perf.ts             # EntityCache for performance
│   ├── test-utils.ts       # Test entity builders
│   ├── scores.ts           # Player score calculation
│   ├── reducer.ts          # Main action dispatcher
│   ├── types.ts            # Core type definitions
│   └── utils.ts            # Pathfinding, collision grids
├── renderer/
│   ├── assets_data/        # Modular asset definitions (buildings, vehicles, infantry, etc.)
│   ├── three/              # 3D view: scene, models, camera, projection
│   ├── graphics-mode.ts    # 3D/2D preference
│   ├── index.ts            # Canvas rendering + 3D overlay
│   └── assets.ts           # Asset loading
├── ui/
│   ├── index.ts            # Building/unit buttons
│   ├── minimap.ts          # Minimap rendering
│   └── birdsEyeView.ts     # Overview visualization
├── data/
│   ├── schemas/            # Zod validation schemas
│   ├── rules.json          # Game balance data
│   └── ai.json             # AI personality profiles
├── input/                  # Keyboard/mouse/touch handling
└── scripts/                # Utility scripts

tests/                      # 69 test files (617+ tests) mirroring src/ structure
├── engine/                 # Engine tests (reducer, AI, pathfinding, harvesters, air units, etc.)
├── renderer/               # Renderer tests
└── data/                   # Schema tests
```

## Testing

Tests use Vitest. 69 test files with 617+ tests in the `tests/` directory, mirroring the `src/` structure. Comprehensive coverage includes game state immutability, AI behavior (strategies, economy, combat, threat detection), harvester logic, pathfinding, air units, production, and more.

Test utilities in `src/engine/test-utils.ts` provide builder pattern helpers: `createTestHarvester()`, `createTestBuilding()`, `createTestCombatUnit()`, etc.

Under `src/scripts/` there is a script to manipulate game state. It can be run with `npm run manipulate-state`. It allows for removing players, units, and buildings based on various criteria, listing units based on distance, as well as advancing the game simulation. Run `npm run manipulate-state -- --help` for more information.

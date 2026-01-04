# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Browser-based real-time strategy (RTS) game inspired by Command & Conquer. Pure TypeScript with Canvas 2D rendering - no game frameworks. Supports up to 8 players (human + AI).

## Commands

```bash
npm run dev          # Start dev server with hot reload
npm run build        # Type check + production build
npm test             # Run all tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Generate coverage report to ./coverage/
```

Single test file: `npx vitest run tests/engine/harvester.test.ts`

## Architecture

### State Management
Redux-inspired unidirectional data flow with immutable state:
```
User Input → Action → Reducer (src/engine/reducer.ts) → GameState → Renderer
```

All game state updates go through the reducer. State objects are immutable - updates return new objects.

### Core Files

- **src/game.ts** - Main game loop, orchestrator, handles skirmish setup and player input
- **src/engine/reducer.ts** - Pure game state update logic (TICK action drives simulation)
- **src/engine/ai.ts** - AI system with dynamic strategy (buildup/attack/defend/harass)
- **src/engine/types.ts** - All TypeScript interfaces (Entity, GameState, PlayerState, etc.)
- **src/engine/utils.ts** - A* pathfinding, collision grids, spatial queries
- **src/renderer/index.ts** - Canvas 2D rendering engine
- **src/data/rules.json** - Game balance data (unit/building stats, costs, prerequisites, damage modifiers)

### Key Concepts

**Entities**: Units (`UNIT`), buildings (`BUILDING`), resources (`RESOURCE`), rocks (`ROCK`). All stored in `state.entities` as Record<EntityId, Entity>.

**Players**: `state.players` maps player ID (number) to PlayerState with credits, power, and 4 production queues (building, infantry, vehicle, air).

**Production**: Prerequisites defined in rules.json. Buildings/units require specific structures before they can be built.

**Grid System**: TILE_SIZE = 40 pixels. Collision grid and pathfinding operate on this grid.

**Game Modes**: `'menu'` (setup screen), `'game'` (human playing), `'demo'` (observer/all-AI)

### Directory Structure
```
src/
├── engine/          # Core game logic (reducer, AI, pathfinding, types)
├── renderer/        # Canvas rendering and asset management
├── ui/              # Building/unit buttons, minimap
├── input/           # Keyboard/mouse/touch handling
└── data/            # rules.json (balance), ai.json (AI profiles)

tests/               # Test files (mirrors src/ structure)
├── engine/          # Engine tests
├── renderer/        # Renderer tests
└── data/            # Schema tests
```

## Testing

Tests use Vitest. Test files are in the `tests/` directory, mirroring the `src/` structure (e.g., `tests/engine/reducer.test.ts`). Tests cover game state immutability, AI behavior, harvester logic, pathfinding edge cases, and renderer.

Under `src/scripts/` there is a script to manipulate game state. It can be run with `npm run manipulate-state`. It allows for removing players, units, and buildings based on various criteria, listing units based on distance, as well as advancing the game simulation. Run `npm run manipulate-state -- --help` for more information.
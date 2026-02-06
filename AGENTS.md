# AGENTS.md

This file provides guidance for coding agents working in this repository.

## Project Overview

Browser-based real-time strategy game inspired by Command & Conquer.  
Pure TypeScript + Canvas 2D (no game framework), supporting up to 8 players (human + AI).

## Commands

```bash
npm run dev            # Start dev server with hot reload
npm run build          # Type check + production build
npm test               # Run all tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Coverage report in ./coverage/
npm run debug -- ...   # RTS debug CLI/REPL
npm run manipulate-state -- ...  # State manipulation utility
npm run ai:new -- <name>         # Scaffold a new AI implementation
```

Single test file:

```bash
npx vitest run tests/engine/ai_modularity.test.ts
```

## Architecture

### State Management

Redux-inspired immutable flow:

```
Input -> Action -> Reducer (src/engine/reducer.ts) -> GameState -> Renderer
```

All game state updates should go through reducer actions.

### Core Files

- `src/game.ts` - main game loop, skirmish setup, UI wiring
- `src/engine/reducer.ts` - action dispatcher for reducer modules
- `src/engine/reducers/game_loop.ts` - per-tick orchestrator
- `src/engine/types.ts` - core types (`GameState`, `Entity`, `PlayerState`, etc.)
- `src/engine/type-guards.ts` - type narrowing helpers
- `src/engine/perf.ts` - `EntityCache` for per-tick lookups
- `src/engine/spatial.ts` - `SpatialGrid` for neighbor queries
- `src/renderer/index.ts` - rendering pipeline
- `src/data/rules.json` - game rules and balance data
- `src/data/ai.json` - AI personality/strategy config

## AI System (Modular)

The AI system is now implementation-driven and pluggable.

### Key AI Files

- `src/engine/ai/contracts.ts` - AI implementation interfaces
- `src/engine/ai/registry.ts` - implementation registry + defaults
- `src/engine/ai/controller.ts` - resolves selected implementation per player
- `src/engine/ai/implementations/classic/index.ts` - legacy AI logic as `classic`
- `src/engine/ai/index.ts` - public AI exports + compatibility entrypoint

### Runtime Flow

1. `computeAiActions` delegates to `computeAiActionsForPlayer`.
2. Controller resolves `player.aiImplementationId`.
3. Unknown IDs fall back to `classic`.
4. Selected implementation computes actions.

### Player Config

- `PlayerState` has optional `aiImplementationId`.
- `SkirmishConfig.players[]` supports `aiImplementationId`.
- Setup UI exposes per-slot AI implementation selector (`.ai-implementation`).

### Adding a New AI Implementation

Use the scaffolder:

```bash
npm run ai:new -- my_strategy
```

It creates implementation files and test stubs, and auto-registers in `src/engine/ai/registry.ts` using marker comments:

- `// @ai-implementation-imports`
- `// @ai-implementation-list`

Do not remove these markers.

## Testing

- Vitest test suite mirrors `src/` under `tests/`.
- Prefer adding/adjusting focused tests when touching AI behavior:
  - implementation routing and fallbacks
  - setup/skirmish config plumbing
  - debug output formatting

## Notes for Agents

- Use type guards (`isUnit`, `isBuilding`, etc.) when narrowing entity unions.
- Keep reducer/state updates immutable.
- Preserve compatibility: defaults should continue to work when `aiImplementationId` is absent.

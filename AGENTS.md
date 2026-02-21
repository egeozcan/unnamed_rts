# AGENTS.md

This file provides guidance for coding agents working in this repository.

## Project Summary

Browser-based real-time strategy game inspired by Command & Conquer.
Built with pure TypeScript + Canvas 2D (no game framework), supporting up to 8 players (human + AI).

## Core Commands

```bash
npm run dev                      # Start dev server with hot reload
npm run build                    # Type check + production build
npm test                         # Run all tests
npm run test:watch               # Run tests in watch mode
npm run test:coverage            # Coverage report in ./coverage/
npm run debug -- ...             # RTS debug CLI/REPL
npm run manipulate-state -- ...  # State manipulation utility
npm run ai:new -- <name>         # Scaffold a new AI implementation
npm run ai:simulate -- ...       # Headless AI vs AI simulation
npm run ai:tournament -- ...     # Round-robin Elo tournament
```

Single test file:

```bash
npx vitest run tests/engine/ai_modularity.test.ts
```

## Architecture

### State Management

Redux-inspired immutable flow:

```text
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

It auto-registers in `src/engine/ai/registry.ts` using marker comments:

- `// @ai-implementation-imports`
- `// @ai-implementation-list`

Do not remove these markers.

## Hard Rules For AI Development

These are mandatory constraints for further AI work in this repository.

1. Scope restriction
- Unless explicitly instructed otherwise by the maintainer, only modify the AI implementation(s) assigned in the current task.
- Do not modify opponent/reference AI implementations that are not part of the assignment.

2. State-only decision making
- AI behavior must be based on observable game state only.
- Do not inspect opponent identity (`aiImplementationId`, implementation names/IDs, or hardcoded opponent-specific branches).

3. No cheating or interception
- Never issue actions that operate on enemy-owned entities or enemy `playerId`.
- Never exploit reducer/engine loopholes (for example, forcing enemy sell/repair/rally/production control).

4. Ownership safety for emitted actions
- All emitted actions must reference only the acting player's own units/buildings.
- Action payload `playerId` must match the acting player when applicable.

5. If a potential exploit is discovered
- Do not use it for performance gains.
- Prefer adding defensive validation/sanitization in the AI layer and report it in the change notes.

## Tournament Workflow Expectations

For AI tuning changes, run and report at least:

```bash
npm run build
npm run ai:tournament -- --games-per-matchup 2 --max-ticks 40000
```

Recommended quick iteration probes:

```bash
npm run ai:simulate -- --games 8 --ai1 <ai_under_test> --ai2 <opponent_ai> --max-ticks 40000 --seed 424242
npm run ai:simulate -- --games 8 --ai1 <opponent_ai> --ai2 <ai_under_test> --max-ticks 40000 --seed 424242
```

Default target policy: optimize the assigned AI until the maintainer-defined Elo or matchup target is met, while following all fairness constraints above.

## Notes For Agents

- Use type guards (`isUnit`, `isBuilding`, etc.) when narrowing entity unions.
- Keep reducer/state updates immutable.
- Preserve compatibility: defaults should continue to work when `aiImplementationId` is absent.

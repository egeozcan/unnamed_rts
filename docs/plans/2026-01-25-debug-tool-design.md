# Game State Debug Tool Design

## Overview

A comprehensive debugging tool for analyzing game state, AI decisions, unit behavior, and economy. Provides CLI commands, interactive REPL, and structured event logging with filtering capabilities.

## Goals

- Track individual units: commands received, state changes, damage events
- Track AI decision-making: strategy changes, combat decisions, reasoning
- Track groups: formation, membership changes, status transitions
- Track economy: credits over time, income sources, spending
- Track threat assessment: threat levels, desperation, vengeance scores
- Advance simulation with conditional breakpoints ("advance until X dies")
- Output structured logs (JSONL) for future web-based visualization

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Game Engine                              │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│  │   AI    │  │ Reducer │  │ Combat  │  │Economy  │   ...      │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘            │
│       │            │            │            │                   │
│       └────────────┴────────────┴────────────┘                   │
│                          │                                       │
│                    DebugEvents.emit()                            │
│                          │ (no-op in prod)                       │
└──────────────────────────┼───────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    DebugCollector                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │   Filters    │  │   Triggers   │  │  Event Log   │           │
│  │ - whitelist  │  │ - hp < 50%   │  │   (JSONL)    │           │
│  │ - categories │  │ - area check │  │              │           │
│  │ - thresholds │  │ - count >= N │  │              │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└──────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Debug Tool (CLI/REPL)                         │
│  - load/save states    - advance/advance-until                   │
│  - query events        - inspect entities/AI state               │
│  - export logs         - configure filters                       │
└──────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **DebugEvents** - Lightweight event emitter in engine code, compiles to no-op in production via `import.meta.env.DEV` guards
2. **DebugCollector** - Receives events, applies filters, stores in memory and/or file
3. **Debug Tool** - CLI/REPL interface that orchestrates loading, advancing, querying, and exporting

## Event Emitter System

### Implementation

```typescript
// src/engine/debug/events.ts

type DebugEventType =
  | 'command'      // Unit received command (move, attack, etc.)
  | 'decision'     // AI made a decision with reasoning
  | 'state-change' // Entity state changed (hp, target, strategy)
  | 'group'        // Group membership/status changed
  | 'economy'      // Credits/income changed
  | 'production'   // Queue/completion events
  | 'threat'       // Threat detection/assessment

interface DebugEvent {
  type: DebugEventType;
  tick: number;
  playerId?: number;
  entityId?: string;
  data: Record<string, unknown>;
}

let collector: ((event: DebugEvent) => void) | null = null;

export const DebugEvents = {
  emit(type: DebugEventType, data: Omit<DebugEvent, 'type'>) {
    if (import.meta.env.DEV && collector) {
      collector({ type, ...data });
    }
  },

  setCollector(fn: ((event: DebugEvent) => void) | null) {
    collector = fn;
  }
};
```

### Usage in Engine Code

```typescript
// In action_combat.ts
DebugEvents.emit('decision', {
  tick: state.tick,
  playerId,
  entityId: group.id,
  data: {
    action: 'attack',
    reason: 'strategy=attack, groupSize >= minSize',
    target: bestTarget.id,
    targetScore: bestScore
  }
});
```

The `import.meta.env.DEV` guard ensures Vite eliminates all emit calls in production builds.

## Event Schemas

All events have Zod schemas for type safety and validation.

### Command Event

```typescript
const CommandEventSchema = z.object({
  type: z.literal('command'),
  tick: z.number(),
  playerId: z.number(),
  entityId: z.string(),
  data: z.object({
    command: z.enum(['move', 'attack', 'attack-move', 'stop', 'deploy']),
    source: z.enum(['player', 'ai']),
    target: z.string().optional(),
    destination: VectorSchema.optional(),
    reason: z.string().optional(),
  }),
});
```

### Decision Event

```typescript
const DecisionEventSchema = z.object({
  type: z.literal('decision'),
  tick: z.number(),
  playerId: z.number(),
  entityId: z.string().optional(),
  data: z.object({
    category: z.enum(['strategy', 'combat', 'economy', 'production']),
    action: z.string(),
    reason: z.string(),
    scores: z.record(z.string(), z.number()).optional(),
    alternatives: z.array(z.string()).optional(),
  }),
});
```

### State Change Event

```typescript
const StateChangeEventSchema = z.object({
  type: z.literal('state-change'),
  tick: z.number(),
  playerId: z.number().optional(),
  entityId: z.string().optional(),
  data: z.object({
    subject: z.enum(['unit', 'building', 'ai', 'group']),
    field: z.string(),
    from: z.unknown(),
    to: z.unknown(),
    cause: z.string().optional(),
  }),
});
```

### Group Event

```typescript
const GroupEventSchema = z.object({
  type: z.literal('group'),
  tick: z.number(),
  playerId: z.number(),
  data: z.object({
    groupId: z.string(),
    action: z.enum(['created', 'dissolved', 'member-added', 'member-removed', 'status-changed']),
    unitIds: z.array(z.string()).optional(),
    status: z.string().optional(),
    reason: z.string().optional(),
  }),
});
```

### Economy Event

```typescript
const EconomyEventSchema = z.object({
  type: z.literal('economy'),
  tick: z.number(),
  playerId: z.number(),
  data: z.object({
    credits: z.number(),
    delta: z.number(),
    source: z.enum(['harvest', 'sell', 'spend', 'induction-rig']),
    entityId: z.string().optional(),
  }),
});
```

### Production Event

```typescript
const ProductionEventSchema = z.object({
  type: z.literal('production'),
  tick: z.number(),
  playerId: z.number(),
  data: z.object({
    action: z.enum(['queue-add', 'queue-remove', 'started', 'completed', 'cancelled']),
    category: z.enum(['building', 'infantry', 'vehicle', 'air']),
    key: z.string(),
    queueLength: z.number().optional(),
  }),
});
```

### Threat Event

```typescript
const ThreatEventSchema = z.object({
  type: z.literal('threat'),
  tick: z.number(),
  playerId: z.number(),
  data: z.object({
    threatLevel: z.number(),
    economyScore: z.number(),
    desperation: z.number(),
    isDoomed: z.boolean(),
    threatsNearBase: z.array(z.string()),
    vengeanceScores: z.record(z.string(), z.number()),
  }),
});
```

### Combined Schema

```typescript
const DebugEventSchema = z.discriminatedUnion('type', [
  CommandEventSchema,
  DecisionEventSchema,
  StateChangeEventSchema,
  GroupEventSchema,
  EconomyEventSchema,
  ProductionEventSchema,
  ThreatEventSchema,
]);

const MetaLineSchema = z.object({
  _meta: z.literal(true),
  version: z.string(),
  startTick: z.number(),
  endTick: z.number(),
  filters: z.object({
    categories: z.array(z.string()),
    trackedEntities: z.array(z.string()),
    trackedPlayers: z.array(z.number()),
    thresholds: z.record(z.string(), z.number()),
  }),
  recordedAt: z.string(),
});
```

## Filtering System

### Filter Configuration

```typescript
interface FilterConfig {
  // Category toggles - which event types to record
  categories: {
    command: boolean;
    decision: boolean;
    'state-change': boolean;
    group: boolean;
    economy: boolean;
    production: boolean;
    threat: boolean;
  };

  // Entity whitelist - empty means track all
  trackedEntities: Set<string>;

  // Player filter - empty means track all
  trackedPlayers: Set<number>;

  // Change-only mode - skip if value unchanged
  changeOnly: {
    economy: boolean;
    threat: boolean;
    strategy: boolean;
  };

  // Thresholds - only log when crossed
  thresholds: {
    hpBelow?: number;
    creditsBelow?: number;
    threatAbove?: number;
    economyDelta?: number;
  };

  // Sample rate for periodic snapshots
  snapshotInterval: number;
}
```

### Default Configuration

- All categories enabled
- No entity/player whitelist (track all)
- Change-only enabled for economy and threat
- No thresholds set
- Snapshot interval: 100 ticks

### Filter Behavior

| Filter | Behavior |
|--------|----------|
| `categories` | Event type must be enabled to be recorded |
| `trackedEntities` | If non-empty, only events with matching entityId pass |
| `trackedPlayers` | If non-empty, only events with matching playerId pass |
| `changeOnly.economy` | Skip economy events if credits unchanged from last event |
| `changeOnly.threat` | Skip threat events if threatLevel unchanged |
| `changeOnly.strategy` | Skip decision events if strategy unchanged |
| `thresholds.hpBelow` | Only record state-change for HP if new value < threshold % |
| `thresholds.creditsBelow` | Only record economy if credits drop below threshold |
| `thresholds.threatAbove` | Only record threat if level rises above threshold |
| `thresholds.economyDelta` | Skip economy events with delta smaller than threshold |
| `snapshotInterval` | Save full state snapshot every N ticks (0 = disabled) |

## CLI Interface

### Basic Usage

```bash
# Advance and export
npm run debug -- --input game_state.json --advance 1000 --export events.jsonl

# With output state
npm run debug -- --input game_state.json --advance 1000 --output new_state.json --export events.jsonl
```

### Filter Flags

```bash
--track <entity-id>           # Add entity to whitelist (repeatable)
--player <player-id>          # Add player to whitelist (repeatable)
--category <cat1,cat2,...>    # Enable only these categories
--no-category <cat1,cat2,...> # Disable these categories
--change-only <cat1,cat2,...> # Enable change-only for categories
--threshold <name>=<value>    # Set threshold (hp-below, credits-below, threat-above, economy-delta)
--snapshot-interval <ticks>   # State snapshot frequency
```

### Advance-Until Flags

```bash
--advance-until <condition>   # Stop when condition is true
--max-ticks <n>               # Safety limit for advance-until
```

### Query Flags (no advance)

```bash
--status <player-id>          # Print AI status for player
--unit <entity-id>            # Print unit details
--find <query>                # Find entities (e.g., "type=harvester,owner=1")
--list-groups <player-id>     # List offensive groups
```

### Examples

```bash
# Track specific unit through 1000 ticks
npm run debug -- --input state.json --track e_20354 --advance 1000 --export unit_trace.jsonl

# Watch economy only, with minimum delta
npm run debug -- --input state.json --category economy --threshold economy-delta=10 --advance 500 --export economy.jsonl

# Advance until unit dies
npm run debug -- --input state.json --track e_20354 --advance-until "dead e_20354" --max-ticks 10000 --export death_trace.jsonl

# Quick status check
npm run debug -- --input state.json --status 1
```

## REPL Interface

### Starting REPL

```bash
npm run debug -- --repl
npm run debug -- --repl --input game_state.json  # Pre-load state
```

### Commands

| Command | Description |
|---------|-------------|
| `load <file>` | Load a game state JSON |
| `save <file>` | Save current state |
| `export <file>` | Export event log to JSONL |
| `advance <ticks>` | Advance simulation by N ticks |
| `advance-until <condition>` | Advance until condition fires |
| `track <entity-id>` | Add entity to whitelist |
| `untrack <entity-id>` | Remove from whitelist |
| `track-player <id>` | Add player to whitelist |
| `untrack-player <id>` | Remove player from whitelist |
| `filter <category> on/off` | Toggle category |
| `threshold <name> <value>` | Set threshold |
| `status [player-id]` | Show AI state, economy, threat |
| `unit <entity-id>` | Show detailed unit state |
| `group <group-id>` | Show group membership and status |
| `groups [player-id]` | List all groups for player |
| `events [count]` | Show recent logged events |
| `find <query>` | Search entities |
| `clear-events` | Clear event log |
| `clear-filters` | Reset all filters to defaults |
| `config` | Show current filter configuration |
| `help [command]` | Show help |
| `quit` | Exit REPL |

### Advance-Until Conditions

| Condition | Syntax | Example |
|-----------|--------|---------|
| Entity HP threshold | `hp <id> < <percent>%` | `hp e_1234 < 50%` |
| Entity dies | `dead <id>` | `dead e_1234` |
| Entity enters area | `area <x>,<y>,<radius> has <id>` | `area 500,500,200 has e_1234` |
| Player eliminated | `player <id> dead` | `player 2 dead` |
| Entity count ceiling | `count <player> <type> >= <n>` | `count 1 harvester >= 5` |
| Entity count floor | `count <player> <type> <= <n>` | `count 2 unit <= 0` |
| Strategy equals | `strategy <player> == <strategy>` | `strategy 1 == attack` |
| Credits threshold | `credits <player> < <amount>` | `credits 1 < 500` |
| Threat threshold | `threat <player> > <level>` | `threat 1 > 80` |
| Tick limit | `tick > <n>` | `tick > 50000` |

Conditions can be combined with `or`:
```
advance-until "dead e_1234 or tick > 10000"
advance-until "hp e_1234 < 30% or strategy 1 == attack"
```

### REPL Example Session

```
$ npm run debug -- --repl

> load game_state_tick_26594.json
Loaded state at tick 26594. 847 entities, 4 players.

> status 1
Player 1 (AI - hard):
  Strategy: attack (since tick 24100)
  Credits: 2340 | Income: ~45/sec
  Threat: 62 | Desperation: 15 | Doomed: false
  Groups: main_attack (8 units, status=moving)

> track e_20354
Tracking entity e_20354 (heavy, player 1, hp=450/600)

> advance-until "hp e_20354 < 50% or tick > 30000"
Advancing... stopped at tick 28451 (trigger: hp e_20354 < 50%)
12 events recorded for tracked entities.

> events
[28102] command    e_20354  attack target=e_8821 source=ai reason="focus fire, low hp target"
[28244] state-change e_20354  hp 600→520 cause="damage from e_9012"
[28301] state-change e_20354  hp 520→480 cause="damage from e_9012"
[28390] decision   player=1  retreat: group avg hp=42%, threshold=45%
[28391] command    e_20354  move destination=(1204,892) source=ai reason="retreat to base"
[28449] state-change e_20354  hp 340→295 cause="damage from e_8821"

> unit e_20354
Entity e_20354 (heavy tank):
  Owner: Player 1 | HP: 295/600 (49%)
  Position: (1180, 910) | Rotation: 2.4rad
  Target: none | Move target: (1204, 892)
  Group: main_attack | Stuck: no
  Last command: move (tick 28391)

> export session_debug.jsonl
Exported 12 events to session_debug.jsonl

> quit
```

## Output Format

### JSONL Event Log

One JSON object per line. First line is metadata.

```jsonl
{"_meta":true,"version":"1.0","startTick":26594,"endTick":28451,"filters":{"categories":["command","decision","state-change"],"trackedEntities":["e_20354"],"trackedPlayers":[],"thresholds":{}},"recordedAt":"2026-01-25T10:30:00Z"}
{"tick":28102,"type":"command","playerId":1,"entityId":"e_20354","data":{"command":"attack","source":"ai","target":"e_8821","reason":"focus fire, low hp target"}}
{"tick":28244,"type":"state-change","playerId":1,"entityId":"e_20354","data":{"subject":"unit","field":"hp","from":600,"to":520,"cause":"damage from e_9012"}}
{"tick":28390,"type":"decision","playerId":1,"data":{"category":"combat","action":"retreat","reason":"group avg hp=42%, threshold=45%","scores":{"avgHp":42,"threshold":45}}}
{"tick":28391,"type":"command","playerId":1,"entityId":"e_20354","data":{"command":"move","source":"ai","destination":{"x":1204,"y":892},"reason":"retreat to base"}}
```

### State Snapshots (Optional)

When `snapshotInterval > 0`, full state is saved periodically:

```
session_debug.jsonl           # Event log
session_debug_states/         # State snapshots
  tick_26594.json
  tick_27000.json
  tick_28000.json
  tick_28451.json
```

## File Structure

```
src/
├── engine/
│   └── debug/
│       ├── events.ts           # DebugEvents emitter
│       └── schemas.ts          # Zod schemas for events
│
├── data/
│   └── schemas/
│       └── debug-events.ts     # Re-export for consistency
│
└── scripts/
    └── debug/
        ├── index.ts            # CLI entry point
        ├── repl.ts             # REPL implementation
        ├── collector.ts        # DebugCollector with filtering
        ├── triggers.ts         # advance-until trigger parser/evaluator
        ├── commands/           # REPL command implementations
        │   ├── advance.ts
        │   ├── status.ts
        │   ├── unit.ts
        │   ├── group.ts
        │   ├── find.ts
        │   ├── events.ts
        │   ├── filter.ts
        │   └── io.ts           # load/save/export
        ├── formatters.ts       # Pretty-print for REPL output
        └── README.md           # Detailed usage documentation
```

## Engine Instrumentation Points

Files that need DebugEvents.emit() calls added:

| File | Events |
|------|--------|
| `src/engine/ai/action_combat.ts` | decision (combat), command (attack/move), group |
| `src/engine/ai/action_economy.ts` | decision (economy), command (build) |
| `src/engine/ai/strategy/index.ts` | decision (strategy), state-change (strategy) |
| `src/engine/ai/planning.ts` | threat |
| `src/engine/ai/state.ts` | group, state-change (AI state) |
| `src/engine/reducers/combat.ts` | state-change (hp, target) |
| `src/engine/reducers/movement.ts` | command (from player input) |
| `src/engine/reducers/production.ts` | production, economy (spend) |
| `src/engine/reducers/harvester.ts` | economy (harvest) |
| `src/engine/reducers/buildings.ts` | economy (sell), production |

## Implementation Notes

### Tree-Shaking

All emit calls must be wrapped in `import.meta.env.DEV`:

```typescript
if (import.meta.env.DEV) {
  DebugEvents.emit('decision', { ... });
}
```

Or rely on the emit function's internal check (Vite should eliminate dead code when collector is always null in prod).

### Performance

- Event collector uses a simple array; avoid processing during game loop
- Filtering happens at emit time to minimize memory usage
- State snapshots are async writes to avoid blocking

### Future Web UI

The JSONL format is designed for easy consumption:
- Stream parsing (line by line)
- Filter by grep before loading
- Zod schemas provide TypeScript types for the UI

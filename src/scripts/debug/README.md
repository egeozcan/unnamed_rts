# Game State Debug Tool

A comprehensive debugging tool for analyzing game state, AI decisions, unit behavior, and economy in the RTS game engine.

## Quick Start

```bash
# Load a state and check AI status for player 1
npm run debug -- --input game_state.json --status 1

# Track a specific unit through 1000 ticks
npm run debug -- --input state.json --track e_1234 --advance 1000 --export trace.jsonl

# Advance until a unit dies or reaches tick 50000
npm run debug -- --input state.json --advance-until "dead e_123 or tick > 50000" --output result.json

# Interactive mode for exploration
npm run debug -- --repl --input state.json

# Find all harvesters owned by player 2
npm run debug -- --input state.json --find "owner=2,key=harvester"
```

## CLI Reference

### Basic Options

| Flag | Description |
|------|-------------|
| `--input <file>` | Load game state from JSON file |
| `--output <file>` | Save game state to JSON file after simulation |
| `--export <file>` | Export collected events to JSONL file |
| `--repl` | Start interactive REPL mode |
| `--help` | Show help message |

### Simulation Options

| Flag | Description |
|------|-------------|
| `--advance <ticks>` | Advance simulation by N ticks |
| `--advance-until <cond>` | Advance until trigger condition is met |
| `--max-ticks <n>` | Safety limit for advance-until (default: 100000) |

### Query Options

| Flag | Description |
|------|-------------|
| `--status <player-id>` | Show AI status for player (strategy, economy, groups) |
| `--unit <entity-id>` | Show detailed unit information |
| `--find <query>` | Find entities matching query (format: `key=value,key=value`) |
| `--list-groups <player>` | List attack/defense groups for player |

### Filter Options

| Flag | Description |
|------|-------------|
| `--track <entity-id>` | Track specific entity (repeatable) |
| `--player <player-id>` | Track specific player (repeatable) |
| `--category <cat,...>` | Enable only these event categories (comma-separated) |
| `--no-category <cat,...>` | Disable these event categories (comma-separated) |
| `--change-only <cat,...>` | Only log when value changes (economy, threat, strategy) |
| `--threshold <n>=<v>` | Set threshold value (repeatable) |
| `--snapshot-interval <n>` | Ticks between state snapshots (default: 100) |

## Filter Options (Detailed)

### Entity Tracking

Track specific entities to filter events:

```bash
# Track two specific units
npm run debug -- --input state.json --track e_123 --track e_456 --advance 1000

# Track all events for player 1
npm run debug -- --input state.json --player 1 --advance 1000
```

When tracking is enabled, only events involving tracked entities/players are collected. Empty tracking lists mean "track all."

### Category Filtering

Available categories: `command`, `decision`, `state-change`, `group`, `economy`, `production`, `threat`

```bash
# Only collect combat-related events
npm run debug -- --input state.json --category command,decision --advance 1000

# Collect everything except economy events
npm run debug -- --input state.json --no-category economy --advance 1000
```

### Threshold Options

| Threshold | Description |
|-----------|-------------|
| `hp-below=<percent>` | Log HP changes below this percentage |
| `credits-below=<amount>` | Log when credits drop below threshold |
| `threat-above=<level>` | Log threat events above this level |
| `economy-delta=<amount>` | Minimum credit change to log |

```bash
# Only log significant economy changes (>100 credits)
npm run debug -- --input state.json --threshold economy-delta=100 --advance 1000
```

### Change-Only Mode

Skip duplicate events when values haven't changed:

```bash
# Only log when economy or threat actually changes
npm run debug -- --input state.json --change-only economy,threat --advance 5000
```

## Trigger Conditions

For `--advance-until` and REPL `advance-until` command:

### Single Conditions

| Condition | Example | Description |
|-----------|---------|-------------|
| Entity dies | `dead e_1234` | Entity is dead or doesn't exist |
| HP threshold | `hp e_1234 < 50%` | Entity HP below/above percentage |
| Tick comparison | `tick >= 10000` | Game tick reaches value |
| Credits | `credits 1 < 500` | Player credits below/above amount |
| Strategy | `strategy 1 == rush` | AI strategy matches value |
| Entity count | `count 1 harvester < 2` | Player has fewer/more entities |
| Player eliminated | `player 2 dead` | Player has no units or buildings |
| Threat level | `threat 1 > 50` | AI threat level comparison |
| Area check | `area 400,400,100 has e_123` | Entity within radius of point |

### Operators

All comparison conditions support: `<`, `>`, `<=`, `>=`, `==`

### Combining Conditions

Use `or` to combine multiple conditions:

```bash
# Stop when unit dies OR reaches tick 10000
npm run debug -- --input state.json --advance-until "dead e_123 or tick > 10000"

# Stop when player runs out of money OR loses their base
npm run debug -- --input state.json --advance-until "credits 1 < 100 or count 1 construction_yard == 0"
```

### Area Trigger Format

The area condition uses format: `area <x>,<y>,<radius> has <entity-id>`

```bash
# Stop when unit e_123 gets within 200 pixels of position (1000, 1000)
npm run debug -- --input state.json --advance-until "area 1000,1000,200 has e_123"
```

## REPL Commands

Start REPL mode with `--repl`:

```bash
npm run debug -- --repl --input state.json
```

### File Operations

| Command | Description |
|---------|-------------|
| `load <file>` | Load state from file (resets AI state) |
| `save <file>` | Save current state to file |
| `export <file>` | Export events to JSONL file |

### Simulation

| Command | Description |
|---------|-------------|
| `advance [ticks]` | Advance N ticks (default: 100) |
| `advance-until <cond>` | Advance until condition met (max 100000 ticks) |

### Tracking

| Command | Description |
|---------|-------------|
| `track <entity-id>` | Add entity to tracked list |
| `untrack <entity-id>` | Remove entity from tracked list |
| `track-player <id>` | Add player to tracked list |
| `untrack-player <id>` | Remove player from tracked list |

### Filtering

| Command | Description |
|---------|-------------|
| `filter <category> on\|off` | Enable/disable event category |
| `threshold <name> <value>` | Set threshold value |
| `clear-filters` | Reset all filters to defaults |

### Queries

| Command | Description |
|---------|-------------|
| `status [player-id]` | Show AI status (defaults to first player) |
| `unit <entity-id>` | Show detailed unit information |
| `groups [player-id]` | Show attack/defense groups |
| `find <query>` | Find entities (format: `owner=1,type=unit`) |

### Events

| Command | Description |
|---------|-------------|
| `events [count]` | Show last N events (default: 20) |
| `clear-events` | Clear all collected events |

### Meta

| Command | Description |
|---------|-------------|
| `config` | Show current filter configuration |
| `help [command]` | Show help for all or specific command |
| `quit` / `exit` | Exit the REPL |

Type `help <command>` for detailed usage of any command.

## Event Types

The debug tool collects 7 types of events:

### command

Unit received a command (move, attack, etc.).

```json
{
  "type": "command",
  "tick": 1234,
  "playerId": 1,
  "entityId": "e_567",
  "data": {
    "command": "attack",
    "source": "ai",
    "target": "e_890",
    "reason": "offensive group target"
  }
}
```

Commands: `move`, `attack`, `attack-move`, `stop`, `deploy`
Sources: `player`, `ai`

### decision

AI made a strategic decision.

```json
{
  "type": "decision",
  "tick": 1234,
  "playerId": 1,
  "data": {
    "category": "strategy",
    "action": "switch-to-aggressive",
    "reason": "high economy score and low threat",
    "scores": { "aggressive": 0.8, "defensive": 0.3 }
  }
}
```

Categories: `strategy`, `combat`, `economy`, `production`

### state-change

Entity or AI state changed.

```json
{
  "type": "state-change",
  "tick": 1234,
  "entityId": "e_123",
  "data": {
    "subject": "unit",
    "field": "hp",
    "from": 100,
    "to": 75,
    "cause": "damage from e_456"
  }
}
```

Subjects: `unit`, `building`, `ai`, `group`

### group

Attack/defense group activity.

```json
{
  "type": "group",
  "tick": 1234,
  "playerId": 1,
  "data": {
    "groupId": "offensive_1",
    "action": "status-changed",
    "status": "attacking",
    "reason": "reached rally point"
  }
}
```

Actions: `created`, `dissolved`, `member-added`, `member-removed`, `status-changed`

### economy

Credit changes.

```json
{
  "type": "economy",
  "tick": 1234,
  "playerId": 1,
  "data": {
    "credits": 5500,
    "delta": 500,
    "source": "harvest",
    "entityId": "e_harvester_1"
  }
}
```

Sources: `harvest`, `sell`, `spend`, `induction-rig`

### production

Production queue events.

```json
{
  "type": "production",
  "tick": 1234,
  "playerId": 1,
  "data": {
    "action": "completed",
    "category": "vehicle",
    "key": "tank",
    "queueLength": 2
  }
}
```

Actions: `queue-add`, `queue-remove`, `started`, `completed`, `cancelled`
Categories: `building`, `infantry`, `vehicle`, `air`

### threat

AI threat assessment update.

```json
{
  "type": "threat",
  "tick": 1234,
  "playerId": 1,
  "data": {
    "threatLevel": 45,
    "economyScore": 72,
    "desperation": 0,
    "isDoomed": false,
    "threatsNearBase": ["e_enemy_1", "e_enemy_2"],
    "vengeanceScores": { "2": 15, "3": 5 }
  }
}
```

## Output Format

Events are exported in JSONL (JSON Lines) format with a metadata header:

```jsonl
{"_meta":true,"version":"1.0.0","startTick":1000,"endTick":2000,"filters":{"categories":["command","decision"],"trackedEntities":["e_123"],"trackedPlayers":[1],"thresholds":{}},"recordedAt":"2024-01-15T10:30:00.000Z"}
{"tick":1100,"type":"command","playerId":1,"entityId":"e_123","data":{"command":"move","source":"ai","destination":{"x":500,"y":300}}}
{"tick":1150,"type":"decision","playerId":1,"data":{"category":"combat","action":"attack-target","reason":"enemy in range"}}
```

### Metadata Header

The first line is always a metadata object with `_meta: true`:

| Field | Description |
|-------|-------------|
| `version` | Format version (currently "1.0.0") |
| `startTick` | First tick in the export range |
| `endTick` | Last tick in the export range |
| `filters.categories` | Enabled event categories |
| `filters.trackedEntities` | Entity IDs being tracked |
| `filters.trackedPlayers` | Player IDs being tracked |
| `filters.thresholds` | Active threshold settings |
| `recordedAt` | ISO timestamp when export was created |

### Processing JSONL Files

Each line is a valid JSON object. Process with standard tools:

```bash
# Count events by type
cat events.jsonl | jq -s 'group_by(.type) | map({type: .[0].type, count: length})'

# Extract all economy events
cat events.jsonl | jq 'select(.type == "economy")'

# Find events in tick range
cat events.jsonl | jq 'select(.tick >= 1000 and .tick <= 2000)'
```

## Examples

### Debugging Unit Pathfinding

```bash
# Track a specific unit and see its commands
npm run debug -- --input state.json \
  --track e_unit_123 \
  --category command,state-change \
  --advance 500 \
  --export unit_trace.jsonl
```

### Analyzing AI Economy

```bash
# Track player 1's economy decisions
npm run debug -- --input state.json \
  --player 1 \
  --category economy,production,decision \
  --change-only economy \
  --threshold economy-delta=50 \
  --advance 5000 \
  --export economy.jsonl
```

### Finding Why a Unit Died

```bash
# Interactive debugging session
npm run debug -- --repl --input state_before_death.json

debug> track e_doomed_unit
debug> filter economy off
debug> filter production off
debug> advance-until dead e_doomed_unit
debug> events 50
debug> export death_trace.jsonl
```

### Comparing AI Strategies

```bash
# Watch for strategy changes
npm run debug -- --input state.json \
  --player 1 --player 2 \
  --category decision,threat \
  --advance-until "strategy 1 == aggressive or strategy 2 == aggressive" \
  --export strategy_changes.jsonl
```

### Monitoring Base Defense

```bash
# Track threats near base at position (1000, 1000)
npm run debug -- --repl --input state.json

debug> track-player 1
debug> filter command off
debug> filter production off
debug> advance-until "area 1000,1000,300 has e_enemy_tank"
debug> status 1
debug> groups 1
```

---
name: rts-debug-tool
description: Use when debugging RTS game state, investigating AI decisions, tracking unit behavior, analyzing economy patterns, or finding why units died. Triggers on questions about AI strategy, unit pathfinding issues, economy problems, or game state analysis.
---

# RTS Game State Debug Tool

Debug game state, AI decisions, unit behavior, and economy in the RTS game engine.

## When to Use

- Investigating why AI made certain decisions
- Tracking a unit's commands and state changes
- Finding why a unit died
- Analyzing economy or production patterns
- Debugging pathfinding or stuck units
- Comparing AI strategies between players

## Quick Reference

```bash
# Check AI status
npm run debug -- --input state.json --status 1

# Track unit through simulation
npm run debug -- --input state.json --track e_123 --advance 1000 --export trace.jsonl

# Advance until condition
npm run debug -- --input state.json --advance-until "dead e_123 or tick > 5000"

# Interactive mode
npm run debug -- --repl --input state.json
```

## CLI Flags

| Flag | Purpose |
|------|---------|
| `--input <file>` | Load game state JSON |
| `--output <file>` | Save state after simulation |
| `--export <file>` | Export events to JSONL |
| `--advance <n>` | Advance N ticks |
| `--advance-until <cond>` | Advance until trigger fires |
| `--status <player>` | Show AI status |
| `--unit <id>` | Show unit details |
| `--find <query>` | Find entities (`owner=1,key=harvester`) |
| `--track <id>` | Track entity (repeatable) |
| `--player <id>` | Track player (repeatable) |
| `--repl` | Interactive mode |

## Trigger Conditions

For `--advance-until`:

| Condition | Example |
|-----------|---------|
| Entity dies | `dead e_123` |
| HP threshold | `hp e_123 < 50%` |
| Tick reached | `tick > 5000` |
| Credits | `credits 1 < 500` |
| Strategy | `strategy 1 == attack` |
| Count | `count 1 harvester >= 3` |
| Player dead | `player 2 dead` |
| Threat | `threat 1 > 80` |

Combine with `or`: `dead e_123 or tick > 10000`

## REPL Commands

```
load <file>          Load state
save <file>          Save state
advance [n]          Advance ticks (default: 100)
advance-until <cond> Advance until trigger
track <id>           Track entity
status [player]      Show AI status
unit <id>            Show unit info
groups [player]      Show attack groups
find <query>         Find entities
events [n]           Show last N events
export <file>        Export to JSONL
help                 Show all commands
quit                 Exit
```

## Event Categories

Filter with `--category` or `--no-category`:

- `command` - Unit commands (move, attack)
- `decision` - AI decisions (strategy, combat)
- `state-change` - HP, death, target changes
- `group` - Attack/defense group activity
- `economy` - Credit changes
- `production` - Queue events
- `threat` - Threat assessments

## Common Workflows

**Why did unit die?**
```bash
npm run debug -- --repl --input state_before.json
> track e_dying_unit
> advance-until dead e_dying_unit
> events 30
```

**AI economy analysis:**
```bash
npm run debug -- --input state.json --player 1 \
  --category economy,decision --change-only economy \
  --advance 5000 --export econ.jsonl
```

**Track pathfinding:**
```bash
npm run debug -- --input state.json --track e_stuck \
  --category command,state-change --advance 500
```

See `src/scripts/debug/README.md` for full documentation.

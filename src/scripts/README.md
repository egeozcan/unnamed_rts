# Game State Manipulation Tool

A command-line tool to manipulate saved game states (JSON files). It allows for removing players, units, and buildings based on various criteria, as well as advancing the game simulation.

## Usage

Run the tool using `npm run manipulate-state`.

```bash
npm run manipulate-state -- [options]
```

## Options

| Option | Description |
|Params|---|
| `--input <file>` | Path to the input JSON game state file (Required) |
| `--output <file>` | Path to save the modified state. Defaults to overwriting input if not specified. |
| `--ticks <number>` | Number of ticks to advance the simulation. |
| `--remove-player <id>` | Remove a player and all their entities. `id` is the player ID (e.g. 0, 1). |
| `--remove-unit-player <id>` | Remove all units belonging to a specific player ID. |
| `--remove-unit-type <type>` | Remove all units of a specific type (e.g. `harvester`, `tank`, `mcv`). |
| `--remove-unit-near <id>,<d>` | Remove units within distance `d` of unit/entity `id`. |
| `--remove-unit-further <id>,<d>` | Remove units further than distance `d` from unit/entity `id`. |
| `--remove-building-player <id>` | Remove all buildings belonging to a specific player ID. |
| `--remove-building-type <type>` | Remove all buildings of a specific type (e.g. `turret`, `power`). |
| `--remove-building-near <id>,<d>` | Remove buildings within distance `d` of unit/entity `id`. |
| `--remove-building-further <id>,<d>` | Remove buildings further than distance `d` from unit/entity `id`. |
| `--list-units-near <id>,<d>` | List units within distance `d` of unit/entity `id`. |
| `--list-units-further <id>,<d>` | List units further than distance `d` from unit/entity `id`. |

## Examples

**Advance game by 100 ticks:**
```bash
npm run manipulate-state -- --input saves/mysave.json --ticks 100
```

**Remove all harvesters:**
```bash
npm run manipulate-state -- --input saves/mysave.json --remove-unit-type harvester
```

**Remove Player 1 and save to new file:**
```bash
npm run manipulate-state -- --input saves/save1.json --output saves/save1_no_p1.json --remove-player 1
```

**Remove units close to a specific unit (e.g. clearing a jam):**
```bash
npm run manipulate-state -- --input saves/jammed.json --remove-unit-near unit_123,50
```

**Remove units far from base (e.g. cleanup):**
```bash
npm run manipulate-state -- --input saves/game.json --remove-unit-further base_structure_id,2000
```

**List units near a point of interest:**
```bash
npm run manipulate-state -- --input saves/game.json --list-units-near unit_555,100
```

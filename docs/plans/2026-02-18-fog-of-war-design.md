# Fog of War Design

## Overview

Single-layer fog of war inspired by RA2's shroud. Tiles start black (unseen) and are permanently revealed once any friendly unit or building has line of sight. Purely visual — no gameplay impact on combat targeting, AI, or pathfinding.

## Requirements

- **Single layer**: tiles are black (unseen) or fully visible (revealed forever)
- **Visual only**: no changes to combat, AI, harvester, or pathfinding logic
- **Solid black** rendering for unexplored tiles
- **Per-unit-type sight ranges** defined in `rules.json`
- **No fog in demo/observer mode**: fog only for human players in `'game'` mode
- **Minimap respects fog**: unseen areas rendered black on minimap

## Approach: Tile-Level Boolean Grid

A `Uint8Array` per player, one byte per tile. For the default 3000x3000 map (75x75 grid), this is 5,625 bytes per player. Values: `0` = unseen, `1` = revealed. Indexed by `tileY * gridW + tileX`.

### Why This Approach

- Tiny memory footprint (~5.5KB per player)
- O(1) lookup per tile during rendering
- Aligns with the existing 40px tile/grid system
- Simple to serialize for future save/load

### Alternatives Considered

- **Canvas composition layer**: Smooth circles but ~36MB per player, complex pipeline
- **Chunk-based (200px)**: Fewer cells but visually chunky, no real perf advantage

## Data Structures

### GameState Addition

```typescript
interface GameState {
    // ... existing fields
    fogOfWar: Record<number, Uint8Array>;  // playerId -> revealed tiles
}
```

Only human players get entries. Empty object `{}` in demo/observer mode.

### Sight Ranges in rules.json

Each unit and building type gets a `sightRange` field (pixels).

| Category | Unit | Weapon Range | Sight Range |
|----------|------|-------------|-------------|
| Infantry | Rifle | 130 | 200 |
| Infantry | Rocket | 160 | 240 |
| Infantry | Sniper | 450 | 500 |
| Infantry | Engineer | — | 160 |
| Infantry | Hijacker | — | 160 |
| Vehicle | Buggy | 150 | 240 |
| Vehicle | Tank | 150 | 240 |
| Vehicle | Mammoth | 180 | 280 |
| Vehicle | APC | — | 240 |
| Vehicle | MCV | — | 280 |
| Vehicle | Harvester | — | 200 |
| Vehicle | Demo Truck | — | 200 |
| Vehicle | Induction Rig | — | 200 |
| Air | Helicopter | 160 | 320 |
| Air | Bomber | 30 | 320 |
| Building | Construction Yard | — | 240 |
| Building | Refinery | — | 200 |
| Building | Power Plant | — | 160 |
| Building | Barracks | — | 200 |
| Building | War Factory | — | 200 |
| Building | Air Field | — | 200 |
| Building | Tech Center | — | 200 |
| Building | Turret | 250 | 320 |
| Building | SAM Site | 400 | 480 |
| Building | Service Depot | — | 200 |

Principle: sight range = weapon range + ~80px buffer, minimum 160px. Air units get extra range. Defense buildings see further.

## Visibility Update Logic

### Location

New file `src/engine/reducers/fog.ts` exporting:

```typescript
function updateFogOfWar(state: GameState): Record<number, Uint8Array>
```

Called from `game_loop.ts` after `rebuildSpatialGrid`, before `updateEntities`.

### Algorithm

```
For each player with a fogOfWar entry:
  For each entity owned by that player:
    sightRange = rules[entity.key].sightRange
    sightTiles = ceil(sightRange / TILE_SIZE)
    centerTileX = floor(entity.pos.x / TILE_SIZE)
    centerTileY = floor(entity.pos.y / TILE_SIZE)

    For each tile in bounding box (centerTile +/- sightTiles):
      if tile within circular radius AND in bounds AND not already revealed:
        fogOfWar[playerId][tileY * gridW + tileX] = 1
```

### Performance

- Typically 1 human player's fog to update
- Most tiles already revealed after early game (short-circuit on `already revealed` check)
- Sniper (worst case): ~530 tiles per unit. 50 units = ~26,500 checks/tick — trivial
- No dirty tracking needed

### Initialization

During skirmish setup in `game.ts`, create `Uint8Array` for human players. Immediately reveal tiles around starting buildings/units.

## Renderer Integration

### Main Canvas

In `render()` in `src/renderer/index.ts`:

1. Draw terrain/background as normal
2. Filter entities — skip entities on unrevealed tiles (when fog active)
3. Draw visible entities (existing logic with filtered list)
4. Draw fog overlay — iterate viewport tiles, `fillRect` solid black for each unrevealed tile

Only viewport tiles are checked (~600 tiles for typical 1200x800 screen).

### Minimap

In `src/ui/minimap.ts`, skip entities on unrevealed tiles and draw unrevealed areas as black.

### Demo/Observer Mode

When `localPlayerId === null` or no fog entry exists for the player, skip all fog logic entirely.

### Hidden Entities

Neutral entities (resources, rocks, wells) on unrevealed tiles are hidden. Once revealed, they stay visible permanently.

## Edge Smoothing

For each revealed tile adjacent to an unrevealed tile, draw a linear gradient (transparent to black) in the direction of the unrevealed neighbor. Cardinal directions only (up, down, left, right) — corners get natural overlap.

Typically 20-40 boundary tiles, so 40-80 gradient draws per frame. Canvas `createLinearGradient` is GPU-accelerated — negligible cost.

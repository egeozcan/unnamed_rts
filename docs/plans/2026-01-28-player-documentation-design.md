# Player Documentation & Landing Page Design

**Date:** 2026-01-28
**Status:** Approved

## Overview

Add comprehensive player documentation using VitePress, a play-first landing page, and an in-game pause menu with help content. All deployed together on GitHub Pages.

## Goals

- Serve both new players (RTS newcomers) and veterans (quick reference)
- Get players into the game quickly (play-first landing page)
- Provide in-game help without leaving the game (pause menu)
- Comprehensive strategy content for players who want depth

## Project Structure

```
unnamed_rts/
├── src/                    # Existing game source
├── docs/                   # VitePress documentation site
│   ├── .vitepress/
│   │   └── config.ts       # VitePress configuration
│   ├── index.md            # Landing page (play-first hero)
│   ├── guide/              # How to play guides
│   │   ├── getting-started.md
│   │   ├── controls.md
│   │   └── economy.md
│   ├── units/              # Unit encyclopedia
│   │   ├── infantry.md
│   │   ├── vehicles.md
│   │   └── aircraft.md
│   ├── buildings/          # Building encyclopedia
│   │   └── index.md
│   ├── strategy/           # Advanced tactics
│   │   ├── build-orders.md
│   │   ├── unit-counters.md
│   │   └── advanced-tactics.md
│   └── public/             # Screenshots, images
├── dist/                   # Game build output
└── package.json            # Shared scripts
```

## Landing Page

VitePress "home" layout with play-first emphasis:

**Hero Section:**
- Game title/logo at top
- One-line tagline (e.g., "Command your forces. Crush the enemy.")
- Large, prominent **"Play Now"** button → `/game/`
- Smaller secondary **"Learn to Play"** button → `/guide/getting-started`

**Below the fold:**
- 3-4 feature cards:
  - "22 Units" - Infantry, vehicles, aircraft
  - "Build & Conquer" - Base building, resource management
  - "Challenge AI" - 4 difficulty levels
  - "No Download" - Plays in browser
- Single gameplay screenshot or GIF

**Footer:**
- GitHub repo link
- "Made with TypeScript & Canvas"

## Documentation Content

### Guide Section (newcomers + quick reference)

- **Getting Started** - What is an RTS, first game walkthrough, UI overview
- **Controls & Shortcuts** - Mouse actions, keyboard hotkeys, selection mechanics
- **Economy** - Ore wells, harvesters, refineries, Induction Rigs, power management
- **Production** - Build queues, prerequisites, tech tree visualization
- **Combat Basics** - Attack-move, unit targeting, damage types, armor classes

### Encyclopedia Section (reference)

- **Infantry** - All 8 units with stats tables (cost, HP, damage, range, speed, prerequisites, role)
- **Vehicles** - All 12 units, same format
- **Aircraft** - Both air units, including ammo/reload mechanics
- **Buildings** - All 12 buildings with power cost/generation, prerequisites, special abilities

### Strategy Section (comprehensive)

- **Build Orders** - 3-4 recommended openers (rush, economy, tech)
- **Unit Counters** - Matrix showing what beats what
- **Economy Benchmarks** - Second refinery timing, harvester counts, Induction Rig timing
- **Advanced Tactics** - Harasser micro, artillery positioning, air strike timing, base layout

All pages use collapsible sections: veterans skim, newcomers expand.

## In-Game Pause Menu

### Game Mode

Add `'paused'` to existing game modes (`'menu'`, `'game'`, `'demo'`).

When paused:
- Game loop stops processing ticks
- Semi-transparent overlay covers canvas
- Centered modal panel displays pause menu

### Pause Menu UI

```
┌─────────────────────────────────┐
│          GAME PAUSED            │
├─────────────────────────────────┤
│  [Resume]     [Help]     [Quit] │
└─────────────────────────────────┘
```

### Help Panel (tabbed)

**Tab 1: Controls**
- Left-click: Select unit/building
- Right-click: Move / Attack / Harvest
- Drag: Box select multiple units
- Scroll/WASD: Pan camera

**Tab 2: Shortcuts**
- ESC: Deselect / Cancel
- 1-4: Select production queues
- H: Center on base
- Space: Pause (this menu)

**Tab 3: Quick Tips**
- "Build Power Plants to keep production running"
- "Harvesters are vulnerable - protect them"
- "Use Ctrl+group to assign control groups"

### Trigger

- `Space` or `P` during gameplay opens pause menu
- `ESC` or clicking Resume closes it

## Deployment Pipeline

### Updated GitHub Actions

Modify `.github/workflows/deploy.yml`:

```yaml
steps:
  - Install dependencies
  - Run tests
  - Build game (npm run build) → dist/
  - Build docs (npm run docs:build) → docs/.vitepress/dist/
  - Copy game build into docs output as /game/ subfolder
  - Deploy combined output to GitHub Pages
```

### New npm Scripts

```json
{
  "docs:dev": "vitepress dev docs",
  "docs:build": "vitepress build docs",
  "docs:preview": "vitepress preview docs"
}
```

### Final URL Structure

```
https://username.github.io/unnamed_rts/
├── index.html          # Landing page
├── guide/              # Documentation
├── units/
├── buildings/
├── strategy/
└── game/
    └── index.html      # The actual game
```

## Files to Create/Modify

### New Files
- `docs/.vitepress/config.ts` - VitePress configuration
- `docs/index.md` - Landing page
- `docs/guide/getting-started.md`
- `docs/guide/controls.md`
- `docs/guide/economy.md`
- `docs/guide/production.md`
- `docs/guide/combat.md`
- `docs/units/infantry.md`
- `docs/units/vehicles.md`
- `docs/units/aircraft.md`
- `docs/buildings/index.md`
- `docs/strategy/build-orders.md`
- `docs/strategy/unit-counters.md`
- `docs/strategy/advanced-tactics.md`

### Modified Files
- `src/engine/types.ts` - Add `'paused'` game mode
- `src/game.ts` - Pause toggle logic
- `src/renderer/index.ts` or new `src/ui/pause-menu.ts` - Pause menu rendering
- `src/input/keyboard.ts` - Space/P key binding
- `.github/workflows/deploy.yml` - Combined build pipeline
- `package.json` - Add docs scripts

## Implementation Order

1. **VitePress setup** - Install, configure, create landing page
2. **Documentation content** - Write all guide/encyclopedia/strategy pages
3. **Deployment pipeline** - Update GitHub Actions for combined build
4. **Pause menu** - Implement in-game pause with help content
5. **Polish** - Screenshots, final testing, link verification

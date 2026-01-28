# Player Documentation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add VitePress documentation site with landing page, player guides, unit/building encyclopedia, strategy content, and in-game pause menu with help.

**Architecture:** VitePress in `docs/site/` (preserving existing `docs/plans/`), combined build pipeline deploys game to `/game/` subfolder, pause menu overlays game canvas when Space/P pressed.

**Tech Stack:** VitePress 1.x, TypeScript, Canvas 2D (pause menu rendering)

---

## Task 1: VitePress Setup

**Files:**
- Create: `docs/site/.vitepress/config.ts`
- Create: `docs/site/index.md`
- Modify: `package.json`

**Step 1: Install VitePress**

Run: `npm install -D vitepress`
Expected: VitePress added to devDependencies

**Step 2: Create VitePress config**

Create `docs/site/.vitepress/config.ts`:

```typescript
import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Unnamed RTS',
  description: 'Browser-based real-time strategy game',
  base: '/unnamed_rts/',

  themeConfig: {
    nav: [
      { text: 'Play', link: '/game/' },
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Units', link: '/units/infantry' },
      { text: 'Buildings', link: '/buildings/' },
      { text: 'Strategy', link: '/strategy/build-orders' }
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/getting-started' },
            { text: 'Controls', link: '/guide/controls' },
            { text: 'Economy', link: '/guide/economy' },
            { text: 'Production', link: '/guide/production' },
            { text: 'Combat', link: '/guide/combat' }
          ]
        }
      ],
      '/units/': [
        {
          text: 'Units',
          items: [
            { text: 'Infantry', link: '/units/infantry' },
            { text: 'Vehicles', link: '/units/vehicles' },
            { text: 'Aircraft', link: '/units/aircraft' }
          ]
        }
      ],
      '/buildings/': [
        {
          text: 'Buildings',
          items: [
            { text: 'Overview', link: '/buildings/' }
          ]
        }
      ],
      '/strategy/': [
        {
          text: 'Strategy',
          items: [
            { text: 'Build Orders', link: '/strategy/build-orders' },
            { text: 'Unit Counters', link: '/strategy/unit-counters' },
            { text: 'Advanced Tactics', link: '/strategy/advanced-tactics' }
          ]
        }
      ]
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/egecan/unnamed_rts' }
    ]
  }
})
```

**Step 3: Create landing page**

Create `docs/site/index.md`:

```markdown
---
layout: home

hero:
  name: "Unnamed RTS"
  text: "Command your forces. Crush the enemy."
  tagline: Browser-based real-time strategy
  actions:
    - theme: brand
      text: Play Now
      link: /game/
    - theme: alt
      text: Learn to Play
      link: /guide/getting-started

features:
  - title: 22 Units
    details: Infantry, vehicles, and aircraft with unique abilities and counters
  - title: Build & Conquer
    details: Construct bases, harvest resources, and expand your territory
  - title: Challenge AI
    details: Four difficulty levels from Dummy to Hard
  - title: No Download
    details: Plays instantly in your browser
---
```

**Step 4: Add npm scripts**

In `package.json`, add to "scripts":

```json
"docs:dev": "vitepress dev docs/site",
"docs:build": "vitepress build docs/site",
"docs:preview": "vitepress preview docs/site"
```

**Step 5: Test VitePress**

Run: `npm run docs:dev`
Expected: VitePress dev server starts, landing page visible at localhost

**Step 6: Commit**

```bash
git add package.json package-lock.json docs/site/
git commit -m "$(cat <<'EOF'
feat(docs): add VitePress setup with landing page

- Install VitePress as dev dependency
- Create config with navigation and sidebar
- Add play-first landing page with hero and features

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Guide Section - Getting Started

**Files:**
- Create: `docs/site/guide/getting-started.md`

**Step 1: Create getting started guide**

Create `docs/site/guide/getting-started.md`:

```markdown
# Getting Started

Welcome to Unnamed RTS, a browser-based real-time strategy game inspired by classic Command & Conquer.

## What is an RTS?

Real-time strategy (RTS) games put you in command of a base and army. Unlike turn-based games, everything happens simultaneously—you build structures, train units, and fight enemies all at once.

## Your First Game

1. **Start a Skirmish** - Choose your slot (Player 1 is blue), pick AI opponents and difficulty
2. **Build Power Plants** - Your Construction Yard needs power to function
3. **Build a Refinery** - This comes with a free Harvester that automatically gathers ore
4. **Expand** - Build a Barracks for infantry, then a War Factory for tanks
5. **Attack** - Select units, right-click on enemies to attack

## The UI

| Area | Purpose |
|------|---------|
| **Main View** | The battlefield—scroll with arrow keys or edge panning |
| **Sidebar** | Building/unit buttons, production queues |
| **Minimap** | Overview of the map, click to jump to location |
| **Credits** | Your money—earned from ore |
| **Power** | Power supply vs demand—low power slows production |

## Game Modes

- **Skirmish** - You vs AI opponents (1-7 enemies)
- **Demo** - Watch AI players battle each other

## Tips for Beginners

- **Economy first** - More harvesters = more money = more tanks
- **Scout early** - Know where your enemies are
- **Protect harvesters** - They're slow and valuable targets
- **Build defenses** - Turrets deter early attacks while you build up
- **Use hotkeys** - Press `1-5` to change game speed, `F3` for debug mode
```

**Step 2: Commit**

```bash
git add docs/site/guide/getting-started.md
git commit -m "$(cat <<'EOF'
docs(guide): add getting started guide

Covers RTS basics, first game walkthrough, UI overview, and beginner tips.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Guide Section - Controls

**Files:**
- Create: `docs/site/guide/controls.md`

**Step 1: Create controls guide**

Create `docs/site/guide/controls.md`:

```markdown
# Controls & Shortcuts

## Mouse Controls

| Action | Effect |
|--------|--------|
| **Left-click** | Select unit/building |
| **Left-drag** | Box select multiple units |
| **Shift + Left-click** | Add/remove from selection |
| **Right-click** | Move / Attack / Harvest / Deploy |
| **Double-click** | Deploy MCV, set primary building |
| **Middle-drag** | Pan camera (hold and move) |
| **Scroll wheel** | Zoom in/out |

## Keyboard Shortcuts

### Camera

| Key | Action |
|-----|--------|
| **Arrow keys** | Pan camera |
| **B** | Toggle bird's eye view |

### Game Speed

| Key | Speed |
|-----|-------|
| **1** | Slow |
| **2** | Normal |
| **3** | Fast |
| **4** | Very Fast |
| **5** | Lightspeed |

### Unit Commands

| Key | Action |
|-----|--------|
| **A** | Attack-move mode (click to move, auto-attack enemies in path) |
| **Enter** | Deploy selected MCV |
| **Escape** | Cancel placement / Deselect |

### Unit Stances

| Key | Stance | Behavior |
|-----|--------|----------|
| **F** | Aggressive | Chase enemies, roam freely |
| **G** | Defensive | Attack nearby enemies, return to position |
| **H** | Hold Ground | Only attack enemies in range, never move |

### Debug

| Key | Action |
|-----|--------|
| **F3** | Toggle debug mode (pauses game, shows entity info) |
| **M** | Toggle minimap (demo mode only) |

## Context-Sensitive Commands

Right-click behavior depends on what you click:

| Target | With Selected Units | Result |
|--------|---------------------|--------|
| Ground | Any unit | Move to location |
| Enemy | Combat unit | Attack enemy |
| Ore | Harvester | Harvest ore field |
| Ore Well | Induction Rig | Deploy on well |
| Enemy Building | Engineer | Capture building |
| Friendly Building | Engineer | Repair building |

## Selection Tips

- **Double-click** a unit to select all units of that type on screen
- **Shift-click** to add or remove individual units from selection
- Hold **Shift** while drag-selecting to add to existing selection
- Click empty ground to deselect all
```

**Step 2: Commit**

```bash
git add docs/site/guide/controls.md
git commit -m "$(cat <<'EOF'
docs(guide): add controls and shortcuts reference

Complete keyboard and mouse controls with context-sensitive commands.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Guide Section - Economy

**Files:**
- Create: `docs/site/guide/economy.md`

**Step 1: Create economy guide**

Create `docs/site/guide/economy.md`:

```markdown
# Economy

Your economy determines how fast you can build. More credits = more units = victory.

## Credits

Credits are your currency. You start with enough to build basic structures.

**Earning Credits:**
- Harvesters collect ore and return it to Refineries
- Each load of ore converts to credits based on cargo amount

## Ore

Ore patches appear in clusters across the map. They're finite—once harvested, they're gone.

**Ore Properties:**
- Appears as green/teal patches on the ground
- Harvesters automatically find and collect nearby ore
- Right-click ore to redirect a harvester manually

## Ore Wells

Golden glowing spots on the map are **Ore Wells**—infinite resource generators.

**How Wells Work:**
- Wells slowly regenerate ore patches around them
- They spawn ore within a ~120 pixel radius
- Wells themselves can't be harvested directly

## Induction Rigs

For late-game infinite income, deploy an **Induction Rig** on an ore well.

**Deployment:**
1. Build an Induction Rig at the War Factory (costs 1800)
2. Move the Rig to an unoccupied ore well
3. Right-click the well when in range to deploy
4. The deployed rig provides 80% harvesting efficiency infinitely

::: tip
Deployed Induction Rigs glow on the minimap, making them easy to track.
:::

## Harvesters

Harvesters are your income generators.

| Stat | Value |
|------|-------|
| Cost | 1400 |
| HP | 1000 |
| Cargo Capacity | 500 |
| Speed | 1.5 |

**Harvester Behavior:**
- Automatically seek nearby ore
- Return to nearest Refinery when full
- Will defend themselves with weak machine gun

::: warning
Harvesters are high-priority targets. Escort them with tanks or position defenses near ore fields.
:::

## Refineries

Each Refinery:
- Comes with one free Harvester
- Processes ore into credits
- Has a single dock—harvesters queue to unload

**Multiple Refineries:**
- Build 2-3 Refineries for a healthy economy
- More refineries = more simultaneous unloading
- Place them near ore for shorter travel times

## Power

Buildings require power. If demand exceeds supply:
- Production slows significantly
- Defenses fire slower
- Radar/advanced features may disable

**Power Plants:**
- Generate 200 power each
- Cost 300 credits
- Build them before advanced buildings

**Power Tips:**
- Watch the power bar—build preemptively
- Power Plants are critical targets—protect them
- Tech Center and Obelisk drain 50-100 power each
```

**Step 2: Commit**

```bash
git add docs/site/guide/economy.md
git commit -m "$(cat <<'EOF'
docs(guide): add economy guide

Covers credits, ore, wells, Induction Rigs, harvesters, refineries, and power.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Guide Section - Production & Combat

**Files:**
- Create: `docs/site/guide/production.md`
- Create: `docs/site/guide/combat.md`

**Step 1: Create production guide**

Create `docs/site/guide/production.md`:

```markdown
# Production

Buildings and units are produced through four separate queues.

## Production Queues

| Queue | Building | Produces |
|-------|----------|----------|
| Building | Construction Yard | Structures |
| Infantry | Barracks | Soldiers |
| Vehicle | War Factory | Tanks, MCV, Induction Rig |
| Air | Air-Force Command | Helicopters, Harriers |

Each queue operates independently—you can build a tank and infantry simultaneously.

## Prerequisites

Advanced units require specific buildings:

| Want to Build | Need First |
|---------------|------------|
| Infantry | Barracks |
| Vehicles | Refinery → War Factory |
| Tech units | Tech Center |
| Aircraft | Air-Force Command |

**Tech Center Unlocks:**
- Sniper, Commando (infantry)
- Mammoth Tank, Artillery, MLRS, Stealth Tank (vehicles)
- Obelisk (defense)

## Build Queues

Click a unit button multiple times to queue up to 99 units.

**Queue Management:**
- Right-click a queued item to remove one
- Shift + Right-click to remove 5
- Cancel refunds invested credits

## Rally Points

Set where newly built units spawn:
1. Select a Barracks or War Factory
2. Right-click a location on the map
3. New units will move there after spawning

## Primary Buildings

If you have multiple Barracks or Factories:
- Double-click one to set it as "Primary"
- Primary building produces the current queue's units
- Non-primary buildings are backups if primary is destroyed

## Selling Buildings

Need quick cash? Sell a building:
1. Click the "$" sell button in sidebar
2. Click a building to sell it
3. Get 50% of original cost back

::: warning
You cannot sell your last Construction Yard.
:::

## Repairing Buildings

Damaged buildings can be repaired:
1. Click the wrench repair button
2. Click a damaged building
3. Repair costs 30% of building cost, happens over time
4. Click again to stop repairing

**Alternative:** Send an Engineer to a friendly building to repair it instantly (one-time use).
```

**Step 2: Create combat guide**

Create `docs/site/guide/combat.md`:

```markdown
# Combat

Understanding combat mechanics helps you win battles efficiently.

## Targeting

- **Right-click enemy** - Attack that specific target
- **Attack-move (A + click)** - Move to location, attack enemies along the way
- Units auto-acquire targets within range based on stance

## Stances

| Stance | Key | Behavior |
|--------|-----|----------|
| Aggressive | F | Chase enemies anywhere on map |
| Defensive | G | Attack nearby, return to position |
| Hold Ground | H | Never move, only attack in range |

**Default stance is Aggressive.** Use Defensive for guard duty, Hold Ground for ambushes.

## Weapon Types

Different weapons perform differently against armor types:

| Weapon | Best Against | Weak Against |
|--------|-------------|--------------|
| Bullet | Infantry | Vehicles |
| AP Bullet | Light vehicles | Infantry |
| Cannon | All-round | Heavy armor |
| Heavy Cannon | Heavy armor, buildings | Infantry |
| Rocket | Vehicles | — |
| Missile | Heavy armor, air | Ground infantry |
| Flame | Infantry | Heavy armor |
| Sniper | Infantry | Everything else |
| Laser | Everything equally | — |

## Armor Types

| Armor | Found On |
|-------|----------|
| Infantry | All foot soldiers |
| Light | Rangers, APCs, Harriers |
| Medium | Light Tanks, Flame Tanks |
| Heavy | Heavy Tank, Mammoth, Harvester |
| Building | All structures |

## Splash Damage

Some weapons deal area damage:

| Weapon | Splash Radius |
|--------|---------------|
| Rocket | 25 |
| Grenade | 35 |
| Flame | 30-50 |
| Artillery | 60 |
| MLRS | 80 |
| Demo Truck | 150 |

::: tip
Group infantry loosely to reduce splash damage casualties.
:::

## Aircraft Combat

**Helicopters:**
- Sustained firepower with rockets
- Flexible, can attack any target
- Must be built at factory level, requires Tech Center

**Harriers:**
- Single devastating strike per sortie
- Returns to Air-Force Command to reload
- Select Air-Force Command + right-click enemy = launch all docked Harriers

**Anti-Air:**
- SAM Sites (building defense)
- Rocket Soldiers (infantry)
- Helicopters can target other aircraft

## Interception

SAM Sites and MLRS have **interception auras** that shoot down incoming missiles and artillery shells:

| Unit | Aura Radius | DPS vs Projectiles |
|------|-------------|-------------------|
| SAM Site | 200 | 150 |
| MLRS | 120 | 80 |
| Rocket Soldier | 60 | 40 |

This makes massed SAMs effective against artillery bombardment.

## Demo Trucks

The Demo Truck is a suicide unit:
- Explodes on contact with enemies
- Also explodes when destroyed
- 600 damage in 150 radius
- Can chain-react with other Demo Trucks

::: danger
Keep Demo Trucks away from your own units—friendly fire is very real.
:::
```

**Step 3: Commit**

```bash
git add docs/site/guide/production.md docs/site/guide/combat.md
git commit -m "$(cat <<'EOF'
docs(guide): add production and combat guides

Production covers queues, prerequisites, rally points, selling, repair.
Combat covers targeting, stances, weapon/armor types, aircraft, interception.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Units Encyclopedia - Infantry

**Files:**
- Create: `docs/site/units/infantry.md`

**Step 1: Create infantry page**

Create `docs/site/units/infantry.md`:

```markdown
# Infantry

Infantry are cheap, fast to train, and versatile. Build them at the **Barracks**.

## Rifleman

Basic infantry unit. Effective in groups against other infantry.

| Stat | Value |
|------|-------|
| Cost | 100 |
| HP | 60 |
| Speed | 2.0 |
| Damage | 6 |
| Range | 130 |
| Armor | Infantry |
| Weapon | Bullet |

**Role:** Cannon fodder, early defense, anti-infantry swarms.

**Prerequisites:** Barracks

---

## Rocket Soldier

Anti-armor infantry with splash damage rockets.

| Stat | Value |
|------|-------|
| Cost | 300 |
| HP | 70 |
| Speed | 1.5 |
| Damage | 35 |
| Range | 220 |
| Splash | 25 |
| Armor | Infantry |
| Weapon | Rocket |

**Role:** Anti-vehicle, anti-air (rockets can target aircraft).

**Special:** Has interception aura (60 radius, 40 DPS) that can shoot down incoming missiles.

**Prerequisites:** Barracks

---

## Engineer

Support unit that captures or repairs buildings.

| Stat | Value |
|------|-------|
| Cost | 500 |
| HP | 50 |
| Speed | 2.0 |
| Armor | Infantry |

**Role:** Capture enemy buildings, repair friendly buildings.

**Usage:**
- Right-click enemy building → Capture (instant, consumes Engineer)
- Right-click friendly building → Repair (instant, consumes Engineer)

**Prerequisites:** Barracks

::: tip
Capturing an enemy Construction Yard can turn the tide of battle.
:::

---

## Medic

Healer that automatically restores HP to nearby friendly infantry.

| Stat | Value |
|------|-------|
| Cost | 350 |
| HP | 45 |
| Speed | 2.2 |
| Heal | 15 HP/shot |
| Range | 80 |
| Armor | Infantry |

**Role:** Keep infantry squads alive longer.

**Prerequisites:** Barracks

---

## Sniper

Long-range specialist that one-shots most infantry.

| Stat | Value |
|------|-------|
| Cost | 800 |
| HP | 45 |
| Speed | 1.5 |
| Damage | 90 |
| Range | 450 |
| Armor | Infantry |
| Weapon | Sniper |

**Role:** Counter enemy infantry from extreme range.

**Weakness:** Terrible against vehicles (0.05x damage to heavy armor).

**Prerequisites:** Barracks, Tech Center

---

## Flamethrower

Short-range area damage infantry.

| Stat | Value |
|------|-------|
| Cost | 400 |
| HP | 80 |
| Speed | 1.8 |
| Damage | 20 |
| Range | 80 |
| Splash | 30 |
| Armor | Infantry |
| Weapon | Flame |

**Role:** Devastating against grouped infantry and buildings.

**Weakness:** Very short range—vulnerable while closing distance.

**Prerequisites:** Barracks

---

## Grenadier

Splash damage infantry with moderate range.

| Stat | Value |
|------|-------|
| Cost | 250 |
| HP | 65 |
| Speed | 1.7 |
| Damage | 40 |
| Range | 180 |
| Splash | 35 |
| Armor | Infantry |
| Weapon | Grenade |

**Role:** Anti-infantry splash, light anti-vehicle.

**Prerequisites:** Barracks

---

## Commando

Elite soldier with armor-piercing rounds.

| Stat | Value |
|------|-------|
| Cost | 1500 |
| HP | 120 |
| Speed | 2.5 |
| Damage | 60 |
| Range | 200 |
| Armor | Infantry |
| Weapon | AP Bullet |

**Role:** Elite all-purpose infantry—fast, tough, effective against all targets.

**Prerequisites:** Barracks, Tech Center
```

**Step 2: Commit**

```bash
git add docs/site/units/infantry.md
git commit -m "$(cat <<'EOF'
docs(units): add infantry encyclopedia

All 8 infantry units with full stats, roles, and prerequisites.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Units Encyclopedia - Vehicles

**Files:**
- Create: `docs/site/units/vehicles.md`

**Step 1: Create vehicles page**

Create `docs/site/units/vehicles.md`:

```markdown
# Vehicles

Vehicles are your main combat force. Build them at the **War Factory**.

## Harvester

Resource gatherer—essential for your economy.

| Stat | Value |
|------|-------|
| Cost | 1400 |
| HP | 1000 |
| Speed | 1.5 |
| Cargo | 500 |
| Armor | Heavy |

**Role:** Collect ore, fund your army.

**Prerequisites:** Refinery, War Factory

::: warning
High-priority target. Escort with combat units.
:::

---

## Ranger

Fast scout with drive-by attacks.

| Stat | Value |
|------|-------|
| Cost | 500 |
| HP | 180 |
| Speed | 4.5 |
| Damage | 18 |
| Range | 160 |
| Armor | Light |
| Weapon | Bullet |

**Role:** Scouting, harassment, hunting harvesters.

**Special:** Can attack while moving.

**Prerequisites:** War Factory

---

## APC

Fast armored transport with armor-piercing gun.

| Stat | Value |
|------|-------|
| Cost | 700 |
| HP | 300 |
| Speed | 3.5 |
| Damage | 12 |
| Range | 120 |
| Armor | Light |
| Weapon | AP Bullet |

**Role:** Fast response, engineer transport, light combat.

**Special:** Can attack while moving.

**Prerequisites:** War Factory

---

## Light Tank

Balanced main battle tank.

| Stat | Value |
|------|-------|
| Cost | 800 |
| HP | 400 |
| Speed | 2.8 |
| Damage | 45 |
| Range | 210 |
| Armor | Medium |
| Weapon | Cannon |

**Role:** Core of your army—good all-round performance.

**Special:** Can attack while moving.

**Prerequisites:** War Factory

---

## Heavy Tank

Assault tank with strong armor and firepower.

| Stat | Value |
|------|-------|
| Cost | 1600 |
| HP | 700 |
| Speed | 2.0 |
| Damage | 90 |
| Range | 230 |
| Armor | Heavy |
| Weapon | Cannon |

**Role:** Frontline assault, breaking enemy defenses.

**Prerequisites:** War Factory

---

## Flame Tank

Anti-infantry specialist with area flames.

| Stat | Value |
|------|-------|
| Cost | 1100 |
| HP | 450 |
| Speed | 2.2 |
| Damage | 35 |
| Range | 100 |
| Splash | 50 |
| Armor | Medium |
| Weapon | Flame |

**Role:** Melting infantry blobs, building assault.

**Prerequisites:** War Factory

---

## Stealth Tank

Fast missile tank.

| Stat | Value |
|------|-------|
| Cost | 1400 |
| HP | 350 |
| Speed | 3.2 |
| Damage | 55 |
| Range | 180 |
| Armor | Medium |
| Weapon | Missile |

**Role:** Fast striker, flanking attacks.

**Prerequisites:** War Factory, Tech Center

---

## Artillery

Long-range siege unit.

| Stat | Value |
|------|-------|
| Cost | 1200 |
| HP | 200 |
| Speed | 1.2 |
| Damage | 130 |
| Range | 550 |
| Splash | 60 |
| Armor | Light |
| Weapon | Heavy Cannon |

**Role:** Destroying buildings and defenses from afar.

**Weakness:** Paper-thin armor—keep protected behind tank lines.

**Note:** Artillery shells can be intercepted by SAM Sites.

**Prerequisites:** War Factory, Tech Center

---

## MLRS

Rocket artillery with massive splash.

| Stat | Value |
|------|-------|
| Cost | 1800 |
| HP | 250 |
| Speed | 1.5 |
| Damage | 100 |
| Range | 500 |
| Splash | 80 |
| Armor | Light |
| Weapon | Missile |

**Role:** Area denial, softening defenses, anti-infantry.

**Special:** Has interception aura (120 radius, 80 DPS)—can shoot down enemy missiles.

**Prerequisites:** War Factory, Tech Center

---

## Mammoth Tank

The ultimate ground unit.

| Stat | Value |
|------|-------|
| Cost | 2500 |
| HP | 1200 |
| Speed | 1.4 |
| Damage | 120 |
| Range | 250 |
| Armor | Heavy |
| Weapon | Heavy Cannon |

**Role:** Unstoppable assault, crushing enemy bases.

**Prerequisites:** War Factory, Tech Center

---

## MCV (Mobile Construction Vehicle)

Deploys into a Construction Yard.

| Stat | Value |
|------|-------|
| Cost | 3000 |
| HP | 2000 |
| Speed | 1.0 |
| Armor | Heavy |

**Role:** Expand to new bases, rebuild after losing your Construction Yard.

**Usage:** Double-click or press Enter to deploy.

**Prerequisites:** War Factory

---

## Induction Rig

Deploys on ore wells for infinite resources.

| Stat | Value |
|------|-------|
| Cost | 1800 |
| HP | 600 |
| Speed | 0.8 |
| Armor | Light |

**Role:** Late-game infinite income source.

**Usage:** Right-click an ore well when in range to deploy.

**Prerequisites:** War Factory, Refinery

---

## Demo Truck

Suicide vehicle that explodes on impact.

| Stat | Value |
|------|-------|
| Cost | 1500 |
| HP | 150 |
| Speed | 2.8 |
| Explosion Damage | 600 |
| Explosion Radius | 150 |
| Armor | Light |

**Role:** Base assault, destroying clusters of enemies.

**Warning:** Explodes when destroyed—including by friendly fire.

**Prerequisites:** War Factory
```

**Step 2: Commit**

```bash
git add docs/site/units/vehicles.md
git commit -m "$(cat <<'EOF'
docs(units): add vehicles encyclopedia

All 12 vehicle units with full stats, roles, and prerequisites.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Units Encyclopedia - Aircraft

**Files:**
- Create: `docs/site/units/aircraft.md`

**Step 1: Create aircraft page**

Create `docs/site/units/aircraft.md`:

```markdown
# Aircraft

Aircraft provide mobility and strike capability. They require the **Air-Force Command** building.

## Helicopter

Versatile gunship with sustained firepower.

| Stat | Value |
|------|-------|
| Cost | 1500 |
| HP | 250 |
| Speed | 6.0 |
| Damage | 45 |
| Range | 300 |
| Armor | Light |
| Weapon | Rocket |

**Role:** Flexible attack platform, harassment, anti-vehicle.

**Notes:**
- Can attack ground and air targets
- Doesn't need to return to base to reload
- Vulnerable to SAM Sites and Rocket Soldiers

**Prerequisites:** Tech Center

---

## Harrier

Strike fighter with devastating single-pass attacks.

| Stat | Value |
|------|-------|
| Cost | 1200 |
| HP | 200 |
| Speed | 8.0 |
| Damage | 120 |
| Range | 250 |
| Ammo | 1 |
| Armor | Light |
| Weapon | Air Missile |

**Role:** Precision strikes against high-value targets.

**Mechanics:**
- Carries 1 missile per sortie
- Automatically returns to Air-Force Command after firing
- Reloads while docked (120 ticks = ~4 seconds at normal speed)

**Prerequisites:** Air-Force Command

---

## Using Aircraft Effectively

### Mass Harrier Strikes

1. Build multiple Harriers (Air-Force Command has 6 landing slots)
2. Wait for all to dock and reload
3. Select the Air-Force Command building
4. Right-click an enemy target
5. All docked Harriers with ammo launch simultaneously

### Anti-Air Defense

| Counter | Effectiveness |
|---------|---------------|
| SAM Site | 400 range, 80 damage missiles |
| Rocket Soldier | 220 range, can fire while moving |
| Obelisk | 350 range laser, hits air |

### Aircraft Limitations

- Cannot capture or repair
- Vulnerable while returning to base
- Limited by Air-Force Command capacity (6 slots)
- Harriers are useless if Air-Force Command is destroyed while they're airborne
```

**Step 2: Commit**

```bash
git add docs/site/units/aircraft.md
git commit -m "$(cat <<'EOF'
docs(units): add aircraft encyclopedia

Helicopter and Harrier with mechanics, usage tips, and counters.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Buildings Encyclopedia

**Files:**
- Create: `docs/site/buildings/index.md`

**Step 1: Create buildings page**

Create `docs/site/buildings/index.md`:

```markdown
# Buildings

All buildings require the **Construction Yard** and most require **Power Plants**.

## Production Buildings

### Construction Yard

The heart of your base.

| Stat | Value |
|------|-------|
| Cost | 3000 |
| HP | 3000 |
| Power | +10 |
| Size | 90×90 |

**Role:** Required for all construction. Protect it!

**Note:** Deploy an MCV to create a new Construction Yard.

---

### Power Plant

Generates power for your base.

| Stat | Value |
|------|-------|
| Cost | 300 |
| HP | 800 |
| Power | +200 |
| Size | 60×60 |

**Prerequisites:** Construction Yard

**Tip:** Build 2-3 before advanced structures.

---

### Refinery

Processes ore into credits.

| Stat | Value |
|------|-------|
| Cost | 2000 |
| HP | 1200 |
| Power | -30 |
| Size | 100×80 |

**Special:** Comes with a free Harvester.

**Prerequisites:** Construction Yard, Power Plant

---

### Barracks

Trains infantry units.

| Stat | Value |
|------|-------|
| Cost | 500 |
| HP | 1000 |
| Power | -10 |
| Size | 60×80 |

**Produces:** Rifleman, Rocket, Engineer, Medic, Flamethrower, Grenadier, Sniper*, Commando*

*Requires Tech Center

**Prerequisites:** Construction Yard, Power Plant

---

### War Factory

Produces vehicles.

| Stat | Value |
|------|-------|
| Cost | 2000 |
| HP | 2000 |
| Power | -20 |
| Size | 100×100 |

**Produces:** Harvester, Ranger, APC, Light Tank, Heavy Tank, Flame Tank, Stealth Tank*, Artillery*, MLRS*, Mammoth*, MCV, Induction Rig, Demo Truck

*Requires Tech Center

**Prerequisites:** Construction Yard, Refinery, Barracks

---

### Tech Center

Unlocks advanced units and buildings.

| Stat | Value |
|------|-------|
| Cost | 1500 |
| HP | 1000 |
| Power | -50 |
| Size | 80×80 |

**Unlocks:** Sniper, Commando, Mammoth Tank, Artillery, MLRS, Stealth Tank, Helicopter, Obelisk

**Limit:** 1 per player

**Prerequisites:** Construction Yard, War Factory

---

### Air-Force Command

Produces and rearms aircraft.

| Stat | Value |
|------|-------|
| Cost | 2000 |
| HP | 1500 |
| Power | -50 |
| Size | 100×80 |
| Landing Slots | 6 |
| Reload Time | 120 ticks |

**Produces:** Harrier

**Special:** Select building + right-click enemy = launch all docked Harriers

**Prerequisites:** Construction Yard, Power Plant, Barracks

---

### Service Depot

Auto-repairs nearby vehicles.

| Stat | Value |
|------|-------|
| Cost | 1500 |
| HP | 1500 |
| Power | -50 |
| Size | 120×120 |
| Repair Radius | 90 |
| Repair Rate | 2 HP/tick |

**Role:** Free healing for vehicles. Park damaged tanks nearby.

**Limit:** 1 per player

**Prerequisites:** Construction Yard, Barracks, War Factory

---

## Defense Buildings

### Pillbox

Cheap anti-infantry defense.

| Stat | Value |
|------|-------|
| Cost | 400 |
| HP | 600 |
| Power | -10 |
| Damage | 15 |
| Range | 150 |
| Size | 40×40 |

**Role:** Base perimeter against infantry rushes.

**Prerequisites:** Construction Yard, Barracks

---

### Gun Turret

Anti-ground defense.

| Stat | Value |
|------|-------|
| Cost | 800 |
| HP | 1000 |
| Power | -40 |
| Damage | 25 |
| Range | 250 |
| Size | 40×40 |

**Role:** All-purpose ground defense.

**Limitation:** Cannot target aircraft.

**Prerequisites:** Construction Yard, Barracks

---

### SAM Site

Anti-air defense.

| Stat | Value |
|------|-------|
| Cost | 1200 |
| HP | 800 |
| Power | -30 |
| Damage | 80 |
| Range | 400 |
| Size | 40×40 |

**Role:** Essential against aircraft.

**Special:** Interception aura (200 radius, 150 DPS) shoots down missiles and artillery.

**Limitation:** Cannot target ground units.

**Prerequisites:** Construction Yard, Barracks

---

### Obelisk

Advanced laser defense.

| Stat | Value |
|------|-------|
| Cost | 2800 |
| HP | 1500 |
| Power | -100 |
| Damage | 200 |
| Range | 350 |
| Size | 40×60 |

**Role:** Devastating against all targets. Melts tanks.

**Note:** High power drain—ensure adequate Power Plants.

**Prerequisites:** Construction Yard, Tech Center

---

## Special Buildings

### Induction Rig (Deployed)

Deployed on ore wells for infinite extraction.

| Stat | Value |
|------|-------|
| HP | 400 |
| Efficiency | 80% |
| Size | 50×50 |

**Role:** Late-game infinite income.

**Note:** Glows on minimap for easy tracking.
```

**Step 2: Commit**

```bash
git add docs/site/buildings/index.md
git commit -m "$(cat <<'EOF'
docs(buildings): add buildings encyclopedia

All 12 buildings with stats, roles, prerequisites, and notes.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Strategy Section

**Files:**
- Create: `docs/site/strategy/build-orders.md`
- Create: `docs/site/strategy/unit-counters.md`
- Create: `docs/site/strategy/advanced-tactics.md`

**Step 1: Create build orders**

Create `docs/site/strategy/build-orders.md`:

```markdown
# Build Orders

A build order is your opening sequence of structures and units. The right build gives you an economic or military advantage.

## Standard Economic Opening

Safe opener that focuses on economy first.

1. **Power Plant** (300)
2. **Power Plant** (300)
3. **Refinery** (2000) → Free Harvester
4. **Barracks** (500)
5. **Refinery** (2000) → 2nd Harvester
6. **War Factory** (2000)
7. **Harvester** (1400)

**Total:** ~8500 credits

**Why it works:** Two refineries with 3 harvesters gives steady income. Barracks unlocks defenses and War Factory.

---

## Rush Build

Aggressive opener to pressure enemy early.

1. **Power Plant** (300)
2. **Barracks** (500)
3. **Refinery** (2000)
4. **5-6 Riflemen** (500-600)
5. **War Factory** (2000)
6. **Light Tanks** (800 each)

**Total:** ~6000 credits before tanks

**When to use:** Against greedy economic openers. Scout first!

**Risk:** If the rush fails, you're behind economically.

---

## Tech Rush

Fast path to advanced units.

1. **Power Plant** (300)
2. **Refinery** (2000)
3. **Barracks** (500)
4. **Power Plant** (300)
5. **War Factory** (2000)
6. **Tech Center** (1500)
7. **Mammoth Tank** (2500)

**Total:** ~9100 credits to first Mammoth

**Why it works:** Mammoths dominate mid-game. One Mammoth beats 3 Light Tanks.

**Risk:** Vulnerable to early rushes. Build some defense.

---

## Air Rush

Harrier-focused opener.

1. **Power Plant** (300)
2. **Power Plant** (300)
3. **Barracks** (500)
4. **Air-Force Command** (2000)
5. **Refinery** (2000)
6. **3-4 Harriers** (3600-4800)

**Total:** ~8700-9900 credits

**Why it works:** Harrier strikes can kill harvesters and cripple enemy economy.

**Counter:** SAM Sites. Scout first to see if enemy has anti-air.

---

## Economic Benchmarks

| Time Point | Goal |
|------------|------|
| Early game | 2-3 Harvesters working |
| Mid game | 3-4 Harvesters, consider Induction Rig |
| Late game | 2+ Induction Rigs on wells |

**Rule of thumb:** If you have money sitting idle, build more production or units.
```

**Step 2: Create unit counters**

Create `docs/site/strategy/unit-counters.md`:

```markdown
# Unit Counters

Every unit has strengths and weaknesses. Use the right counter to win efficiently.

## Counter Matrix

### Infantry Counters

| Unit | Countered By |
|------|--------------|
| Rifleman | Flamethrower, Flame Tank, any vehicle |
| Rocket Soldier | Sniper, fast vehicles (Ranger) |
| Engineer | Any combat unit (kill before capture) |
| Medic | Focus fire, splash damage |
| Sniper | Vehicles, aircraft |
| Flamethrower | Range units, vehicles |
| Grenadier | Vehicles, snipers |
| Commando | Massed infantry, vehicles |

### Vehicle Counters

| Unit | Countered By |
|------|--------------|
| Harvester | Anything (slow, weak gun) |
| Ranger | Tanks, turrets |
| APC | Tanks |
| Light Tank | Heavy Tank, Mammoth, massed Rockets |
| Heavy Tank | Mammoth, Artillery, massed Rockets |
| Flame Tank | Range (stay back), Rockets |
| Stealth Tank | Heavy Tank, Mammoth |
| Artillery | Rush it (low HP), aircraft |
| MLRS | Rush it, aircraft |
| Mammoth | Massed Artillery, Harrier strikes |
| Demo Truck | Kill at range before it reaches you |

### Aircraft Counters

| Unit | Countered By |
|------|--------------|
| Helicopter | SAM Site, Rocket Soldiers |
| Harrier | SAM Site (destroys on approach) |

### Building Counters

| Defense | Countered By |
|---------|--------------|
| Pillbox | Tanks, Rockets |
| Gun Turret | Artillery, Mammoth |
| SAM Site | Ground units (can't shoot ground) |
| Obelisk | Mass rush, out-range with Artillery |

## Damage Modifier Reference

How much damage weapons deal to each armor type:

| Weapon | Infantry | Light | Medium | Heavy | Building |
|--------|----------|-------|--------|-------|----------|
| Bullet | 1.0 | 0.4 | 0.2 | 0.1 | 0.15 |
| AP Bullet | 0.6 | 1.25 | 0.8 | 0.4 | 0.4 |
| Cannon | 0.4 | 1.0 | 1.0 | 0.6 | 1.0 |
| Heavy Cannon | 0.2 | 0.6 | 1.0 | 1.25 | 1.5 |
| Rocket | 0.4 | 1.0 | 1.25 | 1.0 | 1.0 |
| Missile | 0.15 | 0.6 | 1.0 | 1.5 | 1.25 |
| Flame | 1.75 | 1.25 | 0.5 | 0.35 | 0.6 |
| Sniper | 4.0 | 0.3 | 0.15 | 0.05 | 0.05 |
| Laser | 1.0 | 1.0 | 1.0 | 1.0 | 1.0 |
| Grenade | 1.5 | 0.9 | 0.5 | 0.3 | 0.8 |

**Key insights:**
- Snipers deal 4x damage to infantry but almost nothing to vehicles
- Flames are devastating vs infantry (1.75x) but weak vs heavy armor (0.35x)
- Heavy cannons excel vs heavy armor (1.25x) and buildings (1.5x)
- Lasers (Obelisk) deal equal damage to everything
```

**Step 3: Create advanced tactics**

Create `docs/site/strategy/advanced-tactics.md`:

```markdown
# Advanced Tactics

Master these techniques to elevate your gameplay.

## Micro Tactics

### Kiting

Use faster units to stay at max range while attacking slower enemies.

1. Attack enemy
2. Move away before they close distance
3. Attack again
4. Repeat

**Best with:** Rangers, Stealth Tanks, Snipers

---

### Focus Fire

Concentrate all units on one target at a time.

**Why:** Killing one unit removes its damage output. Three half-dead tanks still fire at full strength.

**How:** Select all units → Right-click single enemy → Wait for kill → New target

---

### Spread Formation

Keep units loosely grouped to minimize splash damage.

**Against:** Artillery, MLRS, Grenadiers, Flame Tanks, Demo Trucks

---

### Harvester Harassment

Target enemy harvesters to cripple their economy.

**Best units:** Rangers (fast), Harriers (fly over defenses)

**Counter:** Escort your harvesters, build defenses near ore

---

## Macro Tactics

### Multiple Refineries

More refineries = faster unloading = better economy.

**Goal:** 1 refinery per 2 harvesters

---

### Expansion

Build a second base with MCV to:
- Access new ore fields
- Spread out production (harder to kill)
- Control more map area

---

### Production Tabs

Use multiple production buildings for faster army building:
- 2 Barracks = 2x infantry production
- 2 War Factories = 2x vehicle production

---

## Combat Tactics

### Artillery Positioning

Artillery dies fast but hits hard from range.

1. Keep artillery behind your tank line
2. Target enemy defenses and buildings
3. Protect from flanking attacks
4. Retreat if rushed

---

### Air Strikes

Harriers excel at surgical strikes.

**Best targets:**
- Harvesters (high value, low HP)
- Power Plants (cripples enemy production)
- Artillery (squishy, dangerous)
- Construction Yard (game-ending)

**Avoid:** SAM-heavy bases

---

### Defense Placement

**Layered defense:**
1. Pillboxes at perimeter (cheap, fast)
2. Gun Turrets behind (higher damage)
3. SAM Sites for air coverage
4. Obelisk as final deterrent

**Choke points:** Place defenses where enemy must path through

---

### Demo Truck Usage

Demo Trucks are high-risk, high-reward.

**Do:**
- Target clustered enemies
- Hit buildings (1.5x damage)
- Chain multiple trucks for devastation

**Don't:**
- Drive near your own units
- Use against spread formations
- Forget they explode when killed

---

## Economy Tactics

### Induction Rig Timing

**When to build:**
- After 2-3 harvesters
- When you control an ore well
- Late game for infinite income

**Placement:**
- Defend it—400 HP makes it fragile
- Multiple rigs for unstoppable economy

---

### Credit Float

Don't hoard credits. Floating 5000+ means wasted production.

**If credits pile up:**
- Build more unit-producing buildings
- Queue units in advance
- Expand with MCV

---

## Mind Games

### Feints

Attack one location to draw defenders, then strike elsewhere.

### Scout Denial

Kill enemy scouts to hide your strategy.

### Timing Attacks

Strike when:
- Enemy just lost units
- Their production is in cooldown
- They're expanding (resources spent on buildings)
```

**Step 4: Commit**

```bash
git add docs/site/strategy/
git commit -m "$(cat <<'EOF'
docs(strategy): add build orders, counters, and advanced tactics

- Build orders: economic, rush, tech, air openers
- Unit counters: full matrix with damage modifiers
- Advanced tactics: micro, macro, combat, economy tips

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Update Deployment Pipeline

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Step 1: Read current workflow**

(Already read above)

**Step 2: Update workflow for combined build**

Replace `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

      - name: Build game
        run: npm run build -- --base=/${{ github.event.repository.name }}/game/

      - name: Build docs
        run: npm run docs:build

      - name: Combine builds
        run: |
          # Move game build into docs output as /game/ subfolder
          mkdir -p docs/site/.vitepress/dist/game
          cp -r dist/* docs/site/.vitepress/dist/game/

      - name: Setup Pages
        uses: actions/configure-pages@v4

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./docs/site/.vitepress/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

**Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "$(cat <<'EOF'
ci: update deploy workflow for combined game + docs build

- Build game to /game/ subfolder
- Build VitePress docs
- Combine into single deployment artifact

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Add Pause Game Mode

**Files:**
- Modify: `src/engine/types.ts`

**Step 1: Add 'paused' to GameMode**

In `src/engine/types.ts`, find line 238:

```typescript
export type GameMode = 'menu' | 'game' | 'demo';
```

Replace with:

```typescript
export type GameMode = 'menu' | 'game' | 'demo' | 'paused';
```

**Step 2: Commit**

```bash
git add src/engine/types.ts
git commit -m "$(cat <<'EOF'
feat(engine): add 'paused' game mode type

Preparation for in-game pause menu.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Implement Pause Menu UI

**Files:**
- Create: `src/ui/pause-menu.ts`
- Modify: `src/game.ts`
- Modify: `src/input/index.ts`

**Step 1: Create pause menu module**

Create `src/ui/pause-menu.ts`:

```typescript
import { GameState } from '../engine/types.js';

let pauseOverlay: HTMLDivElement | null = null;
let helpPanel: HTMLDivElement | null = null;
let currentTab: 'controls' | 'shortcuts' | 'tips' = 'controls';

const HELP_CONTENT = {
  controls: `
    <h3>Mouse Controls</h3>
    <table>
      <tr><td>Left-click</td><td>Select unit/building</td></tr>
      <tr><td>Left-drag</td><td>Box select units</td></tr>
      <tr><td>Right-click</td><td>Move / Attack / Harvest</td></tr>
      <tr><td>Middle-drag</td><td>Pan camera</td></tr>
      <tr><td>Scroll wheel</td><td>Zoom in/out</td></tr>
    </table>
  `,
  shortcuts: `
    <h3>Keyboard Shortcuts</h3>
    <table>
      <tr><td>Arrow keys</td><td>Pan camera</td></tr>
      <tr><td>1-5</td><td>Game speed</td></tr>
      <tr><td>A</td><td>Attack-move mode</td></tr>
      <tr><td>F / G / H</td><td>Stance: Aggressive / Defensive / Hold</td></tr>
      <tr><td>B</td><td>Bird's eye view</td></tr>
      <tr><td>Enter</td><td>Deploy MCV</td></tr>
      <tr><td>Escape</td><td>Cancel / Deselect</td></tr>
      <tr><td>Space / P</td><td>Pause game</td></tr>
    </table>
  `,
  tips: `
    <h3>Quick Tips</h3>
    <ul>
      <li>Build Power Plants to keep production running</li>
      <li>Harvesters are high-value targets—protect them!</li>
      <li>Double-click a Barracks/Factory to set it as primary</li>
      <li>Right-click a production building to set rally point</li>
      <li>Engineers can capture enemy buildings</li>
      <li>SAM Sites intercept incoming missiles and artillery</li>
      <li>Deploy Induction Rigs on ore wells for infinite income</li>
    </ul>
  `
};

export function initPauseMenu(
  onResume: () => void,
  onQuit: () => void
): void {
  // Create overlay
  pauseOverlay = document.createElement('div');
  pauseOverlay.id = 'pause-overlay';
  pauseOverlay.innerHTML = `
    <div class="pause-modal">
      <h2>GAME PAUSED</h2>
      <div class="pause-buttons">
        <button id="pause-resume">Resume</button>
        <button id="pause-help">Help</button>
        <button id="pause-quit">Quit</button>
      </div>
    </div>
  `;
  pauseOverlay.style.display = 'none';
  document.body.appendChild(pauseOverlay);

  // Create help panel
  helpPanel = document.createElement('div');
  helpPanel.id = 'help-panel';
  helpPanel.innerHTML = `
    <div class="help-modal">
      <div class="help-tabs">
        <button class="help-tab active" data-tab="controls">Controls</button>
        <button class="help-tab" data-tab="shortcuts">Shortcuts</button>
        <button class="help-tab" data-tab="tips">Tips</button>
      </div>
      <div class="help-content">${HELP_CONTENT.controls}</div>
      <button class="help-back">Back</button>
    </div>
  `;
  helpPanel.style.display = 'none';
  document.body.appendChild(helpPanel);

  // Event listeners
  document.getElementById('pause-resume')?.addEventListener('click', onResume);
  document.getElementById('pause-quit')?.addEventListener('click', onQuit);
  document.getElementById('pause-help')?.addEventListener('click', () => {
    if (pauseOverlay) pauseOverlay.style.display = 'none';
    if (helpPanel) helpPanel.style.display = 'flex';
  });

  helpPanel.querySelector('.help-back')?.addEventListener('click', () => {
    if (helpPanel) helpPanel.style.display = 'none';
    if (pauseOverlay) pauseOverlay.style.display = 'flex';
  });

  helpPanel.querySelectorAll('.help-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const tabName = target.dataset.tab as 'controls' | 'shortcuts' | 'tips';
      currentTab = tabName;

      // Update active tab
      helpPanel?.querySelectorAll('.help-tab').forEach(t => t.classList.remove('active'));
      target.classList.add('active');

      // Update content
      const content = helpPanel?.querySelector('.help-content');
      if (content) content.innerHTML = HELP_CONTENT[tabName];
    });
  });
}

export function showPauseMenu(): void {
  if (pauseOverlay) pauseOverlay.style.display = 'flex';
  if (helpPanel) helpPanel.style.display = 'none';
}

export function hidePauseMenu(): void {
  if (pauseOverlay) pauseOverlay.style.display = 'none';
  if (helpPanel) helpPanel.style.display = 'none';
}

export function isPauseMenuVisible(): boolean {
  return pauseOverlay?.style.display === 'flex' || helpPanel?.style.display === 'flex';
}
```

**Step 2: Add pause menu styles**

Add to `src/styles.css`:

```css
/* Pause Menu */
#pause-overlay, #help-panel {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.pause-modal, .help-modal {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
  border: 2px solid #4a90d9;
  border-radius: 8px;
  padding: 30px 50px;
  text-align: center;
  box-shadow: 0 0 30px rgba(74, 144, 217, 0.3);
}

.pause-modal h2 {
  color: #4a90d9;
  font-size: 32px;
  margin: 0 0 30px 0;
  text-shadow: 0 0 10px rgba(74, 144, 217, 0.5);
}

.pause-buttons {
  display: flex;
  gap: 15px;
  justify-content: center;
}

.pause-buttons button, .help-back {
  background: linear-gradient(180deg, #3a7bd5 0%, #2a5aa0 100%);
  border: 1px solid #4a90d9;
  color: white;
  padding: 12px 30px;
  font-size: 16px;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
}

.pause-buttons button:hover, .help-back:hover {
  background: linear-gradient(180deg, #4a90d9 0%, #3a7bd5 100%);
  transform: scale(1.05);
}

.help-modal {
  min-width: 400px;
  max-width: 500px;
}

.help-tabs {
  display: flex;
  gap: 5px;
  margin-bottom: 20px;
  justify-content: center;
}

.help-tab {
  background: #2a2a4a;
  border: 1px solid #4a4a6a;
  color: #aaa;
  padding: 8px 20px;
  cursor: pointer;
  border-radius: 4px 4px 0 0;
  transition: all 0.2s;
}

.help-tab.active {
  background: #3a7bd5;
  border-color: #4a90d9;
  color: white;
}

.help-content {
  background: #0a0a1a;
  border: 1px solid #3a3a5a;
  border-radius: 4px;
  padding: 20px;
  text-align: left;
  margin-bottom: 20px;
  max-height: 300px;
  overflow-y: auto;
}

.help-content h3 {
  color: #4a90d9;
  margin: 0 0 15px 0;
  font-size: 18px;
}

.help-content table {
  width: 100%;
  border-collapse: collapse;
}

.help-content td {
  padding: 8px 10px;
  border-bottom: 1px solid #2a2a4a;
}

.help-content td:first-child {
  color: #4a90d9;
  font-weight: bold;
  width: 40%;
}

.help-content ul {
  margin: 0;
  padding-left: 20px;
}

.help-content li {
  margin-bottom: 10px;
  line-height: 1.4;
}

.help-back {
  margin-top: 10px;
}
```

**Step 3: Update input handler for pause key**

In `src/input/index.ts`, add to the keydown listener around line 141 (after the existing key handlers):

```typescript
// Pause game
if (e.key === ' ' || e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    onTogglePause?.();
}
```

Add the callback variable near line 64:

```typescript
let onTogglePause: (() => void) | null = null;
```

Update initInput function signature and assignment:

```typescript
export function initInput(
    gameCanvas: HTMLCanvasElement,
    callbacks: {
        // ... existing callbacks ...
        onTogglePause?: () => void;
    }
) {
    // ... existing assignments ...
    onTogglePause = callbacks.onTogglePause || null;
```

**Step 4: Update game.ts to handle pause**

In `src/game.ts`, add imports at top:

```typescript
import { initPauseMenu, showPauseMenu, hidePauseMenu } from './ui/pause-menu.js';
```

Add a variable to track previous mode before pausing (near line 33):

```typescript
let prePauseMode: 'game' | 'demo' | null = null;
```

In `startGameWithConfig`, add pause menu initialization (after initCommandBar around line 580):

```typescript
// Initialize pause menu
initPauseMenu(
    () => {
        // Resume
        if (prePauseMode) {
            currentState = { ...currentState, mode: prePauseMode };
            prePauseMode = null;
        }
        hidePauseMenu();
    },
    () => {
        // Quit - reload page
        location.reload();
    }
);
```

Update initInput callbacks to include onTogglePause:

```typescript
onTogglePause: () => {
    if (currentState.mode === 'paused') {
        // Resume
        if (prePauseMode) {
            currentState = { ...currentState, mode: prePauseMode };
            prePauseMode = null;
        }
        hidePauseMenu();
    } else if (currentState.mode === 'game' || currentState.mode === 'demo') {
        // Pause
        prePauseMode = currentState.mode;
        currentState = { ...currentState, mode: 'paused' };
        showPauseMenu();
    }
},
```

In gameLoop, add pause check (around line 1076, after the running check):

```typescript
if (currentState.mode === 'paused') {
    // Still render but don't update
    const input = getInputState();
    renderer.render(currentState, getDragSelection(), { x: input.mouse.x, y: input.mouse.y }, humanPlayerId, getMiddleMouseScrollOrigin());
    animationFrameId = requestAnimationFrame(gameLoop);
    return;
}
```

**Step 5: Commit**

```bash
git add src/ui/pause-menu.ts src/styles.css src/input/index.ts src/game.ts
git commit -m "$(cat <<'EOF'
feat(ui): add pause menu with help tabs

- Press Space or P to pause game
- Shows Resume, Help, Quit buttons
- Help panel has Controls, Shortcuts, Tips tabs
- ESC or Resume to continue playing

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Test and Polish

**Step 1: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Test docs locally**

Run: `npm run docs:dev`
Expected: VitePress serves at localhost, all pages render correctly

**Step 3: Test game with pause**

Run: `npm run dev`
Expected:
- Game starts normally
- Pressing Space/P pauses the game and shows menu
- Help tabs switch content
- Resume returns to game
- Quit reloads page

**Step 4: Final commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
chore: final polish for player documentation

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)" --allow-empty
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | VitePress setup with landing page |
| 2 | Getting Started guide |
| 3 | Controls & Shortcuts guide |
| 4 | Economy guide |
| 5 | Production & Combat guides |
| 6 | Infantry encyclopedia |
| 7 | Vehicles encyclopedia |
| 8 | Aircraft encyclopedia |
| 9 | Buildings encyclopedia |
| 10 | Strategy section (build orders, counters, tactics) |
| 11 | Update deployment pipeline |
| 12 | Add 'paused' game mode type |
| 13 | Implement pause menu UI |
| 14 | Test and polish |

**Total commits:** ~14 focused commits
**Estimated new files:** ~18
**Estimated modified files:** ~6

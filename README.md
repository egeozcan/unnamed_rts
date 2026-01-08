# Unnamed RTS

A browser-based real-time strategy game inspired by Command & Conquer. Built with pure TypeScript and Canvas 2D rendering - no game frameworks required.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.2-blue.svg)](https://www.typescriptlang.org/)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
[![Vite](https://img.shields.io/badge/Vite-5.0-646CFF.svg)](https://vitejs.dev/)

## Features

- **Multiplayer Support**: Up to 8 players (human + AI) in a single match
- **Diverse Units**: 22 unit types across infantry, vehicles, and aircraft
- **Base Building**: 12 building types including production, defense, and support structures
- **AI Opponents**: Three difficulty levels (Easy, Medium, Hard) with distinct strategies
- **Multiple Map Sizes**: Small (2000x2000) to Huge (5000x5000) with configurable resource and rock density
- **Full Tech Tree**: Prerequisites system requiring specific buildings before advanced units
- **Game Modes**:
  - **Skirmish**: Play against AI opponents
  - **Demo/Observer**: Watch AI players battle each other

## Quick Start

```bash
# Clone the repository
git clone https://github.com/egeozcan/unnamed_rts.git
cd unnamed_rts

# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser to play.

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with hot reload |
| `npm run build` | Type check and create production build |
| `npm run preview` | Preview the production build locally |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Generate test coverage report to `./coverage/` |
| `npm run manipulate-state` | CLI tool for game state manipulation |

Run a single test file:
```bash
npx vitest run tests/engine/harvester.test.ts
```

## How to Play

### Starting a Game

1. Launch the game and you'll see the Skirmish Setup menu
2. Configure your match:
   - **Players**: Add up to 8 players (human or AI with difficulty level)
   - **Map Size**: Choose from Small, Medium, Large, or Huge
   - **Resource Density**: Low, Medium, or High ore spawns
   - **Rock Density**: Few, Normal, or Many obstacles
3. Click **Start Game** to begin

### Controls

| Input | Action |
|-------|--------|
| **Left Click** | Select unit/building |
| **Left Click + Drag** | Box select multiple units |
| **Right Click** | Move selected units / Attack target |
| **Shift + Click** | Add to selection |
| **Ctrl + Number** | Assign control group |
| **Number Key** | Select control group |
| **Escape** | Deselect all |

### Gameplay Basics

1. **Economy**: Build a Refinery to process ore. Harvesters automatically gather resources from ore fields and ore wells.

2. **Power**: Construct Power Plants to generate electricity. Many buildings require power to function.

3. **Production**:
   - Barracks produces infantry units
   - War Factory produces vehicles
   - Air-Force Command produces aircraft

4. **Tech Tree**: Advanced units require prerequisite buildings. For example, the Tech Center unlocks elite units.

5. **Combat**: Select units and right-click on enemies to attack. Units automatically engage nearby threats.

## Game Content

### Buildings

| Building | HP | Cost | Description |
|----------|---:|-----:|-------------|
| Construction Yard | 3000 | 3000 | Starting building, constructs other structures |
| Power Plant | 800 | 300 | Generates power for your base |
| Refinery | 1200 | 2000 | Processes ore, comes with a Harvester |
| Barracks | 1000 | 500 | Trains infantry units |
| War Factory | 2000 | 2000 | Produces vehicles |
| Tech Center | 1000 | 1500 | Unlocks advanced units and buildings |
| Air-Force Command | 1500 | 2000 | Produces and reloads aircraft (6 landing slots) |
| Service Depot | 1500 | 1500 | Repairs nearby vehicles |
| Gun Turret | 1000 | 800 | Anti-ground defense (250 range) |
| SAM Site | 800 | 1200 | Anti-air defense (400 range) |
| Pillbox | 600 | 400 | Basic defense structure |
| Obelisk | 1500 | 2800 | Powerful laser defense (350 range, 200 damage) |

### Infantry Units

| Unit | HP | Cost | Speed | Description |
|------|---:|-----:|------:|-------------|
| Rifleman | 60 | 100 | 1.2 | Basic soldier |
| Rocket Soldier | 70 | 300 | 1.0 | Anti-vehicle infantry |
| Engineer | 50 | 500 | 1.2 | Captures/repairs buildings |
| Medic | 45 | 350 | 1.3 | Heals nearby infantry |
| Sniper | 45 | 800 | 1.1 | Long-range, high damage |
| Flamethrower | 80 | 400 | 1.0 | Area damage specialist |
| Grenadier | 65 | 250 | 1.1 | Splash damage attacks |
| Commando | 120 | 1500 | 1.4 | Elite armor-piercing soldier |

### Vehicles

| Unit | HP | Cost | Speed | Description |
|------|---:|-----:|------:|-------------|
| Harvester | 1000 | 1400 | 1.5 | Gathers resources (500 cargo) |
| Ranger | 180 | 500 | 4.5 | Fast scout vehicle |
| APC | 300 | 700 | 3.0 | Armored personnel carrier |
| Light Tank | 400 | 800 | 2.5 | Medium armor |
| Heavy Tank | 700 | 1600 | 2.0 | Heavy armor, high damage |
| Flame Tank | 450 | 1100 | 2.2 | Area damage vehicle |
| Stealth Tank | 350 | 1400 | 3.0 | Missile-equipped |
| Artillery | 200 | 1200 | 1.5 | Long range (550), splash damage |
| MLRS | 250 | 1800 | 1.8 | Rocket artillery |
| Mammoth Tank | 1200 | 2500 | 1.5 | Superheavy assault vehicle |
| MCV | 2000 | 3000 | 1.0 | Deploys into Construction Yard |

### Aircraft

| Unit | HP | Cost | Speed | Description |
|------|---:|-----:|------:|-------------|
| Helicopter | 250 | 1500 | 6.0 | Rocket-armed gunship |
| Harrier | 200 | 1200 | 8.0 | Fast strike aircraft (docks to reload) |

## Technical Architecture

### State Management

The game uses a Redux-inspired unidirectional data flow with immutable state:

```
User Input → Action → Reducer → GameState → Renderer
```

All state updates go through the central reducer (`src/engine/reducer.ts`), ensuring predictable state transitions and easy debugging.

### Core Systems

- **Rendering**: Pure Canvas 2D API - no frameworks
- **Pathfinding**: A* algorithm with collision avoidance
- **Spatial Queries**: SpatialGrid for O(1) neighbor lookups
- **Entity System**: Component-based architecture (Movement, Combat, Harvester, AirUnit components)
- **AI**: Modular system with threat detection, economic decisions, and combat coordination
- **Performance**: EntityCache for per-tick categorization, power calculation caching

### Technology Stack

- **Language**: TypeScript 5.2+ (strict mode)
- **Build Tool**: Vite 5.0
- **Testing**: Vitest with V8 coverage
- **Validation**: Zod for runtime schema validation
- **Target**: ES2020, runs in modern browsers

## Project Structure

```
src/
├── engine/
│   ├── reducer.ts          # Main action dispatcher
│   ├── types.ts            # Core TypeScript interfaces
│   ├── reducers/           # Modular reducer files
│   │   ├── game_loop.ts    # Tick orchestrator
│   │   ├── movement.ts     # Pathfinding, collision
│   │   ├── combat.ts       # Targeting, attacks
│   │   ├── harvester.ts    # Resource gathering
│   │   └── ...
│   ├── ai/                 # AI system
│   │   ├── index.ts        # AI dispatcher
│   │   ├── planning.ts     # Threat detection
│   │   ├── action_economy.ts
│   │   └── action_combat.ts
│   ├── spatial.ts          # Spatial hash grid
│   ├── perf.ts             # Performance utilities
│   └── utils.ts            # Pathfinding, helpers
├── renderer/
│   ├── index.ts            # Canvas rendering
│   └── assets_data/        # Asset definitions
├── ui/
│   ├── index.ts            # Production UI
│   ├── minimap.ts          # Minimap
│   └── birdsEyeView.ts     # Overview mode
├── data/
│   ├── rules.json          # Game balance data
│   └── ai.json             # AI personalities
└── input/                  # Input handling

tests/                      # ~67 test files mirroring src/
```

## Deployment

The game builds to static files and can be hosted on any static hosting service.

### Build for Production

```bash
npm run build
```

This outputs optimized files to the `dist/` directory.

### Hosting Options

**GitHub Pages:**
```bash
# Build and deploy to gh-pages branch
npm run build
# Copy dist/ contents to gh-pages branch
```

**Vercel:**
- Connect your GitHub repository
- Build command: `npm run build`
- Output directory: `dist`

**Netlify:**
- Connect your GitHub repository
- Build command: `npm run build`
- Publish directory: `dist`

**Manual Hosting:**
Simply upload the contents of `dist/` to any static file server (nginx, Apache, S3, etc.).

## Testing

The project uses Vitest for testing with comprehensive coverage:

```bash
# Run all tests
npm test

# Watch mode for development
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Test Structure

- **67 test files** mirroring the `src/` directory structure
- Tests cover: state immutability, AI behavior, pathfinding, combat, harvesting, production
- Test utilities in `src/engine/test-utils.ts` provide builder helpers

### Game State CLI

A utility script for debugging and testing game states:

```bash
npm run manipulate-state -- --help
```

Features:
- Remove players, units, or buildings
- List units by distance
- Advance game simulation

## Configuration

### Game Balance

Edit `src/data/rules.json` to modify:
- Unit and building stats (HP, cost, speed, damage)
- Weapon damage modifiers against armor types
- Production times and prerequisites
- Resource values

### AI Behavior

Edit `src/data/ai.json` to adjust AI personalities and decision weights.

### Build Settings

- `vite.config.ts` - Vite and Vitest configuration
- `tsconfig.json` - TypeScript compiler options

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes
4. Run tests: `npm test`
5. Commit with a descriptive message
6. Push to your fork and open a Pull Request

### Code Style

- TypeScript strict mode is enforced
- Use type guards for entity narrowing
- Maintain immutable state patterns
- Add tests for new functionality

## License

This project is licensed under the GNU General Public License v3.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

Inspired by classic RTS games, particularly the Command & Conquer series.

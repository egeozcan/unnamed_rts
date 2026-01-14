# Game Ideas and Feature Backlog

## 1. APC Infantry Transport

**Idea**: APC needs to be able to take in infantry.

**Implementation Direction**:
- Add a `TransportComponent` to entities with fields: `capacity: number`, `passengers: EntityId[]`, `loadCooldown: number`
- New actions: `LOAD_UNIT` (infantry enters APC), `UNLOAD_UNIT` (infantry exits), `UNLOAD_ALL`
- Infantry near an APC can be ordered inside via right-click on the APC (or APC right-clicks infantry)
- Passengers are removed from `state.entities` while inside (or marked as `transported: true`)
- When APC dies, passengers either die with it or are ejected with damage
- UI: Show passenger count on APC selection panel

**Hardness**: 4/10 - Straightforward state management, similar patterns exist for harvesters docking

**Complexity**: 5/10 - New component, several new actions, UI updates, death handling edge cases

**Antigravity's Note**:
- **Extension (Bunkers)**: This logic can be reused for defensive structures (Bunkers). Bunkers are essentially stationary APCs with higher HP and defense.
- **Ejection Logic**: If APC is destroyed, passengers should take 50% damage and be ejected. If they would die, play a specific "crushed" animation.


---

## 2. Fog of War

**Idea**: Fog of war with AI awareness and revealed/explored states.

**Implementation Direction**:
- Add `visibility: Uint8Array` per player in `PlayerState` - a grid where each cell is: 0=unexplored, 1=explored (seen before), 2=visible (currently seen)
- Each unit/building has a `sightRange` (already in rules.json as `vision`)
- In `game_loop.ts`, recalculate visibility each tick by iterating owned entities and marking cells within sight range
- Renderer only draws entities the current player can see (visibility === 2) or shows "ghost" sprites for explored but not visible areas
- AI already operates on full state - add option to make AI "honest" by filtering `state.entities` to only visible ones
- Explored areas show terrain/resources but not enemy units

**Hardness**: 6/10 - Performance-sensitive (visibility recalc every tick), renderer integration, AI filtering adds complexity

**Complexity**: 7/10 - Touches many systems: game loop, renderer, AI, entity queries, minimap

**Antigravity's Note (Shroud vs Fog)**:
- Distinguish between **Shroud** (never visited, completely black) and **Fog** (visited but not currently visible, terrain visible but units hidden).
- **Implementation hint**: Use a bitmask per cell: `0=Shroud, 1=Fog, 2=Visible`.
- **Performance**: Use specific "Dirty Rectangles" when updating visibility to avoid iterating the whole grid every tick.


---

## 3. Stealth Tank Mechanics

**Idea**: Stealth tank actually being hidden unless moving (or just remove it).

**Implementation Direction (if keeping)**:
- Add `StealthComponent`: `{ isStealthed: boolean, stealthCooldown: number }`
- Rules: Stealth activates after N ticks of not moving, breaks when moving or firing
- Visibility integration: Stealthed units only visible to enemies within a very short "detection range" or when adjacent
- Renderer: Draw stealthed units as semi-transparent for owner, invisible for enemies (unless detected)
- Consider: Detector units (e.g., radar vehicle) that reveal stealth in an area

**Alternative (removal)**:
- Simply remove from `rules.json` and asset definitions
- Clean up any references

**Hardness**: 5/10 - Requires integration with visibility system (depends on fog of war being implemented first)

**Complexity**: 4/10 - Small component, few state changes, but couples with fog of war

**Antigravity's Note**:
- **Balance**: "Permanent Cloak" (like StarCraft Dark Templar) vs "Active Cloak" (like CnC Stealth Tank).
- **Suggestion**: Use Active Cloak. Decloaks when firing. Re-cloaks after 3 seconds of holding fire.
- **Counter-play**: "Sonar Pulse" ability on Comm Center to reveal area for 10s.


---

## 4. Artillery vs MLRS Differentiation

**Idea**: Create meaningful distinction between Artillery and MLRS, or merge them.

**Implementation Direction (differentiation)**:
- **Artillery**: High damage, single target, long reload, very long range, bonus vs buildings, slow projectile with visible arc
- **MLRS**: Lower per-rocket damage, fires salvo of 4-6 rockets in spread pattern, faster reload, shorter range, area denial, effective vs grouped units
- Add `SalvoComponent` for MLRS: `{ rocketsRemaining: number, salvoInterval: number }`
- Visual: Artillery has lobbed shell, MLRS has multiple rocket trails

**Alternative (merge)**:
- Remove MLRS, keep Artillery as the single indirect-fire unit
- Simpler to balance

**Hardness**: 3/10 - Mostly data tuning in rules.json, salvo is straightforward state machine

**Complexity**: 4/10 - New component for salvo, visual updates for projectiles

**Antigravity's Note**:
- **Role Distinction**:
    - **Artillery**: Siege unit. Outranges defense towers. Use to crack base defenses. Low rate of fire.
    - **MLRS**: Area Denial / Anti-blob. Shorter range than Arty but devastating vs infantry/light vehicle groups.


---

## 5. Flame Tank Mechanics

**Idea**: Flame tank spraying fire with friendly damage potential. Very effective vs infantry, ineffective vs vehicles.

**Implementation Direction**:
- Add `FlameComponent`: `{ flameActive: boolean, flameDuration: number }`
- Attack creates a "flame zone" (temporary area effect) rather than direct damage
- Flame zones persist for N ticks, damaging all ground units inside (friend or foe)
- Damage modifiers in rules.json: high vs INFANTRY armor, very low vs HEAVY/MEDIUM armor
- Visual: Particle system or animated sprites for flame stream and ground fire
- Consider: Buildings can catch fire (DoT effect)

**Hardness**: 5/10 - Area effects are new pattern, need entity for flame zones or integrate into spatial system

**Complexity**: 6/10 - New damage pattern, temporary zone entities, friendly fire logic, visual effects

**Antigravity's Note**:
- **Terrain Scarring**: Creating "Persistent Fire" entities is great. Ensure they don't block movement, just damage.
- **Panic Mechanic**: Infantry hit by fire could "panic" (loss of control, run in random direction) for 2s.


---

## 6. Demolition Truck

**Idea**: Add a suicide bomber vehicle.

**Implementation Direction**:
- New unit in rules.json: slow, low HP, no regular attack, cheap-ish
- Add `DemolitionComponent`: `{ armed: boolean, blastRadius: number, blastDamage: number }`
- When ordered to attack (or right-click enemy), moves to target then detonates on arrival or when killed
- Explosion damages all entities in radius (including friendlies, buildings, resources)
- Visual: Large explosion effect, screen shake
- AI consideration: Rarely used, high-value target priority

**Hardness**: 3/10 - Simple state machine: move → detonate

**Complexity**: 4/10 - New unit type, area damage on death, pathfinding to target

**Antigravity's Note**:
- **Dead Man's Switch**: It *must* explode on death, not just on attack. This allows counter-play: kill it away from your base.
- **Chain Reaction**: If a Demo Truck explosion kills another Demo Truck, the second one should explode immediately.


---

## 7. Maps

**Idea**: Premade maps (with editor?) or more variety in generator.

### 7a. Premade Maps

**Implementation Direction**:
- Define map format: JSON with terrain grid, resource placements, starting positions, decorations
- Map selector in menu UI
- Load map data instead of generating in `createInitialState`
- Optional: Simple in-game editor (place terrain, resources, start positions, export JSON)

**Hardness**: 4/10 - Straightforward data format and loading

**Complexity**: 5/10 - Editor would add significant UI work

### 7b. Generator Variety

**Implementation Direction**:
- Add map "themes": desert (more open), forest (scattered rocks), island (water barriers), mountain (narrow paths)
- Parameterize generator: resource density, rock frequency, symmetry mode
- Add new terrain types: water (impassable), cliffs, different ore types
- Biome-based visual variation

**Hardness**: 5/10 - Generator already exists, extending it is moderate

**Complexity**: 6/10 - New terrain types ripple through pathfinding, renderer, placement logic

**Antigravity's Note (Symmetry)**:
- For procedural maps, enforce rotational or mirror symmetry for fairness.
- **Algo**: Generate one quadrant/half, then mirror it. Add small random "noise" afterwards if perfect symmetry feels too artificial.


---

## 8. Better Graphics

**Idea**: Visual improvements.

**Implementation Direction (incremental)**:
1. **Unit shadows**: Simple oval shadows under units (easy, high impact)
2. **Death animations**: Explosions, infantry ragdoll, vehicle wrecks that fade (medium)
3. **Projectile variety**: Tracers for bullets, arcing shells, missile trails (medium)
4. **Terrain detail**: Texture variation, edge blending between terrain types (medium)
5. **Building construction animation**: Scaffolding → complete (medium)
6. **Particle effects**: Muzzle flashes, dust clouds, smoke from damaged units (harder)
7. **Lighting/time of day**: Tint overlay, unit shadows change direction (harder)

**Hardness**: 3-7/10 depending on feature - Shadows easy, particles harder

**Complexity**: 6/10 cumulative - Many small changes across renderer, each individually small

**Antigravity's Note**:
- **Instancing**: If adding many particles or debris, ensure the `Renderer` supports instanced mesh drawing (if WebGL) or batched canvas calls (if 2D Context) to maintain 60FPS.
- **Lighting**: Simple "vignette" overlay and "color grading" (sepia/blue tint) is a very cheap way to add mood without complex shaders.


---

## Priority Recommendations

| Feature | Impact | Effort | Suggested Priority |
|---------|--------|--------|-------------------|
| Fog of War | High | High | P1 - Core RTS feature |
| APC Transport | Medium | Medium | P2 - Adds tactical depth |
| Artillery/MLRS | Low | Low | P3 - Balance polish |
| Demolition Truck | Medium | Low | P3 - Fun addition |
| Flame Tank | Medium | Medium | P3 - Interesting mechanics |
| Stealth Tank | Low | Medium | P4 - Needs fog of war first |
| Maps (Premade) | High | Medium | P2 - Content variety |
| Maps (Generator) | Medium | Medium | P3 - Nice to have |
| Graphics | Medium | High | Ongoing - Incremental |

---

# Antigravity's Extensions & Notes

## Notes on Existing Directions

(Moved inline to respective sections above)

---

## 9. Unit Veterancy (Elite Status)

**Idea**: Units gain experience from destroying enemies, unlocking stat boosts and self-healing.

**Implementation Direction**:
- **Data**: Add `veterancy` field to units in `rules.json` defining XP thresholds and stat multipliers.
- **State**: `VeterancyComponent` on units: `{ xp: number, rank: 0|1|3 }`.
- **Logic**: 
  - On `destroyEntity`, award XP to the source of damage (if it's a unit).
  - Check thresholds. Promote: 
    - Rank 1 (Veteran): +10% Damage, +10% Speed.
    - Rank 3 (Elite): +20% HP, Self-heal, Elite weapon (blue laser / rapid fire).
- **Visual**: Small star icon or chevron above unit health bar.

**Hardness**: 4/10 - Math changes in damage calculation.

**Complexity**: 5/10 - Need to track source of damage reliably.

---

## 10. Passive Tech / Upgrades

**Idea**: Researchable upgrades at specific buildings that apply global buffs to unit types.

**Implementation Direction**:
- **New Entity**: `Upgrade` (not placed on map, but exists in player state).
- **UI**: New "Upgrades" tab in sidebar when valid building selected (e.g., Tech Center).
- **Examples**:
  - *Composite Armor*: +10% HP for Tanks.
  - *High-Explosive Shells*: +Damage for Artillery.
  - *Engine Tuning*: +Speed for Light Vehicles.
- **State**: `PlayerState.researchedUpgrades: string[]`.
- **Logic**: Modifiers applied in `stat_calculation.ts` based on player's researched list.

**Hardness**: 3/10

**Complexity**: 4/10 - Easy to implement if stats are centralized.

---

## 11. Capturable Neutral Tech Properties

**Idea**: Map structures that provide unique bonuses when captured by an Engineer.

**Implementation Direction**:
- **Entities**: Oil Derrick (Credits), Hospital (Heal Infantry), Airstrip (Paratrooper ability).
- **Mechanic**: 
  - Neutral by default.
  - Engineer `CAPTURE` action converts ownership to player.
  - If destroyed, they are gone forever (or leave rubble).
- **Logic**:
  - `Tick` updates: If owner != Neutral, apply effect (e.g., `player.credits += 10`).

**Hardness**: 5/10

**Complexity**: 6/10 - Specific logic per building type.

---

## 12. Dynamic Soundtrack / Audio System

**Idea**: Music that evolves based on game intensity.

**Implementation Direction**:
- **States**: `Peace` (No enemies near), `Tension` (Enemies seen), `Combat` (Firing/Taking damage).
- **Audio Manager**: Cross-fade between tracks or add layers (percussion, heavy guitar) based on state.
- **Logic**:
  - Simple "Threat meter" calculated each slow-tick (sum of enemy unit cost in vision).
  - If threat > threshold -> Switch to Combat track.

**Hardness**: 4/10

**Complexity**: 3/10 - Mostly distinct from game simulation logic.

---

# Claude's Extensions & Notes

## Thoughts on Existing Ideas

### On Fog of War (Section 2)
- **Shared Vision**: Consider implementing team-based shared vision from the start. When fog of war is added, it becomes much harder to retrofit team vision.
- **Reveal-on-Death**: When a unit dies, briefly reveal its last known position to allies (like a final radio transmission). Adds tactical information flow.
- **Scan Ability**: If adding fog of war, the Comm Center should have a "Radar Sweep" ability that momentarily reveals a large area on a cooldown (60s).

### On Stealth (Section 3)
- **Shimmer Effect**: Even when cloaked, fast-moving stealth tanks could have a subtle "predator-style" shimmer, rewarding observant players.
- **Detection Tiers**: Instead of binary detected/hidden, consider: (1) Hidden, (2) Partial Detection (blip on minimap), (3) Fully Revealed.

### On Transport (Section 1)
- **Paradrop**: If you implement Harriers/Air units already, an "Orca Transport" could paradrop infantry anywhere on the map, opening up air-assault tactics.
- **Water Transport**: If water terrain is added, include a hovercraft/landing craft for amphibious operations.

---

## 13. Queued Waypoints & Patrol Routes

**Idea**: Allow players to queue multiple movement waypoints (shift-click) and define patrol routes.

**Implementation Direction**:
- **State**: `Unit.waypoints: Vector[]` - a queue of positions
- **Logic**:
  - When current `moveTarget` is reached, pop next waypoint and set as new target
  - Patrol mode: when queue is exhausted, reverse or loop back to first waypoint
- **Actions**: 
  - `ADD_WAYPOINT` (shift+right-click) - append to waypoint queue
  - `SET_PATROL` - mark route as looping
- **UI**: Draw lines connecting waypoints when unit is selected

**Hardness**: 3/10 - Simple queue management

**Complexity**: 4/10 - UI for visualizing waypoints, modifier key detection

---

## 14. Control Groups & Hotkeys

**Idea**: Assign units to numbered control groups (Ctrl+1-9) for quick selection.

**Implementation Direction**:
- **State**: `GameState.controlGroups: Map<number, EntityId[]>` (client-side only)
- **Logic**:
  - Ctrl+[1-9]: Assign current selection to group
  - [1-9]: Select group
  - Double-tap [1-9]: Center camera on group
- **Persistence**: Groups should update if units die (remove from group)
- **UI**: Optional indicator showing which group a unit belongs to

**Hardness**: 2/10 - Pure client-side feature

**Complexity**: 3/10 - Just selection state management

**Note**: This is a quality-of-life feature that significantly improves gameplay feel. Essential for competitive play.

---

## 15. Attack-Move Command

**Idea**: Units move to destination but engage any enemies encountered along the way.

**Implementation Direction**:
- **State**: Add `attackMoveTarget: Vector | null` to units
- **Logic**:
  - While moving to `attackMoveTarget`, scan for enemies within weapon range
  - If enemy found: stop, engage, then resume moving when enemy destroyed or out of range
  - Arrival at destination clears `attackMoveTarget`
- **Hotkey**: A-click or Ctrl+right-click
- **Priority**: Attack-move targets should be lower priority than explicit attack orders

**Hardness**: 3/10 - Straightforward state machine extension

**Complexity**: 4/10 - Interaction with existing combat and movement logic

**Note**: This is arguably more important than regular move for RTS gameplay. Consider making it the default right-click behavior on enemy territory.

---

## 16. Rally Points for Production Buildings

**Idea**: Set a destination for newly produced units to automatically move to.

**Implementation Direction**:
- **State**: `Building.rallyPoint: Vector | null`
- **Logic**:
  - Right-click while production building selected sets rally point
  - When unit production completes, issue move order to rally point
  - Rally to another unit: Follow that unit (useful for harvesters → refinery)
- **UI**: Draw flag icon at rally point, line from building to rally
- **Advanced**: Rally point on enemy = produced units attack-move there

**Hardness**: 2/10 - Simple feature

**Complexity**: 3/10 - Minor UI addition

**Note**: I noticed the AI already uses a form of internal rally points for group cohesion. This would give players the same capability.

---

## 17. Unit Formations

**Idea**: When moving groups, maintain formation rather than blobbing.

**Implementation Direction**:
- **Formation Types**: Line, Box, Wedge, Column
- **State**: `SelectionFormation` stored client-side
- **Logic**:
  - When move order given to group, calculate offset positions based on formation
  - Assign each unit a specific offset from the group center
  - Units maintain relative positions while moving
- **Smart Positioning**: Tanks in front, artillery in back, automatically

**Hardness**: 5/10 - Coordination between units is tricky

**Complexity**: 6/10 - Formation math, handling obstacles, unit death mid-formation

**Alternative (simpler)**: Just ensure units maintain spacing via separation forces (already implemented!) but bias slow units to back.

---

## 18. Mini-Objectives / Side Missions

**Idea**: Dynamic objectives that appear during matches for bonus rewards.

**Implementation Direction**:
- **Examples**:
  - "Destroy the neutral convoy crossing the map" → Bonus credits
  - "Capture and hold the comm station for 60s" → Map reveal
  - "Escort the supply truck to your base" → Free units
- **State**: `GameState.activeObjectives[]` with timer, completion state
- **Logic**: Objectives spawn based on game time or triggers (e.g., first refinery built)
- **Balance**: Rewards should be significant but not game-breaking

**Hardness**: 6/10 - Needs objective system from scratch

**Complexity**: 7/10 - Scripted events, UI for objectives, balance

**Note**: This could differentiate the game from standard RTS fare. Consider for a campaign mode first.

---

## 19. Spectator/Replay System

**Idea**: Watch replays and spectate live games.

**Implementation Direction**:
- **Replay Recording**:
  - Store initial `GameState` + sequence of all `Action[]` per tick
  - Replay = re-simulate deterministically
  - Export as JSON or binary format
- **Playback**:
  - Replay viewer with pause, speed controls, timeline scrubbing
  - Free camera, no fog of war
- **Live Spectator**:
  - WebSocket stream of actions to spectator clients
  - Configurable delay (30s) for fairness

**Hardness**: 5/10 - Architecture is clean for this (action-based game loop)

**Complexity**: 6/10 - UI for playback, timeline, seeking

**Note**: The deterministic game loop with pure reducers is *perfect* for replays. This is a natural fit for the architecture.

---

## 20. Environmental Hazards & Dynamic Map Events

**Idea**: Maps with interactive/dangerous elements that affect gameplay.

**Implementation Direction**:
- **Hazards**:
  - **Tiberium Fields**: DoT damage to infantry standing on them
  - **Ion Storms**: Periodic map-wide event that damages air units
  - **Sandstorms**: Reduce vision range temporarily
  - **Civilian Traffic**: Neutral vehicles that block paths (collateral damage!)
- **Interactive**:
  - **Bridges**: Can be destroyed, cutting off paths
  - **Oil Barrels**: Explode when shot, area damage
- **State**: Hazards as special entities with `HazardComponent`

**Hardness**: 5/10 - Each hazard is a small isolated system

**Complexity**: 6/10 - Many small features, visual effects needed

---

## 21. Commander Abilities (Global Powers)

**Idea**: Powerful abilities with long cooldowns that affect the whole map.

**Implementation Direction**:
- **Examples**:
  - **Airstrike**: Call in an off-map bomber to strafe a line
  - **Reinforcements**: Paratrooper drop anywhere on map
  - **EMP Burst**: Disable enemy vehicles in an area for 10s
  - **Shield Dome**: Temporary invulnerability for a structure
- **Requirements**: Certain buildings must exist (e.g., Tech Center for EMP)
- **State**: `PlayerState.commanderAbilities: { id: string, cooldownRemaining: number }[]`
- **UI**: Ability bar at top of screen with cooldown indicators

**Hardness**: 5/10 - Each ability is a self-contained effect

**Complexity**: 7/10 - UI work, balance, visual effects for each ability

**Note**: Could be tied into factions - each faction gets unique abilities.

---

## 22. Sound Design Notes

**Idea**: Critical audio feedback for game events.

**Priority Audio Cues**:
1. **Unit acknowledgment**: "Yes sir", "Acknowledged" when ordered (different per unit type)
2. **Combat Start**: Distinctive sound when your units are under attack
3. **Building Complete**: Satisfying ding/announcement
4. **Low Power**: Warning alarm
5. **Unit Lost**: Brief notification sound
6. **Victory/Defeat**: Dramatic musical sting

**Implementation Direction**:
- **Audio Manager**: Central system for playing sounds with priorities
- **Spatial Audio**: Sounds from off-screen enemies are quieter
- **Announcer**: "Unit lost", "Building captured", "Reinforcements have arrived"

**Hardness**: 3/10 - Browser audio APIs are straightforward

**Complexity**: 4/10 - Need audio assets, mixing, preventing sound spam

---

## 23. Performance & Scalability Considerations

**Notes on future-proofing**:

- **Entity Component System**: The current architecture is close to ECS. Consider formalizing this for 1000+ unit battles:
  - Systems iterate over specific component sets
  - Components stored in typed arrays for cache efficiency
  
- **Networking (if multiplayer)**:
  - Current action-based approach is lockstep-ready
  - For peer-to-peer: hash GameState periodically to detect desync
  - For client-server: server is authoritative, clients predict + reconcile

- **Web Workers**: Offload AI computation to a worker thread during player's turn

- **LOD for Rendering**: At max zoom-out, render units as simple colored dots

---

## Updated Priority Recommendations

| Feature | Impact | Effort | Suggested Priority |
|---------|--------|--------|-------------------|
| Control Groups (14) | High | Low | **P1 - QoL essential** |
| Attack-Move (15) | High | Low | **P1 - Core mechanic** |
| Rally Points (16) | Medium | Low | **P1 - Already half-done** |
| Waypoints/Patrol (13) | Medium | Low | P2 - Nice for defenders |
| Commander Abilities (21) | High | Medium | P2 - Exciting feature |
| Replay System (19) | Medium | Medium | P2 - Debug tool too |
| Formations (17) | Medium | High | P3 - Polish |
| Sound Design (22) | High | Medium | P2 - Feel improvement |
| Environmental Hazards (20) | Medium | High | P3 - Content |
| Mini-Objectives (18) | Low | High | P4 - Campaign mode |

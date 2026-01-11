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

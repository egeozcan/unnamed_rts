# Intelligent Harvester AI System Design

## Overview

Complete overhaul of AI harvester behavior to create intelligent, adaptive harvesters that balance protection with productivity. The system scales with AI difficulty level.

**Goals:**
- Situational awareness: Harvesters understand battlefield danger
- Economic pressure adaptation: Risk tolerance adjusts to economic state
- Coordinated behavior: Harvesters work as a fleet, not individuals
- Stuck prevention: Escalating responses prevent harvesters getting stuck

## Architecture

Four interconnected modules:

```
┌─────────────────────────────────────────────────────────────────┐
│                    Harvester AI System                          │
├─────────────────┬─────────────────┬─────────────────┬───────────┤
│   Danger Map    │   Desperation   │   Coordinator   │   Stuck   │
│    System       │   Calculator    │                 │  Resolver │
├─────────────────┼─────────────────┼─────────────────┼───────────┤
│ Zone scores     │ Risk tolerance  │ Role assignment │ Escalating│
│ Attack memory   │ Economic state  │ Ore distribution│ responses │
│ Death memory    │ Game phase      │ Refinery queue  │ Blacklist │
└─────────────────┴─────────────────┴─────────────────┴───────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Escort System  │
                    │ Dynamic guards  │
                    └─────────────────┘
```

## Module 1: Danger Map System

**File:** `src/engine/ai/harvester/danger_map.ts`

Divides the map into zones and tracks danger per zone.

### Configuration

- Zone size: 200x200 pixels (5x5 tiles)
- Update frequency: Every 30 ticks (~0.5 seconds)
- Danger scores decay over time

### Danger Score Calculation

```typescript
baseDanger = enemyUnitsInZone * 10
recentAttacks = attacksInLast300Ticks * 15  // decays linearly
deathMemory = harvesterDeathsInLast1800Ticks * 25  // 30 second memory
dangerScore = clamp(baseDanger + recentAttacks + deathMemory, 0, 100)
```

### Key Functions

```typescript
updateDangerMap(state: GameState, playerId: number): DangerMap
getZoneDanger(dangerMap: DangerMap, x: number, y: number): number
getPathDanger(dangerMap: DangerMap, from: Vector, to: Vector): number
findSafestOrePath(dangerMap: DangerMap, harvester: Entity, oreOptions: Entity[]): Entity | null
```

### Difficulty Scaling

| Difficulty | Behavior |
|------------|----------|
| Easy | No danger map (current behavior) |
| Medium | Only `baseDanger` (sees current enemies, no memory) |
| Hard | Full calculation with attack and death memory |

## Module 2: Desperation Calculator

**File:** `src/engine/ai/harvester/desperation.ts`

Computes a 0-100 desperation score determining risk tolerance.

### Input Factors

| Factor | Weight | Calculation |
|--------|--------|-------------|
| Credits | 35% | 0 at 5000+, 100 at 0, linear scale |
| Income Rate | 25% | Compare income vs. upkeep over last 600 ticks |
| Harvester Ratio | 20% | harvesters / refineries (< 1.5 = desperate) |
| Game Phase | 10% | Early game (< 3 min) adds +20 desperation |
| Relative Economy | 10% | Behind opponents = +10-30 desperation |

### Formula

```typescript
desperationScore =
  (creditFactor * 0.35) +
  (incomeFactor * 0.25) +
  (harvesterRatioFactor * 0.20) +
  (gamePhaseBonus * 0.10) +
  (relativeFactor * 0.10)
```

### Behavior Thresholds

| Desperation | Risk Tolerance | Behavior |
|-------------|----------------|----------|
| 0-20 | Very cautious | Only harvest in danger < 20 zones |
| 21-50 | Balanced | Harvest in danger < 50 zones |
| 51-75 | Aggressive | Harvest in danger < 75 zones, reduced flee distance |
| 76-100 | Desperate | Harvest anywhere, only flee when directly attacked |

### Difficulty Scaling

| Difficulty | Behavior |
|------------|----------|
| Easy | Fixed desperation of 30 (always balanced) |
| Medium | Only uses credits and harvester ratio factors |
| Hard | Full calculation with relative economy awareness |

## Module 3: Harvester Coordinator

**File:** `src/engine/ai/harvester/coordinator.ts`

Manages harvesters as a fleet with role assignment and distribution.

### Harvester Roles

| Role | Assignment Criteria | Behavior |
|------|---------------------|----------|
| Safe | Low HP, full cargo, or low desperation | Only danger < 30 zones, flees early |
| Standard | Default role | Uses danger < (50 + desperation/2) zones |
| Risk-Taker | High desperation, empty cargo | Will enter any zone, reduced flee |
| Opportunist | Medium desperation, fast harvester | Grabs contested ore quickly, retreats fast |

### Role Assignment Logic (every 60 ticks)

```typescript
function assignRole(harvester: Entity, desperation: number): Role {
  if (harvester.hp < harvester.maxHp * 0.5) return 'safe'
  if (harvester.harvester.cargo > 400) return 'safe'
  if (desperation > 70 && harvester.harvester.cargo < 100) return 'risk-taker'
  if (desperation >= 40 && desperation <= 70) return 'opportunist'
  return 'standard'
}
```

### Ore Field Distribution

- Track which ore fields are "claimed" by which harvesters
- Prevent 3+ harvesters targeting the same ore patch
- Spread harvesters across multiple ore fields
- Consider ore field danger when distributing

### Refinery Queue Management

- Track harvesters en-route to each refinery
- If refinery has 2+ incoming, redirect new harvesters to alternatives
- Prevent traffic jams at refineries

### Difficulty Scaling

| Difficulty | Behavior |
|------------|----------|
| Easy | No coordination (current behavior) |
| Medium | Refinery queue management only |
| Hard | Full role assignment and ore distribution |

## Module 4: Stuck Resolution Engine

**File:** `src/engine/ai/harvester/stuck_resolver.ts`

Escalating response system for stuck harvesters.

### Stuck Detection Signals

- `stuckTimer` exceeds threshold (from movement component)
- `harvestAttemptTicks` increasing without cargo gain
- Distance to target not decreasing over 30+ ticks
- Harvester velocity near zero while having a target

### Escalation Levels

| Level | Trigger | Action | Cooldown |
|-------|---------|--------|----------|
| 1 - Nudge | 5 ticks stuck | Random perpendicular push, retry same target | 30 ticks |
| 2 - Detour | 15 ticks stuck | Find alternate ore within 300px | 60 ticks |
| 3 - Relocate | 30 ticks stuck | Find ore in completely different zone | 120 ticks |
| 4 - Retreat | 45 ticks stuck | Return to base empty, reset state | 180 ticks |
| 5 - Emergency | 60 ticks stuck | Full state reset, reassign by coordinator | 300 ticks |

### Special Cases

- **Stuck at refinery**: Don't escalate to level 3+, just wait or find alternate refinery
- **Stuck due to combat**: Prioritize fleeing over unstuck logic
- **Multiple harvesters stuck together**: Coordinator reassigns one to different ore field

### Blacklist System

When reaching Level 3+, the problematic ore/location is temporarily blacklisted for that harvester (180 ticks).

### Difficulty Scaling

| Difficulty | Behavior |
|------------|----------|
| Easy | Only levels 1-2 (nudge and detour) |
| Medium | Levels 1-4 |
| Hard | Full system with blacklisting |

## Module 5: Dynamic Escort System

**File:** `src/engine/ai/harvester/escort.ts`

Assigns combat units to protect harvesters in dangerous areas.

### Escort Assignment Logic (every 90 ticks)

```typescript
for each oreField with active harvesters:
  fieldDanger = getZoneDanger(oreField.position)
  harvesterValue = sum of (cargo + baseValue) for harvesters there

  if fieldDanger > 40 AND harvesterValue > 500:
    assignEscort(oreField, count=1)
  if fieldDanger > 70 AND harvesterValue > 1000:
    assignEscort(oreField, count=2)
```

### Escort Behavior

- Patrol in 150px radius around ore field
- Engage enemies entering zone, don't chase far
- Released when danger drops below 30
- Prioritize protecting harvesters over killing enemies

### Escort Selection Priority

1. Idle combat units near the ore field
2. Units already patrolling nearby
3. Units at base (only if desperation < 50)

### Difficulty Scaling

| Difficulty | Behavior |
|------------|----------|
| Easy | No escort system |
| Medium | Escorts only when danger > 60 and harvester actively damaged |
| Hard | Full proactive escort assignment |

## Integration

### Execution Order (per tick)

```
1. DangerMap.update()           // Every 30 ticks
2. DesperationCalc.update()     // Every 60 ticks
3. Coordinator.assignRoles()    // Every 60 ticks
4. Coordinator.distributeOre()  // Every 60 ticks
5. EscortSystem.update()        // Every 90 ticks
6. StuckResolver.check()        // Every tick
7. HarvesterSafety.update()     // Every tick (existing, enhanced)
8. HarvesterGathering.update()  // Every tick
```

### New AI State Fields

```typescript
// Added to AIState in src/engine/ai/state.ts
harvesterAI: {
  dangerMap: Map<string, number>           // "zoneX,zoneY" -> danger score
  dangerMapLastUpdate: number              // tick of last update
  desperationScore: number                 // 0-100
  harvesterRoles: Map<EntityId, Role>      // harvester -> assigned role
  oreFieldClaims: Map<EntityId, EntityId[]> // ore -> harvesters
  escortAssignments: Map<EntityId, EntityId> // combat unit -> ore field
  blacklistedOre: Map<EntityId, number>    // ore -> expiry tick
}
```

### File Structure

```
src/engine/ai/
├── harvester/
│   ├── index.ts           // Main entry, orchestrates all modules
│   ├── danger_map.ts      // Zone danger calculation
│   ├── desperation.ts     // Economic pressure scoring
│   ├── coordinator.ts     // Role assignment & distribution
│   ├── stuck_resolver.ts  // Escalating unstuck logic
│   └── escort.ts          // Dynamic escort assignment
├── action_economy.ts      // Modified: calls harvester/index.ts
└── action_combat.ts       // Modified: enhanced flee with danger awareness
```

## Testing

### Key Test Cases

1. **Danger avoidance**: Harvester chooses further safe ore over closer dangerous ore
2. **Desperation override**: At 80+ desperation, harvester enters danger zone
3. **Role assignment**: Low-HP harvester gets Safe role, avoids risk
4. **Stuck escalation**: Blocked harvester progresses through all 5 levels
5. **Escort assignment**: Combat unit assigned when ore field danger exceeds threshold
6. **Refinery distribution**: 3 harvesters spread across 2 refineries
7. **Death memory**: After harvester dies in zone, others avoid it temporarily
8. **Difficulty scaling**: Easy AI ignores danger, Hard AI uses full system

### Performance Considerations

- Danger map updates throttled to every 30 ticks
- Coordinator updates throttled to every 60 ticks
- Escort updates throttled to every 90 ticks
- Per-tick work is minimal (lookups and stuck checks only)

## Migration Notes

### Modified Existing Files

- `src/engine/ai/state.ts` - Add `harvesterAI` state fields
- `src/engine/ai/action_economy.ts` - Call new harvester system
- `src/engine/ai/action_combat.ts` - Enhance flee logic with danger awareness
- `src/engine/ai/utils.ts` - May need new constants

### Backward Compatibility

Easy AI difficulty retains current behavior for smooth difficulty curve.

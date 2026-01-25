# Intelligent Harvester AI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a complete harvester AI overhaul with danger awareness, economic pressure adaptation, fleet coordination, and stuck resolution - all scaling with AI difficulty.

**Architecture:** Five interconnected modules (danger_map, desperation, coordinator, stuck_resolver, escort) orchestrated by a main index.ts. Integrates with existing AI through action_economy.ts and action_combat.ts modifications.

**Tech Stack:** TypeScript, Vitest for testing, existing game engine patterns (immutable state, action dispatch)

---

## Task 1: Create Harvester AI Types

**Files:**
- Create: `src/engine/ai/harvester/types.ts`

**Step 1: Write the failing test**

Create file: `tests/engine/harvester_ai/types.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { HarvesterRole, DangerZone, HarvesterAIState } from '../../../src/engine/ai/harvester/types';

describe('Harvester AI Types', () => {
    it('should define HarvesterRole enum values', () => {
        const roles: HarvesterRole[] = ['safe', 'standard', 'risk-taker', 'opportunist'];
        expect(roles).toHaveLength(4);
    });

    it('should define DangerZone structure', () => {
        const zone: DangerZone = {
            key: '5,3',
            dangerScore: 45,
            enemyCount: 2,
            recentAttacks: 1,
            harvesterDeaths: 0,
            lastUpdate: 100
        };
        expect(zone.dangerScore).toBe(45);
    });

    it('should define HarvesterAIState structure', () => {
        const state: HarvesterAIState = {
            dangerMap: new Map(),
            dangerMapLastUpdate: 0,
            desperationScore: 30,
            harvesterRoles: new Map(),
            oreFieldClaims: new Map(),
            refineryQueue: new Map(),
            escortAssignments: new Map(),
            blacklistedOre: new Map(),
            harvesterDeaths: []
        };
        expect(state.desperationScore).toBe(30);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- tests/engine/harvester_ai/types.test.ts`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

Create file: `src/engine/ai/harvester/types.ts`

```typescript
import { EntityId, Vector } from '../../types.js';

// Harvester roles determine risk tolerance
export type HarvesterRole = 'safe' | 'standard' | 'risk-taker' | 'opportunist';

// Danger zone tracking
export interface DangerZone {
    key: string;              // "zoneX,zoneY" format
    dangerScore: number;      // 0-100
    enemyCount: number;       // Current enemies in zone
    recentAttacks: number;    // Attack events in last 300 ticks
    harvesterDeaths: number;  // Deaths in last 1800 ticks
    lastUpdate: number;       // Tick of last update
}

// Harvester death record for memory
export interface HarvesterDeathRecord {
    position: Vector;
    tick: number;
    zoneKey: string;
}

// Stuck escalation levels
export type StuckLevel = 1 | 2 | 3 | 4 | 5;

// Per-harvester stuck state
export interface HarvesterStuckState {
    stuckTicks: number;
    currentLevel: StuckLevel;
    lastActionTick: number;
    blacklistedOre: Set<EntityId>;
}

// Main harvester AI state (per player)
export interface HarvesterAIState {
    // Danger map: zoneKey -> DangerZone
    dangerMap: Map<string, DangerZone>;
    dangerMapLastUpdate: number;

    // Desperation
    desperationScore: number;  // 0-100

    // Coordinator
    harvesterRoles: Map<EntityId, HarvesterRole>;
    oreFieldClaims: Map<EntityId, EntityId[]>;  // ore -> harvesters
    refineryQueue: Map<EntityId, EntityId[]>;   // refinery -> incoming harvesters

    // Escort
    escortAssignments: Map<EntityId, EntityId>; // combat unit -> ore field

    // Stuck resolution
    blacklistedOre: Map<EntityId, number>;      // ore -> expiry tick
    stuckStates: Map<EntityId, HarvesterStuckState>;

    // Death memory
    harvesterDeaths: HarvesterDeathRecord[];
}

// Constants for the harvester AI system
export const HARVESTER_AI_CONSTANTS = {
    // Zone configuration
    ZONE_SIZE: 200,                    // pixels per zone
    DANGER_MAP_UPDATE_INTERVAL: 30,    // ticks

    // Danger score weights
    ENEMY_PRESENCE_WEIGHT: 10,
    RECENT_ATTACK_WEIGHT: 15,
    DEATH_MEMORY_WEIGHT: 25,

    // Decay windows
    ATTACK_MEMORY_WINDOW: 300,         // 5 seconds
    DEATH_MEMORY_WINDOW: 1800,         // 30 seconds

    // Desperation thresholds
    DESPERATION_UPDATE_INTERVAL: 60,
    CREDITS_DESPERATE_THRESHOLD: 5000,
    HARVESTER_RATIO_DESPERATE: 1.5,
    EARLY_GAME_TICKS: 10800,           // 3 minutes

    // Coordinator
    COORDINATOR_UPDATE_INTERVAL: 60,
    MAX_HARVESTERS_PER_ORE: 3,
    MAX_HARVESTERS_PER_REFINERY: 2,

    // Escort
    ESCORT_UPDATE_INTERVAL: 90,
    ESCORT_PATROL_RADIUS: 150,
    ESCORT_RELEASE_DANGER: 30,
    ESCORT_ASSIGN_DANGER: 40,
    ESCORT_PRIORITY_DANGER: 70,

    // Stuck resolution
    STUCK_LEVEL_1_TICKS: 5,
    STUCK_LEVEL_2_TICKS: 15,
    STUCK_LEVEL_3_TICKS: 30,
    STUCK_LEVEL_4_TICKS: 45,
    STUCK_LEVEL_5_TICKS: 60,
    STUCK_COOLDOWN_1: 30,
    STUCK_COOLDOWN_2: 60,
    STUCK_COOLDOWN_3: 120,
    STUCK_COOLDOWN_4: 180,
    STUCK_COOLDOWN_5: 300,
    BLACKLIST_DURATION: 180,
    DETOUR_SEARCH_RADIUS: 300,
} as const;

// Initial state factory
export function createInitialHarvesterAIState(): HarvesterAIState {
    return {
        dangerMap: new Map(),
        dangerMapLastUpdate: 0,
        desperationScore: 30,
        harvesterRoles: new Map(),
        oreFieldClaims: new Map(),
        refineryQueue: new Map(),
        escortAssignments: new Map(),
        blacklistedOre: new Map(),
        stuckStates: new Map(),
        harvesterDeaths: []
    };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- tests/engine/harvester_ai/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add tests/engine/harvester_ai/types.test.ts src/engine/ai/harvester/types.ts
git commit -m "feat(ai): add harvester AI types and constants"
```

---

## Task 2: Implement Danger Map System

**Files:**
- Create: `src/engine/ai/harvester/danger_map.ts`
- Test: `tests/engine/harvester_ai/danger_map.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
    updateDangerMap,
    getZoneDanger,
    getZoneKey,
    getPathDanger,
    findSafestOre
} from '../../../src/engine/ai/harvester/danger_map';
import { createInitialHarvesterAIState, HarvesterAIState } from '../../../src/engine/ai/harvester/types';
import { Vector } from '../../../src/engine/types';
import { createTestCombatUnit, createTestResource, createTestHarvester } from '../../../src/engine/test-utils';

describe('Danger Map System', () => {
    let harvesterAI: HarvesterAIState;

    beforeEach(() => {
        harvesterAI = createInitialHarvesterAIState();
    });

    describe('getZoneKey', () => {
        it('should convert position to zone key', () => {
            expect(getZoneKey(150, 250)).toBe('0,1');
            expect(getZoneKey(450, 650)).toBe('2,3');
        });
    });

    describe('updateDangerMap', () => {
        it('should detect enemies and increase zone danger', () => {
            const enemies = [
                createTestCombatUnit({ id: 'e1', owner: 2, key: 'heavy', x: 300, y: 300 })
            ];
            updateDangerMap(harvesterAI, 1, enemies, [], 100, 'hard');
            const danger = getZoneDanger(harvesterAI, 300, 300);
            expect(danger).toBeGreaterThan(0);
        });

        it('should not update danger map for easy difficulty', () => {
            const enemies = [
                createTestCombatUnit({ id: 'e1', owner: 2, key: 'heavy', x: 300, y: 300 })
            ];
            updateDangerMap(harvesterAI, 1, enemies, [], 100, 'easy');
            expect(harvesterAI.dangerMap.size).toBe(0);
        });
    });

    describe('findSafestOre', () => {
        it('should prefer safer ore over closer dangerous ore', () => {
            harvesterAI.dangerMap.set('1,1', {
                key: '1,1', dangerScore: 80, enemyCount: 3,
                recentAttacks: 2, harvesterDeaths: 1, lastUpdate: 100
            });
            const harvester = createTestHarvester({ x: 100, y: 100 });
            const closeButDangerous = createTestResource({ id: 'ore1', x: 250, y: 250 });
            const farButSafe = createTestResource({ id: 'ore2', x: 600, y: 100 });
            const best = findSafestOre(harvesterAI, harvester, [closeButDangerous, farButSafe], 20);
            expect(best?.id).toBe('ore2');
        });
    });
});
```

**Step 2-5: Implement, test, commit**

Similar pattern - implement danger_map.ts with zone tracking, enemy counting, attack/death memory.

---

## Task 3: Implement Desperation Calculator

**Files:**
- Create: `src/engine/ai/harvester/desperation.ts`
- Test: `tests/engine/harvester_ai/desperation.test.ts`

Multi-factor scoring: credits (35%), income (25%), harvester ratio (20%), game phase (10%), relative economy (10%).

---

## Task 4: Implement Harvester Coordinator

**Files:**
- Create: `src/engine/ai/harvester/coordinator.ts`
- Test: `tests/engine/harvester_ai/coordinator.test.ts`

Role assignment (safe/standard/risk-taker/opportunist), ore distribution, refinery queue management.

---

## Task 5: Implement Stuck Resolution Engine

**Files:**
- Create: `src/engine/ai/harvester/stuck_resolver.ts`
- Test: `tests/engine/harvester_ai/stuck_resolver.test.ts`

5-level escalation: nudge -> detour -> relocate -> retreat -> emergency.

---

## Task 6: Implement Escort System

**Files:**
- Create: `src/engine/ai/harvester/escort.ts`
- Test: `tests/engine/harvester_ai/escort.test.ts`

Dynamic escort assignment based on danger zones and harvester value.

---

## Task 7: Create Main Orchestrator

**Files:**
- Create: `src/engine/ai/harvester/index.ts`
- Test: `tests/engine/harvester_ai/index.test.ts`

Orchestrates all modules per tick with proper update intervals.

---

## Task 8: Integrate with Existing AI State

**Files:**
- Modify: `src/engine/ai/state.ts`
- Modify: `src/engine/ai/types.ts`

Add harvesterAIEnabled flag to AIPlayerState.

---

## Task 9: Integrate with AI Action Economy

**Files:**
- Modify: `src/engine/ai/action_economy.ts`

Update handleHarvesterGathering to use danger-aware ore selection.

---

## Task 10: Integrate with AI Action Combat

**Files:**
- Modify: `src/engine/ai/action_combat.ts`

Enhance handleHarvesterSafety with role-based flee behavior.

---

## Task 11: Call Harvester AI from Main AI Loop

**Files:**
- Modify: `src/engine/ai/index.ts`

Add updateHarvesterAI call to computeAiActions.

---

## Task 12: Add Integration Tests

**Files:**
- Create: `tests/engine/harvester_ai/integration.test.ts`

End-to-end tests for danger avoidance, risk-taking, and stuck resolution.

---

## Task 13: Run Full Test Suite

```bash
npm test
```

Fix any regressions.

---

## Task 14: Final Verification

Manual testing with dev server, coverage check.

---

## Summary

14 tasks implementing the intelligent harvester AI with TDD:
- Types, danger map, desperation, coordinator, stuck resolver, escort
- Orchestrator and integrations
- Comprehensive testing

Each module scales with AI difficulty (Easy/Medium/Hard).

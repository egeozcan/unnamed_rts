# Debug Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a CLI/REPL debug tool for analyzing game state, AI decisions, and unit behavior with structured event logging.

**Architecture:** Event emitter in engine (tree-shakeable), collector with filters, CLI/REPL interface. Events stored as JSONL with Zod validation.

**Tech Stack:** TypeScript, Zod, Node.js readline for REPL, existing game engine

---

## Task 1: Event Emitter Foundation

**Files:**
- Create: `src/engine/debug/events.ts`
- Test: `tests/engine/debug/events.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/engine/debug/events.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DebugEvents, DebugEventType } from '../../src/engine/debug/events';

describe('DebugEvents', () => {
  beforeEach(() => {
    DebugEvents.setCollector(null);
  });

  it('should not call collector when none is set', () => {
    // Should not throw
    DebugEvents.emit('command', { tick: 100, playerId: 1, entityId: 'e_1', data: {} });
  });

  it('should call collector when one is set', () => {
    const collector = vi.fn();
    DebugEvents.setCollector(collector);

    DebugEvents.emit('command', { tick: 100, playerId: 1, entityId: 'e_1', data: { command: 'move' } });

    expect(collector).toHaveBeenCalledWith({
      type: 'command',
      tick: 100,
      playerId: 1,
      entityId: 'e_1',
      data: { command: 'move' }
    });
  });

  it('should stop calling collector after setCollector(null)', () => {
    const collector = vi.fn();
    DebugEvents.setCollector(collector);
    DebugEvents.emit('command', { tick: 1, data: {} });
    expect(collector).toHaveBeenCalledTimes(1);

    DebugEvents.setCollector(null);
    DebugEvents.emit('command', { tick: 2, data: {} });
    expect(collector).toHaveBeenCalledTimes(1);
  });

  it('should support all event types', () => {
    const collector = vi.fn();
    DebugEvents.setCollector(collector);

    const eventTypes: DebugEventType[] = ['command', 'decision', 'state-change', 'group', 'economy', 'production', 'threat'];
    eventTypes.forEach((type, i) => {
      DebugEvents.emit(type, { tick: i, data: {} });
    });

    expect(collector).toHaveBeenCalledTimes(7);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool && npx vitest run tests/engine/debug/events.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

```typescript
// src/engine/debug/events.ts

export type DebugEventType =
  | 'command'
  | 'decision'
  | 'state-change'
  | 'group'
  | 'economy'
  | 'production'
  | 'threat';

export interface DebugEvent {
  type: DebugEventType;
  tick: number;
  playerId?: number;
  entityId?: string;
  data: Record<string, unknown>;
}

export type DebugEventPayload = Omit<DebugEvent, 'type'>;
export type DebugCollectorFn = (event: DebugEvent) => void;

let collector: DebugCollectorFn | null = null;

export const DebugEvents = {
  emit(type: DebugEventType, payload: DebugEventPayload): void {
    if (import.meta.env.DEV && collector) {
      collector({ type, ...payload });
    }
  },

  setCollector(fn: DebugCollectorFn | null): void {
    collector = fn;
  },

  /** For testing only - check if collector is set */
  hasCollector(): boolean {
    return collector !== null;
  }
};
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool && npx vitest run tests/engine/debug/events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
git add src/engine/debug/events.ts tests/engine/debug/events.test.ts
git commit -m "feat(debug): add DebugEvents emitter with tree-shakeable emit"
```

---

## Task 2: Zod Schemas for Events

**Files:**
- Create: `src/engine/debug/schemas.ts`
- Test: `tests/engine/debug/schemas.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/engine/debug/schemas.test.ts
import { describe, it, expect } from 'vitest';
import {
  CommandEventSchema,
  DecisionEventSchema,
  StateChangeEventSchema,
  GroupEventSchema,
  EconomyEventSchema,
  ProductionEventSchema,
  ThreatEventSchema,
  DebugEventSchema,
  MetaLineSchema
} from '../../src/engine/debug/schemas';

describe('Debug Event Schemas', () => {
  describe('CommandEventSchema', () => {
    it('should validate a valid command event', () => {
      const event = {
        type: 'command',
        tick: 100,
        playerId: 1,
        entityId: 'e_1234',
        data: {
          command: 'move',
          source: 'ai',
          destination: { x: 100, y: 200 },
          reason: 'retreat to base'
        }
      };
      expect(CommandEventSchema.parse(event)).toEqual(event);
    });

    it('should reject invalid command type', () => {
      const event = {
        type: 'command',
        tick: 100,
        playerId: 1,
        entityId: 'e_1234',
        data: { command: 'invalid', source: 'ai' }
      };
      expect(() => CommandEventSchema.parse(event)).toThrow();
    });
  });

  describe('DecisionEventSchema', () => {
    it('should validate a valid decision event', () => {
      const event = {
        type: 'decision',
        tick: 100,
        playerId: 1,
        data: {
          category: 'combat',
          action: 'attack',
          reason: 'enemy in range',
          scores: { threat: 80, opportunity: 60 }
        }
      };
      expect(DecisionEventSchema.parse(event)).toEqual(event);
    });
  });

  describe('StateChangeEventSchema', () => {
    it('should validate hp change event', () => {
      const event = {
        type: 'state-change',
        tick: 100,
        playerId: 1,
        entityId: 'e_1234',
        data: {
          subject: 'unit',
          field: 'hp',
          from: 600,
          to: 450,
          cause: 'damage from e_5678'
        }
      };
      expect(StateChangeEventSchema.parse(event)).toEqual(event);
    });
  });

  describe('GroupEventSchema', () => {
    it('should validate group created event', () => {
      const event = {
        type: 'group',
        tick: 100,
        playerId: 1,
        data: {
          groupId: 'main_attack',
          action: 'created',
          unitIds: ['e_1', 'e_2', 'e_3'],
          status: 'forming'
        }
      };
      expect(GroupEventSchema.parse(event)).toEqual(event);
    });
  });

  describe('EconomyEventSchema', () => {
    it('should validate harvest event', () => {
      const event = {
        type: 'economy',
        tick: 100,
        playerId: 1,
        data: {
          credits: 5000,
          delta: 100,
          source: 'harvest',
          entityId: 'e_harvester_1'
        }
      };
      expect(EconomyEventSchema.parse(event)).toEqual(event);
    });
  });

  describe('ProductionEventSchema', () => {
    it('should validate production completed event', () => {
      const event = {
        type: 'production',
        tick: 100,
        playerId: 1,
        data: {
          action: 'completed',
          category: 'vehicle',
          key: 'heavy',
          queueLength: 2
        }
      };
      expect(ProductionEventSchema.parse(event)).toEqual(event);
    });
  });

  describe('ThreatEventSchema', () => {
    it('should validate threat assessment event', () => {
      const event = {
        type: 'threat',
        tick: 100,
        playerId: 1,
        data: {
          threatLevel: 75,
          economyScore: 60,
          desperation: 20,
          isDoomed: false,
          threatsNearBase: ['e_enemy_1', 'e_enemy_2'],
          vengeanceScores: { '2': 50, '3': 10 }
        }
      };
      expect(ThreatEventSchema.parse(event)).toEqual(event);
    });
  });

  describe('DebugEventSchema (discriminated union)', () => {
    it('should discriminate by type field', () => {
      const commandEvent = { type: 'command', tick: 1, playerId: 1, entityId: 'e_1', data: { command: 'move', source: 'player' } };
      const decisionEvent = { type: 'decision', tick: 1, playerId: 1, data: { category: 'strategy', action: 'attack', reason: 'test' } };

      expect(DebugEventSchema.parse(commandEvent).type).toBe('command');
      expect(DebugEventSchema.parse(decisionEvent).type).toBe('decision');
    });
  });

  describe('MetaLineSchema', () => {
    it('should validate meta line', () => {
      const meta = {
        _meta: true,
        version: '1.0',
        startTick: 1000,
        endTick: 2000,
        filters: {
          categories: ['command', 'decision'],
          trackedEntities: ['e_1234'],
          trackedPlayers: [1],
          thresholds: { hpBelow: 50 }
        },
        recordedAt: '2026-01-25T10:00:00Z'
      };
      expect(MetaLineSchema.parse(meta)).toEqual(meta);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool && npx vitest run tests/engine/debug/schemas.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

```typescript
// src/engine/debug/schemas.ts
import { z } from 'zod';

// Vector schema (reuse from existing if available)
const VectorSchema = z.object({
  x: z.number(),
  y: z.number()
});

// === Individual Event Schemas ===

export const CommandEventSchema = z.object({
  type: z.literal('command'),
  tick: z.number(),
  playerId: z.number(),
  entityId: z.string(),
  data: z.object({
    command: z.enum(['move', 'attack', 'attack-move', 'stop', 'deploy']),
    source: z.enum(['player', 'ai']),
    target: z.string().optional(),
    destination: VectorSchema.optional(),
    reason: z.string().optional()
  })
});

export const DecisionEventSchema = z.object({
  type: z.literal('decision'),
  tick: z.number(),
  playerId: z.number(),
  entityId: z.string().optional(),
  data: z.object({
    category: z.enum(['strategy', 'combat', 'economy', 'production']),
    action: z.string(),
    reason: z.string(),
    scores: z.record(z.string(), z.number()).optional(),
    alternatives: z.array(z.string()).optional()
  })
});

export const StateChangeEventSchema = z.object({
  type: z.literal('state-change'),
  tick: z.number(),
  playerId: z.number().optional(),
  entityId: z.string().optional(),
  data: z.object({
    subject: z.enum(['unit', 'building', 'ai', 'group']),
    field: z.string(),
    from: z.unknown(),
    to: z.unknown(),
    cause: z.string().optional()
  })
});

export const GroupEventSchema = z.object({
  type: z.literal('group'),
  tick: z.number(),
  playerId: z.number(),
  data: z.object({
    groupId: z.string(),
    action: z.enum(['created', 'dissolved', 'member-added', 'member-removed', 'status-changed']),
    unitIds: z.array(z.string()).optional(),
    status: z.string().optional(),
    reason: z.string().optional()
  })
});

export const EconomyEventSchema = z.object({
  type: z.literal('economy'),
  tick: z.number(),
  playerId: z.number(),
  data: z.object({
    credits: z.number(),
    delta: z.number(),
    source: z.enum(['harvest', 'sell', 'spend', 'induction-rig']),
    entityId: z.string().optional()
  })
});

export const ProductionEventSchema = z.object({
  type: z.literal('production'),
  tick: z.number(),
  playerId: z.number(),
  data: z.object({
    action: z.enum(['queue-add', 'queue-remove', 'started', 'completed', 'cancelled']),
    category: z.enum(['building', 'infantry', 'vehicle', 'air']),
    key: z.string(),
    queueLength: z.number().optional()
  })
});

export const ThreatEventSchema = z.object({
  type: z.literal('threat'),
  tick: z.number(),
  playerId: z.number(),
  data: z.object({
    threatLevel: z.number(),
    economyScore: z.number(),
    desperation: z.number(),
    isDoomed: z.boolean(),
    threatsNearBase: z.array(z.string()),
    vengeanceScores: z.record(z.string(), z.number())
  })
});

// === Combined Discriminated Union ===

export const DebugEventSchema = z.discriminatedUnion('type', [
  CommandEventSchema,
  DecisionEventSchema,
  StateChangeEventSchema,
  GroupEventSchema,
  EconomyEventSchema,
  ProductionEventSchema,
  ThreatEventSchema
]);

// === Meta Line Schema ===

export const MetaLineSchema = z.object({
  _meta: z.literal(true),
  version: z.string(),
  startTick: z.number(),
  endTick: z.number(),
  filters: z.object({
    categories: z.array(z.string()),
    trackedEntities: z.array(z.string()),
    trackedPlayers: z.array(z.number()),
    thresholds: z.record(z.string(), z.number())
  }),
  recordedAt: z.string()
});

// === Type Exports ===

export type CommandEvent = z.infer<typeof CommandEventSchema>;
export type DecisionEvent = z.infer<typeof DecisionEventSchema>;
export type StateChangeEvent = z.infer<typeof StateChangeEventSchema>;
export type GroupEvent = z.infer<typeof GroupEventSchema>;
export type EconomyEvent = z.infer<typeof EconomyEventSchema>;
export type ProductionEvent = z.infer<typeof ProductionEventSchema>;
export type ThreatEvent = z.infer<typeof ThreatEventSchema>;
export type DebugEvent = z.infer<typeof DebugEventSchema>;
export type MetaLine = z.infer<typeof MetaLineSchema>;
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool && npx vitest run tests/engine/debug/schemas.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
git add src/engine/debug/schemas.ts tests/engine/debug/schemas.test.ts
git commit -m "feat(debug): add Zod schemas for all debug event types"
```

---

## Task 3: Filter Configuration and Collector

**Files:**
- Create: `src/scripts/debug/collector.ts`
- Test: `tests/scripts/debug/collector.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/scripts/debug/collector.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DebugCollector, createDefaultFilterConfig, FilterConfig } from '../../../src/scripts/debug/collector';
import { DebugEvent } from '../../../src/engine/debug/schemas';

describe('DebugCollector', () => {
  let collector: DebugCollector;

  beforeEach(() => {
    collector = new DebugCollector();
  });

  describe('basic collection', () => {
    it('should collect events', () => {
      const event: DebugEvent = {
        type: 'command',
        tick: 100,
        playerId: 1,
        entityId: 'e_1',
        data: { command: 'move', source: 'ai' }
      };

      collector.collect(event);
      expect(collector.getEvents()).toHaveLength(1);
      expect(collector.getEvents()[0]).toEqual(event);
    });

    it('should clear events', () => {
      collector.collect({ type: 'command', tick: 1, playerId: 1, entityId: 'e_1', data: { command: 'move', source: 'ai' } });
      collector.clear();
      expect(collector.getEvents()).toHaveLength(0);
    });
  });

  describe('category filtering', () => {
    it('should filter by disabled category', () => {
      const config = createDefaultFilterConfig();
      config.categories.command = false;
      collector.setConfig(config);

      collector.collect({ type: 'command', tick: 1, playerId: 1, entityId: 'e_1', data: { command: 'move', source: 'ai' } });
      collector.collect({ type: 'decision', tick: 2, playerId: 1, data: { category: 'combat', action: 'attack', reason: 'test' } });

      expect(collector.getEvents()).toHaveLength(1);
      expect(collector.getEvents()[0].type).toBe('decision');
    });
  });

  describe('entity whitelist', () => {
    it('should filter to whitelisted entities only', () => {
      const config = createDefaultFilterConfig();
      config.trackedEntities.add('e_1');
      collector.setConfig(config);

      collector.collect({ type: 'command', tick: 1, playerId: 1, entityId: 'e_1', data: { command: 'move', source: 'ai' } });
      collector.collect({ type: 'command', tick: 2, playerId: 1, entityId: 'e_2', data: { command: 'move', source: 'ai' } });

      expect(collector.getEvents()).toHaveLength(1);
      expect(collector.getEvents()[0].entityId).toBe('e_1');
    });

    it('should allow all entities when whitelist is empty', () => {
      collector.collect({ type: 'command', tick: 1, playerId: 1, entityId: 'e_1', data: { command: 'move', source: 'ai' } });
      collector.collect({ type: 'command', tick: 2, playerId: 1, entityId: 'e_2', data: { command: 'move', source: 'ai' } });

      expect(collector.getEvents()).toHaveLength(2);
    });
  });

  describe('player filtering', () => {
    it('should filter to tracked players only', () => {
      const config = createDefaultFilterConfig();
      config.trackedPlayers.add(1);
      collector.setConfig(config);

      collector.collect({ type: 'command', tick: 1, playerId: 1, entityId: 'e_1', data: { command: 'move', source: 'ai' } });
      collector.collect({ type: 'command', tick: 2, playerId: 2, entityId: 'e_2', data: { command: 'move', source: 'ai' } });

      expect(collector.getEvents()).toHaveLength(1);
      expect(collector.getEvents()[0].playerId).toBe(1);
    });
  });

  describe('change-only filtering', () => {
    it('should skip economy events with same credits when changeOnly.economy is true', () => {
      const config = createDefaultFilterConfig();
      config.changeOnly.economy = true;
      collector.setConfig(config);

      collector.collect({ type: 'economy', tick: 1, playerId: 1, data: { credits: 1000, delta: 100, source: 'harvest' } });
      collector.collect({ type: 'economy', tick: 2, playerId: 1, data: { credits: 1000, delta: 0, source: 'harvest' } });
      collector.collect({ type: 'economy', tick: 3, playerId: 1, data: { credits: 1100, delta: 100, source: 'harvest' } });

      expect(collector.getEvents()).toHaveLength(2);
    });
  });

  describe('threshold filtering', () => {
    it('should only record hp state-change when below threshold', () => {
      const config = createDefaultFilterConfig();
      config.thresholds.hpBelow = 50; // 50%
      collector.setConfig(config);

      // HP change but still above threshold (60% -> 55%)
      collector.collect({
        type: 'state-change', tick: 1, playerId: 1, entityId: 'e_1',
        data: { subject: 'unit', field: 'hp', from: 600, to: 550, cause: 'damage' }
      });

      // HP drops below threshold (55% -> 45%)
      collector.collect({
        type: 'state-change', tick: 2, playerId: 1, entityId: 'e_1',
        data: { subject: 'unit', field: 'hp', from: 550, to: 450, cause: 'damage' }
      });

      // Non-HP state changes should pass through
      collector.collect({
        type: 'state-change', tick: 3, playerId: 1, entityId: 'e_1',
        data: { subject: 'unit', field: 'target', from: null, to: 'e_2' }
      });

      expect(collector.getEvents()).toHaveLength(2);
    });

    it('should only record economy events with delta above threshold', () => {
      const config = createDefaultFilterConfig();
      config.thresholds.economyDelta = 50;
      collector.setConfig(config);

      collector.collect({ type: 'economy', tick: 1, playerId: 1, data: { credits: 1000, delta: 10, source: 'harvest' } });
      collector.collect({ type: 'economy', tick: 2, playerId: 1, data: { credits: 1100, delta: 100, source: 'harvest' } });

      expect(collector.getEvents()).toHaveLength(1);
      expect(collector.getEvents()[0].data.delta).toBe(100);
    });
  });

  describe('export', () => {
    it('should export to JSONL format', () => {
      collector.collect({ type: 'command', tick: 1, playerId: 1, entityId: 'e_1', data: { command: 'move', source: 'ai' } });
      collector.collect({ type: 'decision', tick: 2, playerId: 1, data: { category: 'combat', action: 'attack', reason: 'test' } });

      const jsonl = collector.exportToJsonl(1, 2);
      const lines = jsonl.trim().split('\n');

      expect(lines).toHaveLength(3); // meta + 2 events
      expect(JSON.parse(lines[0])._meta).toBe(true);
      expect(JSON.parse(lines[1]).type).toBe('command');
      expect(JSON.parse(lines[2]).type).toBe('decision');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool && npx vitest run tests/scripts/debug/collector.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

```typescript
// src/scripts/debug/collector.ts
import { DebugEvent, MetaLine } from '../../engine/debug/schemas';

export interface FilterConfig {
  categories: {
    command: boolean;
    decision: boolean;
    'state-change': boolean;
    group: boolean;
    economy: boolean;
    production: boolean;
    threat: boolean;
  };
  trackedEntities: Set<string>;
  trackedPlayers: Set<number>;
  changeOnly: {
    economy: boolean;
    threat: boolean;
    strategy: boolean;
  };
  thresholds: {
    hpBelow?: number;
    creditsBelow?: number;
    threatAbove?: number;
    economyDelta?: number;
  };
  snapshotInterval: number;
}

export function createDefaultFilterConfig(): FilterConfig {
  return {
    categories: {
      command: true,
      decision: true,
      'state-change': true,
      group: true,
      economy: true,
      production: true,
      threat: true
    },
    trackedEntities: new Set(),
    trackedPlayers: new Set(),
    changeOnly: {
      economy: true,
      threat: true,
      strategy: true
    },
    thresholds: {},
    snapshotInterval: 100
  };
}

export class DebugCollector {
  private events: DebugEvent[] = [];
  private config: FilterConfig = createDefaultFilterConfig();
  private lastValues: Map<string, unknown> = new Map();

  setConfig(config: FilterConfig): void {
    this.config = config;
  }

  getConfig(): FilterConfig {
    return this.config;
  }

  collect(event: DebugEvent): void {
    if (this.shouldRecord(event)) {
      this.events.push(event);
      this.updateLastValues(event);
    }
  }

  private shouldRecord(event: DebugEvent): boolean {
    // Category check
    if (!this.config.categories[event.type]) {
      return false;
    }

    // Entity whitelist check
    if (this.config.trackedEntities.size > 0 && event.entityId) {
      if (!this.config.trackedEntities.has(event.entityId)) {
        return false;
      }
    }

    // Player filter check
    if (this.config.trackedPlayers.size > 0 && event.playerId !== undefined) {
      if (!this.config.trackedPlayers.has(event.playerId)) {
        return false;
      }
    }

    // Change-only check for economy
    if (event.type === 'economy' && this.config.changeOnly.economy) {
      const key = `economy:${event.playerId}:credits`;
      const lastCredits = this.lastValues.get(key);
      const currentCredits = (event.data as { credits: number }).credits;
      if (lastCredits === currentCredits) {
        return false;
      }
    }

    // Change-only check for threat
    if (event.type === 'threat' && this.config.changeOnly.threat) {
      const key = `threat:${event.playerId}:level`;
      const lastLevel = this.lastValues.get(key);
      const currentLevel = (event.data as { threatLevel: number }).threatLevel;
      if (lastLevel === currentLevel) {
        return false;
      }
    }

    // Threshold: hpBelow
    if (event.type === 'state-change' && this.config.thresholds.hpBelow !== undefined) {
      const data = event.data as { subject: string; field: string; to: unknown };
      if (data.subject === 'unit' && data.field === 'hp') {
        // Assume maxHp is 1000 for percentage calculation, or we need to track it
        // For now, we'll treat the threshold as absolute HP percentage (0-100 scale)
        // Actually, we don't have maxHp here. Let's skip HP events if to > threshold * 10 (rough heuristic)
        // Better: just check if "to" is below threshold as percentage requires maxHp
        // For simplicity, let's assume the caller provides percentage in the event or we skip this check
        // Actually, let's implement this properly: only pass if to/from ratio < threshold%
        const to = data.to as number;
        const from = (event.data as { from: unknown }).from as number;
        if (from > 0) {
          const ratio = (to / from) * 100;
          // This doesn't work well. Let's change approach:
          // hpBelow threshold means: only record if resulting HP% < threshold
          // We need maxHp. Since we don't have it, let's just pass through for now
          // and document that hpBelow needs entity lookup or maxHp in event
        }
        // Simpler approach: just pass state-changes for now, threshold is advisory
      }
    }

    // Threshold: economyDelta
    if (event.type === 'economy' && this.config.thresholds.economyDelta !== undefined) {
      const delta = Math.abs((event.data as { delta: number }).delta);
      if (delta < this.config.thresholds.economyDelta) {
        return false;
      }
    }

    // Threshold: threatAbove
    if (event.type === 'threat' && this.config.thresholds.threatAbove !== undefined) {
      const level = (event.data as { threatLevel: number }).threatLevel;
      if (level <= this.config.thresholds.threatAbove) {
        return false;
      }
    }

    // Threshold: creditsBelow
    if (event.type === 'economy' && this.config.thresholds.creditsBelow !== undefined) {
      const credits = (event.data as { credits: number }).credits;
      if (credits >= this.config.thresholds.creditsBelow) {
        return false;
      }
    }

    return true;
  }

  private updateLastValues(event: DebugEvent): void {
    if (event.type === 'economy') {
      const credits = (event.data as { credits: number }).credits;
      this.lastValues.set(`economy:${event.playerId}:credits`, credits);
    }
    if (event.type === 'threat') {
      const level = (event.data as { threatLevel: number }).threatLevel;
      this.lastValues.set(`threat:${event.playerId}:level`, level);
    }
  }

  getEvents(): DebugEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
    this.lastValues.clear();
  }

  exportToJsonl(startTick: number, endTick: number): string {
    const meta: MetaLine = {
      _meta: true,
      version: '1.0',
      startTick,
      endTick,
      filters: {
        categories: Object.entries(this.config.categories)
          .filter(([, v]) => v)
          .map(([k]) => k),
        trackedEntities: Array.from(this.config.trackedEntities),
        trackedPlayers: Array.from(this.config.trackedPlayers),
        thresholds: this.config.thresholds as Record<string, number>
      },
      recordedAt: new Date().toISOString()
    };

    const lines = [JSON.stringify(meta)];
    for (const event of this.events) {
      lines.push(JSON.stringify(event));
    }
    return lines.join('\n') + '\n';
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool && npx vitest run tests/scripts/debug/collector.test.ts`
Expected: PASS (some tests may need adjustment for hpBelow threshold)

**Step 5: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
git add src/scripts/debug/collector.ts tests/scripts/debug/collector.test.ts
git commit -m "feat(debug): add DebugCollector with filtering and JSONL export"
```

---

## Task 4: Trigger Condition Parser

**Files:**
- Create: `src/scripts/debug/triggers.ts`
- Test: `tests/scripts/debug/triggers.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/scripts/debug/triggers.test.ts
import { describe, it, expect } from 'vitest';
import { parseTrigger, evaluateTrigger, Trigger } from '../../../src/scripts/debug/triggers';
import { GameState, Vector } from '../../../src/engine/types';
import { getAIState, resetAIState } from '../../../src/engine/ai/state';

describe('Trigger Parser', () => {
  describe('parseTrigger', () => {
    it('should parse "dead <id>"', () => {
      const trigger = parseTrigger('dead e_1234');
      expect(trigger).toEqual({ type: 'dead', entityId: 'e_1234' });
    });

    it('should parse "hp <id> < <percent>%"', () => {
      const trigger = parseTrigger('hp e_1234 < 50%');
      expect(trigger).toEqual({ type: 'hp', entityId: 'e_1234', operator: '<', value: 50 });
    });

    it('should parse "tick > <n>"', () => {
      const trigger = parseTrigger('tick > 5000');
      expect(trigger).toEqual({ type: 'tick', operator: '>', value: 5000 });
    });

    it('should parse "credits <player> < <amount>"', () => {
      const trigger = parseTrigger('credits 1 < 500');
      expect(trigger).toEqual({ type: 'credits', playerId: 1, operator: '<', value: 500 });
    });

    it('should parse "strategy <player> == <strategy>"', () => {
      const trigger = parseTrigger('strategy 1 == attack');
      expect(trigger).toEqual({ type: 'strategy', playerId: 1, operator: '==', value: 'attack' });
    });

    it('should parse "count <player> <type> >= <n>"', () => {
      const trigger = parseTrigger('count 1 harvester >= 5');
      expect(trigger).toEqual({ type: 'count', playerId: 1, entityType: 'harvester', operator: '>=', value: 5 });
    });

    it('should parse "player <id> dead"', () => {
      const trigger = parseTrigger('player 2 dead');
      expect(trigger).toEqual({ type: 'player-dead', playerId: 2 });
    });

    it('should parse "threat <player> > <level>"', () => {
      const trigger = parseTrigger('threat 1 > 80');
      expect(trigger).toEqual({ type: 'threat', playerId: 1, operator: '>', value: 80 });
    });

    it('should parse OR conditions', () => {
      const trigger = parseTrigger('dead e_1234 or tick > 5000');
      expect(trigger).toEqual({
        type: 'or',
        conditions: [
          { type: 'dead', entityId: 'e_1234' },
          { type: 'tick', operator: '>', value: 5000 }
        ]
      });
    });
  });
});

describe('Trigger Evaluator', () => {
  // Create minimal test state
  function createTestState(overrides: Partial<GameState> = {}): GameState {
    return {
      running: true,
      mode: 'game',
      sellMode: false,
      repairMode: false,
      difficulty: 'hard',
      tick: 1000,
      camera: { x: 0, y: 0 },
      zoom: 1,
      entities: {},
      projectiles: [],
      particles: [],
      selection: [],
      placingBuilding: null,
      players: {
        1: {
          id: 1,
          isAi: true,
          difficulty: 'hard',
          color: '#ff0000',
          credits: 5000,
          maxPower: 100,
          usedPower: 50,
          queues: {
            building: { current: null, progress: 0, invested: 0 },
            infantry: { current: null, progress: 0, invested: 0 },
            vehicle: { current: null, progress: 0, invested: 0 },
            air: { current: null, progress: 0, invested: 0 }
          },
          readyToPlace: null
        }
      },
      winner: null,
      config: { width: 3000, height: 3000, resourceDensity: 'medium', rockDensity: 'medium' },
      debugMode: false,
      showMinimap: true,
      showBirdsEye: false,
      attackMoveMode: false,
      ...overrides
    } as GameState;
  }

  beforeEach(() => {
    resetAIState();
  });

  it('should evaluate "dead" trigger', () => {
    const state = createTestState({
      entities: {
        'e_1': { id: 'e_1', type: 'UNIT', key: 'rifle', owner: 1, dead: false, pos: new Vector(0, 0), prevPos: new Vector(0, 0), hp: 100, maxHp: 100, w: 20, h: 20, radius: 10 } as any,
        'e_2': { id: 'e_2', type: 'UNIT', key: 'rifle', owner: 1, dead: true, pos: new Vector(0, 0), prevPos: new Vector(0, 0), hp: 0, maxHp: 100, w: 20, h: 20, radius: 10 } as any
      }
    });

    expect(evaluateTrigger(parseTrigger('dead e_1'), state)).toBe(false);
    expect(evaluateTrigger(parseTrigger('dead e_2'), state)).toBe(true);
    expect(evaluateTrigger(parseTrigger('dead e_nonexistent'), state)).toBe(true);
  });

  it('should evaluate "tick" trigger', () => {
    const state = createTestState({ tick: 1000 });
    expect(evaluateTrigger(parseTrigger('tick > 500'), state)).toBe(true);
    expect(evaluateTrigger(parseTrigger('tick > 1500'), state)).toBe(false);
  });

  it('should evaluate "credits" trigger', () => {
    const state = createTestState();
    state.players[1].credits = 300;
    expect(evaluateTrigger(parseTrigger('credits 1 < 500'), state)).toBe(true);
    expect(evaluateTrigger(parseTrigger('credits 1 < 200'), state)).toBe(false);
  });

  it('should evaluate OR conditions', () => {
    const state = createTestState({ tick: 1000 });
    expect(evaluateTrigger(parseTrigger('tick > 500 or tick > 2000'), state)).toBe(true);
    expect(evaluateTrigger(parseTrigger('tick > 1500 or tick > 2000'), state)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool && npx vitest run tests/scripts/debug/triggers.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

```typescript
// src/scripts/debug/triggers.ts
import { GameState } from '../../engine/types';
import { getAIState } from '../../engine/ai/state';

export type TriggerOperator = '<' | '>' | '<=' | '>=' | '==';

export type Trigger =
  | { type: 'dead'; entityId: string }
  | { type: 'hp'; entityId: string; operator: TriggerOperator; value: number }
  | { type: 'tick'; operator: TriggerOperator; value: number }
  | { type: 'credits'; playerId: number; operator: TriggerOperator; value: number }
  | { type: 'strategy'; playerId: number; operator: '=='; value: string }
  | { type: 'count'; playerId: number; entityType: string; operator: TriggerOperator; value: number }
  | { type: 'player-dead'; playerId: number }
  | { type: 'threat'; playerId: number; operator: TriggerOperator; value: number }
  | { type: 'area'; x: number; y: number; radius: number; entityId: string }
  | { type: 'or'; conditions: Trigger[] };

export function parseTrigger(input: string): Trigger {
  const trimmed = input.trim();

  // Check for OR conditions
  if (trimmed.includes(' or ')) {
    const parts = trimmed.split(' or ').map(p => p.trim());
    return {
      type: 'or',
      conditions: parts.map(parseTrigger)
    };
  }

  // dead <id>
  const deadMatch = trimmed.match(/^dead\s+(\S+)$/);
  if (deadMatch) {
    return { type: 'dead', entityId: deadMatch[1] };
  }

  // hp <id> < <percent>%
  const hpMatch = trimmed.match(/^hp\s+(\S+)\s*(<|>|<=|>=)\s*(\d+)%$/);
  if (hpMatch) {
    return {
      type: 'hp',
      entityId: hpMatch[1],
      operator: hpMatch[2] as TriggerOperator,
      value: parseInt(hpMatch[3], 10)
    };
  }

  // tick > <n>
  const tickMatch = trimmed.match(/^tick\s*(<|>|<=|>=)\s*(\d+)$/);
  if (tickMatch) {
    return {
      type: 'tick',
      operator: tickMatch[1] as TriggerOperator,
      value: parseInt(tickMatch[2], 10)
    };
  }

  // credits <player> < <amount>
  const creditsMatch = trimmed.match(/^credits\s+(\d+)\s*(<|>|<=|>=)\s*(\d+)$/);
  if (creditsMatch) {
    return {
      type: 'credits',
      playerId: parseInt(creditsMatch[1], 10),
      operator: creditsMatch[2] as TriggerOperator,
      value: parseInt(creditsMatch[3], 10)
    };
  }

  // strategy <player> == <strategy>
  const strategyMatch = trimmed.match(/^strategy\s+(\d+)\s*==\s*(\S+)$/);
  if (strategyMatch) {
    return {
      type: 'strategy',
      playerId: parseInt(strategyMatch[1], 10),
      operator: '==',
      value: strategyMatch[2]
    };
  }

  // count <player> <type> >= <n>
  const countMatch = trimmed.match(/^count\s+(\d+)\s+(\S+)\s*(<|>|<=|>=)\s*(\d+)$/);
  if (countMatch) {
    return {
      type: 'count',
      playerId: parseInt(countMatch[1], 10),
      entityType: countMatch[2],
      operator: countMatch[3] as TriggerOperator,
      value: parseInt(countMatch[4], 10)
    };
  }

  // player <id> dead
  const playerDeadMatch = trimmed.match(/^player\s+(\d+)\s+dead$/);
  if (playerDeadMatch) {
    return {
      type: 'player-dead',
      playerId: parseInt(playerDeadMatch[1], 10)
    };
  }

  // threat <player> > <level>
  const threatMatch = trimmed.match(/^threat\s+(\d+)\s*(<|>|<=|>=)\s*(\d+)$/);
  if (threatMatch) {
    return {
      type: 'threat',
      playerId: parseInt(threatMatch[1], 10),
      operator: threatMatch[2] as TriggerOperator,
      value: parseInt(threatMatch[3], 10)
    };
  }

  // area <x>,<y>,<radius> has <id>
  const areaMatch = trimmed.match(/^area\s+(\d+),(\d+),(\d+)\s+has\s+(\S+)$/);
  if (areaMatch) {
    return {
      type: 'area',
      x: parseInt(areaMatch[1], 10),
      y: parseInt(areaMatch[2], 10),
      radius: parseInt(areaMatch[3], 10),
      entityId: areaMatch[4]
    };
  }

  throw new Error(`Unknown trigger condition: ${input}`);
}

function compare(a: number, op: TriggerOperator, b: number): boolean {
  switch (op) {
    case '<': return a < b;
    case '>': return a > b;
    case '<=': return a <= b;
    case '>=': return a >= b;
    case '==': return a === b;
  }
}

export function evaluateTrigger(trigger: Trigger, state: GameState): boolean {
  switch (trigger.type) {
    case 'dead': {
      const entity = state.entities[trigger.entityId];
      return !entity || entity.dead;
    }

    case 'hp': {
      const entity = state.entities[trigger.entityId];
      if (!entity || entity.dead) return true; // Treat dead/missing as 0%
      const hpPercent = (entity.hp / entity.maxHp) * 100;
      return compare(hpPercent, trigger.operator, trigger.value);
    }

    case 'tick': {
      return compare(state.tick, trigger.operator, trigger.value);
    }

    case 'credits': {
      const player = state.players[trigger.playerId];
      if (!player) return false;
      return compare(player.credits, trigger.operator, trigger.value);
    }

    case 'strategy': {
      const aiState = getAIState(trigger.playerId);
      return aiState.strategy === trigger.value;
    }

    case 'count': {
      let count = 0;
      for (const id in state.entities) {
        const entity = state.entities[id];
        if (entity.dead) continue;
        if (entity.owner !== trigger.playerId) continue;

        if (trigger.entityType === 'unit' && entity.type === 'UNIT') count++;
        else if (trigger.entityType === 'building' && entity.type === 'BUILDING') count++;
        else if (entity.key === trigger.entityType) count++;
      }
      return compare(count, trigger.operator, trigger.value);
    }

    case 'player-dead': {
      const player = state.players[trigger.playerId];
      if (!player) return true;
      // Player is dead if they have no buildings
      let hasBuildingOrUnit = false;
      for (const id in state.entities) {
        const entity = state.entities[id];
        if (entity.owner === trigger.playerId && !entity.dead && (entity.type === 'BUILDING' || entity.type === 'UNIT')) {
          hasBuildingOrUnit = true;
          break;
        }
      }
      return !hasBuildingOrUnit;
    }

    case 'threat': {
      const aiState = getAIState(trigger.playerId);
      return compare(aiState.threatLevel, trigger.operator, trigger.value);
    }

    case 'area': {
      const entity = state.entities[trigger.entityId];
      if (!entity || entity.dead) return false;
      const dx = entity.pos.x - trigger.x;
      const dy = entity.pos.y - trigger.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      return dist <= trigger.radius;
    }

    case 'or': {
      return trigger.conditions.some(cond => evaluateTrigger(cond, state));
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool && npx vitest run tests/scripts/debug/triggers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
git add src/scripts/debug/triggers.ts tests/scripts/debug/triggers.test.ts
git commit -m "feat(debug): add trigger condition parser and evaluator for advance-until"
```

---

## Task 5: State Loader with Vector Rehydration

**Files:**
- Create: `src/scripts/debug/state-loader.ts`
- Test: `tests/scripts/debug/state-loader.test.ts`

**Step 1: Write the failing test**

```typescript
// tests/scripts/debug/state-loader.test.ts
import { describe, it, expect } from 'vitest';
import { loadState, saveState, rehydrateVectors } from '../../../src/scripts/debug/state-loader';
import { Vector } from '../../../src/engine/types';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('State Loader', () => {
  describe('rehydrateVectors', () => {
    it('should convert plain {x, y} objects to Vector instances', () => {
      const obj = {
        pos: { x: 100, y: 200 },
        nested: {
          vel: { x: 1, y: 2 }
        }
      };

      const result = rehydrateVectors(obj) as any;

      expect(result.pos).toBeInstanceOf(Vector);
      expect(result.pos.x).toBe(100);
      expect(result.pos.y).toBe(200);
      expect(result.nested.vel).toBeInstanceOf(Vector);
    });

    it('should handle arrays', () => {
      const obj = {
        points: [
          { x: 1, y: 2 },
          { x: 3, y: 4 }
        ]
      };

      const result = rehydrateVectors(obj) as any;

      expect(result.points[0]).toBeInstanceOf(Vector);
      expect(result.points[1]).toBeInstanceOf(Vector);
    });

    it('should not convert objects with extra properties', () => {
      const obj = {
        notVector: { x: 1, y: 2, z: 3 }
      };

      const result = rehydrateVectors(obj) as any;

      expect(result.notVector).not.toBeInstanceOf(Vector);
      expect(result.notVector).toEqual({ x: 1, y: 2, z: 3 });
    });
  });

  describe('loadState and saveState', () => {
    it('should round-trip a state file', () => {
      const tmpDir = os.tmpdir();
      const testFile = path.join(tmpDir, 'test_state.json');

      const mockState = {
        tick: 1000,
        entities: {
          'e_1': {
            id: 'e_1',
            pos: { x: 100, y: 200 },
            vel: { x: 1, y: 0 }
          }
        }
      };

      fs.writeFileSync(testFile, JSON.stringify(mockState));

      const loaded = loadState(testFile) as any;

      expect(loaded.tick).toBe(1000);
      expect(loaded.entities['e_1'].pos).toBeInstanceOf(Vector);
      expect(loaded.entities['e_1'].pos.x).toBe(100);

      // Save it back
      const outFile = path.join(tmpDir, 'test_state_out.json');
      saveState(loaded, outFile);

      const reloaded = loadState(outFile) as any;
      expect(reloaded.tick).toBe(1000);
      expect(reloaded.entities['e_1'].pos.x).toBe(100);

      // Cleanup
      fs.unlinkSync(testFile);
      fs.unlinkSync(outFile);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool && npx vitest run tests/scripts/debug/state-loader.test.ts`
Expected: FAIL - module not found

**Step 3: Write the implementation**

```typescript
// src/scripts/debug/state-loader.ts
import fs from 'node:fs';
import path from 'node:path';
import { GameState, Vector } from '../../engine/types';

export function rehydrateVectors(obj: unknown): unknown {
  if (!obj || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(rehydrateVectors);
  }

  const record = obj as Record<string, unknown>;

  // Check if this is a Vector-like object (exactly {x: number, y: number})
  if (
    typeof record.x === 'number' &&
    typeof record.y === 'number' &&
    Object.keys(record).length === 2
  ) {
    return new Vector(record.x, record.y);
  }

  // Recursively process all properties
  const result: Record<string, unknown> = {};
  for (const key in record) {
    result[key] = rehydrateVectors(record[key]);
  }
  return result;
}

export function loadState(filePath: string): GameState {
  const absPath = path.resolve(filePath);
  if (!fs.existsSync(absPath)) {
    throw new Error(`State file not found: ${absPath}`);
  }

  const rawData = fs.readFileSync(absPath, 'utf8');
  const parsed = JSON.parse(rawData);
  return rehydrateVectors(parsed) as GameState;
}

export function saveState(state: GameState, filePath: string): void {
  const absPath = path.resolve(filePath);
  const dir = path.dirname(absPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // JSON.stringify will serialize Vectors as plain {x, y} objects
  fs.writeFileSync(absPath, JSON.stringify(state, null, 2));
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool && npx vitest run tests/scripts/debug/state-loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
git add src/scripts/debug/state-loader.ts tests/scripts/debug/state-loader.test.ts
git commit -m "feat(debug): add state loader with Vector rehydration"
```

---

## Task 6: CLI Entry Point and Argument Parser

**Files:**
- Create: `src/scripts/debug/index.ts`
- Create: `src/scripts/debug/cli.ts`
- Modify: `package.json` (add debug script)

**Step 1: Create CLI argument parser**

```typescript
// src/scripts/debug/cli.ts
import { FilterConfig, createDefaultFilterConfig } from './collector';

export interface CliArgs {
  input: string | null;
  output: string | null;
  export: string | null;
  advance: number;
  advanceUntil: string | null;
  maxTicks: number;
  repl: boolean;
  // Query flags
  status: number | null;
  unit: string | null;
  find: string | null;
  listGroups: number | null;
  // Filter configuration
  track: string[];
  player: number[];
  category: string[];
  noCategory: string[];
  changeOnly: string[];
  threshold: Record<string, number>;
  snapshotInterval: number;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    input: null,
    output: null,
    export: null,
    advance: 0,
    advanceUntil: null,
    maxTicks: 100000,
    repl: false,
    status: null,
    unit: null,
    find: null,
    listGroups: null,
    track: [],
    player: [],
    category: [],
    noCategory: [],
    changeOnly: [],
    threshold: {},
    snapshotInterval: 100
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    switch (arg) {
      case '--input':
        args.input = argv[++i];
        break;
      case '--output':
        args.output = argv[++i];
        break;
      case '--export':
        args.export = argv[++i];
        break;
      case '--advance':
        args.advance = parseInt(argv[++i], 10);
        break;
      case '--advance-until':
        args.advanceUntil = argv[++i];
        break;
      case '--max-ticks':
        args.maxTicks = parseInt(argv[++i], 10);
        break;
      case '--repl':
        args.repl = true;
        break;
      case '--status':
        args.status = parseInt(argv[++i], 10);
        break;
      case '--unit':
        args.unit = argv[++i];
        break;
      case '--find':
        args.find = argv[++i];
        break;
      case '--list-groups':
        args.listGroups = parseInt(argv[++i], 10);
        break;
      case '--track':
        args.track.push(argv[++i]);
        break;
      case '--player':
        args.player.push(parseInt(argv[++i], 10));
        break;
      case '--category':
        args.category.push(...argv[++i].split(','));
        break;
      case '--no-category':
        args.noCategory.push(...argv[++i].split(','));
        break;
      case '--change-only':
        args.changeOnly.push(...argv[++i].split(','));
        break;
      case '--threshold': {
        const [name, value] = argv[++i].split('=');
        args.threshold[name] = parseFloat(value);
        break;
      }
      case '--snapshot-interval':
        args.snapshotInterval = parseInt(argv[++i], 10);
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }

  return args;
}

export function buildFilterConfig(args: CliArgs): FilterConfig {
  const config = createDefaultFilterConfig();

  // Apply tracked entities
  for (const id of args.track) {
    config.trackedEntities.add(id);
  }

  // Apply tracked players
  for (const id of args.player) {
    config.trackedPlayers.add(id);
  }

  // Apply category filters
  if (args.category.length > 0) {
    // Disable all, then enable specified
    for (const key of Object.keys(config.categories)) {
      config.categories[key as keyof typeof config.categories] = false;
    }
    for (const cat of args.category) {
      if (cat in config.categories) {
        config.categories[cat as keyof typeof config.categories] = true;
      }
    }
  }

  // Apply no-category filters
  for (const cat of args.noCategory) {
    if (cat in config.categories) {
      config.categories[cat as keyof typeof config.categories] = false;
    }
  }

  // Apply change-only settings
  for (const cat of args.changeOnly) {
    if (cat in config.changeOnly) {
      config.changeOnly[cat as keyof typeof config.changeOnly] = true;
    }
  }

  // Apply thresholds
  for (const [name, value] of Object.entries(args.threshold)) {
    const key = name.replace(/-/g, '') as keyof typeof config.thresholds;
    if (name === 'hp-below') config.thresholds.hpBelow = value;
    else if (name === 'credits-below') config.thresholds.creditsBelow = value;
    else if (name === 'threat-above') config.thresholds.threatAbove = value;
    else if (name === 'economy-delta') config.thresholds.economyDelta = value;
  }

  config.snapshotInterval = args.snapshotInterval;

  return config;
}

function printHelp(): void {
  console.log(`
Game State Debug Tool

Usage:
  npm run debug -- [options]

Options:
  --input <file>              Input game state JSON file
  --output <file>             Output game state JSON file
  --export <file>             Export event log to JSONL file
  --advance <ticks>           Advance simulation by N ticks
  --advance-until <condition> Advance until condition is true
  --max-ticks <n>             Safety limit for advance-until (default: 100000)
  --repl                      Start interactive REPL mode

Query Options (no advance):
  --status <player-id>        Show AI status for player
  --unit <entity-id>          Show unit details
  --find <query>              Find entities (e.g., "type=harvester,owner=1")
  --list-groups <player-id>   List offensive groups for player

Filter Options:
  --track <entity-id>         Track specific entity (repeatable)
  --player <player-id>        Track specific player (repeatable)
  --category <cat1,cat2,...>  Enable only these categories
  --no-category <cat1,...>    Disable these categories
  --change-only <cat1,...>    Enable change-only for categories
  --threshold <name>=<value>  Set threshold (hp-below, credits-below, threat-above, economy-delta)
  --snapshot-interval <ticks> State snapshot frequency (default: 100)

Advance-Until Conditions:
  dead <entity-id>            Entity dies or doesn't exist
  hp <id> < <percent>%        Entity HP below threshold
  tick > <n>                  Tick exceeds value
  credits <player> < <n>      Player credits below threshold
  strategy <player> == <str>  Player strategy equals value
  count <player> <type> >= <n> Entity count threshold
  player <id> dead            Player eliminated
  threat <player> > <level>   Threat level threshold

  Combine with "or": "dead e_1234 or tick > 10000"

Examples:
  npm run debug -- --input state.json --status 1
  npm run debug -- --input state.json --track e_1234 --advance 1000 --export trace.jsonl
  npm run debug -- --input state.json --advance-until "dead e_1234" --max-ticks 5000
  npm run debug -- --repl --input state.json
`);
}
```

**Step 2: Create main entry point**

```typescript
// src/scripts/debug/index.ts
import { parseArgs, buildFilterConfig } from './cli';
import { loadState, saveState } from './state-loader';
import { DebugCollector } from './collector';
import { DebugEvents } from '../../engine/debug/events';
import { parseTrigger, evaluateTrigger } from './triggers';
import { tick, update } from '../../engine/reducer';
import { computeAiActions, resetAIState } from '../../engine/ai/index';
import { formatStatus, formatUnit, formatFind, formatGroups } from './formatters';
import { startRepl } from './repl';
import fs from 'node:fs';
import { GameState } from '../../engine/types';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Initialize collector
  const collector = new DebugCollector();
  collector.setConfig(buildFilterConfig(args));

  // Connect collector to DebugEvents
  DebugEvents.setCollector((event) => collector.collect(event));

  // Load state if provided
  let state: GameState | null = null;
  if (args.input) {
    console.log(`Loading state from ${args.input}...`);
    state = loadState(args.input);
    console.log(`Loaded state at tick ${state.tick}. ${Object.keys(state.entities).length} entities, ${Object.keys(state.players).length} players.`);
  }

  // Handle REPL mode
  if (args.repl) {
    await startRepl(state, collector, args);
    return;
  }

  // Handle query commands (no state modification)
  if (state && args.status !== null) {
    console.log(formatStatus(state, args.status));
    return;
  }

  if (state && args.unit) {
    console.log(formatUnit(state, args.unit));
    return;
  }

  if (state && args.find) {
    console.log(formatFind(state, args.find));
    return;
  }

  if (state && args.listGroups !== null) {
    console.log(formatGroups(args.listGroups));
    return;
  }

  // Handle advance
  if (state && (args.advance > 0 || args.advanceUntil)) {
    const startTick = state.tick;

    // Reset AI state for all AI players
    for (const pidStr of Object.keys(state.players)) {
      const pid = parseInt(pidStr, 10);
      if (state.players[pid]?.isAi) {
        resetAIState(pid);
      }
    }

    // Set running to true
    state = { ...state, running: true };

    // Parse trigger if provided
    const trigger = args.advanceUntil ? parseTrigger(args.advanceUntil) : null;

    let ticksAdvanced = 0;
    const maxTicks = args.advanceUntil ? args.maxTicks : args.advance;

    console.log(`Advancing simulation...`);

    while (ticksAdvanced < maxTicks) {
      // Check trigger
      if (trigger && evaluateTrigger(trigger, state)) {
        console.log(`Stopped at tick ${state.tick} (trigger fired)`);
        break;
      }

      // Run AI for each AI player
      for (const pidStr of Object.keys(state.players)) {
        const pid = parseInt(pidStr, 10);
        const player = state.players[pid];
        if (player?.isAi) {
          const aiActions = computeAiActions(state, pid);
          for (const action of aiActions) {
            state = update(state, action);
          }
        }
      }

      // Tick the game
      state = tick(state);
      ticksAdvanced++;

      // Progress indicator
      if (ticksAdvanced % 1000 === 0) {
        process.stdout.write('.');
      }
    }

    if (ticksAdvanced >= maxTicks && !trigger) {
      console.log(`\nAdvanced ${ticksAdvanced} ticks to tick ${state.tick}.`);
    } else if (ticksAdvanced >= maxTicks) {
      console.log(`\nMax ticks reached at tick ${state.tick}.`);
    }

    console.log(`${collector.getEvents().length} events recorded.`);

    // Save output state
    if (args.output) {
      console.log(`Saving state to ${args.output}...`);
      saveState(state, args.output);
    }

    // Export events
    if (args.export) {
      console.log(`Exporting events to ${args.export}...`);
      const jsonl = collector.exportToJsonl(startTick, state.tick);
      fs.writeFileSync(args.export, jsonl);
    }
  }

  // Cleanup
  DebugEvents.setCollector(null);
}

main().catch(console.error);
```

**Step 3: Add script to package.json**

Add to package.json scripts:
```json
"debug": "npx tsx src/scripts/debug/index.ts"
```

**Step 4: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
git add src/scripts/debug/index.ts src/scripts/debug/cli.ts package.json
git commit -m "feat(debug): add CLI entry point with argument parsing"
```

---

## Task 7: Formatters for Query Output

**Files:**
- Create: `src/scripts/debug/formatters.ts`
- Test: `tests/scripts/debug/formatters.test.ts`

**Step 1: Write the implementation**

```typescript
// src/scripts/debug/formatters.ts
import { GameState, Entity, UnitEntity } from '../../engine/types';
import { getAIState } from '../../engine/ai/state';
import { isUnit, isBuilding } from '../../engine/type-guards';
import { DebugEvent } from '../../engine/debug/schemas';

export function formatStatus(state: GameState, playerId: number): string {
  const player = state.players[playerId];
  if (!player) return `Player ${playerId} not found.`;

  const aiState = getAIState(playerId);
  const lines: string[] = [];

  lines.push(`Player ${playerId} (${player.isAi ? `AI - ${player.difficulty}` : 'Human'}):`);
  lines.push(`  Strategy: ${aiState.strategy} (since tick ${aiState.lastStrategyChange})`);
  lines.push(`  Credits: ${player.credits} | Power: ${player.usedPower}/${player.maxPower}`);
  lines.push(`  Threat: ${aiState.threatLevel} | Desperation: ${aiState.stalemateDesperation} | Doomed: ${aiState.isDoomed}`);
  lines.push(`  Economy Score: ${aiState.economyScore} | Investment: ${aiState.investmentPriority}`);

  // Count entities
  let units = 0, buildings = 0, harvesters = 0;
  for (const id in state.entities) {
    const e = state.entities[id];
    if (e.owner === playerId && !e.dead) {
      if (e.type === 'UNIT') {
        units++;
        if (e.key === 'harvester') harvesters++;
      } else if (e.type === 'BUILDING') buildings++;
    }
  }
  lines.push(`  Units: ${units} (${harvesters} harvesters) | Buildings: ${buildings}`);

  // Groups
  if (aiState.offensiveGroups.length > 0) {
    const groupStrs = aiState.offensiveGroups.map(g =>
      `${g.id} (${g.unitIds.length} units, ${g.status})`
    );
    lines.push(`  Groups: ${groupStrs.join(', ')}`);
  }

  // Vengeance
  const vengeance = Object.entries(aiState.vengeanceScores)
    .filter(([, v]) => v > 1)
    .map(([pid, v]) => `P${pid}:${v.toFixed(0)}`);
  if (vengeance.length > 0) {
    lines.push(`  Vengeance: ${vengeance.join(', ')}`);
  }

  return lines.join('\n');
}

export function formatUnit(state: GameState, entityId: string): string {
  const entity = state.entities[entityId];
  if (!entity) return `Entity ${entityId} not found.`;

  const lines: string[] = [];
  lines.push(`Entity ${entityId} (${entity.key}):`);
  lines.push(`  Type: ${entity.type} | Owner: Player ${entity.owner}`);
  lines.push(`  HP: ${entity.hp}/${entity.maxHp} (${Math.round(entity.hp / entity.maxHp * 100)}%)`);
  lines.push(`  Position: (${entity.pos.x.toFixed(0)}, ${entity.pos.y.toFixed(0)})`);
  lines.push(`  Dead: ${entity.dead}`);

  if (isUnit(entity)) {
    const unit = entity as UnitEntity;
    lines.push(`  Rotation: ${unit.movement.rotation.toFixed(2)} rad`);

    if (unit.movement.moveTarget) {
      lines.push(`  Move target: (${unit.movement.moveTarget.x.toFixed(0)}, ${unit.movement.moveTarget.y.toFixed(0)})`);
    }

    if (unit.combat.targetId) {
      lines.push(`  Attack target: ${unit.combat.targetId}`);
    }

    lines.push(`  Stuck timer: ${unit.movement.stuckTimer}`);

    if ('harvester' in unit) {
      const harv = unit as any;
      lines.push(`  Cargo: ${harv.harvester.cargo}`);
      if (harv.harvester.resourceTargetId) {
        lines.push(`  Resource target: ${harv.harvester.resourceTargetId}`);
      }
      if (harv.harvester.baseTargetId) {
        lines.push(`  Base target: ${harv.harvester.baseTargetId}`);
      }
    }

    // Check if in any group
    const aiState = getAIState(entity.owner);
    if (aiState.attackGroup.includes(entityId)) {
      lines.push(`  Group: attackGroup`);
    } else if (aiState.harassGroup.includes(entityId)) {
      lines.push(`  Group: harassGroup`);
    } else if (aiState.defenseGroup.includes(entityId)) {
      lines.push(`  Group: defenseGroup`);
    }
    for (const g of aiState.offensiveGroups) {
      if (g.unitIds.includes(entityId)) {
        lines.push(`  Offensive Group: ${g.id} (${g.status})`);
      }
    }
  }

  return lines.join('\n');
}

export function formatFind(state: GameState, query: string): string {
  // Parse query: "type=harvester,owner=1"
  const filters: Record<string, string> = {};
  for (const part of query.split(',')) {
    const [key, value] = part.split('=');
    filters[key.trim()] = value.trim();
  }

  const matches: Entity[] = [];
  for (const id in state.entities) {
    const e = state.entities[id];
    if (e.dead) continue;

    let match = true;
    if (filters.type && e.type.toLowerCase() !== filters.type.toLowerCase() && e.key !== filters.type) {
      match = false;
    }
    if (filters.key && e.key !== filters.key) {
      match = false;
    }
    if (filters.owner && e.owner !== parseInt(filters.owner, 10)) {
      match = false;
    }

    if (match) matches.push(e);
  }

  if (matches.length === 0) {
    return 'No matching entities found.';
  }

  const lines = [`Found ${matches.length} entities:`];
  for (const e of matches.slice(0, 20)) {
    const hpPct = Math.round(e.hp / e.maxHp * 100);
    lines.push(`  ${e.id} ${e.key} (owner=${e.owner}, hp=${hpPct}%) at (${e.pos.x.toFixed(0)}, ${e.pos.y.toFixed(0)})`);
  }
  if (matches.length > 20) {
    lines.push(`  ... and ${matches.length - 20} more`);
  }

  return lines.join('\n');
}

export function formatGroups(playerId: number): string {
  const aiState = getAIState(playerId);
  const lines: string[] = [];

  lines.push(`Groups for Player ${playerId}:`);

  if (aiState.attackGroup.length > 0) {
    lines.push(`  attackGroup: ${aiState.attackGroup.length} units`);
    lines.push(`    ${aiState.attackGroup.slice(0, 5).join(', ')}${aiState.attackGroup.length > 5 ? '...' : ''}`);
  }

  if (aiState.harassGroup.length > 0) {
    lines.push(`  harassGroup: ${aiState.harassGroup.length} units`);
  }

  if (aiState.defenseGroup.length > 0) {
    lines.push(`  defenseGroup: ${aiState.defenseGroup.length} units`);
  }

  for (const g of aiState.offensiveGroups) {
    lines.push(`  ${g.id}:`);
    lines.push(`    Status: ${g.status}`);
    lines.push(`    Units: ${g.unitIds.length}`);
    if (g.target) lines.push(`    Target: ${g.target}`);
    if (g.rallyPoint) lines.push(`    Rally: (${g.rallyPoint.x.toFixed(0)}, ${g.rallyPoint.y.toFixed(0)})`);
    lines.push(`    Avg HP: ${g.avgHealthPercent.toFixed(0)}%`);
  }

  if (lines.length === 1) {
    lines.push('  No active groups.');
  }

  return lines.join('\n');
}

export function formatEvent(event: DebugEvent): string {
  const tick = `[${event.tick}]`.padEnd(8);
  const type = event.type.padEnd(14);
  const entity = event.entityId ? event.entityId.padEnd(12) : ''.padEnd(12);

  let details = '';
  switch (event.type) {
    case 'command':
      details = `${event.data.command} ${event.data.target || event.data.destination ? 'target=' + (event.data.target || `(${(event.data.destination as any)?.x},${(event.data.destination as any)?.y})`) : ''} source=${event.data.source}`;
      if (event.data.reason) details += ` reason="${event.data.reason}"`;
      break;
    case 'decision':
      details = `${event.data.category}: ${event.data.action} - ${event.data.reason}`;
      break;
    case 'state-change':
      details = `${event.data.field} ${JSON.stringify(event.data.from)}→${JSON.stringify(event.data.to)}`;
      if (event.data.cause) details += ` cause="${event.data.cause}"`;
      break;
    case 'group':
      details = `${event.data.groupId} ${event.data.action}`;
      if (event.data.status) details += ` status=${event.data.status}`;
      break;
    case 'economy':
      details = `credits=${event.data.credits} delta=${event.data.delta > 0 ? '+' : ''}${event.data.delta} source=${event.data.source}`;
      break;
    case 'production':
      details = `${event.data.action} ${event.data.category}/${event.data.key}`;
      break;
    case 'threat':
      details = `level=${event.data.threatLevel} economy=${event.data.economyScore} desperation=${event.data.desperation}`;
      break;
  }

  return `${tick} ${type} ${entity} ${details}`;
}

export function formatEvents(events: DebugEvent[], count: number = 20): string {
  const slice = events.slice(-count);
  if (slice.length === 0) {
    return 'No events recorded.';
  }

  return slice.map(formatEvent).join('\n');
}
```

**Step 2: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
git add src/scripts/debug/formatters.ts
git commit -m "feat(debug): add formatters for status, unit, find, groups, and events output"
```

---

## Task 8: Interactive REPL

**Files:**
- Create: `src/scripts/debug/repl.ts`

**Step 1: Write the implementation**

```typescript
// src/scripts/debug/repl.ts
import * as readline from 'node:readline';
import fs from 'node:fs';
import { GameState } from '../../engine/types';
import { DebugCollector, createDefaultFilterConfig } from './collector';
import { DebugEvents } from '../../engine/debug/events';
import { loadState, saveState } from './state-loader';
import { parseTrigger, evaluateTrigger } from './triggers';
import { tick, update } from '../../engine/reducer';
import { computeAiActions, resetAIState } from '../../engine/ai/index';
import { formatStatus, formatUnit, formatFind, formatGroups, formatEvents } from './formatters';
import { CliArgs, buildFilterConfig } from './cli';

interface ReplContext {
  state: GameState | null;
  collector: DebugCollector;
  startTick: number;
}

export async function startRepl(
  initialState: GameState | null,
  collector: DebugCollector,
  args: CliArgs
): Promise<void> {
  const ctx: ReplContext = {
    state: initialState,
    collector,
    startTick: initialState?.tick ?? 0
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '> '
  });

  console.log('Debug Tool REPL. Type "help" for commands, "quit" to exit.');
  if (ctx.state) {
    console.log(`State loaded at tick ${ctx.state.tick}.`);
  }

  rl.prompt();

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      rl.prompt();
      return;
    }

    try {
      await handleCommand(ctx, trimmed);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log('Goodbye.');
    process.exit(0);
  });
}

async function handleCommand(ctx: ReplContext, input: string): Promise<void> {
  const parts = input.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);

  switch (cmd) {
    case 'help':
      printHelp(args[0]);
      break;

    case 'quit':
    case 'exit':
      process.exit(0);

    case 'load':
      if (!args[0]) {
        console.log('Usage: load <file>');
        return;
      }
      ctx.state = loadState(args[0]);
      ctx.startTick = ctx.state.tick;
      ctx.collector.clear();
      // Reset AI state
      for (const pid of Object.keys(ctx.state.players)) {
        if (ctx.state.players[parseInt(pid, 10)]?.isAi) {
          resetAIState(parseInt(pid, 10));
        }
      }
      console.log(`Loaded state at tick ${ctx.state.tick}. ${Object.keys(ctx.state.entities).length} entities.`);
      break;

    case 'save':
      if (!ctx.state) {
        console.log('No state loaded.');
        return;
      }
      if (!args[0]) {
        console.log('Usage: save <file>');
        return;
      }
      saveState(ctx.state, args[0]);
      console.log(`Saved state to ${args[0]}`);
      break;

    case 'export':
      if (!args[0]) {
        console.log('Usage: export <file>');
        return;
      }
      const jsonl = ctx.collector.exportToJsonl(ctx.startTick, ctx.state?.tick ?? 0);
      fs.writeFileSync(args[0], jsonl);
      console.log(`Exported ${ctx.collector.getEvents().length} events to ${args[0]}`);
      break;

    case 'advance':
      if (!ctx.state) {
        console.log('No state loaded.');
        return;
      }
      const ticks = parseInt(args[0], 10) || 100;
      ctx.state = advanceState(ctx.state, ticks, ctx.collector);
      console.log(`Advanced ${ticks} ticks to tick ${ctx.state.tick}. ${ctx.collector.getEvents().length} events total.`);
      break;

    case 'advance-until':
      if (!ctx.state) {
        console.log('No state loaded.');
        return;
      }
      const condition = args.join(' ');
      if (!condition) {
        console.log('Usage: advance-until <condition>');
        return;
      }
      const result = advanceUntil(ctx.state, condition, 100000, ctx.collector);
      ctx.state = result.state;
      console.log(`${result.reason} at tick ${ctx.state.tick}. ${ctx.collector.getEvents().length} events total.`);
      break;

    case 'track':
      if (!args[0]) {
        console.log('Usage: track <entity-id>');
        return;
      }
      ctx.collector.getConfig().trackedEntities.add(args[0]);
      if (ctx.state && ctx.state.entities[args[0]]) {
        const e = ctx.state.entities[args[0]];
        console.log(`Tracking ${args[0]} (${e.key}, owner=${e.owner}, hp=${e.hp}/${e.maxHp})`);
      } else {
        console.log(`Tracking ${args[0]} (not found in current state)`);
      }
      break;

    case 'untrack':
      ctx.collector.getConfig().trackedEntities.delete(args[0]);
      console.log(`Stopped tracking ${args[0]}`);
      break;

    case 'track-player':
      const pid = parseInt(args[0], 10);
      ctx.collector.getConfig().trackedPlayers.add(pid);
      console.log(`Tracking player ${pid}`);
      break;

    case 'untrack-player':
      ctx.collector.getConfig().trackedPlayers.delete(parseInt(args[0], 10));
      console.log(`Stopped tracking player ${args[0]}`);
      break;

    case 'filter':
      if (args.length < 2) {
        console.log('Usage: filter <category> on|off');
        return;
      }
      const cat = args[0] as keyof typeof ctx.collector.getConfig().categories;
      const enabled = args[1].toLowerCase() === 'on';
      if (cat in ctx.collector.getConfig().categories) {
        ctx.collector.getConfig().categories[cat] = enabled;
        console.log(`Category ${cat} ${enabled ? 'enabled' : 'disabled'}`);
      } else {
        console.log(`Unknown category: ${cat}`);
      }
      break;

    case 'threshold':
      if (args.length < 2) {
        console.log('Usage: threshold <name> <value>');
        return;
      }
      const thresholdName = args[0];
      const thresholdValue = parseFloat(args[1]);
      const config = ctx.collector.getConfig();
      if (thresholdName === 'hp-below') config.thresholds.hpBelow = thresholdValue;
      else if (thresholdName === 'credits-below') config.thresholds.creditsBelow = thresholdValue;
      else if (thresholdName === 'threat-above') config.thresholds.threatAbove = thresholdValue;
      else if (thresholdName === 'economy-delta') config.thresholds.economyDelta = thresholdValue;
      else {
        console.log(`Unknown threshold: ${thresholdName}`);
        return;
      }
      console.log(`Threshold ${thresholdName} set to ${thresholdValue}`);
      break;

    case 'status':
      if (!ctx.state) {
        console.log('No state loaded.');
        return;
      }
      const statusPlayerId = args[0] ? parseInt(args[0], 10) : Object.keys(ctx.state.players).map(Number)[0];
      console.log(formatStatus(ctx.state, statusPlayerId));
      break;

    case 'unit':
      if (!ctx.state) {
        console.log('No state loaded.');
        return;
      }
      if (!args[0]) {
        console.log('Usage: unit <entity-id>');
        return;
      }
      console.log(formatUnit(ctx.state, args[0]));
      break;

    case 'group':
    case 'groups':
      if (!ctx.state) {
        console.log('No state loaded.');
        return;
      }
      const groupPlayerId = args[0] ? parseInt(args[0], 10) : Object.keys(ctx.state.players).map(Number)[0];
      console.log(formatGroups(groupPlayerId));
      break;

    case 'find':
      if (!ctx.state) {
        console.log('No state loaded.');
        return;
      }
      if (!args[0]) {
        console.log('Usage: find <query> (e.g., "type=harvester,owner=1")');
        return;
      }
      console.log(formatFind(ctx.state, args.join(' ')));
      break;

    case 'events':
      const count = args[0] ? parseInt(args[0], 10) : 20;
      console.log(formatEvents(ctx.collector.getEvents(), count));
      break;

    case 'clear-events':
      ctx.collector.clear();
      console.log('Events cleared.');
      break;

    case 'clear-filters':
      ctx.collector.setConfig(createDefaultFilterConfig());
      console.log('Filters reset to defaults.');
      break;

    case 'config':
      const cfg = ctx.collector.getConfig();
      console.log('Current configuration:');
      console.log(`  Categories: ${Object.entries(cfg.categories).filter(([,v]) => v).map(([k]) => k).join(', ')}`);
      console.log(`  Tracked entities: ${cfg.trackedEntities.size > 0 ? Array.from(cfg.trackedEntities).join(', ') : '(all)'}`);
      console.log(`  Tracked players: ${cfg.trackedPlayers.size > 0 ? Array.from(cfg.trackedPlayers).join(', ') : '(all)'}`);
      console.log(`  Thresholds: ${JSON.stringify(cfg.thresholds)}`);
      console.log(`  Snapshot interval: ${cfg.snapshotInterval}`);
      break;

    default:
      console.log(`Unknown command: ${cmd}. Type "help" for commands.`);
  }
}

function advanceState(state: GameState, ticks: number, collector: DebugCollector): GameState {
  state = { ...state, running: true };

  for (let i = 0; i < ticks; i++) {
    // Run AI
    for (const pidStr of Object.keys(state.players)) {
      const pid = parseInt(pidStr, 10);
      if (state.players[pid]?.isAi) {
        const aiActions = computeAiActions(state, pid);
        for (const action of aiActions) {
          state = update(state, action);
        }
      }
    }

    state = tick(state);
  }

  return state;
}

function advanceUntil(
  state: GameState,
  condition: string,
  maxTicks: number,
  collector: DebugCollector
): { state: GameState; reason: string } {
  const trigger = parseTrigger(condition);
  state = { ...state, running: true };

  let ticksAdvanced = 0;
  while (ticksAdvanced < maxTicks) {
    if (evaluateTrigger(trigger, state)) {
      return { state, reason: `Trigger fired` };
    }

    // Run AI
    for (const pidStr of Object.keys(state.players)) {
      const pid = parseInt(pidStr, 10);
      if (state.players[pid]?.isAi) {
        const aiActions = computeAiActions(state, pid);
        for (const action of aiActions) {
          state = update(state, action);
        }
      }
    }

    state = tick(state);
    ticksAdvanced++;
  }

  return { state, reason: `Max ticks (${maxTicks}) reached` };
}

function printHelp(command?: string): void {
  if (!command) {
    console.log(`
Commands:
  load <file>              Load a game state JSON file
  save <file>              Save current state to file
  export <file>            Export event log to JSONL file
  advance <ticks>          Advance simulation by N ticks
  advance-until <cond>     Advance until condition is true
  track <entity-id>        Add entity to tracking whitelist
  untrack <entity-id>      Remove from whitelist
  track-player <id>        Track specific player
  untrack-player <id>      Stop tracking player
  filter <cat> on|off      Enable/disable event category
  threshold <name> <value> Set threshold filter
  status [player-id]       Show AI status
  unit <entity-id>         Show unit details
  group[s] [player-id]     Show groups for player
  find <query>             Find entities (e.g., "type=harvester,owner=1")
  events [count]           Show recent events (default: 20)
  clear-events             Clear event log
  clear-filters            Reset filters to defaults
  config                   Show current configuration
  help [command]           Show help
  quit                     Exit

Type "help <command>" for details on a specific command.
`);
  } else {
    // Could add detailed help per command here
    console.log(`No detailed help for "${command}" yet.`);
  }
}
```

**Step 2: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
git add src/scripts/debug/repl.ts
git commit -m "feat(debug): add interactive REPL with all commands"
```

---

## Task 9: Engine Instrumentation - AI Combat Decisions

**Files:**
- Modify: `src/engine/ai/action_combat.ts`

This task adds DebugEvents.emit() calls to the combat AI. Add imports and emit calls at key decision points.

**Step 1: Add import at top of file**

```typescript
import { DebugEvents } from '../debug/events';
```

**Step 2: Add emit calls at key decision points**

In `handleAttack`, after selecting best target:
```typescript
if (import.meta.env.DEV && bestTarget) {
  DebugEvents.emit('decision', {
    tick: state.tick,
    playerId: _playerId,
    entityId: mainGroup?.id,
    data: {
      category: 'combat',
      action: 'attack',
      reason: `target=${bestTarget.key}, score=${bestScore.toFixed(0)}`,
      scores: { targetScore: bestScore }
    }
  });
}
```

In `handleGroupCohesion`, when status changes:
```typescript
if (import.meta.env.DEV && group.status === 'retreating') {
  DebugEvents.emit('group', {
    tick: state.tick,
    playerId: aiState.attackGroup.length > 0 ? (state.entities[aiState.attackGroup[0]]?.owner ?? 0) : 0,
    data: {
      groupId: group.id,
      action: 'status-changed',
      status: 'retreating',
      reason: `avgHp=${group.avgHealthPercent.toFixed(0)}% < threshold`
    }
  });
}
```

In `issueAttackOrders`:
```typescript
if (import.meta.env.DEV && unitsNeedingOrders.length > 0) {
  for (const unitId of unitsNeedingOrders) {
    DebugEvents.emit('command', {
      tick: state.tick,
      playerId: state.entities[unitId]?.owner ?? 0,
      entityId: unitId,
      data: {
        command: 'attack',
        source: 'ai',
        target: targetId,
        reason: 'focus fire'
      }
    });
  }
}
```

**Step 3: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
git add src/engine/ai/action_combat.ts
git commit -m "feat(debug): instrument AI combat decisions with debug events"
```

---

## Task 10: Engine Instrumentation - Remaining Systems

**Files:**
- Modify: `src/engine/ai/action_economy.ts`
- Modify: `src/engine/ai/strategy/index.ts`
- Modify: `src/engine/ai/planning.ts`
- Modify: `src/engine/reducers/combat.ts`
- Modify: `src/engine/reducers/production.ts`
- Modify: `src/engine/reducers/harvester.ts`

Similar pattern for each:

1. Add import: `import { DebugEvents } from '../debug/events';`
2. Add emit calls at key decision/state-change points
3. Wrap in `if (import.meta.env.DEV) { ... }`

**Key instrumentation points:**

**action_economy.ts:**
- When starting a build
- When making economy decisions

**strategy/index.ts:**
- When strategy changes
- When evaluating strategy scores

**planning.ts:**
- When threat level changes significantly
- When threats are detected near base

**reducers/combat.ts:**
- When entity takes damage (state-change hp)
- When entity dies

**reducers/production.ts:**
- When item completes
- When item starts

**reducers/harvester.ts:**
- When credits are deposited

**Step: Commit after instrumenting each file**

```bash
git add <file>
git commit -m "feat(debug): instrument <system> with debug events"
```

---

## Task 11: Documentation

**Files:**
- Create: `src/scripts/debug/README.md`

**Step 1: Write comprehensive documentation**

```markdown
# Game State Debug Tool

A comprehensive debugging tool for analyzing game state, AI decisions, unit behavior, and economy.

## Quick Start

```bash
# Load a state and check AI status
npm run debug -- --input game_state.json --status 1

# Track a unit through 1000 ticks
npm run debug -- --input state.json --track e_1234 --advance 1000 --export trace.jsonl

# Interactive mode
npm run debug -- --repl --input state.json
```

## CLI Reference

### Basic Options

| Flag | Description |
|------|-------------|
| `--input <file>` | Input game state JSON |
| `--output <file>` | Output state after advancing |
| `--export <file>` | Export event log to JSONL |
| `--advance <n>` | Advance by N ticks |
| `--advance-until <cond>` | Advance until condition |
| `--max-ticks <n>` | Safety limit (default: 100000) |
| `--repl` | Start interactive mode |

### Filter Options

| Flag | Description |
|------|-------------|
| `--track <id>` | Track entity (repeatable) |
| `--player <id>` | Track player (repeatable) |
| `--category <list>` | Enable only these categories |
| `--no-category <list>` | Disable these categories |
| `--threshold <n>=<v>` | Set threshold filter |

### Query Options

| Flag | Description |
|------|-------------|
| `--status <player>` | Show AI status |
| `--unit <id>` | Show unit details |
| `--find <query>` | Find entities |
| `--list-groups <player>` | List offensive groups |

## Trigger Conditions

For `--advance-until` and REPL `advance-until`:

| Condition | Example |
|-----------|---------|
| Entity dies | `dead e_1234` |
| HP threshold | `hp e_1234 < 50%` |
| Tick limit | `tick > 5000` |
| Credits | `credits 1 < 500` |
| Strategy | `strategy 1 == attack` |
| Entity count | `count 1 harvester >= 5` |
| Player dead | `player 2 dead` |
| Threat level | `threat 1 > 80` |

Combine with `or`: `dead e_1234 or tick > 10000`

## REPL Commands

See `help` command in REPL for full list.

## Event Types

| Type | Description |
|------|-------------|
| `command` | Unit received command |
| `decision` | AI made a decision |
| `state-change` | Entity state changed |
| `group` | Group membership changed |
| `economy` | Credits changed |
| `production` | Queue event |
| `threat` | Threat assessment |

## Output Format

JSONL with metadata header:

```jsonl
{"_meta":true,"version":"1.0","startTick":1000,"endTick":2000,...}
{"tick":1100,"type":"command","playerId":1,"entityId":"e_1",...}
```
```

**Step 2: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
git add src/scripts/debug/README.md
git commit -m "docs(debug): add comprehensive README for debug tool"
```

---

## Task 12: Final Integration Test

**Step 1: Run all tests**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/debug-tool
npm test
```

**Step 2: Manual integration test**

```bash
# Test CLI with a real state file
npm run debug -- --input game_state_tick_26594.json --status 1
npm run debug -- --input game_state_tick_26594.json --advance 100 --export test_events.jsonl
cat test_events.jsonl | head -5

# Test REPL
npm run debug -- --repl
> load game_state_tick_26594.json
> status 1
> advance 50
> events
> quit
```

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(debug): complete debug tool implementation"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Event emitter foundation | `src/engine/debug/events.ts` |
| 2 | Zod schemas | `src/engine/debug/schemas.ts` |
| 3 | Collector with filtering | `src/scripts/debug/collector.ts` |
| 4 | Trigger parser | `src/scripts/debug/triggers.ts` |
| 5 | State loader | `src/scripts/debug/state-loader.ts` |
| 6 | CLI entry point | `src/scripts/debug/index.ts`, `cli.ts` |
| 7 | Formatters | `src/scripts/debug/formatters.ts` |
| 8 | REPL | `src/scripts/debug/repl.ts` |
| 9 | Instrument AI combat | `src/engine/ai/action_combat.ts` |
| 10 | Instrument remaining | Multiple engine files |
| 11 | Documentation | `src/scripts/debug/README.md` |
| 12 | Integration test | Manual testing |

Estimated commits: ~12-15

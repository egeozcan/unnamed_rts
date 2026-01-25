/**
 * Zod schemas for debug event types.
 *
 * These schemas validate the structure of debug events for:
 * - Runtime validation of events before writing to JSONL files
 * - Parsing and validating events when loading debug logs
 * - TypeScript type inference via z.infer<>
 */

import { z } from 'zod';

// ============================================================================
// Helper Schemas
// ============================================================================

export const VectorSchema = z.object({
    x: z.number(),
    y: z.number()
});

// ============================================================================
// Event Data Schemas
// ============================================================================

const CommandDataSchema = z.object({
    command: z.enum(['move', 'attack', 'attack-move', 'stop', 'deploy']),
    source: z.enum(['player', 'ai']),
    target: z.string().optional(),
    destination: VectorSchema.optional(),
    reason: z.string().optional()
});

const DecisionDataSchema = z.object({
    category: z.enum(['strategy', 'combat', 'economy', 'production']),
    action: z.string(),
    reason: z.string(),
    scores: z.record(z.string(), z.number()).optional(),
    alternatives: z.array(z.string()).optional()
});

const StateChangeDataSchema = z.object({
    subject: z.enum(['unit', 'building', 'ai', 'group']),
    field: z.string(),
    from: z.unknown(),
    to: z.unknown(),
    cause: z.string().optional()
});

const GroupDataSchema = z.object({
    groupId: z.string(),
    action: z.enum(['created', 'dissolved', 'member-added', 'member-removed', 'status-changed']),
    unitIds: z.array(z.string()).optional(),
    status: z.string().optional(),
    reason: z.string().optional()
});

const EconomyDataSchema = z.object({
    credits: z.number(),
    delta: z.number(),
    source: z.enum(['harvest', 'sell', 'spend', 'induction-rig']),
    entityId: z.string().optional()
});

const ProductionDataSchema = z.object({
    action: z.enum(['queue-add', 'queue-remove', 'started', 'completed', 'cancelled']),
    category: z.enum(['building', 'infantry', 'vehicle', 'air']),
    key: z.string(),
    queueLength: z.number().optional()
});

const ThreatDataSchema = z.object({
    threatLevel: z.number(),
    economyScore: z.number(),
    desperation: z.number(),
    isDoomed: z.boolean(),
    threatsNearBase: z.array(z.string()),
    vengeanceScores: z.record(z.string(), z.number())
});

// ============================================================================
// Event Schemas
// ============================================================================

export const CommandEventSchema = z.object({
    type: z.literal('command'),
    tick: z.number(),
    playerId: z.number(),
    entityId: z.string(),
    data: CommandDataSchema
});

export const DecisionEventSchema = z.object({
    type: z.literal('decision'),
    tick: z.number(),
    playerId: z.number(),
    entityId: z.string().optional(),
    data: DecisionDataSchema
});

export const StateChangeEventSchema = z.object({
    type: z.literal('state-change'),
    tick: z.number(),
    playerId: z.number().optional(),
    entityId: z.string().optional(),
    data: StateChangeDataSchema
});

export const GroupEventSchema = z.object({
    type: z.literal('group'),
    tick: z.number(),
    playerId: z.number(),
    data: GroupDataSchema
});

export const EconomyEventSchema = z.object({
    type: z.literal('economy'),
    tick: z.number(),
    playerId: z.number(),
    data: EconomyDataSchema
});

export const ProductionEventSchema = z.object({
    type: z.literal('production'),
    tick: z.number(),
    playerId: z.number(),
    data: ProductionDataSchema
});

export const ThreatEventSchema = z.object({
    type: z.literal('threat'),
    tick: z.number(),
    playerId: z.number(),
    data: ThreatDataSchema
});

// ============================================================================
// Discriminated Union
// ============================================================================

export const DebugEventSchema = z.discriminatedUnion('type', [
    CommandEventSchema,
    DecisionEventSchema,
    StateChangeEventSchema,
    GroupEventSchema,
    EconomyEventSchema,
    ProductionEventSchema,
    ThreatEventSchema
]);

// ============================================================================
// Meta Line Schema (for JSONL file header)
// ============================================================================

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

// ============================================================================
// Inferred Types
// ============================================================================

export type Vector = z.infer<typeof VectorSchema>;
export type CommandEvent = z.infer<typeof CommandEventSchema>;
export type DecisionEvent = z.infer<typeof DecisionEventSchema>;
export type StateChangeEvent = z.infer<typeof StateChangeEventSchema>;
export type GroupEvent = z.infer<typeof GroupEventSchema>;
export type EconomyEvent = z.infer<typeof EconomyEventSchema>;
export type ProductionEvent = z.infer<typeof ProductionEventSchema>;
export type ThreatEvent = z.infer<typeof ThreatEventSchema>;
export type DebugEvent = z.infer<typeof DebugEventSchema>;
export type MetaLine = z.infer<typeof MetaLineSchema>;

import { z } from 'zod';

// AI Personality definition
export const AIPersonalitySchema = z.object({
  aggression_bias: z.number().positive(),
  retreat_threshold: z.number().min(0).max(1),
  attack_threshold: z.number().positive(),
  harass_threshold: z.number().positive(),
  rally_offset: z.number().positive(),
  build_order_priority: z.array(z.string()),
  unit_preferences: z.object({
    infantry: z.array(z.string()),
    vehicle: z.array(z.string()),
  }),
  // Economy parameters
  harvester_ratio: z.number().positive().optional(),      // Harvesters per refinery (default: 2)
  credit_buffer: z.number().nonnegative().optional(),     // Min credits to hold (default: 400)
  // Combat parameters
  kite_aggressiveness: z.number().min(0).max(1).optional(), // How aggressively to kite (default: 0.5)
  defense_investment: z.number().positive().optional(),   // Max turrets to build (default: 3)
  max_chase_distance: z.number().positive().optional(),   // How far to chase enemies (default: 400)
  // Attack group sizing
  min_attack_group_size: z.number().positive().optional(), // Minimum units to start attack (default: 5)
  max_attack_group_size: z.number().positive().optional(), // Maximum units in attack group (default: 15)
});
export type AIPersonality = z.infer<typeof AIPersonalitySchema>;

// Production focus enum
export const ProductionFocusSchema = z.enum(['economy', 'military', 'balanced']);
export type ProductionFocus = z.infer<typeof ProductionFocusSchema>;

// Group behavior enum
export const GroupBehaviorSchema = z.enum(['coordinate', 'hit_and_run', 'intercept']);
export type GroupBehavior = z.infer<typeof GroupBehaviorSchema>;

// AI Strategy definition
export const AIStrategySchema = z.object({
  description: z.string(),
  production_focus: ProductionFocusSchema,
  group_behavior: GroupBehaviorSchema.optional(),
  target_priority: z.array(z.string()).optional(),
});
export type AIStrategy = z.infer<typeof AIStrategySchema>;

// Personality names enum
export const PersonalityNameSchema = z.enum(['rusher', 'turtle', 'balanced']);
export type PersonalityName = z.infer<typeof PersonalityNameSchema>;

// Strategy names enum
export const StrategyNameSchema = z.enum(['buildup', 'attack', 'harass', 'defend']);
export type StrategyName = z.infer<typeof StrategyNameSchema>;

// Complete AI Config schema
export const AIConfigSchema = z.object({
  personalities: z.object({
    rusher: AIPersonalitySchema,
    turtle: AIPersonalitySchema,
    balanced: AIPersonalitySchema,
  }),
  strategies: z.object({
    buildup: AIStrategySchema,
    attack: AIStrategySchema,
    harass: AIStrategySchema,
    defend: AIStrategySchema,
  }),
});
export type AIConfig = z.infer<typeof AIConfigSchema>;

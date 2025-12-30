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

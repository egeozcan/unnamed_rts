import rulesJson from '../rules.json';
import aiJson from '../ai.json';
import { RulesSchema, type Rules } from './rules.schema';
import { AIConfigSchema, type AIConfig } from './ai.schema';

// Re-export all types
export * from './rules.schema';
export * from './ai.schema';

/**
 * Validates rules.json at module load time.
 * Throws a ZodError with detailed path information if validation fails.
 */
function validateRules(): Rules {
  const result = RulesSchema.safeParse(rulesJson);
  if (!result.success) {
    console.error('[FATAL] rules.json validation failed:');
    console.error(result.error.format());
    throw new Error(`rules.json validation failed: ${result.error.message}`);
  }
  return result.data;
}

/**
 * Validates ai.json at module load time.
 * Throws a ZodError with detailed path information if validation fails.
 */
function validateAIConfig(): AIConfig {
  const result = AIConfigSchema.safeParse(aiJson);
  if (!result.success) {
    console.error('[FATAL] ai.json validation failed:');
    console.error(result.error.format());
    throw new Error(`ai.json validation failed: ${result.error.message}`);
  }
  return result.data;
}

// Validated exports - these are validated once at module load time
export const RULES: Rules = validateRules();
export const AI_CONFIG: AIConfig = validateAIConfig();

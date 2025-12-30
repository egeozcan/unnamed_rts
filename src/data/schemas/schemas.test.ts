import { describe, it, expect } from 'vitest';
import { RulesSchema, AIConfigSchema, RULES, AI_CONFIG } from './index';
import rulesJson from '../rules.json';
import aiJson from '../ai.json';

describe('Rules Schema', () => {
  it('should validate rules.json successfully', () => {
    const result = RulesSchema.safeParse(rulesJson);
    expect(result.success).toBe(true);
  });

  it('should export validated RULES', () => {
    expect(RULES).toBeDefined();
    expect(RULES.economy.sellBuildingReturnPercentage).toBe(0.5);
  });

  it('should have all expected buildings', () => {
    const buildingKeys = Object.keys(RULES.buildings);
    expect(buildingKeys).toContain('conyard');
    expect(buildingKeys).toContain('power');
    expect(buildingKeys).toContain('refinery');
    expect(buildingKeys).toContain('barracks');
    expect(buildingKeys).toContain('factory');
  });

  it('should have all expected units', () => {
    const unitKeys = Object.keys(RULES.units);
    expect(unitKeys).toContain('rifle');
    expect(unitKeys).toContain('harvester');
    expect(unitKeys).toContain('heavy');
  });

  it('should have damage modifiers for all weapon types', () => {
    const weaponTypes = Object.keys(RULES.damageModifiers);
    expect(weaponTypes).toContain('bullet');
    expect(weaponTypes).toContain('cannon');
    expect(weaponTypes).toContain('missile');
  });

  it('should reject invalid rules', () => {
    const invalidRules = {
      ...rulesJson,
      economy: {
        sellBuildingReturnPercentage: 'invalid',
        repairCostPercentage: 0.3,
      },
    };
    const result = RulesSchema.safeParse(invalidRules);
    expect(result.success).toBe(false);
  });

  it('should reject missing required fields', () => {
    const incompleteRules = {
      economy: rulesJson.economy,
    };
    const result = RulesSchema.safeParse(incompleteRules);
    expect(result.success).toBe(false);
  });
});

describe('AI Config Schema', () => {
  it('should validate ai.json successfully', () => {
    const result = AIConfigSchema.safeParse(aiJson);
    expect(result.success).toBe(true);
  });

  it('should export validated AI_CONFIG', () => {
    expect(AI_CONFIG).toBeDefined();
    expect(AI_CONFIG.personalities.rusher).toBeDefined();
    expect(AI_CONFIG.strategies.attack).toBeDefined();
  });

  it('should have all expected personalities', () => {
    expect(AI_CONFIG.personalities.rusher).toBeDefined();
    expect(AI_CONFIG.personalities.turtle).toBeDefined();
    expect(AI_CONFIG.personalities.balanced).toBeDefined();
  });

  it('should have all expected strategies', () => {
    expect(AI_CONFIG.strategies.buildup).toBeDefined();
    expect(AI_CONFIG.strategies.attack).toBeDefined();
    expect(AI_CONFIG.strategies.harass).toBeDefined();
    expect(AI_CONFIG.strategies.defend).toBeDefined();
  });

  it('should have correct personality structure', () => {
    const rusher = AI_CONFIG.personalities.rusher;
    expect(rusher.aggression_bias).toBe(1.5);
    expect(rusher.build_order_priority).toBeInstanceOf(Array);
    expect(rusher.unit_preferences.infantry).toBeInstanceOf(Array);
  });

  it('should reject invalid AI config', () => {
    const invalidConfig = {
      ...aiJson,
      personalities: {
        ...aiJson.personalities,
        rusher: {
          ...aiJson.personalities.rusher,
          aggression_bias: 'not-a-number',
        },
      },
    };
    const result = AIConfigSchema.safeParse(invalidConfig);
    expect(result.success).toBe(false);
  });
});

describe('Type inference', () => {
  it('should provide correct types for RULES', () => {
    const buildingCost: number = RULES.buildings['power'].cost;
    const unitSpeed: number = RULES.units['rifle'].speed;
    const sellPercentage: number = RULES.economy.sellBuildingReturnPercentage;

    expect(typeof buildingCost).toBe('number');
    expect(typeof unitSpeed).toBe('number');
    expect(typeof sellPercentage).toBe('number');
  });

  it('should provide correct types for AI_CONFIG', () => {
    const aggressionBias: number = AI_CONFIG.personalities.rusher.aggression_bias;
    const description: string = AI_CONFIG.strategies.attack.description;

    expect(typeof aggressionBias).toBe('number');
    expect(typeof description).toBe('string');
  });
});

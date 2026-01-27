import { z } from 'zod';

// Armor types enum
export const ArmorTypeSchema = z.enum([
  'none', 'infantry', 'light', 'medium', 'heavy', 'building'
]);
export type ArmorType = z.infer<typeof ArmorTypeSchema>;

// Weapon types enum
export const WeaponTypeSchema = z.enum([
  'bullet', 'ap_bullet', 'cannon', 'heavy_cannon', 'rocket',
  'missile', 'flame', 'sniper', 'laser', 'grenade', 'heal', 'air_missile'
]);
export type WeaponType = z.infer<typeof WeaponTypeSchema>;

// Projectile archetype enum
export const ProjectileArchetypeSchema = z.enum([
  'hitscan', 'rocket', 'artillery', 'missile', 'ballistic', 'grenade'
]);
export type ProjectileArchetype = z.infer<typeof ProjectileArchetypeSchema>;

// Weapon archetype configuration (maps weapon type to projectile archetype)
export const WeaponArchetypeSchema = z.object({
  archetype: ProjectileArchetypeSchema,
  interceptable: z.boolean(),
  hp: z.number().positive().optional()
});
export type WeaponArchetype = z.infer<typeof WeaponArchetypeSchema>;

// Interception aura configuration (for AA units that can damage projectiles)
export const InterceptionAuraSchema = z.object({
  radius: z.number(),
  dps: z.number()
});
export type InterceptionAura = z.infer<typeof InterceptionAuraSchema>;

// Unit types enum
export const UnitTypeSchema = z.enum(['infantry', 'vehicle', 'air']);
export type UnitType = z.infer<typeof UnitTypeSchema>;

// Economy settings
export const EconomySchema = z.object({
  sellBuildingReturnPercentage: z.number().min(0).max(1),
  repairCostPercentage: z.number().min(0).max(1),
});
export type Economy = z.infer<typeof EconomySchema>;

// Meta settings
export const MetaSchema = z.object({
  version: z.string(),
  factions: z.array(z.string()),
  buildingCategories: z.object({
    base: z.array(z.string()),
    defense: z.array(z.string()),
  }),
});
export type Meta = z.infer<typeof MetaSchema>;

// Production category enum
export const ProductionCategorySchema = z.enum(['building', 'infantry', 'vehicle', 'air']);
export type ProductionCategory = z.infer<typeof ProductionCategorySchema>;

// Production buildings mapping (allows string indexing for dynamic access)
export const ProductionBuildingsSchema = z.record(z.string(), z.array(z.string()));
export type ProductionBuildings = z.infer<typeof ProductionBuildingsSchema>;

// Building definition
export const BuildingSchema = z.object({
  name: z.string(),
  hp: z.number().positive(),
  cost: z.number().nonnegative(),
  w: z.number().positive(),
  h: z.number().positive(),
  armor: ArmorTypeSchema,
  prerequisites: z.array(z.string()),
  // Optional fields
  power: z.number().optional(),
  drain: z.number().optional(),
  hidden: z.boolean().optional(),
  marker: z.string().optional(),
  provides: z.string().optional(),
  isDefense: z.boolean().optional(),
  capturable: z.boolean().optional(),
  range: z.number().optional(),
  damage: z.number().optional(),
  rate: z.number().optional(),
  weaponType: WeaponTypeSchema.optional(),
  // Air base fields
  landingSlots: z.number().positive().optional(),
  reloadTicks: z.number().positive().optional(),
  // Service depot fields
  repairRadius: z.number().positive().optional(),
  repairRate: z.number().positive().optional(),
  // Limit fields - AI will not build more than this count per player
  maxCount: z.number().positive().optional(),
  // Description for tooltips
  description: z.string().optional(),
  // AA interception aura - damages enemy projectiles passing through
  interceptionAura: InterceptionAuraSchema.optional(),
});
export type Building = z.infer<typeof BuildingSchema>;

// Unit definition
export const UnitSchema = z.object({
  name: z.string(),
  type: UnitTypeSchema,
  hp: z.number().positive(),
  cost: z.number().nonnegative(),
  speed: z.number().positive(),
  w: z.number().positive(),
  armor: ArmorTypeSchema,
  prerequisites: z.array(z.string()),
  range: z.number().nonnegative(),
  damage: z.number(), // Can be negative for healers
  rate: z.number().optional(),
  weaponType: WeaponTypeSchema.optional(),
  // Optional fields
  splash: z.number().optional(),
  capacity: z.number().optional(),
  fly: z.boolean().optional(),
  canCaptureEnemyBuildings: z.boolean().optional(),
  canRepairFriendlyBuildings: z.boolean().optional(),
  // Air unit ammo field
  ammo: z.number().positive().optional(),
  // Limit fields - AI will not build more than this count per player
  maxCount: z.number().positive().optional(),
  // Combat mobility - can fire while moving (light vehicles, strafing aircraft)
  canAttackWhileMoving: z.boolean().optional(),
  // Demo truck explosion fields
  explosionDamage: z.number().positive().optional(),
  explosionRadius: z.number().positive().optional(),
  // Description for tooltips
  description: z.string().optional(),
  // AA interception aura - damages enemy projectiles passing through
  interceptionAura: InterceptionAuraSchema.optional(),
});
export type Unit = z.infer<typeof UnitSchema>;

// Armor type definition (currently empty objects, extensible)
export const ArmorTypeDefinitionSchema = z.object({}).passthrough();
export type ArmorTypeDefinition = z.infer<typeof ArmorTypeDefinitionSchema>;

// Damage modifiers for a weapon type (maps armor type to multiplier)
// Uses string keys to allow dynamic access with runtime-determined weapon/armor types
export const DamageModifierSchema = z.record(z.string(), z.number());
export type DamageModifier = z.infer<typeof DamageModifierSchema>;

// Weapon targeting capabilities (air vs ground)
export const WeaponTargetingSchema = z.object({
  canTargetGround: z.boolean(),
  canTargetAir: z.boolean(),
});
export type WeaponTargeting = z.infer<typeof WeaponTargetingSchema>;

// Well definition (ore generator)
export const WellSchema = z.object({
  name: z.string(),
  w: z.number().positive(),
  h: z.number().positive(),
  spawnRateTicksMin: z.number().positive(),
  spawnRateTicksMax: z.number().positive(),
  maxOrePerWell: z.number().positive(),
  oreSpawnRadius: z.number().positive(),
  initialOreAmount: z.number().positive(),
  oreGrowthRate: z.number().positive(),
  maxOreAmount: z.number().positive(),
});
export type Well = z.infer<typeof WellSchema>;

// Complete Rules schema
export const RulesSchema = z.object({
  economy: EconomySchema,
  weaponArchetypes: z.record(z.string(), WeaponArchetypeSchema).optional(),
  meta: MetaSchema,
  productionBuildings: ProductionBuildingsSchema,
  buildings: z.record(z.string(), BuildingSchema),
  units: z.record(z.string(), UnitSchema),
  armorTypes: z.record(z.string(), ArmorTypeDefinitionSchema),
  damageModifiers: z.record(z.string(), DamageModifierSchema),
  wells: z.record(z.string(), WellSchema).optional(),
  weaponTargeting: z.record(z.string(), WeaponTargetingSchema).optional(),
});
export type Rules = z.infer<typeof RulesSchema>;

// Type guards for distinguishing Building vs Unit data
export function isBuildingData(data: Building | Unit): data is Building {
  return 'h' in data; // Buildings have height property, units don't
}

export function isUnitData(data: Building | Unit): data is Unit {
  return 'speed' in data; // Units have speed property, buildings don't
}

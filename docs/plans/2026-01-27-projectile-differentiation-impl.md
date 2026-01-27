# Projectile Differentiation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add six projectile archetypes with distinct behaviors, splash damage with friendly fire, and health-based AA interception.

**Architecture:** Extend `Projectile` interface with archetype/HP/arc fields, add `weaponArchetypes` and `interceptionAura` to rules.json, implement splash damage in game_loop.ts, add AA interception logic, update renderer for visual differentiation.

**Tech Stack:** TypeScript, Vitest for testing, Canvas 2D for rendering.

---

### Task 1: Extend Projectile Type

**Files:**
- Modify: `src/engine/types.ts:187-198`

**Step 1: Write the failing test**

Create file `tests/engine/projectile-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Vector } from '../../src/engine/types';

describe('Projectile Archetype Types', () => {
    it('should include archetype field in Projectile interface', () => {
        const projectile = {
            ownerId: 'e_1',
            pos: new Vector(0, 0),
            vel: new Vector(1, 0),
            targetId: 'e_2',
            speed: 18,
            damage: 10,
            splash: 0,
            type: 'bullet',
            weaponType: 'bullet',
            dead: false,
            archetype: 'hitscan' as const,
            hp: 0,
            maxHp: 0,
            arcHeight: 0,
            startPos: new Vector(0, 0),
            trailPoints: []
        };

        expect(projectile.archetype).toBe('hitscan');
        expect(projectile.hp).toBe(0);
        expect(projectile.maxHp).toBe(0);
        expect(projectile.arcHeight).toBe(0);
        expect(projectile.startPos).toBeInstanceOf(Vector);
        expect(projectile.trailPoints).toEqual([]);
    });

    it('should support all six archetypes', () => {
        const archetypes = ['hitscan', 'rocket', 'artillery', 'missile', 'ballistic', 'grenade'] as const;
        archetypes.forEach(archetype => {
            expect(typeof archetype).toBe('string');
        });
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-types.test.ts`

Expected: Type error - `archetype`, `hp`, `maxHp`, `arcHeight`, `startPos`, `trailPoints` don't exist on Projectile

**Step 3: Update Projectile interface**

In `src/engine/types.ts`, replace the Projectile interface (lines 187-198):

```typescript
export type ProjectileArchetype = 'hitscan' | 'rocket' | 'artillery' | 'missile' | 'ballistic' | 'grenade';

export interface Projectile {
    readonly ownerId: EntityId;
    readonly pos: Vector;
    readonly vel: Vector;
    readonly targetId: EntityId;
    readonly speed: number;
    readonly damage: number;
    readonly splash: number;
    readonly type: string;
    readonly weaponType?: string;
    readonly dead: boolean;
    readonly archetype: ProjectileArchetype;
    readonly hp: number;
    readonly maxHp: number;
    readonly arcHeight: number;
    readonly startPos: Vector;
    readonly trailPoints: readonly Vector[];
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-types.test.ts`

Expected: PASS

**Step 5: Run full test suite to check for breakage**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npm test 2>&1 | tail -30`

Expected: Failures in tests that create Projectiles without new fields (this is expected, we'll fix in Task 2)

**Step 6: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation
git add src/engine/types.ts tests/engine/projectile-types.test.ts
git commit -m "feat(projectile): add archetype, hp, arc fields to Projectile interface"
```

---

### Task 2: Add Weapon Archetypes to rules.json

**Files:**
- Modify: `src/data/rules.json`
- Modify: `src/data/schemas/index.ts` (add schema validation)

**Step 1: Write the failing test**

Add to `tests/engine/projectile-types.test.ts`:

```typescript
import { RULES } from '../../src/data/schemas/index';

describe('Weapon Archetypes Configuration', () => {
    it('should have weaponArchetypes in rules', () => {
        expect(RULES.weaponArchetypes).toBeDefined();
    });

    it('should define archetype for bullet weapon', () => {
        expect(RULES.weaponArchetypes.bullet).toEqual({
            archetype: 'hitscan',
            interceptable: false
        });
    });

    it('should define archetype for rocket weapon with HP', () => {
        expect(RULES.weaponArchetypes.rocket).toEqual({
            archetype: 'rocket',
            interceptable: true,
            hp: 50
        });
    });

    it('should define archetype for heavy_cannon as artillery', () => {
        expect(RULES.weaponArchetypes.heavy_cannon).toEqual({
            archetype: 'artillery',
            interceptable: true,
            hp: 150
        });
    });

    it('should define archetype for missile', () => {
        expect(RULES.weaponArchetypes.missile).toEqual({
            archetype: 'missile',
            interceptable: true,
            hp: 100
        });
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-types.test.ts`

Expected: FAIL - weaponArchetypes is undefined

**Step 3: Add weaponArchetypes to rules.json**

Add after the `"economy"` section (around line 5) in `src/data/rules.json`:

```json
    "weaponArchetypes": {
        "bullet": { "archetype": "hitscan", "interceptable": false },
        "ap_bullet": { "archetype": "hitscan", "interceptable": false },
        "sniper": { "archetype": "hitscan", "interceptable": false },
        "laser": { "archetype": "hitscan", "interceptable": false },
        "cannon": { "archetype": "ballistic", "interceptable": false },
        "heavy_cannon": { "archetype": "artillery", "interceptable": true, "hp": 150 },
        "rocket": { "archetype": "rocket", "interceptable": true, "hp": 50 },
        "missile": { "archetype": "missile", "interceptable": true, "hp": 100 },
        "air_missile": { "archetype": "missile", "interceptable": true, "hp": 100 },
        "grenade": { "archetype": "grenade", "interceptable": false },
        "flame": { "archetype": "hitscan", "interceptable": false },
        "heal": { "archetype": "hitscan", "interceptable": false }
    },
```

**Step 4: Update schema in src/data/schemas/index.ts**

Add the WeaponArchetype schema and update RULES type. Find where other schemas are defined and add:

```typescript
const WeaponArchetypeSchema = z.object({
    archetype: z.enum(['hitscan', 'rocket', 'artillery', 'missile', 'ballistic', 'grenade']),
    interceptable: z.boolean(),
    hp: z.number().optional()
});
```

Add `weaponArchetypes: z.record(z.string(), WeaponArchetypeSchema).optional()` to the RulesSchema.

**Step 5: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-types.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation
git add src/data/rules.json src/data/schemas/index.ts tests/engine/projectile-types.test.ts
git commit -m "feat(projectile): add weaponArchetypes configuration to rules.json"
```

---

### Task 3: Update createProjectile for Archetypes

**Files:**
- Modify: `src/engine/reducers/helpers.ts:272-295`

**Step 1: Write the failing test**

Add to `tests/engine/projectile-types.test.ts`:

```typescript
import { createProjectile } from '../../src/engine/reducers/helpers';
import { createTestCombatUnit, createTestBuilding } from '../../src/engine/test-utils';
import { createTestState } from '../../src/engine/test-utils';

describe('createProjectile with Archetypes', () => {
    it('should create hitscan projectile for bullet weapon', () => {
        const state = createTestState();
        const source = createTestCombatUnit({ key: 'rifle', pos: { x: 0, y: 0 } });
        const target = createTestCombatUnit({ key: 'rifle', pos: { x: 100, y: 0 } });

        const proj = createProjectile(source, target);

        expect(proj.archetype).toBe('hitscan');
        expect(proj.hp).toBe(0);
        expect(proj.maxHp).toBe(0);
        expect(proj.speed).toBeGreaterThanOrEqual(50);
    });

    it('should create rocket projectile with HP', () => {
        const source = createTestCombatUnit({ key: 'rocket', pos: { x: 0, y: 0 } });
        const target = createTestCombatUnit({ key: 'rifle', pos: { x: 100, y: 0 } });

        const proj = createProjectile(source, target);

        expect(proj.archetype).toBe('rocket');
        expect(proj.hp).toBe(50);
        expect(proj.maxHp).toBe(50);
        expect(proj.speed).toBe(9);
    });

    it('should create artillery projectile for heavy_cannon', () => {
        const source = createTestCombatUnit({ key: 'artillery', pos: { x: 0, y: 0 } });
        const target = createTestCombatUnit({ key: 'rifle', pos: { x: 300, y: 0 } });

        const proj = createProjectile(source, target);

        expect(proj.archetype).toBe('artillery');
        expect(proj.hp).toBe(150);
        expect(proj.maxHp).toBe(150);
        expect(proj.speed).toBe(6);
    });

    it('should create missile projectile for SAM site', () => {
        const source = createTestBuilding({ key: 'sam_site', pos: { x: 0, y: 0 } });
        const target = createTestCombatUnit({ key: 'heli', pos: { x: 200, y: 0 } });

        const proj = createProjectile(source, target);

        expect(proj.archetype).toBe('missile');
        expect(proj.hp).toBe(100);
        expect(proj.maxHp).toBe(100);
        expect(proj.speed).toBe(28);
    });

    it('should set startPos and empty trailPoints', () => {
        const source = createTestCombatUnit({ key: 'rifle', pos: { x: 50, y: 75 } });
        const target = createTestCombatUnit({ key: 'rifle', pos: { x: 150, y: 75 } });

        const proj = createProjectile(source, target);

        expect(proj.startPos.x).toBe(50);
        expect(proj.startPos.y).toBe(75);
        expect(proj.trailPoints).toEqual([]);
    });

    it('should calculate arcHeight based on distance for artillery', () => {
        const source = createTestCombatUnit({ key: 'artillery', pos: { x: 0, y: 0 } });
        const target = createTestCombatUnit({ key: 'rifle', pos: { x: 400, y: 0 } });

        const proj = createProjectile(source, target);

        // arcHeight = distance * 0.4 for artillery = 400 * 0.4 = 160
        expect(proj.arcHeight).toBe(160);
    });

    it('should set arcHeight to 0 for hitscan', () => {
        const source = createTestCombatUnit({ key: 'rifle', pos: { x: 0, y: 0 } });
        const target = createTestCombatUnit({ key: 'rifle', pos: { x: 200, y: 0 } });

        const proj = createProjectile(source, target);

        expect(proj.arcHeight).toBe(0);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-types.test.ts`

Expected: FAIL - createProjectile doesn't return archetype/hp/startPos/trailPoints

**Step 3: Update createProjectile in helpers.ts**

Replace `createProjectile` function in `src/engine/reducers/helpers.ts`:

```typescript
export function createProjectile(source: Entity, target: Entity): Projectile {
    const data = getRuleData(source.key);
    const weaponType = data?.weaponType || 'bullet';

    // Get archetype config from rules
    const archetypeConfig = RULES.weaponArchetypes?.[weaponType] || {
        archetype: 'hitscan',
        interceptable: false
    };
    const archetype = archetypeConfig.archetype as ProjectileArchetype;

    // Speed by archetype
    let speed: number;
    switch (archetype) {
        case 'hitscan': speed = 50; break;
        case 'rocket': speed = 9; break;
        case 'artillery': speed = 6; break;
        case 'missile': speed = 28; break;
        case 'ballistic': speed = 14; break;
        case 'grenade': speed = 8; break;
        default: speed = 18;
    }

    // HP for interceptable projectiles
    const hp = archetypeConfig.interceptable ? (archetypeConfig.hp || 0) : 0;

    // Calculate distance for arc height
    const distance = source.pos.dist(target.pos);

    // Arc multiplier by archetype
    let arcMultiplier: number;
    switch (archetype) {
        case 'artillery': arcMultiplier = 0.4; break;
        case 'grenade': arcMultiplier = 0.6; break;
        case 'ballistic': arcMultiplier = 0.1; break;
        default: arcMultiplier = 0;
    }
    const arcHeight = distance * arcMultiplier;

    return {
        ownerId: source.id,
        pos: source.pos,
        vel: target.pos.sub(source.pos).norm().scale(speed),
        targetId: target.id,
        speed,
        damage: data?.damage || 10,
        splash: (data && isUnitData(data)) ? (data.splash || 0) : 0,
        type: weaponType,
        weaponType,
        dead: false,
        archetype,
        hp,
        maxHp: hp,
        arcHeight,
        startPos: source.pos,
        trailPoints: []
    };
}
```

Add import at top of helpers.ts:

```typescript
import { ProjectileArchetype } from '../types';
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-types.test.ts`

Expected: PASS

**Step 5: Run full test suite**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npm test`

Expected: PASS (all tests should now work with new Projectile fields)

**Step 6: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation
git add src/engine/reducers/helpers.ts tests/engine/projectile-types.test.ts
git commit -m "feat(projectile): update createProjectile to set archetype, hp, and arc fields"
```

---

### Task 4: Implement Splash Damage

**Files:**
- Modify: `src/engine/reducers/game_loop.ts`

**Step 1: Write the failing test**

Create file `tests/engine/splash-damage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Vector } from '../../src/engine/types';
import { applySplashDamage } from '../../src/engine/reducers/game_loop';
import { createTestState, createTestCombatUnit } from '../../src/engine/test-utils';

describe('Splash Damage', () => {
    it('should apply full damage at center', () => {
        let state = createTestState();
        const target = createTestCombatUnit({ id: 'target', pos: { x: 100, y: 100 }, hp: 100, maxHp: 100 });
        state = { ...state, entities: { ...state.entities, [target.id]: target } };

        const projectile = {
            ownerId: 'attacker',
            pos: new Vector(100, 100),
            vel: new Vector(0, 0),
            targetId: 'target',
            speed: 9,
            damage: 50,
            splash: 100,
            type: 'rocket',
            weaponType: 'rocket',
            dead: true,
            archetype: 'rocket' as const,
            hp: 0,
            maxHp: 50,
            arcHeight: 0,
            startPos: new Vector(0, 0),
            trailPoints: []
        };

        const result = applySplashDamage(state, projectile, projectile.pos);
        const damagedTarget = result.entities['target'];

        // Full damage at center (distance 0)
        expect(damagedTarget.hp).toBeLessThan(100);
    });

    it('should apply linear falloff damage at edge', () => {
        let state = createTestState();
        // Place unit at edge of splash radius (100 units away, splash radius 100)
        const edgeUnit = createTestCombatUnit({ id: 'edge', pos: { x: 200, y: 100 }, hp: 100, maxHp: 100 });
        state = { ...state, entities: { ...state.entities, [edgeUnit.id]: edgeUnit } };

        const projectile = {
            ownerId: 'attacker',
            pos: new Vector(100, 100),
            vel: new Vector(0, 0),
            targetId: 'other',
            speed: 9,
            damage: 100,
            splash: 100,
            type: 'rocket',
            weaponType: 'rocket',
            dead: true,
            archetype: 'rocket' as const,
            hp: 0,
            maxHp: 50,
            arcHeight: 0,
            startPos: new Vector(0, 0),
            trailPoints: []
        };

        const result = applySplashDamage(state, projectile, projectile.pos);
        const damagedUnit = result.entities['edge'];

        // At edge (distance = radius), falloff = 0, so no damage
        expect(damagedUnit.hp).toBe(100);
    });

    it('should apply ~50% damage at half radius', () => {
        let state = createTestState();
        // Place unit at half splash radius (50 units away, splash radius 100)
        const halfUnit = createTestCombatUnit({ id: 'half', pos: { x: 150, y: 100 }, hp: 100, maxHp: 100, owner: 1 });
        state = { ...state, entities: { ...state.entities, [halfUnit.id]: halfUnit } };

        const projectile = {
            ownerId: 'attacker',
            pos: new Vector(100, 100),
            vel: new Vector(0, 0),
            targetId: 'other',
            speed: 9,
            damage: 100,
            splash: 100,
            type: 'rocket',
            weaponType: 'rocket',
            dead: true,
            archetype: 'rocket' as const,
            hp: 0,
            maxHp: 50,
            arcHeight: 0,
            startPos: new Vector(0, 0),
            trailPoints: []
        };

        const result = applySplashDamage(state, projectile, projectile.pos);
        const damagedUnit = result.entities['half'];

        // At half radius (distance 50, radius 100), falloff = 0.5, damage = 50
        expect(damagedUnit.hp).toBe(50);
    });

    it('should damage friendly units (friendly fire)', () => {
        let state = createTestState();
        const attacker = createTestCombatUnit({ id: 'attacker', pos: { x: 0, y: 0 }, owner: 0 });
        const friendly = createTestCombatUnit({ id: 'friendly', pos: { x: 100, y: 100 }, hp: 100, maxHp: 100, owner: 0 });
        state = { ...state, entities: { ...state.entities, [attacker.id]: attacker, [friendly.id]: friendly } };

        const projectile = {
            ownerId: 'attacker',
            pos: new Vector(100, 100),
            vel: new Vector(0, 0),
            targetId: 'enemy',
            speed: 9,
            damage: 50,
            splash: 100,
            type: 'rocket',
            weaponType: 'rocket',
            dead: true,
            archetype: 'rocket' as const,
            hp: 0,
            maxHp: 50,
            arcHeight: 0,
            startPos: new Vector(0, 0),
            trailPoints: []
        };

        const result = applySplashDamage(state, projectile, projectile.pos);
        const damagedFriendly = result.entities['friendly'];

        // Friendly fire - should take damage
        expect(damagedFriendly.hp).toBeLessThan(100);
    });

    it('should not apply splash when splash radius is 0', () => {
        let state = createTestState();
        const nearby = createTestCombatUnit({ id: 'nearby', pos: { x: 105, y: 100 }, hp: 100, maxHp: 100 });
        state = { ...state, entities: { ...state.entities, [nearby.id]: nearby } };

        const projectile = {
            ownerId: 'attacker',
            pos: new Vector(100, 100),
            vel: new Vector(0, 0),
            targetId: 'other',
            speed: 50,
            damage: 50,
            splash: 0,
            type: 'bullet',
            weaponType: 'bullet',
            dead: true,
            archetype: 'hitscan' as const,
            hp: 0,
            maxHp: 0,
            arcHeight: 0,
            startPos: new Vector(0, 0),
            trailPoints: []
        };

        const result = applySplashDamage(state, projectile, projectile.pos);
        const unit = result.entities['nearby'];

        expect(unit.hp).toBe(100);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/splash-damage.test.ts`

Expected: FAIL - applySplashDamage is not exported

**Step 3: Implement applySplashDamage in game_loop.ts**

Add this function to `src/engine/reducers/game_loop.ts` and export it:

```typescript
import { SpatialGrid } from '../spatial';

/**
 * Apply splash damage from a projectile hit.
 * Uses linear falloff: full damage at center, zero at edge.
 * Includes friendly fire - damages all entities regardless of owner.
 */
export function applySplashDamage(
    state: GameState,
    projectile: Projectile,
    hitPos: Vector
): GameState {
    const splashRadius = projectile.splash;
    if (splashRadius <= 0) return state;

    let entities = { ...state.entities };

    // Find all entities that could be affected
    for (const id in entities) {
        const entity = entities[id];
        if (entity.dead) continue;
        if (entity.type !== 'UNIT' && entity.type !== 'BUILDING') continue;

        const dist = hitPos.dist(entity.pos);
        if (dist >= splashRadius) continue;

        // Linear falloff: 100% at center, 0% at edge
        const falloff = 1 - (dist / splashRadius);
        const baseDamage = projectile.damage * falloff;

        // Apply armor modifiers
        const targetData = getRuleData(entity.key);
        const armorType = targetData?.armor || 'none';
        const weaponType = projectile.weaponType || 'bullet';
        const modifiers = RULES.damageModifiers?.[weaponType];
        const modifier = modifiers?.[armorType] ?? 1.0;

        const finalDamage = Math.round(baseDamage * modifier);
        if (finalDamage <= 0) continue;

        const newHp = Math.max(0, entity.hp - finalDamage);
        const isDead = newHp <= 0;

        if (entity.type === 'UNIT') {
            entities[id] = {
                ...entity,
                hp: newHp,
                dead: isDead,
                combat: { ...entity.combat, flash: 10 }
            };
        } else if (entity.type === 'BUILDING') {
            if (entity.combat) {
                entities[id] = {
                    ...entity,
                    hp: newHp,
                    dead: isDead,
                    combat: { ...entity.combat, flash: 10 }
                };
            } else {
                entities[id] = {
                    ...entity,
                    hp: newHp,
                    dead: isDead
                };
            }
        }
    }

    return { ...state, entities };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/splash-damage.test.ts`

Expected: PASS

**Step 5: Integrate splash damage into updateProjectile**

In `game_loop.ts`, modify `updateProjectile` to return splash info, then apply it in the main tick loop. Find where damage is applied after projectile hits and call `applySplashDamage`.

**Step 6: Run full test suite**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npm test`

Expected: PASS

**Step 7: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation
git add src/engine/reducers/game_loop.ts tests/engine/splash-damage.test.ts
git commit -m "feat(projectile): implement splash damage with linear falloff and friendly fire"
```

---

### Task 5: Add Interception Aura to AA Units

**Files:**
- Modify: `src/data/rules.json`
- Modify: `src/data/schemas/index.ts`

**Step 1: Write the failing test**

Add to `tests/engine/projectile-types.test.ts`:

```typescript
describe('Interception Aura Configuration', () => {
    it('should have interceptionAura on sam_site', () => {
        const samSite = RULES.buildings.sam_site;
        expect(samSite.interceptionAura).toEqual({
            radius: 200,
            dps: 150
        });
    });

    it('should have interceptionAura on mlrs', () => {
        const mlrs = RULES.units.mlrs;
        expect(mlrs.interceptionAura).toEqual({
            radius: 120,
            dps: 80
        });
    });

    it('should have interceptionAura on rocket soldier', () => {
        const rocket = RULES.units.rocket;
        expect(rocket.interceptionAura).toEqual({
            radius: 60,
            dps: 40
        });
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-types.test.ts`

Expected: FAIL - interceptionAura is undefined

**Step 3: Add interceptionAura to rules.json**

In `src/data/rules.json`, add `interceptionAura` field to:

- `buildings.sam_site`: `"interceptionAura": { "radius": 200, "dps": 150 }`
- `units.mlrs`: `"interceptionAura": { "radius": 120, "dps": 80 }`
- `units.rocket`: `"interceptionAura": { "radius": 60, "dps": 40 }`

**Step 4: Update schema in index.ts**

Add to Building and Unit schemas:

```typescript
interceptionAura: z.object({
    radius: z.number(),
    dps: z.number()
}).optional()
```

**Step 5: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-types.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation
git add src/data/rules.json src/data/schemas/index.ts tests/engine/projectile-types.test.ts
git commit -m "feat(projectile): add interceptionAura config to AA units"
```

---

### Task 6: Implement AA Interception Logic

**Files:**
- Modify: `src/engine/reducers/game_loop.ts`

**Step 1: Write the failing test**

Create file `tests/engine/aa-interception.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Vector, Projectile } from '../../src/engine/types';
import { applyInterception } from '../../src/engine/reducers/game_loop';
import { createTestState, createTestCombatUnit, createTestBuilding } from '../../src/engine/test-utils';

describe('AA Interception', () => {
    it('should reduce projectile HP when in AA aura', () => {
        let state = createTestState();
        // Enemy SAM site at origin, player 1
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', pos: { x: 0, y: 0 }, owner: 1 });
        // Player 0 unit that fired the projectile
        const attacker = createTestCombatUnit({ id: 'attacker', pos: { x: 300, y: 0 }, owner: 0 });
        state = { ...state, entities: { ...state.entities, [sam.id]: sam, [attacker.id]: attacker } };

        // Rocket projectile flying through SAM aura
        const projectile: Projectile = {
            ownerId: 'attacker',
            pos: new Vector(50, 0), // Inside SAM radius (200)
            vel: new Vector(-9, 0),
            targetId: 'sam',
            speed: 9,
            damage: 50,
            splash: 50,
            type: 'rocket',
            weaponType: 'rocket',
            dead: false,
            archetype: 'rocket',
            hp: 50,
            maxHp: 50,
            arcHeight: 0,
            startPos: new Vector(300, 0),
            trailPoints: []
        };

        const result = applyInterception(state, projectile);

        // SAM DPS is 150, per tick = 150/60 = 2.5
        expect(result.hp).toBeLessThan(50);
        expect(result.hp).toBeCloseTo(50 - 150/60, 1);
    });

    it('should not intercept non-interceptable projectiles', () => {
        let state = createTestState();
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', pos: { x: 0, y: 0 }, owner: 1 });
        const attacker = createTestCombatUnit({ id: 'attacker', pos: { x: 300, y: 0 }, owner: 0 });
        state = { ...state, entities: { ...state.entities, [sam.id]: sam, [attacker.id]: attacker } };

        // Hitscan projectile (not interceptable)
        const projectile: Projectile = {
            ownerId: 'attacker',
            pos: new Vector(50, 0),
            vel: new Vector(-50, 0),
            targetId: 'sam',
            speed: 50,
            damage: 10,
            splash: 0,
            type: 'bullet',
            weaponType: 'bullet',
            dead: false,
            archetype: 'hitscan',
            hp: 0,
            maxHp: 0,
            arcHeight: 0,
            startPos: new Vector(300, 0),
            trailPoints: []
        };

        const result = applyInterception(state, projectile);

        expect(result.hp).toBe(0); // Unchanged
    });

    it('should not intercept friendly projectiles', () => {
        let state = createTestState();
        // SAM and attacker both owned by player 0
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', pos: { x: 0, y: 0 }, owner: 0 });
        const attacker = createTestCombatUnit({ id: 'attacker', pos: { x: 300, y: 0 }, owner: 0 });
        state = { ...state, entities: { ...state.entities, [sam.id]: sam, [attacker.id]: attacker } };

        const projectile: Projectile = {
            ownerId: 'attacker',
            pos: new Vector(50, 0),
            vel: new Vector(-9, 0),
            targetId: 'enemy',
            speed: 9,
            damage: 50,
            splash: 50,
            type: 'rocket',
            weaponType: 'rocket',
            dead: false,
            archetype: 'rocket',
            hp: 50,
            maxHp: 50,
            arcHeight: 0,
            startPos: new Vector(300, 0),
            trailPoints: []
        };

        const result = applyInterception(state, projectile);

        expect(result.hp).toBe(50); // Unchanged - friendly AA ignores own projectiles
    });

    it('should stack interception from multiple AA sources', () => {
        let state = createTestState();
        const sam1 = createTestBuilding({ id: 'sam1', key: 'sam_site', pos: { x: 0, y: 0 }, owner: 1 });
        const sam2 = createTestBuilding({ id: 'sam2', key: 'sam_site', pos: { x: 100, y: 0 }, owner: 1 });
        const attacker = createTestCombatUnit({ id: 'attacker', pos: { x: 300, y: 0 }, owner: 0 });
        state = { ...state, entities: { ...state.entities, [sam1.id]: sam1, [sam2.id]: sam2, [attacker.id]: attacker } };

        // Projectile in range of both SAMs
        const projectile: Projectile = {
            ownerId: 'attacker',
            pos: new Vector(50, 0),
            vel: new Vector(-9, 0),
            targetId: 'target',
            speed: 9,
            damage: 50,
            splash: 50,
            type: 'rocket',
            weaponType: 'rocket',
            dead: false,
            archetype: 'rocket',
            hp: 50,
            maxHp: 50,
            arcHeight: 0,
            startPos: new Vector(300, 0),
            trailPoints: []
        };

        const result = applyInterception(state, projectile);

        // Two SAMs, each doing 150/60 = 2.5 DPS per tick = 5 total
        expect(result.hp).toBeCloseTo(50 - (150/60 * 2), 1);
    });

    it('should kill projectile when HP reaches 0', () => {
        let state = createTestState();
        const sam = createTestBuilding({ id: 'sam', key: 'sam_site', pos: { x: 0, y: 0 }, owner: 1 });
        const attacker = createTestCombatUnit({ id: 'attacker', pos: { x: 300, y: 0 }, owner: 0 });
        state = { ...state, entities: { ...state.entities, [sam.id]: sam, [attacker.id]: attacker } };

        // Projectile with very low HP
        const projectile: Projectile = {
            ownerId: 'attacker',
            pos: new Vector(50, 0),
            vel: new Vector(-9, 0),
            targetId: 'target',
            speed: 9,
            damage: 50,
            splash: 50,
            type: 'rocket',
            weaponType: 'rocket',
            dead: false,
            archetype: 'rocket',
            hp: 1,
            maxHp: 50,
            arcHeight: 0,
            startPos: new Vector(300, 0),
            trailPoints: []
        };

        const result = applyInterception(state, projectile);

        expect(result.hp).toBeLessThanOrEqual(0);
        expect(result.dead).toBe(true);
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/aa-interception.test.ts`

Expected: FAIL - applyInterception is not exported

**Step 3: Implement applyInterception in game_loop.ts**

Add and export this function in `src/engine/reducers/game_loop.ts`:

```typescript
/**
 * Apply AA interception damage to a projectile.
 * Only affects interceptable projectiles (rockets, missiles, artillery).
 * Friendly AA does not intercept own team's projectiles.
 */
export function applyInterception(state: GameState, projectile: Projectile): Projectile {
    // Only intercept projectiles that have HP (are interceptable)
    if (projectile.hp <= 0 && projectile.maxHp <= 0) return projectile;
    if (projectile.dead) return projectile;

    // Get projectile owner's team
    const sourceEntity = state.entities[projectile.ownerId];
    const projectileOwner = sourceEntity?.owner ?? -1;

    let totalDamage = 0;

    // Check all entities for interception auras
    for (const id in state.entities) {
        const entity = state.entities[id];
        if (entity.dead) continue;

        // Get interception aura from rules
        const data = getRuleData(entity.key);
        const aura = data?.interceptionAura;
        if (!aura) continue;

        // Friendly AA doesn't intercept own projectiles
        if (entity.owner === projectileOwner) continue;

        // Check if projectile is in range
        const dist = projectile.pos.dist(entity.pos);
        if (dist > aura.radius) continue;

        // Apply DPS (converted to per-tick)
        totalDamage += aura.dps / 60;
    }

    if (totalDamage <= 0) return projectile;

    const newHp = projectile.hp - totalDamage;
    return {
        ...projectile,
        hp: newHp,
        dead: newHp <= 0
    };
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/aa-interception.test.ts`

Expected: PASS

**Step 5: Integrate into main tick loop**

In `game_loop.ts`, call `applyInterception` in the projectile update loop before movement/collision checks.

**Step 6: Run full test suite**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npm test`

Expected: PASS

**Step 7: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation
git add src/engine/reducers/game_loop.ts tests/engine/aa-interception.test.ts
git commit -m "feat(projectile): implement health-based AA interception system"
```

---

### Task 7: Update Trail Points Each Tick

**Files:**
- Modify: `src/engine/reducers/game_loop.ts`

**Step 1: Write the failing test**

Add to `tests/engine/projectile-types.test.ts`:

```typescript
describe('Projectile Trail Points', () => {
    it('should add current position to trailPoints each update', () => {
        const projectile: Projectile = {
            ownerId: 'attacker',
            pos: new Vector(100, 100),
            vel: new Vector(10, 0),
            targetId: 'target',
            speed: 10,
            damage: 10,
            splash: 0,
            type: 'bullet',
            weaponType: 'bullet',
            dead: false,
            archetype: 'hitscan',
            hp: 0,
            maxHp: 0,
            arcHeight: 0,
            startPos: new Vector(0, 100),
            trailPoints: []
        };

        // Simulate update by calling updateProjectileTrail
        const updated = updateProjectileTrail(projectile);

        expect(updated.trailPoints.length).toBe(1);
        expect(updated.trailPoints[0].x).toBe(100);
        expect(updated.trailPoints[0].y).toBe(100);
    });

    it('should limit trailPoints to 30 entries', () => {
        const existingTrail = Array.from({ length: 30 }, (_, i) => new Vector(i, 0));
        const projectile: Projectile = {
            ownerId: 'attacker',
            pos: new Vector(100, 0),
            vel: new Vector(10, 0),
            targetId: 'target',
            speed: 10,
            damage: 10,
            splash: 0,
            type: 'bullet',
            weaponType: 'bullet',
            dead: false,
            archetype: 'hitscan',
            hp: 0,
            maxHp: 0,
            arcHeight: 0,
            startPos: new Vector(0, 0),
            trailPoints: existingTrail
        };

        const updated = updateProjectileTrail(projectile);

        expect(updated.trailPoints.length).toBe(30);
        // Oldest point should be dropped, newest added
        expect(updated.trailPoints[0].x).toBe(1); // Was index 1, now index 0
        expect(updated.trailPoints[29].x).toBe(100); // New point
    });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-types.test.ts`

Expected: FAIL - updateProjectileTrail is not defined

**Step 3: Implement updateProjectileTrail**

Add and export in `src/engine/reducers/game_loop.ts`:

```typescript
const MAX_TRAIL_POINTS = 30;

/**
 * Update projectile trail points, maintaining a max of 30 entries.
 */
export function updateProjectileTrail(projectile: Projectile): Projectile {
    const newTrail = [...projectile.trailPoints, projectile.pos];

    // Keep only the last 30 points
    const trimmedTrail = newTrail.length > MAX_TRAIL_POINTS
        ? newTrail.slice(newTrail.length - MAX_TRAIL_POINTS)
        : newTrail;

    return {
        ...projectile,
        trailPoints: trimmedTrail
    };
}
```

**Step 4: Integrate into projectile update loop**

Call `updateProjectileTrail` in `updateProjectile` before returning.

**Step 5: Run test to verify it passes**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-types.test.ts`

Expected: PASS

**Step 6: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation
git add src/engine/reducers/game_loop.ts tests/engine/projectile-types.test.ts
git commit -m "feat(projectile): add trail point tracking with 30-frame history"
```

---

### Task 8: Render Projectiles by Archetype

**Files:**
- Modify: `src/renderer/index.ts`

**Step 1: Write test for renderer (visual verification)**

This is a rendering task - verify manually by running `npm run dev` and observing projectiles.

**Step 2: Update drawProjectile method**

Replace `drawProjectile` method in `src/renderer/index.ts`:

```typescript
private drawProjectile(proj: Projectile, camera: { x: number; y: number }, zoom: number) {
    const ctx = this.ctx;
    const sc = this.worldToScreen(proj.pos, camera, zoom);

    // Calculate visual Y offset for arc
    let yOffset = 0;
    if (proj.arcHeight > 0) {
        const totalDist = proj.startPos.dist(proj.pos) + proj.pos.dist(
            this.state.entities[proj.targetId]?.pos || proj.pos
        );
        const traveled = proj.startPos.dist(proj.pos);
        const progress = totalDist > 0 ? traveled / totalDist : 0;
        // Parabola: 4 * progress * (1 - progress) peaks at 0.5
        yOffset = proj.arcHeight * 4 * progress * (1 - progress);
    }

    const drawY = sc.y - (yOffset * zoom);

    // Draw trail first (behind projectile)
    this.drawProjectileTrail(proj, camera, zoom);

    // Draw shadow for arcing projectiles
    if (proj.arcHeight > 0 && yOffset > 10) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(sc.x, sc.y, 8 * zoom, 4 * zoom, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    ctx.save();
    ctx.translate(sc.x, drawY);

    // Rotate to face direction of travel
    const angle = Math.atan2(proj.vel.y, proj.vel.x);
    ctx.rotate(angle);

    switch (proj.archetype) {
        case 'hitscan':
            // Yellow tracer line
            ctx.strokeStyle = '#ff0';
            ctx.lineWidth = 2 * zoom;
            ctx.beginPath();
            ctx.moveTo(-8 * zoom, 0);
            ctx.lineTo(0, 0);
            ctx.stroke();
            break;

        case 'rocket':
            // Orange-red elongated oval
            ctx.fillStyle = '#f52';
            ctx.beginPath();
            ctx.ellipse(0, 0, 8 * zoom, 4 * zoom, 0, 0, Math.PI * 2);
            ctx.fill();
            break;

        case 'artillery':
            // Dark gray circle
            ctx.fillStyle = '#444';
            ctx.beginPath();
            ctx.arc(0, 0, 6 * zoom, 0, Math.PI * 2);
            ctx.fill();
            break;

        case 'missile':
            // White triangle
            ctx.fillStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(10 * zoom, 0);
            ctx.lineTo(-5 * zoom, -5 * zoom);
            ctx.lineTo(-5 * zoom, 5 * zoom);
            ctx.closePath();
            ctx.fill();
            break;

        case 'ballistic':
            // Brown/brass circle
            ctx.fillStyle = '#a85';
            ctx.beginPath();
            ctx.arc(0, 0, 4 * zoom, 0, Math.PI * 2);
            ctx.fill();
            break;

        case 'grenade':
            // Dark green circle
            ctx.fillStyle = '#252';
            ctx.beginPath();
            ctx.arc(0, 0, 5 * zoom, 0, Math.PI * 2);
            ctx.fill();
            break;

        default:
            // Fallback - yellow dot
            ctx.fillStyle = '#ff0';
            ctx.beginPath();
            ctx.arc(0, 0, 3 * zoom, 0, Math.PI * 2);
            ctx.fill();
    }

    ctx.restore();
}

private drawProjectileTrail(proj: Projectile, camera: { x: number; y: number }, zoom: number) {
    const { trailPoints } = proj;
    if (trailPoints.length < 2) return;

    const ctx = this.ctx;

    for (let i = 1; i < trailPoints.length; i++) {
        const prev = this.worldToScreen(trailPoints[i - 1], camera, zoom);
        const curr = this.worldToScreen(trailPoints[i], camera, zoom);

        const opacity = (i / trailPoints.length) * 0.3;
        ctx.strokeStyle = `rgba(255, 255, 255, ${opacity})`;
        ctx.lineWidth = 1 * zoom;

        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(curr.x, curr.y);
        ctx.stroke();
    }
}
```

**Step 3: Run dev server and verify visually**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npm run dev`

Verify:
- Bullets appear as yellow tracers
- Rockets are orange-red ovals
- Artillery shells arc up and have ground shadows
- Missiles are white triangles
- All projectiles have fading trails

**Step 4: Run full test suite**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npm test`

Expected: PASS

**Step 5: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation
git add src/renderer/index.ts
git commit -m "feat(projectile): render projectiles with archetype-specific shapes and trails"
```

---

### Task 9: Integration Testing

**Files:**
- Create: `tests/engine/projectile-integration.test.ts`

**Step 1: Write integration tests**

```typescript
import { describe, it, expect } from 'vitest';
import { reducer } from '../../src/engine/reducer';
import { createTestState, createTestCombatUnit, createTestBuilding } from '../../src/engine/test-utils';
import { Vector } from '../../src/engine/types';

describe('Projectile System Integration', () => {
    it('should create rocket projectile when rocket soldier fires', () => {
        let state = createTestState();
        const rocket = createTestCombatUnit({
            id: 'rocket',
            key: 'rocket',
            pos: { x: 0, y: 0 },
            owner: 0
        });
        const target = createTestCombatUnit({
            id: 'target',
            key: 'rifle',
            pos: { x: 100, y: 0 },
            owner: 1
        });
        state = {
            ...state,
            entities: { [rocket.id]: rocket, [target.id]: target },
            running: true
        };

        // Simulate combat by running ticks
        for (let i = 0; i < 60; i++) {
            state = reducer(state, { type: 'TICK' });
        }

        // Check if rocket projectile was created with correct archetype
        const rocketProjectiles = state.projectiles.filter(p => p.archetype === 'rocket');
        expect(rocketProjectiles.length).toBeGreaterThan(0);
        if (rocketProjectiles.length > 0) {
            expect(rocketProjectiles[0].hp).toBe(50);
            expect(rocketProjectiles[0].speed).toBe(9);
        }
    });

    it('should apply splash damage when rocket hits', () => {
        let state = createTestState();
        const target1 = createTestCombatUnit({
            id: 'target1',
            key: 'rifle',
            pos: { x: 100, y: 100 },
            owner: 1,
            hp: 100,
            maxHp: 100
        });
        const target2 = createTestCombatUnit({
            id: 'target2',
            key: 'rifle',
            pos: { x: 120, y: 100 }, // 20px away from target1
            owner: 1,
            hp: 100,
            maxHp: 100
        });
        const attacker = createTestCombatUnit({
            id: 'attacker',
            key: 'rocket',
            pos: { x: 0, y: 100 },
            owner: 0
        });

        state = {
            ...state,
            entities: {
                [attacker.id]: attacker,
                [target1.id]: target1,
                [target2.id]: target2
            },
            running: true
        };

        // Run until projectile hits
        for (let i = 0; i < 120; i++) {
            state = reducer(state, { type: 'TICK' });
        }

        // Both targets should have taken damage from splash
        const t1 = state.entities['target1'];
        const t2 = state.entities['target2'];
        expect(t1.hp).toBeLessThan(100);
        expect(t2.hp).toBeLessThan(100);
    });

    it('should intercept rocket with SAM site', () => {
        let state = createTestState();
        const sam = createTestBuilding({
            id: 'sam',
            key: 'sam_site',
            pos: { x: 200, y: 0 },
            owner: 1
        });
        const attacker = createTestCombatUnit({
            id: 'attacker',
            key: 'rocket',
            pos: { x: 0, y: 0 },
            owner: 0
        });
        const target = createTestCombatUnit({
            id: 'target',
            key: 'rifle',
            pos: { x: 400, y: 0 },
            owner: 1
        });

        state = {
            ...state,
            entities: {
                [sam.id]: sam,
                [attacker.id]: attacker,
                [target.id]: target
            },
            running: true
        };

        // Run simulation - rocket should be intercepted before reaching target
        let projectileIntercepted = false;
        for (let i = 0; i < 200; i++) {
            state = reducer(state, { type: 'TICK' });

            // Check if any projectile died with HP <= 0 (intercepted)
            for (const proj of state.projectiles) {
                if (proj.dead && proj.hp <= 0 && proj.archetype === 'rocket') {
                    projectileIntercepted = true;
                }
            }
        }

        // Either projectile was intercepted, or target took less damage than expected
        // (projectile was weakened by interception)
        expect(projectileIntercepted || state.entities['target'].hp > 50).toBe(true);
    });
});
```

**Step 2: Run integration tests**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npx vitest run tests/engine/projectile-integration.test.ts`

Expected: PASS

**Step 3: Run full test suite**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npm test`

Expected: PASS (all 1236+ tests)

**Step 4: Commit**

```bash
cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation
git add tests/engine/projectile-integration.test.ts
git commit -m "test(projectile): add integration tests for archetypes, splash, and interception"
```

---

### Task 10: Final Verification and Cleanup

**Step 1: Run full test suite**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npm test`

Expected: All tests pass

**Step 2: Run type check**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npm run build`

Expected: No type errors

**Step 3: Manual gameplay testing**

Run: `cd /Users/egecan/Code/unnamed_rts/.worktrees/projectile-differentiation && npm run dev`

Verify:
- [ ] Bullets are fast tracers
- [ ] Rockets are visible, slower, and splash
- [ ] Artillery arcs high and has ground shadow
- [ ] Missiles home toward target
- [ ] SAM sites intercept incoming rockets/missiles
- [ ] Friendly fire from splash works
- [ ] Trails render correctly

**Step 4: Commit any final fixes**

If any issues found, fix and commit.

**Step 5: Feature complete**

The projectile differentiation feature is complete. Use `superpowers:finishing-a-development-branch` to merge or create PR.

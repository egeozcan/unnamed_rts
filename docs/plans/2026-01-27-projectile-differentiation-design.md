# Projectile Differentiation Design

## Overview

Add tactical and visual differentiation to projectiles with six archetypes, splash damage with friendly fire, and AA interception mechanics.

## Projectile Archetypes

| Archetype | Speed (px/tick) | Trajectory | Interceptable | Weapons |
|-----------|-----------------|------------|---------------|---------|
| Hitscan | 50+ | Straight | No | bullet, ap_bullet, sniper, laser |
| Rocket | 9 | Straight | Yes (50 HP) | rocket |
| Artillery | 6 | Parabolic arc | Yes (150 HP) | heavy_cannon |
| Missile | 28 | Homing | Yes (100 HP) | missile, air_missile |
| Ballistic | 14 | Slight arc | No | cannon |
| Grenade | 8 | Lobbed arc | No | grenade |

## Data Model Changes

### Projectile Interface (`types.ts`)

Add to existing Projectile interface:

```typescript
readonly archetype: 'hitscan' | 'rocket' | 'artillery' | 'missile' | 'ballistic' | 'grenade';
readonly hp: number;           // For interception (0 for non-interceptable)
readonly maxHp: number;        // To calculate effects when damaged
readonly arcHeight: number;    // Peak height for arc visualization (0 for straight)
readonly trailPoints: Vector[]; // Recent positions for trail rendering
```

### Weapon Archetypes (`rules.json`)

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
  "grenade": { "archetype": "grenade", "interceptable": false }
}
```

### AA Unit Data (`rules.json`)

Add `interceptionAura` to AA-capable units:

```json
"sam_site": {
  "interceptionAura": { "radius": 200, "dps": 150 }
},
"mlrs": {
  "interceptionAura": { "radius": 120, "dps": 80 }
},
"rocket_soldier": {
  "interceptionAura": { "radius": 60, "dps": 40 }
}
```

## Mechanics

### Arc Calculation

Visual only - collision remains 2D. Height based on distance traveled:

```typescript
const totalDistance = distance(startPos, targetPos);
const progress = distanceTraveled / totalDistance; // 0 to 1
const arcMultiplier = archetype === 'artillery' ? 0.4 :
                      archetype === 'grenade' ? 0.6 :
                      archetype === 'ballistic' ? 0.1 : 0;
const peakHeight = totalDistance * arcMultiplier;
const currentHeight = peakHeight * 4 * progress * (1 - progress); // Parabola
```

Longer shots arc higher, spending more time in flight (more interception opportunity).

### Splash Damage

Linear falloff from center to edge, friendly fire included:

```typescript
function applySplashDamage(state: GameState, projectile: Projectile, hitPos: Vector): GameState {
  const splashRadius = projectile.splash;
  if (splashRadius <= 0) return state;

  const nearby = spatialGrid.getEntitiesInRadius(hitPos, splashRadius);

  for (const entity of nearby) {
    const dist = distance(hitPos, entity.pos);
    if (dist > splashRadius) continue;

    // Linear falloff: 100% at center, 0% at edge
    const falloff = 1 - (dist / splashRadius);
    const damage = projectile.damage * falloff;

    // Apply armor modifiers
    const finalDamage = damage * getArmorModifier(projectile.type, entity.armor);

    // Friendly fire - no owner check
    state = applyDamage(state, entity.id, finalDamage, projectile.ownerId);
  }

  return state;
}
```

### AA Interception

Health-based passive aura. Multiple AA sources stack:

```typescript
function applyInterception(state: GameState, projectile: Projectile): Projectile {
  if (!projectile.interceptable || projectile.hp <= 0) return projectile;

  const projectileOwner = getEntityOwner(state, projectile.ownerId);
  let totalDamage = 0;

  for (const entity of state.entities) {
    if (!entity.interceptionAura) continue;
    if (entity.owner === projectileOwner) continue; // Friendly AA ignores own projectiles

    const dist = distance(projectile.pos, entity.pos);
    if (dist > entity.interceptionAura.radius) continue;

    totalDamage += entity.interceptionAura.dps / 60; // Per tick
  }

  const newHp = projectile.hp - totalDamage;
  return { ...projectile, hp: newHp, dead: newHp <= 0 };
}
```

Intercepted projectiles disappear without exploding (no splash).

## Visual Rendering

### Projectile Shapes

| Archetype | Shape | Color | Size |
|-----------|-------|-------|------|
| Hitscan | Line (tracer) | Yellow | 2px wide, 8px long |
| Rocket | Elongated oval | Orange-red | 4x8px |
| Artillery | Circle | Dark gray | 6px radius |
| Missile | Triangle (pointed) | White | 5x10px |
| Ballistic | Circle | Brown/brass | 4px radius |
| Grenade | Circle | Dark green | 5px radius |

### Trails

Minimal style with medium persistence (0.5s / ~30 frames):

```typescript
function renderProjectileTrail(ctx: CanvasRenderingContext2D, projectile: Projectile) {
  const { trailPoints } = projectile;
  if (trailPoints.length < 2) return;

  ctx.beginPath();
  ctx.moveTo(trailPoints[0].x, trailPoints[0].y);

  for (let i = 1; i < trailPoints.length; i++) {
    const opacity = i / trailPoints.length;
    ctx.strokeStyle = `rgba(255, 255, 255, ${opacity * 0.3})`;
    ctx.lineTo(trailPoints[i].x, trailPoints[i].y);
  }
  ctx.stroke();
}
```

### Arc Shadow

For artillery/grenades, render elliptical shadow at target position:

```typescript
if (projectile.arcHeight > 0) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  ctx.beginPath();
  ctx.ellipse(targetPos.x, targetPos.y, 8, 4, 0, 0, Math.PI * 2);
  ctx.fill();
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `src/engine/types.ts` | Add archetype, hp, maxHp, arcHeight, trailPoints to Projectile |
| `src/data/rules.json` | Add weaponArchetypes section, add interceptionAura to AA units |
| `src/engine/reducers/helpers.ts` | Update createProjectile for archetype-specific values |
| `src/engine/reducers/game_loop.ts` | Add applyInterception, applySplashDamage, arc calc, trail tracking |
| `src/renderer/index.ts` | New projectile rendering per archetype, trails, arc shadows |

## Test Coverage

- Splash damage falloff calculations
- Friendly fire splash damage
- AA interception damage accumulation
- Projectile HP depletion and death
- Multiple AA aura stacking
- Arc height calculations by distance

## Gameplay Impact

- Artillery becomes powerful but counterable with AA positioning
- Mixed army composition matters (need AA escort for offensive pushes)
- Splash weapons require positioning care (friendly fire risk)
- Long-range artillery shots are riskier (more time for interception)

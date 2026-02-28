# Team Alliances Design

## Overview

Add fixed team alliances (A/B/C/D) to the RTS game. Players choose a team during skirmish setup. Allied players cannot attack each other, share fog of war, can build near each other's buildings, and win or lose together. Alliances are fixed for the duration of the game.

## Data Model

Add a `team` field to `PlayerState`:

```typescript
readonly team: 'A' | 'B' | 'C' | 'D' | null;  // null = no team (FFA)
```

Add the same field to `SkirmishConfig` player entries.

Three utility functions:

```typescript
function sameTeam(state: GameState, p1: number, p2: number): boolean {
    const t1 = state.players[p1]?.team;
    const t2 = state.players[p2]?.team;
    return t1 !== null && t1 !== undefined && t1 === t2;
}

function isAlly(state: GameState, p1: number, p2: number): boolean {
    return p1 === p2 || sameTeam(state, p1, p2);
}

function isEnemy(state: GameState, p1: number, p2: number): boolean {
    return p1 !== p2 && !sameTeam(state, p1, p2);
}
```

`isAlly` treats same-player as ally. `isEnemy` is the inverse. Neutral entities (`owner === -1`) have no team, so they are never considered allies of any player.

## Combat & Targeting

All `other.owner !== unit.owner` checks replaced with `isEnemy()`:

- **`combat.ts` — `findCombatTarget()`**: Predicate uses `isEnemy()` for attack targets, `isAlly()` for healers/medics/engineer repair.
- **`combat.ts` — attack commands**: Force-attacking an ally is rejected.
- **`ai/index.ts` — enemy filtering**: The upstream filter that builds the `enemies` array changes from `owner !== playerId` to `isEnemy(state, playerId, entity.owner)`.
- **`ai/planning.ts` — `detectThreats()`**: Receives pre-filtered enemies array, so no direct change needed — fixed upstream.
- **`ai/action_combat.ts` — `selectBestTarget()`**: Same — operates on pre-filtered enemies.
- **Auto-acquire targets**: All stances go through `findCombatTarget()`, so fixing that one function handles all.

## Victory & Defeat Conditions

- **Elimination**: Unchanged — 0 buildings + 0 MCVs = eliminated, all units killed.
- **Win condition**: Instead of "1 player remains", all surviving players must share the same team (or be a single teamless player). Store the winning player ID in `winner` as before.
- **Human spectator mode**: When human is eliminated but a teammate lives, don't show end screen. Human enters spectator mode with free camera, no controls, shared ally fog of war. End screen appears when team wins ("MISSION ACCOMPLISHED") or all allies die ("MISSION FAILED").
- **End screen**: Human's team wins → "MISSION ACCOMPLISHED". Human's team loses → "MISSION FAILED". All eliminated → "DRAW".

## Building Placement

Build range check changes from `building.owner === playerId` to `isAlly(state, building.owner, playerId)`. Players can build within 400px of any ally building. The placed building is owned by the placing player. Sell and repair remain owner-only.

## Fog of War

Shared vision for allied players. The entity filter for fog grid computation changes from `entity.owner === humanPlayerId` to `isAlly(state, entity.owner, humanPlayerId)`. When spectating after elimination, fog continues based on living ally's vision.

AI fog of war behavior is unaffected (AI uses its own threat detection radius logic).

## Skirmish UI

Add a team `<select>` dropdown per player slot with options: `— (no team)`, `A`, `B`, `C`, `D`. Disabled when slot is `none`. Persisted to localStorage. No validation on team composition — player's choice.

## Minimap & Rendering

No changes. Allies keep their own player colors. Selection remains owner-only.

## AI Behavior

Independent play — each AI plays its own game normally, just treats teammates as non-targets. No strategic coordination between allied AI players.

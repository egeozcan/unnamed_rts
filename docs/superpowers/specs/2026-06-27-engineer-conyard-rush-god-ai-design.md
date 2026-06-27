# Engineer Conyard Rush God AI Design

## Goal

Upgrade only the `engineer_conyard_rush` AI so it performs as a top Elo contender in the default tournament while keeping the strategy fair. The AI must keep an engineer rush identity, but it may pivot into the best state-observable follow-up when capture pressure alone is no longer the winning line.

## Fairness Constraints

- Make decisions only from observable `GameState` facts: own units, own buildings, visible enemy entities, resources, map geometry, queues, health, positions, and ownership.
- Do not read or branch on opponent `aiImplementationId`, implementation names, player identities as strategy labels, or hardcoded opponent-specific behavior.
- Emit actions only for the acting player's own controllable units, buildings, and queues.
- Never issue enemy-owned sell, repair, rally, production, or transport control actions.
- If an exploit is discovered, do not use it for performance. Add AI-side validation where appropriate and report it.

## Strategy

The upgraded AI will remain a conyard capture specialist, but it will behave less like a single-script rush and more like a mission commander:

1. Build the capture package quickly: barracks, factory, enough engineers, and enough APC seats.
2. Deliver engineers through APCs whenever transport improves survival or speed.
3. Select conyard targets from state facts: distance, existing claims, target health, target ownership, nearby threats, and current mission saturation.
4. Preserve the rush when multiple enemy conyards remain, rotating pressure without overcommitting all engineers to the same low-value route.
5. Convert captures into wins by fortifying captured ground, rebuilding economy, and continuing pressure only while it is still tactically justified.

## Components

### Action Safety Layer

Add a local action sanitization step inside `engineer_conyard_rush` before returning actions. It will preserve valid classic and rush actions while dropping any action that attempts to command enemy-owned units/buildings or uses the wrong `playerId`.

This protects the implementation from accidental exploit paths without changing reducer behavior or opponent AIs.

### Capture Planning

Introduce a small internal planning model for conyard missions:

- Track active target claims per tick to avoid redundant assignments.
- Score each visible enemy conyard by capture value, travel distance, local danger, and current engineer/APC availability.
- Assign loaded APCs first, then untransported engineers.
- Keep mission state minimal and derived from live entities where possible.

The planner may choose a safer or closer conyard over a farther one if that improves expected capture success. It must not use opponent identity.

### APC Delivery

Improve transport behavior around three moments:

- Boarding: reserve seats deterministically and send engineers to the nearest available own APC.
- Approach: send loaded APCs toward the selected target and avoid retarget churn when the current target is still valid.
- Unload: unload close enough that engineers can enter quickly, then immediately issue capture commands for unloaded engineers.

The implementation should avoid unloading so far away that engineers walk through avoidable fire, while still unloading before APC collision or weapon behavior stalls the capture.

### Production Policy

Tune production around mission phases:

- Pre-capture: prioritize the minimum viable capture package, then add redundancy if enemy conyards remain.
- Active capture: avoid overproducing engineers/APCs once enough payload is built, queued, or loaded.
- Post-capture: stop pure rush production when no enemy conyards remain, but keep enough capture pressure if other conyards are still alive.
- Fallback: if capture pressure stalls, invest in economy and combat through observable needs rather than staying locked in a failed rush.

### Post-Capture Conversion

After capturing a conyard, the AI should immediately treat it as a forward base:

- Ensure power is healthy from actual alive buildings, not stale player counters.
- Build or preserve barracks/factory access.
- Add nearby defenses using the existing defense building order.
- Bias vehicle production toward harvesters until refinery capacity is supported.
- Continue attacking remaining conyards if they exist; otherwise remove stale engineer/APC rush builds.

Captured refineries may still be sold for a cash swing when they were not initially owned.

## Data Flow

`computeEngineerConyardRushAiActions` will keep using `computeClassicAiActions` as the base macro layer. The rush implementation will then:

1. Build entity lists from the shared `EntityCache`.
2. Initialize and update local runtime tracking for initially owned and captured structures.
3. Remove or override low-priority base actions when capture/post-capture priorities require it.
4. Add rush production, mission commands, and post-capture conversion actions.
5. Sanitize the final action list before returning it.

## Testing

Add focused tests in `tests/engine/ai_engineer_conyard_rush.test.ts` for:

- Action safety: no enemy-owned command/control actions are emitted.
- State-only target choice: target assignment responds to distance/threat/claims, not player identity.
- APC behavior: loaded APCs preserve valid targets, unload in capture range, and reissue engineer capture commands.
- Production caps: enough engineers/APCs are produced without runaway queue waste.
- Post-capture conversion: captured conyards are kept, defenses/economy are prioritized, and remaining enemy conyards still receive pressure.

Run at least:

```bash
npm run build
npm test -- tests/engine/ai_engineer_conyard_rush.test.ts
nice -n 15 npm run ai:tournament -- --games-per-matchup 2 --max-ticks 40000
```

Use quick iteration probes as needed:

```bash
npm run ai:simulate -- --games 8 --ai1 engineer_conyard_rush --ai2 titan --max-ticks 40000 --seed 424242
npm run ai:simulate -- --games 8 --ai1 titan --ai2 engineer_conyard_rush --max-ticks 40000 --seed 424242
```

## Out Of Scope

- Modifying opponent/reference AI implementations.
- Changing reducer rules, unit stats, tournament scoring, or map generation to favor this AI.
- Adding opponent-specific branches.
- Guaranteeing literal 100% win rate across all possible seeds; the target is default tournament dominance under fair play.

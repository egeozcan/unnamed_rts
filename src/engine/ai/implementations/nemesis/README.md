# Nemesis AI

An air-cavalry AI. It takes Aurora Sovereign's proven economy and ground play as a chassis,
then plays a strategy no other built-in AI uses: an early tech switch into massed attack
helicopters, with its own build order, budget, placement and air micro on top.

## Why helicopters

An equal-budget duel lab (open field, attack-move, 3 seeds per pairing) ranked every
combat unit and Aurora's heavy/rocket mix against each other. Helicopters won every
pairing at 8,000 credits a side, including against rocket infantry and Aurora's mix. At
20,000 a side only massed MLRS beats them. The rest of the rules make it worse for the
opponents:

- Turrets, pillboxes and all bullet, cannon and flame weapons cannot target air.
- The shared counter-unit logic (`getCounterUnits`) answers a "light armor" army with
  rifles, commandos and tanks, none of which can shoot aircraft.
- No other built-in AI ever builds a helicopter, so none of them has been tuned against one.

## Layers

| Layer | What it does |
|---|---|
| Air opening | Scripted build `power, refinery, barracks, factory, tech, airforce_command, refinery, power, refinery`. It holds the building lane and blocks chassis vehicle production until it is done. The first helicopter flies around tick 4,800. |
| Macro plan | Rebuilds lost production and air tech first, holding back chassis ground spend while it does. Then it grows refineries (3, 4, 5 over time), keeps 2 harvesters per refinery, and adds a 2nd/3rd Air-Force Command once credits are banked. |
| Budget gate | Production queues pay in the order building, infantry, vehicle, **air**, so unchecked ground spending starves the helicopters. Chassis vehicles and infantry only start above a credit reserve, unless the base is under attack. The chassis's queues are also kept one deep, because it otherwise piles 99 heavies into the vehicle queue. |
| Power governor | Low power quarters every queue's speed. If a build would cause a brownout, it is cancelled (full refund) and a power plant goes first. |
| Sheltered placement | The Tech Center and Air-Force Commands are placed on the far side of the base from the enemy. |
| Heli command | All helicopters focus one target. Home defence comes first, with a wider radius for artillery and MLRS, which shell from range and cannot shoot back at air. Otherwise strikes start from 2 helicopters, preferring harvesters, anti-air and production, and skipping targets whose anti-air cover outweighs the wing. |
| Kiting | Helicopter range is 300, rockets 240, stealth tanks 180. Between shots a helicopter backs off to just outside the threat's range, then re-engages. |

## Fair play

- Every action targets only this player's own units, buildings and queues.
  `sanitizeNemesisActions` enforces this, and the tests check it.
- All actions go through the normal reducer, at the same difficulty modifiers as everyone else.
- It reads the same `GameState` every built-in AI receives. Fog of war only applies to human players.
- It never reads other AIs' internal state.

## Tried and dropped

These were measured in simulation and removed because they did not pay off:

- A hidden "lifeboat" MCV, since a player only loses with zero buildings and zero MCVs.
- Hijacker piracy against enemy harvesters.
- Engineer decapitation of exposed conyards.
- An infiltrator sentry.

The lifeboat and piracy each cost 4–6 wins per 40 games. The sentry and decapitation
changed nothing measurable.

## Tuning workflow

Headless matches against every other AI, both seats:

```bash
npm run ai:simulate -- --games 10 --ai1 nemesis --ai2 aurora_sovereign
npm run ai:tournament -- --games-per-matchup 2 --seed 42
```

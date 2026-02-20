# Sentinel Opportunist AI

Defense-first AI that builds slowly, holds a large garrison, and uses
engineers/hijackers opportunistically when the macro state is safe.

## Highlights

- Timed push windows to reduce endless turtling.
- Production pacing for infantry/vehicle starts when safe.
- Specialist safety gates and projected caps (`engineer=1`, `hijacker=2`).
- Demo truck bias disabled (no demo truck starts or demo assault handler use).

## Runtime State

`state.ts` stores per-player runtime fields used for:

- production pacing timestamps
- push-window activation timestamps

## Manual Simulation Gate

Run hard-difficulty fixed-seed simulations in both seat orders:

```bash
npm run ai:simulate -- --games 20 --max-ticks 22000 --seed 20260217 --ai1 sentinel_opportunist --ai2 hydra
npm run ai:simulate -- --games 20 --max-ticks 22000 --seed 20260217 --ai1 hydra --ai2 sentinel_opportunist
npm run ai:simulate -- --games 20 --max-ticks 22000 --seed 20260217 --ai1 sentinel_opportunist --ai2 classic
npm run ai:simulate -- --games 20 --max-ticks 22000 --seed 20260217 --ai1 classic --ai2 sentinel_opportunist
npm run ai:simulate -- --games 20 --max-ticks 22000 --seed 20260217 --ai1 sentinel_opportunist --ai2 eco_tank_all_in
npm run ai:simulate -- --games 20 --max-ticks 22000 --seed 20260217 --ai1 eco_tank_all_in --ai2 sentinel_opportunist
```

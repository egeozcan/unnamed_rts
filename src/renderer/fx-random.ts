/**
 * Random numbers for purely visual effects (particles, screen shake). Kept separate from
 * Math.random, which the simulation uses: how many effects get drawn depends on frame rate,
 * view and particle budgets, and must not advance the simulation's random stream.
 */
let state = 0x9e3779b9;

export function fxRandom(): number {
    // mulberry32
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

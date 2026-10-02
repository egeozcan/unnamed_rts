/**
 * Per-subsystem timing harness for a seeded AI-vs-AI match.
 *
 * Usage: npx tsx src/scripts/profile_sim.ts [--ticks N] [--map-size s] [--seed N] [--headless 0|1]
 * Add `node --cpu-prof --import tsx` in front for a V8 CPU profile.
 */
import { tick, update } from '../engine/reducer.js';
import { computeAiActions, resetAIState } from '../engine/ai/index.js';
import { createEntityCache } from '../engine/perf.js';
import { clearScoreCache } from '../engine/scores.js';
import { createTestCombatUnit, createTestHarvester } from '../engine/test-utils.js';
import type { UnitKey } from '../engine/types.js';
import { createGameState, deriveGameSeed, withSeededRandom } from './sim_runner.js';

const argv = process.argv.slice(2);
const opt = (name: string, def: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : def;
};
const ticks = parseInt(opt('ticks', '6000'), 10);
const mapSize = opt('map-size', 'medium') as 'small' | 'medium' | 'large' | 'huge';
const seed = parseInt(opt('seed', '1337'), 10);
const headless = opt('headless', '1') === '1';
const extraUnits = parseInt(opt('extra-units', '0'), 10);

withSeededRandom(deriveGameSeed(seed, 0), () => {
    let state = createGameState('classic', 'classic', 'hard', mapSize, 'medium', 'medium');
    state = { ...state, headless };
    // Optional stress: add N combat units (+N/8 harvesters) per player around their base.
    if (extraUnits > 0) {
        const entities = { ...state.entities };
        for (const pid of Object.keys(state.players).map(Number)) {
            const cy = entities[`cy_p${pid}`];
            const keys: UnitKey[] = ['rifle', 'heavy', 'rocket', 'light'];
            for (let i = 0; i < extraUnits; i++) {
                const x = cy.pos.x - 250 + (i % 12) * 42;
                const y = cy.pos.y + 140 + Math.floor(i / 12) * 42;
                const u = createTestCombatUnit({ id: `x_${pid}_${i}`, owner: pid, key: keys[i % keys.length] as 'rifle', x, y });
                entities[u.id] = u;
            }
            for (let i = 0; i < Math.ceil(extraUnits / 8); i++) {
                const h = createTestHarvester({ id: `xh_${pid}_${i}`, owner: pid, x: cy.pos.x + 100 + i * 40, y: cy.pos.y - 120 });
                entities[h.id] = h;
            }
        }
        state = { ...state, entities };
    }
    const pids = Object.keys(state.players).map(Number);
    pids.forEach(resetAIState);
    clearScoreCache();

    let aiMs = 0, updateMs = 0, tickMs = 0, worst = 0;
    const now = () => performance.now();
    const t0 = now();
    for (let t = 0; t < ticks; t++) {
        const a = now();
        const cache = createEntityCache(state.entities);
        const lists = pids.map(pid => computeAiActions(state, pid, cache));
        const b = now();
        for (const l of lists) for (const act of l) state = update(state, act);
        const c = now();
        state = tick(state);
        const d = now();
        aiMs += b - a; updateMs += c - b; tickMs += d - c;
        worst = Math.max(worst, d - a);
        if (state.winner !== null) break;
    }
    const total = now() - t0;
    const n = state.tick;
    let units = 0, buildings = 0;
    for (const id in state.entities) {
        const e = state.entities[id];
        if (e.type === 'UNIT') units++; else if (e.type === 'BUILDING') buildings++;
    }
    // Order-independent-ish fingerprint of the final state, used to verify an
    // optimization did not change simulation behavior.
    let h = 2166136261 >>> 0;
    const mix = (v: number) => { h = Math.imul(h ^ (Math.round(v * 100) | 0), 16777619) >>> 0; };
    for (const id of Object.keys(state.entities).sort()) {
        const e = state.entities[id];
        mix(e.pos.x); mix(e.pos.y); mix(e.hp); mix(e.owner);
    }
    for (const pid of pids) mix(state.players[pid].credits);
    console.log(JSON.stringify({
        fingerprint: h.toString(16),
        ticks: n, units, buildings, headless,
        totalMs: +total.toFixed(0),
        msPerTick: +(total / n).toFixed(3),
        aiPerTick: +(aiMs / n).toFixed(3),
        updatePerTick: +(updateMs / n).toFixed(3),
        tickPerTick: +(tickMs / n).toFixed(3),
        worstTickMs: +worst.toFixed(1),
    }));
});

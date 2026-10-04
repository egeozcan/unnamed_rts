/**
 * Headless army-vs-army combat simulator for balance work.
 *
 * Two armies are spawned on an open, rock-free, resource-free map and ordered to attack-move into each
 * other through the real reducer actions; the normal combat code does all targeting. A light "commander"
 * stands in for the player: it re-issues attack-moves to idle units and launches docked Harriers (which
 * never act on their own in the real game either). A fight ends when one side has no combat-capable units
 * left, nobody has taken damage for a while (stalemate), or the tick cap is hit.
 *
 * Usage:
 *   npm run balance:sim -- --a rifle:10,rocket:4 --b heavy:3
 *   npm run balance:sim -- --budget 6000 --a rifle:1 --b heavy:1 --seeds 5 --verbose
 *   npm run balance:sim -- --matrix --budget 6000 --out matrix.json
 *   npm run balance:sim -- --comps comps.json --budget 6000 --out comps_matrix.json
 * Run with --help for every flag.
 */
import { fork, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import { fileURLToPath } from 'url';
import { Action, AirUnit, BuildingEntity, Entity, EntityId, GameState, PlayerState, Vector } from '../engine/types.js';
import { INITIAL_STATE, update, createPlayerState, tick, createEntity } from '../engine/reducer.js';
import { RULES, isUnitData } from '../data/schemas/index.js';
import { mulberry32, withSeededRandom } from './sim_runner.js';
import { CliArgError, parseIntegerArg, runCli } from './cli_args.js';

// ============ TYPES ============

/** unit key -> count (explicit mode) or weight (budget mode) */
export type Comp = Record<string, number>;

export interface ArmySpec {
    /** unit key -> number of units; a fractional count spawns the last unit with proportional hp */
    units: Comp;
}

export interface FightSpec {
    left: ArmySpec;
    right: ArmySpec;
    seed: number;
    maxTicks?: number;
    /** pixels between the two armies' front lines */
    separation?: number;
    /** end the fight when no unit has lost hp for this many ticks */
    stallTicks?: number;
    trackDamage?: boolean;
}

export interface DamageStats {
    /** attacker unit key -> damage dealt to enemies */
    dealt: Record<string, number>;
    /** victim unit key -> damage taken */
    taken: Record<string, number>;
    /** attacker unit key -> enemy units killed */
    kills: Record<string, number>;
    /** attacker unit key -> damage dealt to its own side (splash) */
    friendlyFire: Record<string, number>;
}

export interface FightResult {
    /** 0 = left side, 1 = right side, null = nobody eliminated */
    winner: 0 | 1 | null;
    reason: 'elimination' | 'stalemate' | 'tick_cap';
    ticks: number;
    startValue: [number, number];
    /** remaining cost-value fraction per side: sum(hp/maxHp*cost) of survivors / starting value */
    remaining: [number, number];
    survivors: [Comp, Comp];
    damage?: [DamageStats, DamageStats];
}

// ============ ARMY CONSTRUCTION ============

export const DEFAULT_EXCLUDED_UNITS = ['harvester', 'mcv', 'induction_rig', 'engineer', 'medic', 'hijacker', 'demo_truck'];

export function unitCost(key: string): number {
    const data = RULES.units[key];
    if (!data) throw new CliArgError(`unknown unit "${key}" (known: ${Object.keys(RULES.units).join(', ')})`);
    return data.cost;
}

export function parseComp(raw: string): Comp {
    const comp: Comp = {};
    for (const part of raw.split(',').map(s => s.trim()).filter(Boolean)) {
        const [key, numRaw] = part.split(':').map(s => s.trim());
        unitCost(key);
        const n = numRaw === undefined ? 1 : Number(numRaw);
        if (!Number.isFinite(n) || n <= 0) throw new CliArgError(`bad count/weight in "${part}"`);
        comp[key] = (comp[key] || 0) + n;
    }
    if (Object.keys(comp).length === 0) throw new CliArgError(`empty composition "${raw}"`);
    return comp;
}

/**
 * Turns a weighted composition into unit counts that spend `budget`. Each type gets its weighted share
 * of the budget. With fill 'floor' only whole units are bought (leftover is spent greedily on whole
 * units that still fit); with 'partial' the remainder of each share becomes one extra unit with
 * proportionally reduced hp, so every army is worth exactly `budget`.
 */
export function compFromBudget(weights: Comp, budget: number, fill: 'floor' | 'partial' = 'partial'): Comp {
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    const counts: Comp = {};
    let leftover = budget;
    for (const [key, w] of Object.entries(weights)) {
        const share = budget * w / total;
        const cost = unitCost(key);
        const n = fill === 'partial' ? share / cost : Math.floor(share / cost);
        counts[key] = n;
        leftover -= n * cost;
    }
    if (fill === 'floor') {
        // Spend what is left on whole units, most under-filled type first
        const keys = Object.keys(weights).sort((a, b) => unitCost(a) - unitCost(b));
        let bought = true;
        while (bought) {
            bought = false;
            for (const key of keys) {
                if (unitCost(key) <= leftover) {
                    counts[key] += 1;
                    leftover -= unitCost(key);
                    bought = true;
                    break;
                }
            }
        }
    }
    for (const key of Object.keys(counts)) if (counts[key] <= 1e-9) delete counts[key];
    return counts;
}

export function compValue(comp: Comp): number {
    let v = 0;
    for (const [key, n] of Object.entries(comp)) v += n * unitCost(key);
    return v;
}

function weaponTargeting(key: string): { ground: boolean; air: boolean } {
    const data = RULES.units[key];
    const t = RULES.weaponTargeting?.[data?.weaponType || 'bullet'] || { canTargetGround: true, canTargetAir: false };
    return { ground: t.canTargetGround, air: t.canTargetAir };
}

function isFlying(key: string): boolean {
    return RULES.units[key]?.fly === true;
}

/** A unit that can hurt something at all (medics, engineers, hijackers and trucks don't count) */
function isCombatCapable(key: string): boolean {
    const data = RULES.units[key];
    if (!data || !(data.damage > 0) || !data.weaponType) return false;
    const t = weaponTargeting(key);
    return t.ground || t.air;
}

// ============ STATE SETUP ============

const MAP_W = 3000;
const MAP_H = 2000;

interface Side {
    owner: 0 | 1;
    /** x of this side's front line */
    frontX: number;
    /** +1 when facing right (left side), -1 when facing left */
    facing: 1 | -1;
}

function buildSide(
    entities: Record<EntityId, Entity>,
    army: ArmySpec,
    side: Side,
    state: GameState,
    rand: () => number,
    keyById: Record<EntityId, string>
): void {
    const cy = MAP_H / 2;
    const prefix = side.owner === 0 ? 'L' : 'R';

    // Expand counts into individual units; a fractional count adds one damaged unit
    const roster: { key: string; hpFrac: number }[] = [];
    for (const [key, n] of Object.entries(army.units)) {
        const whole = Math.floor(n + 1e-9);
        for (let i = 0; i < whole; i++) roster.push({ key, hpFrac: 1 });
        const frac = n - whole;
        if (frac > 1e-6) roster.push({ key, hpFrac: frac });
    }

    // Ground formation: short-ranged units in front, long-ranged ones behind
    const ground = roster.filter(u => !(u.key === 'harrier'));
    ground.sort((a, b) => (RULES.units[a.key].range || 0) - (RULES.units[b.key].range || 0) || a.key.localeCompare(b.key));
    const harriers = roster.filter(u => u.key === 'harrier');

    let idx = 0;
    let depth = 0;
    let i = 0;
    while (i < ground.length) {
        // Build one rank of up to 12 units of similar size
        const rank = ground.slice(i, i + 12);
        const maxW = Math.max(...rank.map(u => RULES.units[u.key].w || 20));
        const spacing = Math.max(30, maxW + 14);
        for (let r = 0; r < rank.length; r++) {
            const u = rank[r];
            const lateral = (r - (rank.length - 1) / 2) * spacing;
            const jx = (rand() - 0.5) * 12;
            const jy = (rand() - 0.5) * 12;
            const x = side.frontX - side.facing * (depth + maxW / 2) + jx;
            const y = cy + lateral + jy;
            const ent = createEntity(x, y, side.owner, 'UNIT', u.key, state);
            const id = `${prefix}_${u.key}_${idx++}`;
            const hp = Math.max(1, Math.round(ent.maxHp * u.hpFrac));
            const facingRot = side.facing === 1 ? 0 : Math.PI;
            entities[id] = {
                ...ent,
                id,
                hp,
                movement: ent.type === 'UNIT' ? { ...ent.movement, rotation: facingRot } : (ent as any).movement
            } as Entity;
            keyById[id] = u.key;
        }
        depth += spacing;
        i += rank.length;
    }

    // Harriers live docked in Air-Force Commands well behind the army (6 slots each)
    if (harriers.length > 0) {
        const baseCount = Math.ceil(harriers.length / 6);
        const maxAmmo = RULES.units.harrier?.ammo || 1;
        for (let b = 0; b < baseCount; b++) {
            const bx = side.frontX - side.facing * 700;
            const by = cy + (b - (baseCount - 1) / 2) * 140;
            const base = createEntity(bx, by, side.owner, 'BUILDING', 'airforce_command', state) as BuildingEntity;
            const baseId = `${prefix}_afc_${b}`;
            const slots: (EntityId | null)[] = [...base.airBase!.slots];
            const docked = harriers.slice(b * 6, b * 6 + 6);
            for (let s = 0; s < docked.length; s++) {
                const u = docked[s];
                const h = createEntity(bx, by, side.owner, 'UNIT', 'harrier', state) as AirUnit;
                const id = `${prefix}_harrier_${idx++}`;
                entities[id] = {
                    ...h,
                    id,
                    hp: Math.max(1, Math.round(h.maxHp * u.hpFrac)),
                    airUnit: { ...h.airUnit, state: 'docked', homeBaseId: baseId, dockedSlot: s, ammo: maxAmmo, maxAmmo }
                };
                slots[s] = id;
                keyById[id] = 'harrier';
            }
            entities[baseId] = { ...base, id: baseId, airBase: { ...base.airBase!, slots } };
        }
    }
}

export function createFightState(spec: FightSpec, keyById: Record<EntityId, string> = {}): GameState {
    const separation = spec.separation ?? 700;
    const rand = mulberry32(spec.seed ^ 0x5bd1e995);
    const players: Record<number, PlayerState> = {
        0: createPlayerState(0, false, 'medium', '#4488ff'),
        1: createPlayerState(1, false, 'medium', '#ff4444'),
    };
    const base: GameState = {
        ...INITIAL_STATE,
        // 'menu' mode skips the building-based elimination check (armies have no bases)
        mode: 'menu',
        running: true,
        headless: true,
        entities: {},
        players,
        config: { width: MAP_W, height: MAP_H, resourceDensity: 'low', rockDensity: 'low' },
    };
    const entities: Record<EntityId, Entity> = {};
    buildSide(entities, spec.left, { owner: 0, frontX: MAP_W / 2 - separation / 2, facing: 1 }, base, rand, keyById);
    buildSide(entities, spec.right, { owner: 1, frontX: MAP_W / 2 + separation / 2, facing: -1 }, base, rand, keyById);
    return { ...base, entities };
}

// ============ COMMANDER ============

const COMMAND_INTERVAL = 30;

function centroid(units: Entity[]): Vector | null {
    if (units.length === 0) return null;
    let x = 0, y = 0;
    for (const u of units) { x += u.pos.x; y += u.pos.y; }
    return new Vector(x / units.length, y / units.length);
}

/** Orders a stand-in player would give: keep idle units pushing into the enemy, launch docked Harriers */
function commanderActions(state: GameState, owner: number, initial: boolean): Action[] {
    const enemyGround: Entity[] = [];
    const enemyAir: Entity[] = [];
    const idleByClass: Record<string, EntityId[]> = {};
    const dockedHarriers: AirUnit[] = [];

    for (const id in state.entities) {
        const e = state.entities[id];
        if (e.dead || e.type !== 'UNIT') continue;
        if (e.owner !== owner) {
            // Docked harriers are inside their base and can't be engaged by the army
            if (e.key === 'harrier' && (e as AirUnit).airUnit.state === 'docked') continue;
            (isFlying(e.key) ? enemyAir : enemyGround).push(e);
            continue;
        }
        if (e.key === 'harrier') {
            const h = e as AirUnit;
            if (h.airUnit.state === 'docked' && h.airUnit.ammo > 0 && !h.combat.targetId) dockedHarriers.push(h);
            continue;
        }
        if (!isCombatCapable(e.key)) continue;
        const idle = initial || (!e.combat.targetId && !e.movement.moveTarget && !e.combat.attackMoveTarget);
        if (!idle) continue;
        const t = weaponTargeting(e.key);
        const cls = `${t.ground ? 'g' : ''}${t.air ? 'a' : ''}`;
        (idleByClass[cls] ||= []).push(id);
    }

    const actions: Action[] = [];
    for (const cls in idleByClass) {
        const targets = [
            ...(cls.includes('g') ? enemyGround : []),
            ...(cls.includes('a') ? enemyAir : []),
        ];
        const c = centroid(targets);
        if (!c) continue;
        actions.push({ type: 'COMMAND_ATTACK_MOVE', payload: { unitIds: idleByClass[cls], x: c.x, y: c.y } });
    }

    // Harriers: strike the nearest enemy ground unit to their base (all launch on the same target, like a
    // player right-clicking with the Air-Force Command selected)
    const harrierTargeting = weaponTargeting('harrier');
    const harrierTargets = [
        ...(harrierTargeting.ground ? enemyGround : []),
        ...(harrierTargeting.air ? enemyAir : []),
    ];
    if (dockedHarriers.length > 0 && harrierTargets.length > 0) {
        const byBase: Record<EntityId, AirUnit[]> = {};
        for (const h of dockedHarriers) (byBase[h.airUnit.homeBaseId || ''] ||= []).push(h);
        for (const baseId in byBase) {
            const from = state.entities[baseId]?.pos || byBase[baseId][0].pos;
            let best: Entity | null = null;
            let bestD = Infinity;
            for (const t of harrierTargets) {
                const d = t.pos.dist(from);
                if (d < bestD) { bestD = d; best = t; }
            }
            if (best) actions.push({ type: 'COMMAND_ATTACK', payload: { unitIds: byBase[baseId].map(h => h.id), targetId: best.id } });
        }
    }
    return actions;
}

// ============ FIGHT LOOP ============

function emptyDamage(): DamageStats {
    return { dealt: {}, taken: {}, kills: {}, friendlyFire: {} };
}

function add(rec: Record<string, number>, key: string, v: number): void {
    rec[key] = (rec[key] || 0) + v;
}

/** `startHp` caps each unit at its spawn hp, so Harriers healing in their base never add value */
function sideValue(state: GameState, owner: number, startHp?: Record<EntityId, number>): { value: number; survivors: Comp; combat: number } {
    let value = 0;
    let combat = 0;
    const survivors: Comp = {};
    for (const id in state.entities) {
        const e = state.entities[id];
        if (e.dead || e.type !== 'UNIT' || e.owner !== owner) continue;
        const cost = RULES.units[e.key]?.cost || 0;
        const frac = Math.min(e.hp, startHp?.[id] ?? e.hp) / e.maxHp;
        value += frac * cost;
        add(survivors, e.key, Math.round(frac * 100) / 100);
        if (isCombatCapable(e.key)) combat++;
    }
    return { value, survivors, combat };
}

export function runFight(spec: FightSpec): FightResult {
    return withSeededRandom(spec.seed, () => runFightInner(spec));
}

function runFightInner(spec: FightSpec): FightResult {
    const maxTicks = spec.maxTicks ?? 6000;
    const stallTicks = spec.stallTicks ?? 1200;
    const keyById: Record<EntityId, string> = {};
    let state = createFightState(spec, keyById);
    const startHp: Record<EntityId, number> = {};
    for (const id in state.entities) startHp[id] = state.entities[id].hp;
    const start0 = sideValue(state, 0);
    const start1 = sideValue(state, 1);
    const damage: [DamageStats, DamageStats] | undefined = spec.trackDamage ? [emptyDamage(), emptyDamage()] : undefined;

    let lastDamageTick = 0;
    let reason: FightResult['reason'] = 'tick_cap';
    let winner: 0 | 1 | null = null;

    for (let t = 0; t < maxTicks; t++) {
        if (t % COMMAND_INTERVAL === 0) {
            for (const owner of [0, 1]) {
                for (const a of commanderActions(state, owner, t === 0)) state = update(state, a);
            }
        }

        const before = state;
        state = tick(state);

        // Air-Force Commands are only there to rearm Harriers: keep them out of the fight
        let entities: Record<EntityId, Entity> | null = null;
        for (const id in state.entities) {
            const e = state.entities[id];
            if (e.type === 'BUILDING' && e.hp < e.maxHp) {
                entities ||= { ...state.entities };
                entities[id] = { ...e, hp: e.maxHp };
            }
        }
        if (entities) state = { ...state, entities };

        // Detect hp loss (and attribute it when tracking damage)
        let anyLoss = false;
        for (const id in before.entities) {
            const pre = before.entities[id];
            if (pre.type !== 'UNIT' || pre.dead) continue;
            const post = state.entities[id];
            const killed = !post || post.dead;
            const loss = killed ? pre.hp : pre.hp - post.hp;
            if (loss <= 0) continue;
            anyLoss = true;
            if (!damage) continue;
            // Direct hits record the attacker on the victim; splash doesn't, and killed units are gone,
            // so fall back to the projectile that was about to hit it, then the nearest splash projectile
            let attackerId: EntityId | null | undefined =
                !killed && post.type === 'UNIT' && post.combat.lastDamageTick === before.tick ? post.combat.lastAttackerId : undefined;
            if (!attackerId) {
                let bestD = Infinity;
                for (const p of before.projectiles) {
                    if (p.targetId !== id || p.dead) continue;
                    const d = p.pos.dist(pre.pos);
                    if (d < bestD) { bestD = d; attackerId = p.ownerId; }
                }
            }
            if (!attackerId) {
                let bestD = Infinity;
                for (const p of before.projectiles) {
                    if (!(p.splash > 0) || p.dead) continue;
                    const d = p.pos.dist(pre.pos);
                    if (d < bestD) { bestD = d; attackerId = p.ownerId; }
                }
            }
            const attackerKey = (attackerId && keyById[attackerId]) || 'unknown';
            const attackerOwner = attackerId ? (attackerId.startsWith('L_') ? 0 : 1) : (1 - pre.owner);
            add(damage[pre.owner].taken, pre.key, loss);
            if (attackerOwner === pre.owner) {
                add(damage[attackerOwner].friendlyFire, attackerKey, loss);
            } else {
                add(damage[attackerOwner].dealt, attackerKey, loss);
                if (killed) add(damage[attackerOwner].kills, attackerKey, 1);
            }
        }
        if (anyLoss) lastDamageTick = state.tick;

        if (t % 10 === 0 || anyLoss) {
            const c0 = sideValue(state, 0).combat;
            const c1 = sideValue(state, 1).combat;
            if (c0 === 0 || c1 === 0) {
                reason = 'elimination';
                winner = c0 === 0 && c1 === 0 ? null : (c0 === 0 ? 1 : 0);
                break;
            }
        }
        if (state.tick - lastDamageTick > stallTicks) {
            reason = 'stalemate';
            break;
        }
    }

    const end0 = sideValue(state, 0, startHp);
    const end1 = sideValue(state, 1, startHp);
    return {
        winner,
        reason,
        ticks: state.tick,
        startValue: [start0.value, start1.value],
        remaining: [
            start0.value > 0 ? end0.value / start0.value : 0,
            start1.value > 0 ? end1.value / start1.value : 0,
        ],
        survivors: [end0.survivors, end1.survivors],
        damage,
    };
}

// ============ MATCHUPS ============

export interface MatchupFight {
    seed: number;
    /** true when army A was on the right */
    mirrored: boolean;
    winner: 'A' | 'B' | 'draw';
    reason: FightResult['reason'];
    ticks: number;
    remainingA: number;
    remainingB: number;
    score: number;
    damage?: { A: DamageStats; B: DamageStats };
}

export interface MatchupResult {
    a: Comp;
    b: Comp;
    meanScore: number;
    winsA: number;
    winsB: number;
    draws: number;
    meanTicks: number;
    meanRemainingA: number;
    meanRemainingB: number;
    fights: MatchupFight[];
}

export function matchupFightSpecs(a: Comp, b: Comp, seeds: number, baseSeed: number, opts: Partial<FightSpec> = {}): { spec: FightSpec; mirrored: boolean }[] {
    const out: { spec: FightSpec; mirrored: boolean }[] = [];
    for (let s = 0; s < seeds; s++) {
        const seed = (baseSeed + Math.imul(s + 1, 0x9E3779B1)) >>> 0;
        out.push({ spec: { ...opts, left: { units: a }, right: { units: b }, seed }, mirrored: false });
        out.push({ spec: { ...opts, left: { units: b }, right: { units: a }, seed }, mirrored: true });
    }
    return out;
}

export function toMatchupFight(r: FightResult, seed: number, mirrored: boolean): MatchupFight {
    const [ia, ib] = mirrored ? [1, 0] : [0, 1];
    const winner = r.winner === null ? 'draw' : (r.winner === ia ? 'A' : 'B');
    return {
        seed, mirrored, winner, reason: r.reason, ticks: r.ticks,
        remainingA: r.remaining[ia],
        remainingB: r.remaining[ib],
        score: r.remaining[ia] - r.remaining[ib],
        damage: r.damage ? { A: r.damage[ia], B: r.damage[ib] } : undefined,
    };
}

export function summarize(a: Comp, b: Comp, fights: MatchupFight[]): MatchupResult {
    const n = fights.length || 1;
    const mean = (f: (x: MatchupFight) => number) => fights.reduce((s, x) => s + f(x), 0) / n;
    return {
        a, b,
        meanScore: mean(f => f.score),
        winsA: fights.filter(f => f.winner === 'A').length,
        winsB: fights.filter(f => f.winner === 'B').length,
        draws: fights.filter(f => f.winner === 'draw').length,
        meanTicks: mean(f => f.ticks),
        meanRemainingA: mean(f => f.remainingA),
        meanRemainingB: mean(f => f.remainingB),
        fights,
    };
}

/** Runs one matchup in-process (used by the test and single-matchup mode) */
export function runMatchup(a: Comp, b: Comp, seeds: number, baseSeed = 1, opts: Partial<FightSpec> = {}): MatchupResult {
    const fights = matchupFightSpecs(a, b, seeds, baseSeed, opts)
        .map(({ spec, mirrored }) => toMatchupFight(runFight(spec), spec.seed, mirrored));
    return summarize(a, b, fights);
}

// ============ PARALLEL POOL ============

interface Job { spec: FightSpec }

/** Runs fights across forked worker processes, preserving input order */
async function runPool(jobs: Job[], workers: number, onProgress?: (done: number) => void): Promise<FightResult[]> {
    if (workers <= 1 || jobs.length <= 1) {
        const res: FightResult[] = [];
        for (const j of jobs) { res.push(runFight(j.spec)); onProgress?.(res.length); }
        return res;
    }
    const results: FightResult[] = new Array(jobs.length);
    let next = 0;
    let done = 0;
    const self = fileURLToPath(import.meta.url);
    const children: ChildProcess[] = [];
    await new Promise<void>((resolve, reject) => {
        const n = Math.min(workers, jobs.length);
        for (let w = 0; w < n; w++) {
            const child = fork(self, ['--worker'], { execArgv: process.execArgv, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
            children.push(child);
            const feed = () => {
                if (next < jobs.length) {
                    const i = next++;
                    child.send({ i, spec: jobs[i].spec });
                } else {
                    child.send({ exit: true });
                }
            };
            child.on('message', (msg: { i: number; result: FightResult }) => {
                results[msg.i] = msg.result;
                done++;
                onProgress?.(done);
                if (done === jobs.length) resolve();
                feed();
            });
            child.on('error', reject);
            child.on('exit', code => { if (code && done < jobs.length) reject(new Error(`worker exited with code ${code}`)); });
            feed();
        }
    });
    for (const c of children) if (c.connected) c.send({ exit: true });
    return results;
}

/**
 * Swaps the loaded rules for a snapshot file (in place, so every engine module sees it). Lets two runs
 * be compared on identical numbers while rules.json is being edited. Workers inherit it via the env.
 */
function applyRulesOverride(path: string): void {
    const snapshot = JSON.parse(fs.readFileSync(path, 'utf8'));
    const rules = RULES as unknown as Record<string, unknown>;
    for (const k of Object.keys(rules)) delete rules[k];
    Object.assign(rules, snapshot);
    process.env.BALANCE_SIM_RULES = path;
}

function workerMain(): void {
    if (process.env.BALANCE_SIM_RULES) applyRulesOverride(process.env.BALANCE_SIM_RULES);
    process.on('message', (msg: { i?: number; spec?: FightSpec; exit?: boolean }) => {
        if (msg.exit) { process.disconnect?.(); process.exit(0); }
        const result = runFight(msg.spec!);
        process.send!({ i: msg.i, result });
    });
}

// ============ OUTPUT ============

function fmtComp(c: Comp): string {
    return Object.entries(c).map(([k, n]) => `${k}:${Number.isInteger(n) ? n : n.toFixed(2)}`).join(',');
}

function pad(s: string, n: number, right = false): string {
    return right ? s.padStart(n) : s.padEnd(n);
}

function printMatrix(names: string[], m: number[][]): string {
    const w = Math.max(6, ...names.map(n => n.length)) + 1;
    const colW = 7;
    const short = (n: string) => n.slice(0, colW - 1);
    let out = pad('A \\ B', w) + names.map(n => pad(short(n), colW, true)).join('') + pad('mean', colW + 1, true) + '\n';
    for (let i = 0; i < names.length; i++) {
        const row = m[i];
        const others = row.filter((_, j) => j !== i);
        const mean = others.reduce((a, b) => a + b, 0) / (others.length || 1);
        out += pad(names[i], w) + row.map((v, j) => pad(i === j ? '  .' : (v >= 0 ? '+' : '') + v.toFixed(2), colW, true)).join('')
            + pad((mean >= 0 ? '+' : '') + mean.toFixed(2), colW + 1, true) + '\n';
    }
    return out;
}

function printDamage(label: string, d: DamageStats): void {
    const keys = new Set([...Object.keys(d.dealt), ...Object.keys(d.taken), ...Object.keys(d.friendlyFire)]);
    console.log(`  ${label}:`);
    for (const k of [...keys].sort()) {
        console.log(`    ${pad(k, 12)} dealt ${pad(Math.round(d.dealt[k] || 0).toString(), 7, true)}  kills ${pad((d.kills[k] || 0).toString(), 4, true)}  taken ${pad(Math.round(d.taken[k] || 0).toString(), 7, true)}${d.friendlyFire[k] ? `  friendly-fire ${Math.round(d.friendlyFire[k])}` : ''}`);
    }
}

function mergeDamage(target: DamageStats, src: DamageStats): void {
    for (const f of ['dealt', 'taken', 'kills', 'friendlyFire'] as const) {
        for (const k in src[f]) add(target[f], k, src[f][k]);
    }
}

// ============ RPS CHECK ============

export const CHECK_THRESHOLDS = {
    /** every army needs at least one matchup this good ('niche') ... */
    niche: 0.4,
    /** ... and one this bad ('counter') */
    counter: -0.4,
    maxRowMean: 0.35,
    minRowMean: -0.45,
    /** a matchup at or above this counts as "A beats B" for cycles, dominance and --expect */
    edge: 0.2,
};

export interface CheckReport {
    rows: { name: string; best: { vs: string; score: number }; worst: { vs: string; score: number }; mean: number; flags: string[] }[];
    /** directed 3-cycles a > b > c > a */
    cycles: [string, string, string][];
    dominant: string[];
    expectations: { edge: string; score: number | null; pass: boolean }[];
    failures: string[];
}

/** Checks a score matrix (row vs column) for rock-paper-scissors health */
export function checkMatrix(names: string[], matrix: number[][], expect: string[] = []): CheckReport {
    const T = CHECK_THRESHOLDS;
    const n = names.length;
    const failures: string[] = [];
    const rows: CheckReport['rows'] = [];
    for (let i = 0; i < n; i++) {
        let best = { vs: '-', score: -Infinity };
        let worst = { vs: '-', score: Infinity };
        let sum = 0;
        for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const v = matrix[i][j];
            sum += v;
            if (v > best.score) best = { vs: names[j], score: v };
            if (v < worst.score) worst = { vs: names[j], score: v };
        }
        const mean = n > 1 ? sum / (n - 1) : 0;
        const flags: string[] = [];
        if (best.score < T.niche) flags.push('no niche');
        if (worst.score > T.counter) flags.push('no counter');
        if (mean > T.maxRowMean) flags.push('too strong');
        if (mean < T.minRowMean) flags.push('too weak');
        for (const f of flags) failures.push(`${names[i]}: ${f}`);
        rows.push({ name: names[i], best, worst, mean, flags });
    }

    const beats = (i: number, j: number) => matrix[i][j] >= T.edge;
    const cycles: [string, string, string][] = [];
    // Each cycle once: start from its smallest index
    for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
            for (let c = a + 1; c < n; c++) {
                if (c === b) continue;
                if (beats(a, b) && beats(b, c) && beats(c, a)) cycles.push([names[a], names[b], names[c]]);
            }
        }
    }

    const dominant: string[] = [];
    for (let i = 0; i < n; i++) {
        if (n > 1 && names.every((_, j) => j === i || beats(i, j))) {
            dominant.push(names[i]);
            failures.push(`${names[i]}: beats every other army`);
        }
    }

    const expectations: CheckReport['expectations'] = [];
    for (const raw of expect.map(e => e.trim()).filter(Boolean)) {
        const m = raw.match(/^([\w-]+)\s*>\s*([\w-]+)$/);
        const i = m ? names.indexOf(m[1]) : -1;
        const j = m ? names.indexOf(m[2]) : -1;
        if (i < 0 || j < 0) {
            expectations.push({ edge: raw, score: null, pass: false });
            failures.push(`expect ${raw}: ${m ? 'unknown army' : 'bad syntax, use a>b'}`);
            continue;
        }
        const pass = beats(i, j);
        expectations.push({ edge: raw, score: matrix[i][j], pass });
        if (!pass) failures.push(`expect ${raw}: score ${matrix[i][j].toFixed(2)} < ${T.edge}`);
    }

    return { rows, cycles, dominant, expectations, failures };
}

function sgn(v: number): string {
    return (v >= 0 ? '+' : '') + v.toFixed(2);
}

function printCheck(r: CheckReport, listCycles: boolean): void {
    const T = CHECK_THRESHOLDS;
    const w = Math.max(8, ...r.rows.map(x => x.name.length)) + 1;
    console.log(`\nRPS check (niche >= ${sgn(T.niche)}, counter <= ${sgn(T.counter)}, row mean in [${sgn(T.minRowMean)}, ${sgn(T.maxRowMean)}], edge >= ${sgn(T.edge)}):\n`);
    console.log(`${pad('army', w)}${pad('best win', 22)}${pad('worst loss', 22)}${pad('mean', 7, true)}  flags`);
    for (const x of r.rows) {
        console.log(`${pad(x.name, w)}${pad(`${sgn(x.best.score)} vs ${x.best.vs}`, 22)}${pad(`${sgn(x.worst.score)} vs ${x.worst.vs}`, 22)}${pad(sgn(x.mean), 7, true)}  ${x.flags.join(', ')}`);
    }
    if (listCycles) {
        console.log(`\n3-cycles (${r.cycles.length}):`);
        for (const [a, b, c] of r.cycles) console.log(`  ${a} > ${b} > ${c} > ${a}`);
    } else {
        console.log(`\n3-cycles: ${r.cycles.length}`);
    }
    console.log(`Beats every other army: ${r.dominant.length ? r.dominant.join(', ') : 'none'}`);
    if (r.expectations.length) {
        console.log('\nExpected edges:');
        for (const e of r.expectations) console.log(`  ${e.pass ? 'PASS' : 'FAIL'}  ${pad(e.edge, 24)} ${e.score === null ? '(unknown army)' : sgn(e.score)}`);
    }
    console.log(`\nCheck: ${r.failures.length === 0 ? 'OK' : `${r.failures.length} issue(s)`}`);
}

/** Prints the check and returns whether it passed */
function runCheck(names: string[], matrix: number[][], mode: string, args: Record<string, string | boolean>): boolean {
    const expect = (str(args, 'expect') || '').split(',');
    const report = checkMatrix(names, matrix, expect);
    printCheck(report, mode === 'comps' || args['list-cycles'] === true);
    return report.failures.length === 0;
}

// ============ CLI ============

const HELP = `balance_sim - headless army-vs-army combat simulator

Single matchup:
  --a <comp> --b <comp>     compositions, e.g. rifle:10,rocket:4 (counts) or weights with --budget
  --budget <credits>        treat comps as weights and spend this budget on each side
Matrix modes (always budget based, default budget 6000):
  --matrix                  every combat unit vs every other (cost-normalized NxN)
  --units a,b,c             restrict the matrix to these units
  --include k1,k2           add normally-excluded units (${DEFAULT_EXCLUDED_UNITS.join(', ')})
  --comps <file.json>       comp-vs-comp matrix; file is {"name": "rifle:3,rocket:1" | {"rifle":3,...}}
Options:
  --seeds <n>               seeds per matchup, each run twice with sides swapped (default 5)
  --seed <n>                base seed (default 1)
  --max-ticks <n>           tick cap per fight (default 6000)
  --separation <px>         distance between the armies (default 700)
  --fill partial|floor      budget remainder: a proportionally damaged extra unit (default) or whole units only
  --workers <n>             parallel worker processes (default: cpus-1)
  --rules <file.json>       use this rules snapshot instead of src/data/rules.json (for A/B runs)
  --out <path>              write results as JSON
  --verbose                 per-fight lines and damage dealt/taken/kills by unit type
RPS check (with --matrix / --comps, or on a saved --out file):
  --check                   best win / worst loss per army, row means, 3-cycles, armies that beat everything
  --check-file <file.json>  run the check on a saved matrix/comps JSON without simulating
  --expect "a>b,b>c,c>a"    edges that must hold (score >= edge threshold); implies --check
  --list-cycles             list every 3-cycle in unit-matrix mode too (comps mode always lists them)
  --strict                  exit with code 1 when the check finds any issue
`;

function parseArgs(argv: string[]): Record<string, string | boolean> {
    const out: Record<string, string | boolean> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) throw new CliArgError(`unexpected argument "${a}"`);
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) out[key] = true;
        else { out[key] = next; i++; }
    }
    return out;
}

function str(args: Record<string, string | boolean>, k: string): string | undefined {
    const v = args[k];
    if (v === true) throw new CliArgError(`--${k} expects a value`);
    return typeof v === 'string' ? v : undefined;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log(HELP); return; }

    const rulesPath = str(args, 'rules');
    if (rulesPath) applyRulesOverride(rulesPath);

    const wantCheck = args.check === true || args.expect !== undefined;
    const finishCheck = (names: string[], matrix: number[][], mode: string) => {
        if (!runCheck(names, matrix, mode, args) && args.strict === true) process.exitCode = 1;
    };
    const checkFile = str(args, 'check-file');
    if (checkFile) {
        const saved = JSON.parse(fs.readFileSync(checkFile, 'utf8')) as { names?: string[]; matrix?: number[][]; mode?: string };
        if (!saved.names || !saved.matrix) throw new CliArgError(`${checkFile} has no names/matrix (expected a --matrix or --comps --out file)`);
        finishCheck(saved.names, saved.matrix, saved.mode || 'matrix');
        return;
    }

    const seeds = args.seeds !== undefined ? parseIntegerArg('--seeds', str(args, 'seeds'), 1) : 5;
    const baseSeed = args.seed !== undefined ? parseIntegerArg('--seed', str(args, 'seed'), 0) : 1;
    const maxTicks = args['max-ticks'] !== undefined ? parseIntegerArg('--max-ticks', str(args, 'max-ticks'), 1) : 6000;
    const separation = args.separation !== undefined ? parseIntegerArg('--separation', str(args, 'separation'), 50) : 700;
    const workers = args.workers !== undefined ? parseIntegerArg('--workers', str(args, 'workers'), 1) : Math.max(1, os.cpus().length - 1);
    const fill = (str(args, 'fill') || 'partial') as 'partial' | 'floor';
    if (fill !== 'partial' && fill !== 'floor') throw new CliArgError('--fill must be partial or floor');
    const verbose = args.verbose === true;
    const outPath = str(args, 'out');
    const budgetRaw = str(args, 'budget');
    const budget = budgetRaw !== undefined ? parseIntegerArg('--budget', budgetRaw, 1) : undefined;
    const opts: Partial<FightSpec> = { maxTicks, separation, trackDamage: verbose };
    const started = Date.now();

    // ----- matrix / comps modes -----
    if (args.matrix || args.comps) {
        const b = budget ?? 6000;
        let names: string[];
        let comps: Comp[];
        if (args.comps) {
            const raw = JSON.parse(fs.readFileSync(str(args, 'comps')!, 'utf8')) as Record<string, string | Comp>;
            names = Object.keys(raw);
            comps = names.map(n => {
                const v = raw[n];
                const weights = typeof v === 'string' ? parseComp(v) : parseComp(Object.entries(v).map(([k, w]) => `${k}:${w}`).join(','));
                return compFromBudget(weights, b, fill);
            });
        } else {
            const include = (str(args, 'include') || '').split(',').filter(Boolean);
            const only = str(args, 'units')?.split(',').filter(Boolean);
            names = only ?? Object.keys(RULES.units).filter(k =>
                (!DEFAULT_EXCLUDED_UNITS.includes(k) || include.includes(k)) && isUnitData(RULES.units[k]));
            names.forEach(unitCost);
            comps = names.map(n => compFromBudget({ [n]: 1 }, b, fill));
        }

        const pairs: [number, number][] = [];
        for (let i = 0; i < names.length; i++) for (let j = i; j < names.length; j++) pairs.push([i, j]);
        const jobs: { pair: [number, number]; spec: FightSpec; mirrored: boolean }[] = [];
        for (const pair of pairs) {
            for (const f of matchupFightSpecs(comps[pair[0]], comps[pair[1]], seeds, baseSeed, opts)) jobs.push({ pair, ...f });
        }
        console.log(`${names.length} armies at budget ${b} (fill ${fill}), ${pairs.length} matchups x ${seeds * 2} fights = ${jobs.length} fights on ${workers} workers`);
        for (let i = 0; i < names.length; i++) console.log(`  ${pad(names[i], 14)} ${fmtComp(comps[i])}`);

        const results = await runPool(jobs, workers, done => {
            if (process.stdout.isTTY) process.stdout.write(`\r  ${done}/${jobs.length} fights`);
        });
        if (process.stdout.isTTY) process.stdout.write('\n');

        const n = names.length;
        const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
        const byPair = new Map<string, MatchupFight[]>();
        results.forEach((r, k) => {
            const job = jobs[k];
            const key = job.pair.join(',');
            if (!byPair.has(key)) byPair.set(key, []);
            byPair.get(key)!.push(toMatchupFight(r, job.spec.seed, job.mirrored));
        });
        const matchups: (MatchupResult & { aName: string; bName: string })[] = [];
        const damageByUnit: Record<string, DamageStats> = {};
        for (const [i, j] of pairs) {
            const m = summarize(comps[i], comps[j], byPair.get(`${i},${j}`)!);
            matrix[i][j] = m.meanScore;
            matrix[j][i] = -m.meanScore;
            if (!verbose) m.fights.forEach(f => delete f.damage);
            matchups.push({ ...m, aName: names[i], bName: names[j] });
            if (verbose) {
                for (const f of m.fights) {
                    if (!f.damage) continue;
                    mergeDamage(damageByUnit[names[i]] ||= emptyDamage(), f.damage.A);
                    if (i !== j) mergeDamage(damageByUnit[names[j]] ||= emptyDamage(), f.damage.B);
                }
            }
        }

        console.log(`\nMean score (row army remaining value - column army remaining value), ${seeds} seeds x 2 sides:\n`);
        console.log(printMatrix(names, matrix));
        const diag = pairs.filter(([i, j]) => i === j).map(([i]) => byPair.get(`${i},${i}`)!.reduce((s, f) => s + f.score, 0) / (seeds * 2));
        if (diag.length) console.log(`Mirror (diagonal) scores: max |score| ${Math.max(...diag.map(Math.abs)).toFixed(3)}`);
        const caps = matchups.flatMap(m => m.fights).filter(f => f.reason !== 'elimination').length;
        console.log(`Fights not ending by elimination: ${caps}/${jobs.length}`);
        if (verbose) {
            console.log('\nDamage totals across the matrix:');
            for (const name of names) if (damageByUnit[name]) printDamage(name, damageByUnit[name]);
        }
        const elapsed = (Date.now() - started) / 1000;
        console.log(`\nDone in ${elapsed.toFixed(1)}s`);
        if (outPath) {
            fs.writeFileSync(outPath, JSON.stringify({
                mode: args.comps ? 'comps' : 'matrix',
                budget: b, fill, seeds, baseSeed, maxTicks, separation,
                names, armies: Object.fromEntries(names.map((nm, i) => [nm, comps[i]])),
                matrix, matchups, elapsedSeconds: elapsed,
            }, null, 2));
            console.log(`Wrote ${outPath}`);
        }
        if (wantCheck) finishCheck(names, matrix, args.comps ? 'comps' : 'matrix');
        return;
    }

    // ----- single matchup -----
    const aRaw = str(args, 'a');
    const bRaw = str(args, 'b');
    if (!aRaw || !bRaw) throw new CliArgError('need --a and --b (or --matrix / --comps); see --help');
    let a = parseComp(aRaw);
    let b = parseComp(bRaw);
    if (budget !== undefined) {
        a = compFromBudget(a, budget, fill);
        b = compFromBudget(b, budget, fill);
    }
    console.log(`A: ${fmtComp(a)} (value ${Math.round(compValue(a))})`);
    console.log(`B: ${fmtComp(b)} (value ${Math.round(compValue(b))})`);
    const jobs = matchupFightSpecs(a, b, seeds, baseSeed, opts);
    const results = await runPool(jobs.map(j => ({ spec: j.spec })), Math.min(workers, jobs.length));
    const fights = results.map((r, k) => toMatchupFight(r, jobs[k].spec.seed, jobs[k].mirrored));
    const m = summarize(a, b, fights);
    for (const f of fights) {
        console.log(`  seed ${f.seed} ${f.mirrored ? 'A right' : 'A left '}: ${pad(f.winner, 4)} ${pad(f.reason, 11)} ${pad(String(f.ticks), 5, true)} ticks  A ${(f.remainingA * 100).toFixed(0).padStart(3)}%  B ${(f.remainingB * 100).toFixed(0).padStart(3)}%  score ${f.score >= 0 ? '+' : ''}${f.score.toFixed(2)}`);
    }
    console.log(`\nMean score ${m.meanScore >= 0 ? '+' : ''}${m.meanScore.toFixed(3)}  (A wins ${m.winsA}, B wins ${m.winsB}, draws ${m.draws}; A keeps ${(m.meanRemainingA * 100).toFixed(0)}%, B keeps ${(m.meanRemainingB * 100).toFixed(0)}%; ${Math.round(m.meanTicks)} ticks avg)`);
    if (verbose) {
        const dA = emptyDamage(), dB = emptyDamage();
        for (const f of fights) if (f.damage) { mergeDamage(dA, f.damage.A); mergeDamage(dB, f.damage.B); }
        console.log('\nDamage totals over all fights:');
        printDamage('A', dA);
        printDamage('B', dB);
    }
    console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    if (outPath) {
        fs.writeFileSync(outPath, JSON.stringify(m, null, 2));
        console.log(`Wrote ${outPath}`);
    }
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1]);
if (isEntry) {
    if (process.argv.includes('--worker')) workerMain();
    else runCli(main);
}

import { Action, Entity, EntityId, GameState, UnitEntity, Vector } from '../../../types.js';
import { createEntityCache, EntityCache, getBuildingsForOwner, getEnemiesOf, getUnitsForOwner } from '../../../perf.js';
import { isTransportedUnit } from '../../../transport.js';
import { RULES } from '../../../../data/schemas/index.js';
import { AIImplementation } from '../../contracts.js';
import { isValidPlacement } from '../../utils.js';
import { resetAIState } from '../../state.js';
import { AuroraSovereignAIImplementation, computeAuroraSovereignAiActions } from '../aurora_sovereign/index.js';
import { getNemesisRuntimeState, NemesisRuntimeState, resetNemesisRuntimeState } from './state.js';

// ============================================================================
// Nemesis AI - air cavalry
//
// Aurora Sovereign's economy and ground army serve as the chassis. On top of it,
// Nemesis plays the one strategy no other built-in AI uses: an early tech switch
// into massed attack helicopters. Turrets and most ground weapons cannot target air,
// though rockets, missiles, SAM sites and small arms can. See README.md for the
// measurements behind each layer.
//
// Fair play: every action targets only this player's own entities and queues and
// goes through the normal reducer, exactly like the other built-in AIs.
// ============================================================================

const CHASSIS = (state: GameState, playerId: number, cache: EntityCache) =>
    computeAuroraSovereignAiActions(state, playerId, 'hard', cache);

// Straight into the first Air-Force Command (first helicopter around tick 4800), then economy.
const AIR_OPENING = ['power', 'refinery', 'barracks', 'factory', 'tech', 'airforce_command', 'refinery', 'power', 'refinery'];
const REFINERY_SCHEDULE: readonly { untilTick: number; refineries: number }[] = [
    { untilTick: 7000, refineries: 3 },
    { untilTick: 11000, refineries: 4 },
    { untilTick: Infinity, refineries: 5 }
];
const HARVESTERS_PER_REFINERY = 2;
const MAX_HARVESTERS = 10;
const SECOND_COMMAND_CREDITS = 2000;
const EXTRA_COMMAND_CREDITS = 2500;
const AIR_MAX_COMMANDS = 3;

// Queues drain credits in the order building, infantry, vehicle, air - so unchecked chassis
// ground production starves the helicopters. It only starts with this much banked, unless
// an armed enemy is within THREAT_RADIUS of our buildings.
const VEHICLE_RESERVE = 1200;
const INFANTRY_RESERVE = 400;
const THREAT_RADIUS = 800;

const POWER_SAFETY_MARGIN = 20;
const SHELTERED_KEYS = new Set(['tech', 'airforce_command']);
const UNIT_COMMAND_TYPES = new Set(['COMMAND_MOVE', 'COMMAND_ATTACK', 'COMMAND_ATTACK_MOVE', 'SET_STANCE', 'COMMAND_UNGARRISON']);

// Strikes start as soon as two helicopters are up: constant early pressure beat waiting
// for bigger groups (2: 96% vs 4: 91% vs 6: 89% in 240-game gauntlets).
const HELI_STRIKE_SIZE = 2;
// Skip targets whose anti-air cover exceeds this fraction of the wing's (HP-weighted) size.
const HELI_DANGER_TOLERANCE = 0.7;
// Non-combat units the helicopters still hunt near our base.
const INFILTRATOR_KEYS = new Set(['engineer', 'hijacker', 'demo_truck', 'apc']);
const HELI_BASE_GUARD_RADIUS = 650;
// Siege units shell the base from beyond the normal guard radius - and cannot shoot back at air.
const SIEGE_KEYS = new Set(['artillery', 'mlrs']);
const SIEGE_GUARD_RADIUS = 950;
const KITE_BUFFER = 30;
// Anti-air threat per unit/building, derived from rules.json: sustained damage per minute
// against air armor, relative to a rocket soldier's (rocket = 0.5).
const AA_REFERENCE_DPM = 64;
const AA_BUILDING_SCALE = 2;
const aaWeightCache = new Map<string, number>();

function antiAirWeight(key: string, isBuilding: boolean): number {
    const cacheKey = (isBuilding ? 'B:' : '') + key;
    const cached = aaWeightCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const data = isBuilding ? RULES.buildings[key] : RULES.units[key];
    let weight = 0;
    const weaponType = data?.weaponType;
    if (data && weaponType && (data.damage ?? 0) > 0 && RULES.weaponTargeting?.[weaponType]?.canTargetAir) {
        const modifier = RULES.damageModifiers?.[weaponType]?.air ?? 1;
        const dpm = (data.damage ?? 0) * modifier / Math.max(1, data.rate ?? 60) * 60;
        weight = dpm / AA_REFERENCE_DPM * (isBuilding ? AA_BUILDING_SCALE : 1);
    }
    aaWeightCache.set(cacheKey, weight);
    return weight;
}

/** Anti-air units shorter-ranged than the helicopter, which it can kite between shots. */
function isKiteableAntiAir(key: string): boolean {
    const range = unitData(key)?.range ?? 0;
    return antiAirWeight(key, false) > 0 && range < (unitData('heli')?.range ?? 0);
}
const HELI_TARGET_VALUE: Readonly<Record<string, number>> = {
    harvester: 950,
    mlrs: 900,
    artillery: 850,
    stealth: 800,
    rocket: 700,
    heli: 700,
    sam_site: 650,
    conyard: 750,
    factory: 700,
    refinery: 650,
    power: 600,
    airforce_command: 600,
    barracks: 550,
    tech: 500,
    mcv: 900,
    induction_rig: 700,
    induction_rig_deployed: 650,
    service_depot: 400,
    obelisk: 450,
    turret: 120,
    pillbox: 120
};

type Ctx = {
    state: GameState;
    playerId: number;
    myBuildings: Entity[];
    myUnits: UnitEntity[];
    enemies: Entity[];
    enemyUnits: UnitEntity[];
    enemyBuildings: Entity[];
    rt: NemesisRuntimeState;
};

// ---------------------------------------------------------------- helpers

function unitData(key: string) {
    return RULES.units[key];
}

function isFlying(entity: Entity): boolean {
    return entity.type === 'UNIT' && Boolean(unitData(entity.key)?.fly);
}

function isArmedThreat(entity: Entity): boolean {
    if (entity.dead) return false;
    if (entity.type === 'BUILDING') return Boolean(RULES.buildings[entity.key]?.isDefense);
    if (entity.type !== 'UNIT' || isTransportedUnit(entity)) return false;
    if (entity.key === 'harvester') return false;
    return (unitData(entity.key)?.damage ?? 0) > 0;
}

function nearestDistance(pos: Vector, entities: Entity[]): number {
    let best = Infinity;
    for (const e of entities) {
        const d = pos.dist(e.pos);
        if (d < best) best = d;
    }
    return best;
}

function queueCount(state: GameState, playerId: number, category: 'vehicle', key: string): number {
    const q = state.players[playerId].queues[category];
    let n = q.current === key ? 1 : 0;
    for (const k of q.queued ?? []) if (k === key) n++;
    return n;
}

function canProduce(myBuildings: Entity[], key: string): boolean {
    const prereqs = unitData(key)?.prerequisites ?? [];
    return prereqs.every(p => myBuildings.some(b => b.key === p && !b.dead));
}

/** Remove the given units from every unit command the chassis issued this tick. */
function stripUnits(actions: Action[], ids: Set<EntityId>): Action[] {
    if (ids.size === 0) return actions;
    const out: Action[] = [];
    for (const action of actions) {
        if (UNIT_COMMAND_TYPES.has(action.type)) {
            const payload = (action as { payload: { unitIds: EntityId[] } }).payload;
            const kept = payload.unitIds.filter(id => !ids.has(id));
            if (kept.length === 0) continue;
            if (kept.length !== payload.unitIds.length) {
                out.push({ ...action, payload: { ...payload, unitIds: kept } } as Action);
                continue;
            }
        }
        out.push(action);
    }
    return out;
}

function attackIfNeeded(out: Action[], unit: UnitEntity, targetId: EntityId): void {
    if (unit.combat?.targetId === targetId) return;
    out.push({ type: 'COMMAND_ATTACK', payload: { unitIds: [unit.id], targetId } });
}

function moveIfNeeded(out: Action[], unit: UnitEntity, x: number, y: number, slack = 60): void {
    const dest = unit.movement.finalDest ?? unit.movement.moveTarget;
    if (dest && Math.hypot(dest.x - x, dest.y - y) < slack) return;
    if (!dest && Math.hypot(unit.pos.x - x, unit.pos.y - y) < slack) return;
    out.push({ type: 'COMMAND_MOVE', payload: { unitIds: [unit.id], x, y } });
}

// ---------------------------------------------------------------- power

function buildingPower(key: string | null | undefined): { out: number; drain: number } {
    const data = key ? RULES.buildings[key] : undefined;
    return { out: data?.power ?? 0, drain: data?.drain ?? 0 };
}

/**
 * Production runs at 25% speed while drain exceeds output, for every queue at once.
 * Keep a power plant ahead of demand, even if that means shelving the chassis' build.
 * Returns true when it took over the building lane this tick.
 */
function runPowerGovernor(ctx: Ctx, out: Action[]): boolean {
    const { state, playerId, myBuildings } = ctx;
    const player = state.players[playerId];
    if (!myBuildings.some(b => b.key === 'conyard')) return false;

    let output = 0;
    let drain = 0;
    for (const b of myBuildings) {
        const p = buildingPower(b.key);
        output += p.out;
        drain += p.drain;
    }
    const lane = player.queues.building;
    const pending = [lane.current, player.readyToPlace];
    if (pending.includes('power')) return false;
    for (const key of pending) drain += buildingPower(key).drain;

    const margin = output - drain;
    if (margin >= POWER_SAFETY_MARGIN) return false;
    if (player.credits < (RULES.buildings.power?.cost ?? 300)) return false;

    if (lane.current) {
        // Shelve (full refund) a build that would brown us out: a plant built after the
        // fact takes four times as long, and so does everything else meanwhile.
        if (margin >= 0) return false;
        out.push({ type: 'CANCEL_BUILD', payload: { category: 'building', playerId } });
    }
    // With a building waiting for placement this START lands right after the chassis places it.
    out.push({ type: 'START_BUILD', payload: { category: 'building', key: 'power', playerId } });
    return true;
}

// ---------------------------------------------------------------- air cavalry

type MacroPlan = { key: string; critical: boolean };

function plannedRefineries(tick: number): number {
    return REFINERY_SCHEDULE.find(step => tick < step.untilTick)!.refineries;
}

/**
 * Building priorities once the opening is done: production essentials and air tech first
 * (critical: the chassis' ground spending is held back until they are underway), then
 * refineries, then extra Air-Force Commands. Null hands the lane back to the chassis.
 */
function planMacroBuilding(ctx: Ctx): MacroPlan | null {
    const { state, playerId, myBuildings } = ctx;
    const player = state.players[playerId];
    const count = (key: string) => myBuildings.filter(b => b.key === key).length;
    if (count('conyard') === 0) return null;
    const lane = player.queues.building;
    const pendingKeys = [lane.current, player.readyToPlace];
    const has = (key: string) => count(key) > 0 || pendingKeys.includes(key);

    if (!has('barracks')) return { key: 'barracks', critical: true };
    if (count('refinery') === 0 && !has('refinery')) return { key: 'refinery', critical: true };
    if (!has('factory')) return { key: 'factory', critical: true };
    if (!has('tech')) return { key: 'tech', critical: true };
    if (!has('airforce_command')) return { key: 'airforce_command', critical: true };

    const refineries = count('refinery') + (pendingKeys.includes('refinery') ? 1 : 0);
    if (refineries < plannedRefineries(state.tick)) return { key: 'refinery', critical: false };

    const afc = count('airforce_command') + (pendingKeys.includes('airforce_command') ? 1 : 0);
    if (afc < 2 && player.credits >= SECOND_COMMAND_CREDITS) return { key: 'airforce_command', critical: false };
    if (afc < AIR_MAX_COMMANDS && player.credits >= EXTRA_COMMAND_CREDITS) return { key: 'airforce_command', critical: false };
    return null;
}

/** Keep two harvesters per refinery; they jump the vehicle queue. Returns true if it used the lane. */
function runHarvesterQuota(ctx: Ctx, out: Action[]): boolean {
    const { state, playerId, myBuildings, myUnits } = ctx;
    const player = state.players[playerId];
    if (!canProduce(myBuildings, 'harvester')) return false;
    const refineries = myBuildings.filter(b => b.key === 'refinery').length;
    const desired = Math.min(HARVESTERS_PER_REFINERY * refineries, MAX_HARVESTERS);
    const harvesters = myUnits.filter(u => u.key === 'harvester').length + queueCount(state, playerId, 'vehicle', 'harvester');
    if (harvesters >= desired) return false;
    if (player.queues.vehicle.current) return true; // wait for the lane, keep the chassis out of it
    out.push({ type: 'START_BUILD', payload: { category: 'vehicle', key: 'harvester', playerId } });
    return true;
}

/**
 * Scripted opening straight into the first Air-Force Command. Returns the next key
 * (or 'busy' while the lane works on an opening item) until the script is done.
 */
function planAirOpening(ctx: Ctx): string | 'busy' | null {
    const { state, playerId, myBuildings, rt } = ctx;
    if (rt.openingDone) return null;
    const player = state.players[playerId];
    if (!myBuildings.some(b => b.key === 'conyard')) {
        rt.openingDone = true;
        return null;
    }
    const lane = player.queues.building;
    const have: Record<string, number> = {};
    for (const b of myBuildings) have[b.key] = (have[b.key] ?? 0) + 1;
    for (const key of [lane.current, player.readyToPlace]) if (key) have[key] = (have[key] ?? 0) + 1;

    const need: Record<string, number> = {};
    for (const key of AIR_OPENING) {
        need[key] = (need[key] ?? 0) + 1;
        if ((have[key] ?? 0) < need[key]) {
            if (lane.current || player.readyToPlace) return 'busy';
            return key;
        }
    }
    rt.openingDone = true;
    return null;
}

function runAirProduction(ctx: Ctx, out: Action[]): boolean {
    const { state, playerId, myBuildings } = ctx;
    const player = state.players[playerId];
    if (!canProduce(myBuildings, 'heli') || !myBuildings.some(b => b.key === 'airforce_command')) return false;
    if (player.queues.air.current) return true;
    if (player.credits < 200) return true;
    out.push({ type: 'START_BUILD', payload: { category: 'air', key: 'heli', playerId } });
    return true;
}

function antiAirDanger(pos: Vector, enemies: Entity[]): number {
    let danger = 0;
    for (const e of enemies) {
        if (e.dead) continue;
        if (e.type === 'BUILDING') {
            const w = antiAirWeight(e.key, true);
            if (!w) continue;
            const range = (RULES.buildings[e.key]?.range ?? 300) + 60;
            if (e.pos.dist(pos) <= range) danger += w;
        } else if (e.type === 'UNIT') {
            const w = antiAirWeight(e.key, false);
            if (!w || isTransportedUnit(e)) continue;
            const range = (unitData(e.key)?.range ?? 200) + 80;
            if (e.pos.dist(pos) <= range) danger += w;
        }
    }
    return danger;
}

function canHelisHit(target: Entity): boolean {
    return !isFlying(target) || target.key === 'heli';
}

function runHeliCommand(ctx: Ctx, claimed: Set<EntityId>, out: Action[]): void {
    const { myBuildings, myUnits, enemies, rt } = ctx;
    const helis = myUnits.filter(u => u.key === 'heli' && !u.dead);
    if (helis.length === 0) return;
    for (const h of helis) claimed.add(h.id);

    let cx = 0;
    let cy = 0;
    for (const h of helis) {
        cx += h.pos.x;
        cy += h.pos.y;
    }
    const center = new Vector(cx / helis.length, cy / helis.length);

    // 1. Home defence: anything armed near our buildings gets swatted first.
    let best: Entity | null = null;
    let bestScore = -Infinity;
    for (const e of enemies) {
        if (e.dead || e.type !== 'UNIT' || isTransportedUnit(e) || !canHelisHit(e)) continue;
        if (!isArmedThreat(e) && !INFILTRATOR_KEYS.has(e.key)) continue;
        const baseDist = nearestDistance(e.pos, myBuildings);
        const siege = SIEGE_KEYS.has(e.key);
        if (baseDist > (siege ? SIEGE_GUARD_RADIUS : HELI_BASE_GUARD_RADIUS)) continue;
        const score = antiAirWeight(e.key, false) * 400 + (siege ? 500 : 0) + (unitData(e.key)?.cost ?? 0) * 0.2 - baseDist - e.pos.dist(center) * 0.2;
        if (score > bestScore) {
            bestScore = score;
            best = e;
        }
    }

    // 2. Otherwise mass up, then strike where the enemy cannot shoot back.
    if (!best) {
        // Hysteresis: keep striking until the wing drops below two.
        const striking = rt.heliStrikeActive
            ? helis.length >= Math.max(2, HELI_STRIKE_SIZE - 2)
            : helis.length >= HELI_STRIKE_SIZE;
        rt.heliStrikeActive = striking;
        if (!striking) {
            const home = myBuildings.find(b => b.key === 'airforce_command') ?? myBuildings[0];
            if (home) for (const h of helis) moveIfNeeded(out, h, home.pos.x, home.pos.y, 200);
            return;
        }
        const firepower = helis.reduce((s, h) => s + h.hp / h.maxHp, 0);
        for (const e of enemies) {
            if (e.dead || (e.type !== 'UNIT' && e.type !== 'BUILDING')) continue;
            if (e.type === 'UNIT' && (isTransportedUnit(e) || !canHelisHit(e))) continue;
            const value = HELI_TARGET_VALUE[e.key] ?? (e.type === 'UNIT' ? 250 + (unitData(e.key)?.cost ?? 0) * 0.15 : 300);
            const danger = antiAirDanger(e.pos, enemies);
            if (danger > firepower * HELI_DANGER_TOLERANCE) continue;
            const hpFactor = 1 - 0.3 * (e.hp / e.maxHp);
            const score = value * hpFactor - e.pos.dist(center) * 0.25 - danger * 180;
            if (score > bestScore) {
                bestScore = score;
                best = e;
            }
        }
    }

    if (!best) {
        const home = myBuildings.find(b => b.key === 'airforce_command') ?? myBuildings[0];
        if (home) for (const h of helis) moveIfNeeded(out, h, home.pos.x, home.pos.y, 200);
        return;
    }
    const kiteFrom = enemies.filter(e => e.type === 'UNIT' && !e.dead && !isTransportedUnit(e) &&
        isKiteableAntiAir(e.key)) as UnitEntity[];
    const heliRange = unitData('heli')?.range ?? 300;
    for (const h of helis) {
        if (h.combat.cooldown > 0) {
            // Between shots, step back out of reach of shorter-ranged anti-air.
            let threat: UnitEntity | null = null;
            let threatGap = Infinity;
            for (const e of kiteFrom) {
                const reach = (unitData(e.key)?.range ?? 0) + KITE_BUFFER;
                const gap = h.pos.dist(e.pos) - reach;
                if (gap < 0 && gap < threatGap) {
                    threat = e;
                    threatGap = gap;
                }
            }
            if (threat) {
                const away = h.pos.sub(threat.pos).norm();
                const standOff = Math.min(heliRange - 10, (unitData(threat.key)?.range ?? 0) + KITE_BUFFER + 20);
                const x = Math.max(30, Math.min(ctx.state.config.width - 30, threat.pos.x + away.x * standOff));
                const y = Math.max(30, Math.min(ctx.state.config.height - 30, threat.pos.y + away.y * standOff));
                out.push({ type: 'COMMAND_MOVE', payload: { unitIds: [h.id], x, y } });
                continue;
            }
        }
        attackIfNeeded(out, h, best.id);
    }
}

// ---------------------------------------------------------------- sheltered placement

/**
 * The air wing hinges on the Tech Center and Air-Force Commands, so put them on the far
 * side of the base where an attack reaches them last. Returns true if it placed one.
 */
function runShelteredPlacement(ctx: Ctx, out: Action[]): boolean {
    const { state, playerId, myBuildings, enemyBuildings } = ctx;
    const key = state.players[playerId].readyToPlace;
    if (!key || !SHELTERED_KEYS.has(key) || enemyBuildings.length === 0) return false;
    const data = RULES.buildings[key];
    if (!data) return false;

    let ex = 0;
    let ey = 0;
    for (const b of enemyBuildings) {
        ex += b.pos.x;
        ey += b.pos.y;
    }
    const enemyCenter = new Vector(ex / enemyBuildings.length, ey / enemyBuildings.length);
    const anchors = myBuildings.filter(b => !RULES.buildings[b.key]?.isDefense);
    const conyard = anchors.find(b => b.key === 'conyard') ?? anchors[0];
    if (!conyard) return false;

    let best: { x: number; y: number } | null = null;
    let bestScore = -Infinity;
    for (const anchor of anchors) {
        for (let r = 110; r <= 330; r += 55) {
            for (let a = 0; a < 16; a++) {
                const angle = (a / 16) * Math.PI * 2;
                const x = Math.round(anchor.pos.x + Math.cos(angle) * r);
                const y = Math.round(anchor.pos.y + Math.sin(angle) * r);
                const p = new Vector(x, y);
                // Far from the enemy, but don't wander off from the base.
                const score = p.dist(enemyCenter) - 0.5 * p.dist(conyard.pos);
                if (score <= bestScore) continue;
                if (!isValidPlacement(x, y, data.w, data.h, state, myBuildings, key)) continue;
                best = { x, y };
                bestScore = score;
            }
        }
    }
    if (!best) return false;
    out.push({ type: 'PLACE_BUILDING', payload: { key, x: best.x, y: best.y, playerId } });
    return true;
}

// ---------------------------------------------------------------- sanitize

function ownsUnits(state: GameState, ids: EntityId[], playerId: number): boolean {
    return ids.every(id => {
        const e = state.entities[id];
        return Boolean(e && e.type === 'UNIT' && e.owner === playerId && !e.dead);
    });
}

function ownsBuilding(state: GameState, id: EntityId, playerId: number): boolean {
    const e = state.entities[id];
    return Boolean(e && e.type === 'BUILDING' && e.owner === playerId && !e.dead);
}

/** Only ever command our own units and buildings, and only touch our own player state. */
export function sanitizeNemesisActions(actions: Action[], state: GameState, playerId: number): Action[] {
    return actions.filter(action => {
        switch (action.type) {
            case 'START_BUILD':
            case 'PLACE_BUILDING':
            case 'CANCEL_BUILD':
            case 'QUEUE_UNIT':
            case 'DEQUEUE_UNIT':
                return action.payload.playerId === playerId;
            case 'COMMAND_MOVE':
            case 'COMMAND_ATTACK':
            case 'COMMAND_ATTACK_MOVE':
            case 'COMMAND_UNGARRISON':
            case 'SET_STANCE':
                return ownsUnits(state, action.payload.unitIds, playerId);
            case 'SELL_BUILDING':
            case 'START_REPAIR':
            case 'STOP_REPAIR':
            case 'SET_PRIMARY_BUILDING':
                return action.payload.playerId === playerId && ownsBuilding(state, action.payload.buildingId, playerId);
            case 'SET_RALLY_POINT':
                return ownsBuilding(state, action.payload.buildingId, playerId);
            case 'DEPLOY_MCV':
            case 'DEPLOY_INDUCTION_RIG':
                return ownsUnits(state, [action.payload.unitId], playerId);
            default:
                return false;
        }
    });
}

// ---------------------------------------------------------------- entry

export function computeNemesisAiActions(state: GameState, playerId: number, sharedCache?: EntityCache): Action[] {
    const player = state.players[playerId];
    if (!player) return [];
    const cache = sharedCache ?? createEntityCache(state.entities);
    const myBuildings = getBuildingsForOwner(cache, playerId);
    const myUnits = getUnitsForOwner(cache, playerId) as UnitEntity[];
    if (myBuildings.length === 0 && !myUnits.some(u => u.key === 'mcv')) return [];

    const enemies = getEnemiesOf(cache, playerId, state);
    const ctx: Ctx = {
        state,
        playerId,
        myBuildings,
        myUnits,
        enemies,
        enemyUnits: enemies.filter((e): e is UnitEntity => e.type === 'UNIT' && !e.dead),
        enemyBuildings: enemies.filter(e => e.type === 'BUILDING' && !e.dead),
        rt: getNemesisRuntimeState(playerId)
    };

    const own: Action[] = [];
    const claimed = new Set<EntityId>();
    let ownsBuildingLane = runPowerGovernor(ctx, own);
    let holdGroundSpending = false;
    const opening = planAirOpening(ctx);
    if (opening) {
        if (!ownsBuildingLane && opening !== 'busy') {
            own.push({ type: 'START_BUILD', payload: { category: 'building', key: opening, playerId } });
        }
        ownsBuildingLane = true;
    } else {
        const plan = planMacroBuilding(ctx);
        if (plan) {
            holdGroundSpending = plan.critical;
            if (!ownsBuildingLane && !player.queues.building.current && !player.readyToPlace) {
                own.push({ type: 'START_BUILD', payload: { category: 'building', key: plan.key, playerId } });
                ownsBuildingLane = true;
            }
        }
    }
    const ownsVehicleLane = runHarvesterQuota(ctx, own);
    const placedSheltered = runShelteredPlacement(ctx, own);
    const ownsAirLane = runAirProduction(ctx, own);
    runHeliCommand(ctx, claimed, own);

    let chassis = stripUnits(CHASSIS(state, playerId, cache), claimed);
    const queues = player.queues;
    const underAttack = ctx.enemyUnits.some(e => isArmedThreat(e) &&
        nearestDistance(e.pos, myBuildings) < THREAT_RADIUS);
    const hasAirForce = myBuildings.some(b => b.key === 'airforce_command');
    chassis = chassis.filter(action => {
        if (action.type === 'PLACE_BUILDING' || action.type === 'CANCEL_BUILD') return !placedSheltered;
        if (action.type !== 'START_BUILD') return true;
        const { category, key } = action.payload;
        if (category === 'building') return !ownsBuildingLane;
        if (category === 'air') return !ownsAirLane;
        if (category !== 'vehicle' && category !== 'infantry') return true;
        // The chassis re-issues START_BUILD every tick, piling up to 99 units in a queue;
        // keep it one deep so that our own priorities can still get into the lane.
        if (queues[category].current) return false;
        if (key === 'harvester') return true;
        // Economy and air tech come first; infantry still covers the base meanwhile.
        if (category === 'vehicle' && (opening || holdGroundSpending || ownsVehicleLane)) return false;
        if (hasAirForce && !underAttack) {
            return player.credits >= (category === 'vehicle' ? VEHICLE_RESERVE : INFANTRY_RESERVE);
        }
        return true;
    });
    return sanitizeNemesisActions([...chassis, ...own], state, playerId);
}

export const NemesisAIImplementation: AIImplementation = {
    id: 'nemesis',
    name: 'Nemesis',
    description: 'Air cavalry: techs straight into Air-Force Commands and wins with focused, kiting helicopter strikes the ground-only AIs cannot answer.',
    computeActions: ({ state, playerId, entityCache }) => computeNemesisAiActions(state, playerId, entityCache),
    reset: (playerId?: number) => {
        AuroraSovereignAIImplementation.reset?.(playerId);
        resetAIState(playerId);
        resetNemesisRuntimeState(playerId);
    }
};

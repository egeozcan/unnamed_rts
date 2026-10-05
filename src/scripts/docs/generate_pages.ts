/**
 * Generates docs/site/units/{infantry,vehicles,aircraft}.md and docs/site/buildings/index.md from rules.json, so the
 * numbers, strengths, weaknesses and counters can't drift from the game.
 *
 *   npm run docs:pages            (run `npm run docs:render` first for the images)
 */
import { writeFileSync } from 'node:fs';
import { RULES } from '../../data/schemas/index.js';
import rulesJson from '../../data/rules.json';

type Unit = (typeof RULES.units)[string];
type Building = (typeof RULES.buildings)[string];
type Item = Unit | Building;

const BASE = '/unnamed_rts';
const TICKS_PER_SECOND = 60;
const TILE = 40;

const ARMOR_LABEL: Record<string, string> = {
    infantry: 'Infantry', light: 'Light vehicles', medium: 'Medium vehicles', heavy: 'Heavy vehicles',
    building: 'Buildings', air: 'Aircraft', hijacker: 'Hijackers', none: 'Unarmored',
};
/** Armor classes shown in a damage chart, in display order. */
const CHART_ARMORS = ['infantry', 'light', 'medium', 'heavy', 'building', 'air'] as const;

const WEAPON_LABEL: Record<string, string> = {
    bullet: 'Bullets', ap_bullet: 'AP rounds', sniper: 'Sniper rifle', laser: 'Laser', cannon: 'Cannon',
    heavy_cannon: 'Heavy cannon', shell: 'Artillery shells', rocket: 'Rockets', missile: 'Missiles',
    aa_missile: 'AA missiles', air_missile: 'Air-to-ground missiles', grenade: 'Grenades', flame: 'Flames', heal: 'Healing', explosion: 'Explosion',
};

/** Fields the zod schema strips from rules.json but the game reads. */
const rawBuildings = rulesJson.buildings as Record<string, { inductionEfficiency?: number }>;

const rawUnits = rulesJson.units as Record<string, {
    transportCapacity?: number; canAttackWhileMoving?: boolean; capacity?: number; ammo?: number; fly?: boolean;
    explosionRadius?: number; explosionDamage?: number;
}>;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const mult = (n: number) => `×${n % 1 === 0 ? n : n.toFixed(2).replace(/0$/, '')}`;
const img = (kind: '3d' | '2d' | 'cameos', key: string, cls = '') =>
    `<img class="${cls}" src="/img/${kind}/${key}.png" alt="${kind === 'cameos' ? '' : kind.toUpperCase() + ' '}${esc(key)}" loading="lazy">`;

// ---- derived combat data -------------------------------------------------------------------

interface Combat {
    key: string;
    name: string;
    weapon: string;
    dps: number;
    mods: Record<string, number>; // armor -> multiplier actually applied (0 when it can't target)
    canAir: boolean;
    canGround: boolean;
    cost: number;
    /** One-off blast (Demo Truck) rather than a repeating weapon: `dps` holds the total damage. */
    burst?: boolean;
}

function combatOf(key: string, item: Item): Combat | null {
    const blast = rawUnits[key]?.explosionDamage;
    if (blast) {
        const table = RULES.damageModifiers.explosion as Record<string, number>;
        const mods: Record<string, number> = {};
        for (const armor of Object.keys(RULES.armorTypes)) mods[armor] = table[armor] ?? 1;
        return { key, name: item.name, weapon: 'explosion', dps: blast, mods, canAir: true, canGround: true, cost: item.cost, burst: true };
    }
    const weapon = item.weaponType;
    if (!weapon || !item.damage || item.damage <= 0 || !item.rate) return null;
    const table = RULES.damageModifiers[weapon] as Record<string, number> | undefined;
    const targeting = (RULES.weaponTargeting as Record<string, { canTargetAir: boolean; canTargetGround: boolean }> | undefined)?.[weapon];
    if (!table || !targeting) return null;
    const mods: Record<string, number> = {};
    for (const armor of Object.keys(RULES.armorTypes)) {
        const airArmor = armor === 'air';
        const allowed = airArmor ? targeting.canTargetAir : targeting.canTargetGround;
        mods[armor] = allowed ? (table[armor] ?? 1) : 0;
    }
    return {
        key, name: item.name, weapon,
        dps: (item.damage * TICKS_PER_SECOND) / item.rate,
        mods, canAir: targeting.canTargetAir, canGround: targeting.canTargetGround,
        cost: item.cost,
    };
}

const allItems: [string, Item][] = [...Object.entries(RULES.units), ...Object.entries(RULES.buildings)];
const combatants = allItems.map(([k, v]) => combatOf(k, v)).filter((c): c is Combat => c !== null);
const isBuildingKey = (k: string) => k in RULES.buildings;
const nameOf = (k: string) => (RULES.units[k] ?? RULES.buildings[k])?.name ?? k;

/** Units that can attack something the given armor class would be (excludes static defenses and healers). */
function bestCounters(armor: string, selfKey: string, count = 3): Combat[] {
    return combatants
        .filter(c => c.key !== selfKey && c.weapon !== 'heal' && !c.burst && !(RULES.buildings[c.key]?.isDefense))
        .filter(c => (c.mods[armor] ?? 0) >= 1)
        .map(c => ({ c, value: (c.dps * (c.mods[armor] ?? 0)) / c.cost }))
        .sort((a, b) => b.value - a.value)
        .slice(0, count)
        .map(x => x.c);
}

/** weapon -> multiplier against this armor, for weapons that matter (used by at least one unit/building). */
function weaponsVs(armor: string, pred: (m: number) => boolean): { weapon: string; m: number; users: string[] }[] {
    const used = new Map<string, string[]>();
    for (const c of combatants) {
        // Weapons that can't hit this kind of target aren't a matchup at all
        if (c.weapon === 'heal' || (armor === 'air' ? !c.canAir : !c.canGround)) continue;
        used.set(c.weapon, [...(used.get(c.weapon) ?? []), c.key]);
    }
    const out: { weapon: string; m: number; users: string[] }[] = [];
    for (const [weapon, users] of used) {
        const m = (RULES.damageModifiers[weapon] as Record<string, number>)[armor];
        if (m !== undefined && pred(m)) out.push({ weapon, m, users });
    }
    return out.sort((a, b) => Math.abs(1 - b.m) - Math.abs(1 - a.m));
}

/** Position of `value` in a list (0 = lowest, 1 = highest). */
function percentile(values: number[], value: number): number {
    const below = values.filter(v => v < value).length;
    const equal = values.filter(v => v === value).length;
    return (below + (equal - 1) / 2) / Math.max(1, values.length - 1);
}

// ---- unlock graph --------------------------------------------------------------------------

function unlockedBy(buildingKey: string): string[] {
    return allItems
        .filter(([, v]) => v.prerequisites.includes(buildingKey))
        .map(([k]) => k);
}

function prereqChips(item: Item, linkPage: (key: string) => string): string {
    if (item.prerequisites.length === 0) return '<span class="rts-muted">None</span>';
    return item.prerequisites.map(k => chip(k, linkPage(k))).join('');
}

function chip(key: string, href: string): string {
    return `<a class="rts-chip" href="${href}">${img('cameos', key)}<span>${esc(nameOf(key))}</span></a>`;
}

/** Where a key's page lives, so chips can link across both pages. */
function pageFor(key: string): string {
    if (isBuildingKey(key)) return `${BASE}/buildings/#${key}`;
    const u = RULES.units[key];
    if (u?.type === 'infantry') return `${BASE}/units/infantry#${key}`;
    if (u?.type === 'air') return `${BASE}/units/aircraft#${key}`;
    return `${BASE}/units/vehicles#${key}`;
}

// ---- shared card pieces --------------------------------------------------------------------

function statCell(label: string, value: string, hint = ''): string {
    return `<div class="rts-stat"${hint ? ` title="${esc(hint)}"` : ''}><span>${label}</span><b>${value}</b></div>`;
}

function damageChart(c: Combat): string {
    const rows = CHART_ARMORS.map(armor => {
        const m = c.mods[armor];
        const eff = c.dps * m;
        const width = Math.min(100, (m / 2.5) * 100);
        const tone = m === 0 ? 'none' : m >= 1.25 ? 'good' : m >= 0.7 ? 'ok' : m >= 0.3 ? 'poor' : 'bad';
        const label = m === 0 ? 'Cannot target' : `${mult(m)} · ${num(Math.round(eff * 10) / 10)} ${c.burst ? 'dmg' : 'dps'}`;
        return `<div class="rts-bar-row"><span class="rts-bar-label">${ARMOR_LABEL[armor]}</span>`
            + `<span class="rts-bar"><i class="${tone}" style="width:${width}%"></i></span>`
            + `<span class="rts-bar-value ${tone}">${label}</span></div>`;
    });
    return `<div class="rts-panel"><h4>Damage vs armor <small>(${esc(WEAPON_LABEL[c.weapon] ?? c.weapon)}, ${num(Math.round(c.dps * 10) / 10)} base ${c.burst ? 'damage, one blast' : 'dps'})</small></h4>${rows.join('')}</div>`;
}

function list(title: string, tone: 'pro' | 'con', items: string[]): string {
    const body = items.length
        ? `<ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>`
        : '<p class="rts-muted">Nothing notable.</p>';
    return `<div class="rts-panel rts-${tone}"><h4>${title}</h4>${body}</div>`;
}

/** "Takes extra damage from..." / "Resists..." derived from the damage table vs this armor. */
function armorMatchups(armor: string): { weak: string[]; resist: string[] } {
    const fmt = (w: { weapon: string; m: number; users: string[] }) => {
        const users = w.users.slice(0, 3).map(k => esc(nameOf(k))).join(', ') + (w.users.length > 3 ? '…' : '');
        return `<b>${esc(WEAPON_LABEL[w.weapon] ?? w.weapon)}</b> ${mult(w.m)} <span class="rts-muted">(${users})</span>`;
    };
    return {
        weak: weaponsVs(armor, m => m >= 1.4).slice(0, 4).map(fmt),
        resist: weaponsVs(armor, m => m <= 0.3).slice(0, 3).map(fmt),
    };
}

function counterRow(armor: string, selfKey: string): string {
    const counters = bestCounters(armor, selfKey);
    if (!counters.length) return '';
    return `<div class="rts-counters"><span>Best-value counters</span>${counters.map(c => chip(c.key, pageFor(c.key))).join('')}</div>`;
}

function firstSentence(text: string): { lead: string; rest: string } {
    const m = /^(.*?[.!])(\s+|$)(.*)$/s.exec(text);
    return m ? { lead: m[1], rest: m[3] } : { lead: text, rest: '' };
}

function figures(key: string): string {
    return `<div class="rts-figs"><figure>${img('3d', key)}<figcaption>3D view</figcaption></figure>`
        + `<figure>${img('2d', key, 'flat')}<figcaption>Classic 2D view</figcaption></figure>`
        + `<figure class="cameo">${img('cameos', key)}<figcaption>Build icon</figcaption></figure></div>`;
}

// ---- infantry page -------------------------------------------------------------------------

/** `poolLabel` names the class stats are ranked against, e.g. 'infantry' or 'a vehicle'. */
function unitCard(key: string, u: Unit, all: [string, Unit][], poolLabel: string): string {
    const raw = rawUnits[key] ?? {};
    const c = combatOf(key, u);
    const { lead, rest } = firstSentence(u.description ?? '');
    const pct = (sel: (x: Unit) => number) => percentile(all.map(([, x]) => sel(x)), sel(u));
    const pros: string[] = [];
    const cons: string[] = [];

    if (c) {
        for (const armor of CHART_ARMORS) {
            const m = c.mods[armor];
            if (m >= 1.4) pros.push(`Excellent against <b>${ARMOR_LABEL[armor].toLowerCase()}</b> (${mult(m)})`);
            else if (m >= 1.1 && armor !== 'infantry') pros.push(`Good against <b>${ARMOR_LABEL[armor].toLowerCase()}</b> (${mult(m)})`);
            if (m > 0 && m <= 0.3) cons.push(`Barely scratches <b>${ARMOR_LABEL[armor].toLowerCase()}</b> (${mult(m)})`);
            else if (m > 0.3 && m < 0.7) cons.push(`Weak against <b>${ARMOR_LABEL[armor].toLowerCase()}</b> (${mult(m)})`);
        }
        if (!c.burst && !c.canAir) cons.push('<b>Cannot shoot aircraft</b>');
        else if (!c.burst && c.mods.air >= 0.9) pros.push('Can shoot down <b>aircraft</b>');
        if (u.splash) pros.push(`Splash damage (radius ${u.splash}) punishes clumped units`);
        if (c.dps >= 60 && !c.burst && !raw.ammo) pros.push(`Very high damage output (${num(Math.round(c.dps))} dps)`);
        if (c.burst) { /* range and fire rate don't apply to a one-off blast */ }
        else if (u.range >= 400) pros.push(`<b>Extreme range</b> (${u.range}) outranges nearly everything`);
        else if (pct(x => x.range) >= 0.7) pros.push(`Long range (${u.range})`);
        if (!c.burst && u.range <= 90 && c.weapon !== 'heal') cons.push(`Very short range (${u.range}): must close in to fight`);
    }
    if (u.weaponType === 'heal') {
        pros.push(`Heals friendly infantry for <b>${Math.abs(u.damage)} HP</b> per pulse`);
        cons.push('Cannot attack: needs an escort');
    }
    if (u.canCaptureEnemyBuildings) pros.push('<b>Captures</b> enemy buildings that are marked capturable');
    if (u.canRepairFriendlyBuildings) pros.push('<b>Repairs</b> friendly buildings');
    if (u.canCaptureEnemyBuildings || u.canHijackVehicles) cons.push('Consumed on use, and unarmed');
    if (u.canHijackVehicles) pros.push('<b>Steals enemy vehicles</b> outright');
    if (u.interceptionAura) pros.push(`Interception aura (radius ${u.interceptionAura.radius}) shoots down incoming missiles`);

    if (raw.fly) pros.push('<b>Flies</b>: ignores terrain and can only be hit by anti-air weapons');
    if (raw.canAttackWhileMoving) pros.push('Fires while on the move');
    if (raw.transportCapacity) pros.push(`Carries up to <b>${raw.transportCapacity}</b> infantry`);
    if (raw.capacity) pros.push(`Hauls <b>${raw.capacity}</b> ore per trip`);
    if (raw.ammo) { cons.push(`Only <b>${raw.ammo}</b> shot per sortie: must return to rearm`); }
    if (raw.explosionDamage) {
        pros.push(`Detonates for <b>${raw.explosionDamage}</b> damage in a ${raw.explosionRadius} radius; chain reactions possible`);
        cons.push('Destroyed on use, and has no weapon of its own');
    }
    if (key === 'mcv') { pros.push('Deploys into a <b>Construction Yard</b> anywhere you can build'); cons.push('Cannot attack: losing it can cost you your base'); }
    if (key === 'induction_rig') { pros.push('Deploys onto an ore well for <b>infinite</b> income'); cons.push('Cannot attack, and extremely slow'); }
    if (key === 'harvester') cons.push('Your whole income: losing it stalls the economy');
    if (!c && u.weaponType !== 'heal' && !raw.explosionDamage && !cons.some(x => x.includes('Cannot attack'))) cons.push('Unarmed');
    if (pct(x => x.hp) >= 0.8) pros.push(`Tough for ${poolLabel} (${u.hp} HP)`);
    if (pct(x => x.hp) <= 0.2) cons.push(`Fragile (${u.hp} HP)`);
    if (pct(x => x.speed) >= 0.85) pros.push(`Fast (${num(u.speed)})`);
    if (pct(x => x.speed) <= 0.2) cons.push(`Slow (${num(u.speed)})`);
    if (pct(x => x.cost) <= 0.2) pros.push(`Cheap (${u.cost})`);
    if (pct(x => x.cost) >= 0.85) cons.push(`Expensive (${u.cost})`);
    if (u.prerequisites.includes('tech')) cons.push('Needs a <b>Tech Center</b>');

    const m = armorMatchups(u.armor);
    const hard = m.weak.length ? list('Dies fast to', 'con', m.weak) : '';
    if (u.armor === 'air') {
        const immune = [...new Set(combatants.filter(x => !x.canAir && x.weapon !== 'heal').map(x => x.weapon))]
            .map(w => `<b>${esc(WEAPON_LABEL[w] ?? w)}</b> <span class="rts-muted">(${combatants.filter(x => x.weapon === w).slice(0, 3).map(x => esc(x.name)).join(', ')})</span>`);
        m.resist.unshift(...immune.slice(0, 4).map(i => `Can't be hit by ${i}`));
    }
    const resists = m.resist.length ? list('Shrugs off', 'pro', m.resist) : '';

    const stats = [
        statCell('Cost', `${u.cost}`, 'Credits'),
        statCell('HP', `${u.hp}`),
        statCell('Speed', num(u.speed)),
        statCell('Sight', `${u.sightRange}`),
        ...(c && !c.burst ? [
            statCell('DPS', num(Math.round(c.dps * 10) / 10), `${u.damage} damage every ${u.rate} ticks`),
            statCell('Damage', `${u.damage}`),
            statCell('Range', `${u.range}`),
            statCell('Reload', `${num((u.rate ?? 0) / TICKS_PER_SECOND)}s`, `${u.rate} ticks`),
        ] : raw.explosionDamage ? [
            statCell('Blast', `${raw.explosionDamage}`),
            statCell('Radius', `${raw.explosionRadius}`),
        ] : u.weaponType === 'heal' ? [
            statCell('Heal', `${Math.abs(u.damage)} HP`),
            statCell('Range', `${u.range}`),
            statCell('Pulse', `${num((u.rate ?? 0) / TICKS_PER_SECOND)}s`, `${u.rate} ticks`),
        ] : []),
        ...(u.splash ? [statCell('Splash', `${u.splash}`)] : []),
        ...(raw.transportCapacity ? [statCell('Carries', `${raw.transportCapacity}`)] : []),
        ...(raw.capacity ? [statCell('Cargo', `${raw.capacity}`)] : []),
        ...(raw.ammo ? [statCell('Ammo', `${raw.ammo}`)] : []),
        statCell('Armor', ARMOR_LABEL[u.armor] ?? u.armor),
    ].join('');

    return `## ${u.name} {#${key}}

<section class="rts-card" aria-labelledby="${key}">
<div class="rts-card-top">
<p class="rts-tagline">${esc(lead)}</p>
<a class="rts-back" href="#top">↑ Index</a>
</div>
${figures(key)}
<div class="rts-stats">${stats}</div>
<div class="rts-unlock"><span>Requires</span>${prereqChips(u, pageFor)}</div>
${c ? damageChart(c) : ''}
<div class="rts-two">
${list('Strengths', 'pro', pros)}
${list('Weaknesses', 'con', cons)}
</div>
<div class="rts-two">${hard}${resists}</div>
${counterRow(u.armor, key)}
${rest ? `<p class="rts-brief"><b>Field notes:</b> ${esc(rest)}</p>` : ''}
</section>
`;
}

interface UnitPageSpec {
    title: string;
    file: string;
    types: string[];
    pool: string[];
    poolLabel: string;
    intro: string;
}

function unitPage(spec: UnitPageSpec): string {
    const pool = Object.entries(RULES.units).filter(([, u]) => spec.pool.includes(u.type));
    const all = Object.entries(RULES.units).filter(([, u]) => spec.types.includes(u.type));
    // Cheapest first reads as a tech ladder
    all.sort((a, b) => a[1].cost - b[1].cost);

    const index = all.map(([k, u]) => `<a class="rts-tile" href="#${k}">${img('cameos', k)}<b>${esc(u.name)}</b><span>${u.cost}</span></a>`).join('');
    const rows = all.map(([k, u]) => {
        const c = combatOf(k, u);
        return `<tr><td><a href="#${k}">${esc(u.name)}</a></td><td>${u.cost}</td><td>${u.hp}</td><td>${num(u.speed)}</td>`
            + `<td>${c && !c.burst ? num(Math.round(c.dps)) : '–'}</td><td>${c && !c.burst || u.weaponType === 'heal' ? u.range : '–'}</td>`
            + `<td>${u.prerequisites.map(nameOf).join(' + ')}</td></tr>`;
    }).join('');

    return `---
aside: false
pageClass: rts-wide
---

# ${spec.title} {#top}

${spec.intro} Numbers on this page are read straight from the game's \`rules.json\`, so they're always current.

<nav class="rts-index" aria-label="${spec.title} index">${index}</nav>

<div class="rts-note">
<b>How to read the charts.</b> <i>DPS</i> is damage per second at 60 ticks/s. The <i>damage vs armor</i> bars show the multiplier the unit's weapon gets against each armor class (×1 = full damage). Strengths and weaknesses are derived from those multipliers and from how each stat ranks among ${spec.poolLabel}.
</div>

<div class="rts-table-wrap"><table class="rts-table">
<thead><tr><th>Unit</th><th>Cost</th><th>HP</th><th>Speed</th><th>DPS</th><th>Range</th><th>Requires</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>

${all.map(([k, u]) => unitCard(k, u, pool, spec.poolLabel)).join('\n')}
`;
}

const UNIT_PAGES: UnitPageSpec[] = [
    {
        title: 'Infantry', file: 'docs/site/units/infantry.md', types: ['infantry'], pool: ['infantry'], poolLabel: 'infantry',
        intro: "Infantry are the cheapest troops in the game, trained at the **Barracks**. They're the backbone of an early army, the only units that can capture buildings, and the best tool for picking off specialists, but every tank in the game is built to roll over them.",
    },
    {
        title: 'Vehicles', file: 'docs/site/units/vehicles.md', types: ['vehicle'], pool: ['vehicle', 'air'], poolLabel: 'vehicles and aircraft',
        intro: 'Vehicles are built at the **War Factory**. They range from fast raiders and transports through main battle tanks to long-range siege guns, plus the support vehicles (Harvester, MCV, Induction Rig) your economy and expansion depend on.',
    },
    {
        title: 'Aircraft', file: 'docs/site/units/aircraft.md', types: ['air'], pool: ['vehicle', 'air'], poolLabel: 'vehicles and aircraft',
        intro: 'Aircraft are produced and rearmed at the **Air-Force Command**. They ignore terrain and are immune to most ground weapons, but only a handful of units and the SAM Site can shoot them down.',
    },
];

// ---- buildings page ------------------------------------------------------------------------

const HIDDEN_NOTE: Record<string, string> = {
    conyard: 'Not built directly: deploy an <b>MCV</b> to plant a Construction Yard.',
    induction_rig_deployed: 'Not built from the sidebar: deploy an <b>Induction Rig</b> vehicle onto an ore well.',
};

function buildingCard(key: string, b: Building, all: [string, Building][]): string {
    const c = combatOf(key, b);
    const { lead, rest } = firstSentence(b.description ?? '');
    const pct = (sel: (x: Building) => number) => percentile(all.map(([, x]) => sel(x)), sel(b));
    const pros: string[] = [];
    const cons: string[] = [];
    const tiles = `${num(b.w / TILE)}×${num(b.h / TILE)}`;

    if (b.power) pros.push(`Generates <b>+${b.power} power</b>`);
    if (b.provides === 'harvester') pros.push('Turns ore into credits and ships with a free <b>Harvester</b>');
    else if (b.provides) pros.push(`Production building: ${esc(b.provides)}`);
    if (b.repairRadius) pros.push(`Repairs vehicles within ${b.repairRadius} for free (${b.repairRate}/tick)`);
    if (b.landingSlots) pros.push(`Rearms and houses <b>${b.landingSlots}</b> aircraft (${num((b.reloadTicks ?? 0) / TICKS_PER_SECOND)}s reload)`);
    if (rawBuildings[key]?.inductionEfficiency) pros.push(`Infinite extraction at ${Math.round((rawBuildings[key]?.inductionEfficiency ?? 0) * 100)}% efficiency`);
    if (b.interceptionAura) pros.push(`Interception aura (radius ${b.interceptionAura.radius}, ${b.interceptionAura.dps} dps) shoots down missiles`);
    if (b.isDefense && c) {
        for (const armor of CHART_ARMORS) {
            const m = c.mods[armor];
            if (m >= 1.25) pros.push(`Strong against <b>${ARMOR_LABEL[armor].toLowerCase()}</b> (${mult(m)})`);
            if (m > 0 && m <= 0.3) cons.push(`Weak against <b>${ARMOR_LABEL[armor].toLowerCase()}</b> (${mult(m)})`);
        }
        if (!c.canAir) cons.push('<b>Cannot shoot aircraft</b>');
        if (!c.canGround) cons.push('<b>Cannot shoot ground units</b>');
        if (c.canAir && c.mods.air >= 0.9) pros.push('Can shoot <b>aircraft</b>');
        if (b.range && b.range >= 350) pros.push(`Long range (${b.range})`);
        if (c.dps >= 50) pros.push(`Heavy damage output (${num(Math.round(c.dps))} dps)`);
    } else if (!b.provides && !b.power && !b.repairRadius && !rawBuildings[key]?.inductionEfficiency && key !== 'conyard') {
        cons.push('Unarmed: relies on defenses and your army');
    }
    if (!b.isDefense) cons.push('Unarmed: relies on defenses and your army');
    if (b.capturable) cons.push('<b>Capturable</b>: an enemy Engineer can take it over');
    if ((b.drain ?? 0) >= 50) cons.push(`High power drain (<b>−${b.drain}</b>)`);
    if (pct(x => x.hp) >= 0.8) pros.push(`Very sturdy (${b.hp} HP)`);
    if (pct(x => x.hp) <= 0.2) cons.push(`Fragile (${b.hp} HP)`);
    if (pct(x => x.cost) <= 0.2) pros.push(`Cheap (${b.cost})`);
    if (pct(x => x.cost) >= 0.85) cons.push(`Expensive (${b.cost})`);
    if (b.maxCount) cons.push(`Limited to <b>${b.maxCount}</b> per player`);
    if (key === 'conyard') pros.push('Required to construct every other building');
    if (key === 'tech') pros.push('Unlocks the advanced units and the Obelisk');
    const dedupedCons = [...new Set(cons)];

    const unlocks = unlockedBy(key).filter(k => k !== key);
    const stats = [
        statCell('Cost', b.cost ? `${b.cost}` : '–', 'Credits'),
        statCell('HP', `${b.hp}`),
        statCell('Footprint', tiles, `${b.w}×${b.h} px`),
        statCell('Power', b.power ? `+${b.power}` : b.drain ? `−${b.drain}` : '0'),
        statCell('Sight', `${b.sightRange}`),
        ...(c ? [
            statCell('DPS', num(Math.round(c.dps * 10) / 10), `${b.damage} damage every ${b.rate} ticks`),
            statCell('Damage', `${b.damage}`),
            statCell('Range', `${b.range}`),
            statCell('Reload', `${num((b.rate ?? 0) / TICKS_PER_SECOND)}s`),
        ] : []),
        statCell('Armor', ARMOR_LABEL[b.armor] ?? b.armor),
    ].join('');

    const m = armorMatchups('building');
    const hard = m.weak.length ? list('Dies fast to', 'con', m.weak) : '';
    const resists = m.resist.length ? list('Shrugs off', 'pro', m.resist) : '';

    return `### ${b.name} {#${key}}

<section class="rts-card" aria-labelledby="${key}">
<div class="rts-card-top">
<p class="rts-tagline">${esc(lead)}</p>
<a class="rts-back" href="#top">↑ Index</a>
</div>
${figures(key)}
<div class="rts-stats">${stats}</div>
${HIDDEN_NOTE[key] ? `<p class="rts-note">${HIDDEN_NOTE[key]}</p>` : ''}
<div class="rts-unlock"><span>Requires</span>${prereqChips(b, pageFor)}</div>
${unlocks.length ? `<div class="rts-unlock"><span>Unlocks</span>${unlocks.map(k => chip(k, pageFor(k))).join('')}</div>` : ''}
${c ? damageChart(c) : ''}
<div class="rts-two">
${list('Strengths', 'pro', pros)}
${list('Weaknesses', 'con', dedupedCons)}
</div>
<div class="rts-two">${hard}${resists}</div>
${counterRow('building', key)}
${rest ? `<p class="rts-brief"><b>Field notes:</b> ${esc(rest)}</p>` : ''}
</section>
`;
}

function buildingsPage(): string {
    const entries = Object.entries(RULES.buildings);
    const cat = RULES.meta.buildingCategories as Record<string, string[]>;
    const placed = new Set(Object.values(cat).flat());
    const groups: { title: string; blurb: string; keys: string[] }[] = [
        { title: 'Base buildings', blurb: 'Economy, power, production and tech.', keys: cat.base ?? [] },
        { title: 'Defenses', blurb: 'Turrets and anti-air that hold the perimeter.', keys: cat.defense ?? [] },
        { title: 'Special', blurb: 'Created by deploying a vehicle, so they never appear in the build menu.', keys: entries.map(([k]) => k).filter(k => !placed.has(k)) },
    ].filter(g => g.keys.length > 0);

    const index = groups.map(g => `<h3 class="rts-index-title">${g.title}</h3><nav class="rts-index" aria-label="${g.title}">`
        + g.keys.map(k => {
            const b = RULES.buildings[k];
            return `<a class="rts-tile" href="#${k}">${img('cameos', k)}<b>${esc(b.name)}</b><span>${b.cost || 'Deploy'}</span></a>`;
        }).join('') + '</nav>').join('');

    const rows = groups.flatMap(g => g.keys).map(k => {
        const b = RULES.buildings[k];
        return `<tr><td><a href="#${k}">${esc(b.name)}</a></td><td>${b.cost || '–'}</td><td>${b.hp}</td>`
            + `<td>${b.power ? `+${b.power}` : b.drain ? `−${b.drain}` : '0'}</td>`
            + `<td>${num(b.w / TILE)}×${num(b.h / TILE)}</td><td>${b.prerequisites.map(nameOf).join(' + ') || '–'}</td></tr>`;
    }).join('');

    const sections = groups.map(g => {
        const all = g.keys.map(k => [k, RULES.buildings[k]] as [string, Building]);
        return `## ${g.title} {#${g.title.toLowerCase().replace(/\W+/g, '-')}}\n\n${g.blurb}\n\n${all.map(([k, b]) => buildingCard(k, b, entries)).join('\n')}`;
    }).join('\n');

    return `---
aside: false
pageClass: rts-wide
---

# Buildings {#top}

Your base is your economy, your production line and your last line of defense. Every structure below is listed with the same numbers the game uses (read from \`rules.json\` when this page is generated), plus what it unlocks, what it needs and where it's vulnerable. Footprints are in map tiles (${TILE} px each); power is generation (+) or drain (−).

${index}

<div class="rts-note">
<b>Tip.</b> Buildings are only as safe as your power and your perimeter: most are <i>capturable</i>, so an unwatched Engineer can flip a Refinery or even a Construction Yard. Artillery, MLRS and heavy cannons deal the most damage to structures.
</div>

<div class="rts-table-wrap"><table class="rts-table">
<thead><tr><th>Building</th><th>Cost</th><th>HP</th><th>Power</th><th>Tiles</th><th>Requires</th></tr></thead>
<tbody>${rows}</tbody>
</table></div>

${sections}
`;
}

for (const spec of UNIT_PAGES) writeFileSync(spec.file, unitPage(spec));
writeFileSync('docs/site/buildings/index.md', buildingsPage());
console.log('wrote unit pages and docs/site/buildings/index.md');

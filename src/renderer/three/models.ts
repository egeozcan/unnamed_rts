import { RULES } from '../../data/schemas/index.js';
import { AIRBASE_PAD_HEIGHT, AIRBASE_SLOT_OFFSETS } from './projection.js';
import { Shape, type Paint } from './shape.js';

/**
 * How a model part is posed each frame:
 * - body:   follows the entity (position + hull rotation)
 * - turret: rotates around `pivot` to the entity's turret angle
 * - spin:   rotates around `pivot` continuously (rotors, radar dishes, holograms)
 */
export type PartMode = 'body' | 'turret' | 'spin';

/** lit = shaded and shadow casting; glow = unlit, full-bright (energy cores, crystals, exhaust). */
export type PartMaterial = 'lit' | 'glow';

export interface ModelPart {
    readonly shape: Shape;
    readonly material: PartMaterial;
    readonly mode: PartMode;
    readonly pivot?: readonly [number, number, number];
    /** Radians per game tick, for `spin` parts. */
    readonly spinSpeed?: number;
}

export interface ModelDef {
    readonly parts: readonly ModelPart[];
}

export const C = {
    track: 0x1d1e20,
    trackTop: 0x3b3c3f,
    steel: 0x8e939a,
    steelDark: 0x585c63,
    gunmetal: 0x2d3034,
    black: 0x121314,
    concrete: 0xb2ae9e,
    concreteDark: 0x878375,
    slab: 0x7d7a6e,
    tarmac: 0x3d4044,
    tarmacLight: 0x575b61,
    glass: 0x78b8dc,
    gold: 0xe8b02a,
    goldDark: 0xa7740f,
    goldLight: 0xffd75a,
    hazard: 0xf2c21d,
    white: 0xeeeeee,
    red: 0xc0392b,
    skin: 0xd9ad85,
    olive: 0x5d6436,
    pants: 0x3f4433,
    sand: 0xb8a172,
    dirt: 0x6e5c40,
    rock: 0x83725f,
    rockDark: 0x5f5244,
    obsidian: 0x25272d,
    energyGreen: 0x6dff8a,
    energyRed: 0xff3b2f,
    energyBlue: 0x6fd8ff,
    exhaust: 0xffa640,
} as const;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function part(shape: Shape, mode: PartMode = 'body', material: PartMaterial = 'lit', pivot?: [number, number, number], spinSpeed?: number): ModelPart {
    return { shape, mode, material, pivot, spinSpeed };
}

/** Pair of tank tracks with rounded ends. */
function tracks(s: Shape, length: number, width: number, trackWidth: number, trackHeight: number): void {
    const r = trackHeight / 2;
    for (const side of [-1, 1]) {
        const z = side * (width / 2 - trackWidth / 2);
        s.box(0, z, length - trackHeight, trackWidth, 0, trackHeight, C.track);
        s.rod(length / 2 - r, r, z - trackWidth / 2, r, trackWidth, C.track, { yaw: Math.PI / 2, segments: 8 });
        s.rod(-length / 2 + r, r, z - trackWidth / 2, r, trackWidth, C.track, { yaw: Math.PI / 2, segments: 8 });
        s.box(0, z, length - trackHeight * 1.2, trackWidth * 0.8, trackHeight, 0.35, C.trackTop);
    }
}

/** Wheels along both sides at the given x positions. */
function wheels(s: Shape, xs: number[], width: number, radius: number, wheelWidth: number): void {
    for (const x of xs) {
        for (const side of [-1, 1]) {
            const zInner = side > 0 ? width / 2 - wheelWidth : -width / 2;
            s.rod(x, radius, zInner, radius, wheelWidth, C.track, { yaw: Math.PI / 2, segments: 10 });
        }
    }
}

function slab(s: Shape, w: number, h: number, paint: Paint = C.slab, height = 2): void {
    s.box(0, 0, w - 2, h - 2, 0, height, paint);
}

/** A standard tank turret: tapered housing, mantlet and barrel(s). Pivot-relative. */
function tankTurret(size: number, barrelLength: number, barrelRadius: number, barrels: number[] = [0]): Shape {
    const t = new Shape();
    t.taper(0, 0, size * 1.15, size, size * 0.85, size * 0.78, 0, size * 0.42, 'team');
    t.cyl(-size * 0.15, size * 0.18, size * 0.14, size * 0.14, size * 0.42, size * 0.06, 'teamDark', 8);
    t.box(size * 0.58, 0, size * 0.16, size * 0.42, size * 0.08, size * 0.26, C.gunmetal);
    for (const z of barrels) {
        t.rod(size * 0.6, size * 0.22, z, barrelRadius, barrelLength, C.gunmetal, { segments: 8 });
        t.rod(size * 0.6 + barrelLength, size * 0.22, z, barrelRadius * 1.35, barrelLength * 0.12, C.gunmetal, { segments: 8 });
    }
    return t;
}

// ---------------------------------------------------------------------------------------------
// Infantry
// ---------------------------------------------------------------------------------------------

interface InfantryStyle {
    torso?: Paint;
    helmet?: Paint;
    head?: Paint;
    legs?: Paint;
    gear?: (s: Shape) => void;
}

function infantry(style: InfantryStyle = {}): ModelDef {
    const s = new Shape();
    const legs = style.legs ?? C.pants;
    s.box(0, -1.4, 2.3, 2.1, 0, 6, legs);
    s.box(0, 1.4, 2.3, 2.1, 0, 6, legs);
    s.taper(0, 0, 4, 6.2, 3.6, 5.4, 6, 5, style.torso ?? 'team');
    s.box(0, 0, 4.2, 6.4, 6, 0.8, C.gunmetal);
    s.box(1.5, -3.2, 3.8, 1.5, 8.2, 1.5, style.torso ?? 'team');
    s.box(1.5, 3.2, 3.8, 1.5, 8.2, 1.5, style.torso ?? 'team');
    s.sphere(0.2, 12.4, 0, 1.9, style.head ?? C.skin, [1, 1, 1], 8);
    if (style.helmet !== undefined) s.dome(0, 0, 12.7, 2.3, style.helmet, 0.75, 8);
    style.gear?.(s);
    return { parts: [part(s)] };
}

const rifle = (s: Shape) => s.rod(-0.5, 8.8, 0.8, 0.55, 8.5, C.gunmetal, { segments: 6 });

// ---------------------------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------------------------

function lightTank(w: number): ModelDef {
    const L = w * 0.95, W = w * 0.8, k = w / 28;
    const s = new Shape();
    tracks(s, L, W, 5.5 * k, 6 * k);
    s.taper(0, 0, L * 0.82, W * 0.55, L * 0.7, W * 0.5, 2.5 * k, 6 * k, 'team');
    s.box(0, W / 2 - 2.75 * k, L * 0.9, 5.5 * k, 6 * k, 0.8 * k, 'teamDark');
    s.box(0, -(W / 2 - 2.75 * k), L * 0.9, 5.5 * k, 6 * k, 0.8 * k, 'teamDark');
    s.box(-L * 0.3, 0, 5 * k, 8 * k, 8.5 * k, 0.6 * k, C.gunmetal);
    return { parts: [part(s), part(tankTurret(10 * k, 11 * k, 0.8 * k), 'turret', 'lit', [1 * k, 8.5 * k, 0])] };
}

function heavyTank(w: number): ModelDef {
    const L = w * 0.95, W = w * 0.82, k = w / 34;
    const s = new Shape();
    tracks(s, L, W, 7 * k, 7 * k);
    s.taper(0, 0, L * 0.85, W * 0.6, L * 0.68, W * 0.52, 3 * k, 7 * k, 'team');
    s.box(0, W / 2 - 3.5 * k, L * 0.92, 7 * k, 7 * k, 1 * k, 'teamDark');
    s.box(0, -(W / 2 - 3.5 * k), L * 0.92, 7 * k, 7 * k, 1 * k, 'teamDark');
    s.box(-L * 0.32, 0, 6 * k, 10 * k, 10 * k, 0.8 * k, C.gunmetal);
    s.cyl(-L * 0.32, -4 * k, 1 * k, 1 * k, 10 * k, 2 * k, C.gunmetal, 6);
    return { parts: [part(s), part(tankTurret(13 * k, 14 * k, 1.2 * k), 'turret', 'lit', [0, 10 * k, 0])] };
}

function mammothTank(w: number): ModelDef {
    const L = w * 0.95, W = w * 0.86, k = w / 40;
    const s = new Shape();
    tracks(s, L, W, 9 * k, 8 * k);
    s.taper(0, 0, L * 0.86, W * 0.56, L * 0.7, W * 0.5, 3 * k, 8.5 * k, 'team');
    s.box(0, W / 2 - 4.5 * k, L * 0.94, 9 * k, 8 * k, 1.2 * k, 'teamDark');
    s.box(0, -(W / 2 - 4.5 * k), L * 0.94, 9 * k, 8 * k, 1.2 * k, 'teamDark');
    s.box(-L * 0.34, 0, 7 * k, 14 * k, 11.5 * k, 1 * k, C.gunmetal);

    const t = tankTurret(15 * k, 15 * k, 1.2 * k, [-2.4 * k, 2.4 * k]);
    // Missile pods on the turret flanks
    for (const side of [-1, 1]) {
        t.box(-1 * k, side * 10.5 * k, 9 * k, 4 * k, 1 * k, 4 * k, C.steelDark);
        t.rod(3.4 * k, 2.2 * k, side * 9.6 * k, 0.7 * k, 1.2 * k, C.red, { segments: 6 });
        t.rod(3.4 * k, 4 * k, side * 9.6 * k, 0.7 * k, 1.2 * k, C.red, { segments: 6 });
        t.rod(3.4 * k, 2.2 * k, side * 11.4 * k, 0.7 * k, 1.2 * k, C.red, { segments: 6 });
        t.rod(3.4 * k, 4 * k, side * 11.4 * k, 0.7 * k, 1.2 * k, C.red, { segments: 6 });
    }
    return { parts: [part(s), part(t, 'turret', 'lit', [0, 11.5 * k, 0])] };
}

function flameTank(w: number): ModelDef {
    const L = w * 0.95, W = w * 0.8, k = w / 30;
    const s = new Shape();
    tracks(s, L, W, 6 * k, 6 * k);
    s.taper(0, 0, L * 0.82, W * 0.55, L * 0.7, W * 0.5, 2.5 * k, 6.5 * k, 'team');
    for (const side of [-1, 1]) {
        s.rod(-L * 0.42, 10 * k, side * 3 * k, 2.2 * k, 7 * k, C.red, { segments: 10 });
    }
    const t = new Shape();
    t.taper(0, 0, 11 * k, 10 * k, 8.5 * k, 7.5 * k, 0, 4.5 * k, 'team');
    t.box(5 * k, 0, 2 * k, 6 * k, 0.6 * k, 2.6 * k, C.gunmetal);
    for (const side of [-1, 1]) {
        t.rod(5.5 * k, 2 * k, side * 1.7 * k, 1 * k, 7 * k, C.gunmetal, { segments: 8, endRadius: 1.25 * k });
    }
    const flame = new Shape();
    for (const side of [-1, 1]) flame.sphere(12.8 * k, 2 * k, side * 1.7 * k, 0.9 * k, C.exhaust, [1, 1, 1], 6);
    return {
        parts: [
            part(s),
            part(t, 'turret', 'lit', [1 * k, 9 * k, 0]),
            part(flame, 'turret', 'glow', [1 * k, 9 * k, 0]),
        ]
    };
}

function stealthTank(w: number): ModelDef {
    const L = w * 0.95, W = w * 0.8, k = w / 28;
    const s = new Shape();
    tracks(s, L, W, 5 * k, 4.5 * k);
    s.taper(0, 0, L * 0.95, W * 0.92, L * 0.6, W * 0.5, 3 * k, 5 * k, C.obsidian, -1 * k);
    s.box(0, 0, L * 0.6, 1.2 * k, 8 * k, 0.2 * k, 'team');
    const t = new Shape();
    for (const side of [-1, 1]) {
        t.box(0, side * 4 * k, 9 * k, 3 * k, 0, 2.6 * k, C.obsidian);
        t.rod(4.5 * k, 1.3 * k, side * 4 * k, 0.9 * k, 1 * k, 'team', { segments: 6 });
    }
    return { parts: [part(s), part(t, 'turret', 'lit', [-1 * k, 7 * k, 0])] };
}

function artillery(w: number): ModelDef {
    const L = w * 0.95, W = w * 0.78, k = w / 30;
    const s = new Shape();
    tracks(s, L, W, 5.5 * k, 5.5 * k);
    s.taper(0, 0, L * 0.85, W * 0.6, L * 0.75, W * 0.55, 2.5 * k, 5 * k, 'team');
    s.box(-L * 0.38, 0, 3 * k, W * 0.7, 2 * k, 3 * k, C.gunmetal); // recoil spade
    const t = new Shape();
    t.box(-1 * k, 0, 12 * k, 10 * k, 0, 4 * k, 'teamDark');
    t.box(-1 * k, 0, 8 * k, 6 * k, 4 * k, 1.5 * k, C.steelDark);
    t.rod(-2 * k, 4 * k, 0, 1.3 * k, 22 * k, C.gunmetal, { pitch: 0.32, segments: 8 });
    t.rod(-2 * k, 4 * k, 0, 2 * k, 6 * k, C.steelDark, { pitch: 0.32, segments: 8 });
    return { parts: [part(s), part(t, 'turret', 'lit', [-2 * k, 7.5 * k, 0])] };
}

function mlrs(w: number): ModelDef {
    const L = w * 0.95, W = w * 0.78, k = w / 30;
    const s = new Shape();
    tracks(s, L, W, 5.5 * k, 5.5 * k);
    s.box(0, 0, L * 0.85, W * 0.62, 2.5 * k, 5 * k, 'team');
    s.box(L * 0.32, 0, 7 * k, W * 0.62, 7.5 * k, 5 * k, 'teamDark');
    s.box(L * 0.32 + 3.6 * k, 0, 0.3 * k, W * 0.5, 9 * k, 2.6 * k, C.glass);
    const t = new Shape();
    t.box(0, 0, 6 * k, 6 * k, 0, 2 * k, C.steelDark);
    t.taper(0, 0, 13 * k, 12 * k, 13 * k, 12 * k, 2 * k, 6 * k, C.olive, 3 * k);
    for (const row of [0, 1]) {
        for (const col of [-1, 0, 1]) {
            t.rod(6.2 * k + row * 1.6 * k, (4 + row * 2.6) * k, col * 3.6 * k, 1.1 * k, 1.2 * k, C.red, { segments: 6, pitch: 0.45 });
        }
    }
    return { parts: [part(s), part(t, 'turret', 'lit', [-4 * k, 7.5 * k, 0])] };
}

function jeep(w: number): ModelDef {
    const L = w * 0.95, W = w * 0.72, k = w / 22;
    const s = new Shape();
    wheels(s, [-L * 0.3, L * 0.3], W, 2.6 * k, 2.4 * k);
    s.box(0, 0, L * 0.85, W * 0.78, 2.4 * k, 4 * k, 'team');
    s.taper(L * 0.28, 0, L * 0.3, W * 0.72, L * 0.22, W * 0.66, 6.4 * k, 1.2 * k, 'teamDark');
    s.box(L * 0.12, 0, 0.5 * k, W * 0.7, 6.4 * k, 3 * k, C.glass);
    s.box(-L * 0.05, 0, L * 0.24, W * 0.6, 6.4 * k, 0.6 * k, C.gunmetal);
    const t = new Shape();
    t.cyl(0, 0, 0.8 * k, 1.1 * k, 0, 3 * k, C.gunmetal, 6);
    t.box(0.5 * k, 0, 4 * k, 2 * k, 3 * k, 1.8 * k, C.gunmetal);
    t.rod(2.5 * k, 3.9 * k, 0, 0.5 * k, 6 * k, C.gunmetal, { segments: 6 });
    return { parts: [part(s), part(t, 'turret', 'lit', [-L * 0.28, 6.4 * k, 0])] };
}

function apc(w: number): ModelDef {
    const L = w * 0.98, W = w * 0.82, k = w / 25;
    const s = new Shape();
    tracks(s, L, W, 4.5 * k, 5 * k);
    s.taper(-0.5 * k, 0, L * 0.92, W * 0.8, L * 0.66, W * 0.66, 2.5 * k, 8 * k, 'team', -2.5 * k);
    s.box(-L * 0.22, 0, 6 * k, 5 * k, 10.5 * k, 0.5 * k, C.gunmetal);
    s.box(-L * 0.49, 0, 0.5 * k, 6 * k, 3 * k, 6 * k, C.gunmetal); // rear ramp
    const t = new Shape();
    t.cyl(0, 0, 2.5 * k, 3 * k, 0, 2.2 * k, 'teamDark', 8);
    t.rod(1.5 * k, 1.2 * k, 0, 0.45 * k, 6 * k, C.gunmetal, { segments: 6 });
    return { parts: [part(s), part(t, 'turret', 'lit', [2 * k, 10.5 * k, 0])] };
}

function harvester(w: number): ModelDef {
    const L = w * 0.97, W = w * 0.86, k = w / 35;
    const s = new Shape();
    tracks(s, L * 0.9, W, 6 * k, 6 * k);
    s.box(-1 * k, 0, L * 0.8, W * 0.66, 3 * k, 5 * k, 'team');
    // Cab (front right)
    s.box(L * 0.28, W * 0.22, 8 * k, 8 * k, 8 * k, 8 * k, C.steelDark);
    s.box(L * 0.28 + 4.1 * k, W * 0.22, 0.4 * k, 6 * k, 11 * k, 4 * k, C.glass);
    // Collector maw with rollers
    s.box(L * 0.45, 0, 4 * k, W * 0.92, 1.5 * k, 8 * k, C.gunmetal);
    for (const y of [3, 6.2]) s.rod(L * 0.49, y * k, -W * 0.44, 1.2 * k, W * 0.88, C.steel, { yaw: Math.PI / 2, segments: 8 });
    // Cargo tub
    const tubX = -L * 0.12, tubL = L * 0.55, tubW = W * 0.78;
    s.box(tubX, 0, tubL, tubW, 8 * k, 2 * k, 'teamDark');
    s.box(tubX - tubL / 2 + 0.8 * k, 0, 1.6 * k, tubW, 10 * k, 7 * k, 'teamDark');
    s.box(tubX + tubL / 2 - 0.8 * k, 0, 1.6 * k, tubW, 10 * k, 7 * k, 'teamDark');
    s.box(tubX, tubW / 2 - 0.8 * k, tubL, 1.6 * k, 10 * k, 7 * k, 'teamDark');
    s.box(tubX, -tubW / 2 + 0.8 * k, tubL, 1.6 * k, 10 * k, 7 * k, 'teamDark');
    s.box(tubX, tubW / 2, tubL, 0.4 * k, 13 * k, 1.5 * k, C.hazard);
    s.box(tubX, -tubW / 2, tubL, 0.4 * k, 13 * k, 1.5 * k, C.hazard);
    s.gem(tubX - 2 * k, 13 * k, -2 * k, 4 * k, C.gold, [1.4, 0.7, 1.2]);
    s.gem(tubX + 4 * k, 12.5 * k, 3 * k, 3.4 * k, C.goldDark, [1.2, 0.7, 1.1]);
    return { parts: [part(s)] };
}

function mcv(w: number): ModelDef {
    const L = w * 0.97, W = w * 0.78, k = w / 45;
    const s = new Shape();
    tracks(s, L, W, 7 * k, 7 * k);
    s.box(0, 0, L * 0.9, W * 0.7, 3 * k, 6 * k, 'team');
    // Cab
    s.box(L * 0.36, 0, 9 * k, W * 0.7, 9 * k, 7 * k, 'teamDark');
    s.box(L * 0.36 + 4.6 * k, 0, 0.4 * k, W * 0.6, 12 * k, 3.5 * k, C.glass);
    // Folded construction module
    s.box(-L * 0.12, 0, L * 0.5, W * 0.72, 9 * k, 9 * k, C.concrete);
    s.box(-L * 0.12, 0, L * 0.52, W * 0.74, 15 * k, 1.5 * k, 'team');
    s.box(-L * 0.12, -W * 0.2, L * 0.46, 3 * k, 18 * k, 2.5 * k, C.hazard);
    s.box(-L * 0.38, -W * 0.2, 3 * k, 3 * k, 9 * k, 11 * k, C.hazard);
    s.cyl(-L * 0.2, W * 0.18, 2.6 * k, 0.6 * k, 16.5 * k, 3 * k, C.steel, 8);
    return { parts: [part(s)] };
}

function inductionRig(w: number): ModelDef {
    const L = w * 0.97, W = w * 0.8, k = w / 40;
    const s = new Shape();
    tracks(s, L, W, 6.5 * k, 6.5 * k);
    s.box(0, 0, L * 0.88, W * 0.68, 3 * k, 6 * k, 'team');
    s.box(L * 0.34, 0, 8 * k, W * 0.6, 9 * k, 6 * k, 'teamDark');
    s.box(L * 0.34 + 4.1 * k, 0, 0.4 * k, W * 0.5, 11 * k, 3 * k, C.glass);
    // Folded derrick lying along the back
    for (const side of [-1, 1]) s.rod(-L * 0.45, 11 * k, side * 5 * k, 0.9 * k, L * 0.7, C.hazard, { segments: 6, pitch: 0.12 });
    for (let i = 0; i < 4; i++) s.box(-L * 0.4 + i * 6 * k, 0, 0.8 * k, 10 * k, 11.5 * k + i * 0.7 * k, 0.8 * k, C.hazard);
    s.cyl(-L * 0.1, 0, 3.5 * k, 3.5 * k, 9 * k, 3 * k, C.steelDark, 10);
    const glow = new Shape();
    glow.cyl(-L * 0.1, 0, 2.2 * k, 2.2 * k, 12 * k, 0.6 * k, C.energyBlue, 10);
    return { parts: [part(s), part(glow, 'body', 'glow')] };
}

function demoTruck(w: number): ModelDef {
    const L = w * 0.97, W = w * 0.72, k = w / 30;
    const s = new Shape();
    wheels(s, [-L * 0.32, -L * 0.08, L * 0.3], W, 2.6 * k, 2.6 * k);
    s.box(0, 0, L * 0.9, W * 0.75, 2.6 * k, 2.5 * k, C.gunmetal);
    s.box(L * 0.3, 0, 8 * k, W * 0.75, 5 * k, 7 * k, 'team');
    s.box(L * 0.3 + 4.1 * k, 0, 0.4 * k, W * 0.65, 8 * k, 3 * k, C.glass);
    s.box(-L * 0.15, 0, L * 0.55, W * 0.78, 5 * k, 1 * k, 'teamDark');
    for (const [x, z, paint] of [[-9, -3.2, C.red], [-9, 3.2, C.hazard], [-3.5, -3.2, C.hazard], [-3.5, 3.2, C.red]] as const) {
        s.cyl(x * k, z * k, 2.4 * k, 2.4 * k, 6 * k, 7 * k, paint, 10);
        s.cyl(x * k, z * k, 2.5 * k, 2.5 * k, 9 * k, 0.8 * k, C.black, 10);
    }
    return { parts: [part(s)] };
}

function heli(w: number): ModelDef {
    const k = w / 20;
    const s = new Shape();
    s.sphere(1.5 * k, 5 * k, 0, 4.5 * k, 'team', [1.5, 0.9, 0.95], 10);
    s.sphere(5.6 * k, 5.4 * k, 0, 2.4 * k, C.glass, [1.1, 0.9, 1], 8);
    s.rod(-3 * k, 5.6 * k, 0, 1.3 * k, 11 * k, 'teamDark', { yaw: Math.PI, pitch: -0.08, endRadius: 0.55 * k, segments: 6 });
    s.taper(-13.5 * k, 0, 2.6 * k, 0.6 * k, 1.6 * k, 0.5 * k, 5.6 * k, 4.5 * k, 'teamDark', -1 * k);
    s.box(-13 * k, 0, 1.6 * k, 6 * k, 6.5 * k, 0.4 * k, 'teamDark');
    for (const side of [-1, 1]) {
        s.rod(-5 * k, 0.4 * k, side * 3.6 * k, 0.4 * k, 11 * k, C.gunmetal, { segments: 5 });
        s.box(-2 * k, side * 3.2 * k, 0.6 * k, 0.6 * k, 0.4 * k, 2 * k, C.gunmetal);
        s.box(2.5 * k, side * 3.2 * k, 0.6 * k, 0.6 * k, 0.4 * k, 2 * k, C.gunmetal);
        s.rod(1 * k, 3 * k, side * 5 * k, 0.7 * k, 5 * k, C.gunmetal, { segments: 6 });
    }
    s.cyl(1.5 * k, 0, 0.7 * k, 0.9 * k, 8.8 * k, 1.8 * k, C.gunmetal, 6);
    const rotor = new Shape();
    rotor.box(0, 0, 24 * k, 1.3 * k, 0, 0.3 * k, C.black);
    rotor.box(0, 0, 1.3 * k, 24 * k, 0, 0.3 * k, C.black);
    rotor.cyl(0, 0, 1.2 * k, 1.2 * k, -0.2 * k, 0.8 * k, C.gunmetal, 6);
    return { parts: [part(s), part(rotor, 'spin', 'lit', [1.5 * k, 10.6 * k, 0], 0.85)] };
}

function harrier(w: number): ModelDef {
    const k = w / 25;
    const s = new Shape();
    s.rod(-10 * k, 3.5 * k, 0, 1.9 * k, 19 * k, 'team', { endRadius: 1.6 * k, segments: 8 });
    s.rod(9 * k, 3.5 * k, 0, 1.6 * k, 4.5 * k, 'teamDark', { endRadius: 0.2 * k, segments: 8 });
    s.sphere(5 * k, 5 * k, 0, 1.5 * k, C.glass, [2.2, 0.9, 0.9], 8);
    for (const side of [-1, 1]) {
        s.box(-1.5 * k, side * 5.5 * k, 7 * k, 10 * k, 3 * k, 0.6 * k, 'team', side * 0.35);
        s.box(-3.5 * k, side * 10 * k, 2.5 * k, 2 * k, 3.1 * k, 0.4 * k, 'teamDark', side * 0.35);
        s.box(-10.5 * k, side * 3 * k, 3.5 * k, 4.5 * k, 3.8 * k, 0.4 * k, 'teamDark', side * 0.35);
        s.rod(-3 * k, 2 * k, side * 6.5 * k, 0.5 * k, 6 * k, C.white, { segments: 5 });
        s.box(1 * k, side * 2.3 * k, 3 * k, 1.2 * k, 2.6 * k, 1.8 * k, C.steelDark); // intake
    }
    s.taper(-9.5 * k, 0, 4.5 * k, 0.6 * k, 2.2 * k, 0.4 * k, 4.6 * k, 4.4 * k, 'teamDark', -1.6 * k);
    const exhaust = new Shape();
    exhaust.sphere(-10.6 * k, 3.5 * k, 0, 1.3 * k, C.exhaust, [1.3, 0.9, 0.9], 6);
    return { parts: [part(s), part(exhaust, 'body', 'glow')] };
}

// ---------------------------------------------------------------------------------------------
// Buildings (axis aligned; footprint w along X, h along Z, north is -Z)
// ---------------------------------------------------------------------------------------------

function conyard(w: number, h: number): ModelDef {
    const s = new Shape();
    slab(s, w, h, C.concreteDark);
    s.box(-8, 6, 52, 46, 2, 20, C.concrete);
    s.box(-8, 6, 52.6, 46.6, 15, 3, 'team');
    s.taper(-8, 6, 52, 46, 44, 38, 22, 3, C.concreteDark);
    s.box(-8, 6, 34, 28, 25, 0.5, 'teamDark');
    s.box(-8, 29.4, 18, 0.6, 2, 12, C.gunmetal);
    s.box(26, 24, 22, 24, 2, 11, C.steel);
    s.box(26, 24, 22.6, 24.6, 13, 1.5, 'teamDark');
    s.cyl(-22, -6, 2.6, 2.6, 25, 4, C.gunmetal, 8);
    s.cyl(-14, -6, 2.6, 2.6, 25, 4, C.gunmetal, 8);
    // Crane
    s.box(28, -26, 7, 7, 2, 31, C.hazard);
    s.box(12, -26, 42, 4, 30, 3, C.hazard);
    s.box(35, -26, 7, 6, 27, 5, C.gunmetal);
    s.rod(-6, 30, -26, 0.3, 13, C.gunmetal, { pitch: -Math.PI / 2, segments: 4 });
    s.box(-6, -26, 2.2, 2.2, 15, 2.2, C.gunmetal);
    return { parts: [part(s)] };
}

function powerPlant(w: number, h: number): ModelDef {
    const s = new Shape();
    slab(s, w, h);
    s.box(0, 0, 44, 44, 2, 8, C.concrete);
    s.box(0, 0, 44.6, 44.6, 7, 2, 'team');
    s.box(0, 0, 40, 40, 10, 0.3, 'teamDark');
    for (const [x, z] of [[-12, -10], [12, -10], [0, 12]]) {
        s.cyl(x, z, 6.6, 9.2, 2, 22, C.concrete, 14);
        s.cyl(x, z, 7.4, 6.6, 24, 14, C.concrete, 14);
        s.cyl(x, z, 7.6, 7.6, 33, 2.2, 'team', 14);
        s.cyl(x, z, 6.3, 6.3, 37.9, 0.2, C.gunmetal, 14);
    }
    s.cyl(0, -2, 4.2, 4.2, 10, 1, C.steelDark, 8);
    const glow = new Shape();
    glow.cyl(0, -2, 3, 3, 11, 8, C.energyGreen, 8);
    return { parts: [part(s), part(glow, 'body', 'glow')] };
}

function refinery(w: number, h: number): ModelDef {
    const s = new Shape();
    slab(s, w, h);
    s.box(-20, -6, 50, 44, 2, 18, C.concrete);
    s.box(-20, -6, 50.6, 44.6, 14, 2.5, 'team');
    s.taper(-20, -6, 50, 44, 44, 38, 20, 2, 'teamDark');
    for (const z of [-20, 6]) {
        s.cyl(28, z, 10, 10, 2, 30, C.steel, 16);
        s.cyl(28, z, 10.4, 10.4, 10, 2, 'team', 16);
        s.cyl(28, z, 10.4, 10.4, 24, 2, 'team', 16);
        s.dome(28, z, 32, 10, C.steelDark, 0.5, 16);
        s.rod(5, 8, z, 1.6, 13, C.steelDark, { segments: 8 });
    }
    // Conveyor down to the harvester dock on the south side
    s.box(-6, 26, 9, 22, 2, 5, C.gunmetal);
    s.box(-6, 26, 7, 22, 7, 0.4, C.track);
    s.cyl(-6, 32.5, 7, 3, 4, 9, C.steelDark, 10);
    s.box(-6, 38.6, 40, 1, 2, 0.3, C.hazard);
    const glow = new Shape();
    glow.box(-20, -6, 24, 5, 22, 0.4, C.gold);
    glow.box(-20, -16, 24, 5, 22, 0.4, C.gold);
    return { parts: [part(s), part(glow, 'body', 'glow')] };
}

function barracks(w: number, h: number): ModelDef {
    const s = new Shape();
    s.box(0, -20, w - 2, h / 2 - 2, 0, 1.5, C.dirt);
    s.box(0, 19, w - 2, h / 2, 0, 2, C.concreteDark);
    s.taper(0, 12, 40, 34, 32, 26, 2, 15, C.olive);
    s.taper(0, 12, 32, 26, 26, 20, 17, 1.2, 'teamDark');
    s.box(0, 12, 22, 5, 18.2, 0.4, 'team');
    s.box(0, 28.6, 10, 0.8, 2, 8, C.gunmetal);
    for (const x of [-15, 15]) s.taper(x, -22, 14, 12, 14, 0.2, 1.5, 8, C.sand);
    for (const x of [-4, 2]) s.rod(x, 1.5, -30, 0.8, 10, C.dirt, { yaw: Math.PI / 2, segments: 6 });
    s.rod(24, 2, -10, 0.4, 22, C.steel, { pitch: Math.PI / 2, segments: 5 });
    s.box(27, -10, 6, 0.4, 19, 4, 'team');
    return { parts: [part(s)] };
}

function factory(w: number, h: number): ModelDef {
    const s = new Shape();
    slab(s, w, h);
    s.box(0, 36, 40, 24, 2, 0.4, C.tarmac);
    s.box(0, -22, 84, 26, 2, 30, C.concrete);
    s.box(0, -22, 84.6, 26.6, 24, 3, 'team');
    s.box(0, -22, 78, 20, 32, 0.3, 'teamDark');
    for (const x of [-32, 32]) {
        s.box(x, 6, 20, 32, 2, 24, C.concrete);
        s.box(x, 6, 20.6, 32.6, 19, 2.5, 'team');
        s.box(x, 6, 16, 28, 26, 0.3, 'teamDark');
        s.cyl(x, 12, 2.4, 2.4, 26, 5, C.gunmetal, 8);
    }
    s.box(0, -8.6, 36, 0.8, 2, 22, C.gunmetal);
    for (let i = 0; i < 5; i++) s.box(0, -8.1, 36, 0.3, 4 + i * 4, 0.6, C.steelDark);
    s.cyl(0, -22, 7.5, 7.5, 32, 1.2, 'team', 10);
    s.cyl(0, -22, 3, 3, 33.2, 0.6, C.gunmetal, 8);
    return { parts: [part(s)] };
}

function techCenter(w: number, h: number): ModelDef {
    const s = new Shape();
    const r = Math.min(w, h) / 2;
    s.cyl(0, 0, r - 4, r - 2, 0, 6, C.concrete, 6);
    s.cyl(0, 0, r - 3.6, r - 3.6, 4, 1.6, 'team', 6);
    s.cyl(0, 0, r - 5, r - 5, 6, 0.3, 'teamDark', 6);
    s.dome(0, 0, 6, r * 0.55, C.glass, 0.9, 16);
    const glow = new Shape();
    for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const x = Math.cos(a) * (r - 8), z = Math.sin(a) * (r - 8);
        s.cyl(x, z, 1.6, 2.6, 6, 13, C.steel, 6);
        glow.sphere(x, 20.5, z, 1.8, C.energyBlue, [1, 1, 1], 6);
    }
    const dish = new Shape();
    dish.rod(0, 0, 0, 0.6, 5, C.steel, { pitch: Math.PI / 2, segments: 5 });
    dish.cyl(1.5, 0, 5, 0.8, 4, 2.5, C.white, 10);
    const domeTop = 6 + r * 0.55 * 0.9;
    return {
        parts: [
            part(s),
            part(glow, 'body', 'glow'),
            part(dish, 'spin', 'lit', [0, domeTop - 1, 0], 0.03),
        ]
    };
}

function airforceCommand(w: number, h: number): ModelDef {
    const s = new Shape();
    s.box(0, 0, w - 2, h - 2, 0, AIRBASE_PAD_HEIGHT, C.tarmac);
    s.box(0, -(h / 2 - 1.5), w - 2, 1, AIRBASE_PAD_HEIGHT, 0.2, 'team');
    s.box(0, h / 2 - 1.5, w - 2, 1, AIRBASE_PAD_HEIGHT, 0.2, 'team');
    for (const slot of AIRBASE_SLOT_OFFSETS) {
        s.box(slot.x, slot.y, 18, 16, AIRBASE_PAD_HEIGHT, 0.15, 'teamDark');
        s.box(slot.x, slot.y, 16, 14, AIRBASE_PAD_HEIGHT, 0.2, C.tarmacLight);
        s.box(slot.x, slot.y, 1, 10, AIRBASE_PAD_HEIGHT + 0.15, 0.1, C.hazard);
    }
    for (let x = -42; x <= 20; x += 10) s.box(x, 26, 6, 1, AIRBASE_PAD_HEIGHT, 0.15, C.white);
    // Control tower
    s.box(39, 27, 14, 14, AIRBASE_PAD_HEIGHT, 26, C.concrete);
    s.box(39, 27, 14.6, 14.6, AIRBASE_PAD_HEIGHT + 20, 2, 'team');
    s.taper(39, 27, 15, 15, 17, 17, AIRBASE_PAD_HEIGHT + 26, 5, C.glass);
    s.box(39, 27, 18, 18, AIRBASE_PAD_HEIGHT + 31, 1.4, 'teamDark');
    const radar = new Shape();
    radar.rod(0, 0, 0, 0.5, 3, C.steel, { pitch: Math.PI / 2, segments: 5 });
    radar.box(0, 0, 1.4, 10, 2.5, 3, C.steel);
    return {
        parts: [
            part(s),
            part(radar, 'spin', 'lit', [39, AIRBASE_PAD_HEIGHT + 32.4, 27], 0.06),
        ]
    };
}

function serviceDepot(w: number, h: number): ModelDef {
    const s = new Shape();
    s.box(0, 0, w - 2, 42, 0, 3, C.concreteDark);
    s.box(0, 0, 42, h - 2, 0, 3, C.concreteDark);
    s.box(0, -(h / 2 - 4), 42, 3, 3, 0.2, C.hazard);
    s.box(0, h / 2 - 4, 42, 3, 3, 0.2, C.hazard);
    s.box(-(w / 2 - 4), 0, 3, 42, 3, 0.2, C.hazard);
    s.box(w / 2 - 4, 0, 3, 42, 3, 0.2, C.hazard);
    s.box(0, 0, w - 12, 5, 3, 0.15, 'teamDark');
    s.box(0, 0, 5, h - 12, 3, 0.15, 'teamDark');
    s.box(0, 0, 36, 36, 3, 0.18, 'team');
    s.box(0, 0, 34, 34, 3, 0.25, C.gunmetal);
    for (const [x, z] of [[-24, -24], [24, -24], [-24, 24], [24, 24]]) {
        const yaw = Math.atan2(-z, -x);
        s.cyl(x, z, 3.5, 4.5, 3, 6, C.steel, 8);
        s.rod(x, 8, z, 1.3, 13, C.hazard, { pitch: 0.75, yaw, segments: 6 });
        const ex = x + Math.cos(yaw) * 13 * Math.cos(0.75), ez = z + Math.sin(yaw) * 13 * Math.cos(0.75);
        s.rod(ex, 8 + 13 * Math.sin(0.75), ez, 1, 9, C.hazard, { pitch: -0.6, yaw, segments: 6 });
    }
    const glow = new Shape();
    glow.cyl(0, 0, 9, 9, 3.2, 0.2, C.energyGreen, 16);
    const wrench = new Shape();
    wrench.box(0, 0, 1.6, 1.6, 0, 8, C.energyGreen);
    wrench.box(0, 0, 6, 1.6, 8, 1.6, C.energyGreen);
    wrench.box(-2.2, 0, 1.6, 1.6, 9.6, 2.6, C.energyGreen);
    wrench.box(2.2, 0, 1.6, 1.6, 9.6, 2.6, C.energyGreen);
    return {
        parts: [
            part(s),
            part(glow, 'body', 'glow'),
            part(wrench, 'spin', 'glow', [0, 10, 0], 0.04),
        ]
    };
}

function gunTurret(): ModelDef {
    const s = new Shape();
    s.cyl(0, 0, 14, 17, 0, 8, C.concrete, 8);
    s.cyl(0, 0, 14.3, 14.3, 5.5, 1.6, C.hazard, 8);
    const t = new Shape();
    t.dome(0, 0, 0, 8.5, 'team', 0.8, 10);
    t.box(7, 0, 3, 4.5, 2, 4, C.gunmetal);
    t.rod(8, 4, 0, 1.3, 10.5, C.gunmetal, { segments: 8 });
    t.rod(18, 4, 0, 1.7, 2, C.gunmetal, { segments: 8 });
    return { parts: [part(s), part(t, 'turret', 'lit', [0, 8, 0])] };
}

function samSite(): ModelDef {
    const s = new Shape();
    s.box(0, 0, 36, 8, 0, 3, C.concreteDark, Math.PI / 4);
    s.box(0, 0, 36, 8, 0, 3, C.concreteDark, -Math.PI / 4);
    s.cyl(0, 0, 7, 8, 0, 3.2, C.concrete, 10);
    const t = new Shape();
    t.cyl(0, 0, 4.5, 5.5, 0, 3, C.steel, 8);
    for (const z of [-2.4, 2.4]) {
        for (const y of [4, 6.8]) {
            t.rod(-5, y, z, 1.3, 11, 'teamDark', { pitch: 0.5, segments: 6 });
            t.rod(-5 + 11 * Math.cos(0.5), y + 11 * Math.sin(0.5), z, 1.1, 1.2, C.red, { pitch: 0.5, segments: 6 });
        }
    }
    return { parts: [part(s), part(t, 'turret', 'lit', [0, 3.2, 0])] };
}

function pillbox(): ModelDef {
    const s = new Shape();
    s.cyl(0, 0, 16.5, 18, 0, 4, C.sand, 16);
    s.dome(0, 0, 3, 13, C.concrete, 0.75, 14);
    s.cyl(0, 0, 13.3, 13.3, 3, 2, 'team', 14);
    s.cyl(0, 0, 3, 3.4, 12, 1, C.gunmetal, 8);
    const t = new Shape();
    t.box(11.4, 0, 2, 7, -1.2, 2.4, C.black);
    t.rod(9, 0, 0, 0.9, 7, C.gunmetal, { segments: 6 });
    return { parts: [part(s), part(t, 'turret', 'lit', [0, 7, 0])] };
}

function obelisk(): ModelDef {
    // Built toward the south of its footprint so the tall needle's on-screen lift stays over the
    // footprint (and therefore under the cursor when you click it)
    const z = 12;
    const s = new Shape();
    s.taper(0, z, 30, 34, 20, 24, 0, 9, C.obsidian);
    s.taper(0, z - 2, 11, 11, 3.5, 3.5, 9, 41, C.obsidian);
    s.box(0, z - 2, 11.4, 11.4, 13, 2, 'team');
    s.box(0, z - 2, 8.4, 8.4, 30, 1.2, 'team');
    const glow = new Shape();
    glow.gem(0, 53, z - 2, 3.6, C.energyRed, [1, 1.7, 1]);
    for (const side of [-1, 1]) {
        glow.box(side * 13.2, z, 0.4, 14, 3, 2, C.energyRed);
        glow.box(0, z + side * 15.2, 14, 0.4, 3, 2, C.energyRed);
    }
    return { parts: [part(s), part(glow, 'body', 'glow')] };
}

function inductionRigDeployed(): ModelDef {
    const s = new Shape();
    for (const [x, z] of [[-18, -18], [18, -18], [-18, 18], [18, 18]]) {
        s.box(x, z, 9, 9, 0, 2, C.concreteDark);
        const dx = -x * 0.75, dz = -z * 0.75;
        const horizontal = Math.hypot(dx, dz);
        const length = Math.hypot(horizontal, 36);
        s.rod(x * 0.9, 2, z * 0.9, 1.1, length, C.hazard, { pitch: Math.atan2(36, horizontal), yaw: Math.atan2(dz, dx), segments: 6 });
    }
    for (const [y, half] of [[12, 12], [24, 8]]) {
        s.box(0, -half, half * 2, 1, y, 1, C.hazard);
        s.box(0, half, half * 2, 1, y, 1, C.hazard);
        s.box(-half, 0, 1, half * 2, y, 1, C.hazard);
        s.box(half, 0, 1, half * 2, y, 1, C.hazard);
    }
    s.cyl(0, 0, 2.6, 2.6, 0, 36, C.steel, 8);
    s.cyl(0, 0, 7, 7, 37, 2.4, 'team', 12);
    const glow = new Shape();
    glow.cyl(0, 0, 5, 5, 39.4, 1.4, C.energyBlue, 12);
    glow.cyl(0, 0, 8, 8, 0, 0.5, C.energyBlue, 16);
    return { parts: [part(s), part(glow, 'body', 'glow')] };
}

// ---------------------------------------------------------------------------------------------
// Neutral world objects (authored at unit radius; instances scale them by entity radius)
// ---------------------------------------------------------------------------------------------

function ore(): ModelDef {
    const s = new Shape();
    s.gem(0, 3.4, 0, 5, C.gold, [1, 1.35, 1]);
    s.gem(-5, 2, -3, 3.2, C.goldDark, [1, 1.2, 1], 0.6);
    s.gem(5, 2, 2.5, 3.5, C.gold, [1, 1.1, 1], 1.1);
    s.gem(2, 1.6, -5.5, 2.6, C.goldLight, [1, 1.3, 1], 2);
    s.gem(-3, 1.4, 5, 2.4, C.goldDark, [1, 1.2, 1], 2.6);
    const glow = new Shape();
    glow.gem(0.6, 8.6, 0.4, 1.1, 0xfff4b8, [1, 1.6, 1]);
    return { parts: [part(s), part(glow, 'body', 'glow')] };
}

function rock(variant: number): ModelDef {
    const s = new Shape();
    const yaw = variant * 1.7;
    s.gem(0, 0.42, 0, 0.82, C.rock, [1.1 - variant * 0.08, 0.72 + variant * 0.06, 0.95], yaw);
    s.gem(Math.cos(yaw) * 0.6, 0.22, Math.sin(yaw) * 0.55, 0.42, C.rockDark, [1, 0.8, 1], yaw + 1);
    s.gem(-Math.sin(yaw) * 0.55, 0.18, Math.cos(yaw) * 0.5, 0.36, C.rock, [1.1, 0.7, 1], yaw + 2);
    return { parts: [part(s)] };
}

function well(active: boolean): ModelDef {
    const s = new Shape();
    for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        s.gem(Math.cos(a) * 0.98, 0.1, Math.sin(a) * 0.98, 0.2 + (i % 3) * 0.04, C.rockDark, [1.2, 0.8, 1], a);
    }
    s.cyl(0, 0, 0.88, 0.95, 0, 0.1, active ? C.goldDark : 0x505050, 18);
    const pool = new Shape();
    pool.cyl(0, 0, 0.74, 0.74, 0.1, 0.05, active ? C.gold : 0x8a8a8a, 18);
    pool.cyl(0, 0, 0.32, 0.32, 0.15, 0.03, active ? 0xfff0a0 : 0xa8a8a8, 12);
    return { parts: [part(s), part(pool, 'body', active ? 'glow' : 'lit')] };
}

// ---------------------------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------------------------

const BUILDERS: Record<string, () => ModelDef> = {
    // Infantry
    rifle: () => infantry({ helmet: 'teamDark', gear: rifle }),
    rocket: () => infantry({
        helmet: 'teamDark',
        gear: s => {
            s.rod(-3.5, 11.6, 2.9, 1.2, 10, C.olive, { segments: 8 });
            s.rod(6.5, 11.6, 2.9, 1.2, 2.2, C.red, { segments: 8, endRadius: 0.2 });
        }
    }),
    engineer: () => infantry({
        helmet: C.hazard,
        gear: s => {
            s.box(-3.2, 0, 2.2, 5, 6.6, 4.6, C.hazard);
            s.box(2.6, 2.8, 2, 1, 7.6, 0.8, C.steel);
        }
    }),
    medic: () => infantry({
        helmet: C.white,
        gear: s => {
            s.box(-3.2, 0, 2.2, 5, 6.6, 4.6, C.white);
            s.box(-4.35, 0, 0.1, 3, 8.4, 1, C.red);
            s.box(-4.35, 0, 0.1, 1, 7.4, 3, C.red);
        }
    }),
    sniper: () => infantry({
        helmet: C.olive,
        gear: s => {
            s.rod(-2, 8.8, 0.8, 0.45, 14, C.gunmetal, { segments: 6 });
            s.rod(1.5, 9.8, 0.8, 0.5, 3.5, C.black, { segments: 6 });
        }
    }),
    flamer: () => infantry({
        helmet: 'teamDark',
        gear: s => {
            s.cyl(-3.2, -1.3, 1.2, 1.2, 6, 6.5, C.red, 8);
            s.cyl(-3.2, 1.3, 1.2, 1.2, 6, 6.5, C.red, 8);
            s.rod(-0.5, 8.6, 0.8, 0.75, 7.5, C.gunmetal, { segments: 6, endRadius: 0.95 });
        }
    }),
    grenadier: () => infantry({
        helmet: 'teamDark',
        gear: s => {
            s.rod(-0.5, 8.6, 0.8, 1, 6.5, C.olive, { segments: 8 });
            s.box(0, 0, 4.4, 6.6, 9.2, 0.9, C.olive);
        }
    }),
    commando: () => infantry({
        helmet: C.red,
        legs: C.gunmetal,
        gear: s => {
            s.box(-3.2, 0, 2, 4.6, 6.6, 4.2, C.gunmetal);
            s.rod(-1, 8.8, 0.8, 0.7, 10, C.gunmetal, { segments: 6 });
        }
    }),
    hijacker: () => infantry({
        torso: 'teamDark',
        head: C.black,
        legs: C.black,
        gear: s => s.rod(1.5, 8.8, 2.8, 0.45, 3, C.gunmetal, { segments: 5 }),
    }),

    // Vehicles
    light: () => lightTank(RULES.units.light?.w ?? 28),
    heavy: () => heavyTank(RULES.units.heavy?.w ?? 34),
    mammoth: () => mammothTank(RULES.units.mammoth?.w ?? 40),
    flame_tank: () => flameTank(RULES.units.flame_tank?.w ?? 30),
    stealth: () => stealthTank(RULES.units.stealth?.w ?? 28),
    artillery: () => artillery(RULES.units.artillery?.w ?? 30),
    mlrs: () => mlrs(RULES.units.mlrs?.w ?? 30),
    jeep: () => jeep(RULES.units.jeep?.w ?? 22),
    apc: () => apc(RULES.units.apc?.w ?? 25),
    harvester: () => harvester(RULES.units.harvester?.w ?? 35),
    mcv: () => mcv(RULES.units.mcv?.w ?? 45),
    induction_rig: () => inductionRig(RULES.units.induction_rig?.w ?? 40),
    demo_truck: () => demoTruck(RULES.units.demo_truck?.w ?? 30),
    heli: () => heli(RULES.units.heli?.w ?? 20),
    harrier: () => harrier(RULES.units.harrier?.w ?? 25),

    // Buildings
    conyard: () => conyard(RULES.buildings.conyard?.w ?? 90, RULES.buildings.conyard?.h ?? 90),
    power: () => powerPlant(RULES.buildings.power?.w ?? 60, RULES.buildings.power?.h ?? 60),
    refinery: () => refinery(RULES.buildings.refinery?.w ?? 100, RULES.buildings.refinery?.h ?? 80),
    barracks: () => barracks(RULES.buildings.barracks?.w ?? 60, RULES.buildings.barracks?.h ?? 80),
    factory: () => factory(RULES.buildings.factory?.w ?? 100, RULES.buildings.factory?.h ?? 100),
    tech: () => techCenter(RULES.buildings.tech?.w ?? 80, RULES.buildings.tech?.h ?? 80),
    airforce_command: () => airforceCommand(RULES.buildings.airforce_command?.w ?? 100, RULES.buildings.airforce_command?.h ?? 80),
    service_depot: () => serviceDepot(RULES.buildings.service_depot?.w ?? 120, RULES.buildings.service_depot?.h ?? 120),
    turret: gunTurret,
    sam_site: samSite,
    pillbox,
    obelisk,
    induction_rig_deployed: inductionRigDeployed,

    // Neutral
    ore,
    rock_0: () => rock(0),
    rock_1: () => rock(1),
    rock_2: () => rock(2),
    well_active: () => well(true),
    well_blocked: () => well(false),
};

export const ROCK_VARIANTS = 3;

/** Fallback for keys without a hand-made model: a team-coloured block sized to the footprint. */
function genericModel(key: string): ModelDef {
    const s = new Shape();
    const unit = RULES.units[key];
    const building = RULES.buildings[key];
    if (building) {
        slab(s, building.w, building.h);
        s.box(0, 0, building.w * 0.7, building.h * 0.7, 2, 18, C.concrete);
        s.box(0, 0, building.w * 0.72, building.h * 0.72, 14, 2.5, 'team');
    } else if (unit?.type === 'infantry') {
        return infantry({ helmet: 'teamDark', gear: rifle });
    } else {
        const w = unit?.w ?? 20;
        tracks(s, w * 0.95, w * 0.8, w * 0.2, w * 0.2);
        s.box(0, 0, w * 0.8, w * 0.5, w * 0.1, w * 0.25, 'team');
    }
    return { parts: [part(s)] };
}

const MODEL_CACHE = new Map<string, ModelDef>();

/** True when `key` has a hand-made model rather than the generic placeholder block. */
export function hasCustomModel(key: string): boolean {
    return key in BUILDERS;
}

export function getModelDef(key: string): ModelDef {
    let def = MODEL_CACHE.get(key);
    if (!def) {
        const builder = BUILDERS[key];
        def = builder ? builder() : genericModel(key);
        MODEL_CACHE.set(key, def);
    }
    return def;
}

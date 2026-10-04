import * as THREE from 'three';
import { type Entity, type GameState, PLAYER_COLORS, type Projectile, TILE_SIZE, type VisualEvent } from '../../engine/types.js';
import { RULES } from '../../data/schemas/index.js';
import { isAirUnit } from '../../engine/entity-helpers.js';
import { isBuilding, isUnit } from '../../engine/type-guards.js';
import { getModelDef, type ModelDef, type ModelPart, ROCK_VARIANTS } from './models.js';
import { AdaptiveResolution } from './resolution.js';
import { TEAM_MIX_ATTRIBUTE } from './shape.js';
import { AIR_ALTITUDE, AIRBASE_PAD_HEIGHT, AIRBASE_SLOT_OFFSETS, getAltitude, getModelHeight } from './projection.js';
import { applyViewCamera, CAMERA_DISTANCE } from './camera.js';
import {
    BeamLayer, DebrisLayer, makeGlowTexture, makePuffTexture, makeRingTexture, makeScorchTexture, ParticleLayer
} from './effects.js';

export interface PlacementGhost {
    readonly key: string;
    readonly x: number;
    readonly y: number;
    readonly valid: boolean;
}

export interface Scene3DFrame {
    readonly state: GameState;
    /** Entities that survived screen + fog culling. */
    readonly entities: readonly Entity[];
    readonly camera: { readonly x: number; readonly y: number };
    readonly zoom: number;
    readonly width: number;
    readonly height: number;
    readonly fogGrid: Uint8Array | undefined;
    readonly localPlayerId: number | null;
    readonly placement: PlacementGhost | null;
}

const NEUTRAL_COLOR = '#d4af37';
const SUN_DIRECTION = new THREE.Vector3(-0.55, 0.85, -0.4).normalize();
const SHADOW_MAP_SIZE = 2048;
/** Tallest thing that can cast a shadow into view, for fitting the shadow camera. */
const MAX_CASTER_HEIGHT = 70;
const FLASH_TINT = 3.2;

/** Buildings' turret angles carry a +90° offset because their 2D sprites point up. */
const BUILDING_TURRET_OFFSET = Math.PI / 2;

/** Effects never advance more than this many ticks in one frame (fast-forward, tab switches). */
const MAX_FRAME_TICKS = 40;
/** Per-entity animation state is dropped after this many frames unseen. */
const VISUAL_STATE_TTL_FRAMES = 300;
/** Destroyed vehicles leave a burnt-out hull for this many ticks; buildings leave rubble for longer. */
const WRECK_TICKS = 900;
const RUBBLE_TICKS = 2400;
const WRECK_SINK_TICKS = 120;
const SCORCH_TICKS = 4000;
/** Smoke drifts with a light, constant breeze. */
const WIND_X = 0.07, WIND_Z = -0.03;

const WRECK_TINT = [0.2, 0.18, 0.16] as const;
const NO_SLOTS_EMPTY = 0xffffffff;

/** How a model is animated this frame (see pushModel). */
interface PartAnim {
    /** 0..1 recoil kick of the parts that have `recoil`. */
    recoil: number;
    /** Bit per ammo slot: set = loaded. */
    loaded: number;
    tick: number;
    /** Burnt-out wrecks lose their lights and glowing parts. */
    wreck: boolean;
}

const STILL: PartAnim = { recoil: 0, loaded: NO_SLOTS_EMPTY, tick: 0, wreck: false };

/** Animation state the renderer keeps per unit/building between frames. */
interface EntityVisual {
    frame: number;
    x: number;
    y: number;
    /** Smoothed ground speed (world units per tick). */
    speed: number;
    /** Heading the model is drawn with (sim angle convention: 0 = +x, +y is south). */
    heading: number;
    pitch: number;
    pitchVel: number;
    roll: number;
    rollVel: number;
    /** Infantry stride phase. */
    walk: number;
    fireTick: number;
    shots: number;
    /** Tick each ammo slot is reloaded at. */
    reloadAt: number[];
    yaw: number;
    aimYaw: number;
}

interface Wreck {
    key: string;
    owner: number;
    x: number;
    z: number;
    altitude: number;
    fallSpeed: number;
    yaw: number;
    aimYaw: number;
    spin: number;
    pitch: number;
    roll: number;
    start: number;
    life: number;
    building: boolean;
    height: number;
    radius: number;
}

interface DelayedBlast {
    at: number;
    x: number;
    y: number;
    z: number;
    size: number;
}

/** What the last drawn frame showed, to skip drawing identical frames (see Scene3D.diffFrame). */
interface DrawnFrame {
    tick: number;
    entities: unknown;
    projectiles: unknown;
    events: unknown;
    config: unknown;
    fog: unknown;
    fogGrid: unknown;
    x: number;
    y: number;
    zoom: number;
    width: number;
    height: number;
    pixelRatio: number;
    player: number | null;
    ghost: boolean;
    ghostKey: string;
    ghostX: number;
    ghostY: number;
    ghostValid: boolean;
}

interface ViewBounds {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

/** The simulation moved on (tick, entities, projectiles, events). */
const CHANGED_SIM = 1;
/** The camera, zoom or view size changed. */
const CHANGED_VIEW = 2;
/** Fog of war, placement ghost, pixel ratio or local player changed. */
const CHANGED_OTHER = 4;

/** Where a projectile visually left its launcher (cached on first sight). */
interface ShotVisual {
    /** Identifies the shot (with its shooter): where it was fired from and at what. */
    startX: number;
    startY: number;
    targetId: string;
    frame: number;
    /** Muzzle position minus the sim start position (fades out along the flight). */
    dx: number;
    dz: number;
    startHeight: number | null;
    loft: number;
    lastX: number;
    lastY: number;
    lastZ: number;
}

// ---------------------------------------------------------------------------------------------
// Instanced batching
// ---------------------------------------------------------------------------------------------

/** Per-instance team colour of owner-independent model geometry (see Shape.realizeTeamless). */
const TEAM_ATTRIBUTE = 'instanceTeam';

/** Replaces three's color_vertex chunk: the vertex colour gets the instance's team colour mixed in. */
const TEAM_COLOR_VERTEX = /* glsl */ `
vColor = vec4( 1.0 );
vColor.rgb *= color + ${TEAM_MIX_ATTRIBUTE} * ${TEAM_ATTRIBUTE};
#ifdef USE_INSTANCING_COLOR
vColor.rgb *= instanceColor.rgb;
#endif
`;

/**
 * Turns a vertex-coloured material into one for owner-independent model geometry: vertex colour =
 * `color + teamMix * instanceTeam`, then the usual instance colour (flash / wreck tint) on top. With the
 * team colour per instance, one InstancedMesh per (model, part) serves every player.
 */
function withTeamColor<T extends THREE.Material>(material: T): T {
    material.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader
            .replace('#include <color_pars_vertex>',
                `#include <color_pars_vertex>\nattribute float ${TEAM_MIX_ATTRIBUTE};\nattribute vec3 ${TEAM_ATTRIBUTE};`)
            .replace('#include <color_vertex>', TEAM_COLOR_VERTEX);
    };
    material.customProgramCacheKey = () => 'team-color';
    return material;
}

/**
 * One InstancedMesh per (model, part) — or per projectile kind. Instances are rewritten from scratch
 * every frame, mirroring the immediate-mode 2D renderer: no per-entity scene graph to keep in sync.
 *
 * Only what actually changed is uploaded: the CPU-side arrays always mirror the GPU buffers, so each
 * push compares against the value already there and the dirty instances' range is all that is sent.
 * Parked aircraft, idle buildings, ore and rocks cost no upload at all while the camera holds still.
 */
export class InstanceBucket {
    mesh: THREE.InstancedMesh;
    private count = 0;
    private capacity: number;
    private dirtyMin = Infinity;
    private dirtyMax = -1;
    private team: THREE.InstancedBufferAttribute | null = null;

    constructor(
        private readonly scene: THREE.Scene,
        private readonly geometry: THREE.BufferGeometry,
        private readonly material: THREE.Material,
        private readonly castShadow: boolean,
        private readonly teamColored = false,
        capacity = 16
    ) {
        this.capacity = capacity;
        this.mesh = this.createMesh(capacity);
    }

    private createMesh(capacity: number): THREE.InstancedMesh {
        const mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = this.castShadow;
        mesh.receiveShadow = true;
        mesh.frustumCulled = false; // culled on the CPU before instances are written
        mesh.count = 0;
        this.scene.add(mesh);
        if (this.teamColored) {
            const team = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
            if (this.team) {
                team.array.set(this.team.array);
                // Release the old attribute's GPU buffer before swapping it out
                this.geometry.dispose();
            }
            this.team = team;
            this.geometry.setAttribute(TEAM_ATTRIBUTE, team);
        }
        return mesh;
    }

    reset(): void {
        this.count = 0;
    }

    push(matrix: THREE.Matrix4, r = 1, g = 1, b = 1, team?: THREE.Color): void {
        if (this.count >= this.capacity) this.grow();
        const i = this.count++;
        let dirty = false;

        const elements = matrix.elements;
        const matrices = this.mesh.instanceMatrix.array as Float32Array;
        const o = i * 16;
        for (let k = 0; k < 16; k++) {
            const v = Math.fround(elements[k]);
            if (matrices[o + k] !== v) {
                matrices[o + k] = v;
                dirty = true;
            }
        }
        if (writeRgb(this.mesh.instanceColor!.array as Float32Array, i * 3, r, g, b)) dirty = true;
        if (this.team && team && writeRgb(this.team.array as Float32Array, i * 3, team.r, team.g, team.b)) dirty = true;

        if (dirty) {
            if (i < this.dirtyMin) this.dirtyMin = i;
            if (i > this.dirtyMax) this.dirtyMax = i;
        }
    }

    finish(): void {
        this.mesh.count = this.count;
        this.mesh.visible = this.count > 0;
        if (this.dirtyMax < 0) return;
        const start = this.dirtyMin, n = this.dirtyMax - this.dirtyMin + 1;
        // Ranges are cleared by three once uploaded; pending ones (not drawn yet) merge with these
        markRange(this.mesh.instanceMatrix, start, n);
        markRange(this.mesh.instanceColor!, start, n);
        if (this.team) markRange(this.team, start, n);
        this.dirtyMin = Infinity;
        this.dirtyMax = -1;
    }

    private grow(): void {
        const old = this.mesh;
        this.capacity *= 2;
        this.mesh = this.createMesh(this.capacity);
        // A fresh attribute is uploaded in full on first use, so the copy needs no dirty range
        (this.mesh.instanceMatrix.array as Float32Array).set(old.instanceMatrix.array);
        (this.mesh.instanceColor!.array as Float32Array).set(old.instanceColor!.array as Float32Array);
        this.scene.remove(old);
        old.dispose();
    }

    dispose(): void {
        this.scene.remove(this.mesh);
        this.mesh.dispose();
    }
}

/** Writes an RGB triple (as float32), reporting whether it differed from what was there. */
function writeRgb(array: Float32Array, o: number, r: number, g: number, b: number): boolean {
    const fr = Math.fround(r), fg = Math.fround(g), fb = Math.fround(b);
    if (array[o] === fr && array[o + 1] === fg && array[o + 2] === fb) return false;
    array[o] = fr;
    array[o + 1] = fg;
    array[o + 2] = fb;
    return true;
}

function markRange(attribute: THREE.BufferAttribute, start: number, count: number): void {
    attribute.addUpdateRange(start * attribute.itemSize, count * attribute.itemSize);
    attribute.needsUpdate = true;
}

interface ModelBuckets {
    readonly def: ModelDef;
    readonly buckets: InstanceBucket[];
}

// ---------------------------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------------------------

export class Scene3D {
    readonly canvas: HTMLCanvasElement;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, CAMERA_DISTANCE * 2);
    private readonly sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
    private readonly hemi = new THREE.HemisphereLight(0xd6e4ff, 0x3f4a30, 0.85);

    private readonly litMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 });
    private readonly glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    /** The same two materials for owner-independent model geometry, team colour per instance. */
    private readonly teamLitMaterial = withTeamColor(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 }));
    private readonly teamGlowMaterial = withTeamColor(new THREE.MeshBasicMaterial({ vertexColors: true }));

    /** model key -> buckets per part (shared by every owner) */
    private readonly models = new Map<string, ModelBuckets>();
    /** Team colour per owner slot (owner + 1; slot 0 is neutral). */
    private readonly teamColors: THREE.Color[] = [];
    private readonly allBuckets: InstanceBucket[] = [];
    private readonly geometries: THREE.BufferGeometry[] = [];

    private ground: THREE.Mesh | null = null;
    private groundSize = { w: 0, h: 0 };
    private groundTexture: THREE.Texture | null = null;

    private fogMesh: THREE.Mesh | null = null;
    private fogTexture: THREE.DataTexture | null = null;
    private fogSourceGrid: Uint8Array | null = null;
    private fogSourceRecord: unknown = null;

    private readonly projectileBuckets = new Map<string, InstanceBucket>();
    private readonly trails: THREE.LineSegments;
    private trailPositions = new Float32Array(0);
    private trailColors = new Float32Array(0);

    // Effects
    private readonly fire: ParticleLayer;
    private readonly smoke: ParticleLayer;
    private readonly scorches: ParticleLayer;
    private readonly groundGlow: ParticleLayer;
    private readonly shockwaves: ParticleLayer;
    private readonly debris: DebrisLayer;
    private readonly beams: BeamLayer;
    private readonly effectTextures: THREE.Texture[];
    private readonly particleLayers: readonly ParticleLayer[];
    /**
     * Soft particle budget: ambient emitters (damage smoke and fire, burning wrecks, chimneys, exhaust)
     * thin out as their layer fills up, leaving room for explosions and muzzle effects, which always
     * spawn at full rate. Refreshed every frame.
     */
    private smokeBudget = 1;
    private fireBudget = 1;
    private readonly visuals = new Map<string, EntityVisual>();
    /** In-flight shots by shooter id (a shooter rarely has more than a handful in the air). */
    private readonly shots = new Map<string, ShotVisual[]>();
    private wrecks: Wreck[] = [];
    private delayed: DelayedBlast[] = [];
    private frameNo = 0;
    private lastTick = -1;
    private lastEventTick = -1;

    // Visibility test inputs, refreshed every frame (see isVisible)
    private readonly visibleView: ViewBounds = { left: 0, right: 0, top: 0, bottom: 0 };
    private readonly projectileView: ViewBounds = { left: 0, right: 0, top: 0, bottom: 0 };
    private visibleFog: Uint8Array | undefined = undefined;
    private visibleGridW = 0;
    private visibleGridH = 0;
    /** In (or near) the view and not hidden by the local player's fog of war. */
    private readonly visibility = (x: number, z: number): boolean => {
        const view = this.visibleView;
        if (x < view.left || x > view.right || z < view.top || z > view.bottom) return false;
        const fogGrid = this.visibleFog;
        if (!fogGrid) return true;
        const tx = Math.floor(x / TILE_SIZE), tz = Math.floor(z / TILE_SIZE);
        if (tx < 0 || tz < 0 || tx >= this.visibleGridW || tz >= this.visibleGridH) return true;
        return fogGrid[tz * this.visibleGridW + tx] !== 0;
    };

    // Frame skipping and adaptive resolution
    private readonly resolution = new AdaptiveResolution();
    private readonly drawn: DrawnFrame = {
        tick: NaN, entities: null, projectiles: null, events: null, config: null, fog: null, fogGrid: null,
        x: NaN, y: NaN, zoom: NaN, width: -1, height: -1, pixelRatio: -1, player: null,
        ghost: false, ghostKey: '', ghostX: NaN, ghostY: NaN, ghostValid: false,
    };
    /** Set when the canvas was resized (which clears it): the next frame must be drawn. */
    private forceDraw = true;
    /** performance.now() of the last render() call and of the last frame actually drawn. */
    private lastCallAt = -Infinity;
    private lastDrawAt = -Infinity;
    /** Whether the previous render() call drew (frame-time samples need two drawn frames in a row). */
    private drewLastCall = false;
    /** Muzzle of each shooter's latest shot, picked up by its projectile when first drawn. */
    private readonly pendingMuzzles = new Map<string, { x: number; y: number; z: number; tick: number }>();
    private readonly pivotCache = new WeakMap<ModelDef, readonly [number, number, number] | null>();
    private readonly anim: PartAnim = { ...STILL };

    private readonly ghost: THREE.Mesh;
    private readonly ghostMaterial = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.6, depthWrite: false });
    private ghostKey = '';

    private readonly colorCache = new Map<string, THREE.Color>();
    private readonly hashCache = new Map<string, number>();

    // Scratch objects
    private readonly mBody = new THREE.Matrix4();
    private readonly mLocal = new THREE.Matrix4();
    private readonly mOut = new THREE.Matrix4();
    private readonly mScratch = new THREE.Matrix4();
    private readonly vMuzzle = new THREE.Vector3();
    private readonly vTarget = new THREE.Vector3();
    private readonly vDir = new THREE.Vector3();
    private readonly vTmp = new THREE.Vector3();
    private readonly vPos = new THREE.Vector3();
    private readonly vScale = new THREE.Vector3();
    private readonly qRot = new THREE.Quaternion();
    private readonly yAxis = new THREE.Vector3(0, 1, 0);
    private readonly euler = new THREE.Euler(0, 0, 0, 'YZX');

    constructor(container: HTMLElement, before: Element) {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'gameCanvas3d';
        container.insertBefore(this.canvas, before);

        // At 1.5x+ the extra pixels already smooth the edges: MSAA would multiply the fill cost for little gain
        const pixelRatio = scenePixelRatio();
        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: pixelRatio < 1.5, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(this.resolution.pixelRatio(pixelRatio));
        this.renderer.setClearColor(0x14180f);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        // Redrawn only when casters or the view move (see render)
        this.renderer.shadowMap.autoUpdate = false;

        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
        this.sun.shadow.bias = -0.0006;
        this.sun.shadow.normalBias = 0.6;
        this.sun.shadow.camera.near = 1;
        this.sun.shadow.camera.far = 4000;
        this.scene.add(this.sun, this.sun.target, this.hemi);

        // Projectile trails: one dynamic line-segment batch
        const trailGeometry = new THREE.BufferGeometry();
        this.trails = new THREE.LineSegments(
            trailGeometry,
            new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })
        );
        this.trails.frustumCulled = false;
        this.scene.add(this.trails);

        // Effects: ground decals sit under the fog plane, smoke and fire above everything
        const glow = makeGlowTexture(), puff = makePuffTexture(), ring = makeRingTexture(), scorch = makeScorchTexture();
        this.effectTextures = [glow, puff, ring, scorch];
        this.scorches = new ParticleLayer(this.scene, scorch, { additive: false, flat: true, capacity: 500, renderOrder: 0 });
        this.groundGlow = new ParticleLayer(this.scene, glow, { additive: true, flat: true, capacity: 300, renderOrder: 0 });
        this.shockwaves = new ParticleLayer(this.scene, ring, { additive: true, flat: true, capacity: 100, renderOrder: 0 });
        this.smoke = new ParticleLayer(this.scene, puff, { additive: false, capacity: 5000, renderOrder: 2 });
        this.fire = new ParticleLayer(this.scene, glow, { additive: true, capacity: 4000, renderOrder: 3 });
        this.particleLayers = [this.fire, this.smoke, this.scorches, this.groundGlow, this.shockwaves];
        this.debris = new DebrisLayer(this.scene, this.litMaterial);
        this.beams = new BeamLayer(this.scene);

        // Building placement hologram
        this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMaterial);
        this.ghost.visible = false;
        this.ghost.renderOrder = 4;
        this.scene.add(this.ghost);

        this.createProjectileBuckets();
    }

    setSize(width: number, height: number): void {
        this.applySize(width, height, this.resolution.pixelRatio(scenePixelRatio()));
    }

    private applySize(width: number, height: number, pixelRatio: number): void {
        // Browser zoom or moving the window to another monitor changes the DPR mid-game
        if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
        this.forceDraw = true;
    }

    render(frame: Scene3DFrame): void {
        const { state, zoom, width, height, camera } = frame;
        if (width <= 0 || height <= 0) return;

        const now = performance.now();
        const pixelRatio = this.resolution.pixelRatio(scenePixelRatio());
        if (this.renderer.getPixelRatio() !== pixelRatio ||
            this.canvas.width !== Math.floor(width * pixelRatio) ||
            this.canvas.height !== Math.floor(height * pixelRatio)) {
            this.applySize(width, height, pixelRatio);
        }

        // Nothing to draw when neither the game nor the view moved: effects, wrecks, blinking lights and
        // spinning parts all advance with game ticks, so the previous frame is still exactly right. The
        // canvas keeps showing it. Redraw anyway after a gap in render() calls (the 2D view was shown,
        // the tab was hidden) and once a second as a safety net.
        const changes = this.diffFrame(frame, pixelRatio);
        const stale = now - this.lastCallAt > 100 || now - this.lastDrawAt > 1000;
        this.lastCallAt = now;
        if (changes === 0 && !this.forceDraw && !stale) {
            this.drewLastCall = false;
            return;
        }
        if (this.drewLastCall) this.resolution.sample(now - this.lastDrawAt);
        this.drewLastCall = true;
        this.lastDrawAt = now;
        // The shadow map only depends on the casters and the shadow camera, which follows the view
        this.renderer.shadowMap.needsUpdate = this.forceDraw || stale || (changes & (CHANGED_SIM | CHANGED_VIEW)) !== 0;
        this.forceDraw = false;

        this.ensureGround(state.config.width, state.config.height);
        this.updateFog(frame);
        this.updateCamera(camera, zoom, width, height);

        // Effects run on game ticks, so they freeze with the game and speed up with it
        if (state.tick < this.lastTick || this.lastTick < 0) this.resetEffects(state.tick);
        const dt = Math.min(MAX_FRAME_TICKS, state.tick - this.lastTick);
        this.lastTick = state.tick;
        this.frameNo++;
        this.updateVisibility(frame);
        this.stepEffects(dt);
        this.processEvents(frame);
        this.processDelayedBlasts(state.tick);
        this.smokeBudget = ambientBudget(this.smoke);
        this.fireBudget = ambientBudget(this.fire);

        for (const bucket of this.allBuckets) bucket.reset();
        for (const entity of frame.entities) this.addEntity(entity, state, dt);
        this.addWrecks(state.tick, dt);
        this.addProjectiles(frame, dt);
        for (const bucket of this.allBuckets) bucket.finish();
        this.syncEffects();
        this.pruneVisuals();

        this.updateGhost(frame);

        this.renderer.render(this.scene, this.camera);
    }

    /**
     * What changed since the last drawn frame (CHANGED_* bits; 0 = nothing), recording the new values.
     * The frame's entity list is rebuilt every frame by the caller, but it is derived from the state's
     * entities, the camera, the view size and the fog grid, which are compared instead.
     */
    private diffFrame(frame: Scene3DFrame, pixelRatio: number): number {
        const { state, camera, placement } = frame;
        const d = this.drawn;
        let changes = 0;
        if (d.tick !== state.tick || d.entities !== state.entities || d.projectiles !== state.projectiles ||
            d.events !== state.visualEvents || d.config !== state.config) {
            changes |= CHANGED_SIM;
            d.tick = state.tick;
            d.entities = state.entities;
            d.projectiles = state.projectiles;
            d.events = state.visualEvents;
            d.config = state.config;
        }
        if (d.x !== camera.x || d.y !== camera.y || d.zoom !== frame.zoom || d.width !== frame.width || d.height !== frame.height) {
            changes |= CHANGED_VIEW;
            d.x = camera.x;
            d.y = camera.y;
            d.zoom = frame.zoom;
            d.width = frame.width;
            d.height = frame.height;
        }
        // The fog grid is mutated in place, but the fog record is replaced whenever it changes
        if (d.pixelRatio !== pixelRatio || d.fog !== state.fogOfWar || d.fogGrid !== frame.fogGrid || d.player !== frame.localPlayerId) {
            changes |= CHANGED_OTHER;
            d.pixelRatio = pixelRatio;
            d.fog = state.fogOfWar;
            d.fogGrid = frame.fogGrid;
            d.player = frame.localPlayerId;
        }
        const ghost = placement !== null;
        if (d.ghost !== ghost || (placement && (d.ghostKey !== placement.key || d.ghostX !== placement.x ||
            d.ghostY !== placement.y || d.ghostValid !== placement.valid))) {
            changes |= CHANGED_OTHER;
            d.ghost = ghost;
            d.ghostKey = placement?.key ?? '';
            d.ghostX = placement?.x ?? NaN;
            d.ghostY = placement?.y ?? NaN;
            d.ghostValid = placement?.valid ?? false;
        }
        return changes;
    }

    dispose(): void {
        for (const layer of this.particleLayers) layer.dispose(this.scene);
        this.debris.dispose(this.scene);
        this.beams.dispose(this.scene);
        for (const texture of this.effectTextures) texture.dispose();
        for (const bucket of this.allBuckets) bucket.dispose();
        for (const geometry of this.geometries) geometry.dispose();
        for (const material of [this.litMaterial, this.glowMaterial, this.teamLitMaterial, this.teamGlowMaterial]) material.dispose();
        this.groundTexture?.dispose();
        this.fogTexture?.dispose();
        this.renderer.dispose();
        this.renderer.forceContextLoss();
        this.canvas.remove();
    }

    // -----------------------------------------------------------------------------------------
    // Camera and lighting
    // -----------------------------------------------------------------------------------------

    private updateCamera(camera: { x: number; y: number }, zoom: number, width: number, height: number): void {
        applyViewCamera(this.camera, camera, zoom, width, height);
        const halfW = width / (2 * zoom);
        const halfH = height / (2 * zoom);
        this.fitShadowCamera(camera.x + halfW, camera.y + halfH, halfW, halfH);
    }

    private fitShadowCamera(cx: number, cz: number, halfW: number, halfH: number): void {
        const shadowCamera = this.sun.shadow.camera;
        this.sun.target.position.set(cx, 0, cz);
        this.sun.target.updateMatrixWorld();
        this.sun.position.set(cx, 0, cz).addScaledVector(SUN_DIRECTION, 1500);
        this.sun.updateMatrixWorld();

        shadowCamera.position.copy(this.sun.position);
        shadowCamera.lookAt(this.sun.target.position);
        shadowCamera.updateMatrixWorld();

        // Fit to the visible ground rectangle (plus casters standing just outside it)
        const margin = 80;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        const corner = this.vPos;
        for (let i = 0; i < 8; i++) {
            const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1, y = i & 4 ? MAX_CASTER_HEIGHT : 0;
            corner.set(cx + sx * (halfW + margin), y, cz + sz * (halfH + margin));
            corner.applyMatrix4(shadowCamera.matrixWorldInverse);
            minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
            minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
        }

        // Snap the frustum to whole shadow texels of a grid fixed in the world (anchored at the world
        // origin's light-space position), so shadow edges don't crawl and shimmer as the camera scrolls.
        // One extra texel of size keeps the snapped frustum covering the fitted one.
        const origin = corner.set(0, 0, 0).applyMatrix4(shadowCamera.matrixWorldInverse);
        const texelX = (maxX - minX) / (SHADOW_MAP_SIZE - 1);
        const texelY = (maxY - minY) / (SHADOW_MAP_SIZE - 1);
        shadowCamera.left = origin.x + Math.floor((minX - origin.x) / texelX) * texelX;
        shadowCamera.right = shadowCamera.left + texelX * SHADOW_MAP_SIZE;
        shadowCamera.bottom = origin.y + Math.floor((minY - origin.y) / texelY) * texelY;
        shadowCamera.top = shadowCamera.bottom + texelY * SHADOW_MAP_SIZE;
        shadowCamera.updateProjectionMatrix();
    }

    // -----------------------------------------------------------------------------------------
    // Ground and fog
    // -----------------------------------------------------------------------------------------

    private ensureGround(mapWidth: number, mapHeight: number): void {
        if (this.ground && this.groundSize.w === mapWidth && this.groundSize.h === mapHeight) return;
        if (this.ground) {
            this.scene.remove(this.ground);
            this.ground.geometry.dispose();
        }
        if (!this.groundTexture) this.groundTexture = makeGroundTexture();

        const segX = Math.max(1, Math.round(mapWidth / 80));
        const segZ = Math.max(1, Math.round(mapHeight / 80));
        const geometry = new THREE.PlaneGeometry(mapWidth, mapHeight, segX, segZ);
        geometry.rotateX(-Math.PI / 2);
        geometry.translate(mapWidth / 2, 0, mapHeight / 2);

        // Low-frequency tint so the tiled texture doesn't read as a repeating pattern
        const position = geometry.getAttribute('position');
        const colors = new Float32Array(position.count * 3);
        const tint = new THREE.Color();
        for (let i = 0; i < position.count; i++) {
            const x = position.getX(i), z = position.getZ(i);
            const n = valueNoise(x / 600, z / 600) * 0.6 + valueNoise(x / 190 + 17, z / 190 + 3) * 0.4;
            const dryness = THREE.MathUtils.smoothstep(n, 0.45, 0.85);
            tint.setRGB(0.86 + n * 0.22, 0.88 + n * 0.16 - dryness * 0.06, 0.8 + n * 0.1 - dryness * 0.12);
            colors[i * 3] = tint.r;
            colors[i * 3 + 1] = tint.g;
            colors[i * 3 + 2] = tint.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const texture = this.groundTexture;
        texture.repeat.set(mapWidth / 480, mapHeight / 480);
        const material = new THREE.MeshLambertMaterial({ map: texture, vertexColors: true });
        this.ground = new THREE.Mesh(geometry, material);
        this.ground.receiveShadow = true;
        this.ground.renderOrder = -1;
        this.scene.add(this.ground);
        this.groundSize = { w: mapWidth, h: mapHeight };

        // A fresh map invalidates the fog plane too
        if (this.fogMesh) {
            this.scene.remove(this.fogMesh);
            this.fogMesh.geometry.dispose();
            this.fogMesh = null;
        }
        this.fogTexture?.dispose();
        this.fogTexture = null;
        this.fogSourceGrid = null;
    }

    private updateFog(frame: Scene3DFrame): void {
        const grid = frame.fogGrid;
        if (!grid) {
            if (this.fogMesh) this.fogMesh.visible = false;
            return;
        }
        const { width: mapWidth, height: mapHeight } = frame.state.config;
        const gridW = Math.ceil(mapWidth / TILE_SIZE);
        const gridH = Math.ceil(mapHeight / TILE_SIZE);

        if (!this.fogTexture || this.fogTexture.image.width !== gridW || this.fogTexture.image.height !== gridH) {
            this.fogTexture?.dispose();
            this.fogTexture = new THREE.DataTexture(new Uint8Array(gridW * gridH * 4), gridW, gridH, THREE.RGBAFormat);
            this.fogTexture.magFilter = THREE.LinearFilter;
            this.fogTexture.minFilter = THREE.LinearFilter;
            this.fogTexture.colorSpace = THREE.NoColorSpace;
            this.fogSourceGrid = null;

            if (this.fogMesh) {
                this.scene.remove(this.fogMesh);
                this.fogMesh.geometry.dispose();
            }
            const geometry = new THREE.PlaneGeometry(gridW * TILE_SIZE, gridH * TILE_SIZE);
            geometry.rotateX(-Math.PI / 2);
            geometry.translate((gridW * TILE_SIZE) / 2, 0.4, (gridH * TILE_SIZE) / 2);
            this.fogMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
                color: 0x000000, alphaMap: this.fogTexture, transparent: true, depthWrite: false
            }));
            this.fogMesh.renderOrder = 1;
            this.scene.add(this.fogMesh);
        }
        this.fogMesh!.visible = true;

        // Fog grids are mutated in place but the fog record is replaced whenever anything changes
        const record = frame.state.fogOfWar;
        if (this.fogSourceGrid === grid && this.fogSourceRecord === record) return;
        this.fogSourceGrid = grid;
        this.fogSourceRecord = record;

        const data = this.fogTexture.image.data as Uint8Array;
        for (let ty = 0; ty < gridH; ty++) {
            // Texture rows run south -> north (v = 0 is the plane's +Z edge)
            const row = (gridH - 1 - ty) * gridW;
            for (let tx = 0; tx < gridW; tx++) {
                // alphaMap reads the green channel
                data[(row + tx) * 4 + 1] = grid[ty * gridW + tx] === 0 ? 255 : 0;
            }
        }
        this.fogTexture.needsUpdate = true;
    }

    // -----------------------------------------------------------------------------------------
    // Entities
    // -----------------------------------------------------------------------------------------

    private getModelBuckets(key: string): ModelBuckets {
        let entry = this.models.get(key);
        if (!entry) {
            const def = getModelDef(key);
            const buckets = def.parts.map(part => {
                const geometry = part.shape.realizeTeamless();
                this.geometries.push(geometry);
                const isGlow = part.material === 'glow';
                const bucket = new InstanceBucket(this.scene, geometry, isGlow ? this.teamGlowMaterial : this.teamLitMaterial, !isGlow, true);
                this.allBuckets.push(bucket);
                return bucket;
            });
            entry = { def, buckets };
            this.models.set(key, entry);
        }
        return entry;
    }

    private teamColor(owner: number): THREE.Color {
        const slot = owner + 1;
        let color = this.teamColors[slot];
        if (!color) {
            color = new THREE.Color(owner >= 0 ? (PLAYER_COLORS[owner] ?? '#888888') : NEUTRAL_COLOR);
            this.teamColors[slot] = color;
        }
        return color;
    }

    /** Writes every part of a model for one instance. `bodyMatrix` places the model origin. */
    private pushModel(
        entry: ModelBuckets, owner: number, bodyMatrix: THREE.Matrix4, bodyYaw: number, aimYaw: number, spinPhase: number,
        tint: number, tintG = tint, tintB = tint, anim: PartAnim = STILL
    ): void {
        const team = this.teamColor(owner);
        const { def, buckets } = entry;
        for (let i = 0; i < def.parts.length; i++) {
            const part = def.parts[i];
            if (part.ammoSlot !== undefined && !(anim.loaded & (1 << part.ammoSlot))) continue;
            if (anim.wreck ? part.material === 'glow' : part.blink && anim.tick % part.blink >= part.blink / 2) continue;

            const kick = part.recoil ? part.recoil * anim.recoil : 0;
            let matrix = bodyMatrix;
            if (part.mode !== 'body' && part.pivot) {
                const [px, py, pz] = part.pivot;
                if (part.mode === 'turret') {
                    // Turret parts turn to the aim and recoil along their own barrel axis
                    const angle = aimYaw - bodyYaw;
                    this.mLocal.makeRotationY(angle);
                    this.mLocal.setPosition(px - kick * Math.cos(angle), py, pz + kick * Math.sin(angle));
                } else {
                    const angle = spinPhase * (part.spinSpeed ?? 0);
                    if (part.spinAxis === 'x') this.mLocal.makeRotationX(angle);
                    else if (part.spinAxis === 'z') this.mLocal.makeRotationZ(angle);
                    else this.mLocal.makeRotationY(angle);
                    this.mLocal.setPosition(px, py, pz);
                }
                matrix = this.mOut.multiplyMatrices(bodyMatrix, this.mLocal);
            } else if (kick) {
                this.mLocal.makeTranslation(-kick, 0, 0);
                matrix = this.mOut.multiplyMatrices(bodyMatrix, this.mLocal);
            }
            buckets[i].push(matrix, tint, tintG, tintB, team);
        }
    }

    /** Hull transform: position, heading, and the chassis' pitch (nose up) and roll (right side down). */
    private composeBody(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, out: THREE.Matrix4, scaleY = 1): void {
        this.vPos.set(x, y, z);
        this.euler.set(roll, yaw, pitch);
        this.qRot.setFromEuler(this.euler);
        this.vScale.set(1, scaleY, 1);
        out.compose(this.vPos, this.qRot, this.vScale);
    }

    private addEntity(entity: Entity, state: GameState, dt: number): void {
        // Docked harriers are drawn parked on their Air-Force Command instead
        if (isAirUnit(entity) && entity.airUnit.state === 'docked') return;
        if (entity.type === 'UNIT' || entity.type === 'BUILDING') {
            this.addActor(entity, state, dt);
            return;
        }

        const hash = this.hashId(entity.id);
        let key: string = entity.key;
        let yaw = 0;
        let scale = 1;

        switch (entity.type) {
            case 'ROCK':
                // Rock and well models are authored at unit radius
                key = `rock_${hash % ROCK_VARIANTS}`;
                yaw = (hash % 628) / 100;
                scale = entity.radius;
                break;
            case 'WELL':
                key = entity.well.isBlocked ? 'well_blocked' : 'well_active';
                scale = entity.radius;
                if (!entity.well.isBlocked) {
                    scale *= 1 + Math.sin(((state.tick % 60) / 60) * Math.PI * 2) * 0.05;
                }
                break;
            case 'RESOURCE':
                // Ore piles shrink as they are mined out
                key = 'ore';
                yaw = (hash % 628) / 100;
                scale = 0.5 + 0.5 * Math.sqrt(Math.max(0, entity.hp / entity.maxHp));
                break;
        }

        this.vPos.set(entity.pos.x, 0, entity.pos.y);
        this.qRot.setFromAxisAngle(this.yAxis, yaw);
        this.vScale.setScalar(scale);
        this.mBody.compose(this.vPos, this.qRot, this.vScale);
        this.pushModel(this.getModelBuckets(key), entity.owner, this.mBody, yaw, yaw, state.tick + (hash % 97), 1);
    }

    /** Units and buildings: animated chassis, turrets, recoil, ammo, exhaust and damage smoke. */
    private addActor(entity: Entity, state: GameState, dt: number): void {
        if (!isUnit(entity) && !isBuilding(entity)) return;
        const tick = state.tick;
        const vs = this.visualOf(entity);
        vs.frame = this.frameNo;
        const combat = entity.combat;
        const flash = (combat?.flash ?? 0) > 0 ? FLASH_TINT : 1;
        const altitude = getAltitude(entity);
        const entry = this.getModelBuckets(entity.key);

        let yaw = 0;
        let aimYaw = 0;
        let lift = 0;
        if (isUnit(entity)) {
            this.updateMotion(entity, vs, dt);
            // Sim angles are measured with +y pointing south; three.js yaw turns the other way
            yaw = -vs.heading;
            aimYaw = combat ? -combat.turretAngle : yaw;
            if (isInfantryKey(entity.key)) {
                // Riflemen face what they shoot at; walking bobs them along
                if (combat?.targetId && (vs.speed < 0.4 || tick - vs.fireTick < 40)) yaw = aimYaw;
                if (vs.speed > 0.2) lift = Math.abs(Math.sin(vs.walk)) * 0.9;
            }
        } else if (combat) {
            aimYaw = -(combat.turretAngle - BUILDING_TURRET_OFFSET);
        }
        vs.yaw = yaw;
        vs.aimYaw = aimYaw;

        this.composeBody(entity.pos.x, altitude + lift, entity.pos.y, yaw, vs.pitch, vs.roll, this.mBody);
        const anim = this.anim;
        anim.recoil = recoilKick(tick - vs.fireTick);
        anim.loaded = this.loadedSlots(entity, vs, tick);
        anim.tick = tick;
        anim.wreck = false;
        this.pushModel(entry, entity.owner, this.mBody, yaw, aimYaw, tick + (this.hashId(entity.id) % 97), flash, flash, flash, anim);

        if (dt > 0) {
            this.emitFromModel(entry.def, vs, dt);
            this.emitDamage(entity, altitude, dt);
        }

        if (entity.type === 'BUILDING' && entity.key === 'airforce_command' && entity.airBase) {
            this.addParkedHarriers(entity, state);
        }
    }

    private visualOf(entity: Entity): EntityVisual {
        let vs = this.visuals.get(entity.id);
        if (!vs) {
            const heading = isUnit(entity) ? entity.movement.rotation : 0;
            vs = {
                frame: this.frameNo, x: entity.pos.x, y: entity.pos.y, speed: 0, heading,
                pitch: 0, pitchVel: 0, roll: 0, rollVel: 0, walk: 0,
                fireTick: -Infinity, shots: 0, reloadAt: [], yaw: -heading, aimYaw: -heading,
            };
            this.syncPose(entity, vs);
            vs.frame = -1;
            this.visuals.set(entity.id, vs);
        }
        return vs;
    }

    /** Poses an entity straight from the sim (no smoothing), for shooters that weren't on screen. */
    private syncPose(entity: Entity, vs: EntityVisual): void {
        if (isUnit(entity)) {
            if (!isFlyingUnit(entity)) vs.heading = entity.movement.rotation;
            vs.x = entity.pos.x;
            vs.y = entity.pos.y;
            vs.yaw = -vs.heading;
            vs.aimYaw = entity.combat ? -entity.combat.turretAngle : vs.yaw;
            if (isInfantryKey(entity.key) && entity.combat?.targetId) vs.yaw = vs.aimYaw;
        } else if (isBuilding(entity)) {
            vs.yaw = 0;
            vs.aimYaw = entity.combat ? -(entity.combat.turretAngle - BUILDING_TURRET_OFFSET) : 0;
        }
        vs.pitch = vs.roll = vs.pitchVel = vs.rollVel = 0;
    }

    /** Tracks speed and heading from frame to frame and springs the chassis about on its suspension. */
    private updateMotion(entity: Entity, vs: EntityVisual, dt: number): void {
        if (dt <= 0 || !isUnit(entity)) return;
        const dx = entity.pos.x - vs.x;
        const dy = entity.pos.y - vs.y;
        vs.x = entity.pos.x;
        vs.y = entity.pos.y;
        const dist = Math.hypot(dx, dy);
        // Big jumps are teleports (unloading from transports, spawning), not movement
        const measured = dist > 40 * dt ? 0 : dist / dt;
        const prevSpeed = vs.speed;
        vs.speed += (measured - vs.speed) * 0.6;
        const accel = (vs.speed - prevSpeed) / dt;

        const data = RULES.units[entity.key];
        const flying = data?.fly === true;
        let heading = entity.movement.rotation;
        if (flying) {
            // Aircraft have no sim heading: turn toward the direction of travel, or the target when hovering
            let desired = vs.heading;
            if (measured > 0.3) desired = Math.atan2(dy, dx);
            else if (entity.combat?.targetId) desired = entity.combat.turretAngle;
            heading = vs.heading + wrapAngle(desired - vs.heading) * Math.min(1, 0.12 * dt);
        }
        const yawRate = wrapAngle(heading - vs.heading) / dt;
        vs.heading = wrapAngle(heading);

        if (isInfantryKey(entity.key)) {
            vs.walk += dist * 0.32;
            return;
        }

        let rollTarget: number;
        let pitchTarget = 0, stiffness = 0.06, damping = 0.3, maxPitch = 0.12, maxRoll = 0.08;
        if (flying) {
            const maxSpeed = data?.speed ?? 6;
            stiffness = 0.05;
            damping = 0.35;
            maxPitch = 0.35;
            maxRoll = 0.7;
            if (entity.key === 'harrier') {
                rollTarget = clamp(yawRate * 20, 0.65);
            } else {
                // Helicopters dip their nose to fly forward and bank into turns
                pitchTarget = -Math.min(1, vs.speed / maxSpeed) * 0.22;
                rollTarget = clamp(yawRate * 10, 0.4);
            }
        } else {
            // Tracks squat when pulling away and dive when braking; the hull leans out of turns
            vs.pitchVel += clamp(accel, 0.4) * 0.06;
            rollTarget = clamp(-yawRate * vs.speed * 1.2, 0.05);
        }
        const steps = Math.min(8, Math.ceil(dt));
        const h = dt / steps;
        for (let i = 0; i < steps; i++) {
            vs.pitchVel += (stiffness * (pitchTarget - vs.pitch) - damping * vs.pitchVel) * h;
            vs.rollVel += (stiffness * (rollTarget - vs.roll) - damping * vs.rollVel) * h;
            vs.pitch = clamp(vs.pitch + vs.pitchVel * h, maxPitch);
            vs.roll = clamp(vs.roll + vs.rollVel * h, maxRoll);
        }
    }

    /** Bit mask of loaded ammo slots: harriers show their remaining missiles, launchers reload after firing. */
    private loadedSlots(entity: Entity, vs: EntityVisual, tick: number): number {
        if (isAirUnit(entity)) return (1 << entity.airUnit.ammo) - 1;
        let mask = NO_SLOTS_EMPTY;
        for (let slot = 0; slot < vs.reloadAt.length; slot++) {
            if (vs.reloadAt[slot] > tick) mask &= ~(1 << slot);
        }
        return mask;
    }

    private addParkedHarriers(base: Entity, state: GameState): void {
        if (!isBuilding(base) || !base.airBase) return;
        const slots = base.airBase.slots;
        for (let i = 0; i < slots.length; i++) {
            const harrierId = slots[i];
            if (!harrierId) continue;
            const harrier = state.entities[harrierId];
            if (!harrier || harrier.dead || !isAirUnit(harrier) || harrier.airUnit.state !== 'docked') continue;
            const offset = AIRBASE_SLOT_OFFSETS[i] ?? { x: 0, y: 0 };
            const reloading = harrier.airUnit.ammo < harrier.airUnit.maxAmmo;

            const yaw = Math.PI / 2; // nose pointing north
            this.vPos.set(base.pos.x + offset.x, AIRBASE_PAD_HEIGHT, base.pos.y + offset.y);
            this.qRot.setFromAxisAngle(this.yAxis, yaw);
            this.vScale.setScalar(0.75);
            this.mBody.compose(this.vPos, this.qRot, this.vScale);
            const entry = this.getModelBuckets('harrier');
            const anim = this.anim;
            anim.recoil = 0;
            anim.loaded = (1 << harrier.airUnit.ammo) - 1;
            anim.tick = state.tick;
            anim.wreck = false;
            if (reloading) this.pushModel(entry, harrier.owner, this.mBody, yaw, yaw, 0, 1.6, 0.55, 0.55, anim);
            else this.pushModel(entry, harrier.owner, this.mBody, yaw, yaw, 0, 1, 1, 1, anim);
        }
    }

    private hashId(id: string): number {
        let hash = this.hashCache.get(id);
        if (hash === undefined) {
            hash = 2166136261;
            for (let i = 0; i < id.length; i++) {
                hash ^= id.charCodeAt(i);
                hash = Math.imul(hash, 16777619);
            }
            hash >>>= 0;
            if (this.hashCache.size > 50000) this.hashCache.clear();
            this.hashCache.set(id, hash);
        }
        return hash;
    }

    // -----------------------------------------------------------------------------------------
    // Muzzles
    // -----------------------------------------------------------------------------------------

    private turretPivot(def: ModelDef): readonly [number, number, number] | null {
        let pivot = this.pivotCache.get(def);
        if (pivot === undefined) {
            pivot = def.parts.find((p: ModelPart) => p.mode === 'turret' && p.pivot)?.pivot ?? null;
            this.pivotCache.set(def, pivot);
        }
        return pivot;
    }

    /** World position of muzzle `index` (cycling) of an entity, posed as it was last drawn. */
    private muzzlePosition(entity: Entity, vs: EntityVisual, def: ModelDef, index: number, out: THREE.Vector3): boolean {
        const muzzles = def.muzzles;
        if (!muzzles || muzzles.length === 0) return false;
        const muzzle = muzzles[index % muzzles.length];
        out.set(muzzle.pos[0], muzzle.pos[1], muzzle.pos[2]);
        const pivot = muzzle.frame === 'turret' ? this.turretPivot(def) : null;
        if (pivot) {
            const angle = vs.aimYaw - vs.yaw;
            const cos = Math.cos(angle), sin = Math.sin(angle);
            const x = out.x - pivot[0], z = out.z - pivot[2];
            out.x = pivot[0] + cos * x + sin * z;
            out.z = pivot[2] - sin * x + cos * z;
        }
        this.composeBody(entity.pos.x, getAltitude(entity), entity.pos.y, vs.yaw, vs.pitch, vs.roll, this.mScratch);
        out.applyMatrix4(this.mScratch);
        return true;
    }

    // -----------------------------------------------------------------------------------------
    // Events: shots, impacts, destruction
    // -----------------------------------------------------------------------------------------

    private processEvents(frame: Scene3DFrame): void {
        const { state } = frame;
        const events = state.visualEvents;
        if (events) {
            // Events are appended in tick order and kept for a while: only the tail is new
            let first = events.length;
            while (first > 0 && events[first - 1].tick > this.lastEventTick) first--;
            for (let i = first; i < events.length; i++) {
                const event = events[i];
                if (event.kind === 'fire') this.onFire(event, state);
                else if (event.kind === 'impact') this.onImpact(event);
                else if (event.kind === 'destroyed') this.onDestroyed(event, state.tick);
            }
        }
        this.lastEventTick = Math.max(this.lastEventTick, state.tick);
    }

    private onFire(event: Extract<VisualEvent, { kind: 'fire' }>, state: GameState): void {
        const source = state.entities[event.sourceId];
        if (!source || (!isUnit(source) && !isBuilding(source))) return;
        const vs = this.visualOf(source);
        // Shooters that weren't drawn last frame have a stale (or no) pose: take it from the sim
        if (vs.frame < this.frameNo - 1) this.syncPose(source, vs);
        const def = getModelDef(source.key);
        const shot = vs.shots++;
        vs.fireTick = event.tick;
        const muzzle = def.muzzles?.[shot % def.muzzles.length];
        if (muzzle?.ammoSlot !== undefined) vs.reloadAt[muzzle.ammoSlot] = event.tick + reloadTicks(source.key);

        // Big guns rock the hull back, away from where the turret points
        const kick = CHASSIS_KICK[event.weaponType] ?? 0;
        if (kick && isUnit(source) && !isFlyingUnit(source)) {
            const rel = vs.aimYaw - vs.yaw;
            vs.pitchVel += kick * Math.cos(rel);
            vs.rollVel += kick * Math.sin(rel);
        }

        if (!this.visibility(source.pos.x, source.pos.y)) return;
        const from = this.vMuzzle;
        if (!this.muzzlePosition(source, vs, def, shot, from)) {
            from.set(source.pos.x, getAltitude(source) + Math.min(getModelHeight(source) * 0.6, 14), source.pos.y);
        }
        this.pendingMuzzles.set(event.sourceId, { x: from.x, y: from.y, z: from.z, tick: event.tick });

        const target = state.entities[event.targetId];
        const to = this.vTarget;
        if (target) to.set(target.pos.x, getAltitude(target) + Math.min(getModelHeight(target) * 0.5, 10), target.pos.y);
        else to.copy(from).add(this.vTmp.set(Math.cos(-vs.aimYaw), 0, Math.sin(-vs.aimYaw)).multiplyScalar(40));
        this.spawnMuzzleEffect(event.weaponType, from, to);
    }

    private spawnMuzzleEffect(weaponType: string, from: THREE.Vector3, to: THREE.Vector3): void {
        const dir = this.vDir.subVectors(to, from);
        const dist = dir.length();
        if (dist > 0.001) dir.divideScalar(dist);
        const { x, y, z } = from;
        switch (weaponType) {
            case 'bullet':
            case 'ap_bullet':
                this.flash(x, y, z, 3.4, 3);
                this.smokePuff(x, y, z, 1.2, 3.5, 22, 0.22, 0.75, dir.x * 0.2, dir.z * 0.2);
                break;
            case 'sniper':
                this.flash(x, y, z, 3.4, 3);
                // Beams are drawn above the fog, so they must not point into it
                if (this.visibility(to.x, to.z)) this.beams.spawn(from, to, 0.45, SNIPER_TRACER, 6);
                break;
            case 'laser':
                if (this.visibility(to.x, to.z)) {
                    this.beams.spawn(from, to, 4.5, LASER_GLOW, 16);
                    this.beams.spawn(from, to, 1.1, LASER_CORE, 12);
                }
                this.fire.spawn({ x, y, z, life: 14, size: 12, endSize: 6, r: 1, g: 0.3, b: 0.25, r1: 0.6, g1: 0.02, b1: 0.02, alpha: 0.9 });
                break;
            case 'flame':
                for (let i = 0; i < 12; i++) {
                    const life = rand(13, 18);
                    const speed = (dist / life) * rand(0.75, 1.05);
                    this.fire.spawn({
                        x, y, z, life, size: rand(1.5, 2.5), endSize: rand(6, 9),
                        vx: dir.x * speed + rand(-0.25, 0.25), vy: dir.y * speed + rand(-0.1, 0.2), vz: dir.z * speed + rand(-0.25, 0.25),
                        r: 1, g: 0.9, b: 0.5, r1: 0.85, g1: 0.22, b1: 0.02, alpha: 0.85, drag: 0.02, gravity: -0.03,
                    });
                }
                this.smokePuff(x, y + 1, z, 2, 6, 40, 0.35, 0.3, dir.x * 0.5, dir.z * 0.5);
                break;
            case 'cannon':
            case 'heavy_cannon':
            case 'shell': {
                const big = weaponType === 'shell' ? 1.6 : weaponType === 'heavy_cannon' ? 1.25 : 1;
                this.flash(x, y, z, 8 * big, 4);
                this.fire.spawn({ x: x + dir.x * 3, y, z: z + dir.z * 3, life: 5, size: 5 * big, endSize: 8 * big, r: 1, g: 0.75, b: 0.35, r1: 0.9, g1: 0.3, b1: 0.05, vx: dir.x * 1.2, vz: dir.z * 1.2 });
                for (let i = 0; i < 4 + 2 * big; i++) {
                    const s = rand(0.3, 1.1);
                    this.smokePuff(x, y, z, 3 * big, 10 * big, rand(45, 75), 0.42, 0.68, dir.x * s + rand(-0.2, 0.2), dir.z * s + rand(-0.2, 0.2));
                }
                if (weaponType === 'shell') this.dustRing(x, z, 14, 6);
                break;
            }
            case 'rocket':
            case 'missile':
            case 'aa_missile':
            case 'air_missile':
                this.flash(x, y, z, 5, 3);
                // Back-blast out of the rear of the launcher
                for (let i = 0; i < 5; i++) {
                    const s = rand(0.3, 0.9);
                    this.smokePuff(x, y, z, 2.5, 9, rand(40, 70), 0.5, 0.8, -dir.x * s + rand(-0.2, 0.2), -dir.z * s + rand(-0.2, 0.2));
                }
                break;
            case 'heal':
                for (let i = 0; i < 4; i++) {
                    this.fire.spawn({ x: to.x + rand(-4, 4), y: to.y, z: to.z + rand(-4, 4), vy: rand(0.15, 0.35), life: rand(25, 40), size: 2.5, endSize: 1, r: 0.35, g: 1, b: 0.45, alpha: 0.8, fadeIn: 0.2 });
                }
                break;
            case 'grenade':
                this.flash(x, y, z, 3, 3);
                break;
        }
    }

    private onImpact(event: Extract<VisualEvent, { kind: 'impact' }>): void {
        const { x, y: z, air } = event;
        if (!this.visibility(x, z)) return;
        const y = air ? AIR_ALTITUDE + 4 : 2;
        if (event.intercepted) {
            this.explosion(x, y, z, 6, false);
            return;
        }
        switch (event.weaponType) {
            case 'bullet':
            case 'ap_bullet':
                this.sparks(x, y + 2, z, 3, 0.9);
                if (!air) this.smokePuff(x, 1.5, z, 1.5, 5, rand(25, 40), 0.35, 0.62, 0, 0, 0.12, 0.55);
                return;
            case 'sniper':
                this.sparks(x, y + 3, z, 5, 1.1);
                if (!air) this.smokePuff(x, 1.5, z, 2, 6, 40, 0.35, 0.62, 0, 0, 0.12, 0.55);
                return;
            case 'laser':
                this.sparks(x, y + 3, z, 10, 1.4, 1, 0.4, 0.3);
                this.fire.spawn({ x, y: y + 3, z, life: 12, size: 10, endSize: 4, r: 1, g: 0.35, b: 0.2, r1: 0.5, g1: 0.02, b1: 0, alpha: 0.9 });
                if (!air) this.scorch(x, z, 9, 0.5);
                return;
            case 'flame':
                for (let i = 0; i < 4; i++) {
                    this.fire.spawn({ x: x + rand(-5, 5), y: y + rand(0, 3), z: z + rand(-5, 5), vy: rand(0.1, 0.3), life: rand(15, 25), size: rand(3, 5), endSize: rand(6, 9), r: 1, g: 0.75, b: 0.3, r1: 0.7, g1: 0.15, b1: 0.02, alpha: 0.8 });
                }
                if (!air) this.scorch(x, z, 10, 0.25);
                return;
            case 'heal':
                return;
        }
        const size = Math.max(IMPACT_SIZE[event.weaponType] ?? 7, event.splash * 0.3);
        this.explosion(x, y, z, size, !air);
    }

    private onDestroyed(event: Extract<VisualEvent, { kind: 'destroyed' }>, tick: number): void {
        const { x, y: z, key, owner } = event;
        const visible = this.visibility(x, z);
        if (event.entityType === 'BUILDING') {
            const data = RULES.buildings[key];
            const w = data?.w ?? 60, h = data?.h ?? 60;
            const size = Math.max(w, h);
            if (visible) {
                // A chain of blasts across the footprint, then the whole thing goes up
                const blasts = 3 + Math.round((w * h) / 2500);
                for (let i = 0; i < blasts; i++) {
                    this.delayed.push({ at: event.tick + Math.floor(rand(0, 40)), x: x + rand(-0.4, 0.4) * w, y: rand(4, 18), z: z + rand(-0.4, 0.4) * h, size: rand(10, 16) });
                }
                this.delayed.push({ at: event.tick + 30, x, y: 6, z, size: size * 0.32 });
                this.explosion(x, 8, z, size * 0.22, true);
                for (let i = 0; i < 14; i++) this.debris.spawn(x + rand(-0.3, 0.3) * w, rand(4, 14), z + rand(-0.3, 0.3) * h, rand(1.5, 3), rand(2, 4.5), DEBRIS_COLORS[i % DEBRIS_COLORS.length], rand(500, 900));
                this.scorch(x, z, size * 1.1, 0.7);
            }
            this.wrecks.push({
                key, owner, x, z, altitude: 0, fallSpeed: 0, yaw: 0, aimYaw: rand(-1, 1), spin: 0, pitch: 0, roll: 0,
                start: tick, life: RUBBLE_TICKS, building: true, height: RULES.buildings[key] ? 30 : 20, radius: size / 2,
            });
            return;
        }

        if (isInfantryKey(key)) {
            if (visible) this.smokePuff(x, 2, z, 3, 8, 50, 0.4, 0.55, 0, 0, 0.1, 0.45);
            return;
        }

        const yaw = -event.rotation;
        if (event.air) {
            // Aircraft blow up in the air and tumble down to crash
            if (visible) this.explosion(x, AIR_ALTITUDE, z, 11, false);
            this.wrecks.push({
                key, owner, x, z, altitude: AIR_ALTITUDE, fallSpeed: 0, yaw, aimYaw: yaw, spin: rand(-0.12, 0.12),
                pitch: rand(-0.3, -0.1), roll: rand(-0.5, 0.5), start: tick, life: WRECK_TICKS * 0.7, building: false, height: 12, radius: event.radius,
            });
            return;
        }

        const size = event.radius * 0.9 + 8;
        if (visible) {
            this.explosion(x, 4, z, size, true);
            this.delayed.push({ at: event.tick + Math.floor(rand(5, 12)), x: x + rand(-4, 4), y: 6, z: z + rand(-4, 4), size: size * 0.6 });
            const team = this.parseColor(PLAYER_COLORS[owner] ?? '#888888');
            for (let i = 0; i < 6 + Math.round(event.radius / 4); i++) {
                this.debris.spawn(x, 5, z, rand(1.2, 2.6), rand(1.2, 2.8), i % 3 === 0 ? team : DEBRIS_COLORS[i % DEBRIS_COLORS.length], rand(300, 600));
            }
        }
        this.wrecks.push({
            key, owner, x, z, altitude: 0, fallSpeed: 0, yaw, aimYaw: yaw + rand(-0.8, 0.8), spin: 0,
            pitch: rand(-0.06, 0.06), roll: rand(-0.08, 0.08), start: tick, life: WRECK_TICKS, building: false, height: 16, radius: event.radius,
        });
    }

    private processDelayedBlasts(tick: number): void {
        const delayed = this.delayed;
        let kept = 0;
        for (let i = 0; i < delayed.length; i++) {
            const blast = delayed[i];
            if (blast.at > tick) {
                delayed[kept++] = blast;
            } else if (this.visibility(blast.x, blast.z)) {
                this.explosion(blast.x, blast.y, blast.z, blast.size, blast.y < 10);
            }
        }
        delayed.length = kept;
    }

    // -----------------------------------------------------------------------------------------
    // Wrecks
    // -----------------------------------------------------------------------------------------

    private addWrecks(tick: number, dt: number): void {
        const anim = this.anim;
        anim.recoil = 0;
        anim.loaded = 0; // launchers are empty
        anim.tick = tick;
        anim.wreck = true;
        for (let i = this.wrecks.length - 1; i >= 0; i--) {
            const w = this.wrecks[i];
            const age = tick - w.start;
            if (age >= w.life) {
                this.wrecks.splice(i, 1);
                continue;
            }
            if (w.altitude > 0 && dt > 0) {
                w.fallSpeed += 0.08 * dt;
                w.altitude -= w.fallSpeed * dt;
                w.yaw += w.spin * dt;
                if (w.altitude <= 0) {
                    w.altitude = 0;
                    w.spin = 0;
                    w.pitch *= 0.3;
                    if (this.visibility(w.x, w.z)) this.explosion(w.x, 3, w.z, 12, true);
                }
            }
            if (!this.visibility(w.x, w.z)) continue;

            const sink = Math.max(0, age - (w.life - WRECK_SINK_TICKS)) / WRECK_SINK_TICKS;
            // Buildings slump into a heap of rubble
            const scaleY = w.building ? 1 - 0.68 * Math.min(1, age / 45) : 1;
            this.composeBody(w.x, w.altitude - sink * w.height, w.z, w.yaw, w.pitch, w.roll, this.mBody, scaleY);
            const fade = 1 - sink * 0.5;
            this.pushModel(this.getModelBuckets(w.key), w.owner, this.mBody, w.yaw, w.aimYaw, 0,
                WRECK_TINT[0] * fade, WRECK_TINT[1] * fade, WRECK_TINT[2] * fade, anim);

            if (dt > 0) {
                const heat = 1 - age / w.life;
                const top = w.altitude + (w.building ? 10 : 7);
                const spread = w.building ? w.radius * 0.6 : 3;
                for (let n = count((w.building ? 0.45 : 0.16) * heat * dt * this.smokeBudget); n > 0; n--) {
                    this.smokePuff(w.x + rand(-spread, spread), top, w.z + rand(-spread, spread), 4, w.building ? 22 : 13, rand(120, 220), 0.5, 0.16, 0, 0, 0.3);
                }
                if (age < w.life * 0.45) {
                    for (let n = count((w.building ? 0.4 : 0.18) * dt * this.fireBudget); n > 0; n--) {
                        this.fire.spawn({
                            x: w.x + rand(-spread, spread), y: top - 2, z: w.z + rand(-spread, spread), vy: rand(0.15, 0.4),
                            life: rand(12, 22), size: rand(2.5, 4.5), endSize: 1, r: 1, g: 0.7, b: 0.25, r1: 0.8, g1: 0.15, b1: 0.02, alpha: 0.85, fadeIn: 0.2,
                        });
                    }
                }
            }
        }
    }

    // -----------------------------------------------------------------------------------------
    // Ambient emitters and damage
    // -----------------------------------------------------------------------------------------

    /** Engine exhaust while driving, chimney smoke and cooling-tower steam. Uses the current mBody. */
    private emitFromModel(def: ModelDef, vs: EntityVisual, dt: number): void {
        if (!def.emitters) return;
        for (const emitter of def.emitters) {
            let rate: number;
            if (emitter.kind === 'exhaust') {
                if (vs.speed < 0.15) continue;
                rate = vs.pitchVel > 0.002 ? 0.35 : 0.18;
            } else {
                rate = emitter.kind === 'steam' ? 0.07 : 0.05;
            }
            for (let n = count(rate * dt * this.smokeBudget); n > 0; n--) {
                const p = this.vTmp.set(emitter.pos[0], emitter.pos[1], emitter.pos[2]).applyMatrix4(this.mBody);
                if (emitter.kind === 'exhaust') this.smokePuff(p.x, p.y, p.z, 1.5, 5, rand(30, 50), 0.3, 0.35, 0, 0, 0.18);
                else if (emitter.kind === 'steam') this.smokePuff(p.x, p.y, p.z, 5, 18, rand(140, 220), 0.38, 0.9, 0, 0, 0.35);
                else this.smokePuff(p.x, p.y, p.z, 3.5, 14, rand(140, 220), 0.4, 0.3, 0, 0, 0.3);
            }
        }
    }

    /** Badly damaged vehicles and buildings smoke, and burn when nearly destroyed. */
    private emitDamage(entity: Entity, altitude: number, dt: number): void {
        const ratio = entity.hp / entity.maxHp;
        if (ratio >= 0.5 || (entity.type === 'UNIT' && isInfantryKey(entity.key))) return;
        const building = entity.type === 'BUILDING';
        const spreadX = building ? entity.w * 0.3 : 3;
        const spreadZ = building ? entity.h * 0.3 : 3;
        const top = altitude + getModelHeight(entity) * (building ? 0.6 : 0.8);
        const severity = (0.5 - ratio) * 2;
        for (let n = count((building ? 0.5 : 0.22) * severity * dt * this.smokeBudget); n > 0; n--) {
            this.smokePuff(entity.pos.x + rand(-spreadX, spreadX), top, entity.pos.y + rand(-spreadZ, spreadZ),
                3, building ? 16 : 10, rand(90, 160), 0.45, 0.18, 0, 0, 0.3);
        }
        if (ratio < 0.25) {
            for (let n = count((building ? 0.35 : 0.2) * dt * this.fireBudget); n > 0; n--) {
                this.fire.spawn({
                    x: entity.pos.x + rand(-spreadX, spreadX), y: top - 1, z: entity.pos.y + rand(-spreadZ, spreadZ), vy: rand(0.12, 0.3),
                    life: rand(10, 18), size: rand(2, 4), endSize: 1, r: 1, g: 0.72, b: 0.28, r1: 0.85, g1: 0.18, b1: 0.02, alpha: 0.85, fadeIn: 0.2,
                });
            }
        }
    }

    // -----------------------------------------------------------------------------------------
    // Effect recipes
    // -----------------------------------------------------------------------------------------

    private flash(x: number, y: number, z: number, size: number, life: number): void {
        this.fire.spawn({ x, y, z, life, size, endSize: size * 1.3, r: 1, g: 0.95, b: 0.75, r1: 1, g1: 0.55, b1: 0.15, alpha: 0.95 });
    }

    /** A soft puff of smoke/dust/steam. `shade` is its grey level; `rise` its upward drift. */
    private smokePuff(
        x: number, y: number, z: number, size: number, endSize: number, life: number, alpha: number, shade: number,
        vx = 0, vz = 0, rise = 0.15, warmth = 0.5
    ): void {
        const r = shade * (1 + (warmth - 0.5) * 0.12), b = shade * (1 - (warmth - 0.5) * 0.12);
        this.smoke.spawn({
            x, y, z, vx: vx + WIND_X * rand(0.5, 1.5), vy: rise * rand(0.7, 1.3), vz: vz + WIND_Z * rand(0.5, 1.5), life, size, endSize,
            r, g: shade, b, alpha, fadeIn: 0.08, drag: 0.03,
        });
    }

    private sparks(x: number, y: number, z: number, n: number, speed: number, r = 1, g = 0.85, b = 0.45): void {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, s = speed * rand(0.5, 1.5);
            this.fire.spawn({
                x, y, z, vx: Math.cos(a) * s, vy: rand(0.5, 1.6) * speed, vz: Math.sin(a) * s, gravity: 0.1, life: rand(8, 18),
                size: rand(0.9, 1.6), endSize: 0.5, r, g, b, r1: 1, g1: 0.35, b1: 0.05, bounce: true,
            });
        }
    }

    private dustRing(x: number, z: number, radius: number, n: number): void {
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + rand(0, 0.5);
            this.smokePuff(x + Math.cos(a) * radius * 0.5, 2, z + Math.sin(a) * radius * 0.5, radius * 0.3, radius * 0.8, rand(50, 80), 0.4, 0.62,
                Math.cos(a) * 0.5, Math.sin(a) * 0.5, 0.05, 0.75);
        }
    }

    private scorch(x: number, z: number, size: number, alpha: number): void {
        this.scorches.spawn({ x, y: 0.25, z, life: SCORCH_TICKS, size, r: 0.05, g: 0.04, b: 0.03, alpha, fadeIn: 0.01 });
    }

    /**
     * Fireball, smoke, sparks; on the ground also a light flash, shockwave, flying dirt, dust and a scorch
     * mark. `size` is roughly the fireball's diameter in world units.
     */
    private explosion(x: number, y: number, z: number, size: number, ground: boolean): void {
        const k = size / 12;
        this.fire.spawn({ x, y: y + size * 0.2, z, life: 5, size: size * 2.4, endSize: size * 2.8, r: 1, g: 0.95, b: 0.8, r1: 1, g1: 0.6, b1: 0.2, alpha: 0.9 });
        const fireballs = 3 + Math.round(size / 3);
        for (let i = 0; i < fireballs; i++) {
            const a = Math.random() * Math.PI * 2, out = rand(0.1, 0.55) * k;
            this.fire.spawn({
                x: x + rand(-0.25, 0.25) * size, y: y + rand(0, 0.35) * size, z: z + rand(-0.25, 0.25) * size,
                vx: Math.cos(a) * out, vy: rand(0.15, 0.6) * k, vz: Math.sin(a) * out, drag: 0.06,
                life: rand(16, 32), size: size * rand(0.45, 0.7), endSize: size * rand(0.9, 1.3),
                r: 1, g: 0.88, b: 0.55, r1: 0.65, g1: 0.12, b1: 0.02, alpha: 0.95,
            });
        }
        this.sparks(x, y + 2, z, 4 + Math.round(size / 2), 1.6 * Math.sqrt(k));
        const plumes = 2 + Math.round(size / 3);
        for (let i = 0; i < plumes; i++) {
            const a = Math.random() * Math.PI * 2, out = rand(0.05, 0.3) * k;
            this.smokePuff(x + rand(-0.3, 0.3) * size, y + rand(0.1, 0.5) * size, z + rand(-0.3, 0.3) * size,
                size * 0.55, size * rand(1.5, 2.1), rand(90, 200), 0.62, rand(0.14, 0.24), Math.cos(a) * out, Math.sin(a) * out, rand(0.15, 0.35) * Math.sqrt(k));
        }
        if (!ground) return;

        this.groundGlow.spawn({ x, y: 0.35, z, life: 10, size: size * 3.4, endSize: size * 4, r: 1, g: 0.6, b: 0.25, r1: 0.6, g1: 0.15, b1: 0, alpha: 0.75 });
        if (size >= 9) {
            this.shockwaves.spawn({ x, y: 0.4, z, life: 12, size: size * 0.8, endSize: size * 4.5, r: 1, g: 0.8, b: 0.55, r1: 0.5, g1: 0.25, b1: 0.05, alpha: 0.7 });
        }
        for (let i = 0; i < Math.round(size / 2.5); i++) {
            const a = Math.random() * Math.PI * 2, out = rand(0.3, 1) * k;
            this.smoke.spawn({
                x, y: 1, z, vx: Math.cos(a) * out, vy: rand(1.2, 2.6) * Math.sqrt(k), vz: Math.sin(a) * out, gravity: 0.1, bounce: false,
                life: rand(28, 45), size: rand(1.4, 2.6), endSize: rand(1, 2), r: 0.3, g: 0.24, b: 0.17, alpha: 0.9,
            });
        }
        this.dustRing(x, z, size * 1.2, 5 + Math.round(size / 4));
        this.scorch(x, z, size * 1.5, Math.min(0.65, 0.3 + size * 0.02));
    }

    // -----------------------------------------------------------------------------------------
    // Projectiles
    // -----------------------------------------------------------------------------------------

    private createProjectileBuckets(): void {
        const make = (name: string, geometry: THREE.BufferGeometry, color: number, glow: boolean) => {
            const colors = new Float32Array(geometry.getAttribute('position').count * 3);
            const c = new THREE.Color(color);
            for (let i = 0; i < colors.length; i += 3) {
                colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b;
            }
            geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            this.geometries.push(geometry);
            const bucket = new InstanceBucket(this.scene, geometry, glow ? this.glowMaterial : this.litMaterial, !glow, false, 64);
            this.allBuckets.push(bucket);
            this.projectileBuckets.set(name, bucket);
        };
        const along = (geometry: THREE.BufferGeometry) => geometry.rotateZ(-Math.PI / 2); // +Y -> +X

        make('hitscan', new THREE.BoxGeometry(9, 0.9, 0.9).translate(-4.5, 0, 0), 0xffee55, true);
        make('rocket', along(new THREE.CylinderGeometry(0.9, 0.9, 6, 6)), 0x5d6436, false);
        make('artillery', new THREE.SphereGeometry(2.2, 8, 6).scale(1.6, 1, 1), 0x3c3c3c, false);
        make('missile', along(new THREE.CylinderGeometry(0.9, 0.9, 8, 6)), 0xeeeeee, false);
        make('ballistic', new THREE.SphereGeometry(1.6, 8, 6).scale(1.8, 1, 1), 0xffc070, true);
        make('grenade', new THREE.SphereGeometry(2.4, 8, 6), 0x3d5e35, false);
        make('heal', new THREE.SphereGeometry(1.8, 8, 6), 0x55ff66, true);
        make('default', new THREE.SphereGeometry(1.6, 8, 6), 0xffee55, true);
    }

    /** Launch / impact heights and arc of a projectile at ground-progress `p` (0..1). */
    private projectileHeight(proj: Projectile, p: number, startHeight: number, endHeight: number, loft: number): number {
        return startHeight + (endHeight - startHeight) * p + (proj.arcHeight + loft) * 4 * p * (1 - p);
    }

    private addProjectiles(frame: Scene3DFrame, dt: number): void {
        const { state } = frame;
        const entities = state.entities;
        const view = this.projectileView;

        let segmentCount = 0;
        for (const proj of state.projectiles) {
            if (proj.dead || !this.projectileVisible(proj, view)) continue;
            segmentCount += Math.max(0, proj.trailPoints.length - 1);
        }
        this.ensureTrailCapacity(segmentCount);

        let segment = 0;
        for (const proj of state.projectiles) {
            if (proj.dead || !this.projectileVisible(proj, view)) continue;
            const { x, y } = proj.pos;

            const shooter = entities[proj.ownerId];
            const target = entities[proj.targetId];
            const shot = this.shotVisual(proj, target);
            const startHeight = shot.startHeight ?? (shooter ? getAltitude(shooter) + Math.min(getModelHeight(shooter) * 0.6, 14) : 10);
            const endHeight = target ? getAltitude(target) + Math.min(getModelHeight(target) * 0.5, 12) : 4;
            // Non-homing shots fly at their aim point, not where the target has moved to
            const targetPos = (proj.archetype !== 'missile' && proj.targetPos) || target?.pos || proj.pos;
            const totalDist = proj.startPos.dist(targetPos);
            const progress = totalDist > 0 ? Math.min(1, proj.startPos.dist(proj.pos) / totalDist) : 0;
            // Shots leave the actual muzzle and converge on the sim's flight path
            const vx = x + shot.dx * (1 - progress);
            const vz = y + shot.dz * (1 - progress);
            const height = this.projectileHeight(proj, progress, startHeight, endHeight, shot.loft);

            // Orient along the flight path, including the climb/dive of arcing shots
            const yaw = -Math.atan2(proj.vel.y - shot.dz / Math.max(1, totalDist) * proj.speed, proj.vel.x - shot.dx / Math.max(1, totalDist) * proj.speed);
            const dhdp = (endHeight - startHeight) + (proj.arcHeight + shot.loft) * 4 * (1 - 2 * progress);
            const pitch = totalDist > 0 ? Math.atan2(dhdp, totalDist) : 0;
            this.euler.set(0, yaw, pitch);
            this.qRot.setFromEuler(this.euler);
            this.vPos.set(vx, height, vz);
            this.vScale.setScalar(1);
            this.mBody.compose(this.vPos, this.qRot, this.vScale);

            const bucketName = proj.type === 'heal' ? 'heal' : (this.projectileBuckets.has(proj.archetype) ? proj.archetype : 'default');
            this.projectileBuckets.get(bucketName)!.push(this.mBody);

            this.emitProjectileTrail(proj, shot, vx, height, vz, dt);

            // Line trail for fast shots (rockets and missiles leave smoke instead)
            if (proj.archetype === 'rocket' || proj.archetype === 'missile') continue;
            const points = proj.trailPoints;
            const n = points.length;
            for (let i = 1; i < n; i++) {
                const a = points[i - 1], b = points[i];
                const pa = totalDist > 0 ? Math.min(1, proj.startPos.dist(a) / totalDist) : 0;
                const pb = totalDist > 0 ? Math.min(1, proj.startPos.dist(b) / totalDist) : 0;
                const o = segment * 6;
                this.trailPositions[o] = a.x + shot.dx * (1 - pa);
                this.trailPositions[o + 1] = this.projectileHeight(proj, pa, startHeight, endHeight, shot.loft);
                this.trailPositions[o + 2] = a.y + shot.dz * (1 - pa);
                this.trailPositions[o + 3] = b.x + shot.dx * (1 - pb);
                this.trailPositions[o + 4] = this.projectileHeight(proj, pb, startHeight, endHeight, shot.loft);
                this.trailPositions[o + 5] = b.y + shot.dz * (1 - pb);
                const c = segment * 8;
                const alphaA = ((i - 1) / n) * 0.45;
                const alphaB = (i / n) * 0.45;
                this.trailColors.fill(1, c, c + 8);
                this.trailColors[c + 3] = alphaA;
                this.trailColors[c + 7] = alphaB;
                segment++;
            }
        }
        const geometry = this.trails.geometry;
        geometry.setDrawRange(0, segment * 2);
        if (segment > 0) {
            // Only the segments drawn this frame are uploaded
            markRange(geometry.getAttribute('position') as THREE.BufferAttribute, 0, segment * 2);
            markRange(geometry.getAttribute('color') as THREE.BufferAttribute, 0, segment * 2);
        }
        this.trails.visible = segment > 0;

        // Forget shots that are no longer in flight (or no longer visible)
        for (const [ownerId, list] of this.shots) {
            let kept = 0;
            for (let i = 0; i < list.length; i++) {
                if (list[i].frame === this.frameNo) list[kept++] = list[i];
            }
            if (kept === 0) this.shots.delete(ownerId);
            else list.length = kept;
        }
        for (const [id, muzzle] of this.pendingMuzzles) {
            if (state.tick - muzzle.tick > 20) this.pendingMuzzles.delete(id);
        }
    }

    private projectileVisible(proj: Projectile, view: { left: number; right: number; top: number; bottom: number }): boolean {
        const { x, y } = proj.pos;
        return x >= view.left && x <= view.right && y >= view.top && y <= view.bottom && this.visibility(x, y);
    }

    /** Muzzle offset and loft of a projectile, worked out the first time it is drawn. */
    private shotVisual(proj: Projectile, target: Entity | undefined): ShotVisual {
        // A shot is identified by its shooter, where it was fired from and what at
        const startX = proj.startPos.x, startY = proj.startPos.y;
        let list = this.shots.get(proj.ownerId);
        let shot: ShotVisual | undefined;
        if (list) {
            for (let i = 0; i < list.length; i++) {
                const s = list[i];
                if (s.startX === startX && s.startY === startY && s.targetId === proj.targetId) {
                    shot = s;
                    break;
                }
            }
        } else {
            list = [];
            this.shots.set(proj.ownerId, list);
        }
        if (!shot) {
            const muzzle = this.pendingMuzzles.get(proj.ownerId);
            this.pendingMuzzles.delete(proj.ownerId);
            const totalDist = proj.startPos.dist(proj.targetPos ?? target?.pos ?? proj.pos);
            const groundTarget = !target || getAltitude(target) === 0;
            // Guided missiles and rockets loft over the battlefield toward ground targets
            const loft = !groundTarget ? 0 : proj.weaponType === 'missile' ? totalDist * 0.2 : proj.archetype === 'rocket' ? totalDist * 0.05 : 0;
            shot = {
                startX, startY, targetId: proj.targetId,
                frame: this.frameNo,
                dx: muzzle ? muzzle.x - proj.startPos.x : 0,
                dz: muzzle ? muzzle.z - proj.startPos.y : 0,
                startHeight: muzzle ? muzzle.y : null,
                loft,
                lastX: NaN, lastY: NaN, lastZ: NaN,
            };
            list.push(shot);
        }
        shot.frame = this.frameNo;
        return shot;
    }

    /** Rocket motors leave a smoke trail and a glowing exhaust; shells a faint wake. */
    private emitProjectileTrail(proj: Projectile, shot: ShotVisual, x: number, y: number, z: number, dt: number): void {
        const rocket = proj.archetype === 'rocket' || proj.archetype === 'missile';
        // Nothing to add while the game is paused (or between ticks)
        const trailing = rocket || proj.archetype === 'artillery';
        if (dt > 0 && trailing) {
            if (!Number.isNaN(shot.lastX)) {
                const ox = shot.lastX, oy = shot.lastY, oz = shot.lastZ;
                const dx = x - ox, dy = y - oy, dz = z - oz;
                const length = Math.hypot(dx, dy, dz);
                const spacing = rocket ? 6 : 9;
                const steps = Math.min(12, Math.floor(length / spacing));
                if (steps > 0) {
                    shot.lastX = x;
                    shot.lastY = y;
                    shot.lastZ = z;
                }
                for (let i = 1; i <= steps; i++) {
                    const t = (i - Math.random()) / steps;
                    if (rocket) {
                        const big = proj.archetype === 'missile' ? 1.3 : 1;
                        this.smokePuff(ox + dx * t + rand(-0.8, 0.8), oy + dy * t, oz + dz * t + rand(-0.8, 0.8),
                            3 * big, rand(8, 12) * big, rand(50, 90), 0.26, rand(0.72, 0.86), rand(-0.05, 0.05), rand(-0.05, 0.05), 0.04);
                    } else {
                        this.smokePuff(ox + dx * t, oy + dy * t, oz + dz * t, 1, 3, rand(20, 30), 0.22, 0.6, 0, 0, 0.02);
                    }
                }
            }
            if (rocket) this.fire.spawn({ x, y, z, life: 2, size: 4.5, r: 1, g: 0.85, b: 0.45, alpha: 0.95 });
        }
        // Keep the last puff's position until the shot has travelled far enough for the next one
        if (!trailing || Number.isNaN(shot.lastX)) {
            shot.lastX = x;
            shot.lastY = y;
            shot.lastZ = z;
        }
    }

    private ensureTrailCapacity(segments: number): void {
        if (this.trailPositions.length >= segments * 6 && this.trailPositions.length > 0) return;
        const capacity = Math.max(256, segments * 2);
        this.trailPositions = new Float32Array(capacity * 6);
        this.trailColors = new Float32Array(capacity * 8);
        const geometry = this.trails.geometry;
        // Free the old attributes' GPU buffers before they are replaced
        geometry.dispose();
        geometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 4).setUsage(THREE.DynamicDrawUsage));
    }

    // -----------------------------------------------------------------------------------------
    // Effect bookkeeping
    // -----------------------------------------------------------------------------------------

    private resetEffects(tick: number): void {
        for (const layer of this.particleLayers) layer.clear();
        this.debris.clear();
        this.beams.clear();
        this.visuals.clear();
        this.shots.clear();
        this.pendingMuzzles.clear();
        this.wrecks = [];
        this.delayed = [];
        this.lastTick = tick;
        this.lastEventTick = tick;
    }

    private stepEffects(dt: number): void {
        if (dt <= 0) return;
        for (const layer of this.particleLayers) layer.update(dt);
        this.debris.update(dt);
        this.beams.update(dt);
    }

    private syncEffects(): void {
        const visible = this.visibility;
        this.fire.sync(visible);
        this.smoke.sync(visible);
        this.debris.sync(visible);
        // Ground decals sit under the fog plane, which hides them where needed
        this.scorches.sync();
        this.groundGlow.sync();
        this.shockwaves.sync();
        this.beams.sync();
    }

    private pruneVisuals(): void {
        if (this.frameNo % 120 !== 0) return;
        for (const [id, vs] of this.visuals) {
            if (this.frameNo - vs.frame > VISUAL_STATE_TTL_FRAMES) this.visuals.delete(id);
        }
    }

    /** Refreshes the inputs of `visibility` (and the projectile view bounds) for this frame. */
    private updateVisibility(frame: Scene3DFrame): void {
        this.viewBounds(frame, 150, this.visibleView);
        this.viewBounds(frame, 200, this.projectileView);
        this.visibleFog = frame.fogGrid;
        this.visibleGridW = Math.ceil(frame.state.config.width / TILE_SIZE);
        this.visibleGridH = Math.ceil(frame.state.config.height / TILE_SIZE);
    }

    private parseColor(style: string): THREE.Color {
        let color = this.colorCache.get(style);
        if (!color) {
            color = new THREE.Color(style);
            this.colorCache.set(style, color);
        }
        return color;
    }

    private viewBounds(frame: Scene3DFrame, marginPx: number, out: ViewBounds): void {
        const { camera, zoom, width, height } = frame;
        const margin = marginPx / zoom;
        out.left = camera.x - margin;
        out.right = camera.x + width / zoom + margin;
        out.top = camera.y - margin;
        // Things south of the view can still poke up into it
        out.bottom = camera.y + height / zoom + margin + 80;
    }

    // -----------------------------------------------------------------------------------------
    // Placement hologram
    // -----------------------------------------------------------------------------------------

    private updateGhost(frame: Scene3DFrame): void {
        const placement = frame.placement;
        if (!placement || !RULES.buildings[placement.key]) {
            this.ghost.visible = false;
            return;
        }
        if (this.ghostKey !== placement.key) {
            const def = getModelDef(placement.key);
            const body = def.parts.find(p => p.mode === 'body' && p.material === 'lit');
            this.ghost.geometry.dispose();
            this.ghost.geometry = body ? body.shape.realize(new THREE.Color(1, 1, 1)) : new THREE.BufferGeometry();
            this.ghostKey = placement.key;
        }
        const tint = placement.valid ? 0x44ff66 : 0xff4444;
        this.ghostMaterial.color.set(tint);
        this.ghostMaterial.emissive.set(tint).multiplyScalar(0.35);
        this.ghost.position.set(placement.x, 0.5, placement.y);
        this.ghost.visible = true;
    }
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Fireball size (world units) of each weapon's impact; splash damage can make it bigger. */
const IMPACT_SIZE: Record<string, number> = {
    cannon: 7,
    heavy_cannon: 10,
    shell: 14,
    rocket: 7,
    missile: 9,
    aa_missile: 9,
    air_missile: 11,
    grenade: 8,
    explosion: 26,
};

/** How hard firing rocks a vehicle's hull (radians per tick of pitch velocity). */
const CHASSIS_KICK: Record<string, number> = {
    cannon: 0.012,
    heavy_cannon: 0.018,
    shell: 0.022,
    missile: 0.004,
};

const SNIPER_TRACER = new THREE.Color(1, 0.95, 0.8);
const LASER_CORE = new THREE.Color(1, 0.85, 0.8);
const LASER_GLOW = new THREE.Color(0.85, 0.08, 0.04);
const DEBRIS_COLORS = [new THREE.Color(0x2d3034), new THREE.Color(0x585c63), new THREE.Color(0x1d1e20), new THREE.Color(0x878375)];

function rand(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/** Whole number of spawns for an expected (fractional) count, so low rates still fire now and then. */
function count(expected: number): number {
    return Math.floor(expected + Math.random());
}

/** Rate multiplier for ambient emitters into a particle layer: thins out as the layer fills. */
function ambientBudget(layer: ParticleLayer): number {
    return Math.max(0.25, 1 - layer.size / layer.capacity);
}

function clamp(value: number, limit: number): number {
    return Math.max(-limit, Math.min(limit, value));
}

function wrapAngle(angle: number): number {
    while (angle > Math.PI) angle -= Math.PI * 2;
    while (angle < -Math.PI) angle += Math.PI * 2;
    return angle;
}

/** Barrel recoil over the ticks since firing: slams back at once, then eases forward. */
function recoilKick(age: number): number {
    if (age < 0 || age > 40) return 0;
    return age <= 1 ? 1 : Math.exp(-(age - 1) / 6);
}

function isInfantryKey(key: string): boolean {
    return RULES.units[key]?.type === 'infantry';
}

function isFlyingUnit(entity: Entity): boolean {
    return RULES.units[entity.key]?.fly === true;
}

/** Ticks for a launcher to bring up its next missile after firing one. */
function reloadTicks(key: string): number {
    const rate = RULES.units[key]?.rate ?? RULES.buildings[key]?.rate ?? 30;
    return Math.max(6, Math.round(rate * 0.8));
}

/** Device pixel ratio for the WebGL canvas, capped at 2 to bound fill-rate cost. */
function scenePixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, 2);
}

/** Seamlessly tiling grass/dirt texture, drawn once. */
function makeGroundTexture(): THREE.Texture {
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#3d4f2d';
    ctx.fillRect(0, 0, size, size);

    let seed = 1337;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    const blot = (x: number, y: number, rx: number, ry: number, color: string) => {
        ctx.fillStyle = color;
        for (const ox of [-size, 0, size]) {
            for (const oy of [-size, 0, size]) {
                if (x + ox + rx < 0 || x + ox - rx > size || y + oy + ry < 0 || y + oy - ry > size) continue;
                ctx.beginPath();
                ctx.ellipse(x + ox, y + oy, rx, ry, 0, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    };

    // Broad patches of dry grass and dirt
    for (let i = 0; i < 26; i++) {
        const dirt = random() < 0.35;
        blot(random() * size, random() * size, 30 + random() * 70, 20 + random() * 50,
            dirt ? `rgba(104, 88, 58, ${0.18 + random() * 0.2})` : `rgba(80, 100, 52, ${0.2 + random() * 0.25})`);
    }
    // Fine speckle
    for (let i = 0; i < 5000; i++) {
        const shade = random();
        const color = shade < 0.5
            ? `rgba(${70 + random() * 30}, ${92 + random() * 30}, ${44 + random() * 20}, 0.55)`
            : shade < 0.85
                ? `rgba(${40 + random() * 20}, ${56 + random() * 20}, ${30 + random() * 14}, 0.5)`
                : `rgba(${110 + random() * 30}, ${100 + random() * 25}, ${70 + random() * 20}, 0.45)`;
        blot(random() * size, random() * size, 1 + random() * 2.5, 1 + random() * 2, color);
    }
    // Pebbles
    for (let i = 0; i < 90; i++) {
        blot(random() * size, random() * size, 1.5 + random() * 2, 1 + random() * 1.5, `rgba(150, 140, 120, ${0.4 + random() * 0.3})`);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

function hash2(x: number, y: number): number {
    const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return h - Math.floor(h);
}

function valueNoise(x: number, y: number): number {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(x0, y0), b = hash2(x0 + 1, y0), c = hash2(x0, y0 + 1), d = hash2(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

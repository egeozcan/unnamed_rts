import * as THREE from 'three';
import { fxRandom } from '../fx-random.js';
import { CAMERA_TILT_RAD } from './projection.js';

/**
 * Transient visual effects for the 3D view: billboard particles (fire, smoke, sparks, dust), flat ground
 * decals (scorch marks, blast glow, shockwaves), tumbling debris and energy beams.
 *
 * Everything is simulated in game ticks (so it freezes with the game) and drawn with one instanced draw
 * call per layer. Effects are purely cosmetic: they never feed back into the simulation.
 */

const VERTEX_SHADER = /* glsl */ `
uniform float uYScale;
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec2 iSizeRot;
varying vec2 vUv;
varying vec4 vColor;
void main() {
    vUv = position.xy + 0.5;
    vColor = iColor;
    float c = cos(iSizeRot.y);
    float s = sin(iSizeRot.y);
    vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iSizeRot.x;
#ifdef FLAT
    // Quad y -> world -z keeps the winding facing up (front side toward the camera)
    gl_Position = projectionMatrix * modelViewMatrix * vec4(iPos + vec3(corner.x, 0.0, -corner.y), 1.0);
#else
    // Billboard facing the camera; the view's vertical axis is stretched by 1/cos(tilt)
    vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
    mv.xy += vec2(corner.x, corner.y * uYScale);
    gl_Position = projectionMatrix * mv;
#endif
}`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
// No alpha discard: the layers are blended and never write depth, so a (near-)transparent fragment
// leaves the target as it was anyway, and discard would only disable early-z on the GPU.
void main() {
    gl_FragColor = vec4(vColor.rgb, vColor.a * texture2D(map, vUv).a);
}`;

export interface ParticleOptions {
    x: number;
    y: number;
    z: number;
    vx?: number;
    vy?: number;
    vz?: number;
    /** Lifetime in ticks. */
    life: number;
    size: number;
    /** Size at the end of life (defaults to `size`); grows with an ease-out curve. */
    endSize?: number;
    /** Start colour (0..1 sRGB). */
    r: number;
    g: number;
    b: number;
    /** End colour (defaults to the start colour). */
    r1?: number;
    g1?: number;
    b1?: number;
    alpha?: number;
    /** Fraction of the life spent fading in. */
    fadeIn?: number;
    /** Downward acceleration per tick (world units). Negative rises. */
    gravity?: number;
    /** Fraction of velocity lost per tick. */
    drag?: number;
    rotation?: number;
    spin?: number;
    /** Bounce off the ground instead of sinking into it. */
    bounce?: boolean;
}

const FIELDS = 22;
const enum F {
    X, Y, Z, VX, VY, VZ, AGE, LIFE, SIZE0, SIZE1, R0, G0, B0, R1, G1, B1, ALPHA, FADE_IN, GRAVITY, DRAG, ROT, SPIN
}

/** One instanced draw call of camera-facing (or ground-flat) textured quads. */
export class ParticleLayer {
    private readonly data: Float32Array;
    private readonly bounce: Uint8Array;
    private count = 0;
    private readonly mesh: THREE.Mesh;
    private readonly geometry: THREE.InstancedBufferGeometry;
    private readonly iPos: THREE.InstancedBufferAttribute;
    private readonly iColor: THREE.InstancedBufferAttribute;
    private readonly iSizeRot: THREE.InstancedBufferAttribute;
    private readonly attributes: readonly THREE.InstancedBufferAttribute[];

    constructor(
        scene: THREE.Scene,
        texture: THREE.Texture,
        options: { additive: boolean; flat?: boolean; capacity: number; renderOrder: number }
    ) {
        const { capacity } = options;
        this.data = new Float32Array(capacity * FIELDS);
        this.bounce = new Uint8Array(capacity);

        this.geometry = new THREE.InstancedBufferGeometry();
        const quad = new THREE.PlaneGeometry(1, 1);
        this.geometry.index = quad.index;
        this.geometry.setAttribute('position', quad.getAttribute('position'));
        this.iPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
        this.iColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
        this.iSizeRot = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
        this.geometry.setAttribute('iPos', this.iPos);
        this.geometry.setAttribute('iColor', this.iColor);
        this.geometry.setAttribute('iSizeRot', this.iSizeRot);
        this.attributes = [this.iPos, this.iColor, this.iSizeRot];
        this.geometry.instanceCount = 0;

        const material = new THREE.ShaderMaterial({
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            uniforms: {
                map: { value: texture },
                uYScale: { value: Math.cos(CAMERA_TILT_RAD) },
            },
            defines: options.flat ? { FLAT: '' } : {},
            transparent: true,
            depthWrite: false,
            blending: options.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        });
        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = options.renderOrder;
        scene.add(this.mesh);
    }

    get size(): number {
        return this.count;
    }

    get capacity(): number {
        return this.bounce.length;
    }

    spawn(p: ParticleOptions): void {
        let i = this.count;
        if (i >= this.capacity) {
            // Full: recycle a random slot rather than dropping the newest effect
            i = Math.floor(fxRandom() * this.capacity);
        } else {
            this.count++;
        }
        const d = this.data, o = i * FIELDS;
        d[o + F.X] = p.x; d[o + F.Y] = p.y; d[o + F.Z] = p.z;
        d[o + F.VX] = p.vx ?? 0; d[o + F.VY] = p.vy ?? 0; d[o + F.VZ] = p.vz ?? 0;
        d[o + F.AGE] = 0; d[o + F.LIFE] = Math.max(1, p.life);
        d[o + F.SIZE0] = p.size; d[o + F.SIZE1] = p.endSize ?? p.size;
        d[o + F.R0] = p.r; d[o + F.G0] = p.g; d[o + F.B0] = p.b;
        d[o + F.R1] = p.r1 ?? p.r; d[o + F.G1] = p.g1 ?? p.g; d[o + F.B1] = p.b1 ?? p.b;
        d[o + F.ALPHA] = p.alpha ?? 1; d[o + F.FADE_IN] = p.fadeIn ?? 0;
        d[o + F.GRAVITY] = p.gravity ?? 0; d[o + F.DRAG] = p.drag ?? 0;
        d[o + F.ROT] = p.rotation ?? fxRandom() * Math.PI * 2; d[o + F.SPIN] = p.spin ?? 0;
        this.bounce[i] = p.bounce ? 1 : 0;
    }

    /** Advances every particle by `dt` ticks and drops the expired ones. */
    update(dt: number): void {
        if (dt <= 0) return;
        const d = this.data;
        let i = 0;
        while (i < this.count) {
            const o = i * FIELDS;
            d[o + F.AGE] += dt;
            if (d[o + F.AGE] >= d[o + F.LIFE]) {
                this.removeAt(i);
                continue;
            }
            const keep = Math.pow(1 - d[o + F.DRAG], dt);
            d[o + F.VX] *= keep;
            d[o + F.VZ] *= keep;
            d[o + F.VY] = d[o + F.VY] * keep - d[o + F.GRAVITY] * dt;
            d[o + F.X] += d[o + F.VX] * dt;
            d[o + F.Y] += d[o + F.VY] * dt;
            d[o + F.Z] += d[o + F.VZ] * dt;
            if (d[o + F.Y] < 0.5 && d[o + F.GRAVITY] > 0) {
                d[o + F.Y] = 0.5;
                if (this.bounce[i] && d[o + F.VY] < -0.4) {
                    d[o + F.VY] *= -0.35;
                    d[o + F.VX] *= 0.5;
                    d[o + F.VZ] *= 0.5;
                } else {
                    d[o + F.VX] = d[o + F.VY] = d[o + F.VZ] = 0;
                }
            }
            d[o + F.ROT] += d[o + F.SPIN] * dt;
            i++;
        }
    }

    private removeAt(i: number): void {
        const last = --this.count;
        if (i !== last) {
            this.data.copyWithin(i * FIELDS, last * FIELDS, (last + 1) * FIELDS);
            this.bounce[i] = this.bounce[last];
        }
    }

    /** Writes the instance attributes. `visible` filters what is drawn (fog of war, off-screen). */
    sync(visible?: (x: number, z: number) => boolean): void {
        const d = this.data;
        const pos = this.iPos.array as Float32Array;
        const col = this.iColor.array as Float32Array;
        const sr = this.iSizeRot.array as Float32Array;
        let n = 0;
        for (let i = 0; i < this.count; i++) {
            const o = i * FIELDS;
            if (visible && !visible(d[o + F.X], d[o + F.Z])) continue;
            const t = d[o + F.AGE] / d[o + F.LIFE];
            const grow = 1 - (1 - t) * (1 - t);
            const fadeIn = d[o + F.FADE_IN];
            const fade = fadeIn > 0 && t < fadeIn ? t / fadeIn : 1 - Math.max(0, (t - fadeIn) / (1 - fadeIn));
            pos[n * 3] = d[o + F.X]; pos[n * 3 + 1] = d[o + F.Y]; pos[n * 3 + 2] = d[o + F.Z];
            col[n * 4] = d[o + F.R0] + (d[o + F.R1] - d[o + F.R0]) * t;
            col[n * 4 + 1] = d[o + F.G0] + (d[o + F.G1] - d[o + F.G0]) * t;
            col[n * 4 + 2] = d[o + F.B0] + (d[o + F.B1] - d[o + F.B0]) * t;
            col[n * 4 + 3] = d[o + F.ALPHA] * fade;
            sr[n * 2] = d[o + F.SIZE0] + (d[o + F.SIZE1] - d[o + F.SIZE0]) * grow;
            sr[n * 2 + 1] = d[o + F.ROT];
            n++;
        }
        this.geometry.instanceCount = n;
        this.mesh.visible = n > 0;
        if (n > 0) {
            for (const attribute of this.attributes) {
                attribute.clearUpdateRanges();
                attribute.addUpdateRange(0, n * attribute.itemSize);
                attribute.needsUpdate = true;
            }
        }
    }

    clear(): void {
        this.count = 0;
    }

    dispose(scene: THREE.Scene): void {
        scene.remove(this.mesh);
        this.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
    }
}

// ---------------------------------------------------------------------------------------------
// Debris and beams (instanced meshes simulated on the CPU)
// ---------------------------------------------------------------------------------------------

interface Chunk {
    x: number; y: number; z: number;
    vx: number; vy: number; vz: number;
    ax: number; ay: number; az: number;
    spin: number;
    angle: number;
    size: number;
    age: number;
    life: number;
    color: THREE.Color;
    resting: boolean;
}

/** Tumbling, bouncing hull fragments thrown out by destroyed vehicles and buildings. */
export class DebrisLayer {
    private readonly chunks: Chunk[] = [];
    private readonly mesh: THREE.InstancedMesh;
    private readonly matrix = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly axis = new THREE.Vector3();
    private readonly pos = new THREE.Vector3();
    private readonly scale = new THREE.Vector3();

    constructor(scene: THREE.Scene, material: THREE.Material, private readonly capacity = 400) {
        const geometry = new THREE.BoxGeometry(1, 0.6, 0.8);
        // The shared lit material multiplies by vertex colours: white lets the instance colour through
        const white = new Float32Array(geometry.getAttribute('position').count * 3).fill(1);
        geometry.setAttribute('color', new THREE.BufferAttribute(white, 3));
        this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        this.mesh.castShadow = true;
        this.mesh.frustumCulled = false;
        this.mesh.count = 0;
        scene.add(this.mesh);
    }

    spawn(x: number, y: number, z: number, speed: number, size: number, color: THREE.Color, life: number): void {
        if (this.chunks.length >= this.capacity) this.chunks.shift();
        const angle = fxRandom() * Math.PI * 2;
        const out = speed * (0.4 + fxRandom() * 0.6);
        this.chunks.push({
            x, y, z,
            vx: Math.cos(angle) * out, vy: speed * (0.8 + fxRandom() * 0.9), vz: Math.sin(angle) * out,
            ax: fxRandom() - 0.5, ay: fxRandom() - 0.5, az: fxRandom() - 0.5,
            spin: (fxRandom() - 0.5) * 0.6, angle: 0,
            size: size * (0.6 + fxRandom() * 0.8), age: 0, life: life * (0.7 + fxRandom() * 0.6),
            color, resting: false,
        });
    }

    update(dt: number): void {
        if (dt <= 0) return;
        for (let i = this.chunks.length - 1; i >= 0; i--) {
            const c = this.chunks[i];
            c.age += dt;
            if (c.age >= c.life) {
                this.chunks.splice(i, 1);
                continue;
            }
            if (c.resting) continue;
            for (let step = 0; step < dt; step++) {
                c.vy -= 0.12;
                c.x += c.vx; c.y += c.vy; c.z += c.vz;
                c.angle += c.spin;
                if (c.y <= c.size * 0.3) {
                    c.y = c.size * 0.3;
                    if (c.vy < -0.8) {
                        c.vy *= -0.3; c.vx *= 0.45; c.vz *= 0.45; c.spin *= 0.5;
                    } else {
                        c.resting = true;
                        break;
                    }
                }
            }
        }
    }

    sync(visible?: (x: number, z: number) => boolean): void {
        let n = 0;
        for (const c of this.chunks) {
            if (visible && !visible(c.x, c.z)) continue;
            // Shrink into the ground over the last quarter of their life
            const shrink = Math.min(1, (c.life - c.age) / (c.life * 0.25));
            this.axis.set(c.ax, c.ay, c.az).normalize();
            this.q.setFromAxisAngle(this.axis, c.angle);
            this.pos.set(c.x, c.y * shrink, c.z);
            this.scale.setScalar(c.size * shrink);
            this.matrix.compose(this.pos, this.q, this.scale);
            this.mesh.setMatrixAt(n, this.matrix);
            this.mesh.setColorAt(n, c.color);
            n++;
        }
        this.mesh.count = n;
        this.mesh.visible = n > 0;
        if (n > 0) {
            this.mesh.instanceMatrix.needsUpdate = true;
            this.mesh.instanceColor!.needsUpdate = true;
        }
    }

    clear(): void {
        this.chunks.length = 0;
    }

    dispose(scene: THREE.Scene): void {
        scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        this.mesh.dispose();
    }
}

interface Beam {
    ax: number; ay: number; az: number;
    bx: number; by: number; bz: number;
    width: number;
    color: THREE.Color;
    age: number;
    life: number;
}

/** Short-lived glowing segments: the Obelisk's laser, sniper and machine-gun tracers. */
export class BeamLayer {
    private readonly beams: Beam[] = [];
    private readonly mesh: THREE.InstancedMesh;
    private readonly matrix = new THREE.Matrix4();
    private readonly q = new THREE.Quaternion();
    private readonly from = new THREE.Vector3(1, 0, 0);
    private readonly dir = new THREE.Vector3();
    private readonly pos = new THREE.Vector3();
    private readonly scale = new THREE.Vector3();
    private readonly color = new THREE.Color();

    constructor(scene: THREE.Scene, private readonly capacity = 128) {
        // Unit-length beam along +X with a soft round cross-section
        const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1, true);
        geometry.rotateZ(-Math.PI / 2);
        geometry.translate(0.5, 0, 0);
        const material = new THREE.MeshBasicMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        });
        this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 5;
        this.mesh.count = 0;
        scene.add(this.mesh);
    }

    spawn(a: THREE.Vector3, b: THREE.Vector3, width: number, color: THREE.Color, life: number): void {
        if (this.beams.length >= this.capacity) this.beams.shift();
        this.beams.push({ ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, width, color, age: 0, life });
    }

    update(dt: number): void {
        for (let i = this.beams.length - 1; i >= 0; i--) {
            this.beams[i].age += dt;
            if (this.beams[i].age >= this.beams[i].life) this.beams.splice(i, 1);
        }
    }

    sync(): void {
        let n = 0;
        for (const beam of this.beams) {
            const t = beam.age / beam.life;
            const fade = 1 - t * t;
            this.dir.set(beam.bx - beam.ax, beam.by - beam.ay, beam.bz - beam.az);
            const length = this.dir.length();
            if (length < 0.01) continue;
            this.q.setFromUnitVectors(this.from, this.dir.divideScalar(length));
            this.pos.set(beam.ax, beam.ay, beam.az);
            this.scale.set(length, beam.width * (0.6 + 0.4 * fade), beam.width * (0.6 + 0.4 * fade));
            this.matrix.compose(this.pos, this.q, this.scale);
            this.mesh.setMatrixAt(n, this.matrix);
            // Additive: fading to black fades the beam out
            this.mesh.setColorAt(n, this.color.copy(beam.color).multiplyScalar(fade));
            n++;
        }
        this.mesh.count = n;
        this.mesh.visible = n > 0;
        if (n > 0) {
            this.mesh.instanceMatrix.needsUpdate = true;
            this.mesh.instanceColor!.needsUpdate = true;
        }
    }

    clear(): void {
        this.beams.length = 0;
    }

    dispose(scene: THREE.Scene): void {
        scene.remove(this.mesh);
        this.mesh.geometry.dispose();
        (this.mesh.material as THREE.Material).dispose();
        this.mesh.dispose();
    }
}

// ---------------------------------------------------------------------------------------------
// Textures
// ---------------------------------------------------------------------------------------------

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    draw(ctx, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.NoColorSpace;
    return texture;
}

function radial(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, number][]): void {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [at, alpha] of stops) gradient.addColorStop(at, `rgba(255,255,255,${alpha})`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
}

/** Bright core with a soft falloff: fire, flashes, sparks, glows. */
export function makeGlowTexture(): THREE.Texture {
    return canvasTexture(64, (ctx, s) => radial(ctx, s / 2, s / 2, s / 2, [[0, 1], [0.25, 0.85], [0.6, 0.25], [1, 0]]));
}

/** Lumpy soft puff: smoke, dust, steam. */
export function makePuffTexture(): THREE.Texture {
    return canvasTexture(64, (ctx, s) => {
        let seed = 7;
        const random = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        radial(ctx, s / 2, s / 2, s * 0.42, [[0, 0.7], [0.6, 0.45], [1, 0]]);
        for (let i = 0; i < 7; i++) {
            const a = random() * Math.PI * 2, d = random() * s * 0.16;
            radial(ctx, s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.16 + random() * 0.14), [[0, 0.5], [1, 0]]);
        }
    });
}

/** Thin bright ring: blast shockwaves. */
export function makeRingTexture(): THREE.Texture {
    return canvasTexture(128, (ctx, s) => {
        const gradient = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        gradient.addColorStop(0, 'rgba(255,255,255,0)');
        gradient.addColorStop(0.72, 'rgba(255,255,255,0)');
        gradient.addColorStop(0.88, 'rgba(255,255,255,0.9)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, s, s);
    });
}

/** Irregular soft blotch: scorch marks and craters. */
export function makeScorchTexture(): THREE.Texture {
    return canvasTexture(128, (ctx, s) => {
        let seed = 99;
        const random = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };
        radial(ctx, s / 2, s / 2, s * 0.36, [[0, 0.95], [0.55, 0.7], [1, 0]]);
        for (let i = 0; i < 14; i++) {
            const a = random() * Math.PI * 2, d = s * (0.14 + random() * 0.2);
            radial(ctx, s / 2 + Math.cos(a) * d, s / 2 + Math.sin(a) * d, s * (0.05 + random() * 0.1), [[0, 0.6], [1, 0]]);
        }
    });
}

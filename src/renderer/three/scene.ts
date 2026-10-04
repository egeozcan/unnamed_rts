import * as THREE from 'three';
import { type Entity, type GameState, PLAYER_COLORS, type Projectile, TILE_SIZE } from '../../engine/types.js';
import { RULES } from '../../data/schemas/index.js';
import { isAirUnit } from '../../engine/entity-helpers.js';
import { isBuilding, isUnit } from '../../engine/type-guards.js';
import { getModelDef, type ModelDef, ROCK_VARIANTS } from './models.js';
import { AIRBASE_PAD_HEIGHT, AIRBASE_SLOT_OFFSETS, getAltitude, getModelHeight } from './projection.js';
import { applyViewCamera, CAMERA_DISTANCE } from './camera.js';

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

// ---------------------------------------------------------------------------------------------
// Instanced batching
// ---------------------------------------------------------------------------------------------

/**
 * One InstancedMesh per (model, owner, part). Instances are rewritten from scratch every frame,
 * mirroring the immediate-mode 2D renderer: no per-entity scene graph to keep in sync.
 */
class InstanceBucket {
    mesh: THREE.InstancedMesh;
    private count = 0;
    private capacity: number;

    constructor(
        private readonly scene: THREE.Scene,
        private readonly geometry: THREE.BufferGeometry,
        private readonly material: THREE.Material,
        private readonly castShadow: boolean,
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
        return mesh;
    }

    reset(): void {
        this.count = 0;
    }

    push(matrix: THREE.Matrix4, r = 1, g = 1, b = 1): void {
        if (this.count >= this.capacity) this.grow();
        const i = this.count++;
        matrix.toArray(this.mesh.instanceMatrix.array, i * 16);
        const colors = this.mesh.instanceColor!.array as Float32Array;
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
    }

    finish(): void {
        this.mesh.count = this.count;
        this.mesh.visible = this.count > 0;
        if (this.count > 0) {
            this.mesh.instanceMatrix.clearUpdateRanges();
            this.mesh.instanceMatrix.addUpdateRange(0, this.count * 16);
            this.mesh.instanceMatrix.needsUpdate = true;
            this.mesh.instanceColor!.clearUpdateRanges();
            this.mesh.instanceColor!.addUpdateRange(0, this.count * 3);
            this.mesh.instanceColor!.needsUpdate = true;
        }
    }

    private grow(): void {
        const old = this.mesh;
        this.capacity *= 2;
        this.mesh = this.createMesh(this.capacity);
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

    /** key -> owner slot (owner + 1) -> buckets per part */
    private readonly models = new Map<string, (ModelBuckets | undefined)[]>();
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

    private readonly fireParticles: THREE.Points;
    private readonly smokeParticles: THREE.Points;

    private readonly ghost: THREE.Mesh;
    private readonly ghostMaterial = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.6, depthWrite: false });
    private ghostKey = '';

    private readonly colorCache = new Map<string, THREE.Color>();
    private readonly hashCache = new Map<string, number>();

    // Scratch objects
    private readonly mBody = new THREE.Matrix4();
    private readonly mLocal = new THREE.Matrix4();
    private readonly mOut = new THREE.Matrix4();
    private readonly vPos = new THREE.Vector3();
    private readonly vScale = new THREE.Vector3();
    private readonly qRot = new THREE.Quaternion();
    private readonly yAxis = new THREE.Vector3(0, 1, 0);
    private readonly euler = new THREE.Euler(0, 0, 0, 'YZX');

    constructor(container: HTMLElement, before: Element) {
        this.canvas = document.createElement('canvas');
        this.canvas.id = 'gameCanvas3d';
        container.insertBefore(this.canvas, before);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(scenePixelRatio());
        this.renderer.setClearColor(0x14180f);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;

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

        // Explosion particles
        const dot = makeSoftDotTexture();
        this.fireParticles = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
            vertexColors: true, map: dot, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false
        }));
        this.smokeParticles = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({
            vertexColors: true, map: dot, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: false
        }));
        this.fireParticles.frustumCulled = false;
        this.smokeParticles.frustumCulled = false;
        this.fireParticles.renderOrder = 3;
        this.smokeParticles.renderOrder = 2;
        this.scene.add(this.fireParticles, this.smokeParticles);

        // Building placement hologram
        this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), this.ghostMaterial);
        this.ghost.visible = false;
        this.ghost.renderOrder = 4;
        this.scene.add(this.ghost);

        this.createProjectileBuckets();
    }

    setSize(width: number, height: number): void {
        // Browser zoom or moving the window to another monitor changes the DPR mid-game
        const pixelRatio = scenePixelRatio();
        if (this.renderer.getPixelRatio() !== pixelRatio) this.renderer.setPixelRatio(pixelRatio);
        this.renderer.setSize(width, height, false);
        this.canvas.style.width = `${width}px`;
        this.canvas.style.height = `${height}px`;
    }

    render(frame: Scene3DFrame): void {
        const { state, zoom, width, height, camera } = frame;
        if (width <= 0 || height <= 0) return;

        const pixelRatio = scenePixelRatio();
        if (this.renderer.getPixelRatio() !== pixelRatio ||
            this.canvas.width !== Math.floor(width * pixelRatio) ||
            this.canvas.height !== Math.floor(height * pixelRatio)) {
            this.setSize(width, height);
        }

        this.ensureGround(state.config.width, state.config.height);
        this.updateFog(frame);
        this.updateCamera(camera, zoom, width, height);

        for (const bucket of this.allBuckets) bucket.reset();
        for (const entity of frame.entities) this.addEntity(entity, state);
        this.addProjectiles(frame);
        for (const bucket of this.allBuckets) bucket.finish();

        this.updateParticles(frame);
        this.updateGhost(frame);

        this.renderer.render(this.scene, this.camera);
    }

    dispose(): void {
        for (const bucket of this.allBuckets) bucket.dispose();
        for (const geometry of this.geometries) geometry.dispose();
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
        for (const sx of [-1, 1]) {
            for (const sz of [-1, 1]) {
                for (const y of [0, MAX_CASTER_HEIGHT]) {
                    corner.set(cx + sx * (halfW + margin), y, cz + sz * (halfH + margin));
                    corner.applyMatrix4(shadowCamera.matrixWorldInverse);
                    minX = Math.min(minX, corner.x); maxX = Math.max(maxX, corner.x);
                    minY = Math.min(minY, corner.y); maxY = Math.max(maxY, corner.y);
                }
            }
        }
        shadowCamera.left = minX;
        shadowCamera.right = maxX;
        shadowCamera.bottom = minY;
        shadowCamera.top = maxY;
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

    private getModelBuckets(key: string, owner: number): ModelBuckets {
        let byOwner = this.models.get(key);
        if (!byOwner) {
            byOwner = [];
            this.models.set(key, byOwner);
        }
        const slot = owner + 1;
        let entry = byOwner[slot];
        if (!entry) {
            const def = getModelDef(key);
            const team = new THREE.Color(owner >= 0 ? (PLAYER_COLORS[owner] ?? '#888888') : NEUTRAL_COLOR);
            const buckets = def.parts.map(part => {
                const geometry = part.shape.realize(team);
                this.geometries.push(geometry);
                const isGlow = part.material === 'glow';
                const bucket = new InstanceBucket(this.scene, geometry, isGlow ? this.glowMaterial : this.litMaterial, !isGlow);
                this.allBuckets.push(bucket);
                return bucket;
            });
            entry = { def, buckets };
            byOwner[slot] = entry;
        }
        return entry;
    }

    /** Writes every part of a model for one instance. `bodyMatrix` places the model origin. */
    private pushModel(entry: ModelBuckets, bodyMatrix: THREE.Matrix4, bodyYaw: number, aimYaw: number, spinPhase: number, tint: number, tintG = tint, tintB = tint): void {
        const { def, buckets } = entry;
        for (let i = 0; i < def.parts.length; i++) {
            const part = def.parts[i];
            let matrix = bodyMatrix;
            if (part.mode !== 'body' && part.pivot) {
                const angle = part.mode === 'turret' ? aimYaw - bodyYaw : spinPhase * (part.spinSpeed ?? 0);
                this.mLocal.makeRotationY(angle);
                this.mLocal.setPosition(part.pivot[0], part.pivot[1], part.pivot[2]);
                matrix = this.mOut.multiplyMatrices(bodyMatrix, this.mLocal);
            }
            buckets[i].push(matrix, tint, tintG, tintB);
        }
    }

    private addEntity(entity: Entity, state: GameState): void {
        // Docked harriers are drawn parked on their Air-Force Command instead
        if (isAirUnit(entity) && entity.airUnit.state === 'docked') return;

        const hash = this.hashId(entity.id);
        let key: string = entity.key;
        let yaw = 0;
        let scale = 1;
        let scaleY = 1;

        switch (entity.type) {
            case 'ROCK':
                // Rock and well models are authored at unit radius
                key = `rock_${hash % ROCK_VARIANTS}`;
                yaw = (hash % 628) / 100;
                scale = scaleY = entity.radius;
                break;
            case 'WELL':
                key = entity.well.isBlocked ? 'well_blocked' : 'well_active';
                scale = scaleY = entity.radius;
                if (!entity.well.isBlocked) {
                    scale *= 1 + Math.sin(((state.tick % 60) / 60) * Math.PI * 2) * 0.05;
                }
                break;
            case 'RESOURCE':
                // Ore piles shrink as they are mined out
                key = 'ore';
                yaw = (hash % 628) / 100;
                scale = scaleY = 0.5 + 0.5 * Math.sqrt(Math.max(0, entity.hp / entity.maxHp));
                break;
            case 'UNIT':
                // Sim angles are measured with +y pointing south; three.js yaw turns the other way
                yaw = -entity.movement.rotation;
                break;
            case 'BUILDING':
                // Buildings are drawn unrotated at their authored size
                break;
        }

        const altitude = getAltitude(entity);
        this.vPos.set(entity.pos.x, altitude, entity.pos.y);
        this.qRot.setFromAxisAngle(this.yAxis, yaw);
        this.vScale.set(scale, scaleY, scale);
        this.mBody.compose(this.vPos, this.qRot, this.vScale);

        const combat = isUnit(entity) || isBuilding(entity) ? entity.combat : undefined;
        const flash = (combat?.flash ?? 0) > 0 ? FLASH_TINT : 1;

        let aimYaw = yaw;
        if (combat) {
            aimYaw = -(entity.type === 'BUILDING' ? combat.turretAngle - BUILDING_TURRET_OFFSET : combat.turretAngle);
        }

        const entry = this.getModelBuckets(key, entity.owner);
        this.pushModel(entry, this.mBody, yaw, aimYaw, state.tick + (hash % 97), flash);

        if (entity.type === 'BUILDING' && entity.key === 'airforce_command' && isBuilding(entity) && entity.airBase) {
            this.addParkedHarriers(entity, state);
        }
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
            const entry = this.getModelBuckets('harrier', harrier.owner);
            if (reloading) this.pushModel(entry, this.mBody, yaw, yaw, 0, 1.6, 0.55, 0.55);
            else this.pushModel(entry, this.mBody, yaw, yaw, 0, 1);
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
            const bucket = new InstanceBucket(this.scene, geometry, glow ? this.glowMaterial : this.litMaterial, !glow, 64);
            this.allBuckets.push(bucket);
            this.projectileBuckets.set(name, bucket);
        };
        const along = (geometry: THREE.BufferGeometry) => geometry.rotateZ(-Math.PI / 2); // +Y -> +X

        make('hitscan', new THREE.BoxGeometry(9, 0.9, 0.9).translate(-4.5, 0, 0), 0xffee55, true);
        make('rocket', new THREE.SphereGeometry(2, 8, 6).scale(2.2, 1, 1), 0xff6a2a, true);
        make('artillery', new THREE.SphereGeometry(3, 8, 6), 0x3c3c3c, false);
        make('missile', along(new THREE.ConeGeometry(2, 9, 8)), 0xf4f4f4, true);
        make('ballistic', new THREE.SphereGeometry(2, 8, 6).scale(1.5, 1, 1), 0xb08a55, false);
        make('grenade', new THREE.SphereGeometry(2.4, 8, 6), 0x3d5e35, false);
        make('heal', new THREE.SphereGeometry(1.8, 8, 6), 0x55ff66, true);
        make('default', new THREE.SphereGeometry(1.6, 8, 6), 0xffee55, true);
    }

    /** Launch / impact heights and arc of a projectile at ground-progress `p` (0..1). */
    private projectileHeight(proj: Projectile, p: number, startHeight: number, endHeight: number): number {
        return startHeight + (endHeight - startHeight) * p + proj.arcHeight * 4 * p * (1 - p);
    }

    private addProjectiles(frame: Scene3DFrame): void {
        const { state, fogGrid } = frame;
        const entities = state.entities;
        const gridW = Math.ceil(state.config.width / TILE_SIZE);
        const view = this.viewBounds(frame, 200);

        let segmentCount = 0;
        for (const proj of state.projectiles) {
            if (proj.dead) continue;
            const { x, y } = proj.pos;
            if (x < view.left || x > view.right || y < view.top || y > view.bottom) continue;
            if (fogGrid && fogGrid[Math.floor(y / TILE_SIZE) * gridW + Math.floor(x / TILE_SIZE)] === 0) continue;
            segmentCount += Math.max(0, proj.trailPoints.length - 1);
        }
        this.ensureTrailCapacity(segmentCount);

        let segment = 0;
        for (const proj of state.projectiles) {
            if (proj.dead) continue;
            const { x, y } = proj.pos;
            if (x < view.left || x > view.right || y < view.top || y > view.bottom) continue;
            if (fogGrid && fogGrid[Math.floor(y / TILE_SIZE) * gridW + Math.floor(x / TILE_SIZE)] === 0) continue;

            const shooter = entities[proj.ownerId];
            const target = entities[proj.targetId];
            const startHeight = shooter ? getAltitude(shooter) + Math.min(getModelHeight(shooter) * 0.6, 14) : 10;
            const endHeight = target ? getAltitude(target) + Math.min(getModelHeight(target) * 0.5, 12) : 4;
            // Non-homing shots fly at their aim point, not where the target has moved to
            const targetPos = (proj.archetype !== 'missile' && proj.targetPos) || target?.pos || proj.pos;
            const totalDist = proj.startPos.dist(targetPos);
            const progress = totalDist > 0 ? Math.min(1, proj.startPos.dist(proj.pos) / totalDist) : 0;
            const height = this.projectileHeight(proj, progress, startHeight, endHeight);

            // Orient along the flight path, including the climb/dive of arcing shots
            const yaw = -Math.atan2(proj.vel.y, proj.vel.x);
            const dhdp = (endHeight - startHeight) + proj.arcHeight * 4 * (1 - 2 * progress);
            const pitch = totalDist > 0 ? Math.atan2(dhdp, totalDist) : 0;
            this.euler.set(0, yaw, pitch);
            this.qRot.setFromEuler(this.euler);
            this.vPos.set(x, height, y);
            this.vScale.setScalar(1);
            this.mBody.compose(this.vPos, this.qRot, this.vScale);

            const bucketName = proj.type === 'heal' ? 'heal' : (this.projectileBuckets.has(proj.archetype) ? proj.archetype : 'default');
            this.projectileBuckets.get(bucketName)!.push(this.mBody);

            // Trail
            const points = proj.trailPoints;
            const n = points.length;
            for (let i = 1; i < n; i++) {
                const a = points[i - 1], b = points[i];
                const pa = totalDist > 0 ? Math.min(1, proj.startPos.dist(a) / totalDist) : 0;
                const pb = totalDist > 0 ? Math.min(1, proj.startPos.dist(b) / totalDist) : 0;
                const o = segment * 6;
                this.trailPositions[o] = a.x;
                this.trailPositions[o + 1] = this.projectileHeight(proj, pa, startHeight, endHeight);
                this.trailPositions[o + 2] = a.y;
                this.trailPositions[o + 3] = b.x;
                this.trailPositions[o + 4] = this.projectileHeight(proj, pb, startHeight, endHeight);
                this.trailPositions[o + 5] = b.y;
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
        (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
        (geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
        this.trails.visible = segment > 0;
    }

    private ensureTrailCapacity(segments: number): void {
        if (this.trailPositions.length >= segments * 6 && this.trailPositions.length > 0) return;
        const capacity = Math.max(256, segments * 2);
        this.trailPositions = new Float32Array(capacity * 6);
        this.trailColors = new Float32Array(capacity * 8);
        const geometry = this.trails.geometry;
        geometry.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 4).setUsage(THREE.DynamicDrawUsage));
    }

    // -----------------------------------------------------------------------------------------
    // Particles
    // -----------------------------------------------------------------------------------------

    private updateParticles(frame: Scene3DFrame): void {
        const { state, fogGrid, zoom } = frame;
        const gridW = Math.ceil(state.config.width / TILE_SIZE);
        const view = this.viewBounds(frame, 100);

        let fire = 0, smoke = 0;
        for (const p of state.particles) {
            if (p.text) continue;
            if (p.color === '#666666') smoke++; else fire++;
        }
        const fireGeometry = ensurePointCapacity(this.fireParticles.geometry, fire);
        const smokeGeometry = ensurePointCapacity(this.smokeParticles.geometry, smoke);
        const firePos = fireGeometry.getAttribute('position').array as Float32Array;
        const fireCol = fireGeometry.getAttribute('color').array as Float32Array;
        const smokePos = smokeGeometry.getAttribute('position').array as Float32Array;
        const smokeCol = smokeGeometry.getAttribute('color').array as Float32Array;

        fire = 0;
        smoke = 0;
        for (const p of state.particles) {
            if (p.text) continue; // floating text is drawn by the 2D overlay
            const { x, y } = p.pos;
            if (x < view.left || x > view.right || y < view.top || y > view.bottom) continue;
            if (fogGrid && fogGrid[Math.floor(y / TILE_SIZE) * gridW + Math.floor(x / TILE_SIZE)] === 0) continue;
            const color = this.parseColor(p.color);
            if (p.color === '#666666') {
                const o = smoke * 3;
                smokePos[o] = x; smokePos[o + 1] = 10 + Math.max(0, 50 - p.life) * 0.7; smokePos[o + 2] = y;
                smokeCol[o] = color.r; smokeCol[o + 1] = color.g; smokeCol[o + 2] = color.b;
                smoke++;
            } else {
                const o = fire * 3;
                firePos[o] = x; firePos[o + 1] = 4 + Math.max(0, 40 - p.life) * 0.25; firePos[o + 2] = y;
                fireCol[o] = color.r; fireCol[o + 1] = color.g; fireCol[o + 2] = color.b;
                fire++;
            }
        }
        finishPoints(this.fireParticles, fire, 7 * zoom);
        finishPoints(this.smokeParticles, smoke, 10 * zoom);
    }

    private parseColor(style: string): THREE.Color {
        let color = this.colorCache.get(style);
        if (!color) {
            color = new THREE.Color(style);
            this.colorCache.set(style, color);
        }
        return color;
    }

    private viewBounds(frame: Scene3DFrame, marginPx: number): { left: number; right: number; top: number; bottom: number } {
        const { camera, zoom, width, height } = frame;
        const margin = marginPx / zoom;
        return {
            left: camera.x - margin,
            right: camera.x + width / zoom + margin,
            top: camera.y - margin,
            // Things south of the view can still poke up into it
            bottom: camera.y + height / zoom + margin + 80,
        };
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

/** Device pixel ratio for the WebGL canvas, capped at 2 to bound fill-rate cost. */
function scenePixelRatio(): number {
    return Math.min(window.devicePixelRatio || 1, 2);
}

function ensurePointCapacity(geometry: THREE.BufferGeometry, count: number): THREE.BufferGeometry {
    const existing = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (!existing || existing.count < count) {
        const capacity = Math.max(256, count * 2);
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage));
    }
    return geometry;
}

function finishPoints(points: THREE.Points, count: number, size: number): void {
    const geometry = points.geometry;
    geometry.setDrawRange(0, count);
    (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
    (points.material as THREE.PointsMaterial).size = Math.max(2, size);
    points.visible = count > 0;
}

function makeSoftDotTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.4, 'rgba(255,255,255,0.75)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
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

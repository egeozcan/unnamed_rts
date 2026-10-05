import * as THREE from 'three';
import { RULES } from '../../data/schemas/index.js';
import { PLAYER_COLORS } from '../../engine/types.js';
import { getModelDef } from '../../renderer/three/models.js';
import { CAMERA_TILT_RAD } from '../../renderer/three/projection.js';
import { buildings } from '../../renderer/assets_data/buildings';
import { vehicles } from '../../renderer/assets_data/vehicles';
import { infantry } from '../../renderer/assets_data/infantry';
import { defenses } from '../../renderer/assets_data/defenses';
import { misc } from '../../renderer/assets_data/misc';
import { turrets } from '../../renderer/assets_data/turrets';

/** Page-side half of docs_render: draws 3D model renders and flattened 2D sprites for the docs site. */

const SIZE = 512;
const svgs: Record<string, string> = { ...buildings, ...vehicles, ...infantry, ...defenses, ...misc, ...turrets };
const TEAM = new THREE.Color(PLAYER_COLORS[0]);
/** Heading of the model on screen: turned so the camera sees front, side and top. */
const YAW = -Math.PI / 4;

const canvas = document.getElementById('c') as HTMLCanvasElement;
canvas.width = SIZE;
canvas.height = SIZE;
const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setSize(SIZE, SIZE, false);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

function buildScene(key: string): { scene: THREE.Scene; box: THREE.Box3 } {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    const lit = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 });
    const glow = new THREE.MeshBasicMaterial({ vertexColors: true });
    for (const p of getModelDef(key).parts) {
        // Rotors and blinkers are drawn at rest; blinking lights are shown lit
        const mesh = new THREE.Mesh(p.shape.realize(TEAM), p.material === 'glow' ? glow : lit);
        mesh.castShadow = p.material === 'lit';
        mesh.receiveShadow = p.material === 'lit';
        group.add(mesh);
    }
    group.rotation.y = YAW;
    scene.add(group);
    scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x5a5648, 1.05));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    sun.position.set(-200, 400, 150);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.bias = -0.0008;
    const box = new THREE.Box3().setFromObject(group);
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length();
    sun.target.position.copy(c);
    const cam = sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 1; cam.far = 1500;
    scene.add(sun, sun.target);
    // Soft ground shadow catcher
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(r * 4, r * 4), new THREE.ShadowMaterial({ opacity: 0.35 }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.05;
    shadow.receiveShadow = true;
    scene.add(shadow);
    return { scene, box };
}

function render3d(key: string): string {
    const { scene, box } = buildScene(key);
    // Same tilt as the in-game camera, fitted tightly around the model
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 5000);
    const dir = new THREE.Vector3(0, Math.cos(CAMERA_TILT_RAD), Math.sin(CAMERA_TILT_RAD));
    const centre = box.getCenter(new THREE.Vector3());
    camera.position.copy(centre).addScaledVector(dir, 1500);
    camera.up.set(0, Math.sin(CAMERA_TILT_RAD), -Math.cos(CAMERA_TILT_RAD));
    camera.lookAt(centre);
    camera.updateMatrixWorld();
    const inv = camera.matrixWorldInverse;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
        const p = new THREE.Vector3(x, y, z).applyMatrix4(inv);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    const half = Math.max(maxX - minX, maxY - minY) / 2 * 1.12;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    camera.left = cx - half; camera.right = cx + half; camera.top = cy + half; camera.bottom = cy - half;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return canvas.toDataURL('image/png');
}

function loadSvg(svg: string): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(new Blob([svg.replace(/COL_PRIMARY/g, PLAYER_COLORS[0])], { type: 'image/svg+xml' }));
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('svg failed to load'));
        img.src = url;
    });
}

/** Body sprite plus its turret overlay (when it has one), pointing right like in game. */
async function render2d(key: string): Promise<string | null> {
    if (!svgs[key]) return null;
    const out = document.createElement('canvas');
    out.width = SIZE;
    out.height = SIZE;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(await loadSvg(svgs[key]), 0, 0, SIZE, SIZE);
    if (svgs[key + '_turret']) ctx.drawImage(await loadSvg(svgs[key + '_turret']), 0, 0, SIZE, SIZE);
    return out.toDataURL('image/png');
}

export interface RenderResult { three: string | null; flat: string | null }

async function renderAll(): Promise<Record<string, RenderResult>> {
    const result: Record<string, RenderResult> = {};
    for (const key of [...Object.keys(RULES.units), ...Object.keys(RULES.buildings)]) {
        result[key] = { three: render3d(key), flat: await render2d(key) };
    }
    return result;
}

(window as unknown as { renderAll: typeof renderAll }).renderAll = renderAll;

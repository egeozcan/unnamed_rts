import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { applyViewCamera } from '../../src/renderer/three/camera';
import { AIR_ALTITUDE, HEIGHT_TO_SCREEN, getAltitude, getModelHeight, heightToScreenLift } from '../../src/renderer/three/projection';
import { getModelDef, hasCustomModel } from '../../src/renderer/three/models';
import { GRAPHICS_MODE_STORAGE_KEY, loadGraphicsMode, saveGraphicsMode } from '../../src/renderer/graphics-mode';
import { RULES } from '../../src/data/schemas/index';
import { createTestBuilding, createTestCombatUnit, createTestHarrier } from '../../src/engine/test-utils';

type CombatUnitKey = NonNullable<Parameters<typeof createTestCombatUnit>[0]>['key'];
type BuildingKey = NonNullable<Parameters<typeof createTestBuilding>[0]>['key'];

const WIDTH = 1300;
const HEIGHT = 900;

function toScreen(camera: THREE.OrthographicCamera, x: number, height: number, y: number) {
    const ndc = new THREE.Vector3(x, height, y).project(camera);
    return { x: ((ndc.x + 1) / 2) * WIDTH, y: ((1 - ndc.y) / 2) * HEIGHT, depth: ndc.z };
}

function modelBounds(key: string): THREE.Box3 {
    const bounds = new THREE.Box3();
    for (const part of getModelDef(key).parts) {
        const geometry = part.shape.realize(new THREE.Color(0.2, 0.4, 1));
        geometry.computeBoundingBox();
        const box = geometry.boundingBox!.clone();
        if (part.pivot) box.translate(new THREE.Vector3(...part.pivot));
        bounds.union(box);
        geometry.dispose();
    }
    return bounds;
}

describe('3D view camera', () => {
    const views = [
        { camera: { x: 0, y: 0 }, zoom: 1 },
        { camera: { x: 350, y: -80 }, zoom: 0.25 },
        { camera: { x: 1234.5, y: 987.25 }, zoom: 1.7 },
    ];

    it.each(views)('maps ground points to the same pixels as the 2D renderer (%o)', ({ camera, zoom }) => {
        const threeCamera = new THREE.OrthographicCamera();
        applyViewCamera(threeCamera, camera, zoom, WIDTH, HEIGHT);

        for (const [wx, wy] of [[camera.x, camera.y], [camera.x + 400, camera.y + 300], [camera.x + 1000, camera.y + 50], [2500, 1800]]) {
            const screen = toScreen(threeCamera, wx, 0, wy);
            expect(screen.x).toBeCloseTo((wx - camera.x) * zoom, 6);
            expect(screen.y).toBeCloseTo((wy - camera.y) * zoom, 6);
        }
    });

    it.each(views)('draws height as an upward offset of h * tan(tilt) * zoom (%o)', ({ camera, zoom }) => {
        const threeCamera = new THREE.OrthographicCamera();
        applyViewCamera(threeCamera, camera, zoom, WIDTH, HEIGHT);

        const wx = camera.x + 300, wy = camera.y + 200;
        const ground = toScreen(threeCamera, wx, 0, wy);
        const raised = toScreen(threeCamera, wx, 40, wy);
        expect(raised.x).toBeCloseTo(ground.x, 6);
        expect(ground.y - raised.y).toBeCloseTo(40 * HEIGHT_TO_SCREEN * zoom, 6);
        expect(heightToScreenLift(40, zoom)).toBeCloseTo(ground.y - raised.y, 6);
        // Taller things are nearer the camera, so they correctly occlude what is behind them
        expect(raised.depth).toBeLessThan(ground.depth);
    });

    it.each([0.25, 0.05])('keeps the whole visible ground and anything up to 100 units tall inside the depth range (zoom %s)', (zoom) => {
        const threeCamera = new THREE.OrthographicCamera();
        const camera = { x: 100, y: 100 };
        applyViewCamera(threeCamera, camera, zoom, WIDTH, HEIGHT);
        for (const [sx, sy] of [[0, 0], [WIDTH, 0], [0, HEIGHT], [WIDTH, HEIGHT]]) {
            for (const height of [0, 100]) {
                const { depth } = toScreen(threeCamera, camera.x + sx / zoom, height, camera.y + sy / zoom);
                expect(depth).toBeGreaterThan(-1);
                expect(depth).toBeLessThan(1);
            }
        }
    });
});

describe('3D models', () => {
    const unitKeys = Object.keys(RULES.units);
    const buildingKeys = Object.keys(RULES.buildings);

    it('has a hand-made model for every unit and building in rules.json', () => {
        expect([...unitKeys, ...buildingKeys].filter(key => !hasCustomModel(key))).toEqual([]);
    });

    it.each([...unitKeys, ...buildingKeys])('%s realises to flat-shaded, vertex-coloured geometry', key => {
        for (const part of getModelDef(key).parts) {
            const geometry = part.shape.realize(new THREE.Color(1, 0, 0));
            const positions = geometry.getAttribute('position');
            expect(positions.count).toBeGreaterThan(0);
            expect(geometry.getAttribute('normal').count).toBe(positions.count);
            expect(geometry.getAttribute('color').count).toBe(positions.count);
            geometry.dispose();
        }
    });

    it.each([...unitKeys, ...buildingKeys])('%s matches the height the overlay uses for HP bars', key => {
        const entity = RULES.units[key]
            ? createTestCombatUnit({ key: key as CombatUnitKey })
            : createTestBuilding({ key: key as BuildingKey });
        expect(Math.abs(modelBounds(key).max.y - getModelHeight(entity))).toBeLessThanOrEqual(1.5);
    });

    it.each(buildingKeys)('%s stays within its footprint', key => {
        const { w, h } = RULES.buildings[key];
        const bounds = modelBounds(key);
        expect(bounds.min.x).toBeGreaterThanOrEqual(-w / 2 - 0.5);
        expect(bounds.max.x).toBeLessThanOrEqual(w / 2 + 0.5);
        expect(bounds.min.z).toBeGreaterThanOrEqual(-h / 2 - 0.5);
        expect(bounds.max.z).toBeLessThanOrEqual(h / 2 + 0.5);
        expect(bounds.min.y).toBeGreaterThanOrEqual(-0.001);
    });

    it.each([...unitKeys, ...buildingKeys])('%s has consistent weapon metadata (muzzles, ammo slots)', key => {
        const def = getModelDef(key);
        const slots = def.ammoSlots ?? 0;
        for (const part of def.parts) {
            if (part.ammoSlot !== undefined) expect(part.ammoSlot).toBeLessThan(slots);
            if (part.spinAxis !== undefined) expect(part.mode).toBe('spin');
        }
        for (const muzzle of def.muzzles ?? []) {
            if (muzzle.ammoSlot !== undefined) expect(muzzle.ammoSlot).toBeLessThan(slots);
            if (muzzle.frame === 'turret') expect(def.parts.some(p => p.mode === 'turret')).toBe(true);
        }
        // Every ammo slot is drawn by some part, so a launch visibly empties something
        for (let slot = 0; slot < slots; slot++) {
            expect(def.parts.some(p => p.ammoSlot === slot)).toBe(true);
        }

        const data = RULES.units[key] ?? RULES.buildings[key];
        const armed = !!data?.weaponType && (data.damage ?? 0) !== 0;
        if (armed) expect(def.muzzles?.length ?? 0).toBeGreaterThan(0);
    });

    it('gives the harrier one underwing missile slot per ammo point', () => {
        expect(getModelDef('harrier').ammoSlots).toBe(RULES.units.harrier.ammo ?? 1);
    });

    it('flies aircraft low enough that clicking the drawn aircraft still selects it', () => {
        const harrier = createTestHarrier({});
        const heli = createTestCombatUnit({ key: 'heli' as CombatUnitKey });
        expect(getAltitude(harrier)).toBe(AIR_ALTITUDE);
        expect(getAltitude(heli)).toBe(AIR_ALTITUDE);
        expect(getAltitude(createTestCombatUnit({ key: 'light' }))).toBe(0);

        // Selection hits within radius + 15 of the ground position (see handleLeftClick)
        for (const key of ['heli', 'harrier']) {
            const clickRadius = (RULES.units[key].w ?? 20) / 2 + 15;
            expect(heightToScreenLift(AIR_ALTITUDE, 1)).toBeLessThan(clickRadius);
        }
    });
});

describe('graphics mode preference', () => {
    function memoryStorage() {
        const values = new Map<string, string>();
        return {
            getItem: (key: string) => values.get(key) ?? null,
            setItem: (key: string, value: string) => { values.set(key, value); },
        };
    }

    it('defaults to 3D', () => {
        expect(loadGraphicsMode(memoryStorage(), '')).toBe('3d');
    });

    it('remembers the saved choice', () => {
        const storage = memoryStorage();
        saveGraphicsMode('2d', storage);
        expect(storage.getItem(GRAPHICS_MODE_STORAGE_KEY)).toBe('2d');
        expect(loadGraphicsMode(storage, '')).toBe('2d');
    });

    it('lets ?graphics= in the URL override the saved choice', () => {
        const storage = memoryStorage();
        saveGraphicsMode('2d', storage);
        expect(loadGraphicsMode(storage, '?graphics=3d')).toBe('3d');
        expect(loadGraphicsMode(memoryStorage(), '?foo=1&graphics=2d')).toBe('2d');
    });

    it('ignores unknown values and unavailable storage', () => {
        const storage = memoryStorage();
        storage.setItem(GRAPHICS_MODE_STORAGE_KEY, 'voxels');
        expect(loadGraphicsMode(storage, '?graphics=4d')).toBe('3d');

        const broken = {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('denied'); },
        };
        expect(loadGraphicsMode(broken, '')).toBe('3d');
        expect(() => saveGraphicsMode('2d', broken)).not.toThrow();
    });
});

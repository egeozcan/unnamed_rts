import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * A colour slot on a model. Team slots are resolved per player when the geometry is realised, so one
 * model definition produces correctly coloured geometry for every owner.
 */
export type Paint = number | 'team' | 'teamDark' | 'teamLight';

interface Primitive {
    geometry: THREE.BufferGeometry;
    paint: Paint;
}

interface RodOptions {
    /** Elevation above the horizontal, radians. */
    pitch?: number;
    /** Heading in the ground plane, radians (0 = +X / forward, positive turns toward +Z). */
    yaw?: number;
    segments?: number;
    /** Radius at the far end (defaults to `radius`). */
    endRadius?: number;
}

/**
 * Tiny constructive-geometry builder for the low-poly unit and building models.
 *
 * Model space: +X is forward (the direction a unit faces at rotation 0), +Y is up, +Z is the unit's
 * right-hand side (south on the map at rotation 0). All sizes are world units.
 */
export class Shape {
    private readonly primitives: Primitive[] = [];

    /** Axis-aligned box centred on (x, z), standing on y0. */
    box(x: number, z: number, sx: number, sz: number, y0: number, sy: number, paint: Paint, yaw = 0): this {
        const geometry = new THREE.BoxGeometry(sx, sy, sz);
        if (yaw) geometry.rotateY(-yaw);
        geometry.translate(x, y0 + sy / 2, z);
        return this.push(geometry, paint);
    }

    /**
     * Box whose top face is a different size from its bottom face (sloped armour, roofs, tents).
     * `topShiftX` slides the top face forward/backward for leaning shapes.
     */
    taper(
        x: number, z: number,
        sxBottom: number, szBottom: number,
        sxTop: number, szTop: number,
        y0: number, sy: number,
        paint: Paint,
        topShiftX = 0
    ): this {
        const bx = sxBottom / 2, bz = szBottom / 2, tx = sxTop / 2, tz = szTop / 2;
        const b = [[-bx, 0, -bz], [bx, 0, -bz], [bx, 0, bz], [-bx, 0, bz]];
        const t = [[-tx + topShiftX, sy, -tz], [tx + topShiftX, sy, -tz], [tx + topShiftX, sy, tz], [-tx + topShiftX, sy, tz]];
        const quads: number[][][] = [
            [b[0], b[1], b[2], b[3]],
            [t[0], t[1], t[2], t[3]],
            [b[0], b[1], t[1], t[0]],
            [b[1], b[2], t[2], t[1]],
            [b[2], b[3], t[3], t[2]],
            [b[3], b[0], t[0], t[3]],
        ];
        // The solid is convex, so a triangle faces outward when its normal points away from the centre.
        const centre = [topShiftX / 2, sy / 2, 0];
        const positions: number[] = [];
        const pushTriangle = (p0: number[], p1: number[], p2: number[]) => {
            const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
            const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
            const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
            if (nx * nx + ny * ny + nz * nz < 1e-9) return; // degenerate (e.g. a ridge with zero width)
            const cx = (p0[0] + p1[0] + p2[0]) / 3 - centre[0];
            const cy = (p0[1] + p1[1] + p2[1]) / 3 - centre[1];
            const cz = (p0[2] + p1[2] + p2[2]) / 3 - centre[2];
            if (nx * cx + ny * cy + nz * cz >= 0) positions.push(...p0, ...p1, ...p2);
            else positions.push(...p0, ...p2, ...p1);
        };
        for (const [p0, p1, p2, p3] of quads) {
            pushTriangle(p0, p1, p2);
            pushTriangle(p0, p2, p3);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.translate(x, y0, z);
        return this.push(geometry, paint);
    }

    /** Box centred on (x, y, z), pitched (nose up, around Z) and then yawed (launcher boxes, tilted plates). */
    obox(x: number, y: number, z: number, sx: number, sy: number, sz: number, paint: Paint, pitch = 0, yaw = 0): this {
        const geometry = new THREE.BoxGeometry(sx, sy, sz);
        if (pitch) geometry.rotateZ(pitch);
        if (yaw) geometry.rotateY(-yaw);
        geometry.translate(x, y, z);
        return this.push(geometry, paint);
    }

    /** Vertical cylinder (or cone frustum) centred on (x, z), standing on y0. */
    cyl(x: number, z: number, radiusTop: number, radiusBottom: number, y0: number, sy: number, paint: Paint, segments = 10): this {
        const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, sy, segments);
        geometry.translate(x, y0 + sy / 2, z);
        return this.push(geometry, paint);
    }

    /** Hemisphere dome centred on (x, z), sitting on y0. `squash` scales its height. */
    dome(x: number, z: number, y0: number, radius: number, paint: Paint, squash = 1, segments = 12): this {
        const geometry = new THREE.SphereGeometry(radius, segments, Math.max(3, segments >> 1), 0, Math.PI * 2, 0, Math.PI / 2);
        geometry.scale(1, squash, 1);
        geometry.translate(x, y0, z);
        return this.push(geometry, paint);
    }

    sphere(x: number, y: number, z: number, radius: number, paint: Paint, scale: [number, number, number] = [1, 1, 1], segments = 10): this {
        const geometry = new THREE.SphereGeometry(radius, segments, Math.max(4, segments >> 1));
        geometry.scale(scale[0], scale[1], scale[2]);
        geometry.translate(x, y, z);
        return this.push(geometry, paint);
    }

    /** Low-poly faceted crystal / rock. */
    gem(x: number, y: number, z: number, radius: number, paint: Paint, scale: [number, number, number] = [1, 1, 1], yaw = 0, detail = 0): this {
        const geometry = new THREE.IcosahedronGeometry(radius, detail);
        geometry.scale(scale[0], scale[1], scale[2]);
        if (yaw) geometry.rotateY(yaw);
        geometry.translate(x, y, z);
        return this.push(geometry, paint);
    }

    /** Cylinder starting at (x, y, z) and extending `length` along its heading (barrels, struts, booms). */
    rod(x: number, y: number, z: number, radius: number, length: number, paint: Paint, options: RodOptions = {}): this {
        const { pitch = 0, yaw = 0, segments = 8, endRadius = radius } = options;
        const geometry = new THREE.CylinderGeometry(endRadius, radius, length, segments);
        geometry.rotateZ(-Math.PI / 2);      // along +X, centred
        geometry.translate(length / 2, 0, 0); // starts at origin
        if (pitch) geometry.rotateZ(pitch);
        if (yaw) geometry.rotateY(-yaw);
        geometry.translate(x, y, z);
        return this.push(geometry, paint);
    }

    /** Copies every primitive of another shape, mirrored across the X axis (z -> -z). */
    mirrorZ(): this {
        const count = this.primitives.length;
        for (let i = 0; i < count; i++) {
            const { geometry, paint } = this.primitives[i];
            const mirrored = geometry.clone();
            mirrored.scale(1, 1, -1);
            flipWinding(mirrored);
            this.primitives.push({ geometry: mirrored, paint });
        }
        return this;
    }

    get isEmpty(): boolean {
        return this.primitives.length === 0;
    }

    private push(geometry: THREE.BufferGeometry, paint: Paint): this {
        this.primitives.push({ geometry, paint });
        return this;
    }

    /** Merge all primitives into one flat-shaded, vertex-coloured geometry for the given team colour. */
    realize(team: THREE.Color): THREE.BufferGeometry {
        const teamDark = team.clone().multiplyScalar(0.55);
        const teamLight = team.clone().lerp(new THREE.Color(1, 1, 1), 0.35);
        const scratch = new THREE.Color();

        const parts = this.primitives.map(({ geometry, paint }) => {
            const flat = geometry.index ? geometry.toNonIndexed() : geometry.clone();
            flat.deleteAttribute('uv');
            flat.deleteAttribute('normal');
            flat.computeVertexNormals(); // non-indexed => per-face (flat) normals

            let color: THREE.Color;
            if (paint === 'team') color = team;
            else if (paint === 'teamDark') color = teamDark;
            else if (paint === 'teamLight') color = teamLight;
            else color = scratch.setHex(paint);

            const vertexCount = flat.getAttribute('position').count;
            const colors = new Float32Array(vertexCount * 3);
            for (let v = 0; v < vertexCount; v++) {
                colors[v * 3] = color.r;
                colors[v * 3 + 1] = color.g;
                colors[v * 3 + 2] = color.b;
            }
            flat.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            return flat;
        });

        const merged = mergeGeometries(parts, false);
        for (const part of parts) part.dispose();
        if (!merged) throw new Error('Failed to merge model geometry');
        merged.computeBoundingSphere();
        return merged;
    }
}

function flipWinding(geometry: THREE.BufferGeometry): void {
    if (geometry.index) {
        const index = geometry.index;
        for (let i = 0; i < index.count; i += 3) {
            const a = index.getX(i + 1);
            index.setX(i + 1, index.getX(i + 2));
            index.setX(i + 2, a);
        }
        index.needsUpdate = true;
        return;
    }
    const position = geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i += 3) {
        const x = position.getX(i + 1), y = position.getY(i + 1), z = position.getZ(i + 1);
        position.setXYZ(i + 1, position.getX(i + 2), position.getY(i + 2), position.getZ(i + 2));
        position.setXYZ(i + 2, x, y, z);
    }
    position.needsUpdate = true;
}

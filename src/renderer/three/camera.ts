import * as THREE from 'three';
import { CAMERA_TILT_RAD } from './projection.js';

/** Distance from the camera to the point of the ground at the centre of the screen. */
export const CAMERA_DISTANCE = 2000;

/**
 * Points an orthographic camera at the game camera's view.
 *
 * The camera looks down at CAMERA_TILT_RAD from vertical, and its vertical extent is shrunk by
 * cos(tilt) so the foreshortened ground fills the screen 1:1. A ground point therefore lands on exactly
 * the pixel the 2D renderer (and the input code) uses - (world - camera) * zoom - while something
 * `h` units tall is drawn h * tan(tilt) * zoom pixels higher.
 */
export function applyViewCamera(
    target: THREE.OrthographicCamera,
    camera: { readonly x: number; readonly y: number },
    zoom: number,
    width: number,
    height: number
): void {
    const halfW = width / (2 * zoom);
    const halfH = height / (2 * zoom);
    const cosT = Math.cos(CAMERA_TILT_RAD);
    const sinT = Math.sin(CAMERA_TILT_RAD);

    target.left = -halfW;
    target.right = halfW;
    target.top = halfH * cosT;
    target.bottom = -halfH * cosT;
    // Ground at the top/bottom of the view is halfH * sin(tilt) nearer/further than the centre;
    // back the camera off when zoomed far out so neither end gets clipped
    const distance = Math.max(CAMERA_DISTANCE, halfH * sinT + 500);
    target.near = 1;
    target.far = distance * 2;

    const cx = camera.x + halfW;
    const cz = camera.y + halfH;
    target.up.set(0, sinT, -cosT);
    target.position.set(cx, distance * cosT, cz + distance * sinT);
    target.lookAt(cx, 0, cz);
    target.updateProjectionMatrix();
    target.updateMatrixWorld();
}

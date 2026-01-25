/**
 * State Loader with Vector Rehydration
 *
 * Utilities for loading and saving GameState to/from JSON files.
 * Handles rehydration of Vector instances that are serialized as plain {x, y} objects.
 */

import fs from 'node:fs';
import path from 'node:path';
import { GameState, Vector } from '../../engine/types.js';

/**
 * Check if a value is a plain object that should be converted to a Vector.
 * A plain {x, y} object has exactly two properties, both named 'x' and 'y',
 * and both values must be numbers.
 */
function isPlainVectorObject(obj: unknown): obj is { x: number; y: number } {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
        return false;
    }

    const keys = Object.keys(obj);
    if (keys.length !== 2) {
        return false;
    }

    if (!keys.includes('x') || !keys.includes('y')) {
        return false;
    }

    const record = obj as Record<string, unknown>;
    return typeof record.x === 'number' && typeof record.y === 'number';
}

/**
 * Recursively converts plain {x, y} objects to Vector instances.
 *
 * Rules:
 * - null/undefined and primitives are returned as-is
 * - Arrays are mapped recursively
 * - Objects with exactly {x: number, y: number} become Vector instances
 * - All other objects have their properties recursively processed
 *
 * @param obj - The value to process
 * @returns The value with all plain {x, y} objects converted to Vectors
 */
export function rehydrateVectors(obj: unknown): unknown {
    // Handle null/undefined
    if (obj === null || obj === undefined) {
        return obj;
    }

    // Handle primitives (numbers, strings, booleans)
    if (typeof obj !== 'object') {
        return obj;
    }

    // Handle arrays - map recursively
    if (Array.isArray(obj)) {
        return obj.map(item => rehydrateVectors(item));
    }

    // Check if this is a plain {x, y} object that should become a Vector
    if (isPlainVectorObject(obj)) {
        return new Vector(obj.x, obj.y);
    }

    // Otherwise, recursively process all properties
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        result[key] = rehydrateVectors(value);
    }
    return result;
}

/**
 * Load a GameState from a JSON file and rehydrate all Vector instances.
 *
 * @param filePath - Path to the JSON file (can be relative or absolute)
 * @returns The loaded and rehydrated GameState
 * @throws Error if the file does not exist
 */
export function loadState(filePath: string): GameState {
    const absPath = path.resolve(filePath);

    if (!fs.existsSync(absPath)) {
        throw new Error(`State file not found: ${absPath}`);
    }

    const content = fs.readFileSync(absPath, 'utf8');
    const parsed = JSON.parse(content);

    return rehydrateVectors(parsed) as GameState;
}

/**
 * Save a GameState to a JSON file.
 *
 * @param state - The GameState to save
 * @param filePath - Path to the output JSON file (can be relative or absolute)
 */
export function saveState(state: GameState, filePath: string): void {
    const absPath = path.resolve(filePath);
    const dir = path.dirname(absPath);

    // Create parent directories if they don't exist
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    const content = JSON.stringify(state, null, 2);
    fs.writeFileSync(absPath, content, 'utf8');
}

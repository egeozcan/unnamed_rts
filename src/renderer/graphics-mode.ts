export type GraphicsMode = '3d' | '2d';

export const GRAPHICS_MODE_STORAGE_KEY = 'unnamed_rts.graphics_mode';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStorage(): StorageLike | null {
    try {
        return typeof localStorage !== 'undefined' ? localStorage : null;
    } catch {
        return null;
    }
}

export function asGraphicsMode(value: unknown): GraphicsMode | null {
    return value === '3d' || value === '2d' ? value : null;
}

/** `?graphics=2d|3d` in the URL wins over the saved preference; 3D is the default. */
export function loadGraphicsMode(storage: StorageLike | null = defaultStorage(), search = typeof location !== 'undefined' ? location.search : ''): GraphicsMode {
    const fromUrl = asGraphicsMode(new URLSearchParams(search).get('graphics'));
    if (fromUrl) return fromUrl;
    try {
        return asGraphicsMode(storage?.getItem(GRAPHICS_MODE_STORAGE_KEY)) ?? '3d';
    } catch {
        return '3d';
    }
}

export function saveGraphicsMode(mode: GraphicsMode, storage: StorageLike | null = defaultStorage()): void {
    try {
        storage?.setItem(GRAPHICS_MODE_STORAGE_KEY, mode);
    } catch {
        // Storage can be unavailable (private mode, quota); the choice just won't persist.
    }
}

export function isWebGLAvailable(): boolean {
    try {
        const canvas = document.createElement('canvas');
        return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
    } catch {
        return false;
    }
}

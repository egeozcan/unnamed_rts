// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { initInput } from '../../src/input/index.js';

describe('Escape key', () => {
    function setup() {
        const onCancel = vi.fn();
        initInput(document.createElement('canvas'), {
            onLeftClick: vi.fn(),
            onRightClick: vi.fn(),
            onDeployMCV: vi.fn(),
            onToggleDebug: vi.fn(),
            onToggleMinimap: vi.fn(),
            onToggleBirdsEye: vi.fn(),
            onAdjustSpeed: vi.fn(),
            onCancel,
            getZoom: () => 1,
            getCamera: () => ({ x: 0, y: 0 })
        });
        return onCancel;
    }

    it('calls onCancel', () => {
        const onCancel = setup();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it('is ignored when an overlay already consumed it', () => {
        const onCancel = setup();
        const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        event.preventDefault();
        window.dispatchEvent(event);
        expect(onCancel).not.toHaveBeenCalled();
    });
});

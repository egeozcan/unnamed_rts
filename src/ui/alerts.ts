/**
 * Short-lived alerts shown over the battlefield ("Construction complete", "Base under attack"...).
 * The sidebar status line is far from where players look, so important events surface here too.
 */

export type AlertType = 'info' | 'success' | 'warning' | 'error';

const MAX_VISIBLE_ALERTS = 4;
const ALERT_LIFETIME_MS = 4000;

/** Screen readers get at most one routine announcement per this interval (errors always go through). */
const ANNOUNCE_MIN_INTERVAL_MS = 2500;

let container: HTMLDivElement | null = null;
let liveRegion: HTMLDivElement | null = null;
let lastAnnouncedAt = -Infinity;
const lastShownByKey = new Map<string, number>();

function getContainer(): HTMLDivElement {
    if (!container || !container.isConnected) {
        // The visible stack is not a live region: every "Unit ready" would be read out in battle.
        // Announcements go through the separate, rate-limited live region below.
        container = document.createElement('div');
        container.id = 'alerts';
        (document.getElementById('game-container') ?? document.body).appendChild(container);
    }
    return container;
}

function getLiveRegion(): HTMLDivElement {
    if (!liveRegion || !liveRegion.isConnected) {
        liveRegion = document.createElement('div');
        liveRegion.id = 'alerts-live';
        liveRegion.className = 'visually-hidden';
        liveRegion.setAttribute('role', 'status');
        liveRegion.setAttribute('aria-live', 'polite');
        liveRegion.setAttribute('aria-atomic', 'true');
        document.body.appendChild(liveRegion);
    }
    return liveRegion;
}

/**
 * Routine, repeating info alerts (they carry a throttle key, like "Unit ready") are shown but not
 * announced; others are announced politely, at most one per ANNOUNCE_MIN_INTERVAL_MS unless urgent.
 */
function announce(text: string, type: AlertType, throttleKey: string | undefined, now: number, force?: boolean): void {
    const wanted = force ?? !(type === 'info' && throttleKey);
    if (!wanted) return;
    if (type !== 'error' && now - lastAnnouncedAt < ANNOUNCE_MIN_INTERVAL_MS) return;
    lastAnnouncedAt = now;
    getLiveRegion().textContent = text;
}

/**
 * Show an alert. Alerts sharing a `throttleKey` are shown at most once per `throttleMs`
 * (e.g. "Base under attack" while a fight goes on). `announce` overrides whether screen readers
 * hear it (default: everything except routine keyed info alerts).
 */
export function pushAlert(text: string, type: AlertType = 'info', throttleKey?: string, throttleMs = 0, announceToScreenReader?: boolean): void {
    const now = performance.now();
    if (throttleKey) {
        const last = lastShownByKey.get(throttleKey);
        if (last !== undefined && now - last < throttleMs) return;
        lastShownByKey.set(throttleKey, now);
    }

    const root = getContainer();
    announce(text, type, throttleKey, now, announceToScreenReader);

    // Same text still on screen: restart its timer instead of stacking a duplicate
    for (const existing of Array.from(root.children) as HTMLElement[]) {
        if (existing.textContent === text && !existing.classList.contains('leaving')) {
            root.removeChild(existing);
            break;
        }
    }

    const el = document.createElement('div');
    el.className = `alert alert-${type}`;
    el.textContent = text;
    root.appendChild(el);

    while (root.children.length > MAX_VISIBLE_ALERTS) {
        root.removeChild(root.firstElementChild!);
    }

    window.setTimeout(() => {
        el.classList.add('leaving');
        window.setTimeout(() => el.remove(), 400);
    }, ALERT_LIFETIME_MS);
}

/** Forget throttling state and remove visible alerts (new game). */
export function resetAlerts(): void {
    lastShownByKey.clear();
    lastAnnouncedAt = -Infinity;
    container?.replaceChildren();
    if (liveRegion) liveRegion.textContent = '';
}

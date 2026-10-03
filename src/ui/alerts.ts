/**
 * Short-lived alerts shown over the battlefield ("Construction complete", "Base under attack"...).
 * The sidebar status line is far from where players look, so important events surface here too.
 */

export type AlertType = 'info' | 'success' | 'warning' | 'error';

const MAX_VISIBLE_ALERTS = 4;
const ALERT_LIFETIME_MS = 4000;

let container: HTMLDivElement | null = null;
const lastShownByKey = new Map<string, number>();

function getContainer(): HTMLDivElement {
    if (!container || !container.isConnected) {
        container = document.createElement('div');
        container.id = 'alerts';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        (document.getElementById('game-container') ?? document.body).appendChild(container);
    }
    return container;
}

/**
 * Show an alert. Alerts sharing a `throttleKey` are shown at most once per `throttleMs`
 * (e.g. "Base under attack" while a fight goes on).
 */
export function pushAlert(text: string, type: AlertType = 'info', throttleKey?: string, throttleMs = 0): void {
    const now = performance.now();
    if (throttleKey) {
        const last = lastShownByKey.get(throttleKey);
        if (last !== undefined && now - last < throttleMs) return;
        lastShownByKey.set(throttleKey, now);
    }

    const root = getContainer();

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
    container?.replaceChildren();
}

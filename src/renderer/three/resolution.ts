/**
 * Adaptive render resolution for the 3D view (no three.js import, so it is unit-testable).
 *
 * Fill rate is the 3D view's main GPU cost and grows with the square of the pixel ratio. When frames
 * consistently take longer than the frame budget, the pixel ratio steps down (2 -> 1.5 -> 1.25); when
 * there is headroom again it probes back up. Three guards keep it from oscillating or degrading the
 * picture for nothing:
 * - decisions use a moving average and wait for a settling period after every change;
 * - a step down that does not make frames meaningfully faster (the bottleneck is the CPU, not fill
 *   rate) is undone and further step-downs are suspended for a while;
 * - a step up that pushes frames back over budget is undone, and the next probe waits twice as long.
 */

/** Pixel ratios tried below the device's own (capped) ratio, highest first. */
export const RESOLUTION_STEPS: readonly number[] = [1.5, 1.25];

/** Moving-average weight of each new frame-time sample. */
const SMOOTHING = 0.1;
/** Samples to collect after a change (or at start) before judging the frame time. */
const SETTLE_SAMPLES = 45;
/** Over budget: the average frame takes this much longer than the budget. */
const OVER_BUDGET = 1.25;
/** Headroom: the average frame is within this factor of the budget (the game loop caps the frame rate). */
const UNDER_BUDGET = 1.08;
/** A step down must cut the average frame time at least this much to be kept. */
const MIN_GAIN = 0.92;
/** Samples to wait before probing a higher ratio again (doubles after every failed probe). */
const PROBE_DELAY = 240;
const MAX_PROBE_DELAY = 3840;
/** Step-downs are suspended for this many samples after one that didn't help. */
const CPU_BOUND_BACKOFF = 1200;
/** Frame intervals longer than this are pauses (tab switches, breakpoints), not slow frames. */
const MAX_SAMPLE_MS = 250;

type Pending = 'none' | 'down' | 'up';

export class AdaptiveResolution {
    private ratios: number[] = [1];
    private maxRatio = 0;
    private level = 0;
    private avg = 0;
    private samples = 0;
    private pending: Pending = 'none';
    private avgBeforeChange = 0;
    private probeDelay = PROBE_DELAY;
    private downBlocked = 0;

    constructor(private readonly budgetMs = 1000 / 60) {}

    /** Pixel ratio to render at, given the device's (capped) pixel ratio. */
    pixelRatio(maxRatio: number): number {
        if (maxRatio !== this.maxRatio) {
            this.maxRatio = maxRatio;
            this.ratios = [maxRatio, ...RESOLUTION_STEPS.filter(r => r < maxRatio - 0.01)];
            this.level = 0;
            this.restart('none');
        }
        return this.ratios[this.level];
    }

    /** Feeds the interval (ms) between two consecutive rendered frames. */
    sample(frameMs: number): void {
        if (!(frameMs > 0) || frameMs > MAX_SAMPLE_MS) return;
        this.avg = this.samples === 0 ? frameMs : this.avg + (frameMs - this.avg) * SMOOTHING;
        this.samples++;
        if (this.downBlocked > 0) this.downBlocked--;
        if (this.samples < SETTLE_SAMPLES) return;

        const over = this.avg > this.budgetMs * OVER_BUDGET;
        if (this.pending === 'down') {
            // Keep a step down only if it actually made frames faster
            if (this.avg > this.avgBeforeChange * MIN_GAIN && over) {
                this.level--;
                this.downBlocked = CPU_BOUND_BACKOFF;
                this.restart('none');
            } else {
                this.pending = 'none';
            }
            return;
        }
        if (this.pending === 'up') {
            if (over) {
                this.level++;
                this.probeDelay = Math.min(MAX_PROBE_DELAY, this.probeDelay * 2);
                this.restart('none');
                return;
            }
            this.pending = 'none';
        }

        if (over && this.level < this.ratios.length - 1 && this.downBlocked === 0) {
            this.avgBeforeChange = this.avg;
            this.level++;
            this.restart('down');
        } else if (this.level > 0 && this.avg < this.budgetMs * UNDER_BUDGET && this.samples >= this.probeDelay) {
            this.level--;
            this.restart('up');
        }
    }

    private restart(pending: Pending): void {
        this.pending = pending;
        this.samples = 0;
        this.avg = 0;
    }
}

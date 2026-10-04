import { describe, it, expect } from 'vitest';
import { checkMatrix, compFromBudget, compValue, parseComp, runFight, runMatchup } from '../../src/scripts/balance_sim';

describe('balance_sim', () => {
    it('parses compositions and spends a budget exactly', () => {
        expect(parseComp('rifle:10, rocket:4')).toEqual({ rifle: 10, rocket: 4 });
        expect(compValue(compFromBudget({ heavy: 1 }, 6000, 'partial'))).toBeCloseTo(6000);
        const floor = compFromBudget({ heavy: 1 }, 6000, 'floor');
        expect(Number.isInteger(floor.heavy)).toBe(true);
        expect(compValue(floor)).toBeLessThanOrEqual(6000);
    });

    it('runs a small mirror fight to elimination and scores it symmetrically', () => {
        const m = runMatchup({ rifle: 4 }, { rifle: 4 }, 1, 7, { maxTicks: 3000 });
        expect(m.fights).toHaveLength(2);
        for (const f of m.fights) {
            expect(f.reason).toBe('elimination');
            expect(f.ticks).toBeLessThan(3000);
            expect(Math.abs(f.score)).toBeLessThanOrEqual(1);
        }
        // Same seed with sides swapped: each half is the other's mirror image
        expect(m.fights[0].score).toBeCloseTo(-m.fights[1].score, 6);
        expect(m.meanScore).toBeCloseTo(0, 6);
    });

    it('lets units actually deal damage', () => {
        // A mirror match, so the test doesn't depend on balance numbers that are being tuned
        const r = runFight({ left: { units: { light: 2 } }, right: { units: { light: 2 } }, seed: 3, maxTicks: 3000, trackDamage: true });
        expect(r.reason).toBe('elimination');
        expect(r.damage![0].dealt.light).toBeGreaterThan(0);
        expect(r.damage![1].dealt.light).toBeGreaterThan(0);
    });

    it('checks a score matrix for rock-paper-scissors health', () => {
        // a > b > c > a, and d loses to everything
        const names = ['a', 'b', 'c', 'd'];
        const m = [
            [0, 0.6, -0.6, 0.5],
            [-0.6, 0, 0.6, 0.5],
            [0.6, -0.6, 0, 0.5],
            [-0.5, -0.5, -0.5, 0],
        ];
        const r = checkMatrix(names, m, ['a>b', 'b>a']);
        expect(r.cycles).toEqual([['a', 'b', 'c']]);
        expect(r.dominant).toEqual([]);
        expect(r.rows.find(x => x.name === 'd')!.flags).toEqual(['no niche', 'too weak']);
        expect(r.rows.find(x => x.name === 'a')!.flags).toEqual([]);
        expect(r.expectations.map(e => e.pass)).toEqual([true, false]);
        expect(r.failures).toHaveLength(3);

        const dominated = checkMatrix(['x', 'y'], [[0, 0.5], [-0.5, 0]]);
        expect(dominated.dominant).toEqual(['x']);
    });
});

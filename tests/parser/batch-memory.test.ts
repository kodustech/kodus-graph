import { describe, expect, it } from 'bun:test';
import { computeNextBatchSize } from '../../src/parser/batch';

// Baseline: 1 MiB per byte accounting — all synthetic, no actual RSS check.
const MB = 1024 * 1024;

describe('computeNextBatchSize', () => {
    it('keeps batch size stable when RSS is below threshold', () => {
        const maxBytes = 1024 * MB;
        const rss = 500 * MB; // under 70% of 1024
        const out = computeNextBatchSize(50, rss, maxBytes, 0.7);
        expect(out.underPressure).toBe(false);
        expect(out.batchSize).toBe(50);
    });

    it('halves batch size when RSS crosses the threshold', () => {
        const maxBytes = 1024 * MB;
        const rss = 800 * MB; // >70% of 1024
        const out = computeNextBatchSize(50, rss, maxBytes, 0.7);
        expect(out.underPressure).toBe(true);
        expect(out.batchSize).toBe(25);
    });

    it('can progressively reduce all the way to 1 under sustained pressure', () => {
        // 50 -> 25 -> 12 -> 6 -> 3 -> 1 -> 1 (stays at 1).
        const maxBytes = 1024 * MB;
        const rss = 900 * MB; // sustained pressure
        const expected = [25, 12, 6, 3, 1, 1];

        let batch = 50;
        const actual: number[] = [];
        for (let i = 0; i < expected.length; i++) {
            const out = computeNextBatchSize(batch, rss, maxBytes, 0.7);
            actual.push(out.batchSize);
            batch = out.batchSize;
        }
        expect(actual).toEqual(expected);
    });

    it('never returns a batch size below 1', () => {
        const maxBytes = 1024 * MB;
        const rss = 900 * MB;
        const out = computeNextBatchSize(1, rss, maxBytes, 0.7);
        expect(out.batchSize).toBe(1);
        expect(out.underPressure).toBe(true);
    });

    it('does not throw when globalThis.gc is undefined (the default)', async () => {
        // No explicit assertion possible for the gc hook itself — just ensure
        // that parseBatch still works in an environment without --expose-gc.
        expect(typeof globalThis.gc === 'function' || typeof globalThis.gc === 'undefined').toBe(true);

        const { parseBatch } = await import('../../src/parser/batch');
        const { resolve } = await import('path');
        const fixtureDir = resolve('tests/fixtures/sample-repo');
        const files = [resolve(fixtureDir, 'src/auth.ts')];
        const result = await parseBatch(files, fixtureDir, { maxMemoryMB: 1 });
        // maxMemoryMB:1 will always look like pressure; the reducer should run
        // and the code must not crash when gc is absent.
        expect(result.functions.length).toBeGreaterThan(0);
    });
});

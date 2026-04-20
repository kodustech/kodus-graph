import { describe, expect, it } from 'bun:test';
import { computeNextBatchSize } from '../../src/parser/batch';

// Baseline: 1 MiB per byte accounting — all synthetic, no actual RSS check.
const MB = 1024 * 1024;

describe('computeNextBatchSize', () => {
    it('holds when RSS is below threshold and batch is at initial', () => {
        const maxBytes = 1024 * MB;
        const rss = 500 * MB; // under 70% of 1024
        const out = computeNextBatchSize(50, rss, maxBytes, 0.7, 0, 50);
        expect(out.action).toBe('hold');
        expect(out.batchSize).toBe(50);
    });

    it('shrinks (halves) when RSS crosses the threshold', () => {
        const maxBytes = 1024 * MB;
        const rss = 800 * MB; // >70% of 1024
        const out = computeNextBatchSize(50, rss, maxBytes, 0.7, 0, 50);
        expect(out.action).toBe('shrink');
        expect(out.batchSize).toBe(25);
    });

    it('progressively shrinks all the way to 1 under sustained pressure', () => {
        // 50 -> 25 -> 12 -> 6 -> 3 -> 1, then holds
        const maxBytes = 1024 * MB;
        const rss = 900 * MB; // sustained pressure
        const steps: Array<{ size: number; action: string }> = [];
        let batch = 50;
        for (let i = 0; i < 6; i++) {
            const out = computeNextBatchSize(batch, rss, maxBytes, 0.7, 0, 50);
            steps.push({ size: out.batchSize, action: out.action });
            batch = out.batchSize;
        }
        expect(steps.map((s) => s.size)).toEqual([25, 12, 6, 3, 1, 1]);
        // First five shrink, last one holds (already at floor).
        expect(steps.map((s) => s.action)).toEqual(['shrink', 'shrink', 'shrink', 'shrink', 'shrink', 'hold']);
    });

    it('holds (no yield/gc overhead) when at floor under sustained pressure', () => {
        const maxBytes = 1024 * MB;
        const rss = 900 * MB;
        const out = computeNextBatchSize(1, rss, maxBytes, 0.7, 0, 50);
        expect(out.action).toBe('hold');
        expect(out.batchSize).toBe(1);
    });

    it('grows back after sustained idle (regression guard)', () => {
        // Shrunk to 6, then pressure clears. After 3 idle batches, grow.
        const maxBytes = 1024 * MB;
        const rssOk = 400 * MB;

        // Idle=0,1,2 → still hold
        for (let idle = 0; idle < 3; idle++) {
            const out = computeNextBatchSize(6, rssOk, maxBytes, 0.7, idle, 50);
            expect(out.action).toBe('hold');
            expect(out.batchSize).toBe(6);
        }
        // Idle=3 → grow
        const grown = computeNextBatchSize(6, rssOk, maxBytes, 0.7, 3, 50);
        expect(grown.action).toBe('grow');
        expect(grown.batchSize).toBe(12);
    });

    it('caps grow at initial batch size', () => {
        const maxBytes = 1024 * MB;
        const rssOk = 400 * MB;
        const out = computeNextBatchSize(40, rssOk, maxBytes, 0.7, 3, 50);
        expect(out.action).toBe('grow');
        expect(out.batchSize).toBe(50); // min(50, 80)
    });

    it('holds at initial even after long idle streak', () => {
        const maxBytes = 1024 * MB;
        const rssOk = 400 * MB;
        const out = computeNextBatchSize(50, rssOk, maxBytes, 0.7, 999, 50);
        expect(out.action).toBe('hold');
        expect(out.batchSize).toBe(50);
    });

    it('does not throw when globalThis.gc is undefined (the default)', async () => {
        expect(typeof globalThis.gc === 'function' || typeof globalThis.gc === 'undefined').toBe(true);

        const { parseBatch } = await import('../../src/parser/batch');
        const { resolve } = await import('path');
        const fixtureDir = resolve('tests/fixtures/sample-repo');
        const files = [resolve(fixtureDir, 'src/auth.ts')];
        const result = await parseBatch(files, fixtureDir, { maxMemoryMB: 1 });
        // maxMemoryMB:1 will always look like pressure; the reducer must not
        // crash when gc is absent.
        expect(result.functions.length).toBeGreaterThan(0);
    });
});

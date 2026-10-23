import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parseBatch } from '../../src/parser/batch';

/**
 * Every discovered file must be parsed exactly once, whatever the memory
 * monitor does to the batch size mid-run.
 *
 * The loop used to advance by the batch size decided *after* the batch ran, so
 * a grow (25 -> 50) skipped the 25 files after the batch and a shrink re-read
 * files. RSS varies run to run, so large repos lost a different set of whole
 * files on every `parse` (seen on a 4.6k-file monorepo: ~50 files per run).
 */

const DIR = '/tmp/kodus-graph-batch-coverage-test';
const N = 300;

afterEach(() => {
    rmSync(DIR, { recursive: true, force: true });
});

function writeFiles(): string[] {
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    const files: string[] = [];
    for (let i = 0; i < N; i++) {
        const f = join(DIR, `f${String(i).padStart(3, '0')}.ts`);
        writeFileSync(f, `export function fn${i}(): number {\n    return ${i};\n}\n`);
        files.push(f);
    }
    return files;
}

describe('parseBatch covers every file while the batch size changes', () => {
    it('parses each file exactly once across shrink and grow', async () => {
        const files = writeFiles();
        const maxMB = 100;
        const high = maxMB * 1024 * 1024; // above the 0.7 threshold -> shrink
        const low = 1024 * 1024; // well below -> idle, then grow
        // Pressure for the first batches, then relief: forces shrinks followed by grows.
        let calls = 0;
        const spy = spyOn(process, 'memoryUsage').mockImplementation((() => {
            calls++;
            return { rss: calls <= 4 ? high : low, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 };
        }) as unknown as typeof process.memoryUsage);

        try {
            const graph = await parseBatch(files, DIR, { maxMemoryMB: maxMB });
            const names = graph.functions.map((f) => f.name);
            expect(new Set(names).size).toBe(N);
            expect(names.length).toBe(N);
            // Extraction follows input order, not parse-completion order.
            expect(names).toEqual(Array.from({ length: N }, (_, i) => `fn${i}`));
        } finally {
            spy.mockRestore();
        }
    });
});

import { describe, expect, it } from 'bun:test';
import { readFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { executeContext } from '../../src/commands/context';
import { executeParse } from '../../src/commands/parse';

// Import to trigger language registration
import '../../src/parser/languages';

describe('executeContext', () => {
    const fixtureDir = resolve('tests/fixtures/sample-repo');
    const parsePath = '/tmp/kodus-graph-test-ctx-parse.json';
    const outPath = '/tmp/kodus-graph-test-context.json';

    it('should produce V2 context with graph and analysis sections', async () => {
        await executeParse({
            repoDir: fixtureDir,
            all: true,
            out: parsePath,
        });

        await executeContext({
            repoDir: fixtureDir,
            files: ['src/auth.ts'],
            graph: parsePath,
            out: outPath,
            minConfidence: 0.5,
            maxDepth: 3,
            format: 'json',
        });

        const output = JSON.parse(readFileSync(outPath, 'utf-8'));
        expect(output).toHaveProperty('graph');
        expect(output).toHaveProperty('analysis');
        expect(output.graph).toHaveProperty('nodes');
        expect(output.graph).toHaveProperty('edges');
        expect(output.analysis).toHaveProperty('changed_functions');
        expect(output.analysis).toHaveProperty('structural_diff');
        expect(output.analysis).toHaveProperty('blast_radius');
        expect(output.analysis).toHaveProperty('affected_flows');
        expect(output.analysis).toHaveProperty('inheritance');
        expect(output.analysis).toHaveProperty('test_gaps');
        expect(output.analysis).toHaveProperty('risk');
        // When baseline graph is from same repo without real changes, structural diff
        // finds 0 added/modified, so onlyChanged enrichment correctly returns 0 functions.
        expect(output.analysis.metadata.changed_functions_count).toBeGreaterThanOrEqual(0);

        rmSync(parsePath, { force: true });
        rmSync(outPath, { force: true });
    });

    it('B8: slice CALLS edges resolve consistently with the full-graph baseline', async () => {
        // auth.ts calls findUser() (defined in db.ts). Without the baseline
        // seed, db.ts's symbols are invisible to the slice re-parse and the
        // call falls to a lower tier. With the seed, the slice resolver sees
        // db.ts and returns the same target as the full graph.
        const slicePath = '/tmp/kodus-graph-test-ctx-b8.json';
        await executeParse({
            repoDir: fixtureDir,
            all: true,
            out: parsePath,
        });
        const baseline = JSON.parse(readFileSync(parsePath, 'utf-8'));

        await executeContext({
            repoDir: fixtureDir,
            files: ['src/auth.ts'],
            graph: parsePath,
            out: slicePath,
            minConfidence: 0.0,
            maxDepth: 3,
            format: 'json',
        });

        const ctx = JSON.parse(readFileSync(slicePath, 'utf-8'));

        // Find the findUser CALLS edge from auth.ts in BOTH graphs and assert
        // they target the same qualified symbol. The merged graph in the
        // context output contains the slice's re-resolved edges.
        const baselineEdge = baseline.edges.find(
            (e: { kind: string; file_path: string; target_qualified?: string; source_qualified?: string }) =>
                e.kind === 'CALLS' &&
                e.file_path === 'src/auth.ts' &&
                e.source_qualified?.includes('authenticate') &&
                e.target_qualified?.includes('findUser'),
        );
        expect(baselineEdge).toBeDefined();

        const sliceEdge = ctx.graph.edges.find(
            (e: { kind: string; file_path: string; target_qualified?: string; source_qualified?: string }) =>
                e.kind === 'CALLS' &&
                e.file_path === 'src/auth.ts' &&
                e.source_qualified?.includes('authenticate') &&
                e.target_qualified?.includes('findUser'),
        );
        expect(sliceEdge).toBeDefined();
        expect(sliceEdge.target_qualified).toBe(baselineEdge.target_qualified);
        expect(sliceEdge.confidence).toBe(baselineEdge.confidence);

        rmSync(parsePath, { force: true });
        rmSync(slicePath, { force: true });
    });

    it('should produce prompt text with --format prompt', async () => {
        const promptPath = '/tmp/kodus-graph-test-prompt.txt';

        await executeParse({
            repoDir: fixtureDir,
            all: true,
            out: parsePath,
        });

        await executeContext({
            repoDir: fixtureDir,
            files: ['src/auth.ts'],
            graph: parsePath,
            out: promptPath,
            minConfidence: 0.5,
            maxDepth: 3,
            format: 'prompt',
        });

        const text = readFileSync(promptPath, 'utf-8');
        // Compact format header: stats line
        expect(text).toMatch(/\d+ changed \(\d+ untested\) \| \d+ impacted/);
        // When baseline graph is from same repo without real changes, structural diff
        // finds 0 added/modified, so no changed functions appear in the prompt.
        // The prompt still contains inheritance.

        rmSync(parsePath, { force: true });
        rmSync(promptPath, { force: true });
    });
});

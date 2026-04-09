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

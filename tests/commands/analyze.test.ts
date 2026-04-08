import { describe, expect, it } from 'bun:test';
import { readFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { executeAnalyze } from '../../src/commands/analyze';
import { executeParse } from '../../src/commands/parse';

// Import to trigger language registration
import '../../src/parser/languages';

describe('executeAnalyze', () => {
    const fixtureDir = resolve('tests/fixtures/sample-repo');
    const parsePath = '/tmp/kodus-graph-test-analyze-parse.json';
    const outPath = '/tmp/kodus-graph-test-analyze.json';

    it('should produce valid analysis output', async () => {
        // First build a parse output to use as "main graph"
        await executeParse({
            repoDir: fixtureDir,
            files: ['src/auth.ts', 'src/controller.ts', 'src/db.ts'],
            all: false,
            out: parsePath,
        });

        await executeAnalyze({
            repoDir: fixtureDir,
            files: ['src/auth.ts'],
            graph: parsePath,
            out: outPath,
        });

        const output = JSON.parse(readFileSync(outPath, 'utf-8'));
        expect(output).toHaveProperty('blast_radius');
        expect(output).toHaveProperty('risk_score');
        expect(output).toHaveProperty('test_gaps');
        expect(output.blast_radius).toHaveProperty('total_functions');
        expect(output.blast_radius).toHaveProperty('total_files');
        expect(output.risk_score).toHaveProperty('level');
        expect(output.risk_score).toHaveProperty('score');
        expect(output.risk_score).toHaveProperty('factors');

        rmSync(parsePath, { force: true });
        rmSync(outPath, { force: true });
    });
});

import { describe, expect, it } from 'bun:test';
import { execSync } from 'child_process';
import { readFileSync, rmSync } from 'fs';
import { resolve } from 'path';

const CLI = resolve('src/cli.ts');
const FIXTURE = resolve('tests/fixtures/sample-repo');

describe('E2E: kodus-graph CLI', () => {
    it('parse --all should produce valid output', () => {
        const out = '/tmp/kodus-graph-e2e-parse.json';
        execSync(`bun run ${CLI} parse --all --repo-dir ${FIXTURE} --out ${out}`);
        const result = JSON.parse(readFileSync(out, 'utf-8'));

        expect(result.metadata.files_parsed).toBeGreaterThan(0);
        expect(result.nodes.length).toBeGreaterThan(0);
        expect(result.edges.length).toBeGreaterThan(0);

        // Verify schema compliance
        for (const node of result.nodes) {
            expect(node).toHaveProperty('kind');
            expect(node).toHaveProperty('qualified_name');
            expect(node).toHaveProperty('file_path');
        }

        rmSync(out, { force: true });
    });

    it('parse --files should only parse specified files', () => {
        const out = '/tmp/kodus-graph-e2e-parse-files.json';
        execSync(`bun run ${CLI} parse --files src/auth.ts --repo-dir ${FIXTURE} --out ${out}`);
        const result = JSON.parse(readFileSync(out, 'utf-8'));

        expect(result.metadata.files_parsed).toBe(1);
        expect(result.nodes.length).toBeGreaterThan(0);
        // All nodes should be from auth.ts
        for (const node of result.nodes) {
            expect(node.file_path).toContain('auth.ts');
        }

        rmSync(out, { force: true });
    });

    it('parse --all --exclude should skip excluded files', () => {
        const out = '/tmp/kodus-graph-e2e-parse-exclude.json';
        execSync(`bun run ${CLI} parse --all --repo-dir ${FIXTURE} --exclude "**/*.test.*" --out ${out}`);
        const result = JSON.parse(readFileSync(out, 'utf-8'));

        expect(result.metadata.files_parsed).toBeGreaterThan(0);
        // No test file nodes should be present since we excluded *.test.* files
        for (const node of result.nodes) {
            expect(node.file_path).not.toMatch(/\.test\./);
        }

        rmSync(out, { force: true });
    });

    it('analyze should produce blast radius and risk score', () => {
        const parsePath = '/tmp/kodus-graph-e2e-analyze-parse.json';
        const analyzePath = '/tmp/kodus-graph-e2e-analyze.json';

        execSync(`bun run ${CLI} parse --all --repo-dir ${FIXTURE} --out ${parsePath}`);
        execSync(
            `bun run ${CLI} analyze --files src/auth.ts --repo-dir ${FIXTURE} --graph ${parsePath} --out ${analyzePath}`,
        );

        const result = JSON.parse(readFileSync(analyzePath, 'utf-8'));
        expect(result.blast_radius).toBeDefined();
        expect(result.risk_score).toBeDefined();
        expect(result.risk_score.level).toMatch(/LOW|MEDIUM|HIGH/);
        expect(result.test_gaps).toBeDefined();

        rmSync(parsePath, { force: true });
        rmSync(analyzePath, { force: true });
    });

    it('context should produce V2 structured output with graph and analysis', () => {
        const parsePath = '/tmp/kodus-graph-e2e-main.json';
        const ctxPath = '/tmp/kodus-graph-e2e-ctx.json';

        // First build the "main" graph
        execSync(`bun run ${CLI} parse --all --repo-dir ${FIXTURE} --out ${parsePath}`);

        // Then generate context for changed file
        execSync(
            `bun run ${CLI} context --files src/auth.ts --repo-dir ${FIXTURE} --graph ${parsePath} --out ${ctxPath}`,
        );

        const result = JSON.parse(readFileSync(ctxPath, 'utf-8'));
        expect(result.graph).toBeDefined();
        expect(result.graph.nodes.length).toBeGreaterThan(0);
        expect(result.analysis).toBeDefined();
        // When baseline graph is from same repo without real changes, structural diff finds
        // 0 added/modified, so onlyChanged enrichment correctly returns 0 functions.
        expect(result.analysis.changed_functions).toBeDefined();
        expect(result.analysis.metadata).toBeDefined();

        rmSync(parsePath, { force: true });
        rmSync(ctxPath, { force: true });
    });

    it('--help should show all commands', () => {
        const output = execSync(`bun run ${CLI} --help`).toString();
        expect(output).toContain('parse');
        expect(output).toContain('analyze');
        expect(output).toContain('context');
    });
});

import { afterEach, describe, expect, it } from 'bun:test';
import { execSync } from 'child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import type { GraphData, GraphEdge } from '../../src/graph/types';

/**
 * `update` must agree with `parse` about the same repository.
 *
 * `update` re-parses only the changed files, and used to build its symbol table
 * from that slice alone. But the resolver's ambiguity checks are population
 * statistics — `isUnique(name)`, and `countDefinitions(name) >= max(15,
 * totalIndexedFiles() * 0.02)` — so a two-file table makes every name look
 * unique. A call that `parse --all` correctly resolved at the ambiguous tier
 * (0.30, discarded by the default `--min-confidence 0.5`) was promoted to the
 * unique tier (0.60) and shipped, aimed at whichever definition happened to sit
 * in the slice.
 *
 * `parse` already had the fix (its `baselineNodes` option, used by `context`);
 * `update` never called it, even though it loads the previous graph anyway.
 */

const CLI = resolve('src/cli.ts');
const FIXTURE = resolve('tests/fixtures/ambiguity-repo');

const tmpDirs: string[] = [];

afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
        rmSync(d, { recursive: true, force: true });
    }
});

function scratchRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'kodus-graph-update-'));
    tmpDirs.push(dir);
    cpSync(FIXTURE, dir, { recursive: true });
    return dir;
}

const callsOf = (g: GraphData): GraphEdge[] => g.edges.filter((e) => e.kind === 'CALLS');

const handleErrorEdge = (g: GraphData): GraphEdge | undefined =>
    callsOf(g).find((e) => e.target_qualified.endsWith('::handleError'));

function parseAll(repoDir: string): GraphData {
    const out = join(repoDir, 'graph.json');
    execSync(`bun run ${CLI} parse --all --repo-dir ${repoDir} --out ${out}`, { stdio: 'pipe' });
    return JSON.parse(readFileSync(out, 'utf-8')) as GraphData;
}

function updateAfterEditingSlice(repoDir: string): GraphData {
    const out = join(repoDir, 'graph.json');
    // Touch two files. `handleError` is declared once inside this slice and twice
    // outside it — the exact shape that made the slice-only table lie.
    writeFileSync(
        join(repoDir, 'src/caller.ts'),
        'declare function handleError(e: Error): string;\n\nexport function run(e: Error): string {\n    const msg = "x";\n    return handleError(e);\n}\n',
    );
    writeFileSync(
        join(repoDir, 'src/mod1.ts'),
        "export function handleError(e: Error): string {\n    return 'mod1-changed:' + e.message;\n}\n",
    );
    execSync(`bun run ${CLI} update --repo-dir ${repoDir} --graph ${out} --out ${out}`, { stdio: 'pipe' });
    return JSON.parse(readFileSync(out, 'utf-8')) as GraphData;
}

describe('update: symbol table is seeded from the baseline graph', () => {
    it('keeps a codebase-ambiguous name at the ambiguous tier, as parse does', () => {
        const repoDir = scratchRepo();

        const fromParse = handleErrorEdge(parseAll(repoDir));
        expect(fromParse?.tier).toBe('ambiguous');
        expect(fromParse?.confidence).toBe(0.3);

        const fromUpdate = handleErrorEdge(updateAfterEditingSlice(repoDir));

        // Before the fix: tier 'unique', confidence 0.60 — above the default
        // --min-confidence 0.5, so an edge parse discards was published instead.
        expect(fromUpdate?.tier).toBe(fromParse?.tier);
        expect(fromUpdate?.confidence).toBe(fromParse?.confidence);
    });

    it('does not manufacture confidence above the default min-confidence floor', () => {
        const repoDir = scratchRepo();
        parseAll(repoDir);

        const edge = handleErrorEdge(updateAfterEditingSlice(repoDir));

        // The point of the ambiguous tier is that 0.30 < 0.50 and the edge is
        // filtered out downstream. Promoting it past the floor is the whole bug.
        expect(edge?.confidence).toBeLessThan(0.5);
    });
});

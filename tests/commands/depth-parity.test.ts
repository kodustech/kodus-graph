import { describe, expect, it } from 'bun:test';
import { readFileSync, rmSync } from 'fs';
import { resolve } from 'path';

import { DEFAULT_BLAST_MAX_DEPTH } from '../../src/shared/constants';
import { runCli } from '../helpers/run-cli';

/**
 * Blast-radius depth is one number.
 *
 * It used to be spelled three times: `2` as `computeBlastRadius`'s signature
 * default, `'3'` on `context --max-depth`, `'2'` on `outline --max-depth`.
 * `analyze` had no `--max-depth` flag at all and passed `undefined`, silently
 * taking the signature's 2 — so `analyze` walked two hops over the same graph
 * `context` walked three, each internally consistent, and a caller three hops out
 * was visible to one command and invisible to the other.
 *
 * `depth-chain-repo` is a straight `core <- l1 <- l2 <- l3` chain: `l3` sits at
 * exactly depth 3 from `core`, so it appears only if the traversal really goes
 * that far.
 */

const FIXTURE = resolve('tests/fixtures/depth-chain-repo');

interface Analysis {
    blast_radius: { total_functions: number; by_depth: Record<string, Array<{ qualified_name: string }>> };
}

function analyze(graph: string, out: string, extraArgs: string[] = []): Analysis {
    runCli(['analyze', '--files', 'src/core.ts', '--graph', graph, '--repo-dir', FIXTURE, ...extraArgs, '--out', out]);
    return JSON.parse(readFileSync(out, 'utf-8')) as Analysis;
}

function parseFixture(graph: string): void {
    runCli(['parse', '--all', '--repo-dir', FIXTURE, '--out', graph]);
}

describe('blast-radius depth', () => {
    it('analyze reaches the shared default depth, not the old signature default of 2', () => {
        const graph = '/tmp/kodus-graph-depth-default.json';
        const out = '/tmp/kodus-graph-depth-default-analysis.json';
        try {
            parseFixture(graph);
            const result = analyze(graph, out);

            const depths = Object.keys(result.blast_radius.by_depth).map(Number).sort();
            // `l3` is three hops from `core`. At the old default of 2 it was absent
            // from analyze's output while present in context's.
            expect(Math.max(...depths)).toBe(DEFAULT_BLAST_MAX_DEPTH);
            expect(result.blast_radius.by_depth['3']?.map((e) => e.qualified_name)).toEqual(['src/l3.ts::l3']);
        } finally {
            rmSync(graph, { force: true });
            rmSync(out, { force: true });
        }
    });

    it('analyze honours --max-depth, a flag it previously did not accept', () => {
        const graph = '/tmp/kodus-graph-depth-flag.json';
        const shallow = '/tmp/kodus-graph-depth-flag-1.json';
        const deep = '/tmp/kodus-graph-depth-flag-3.json';
        try {
            parseFixture(graph);
            const at1 = analyze(graph, shallow, ['--max-depth', '1']);
            const at3 = analyze(graph, deep, ['--max-depth', '3']);

            expect(Object.keys(at1.blast_radius.by_depth)).toEqual(['1']);
            expect(at1.blast_radius.total_functions).toBeLessThan(at3.blast_radius.total_functions);
            expect(Object.keys(at3.blast_radius.by_depth).sort()).toEqual(['1', '2', '3']);
        } finally {
            for (const f of [graph, shallow, deep]) {
                rmSync(f, { force: true });
            }
        }
    });

    it('leaves no literal depth default for the flags to drift from', () => {
        expect(DEFAULT_BLAST_MAX_DEPTH).toBe(3);

        const cliSource = readFileSync(resolve('src/cli.ts'), 'utf-8');
        expect(cliSource).not.toContain(`'Blast radius BFS depth', '3'`);
        expect(cliSource).not.toContain(`'Blast-radius traversal depth', '2'`);
    });
});

import { describe, expect, it } from 'bun:test';
import { readFileSync, rmSync } from 'fs';
import { resolve } from 'path';

import type { GraphData, GraphEdge } from '../../src/graph/types';
import { runCli } from '../helpers/run-cli';

/**
 * Barrel parity.
 *
 * `tests/fixtures/barrel-repo` and `tests/fixtures/direct-repo` hold the same
 * four functions and the same two calls. The only difference is how the callers
 * import: through a re-export barrel (`from '../lib'`) or straight from the
 * defining file (`from '../lib/auth'`). The call graph must not be able to tell
 * them apart.
 *
 * Regression cover for the TS/JS re-export key mismatch: `languageOfFile`
 * returns the ast-grep-flavoured `'TypeScript'`, the import-resolver registry
 * was keyed `'ts'`/`'typescript'` only, so `buildReExportMap` silently returned
 * an empty map for every TS/JS barrel. Imports stayed pointed at the barrel,
 * and because a pure barrel declares no symbol, `graph/builder.ts` then dropped
 * every CALLS edge through it as "external". A barrel repo produced ZERO call
 * edges and reported `impactedCallers="0"` — indistinguishable, downstream,
 * from code nothing calls.
 *
 * No pre-existing fixture used a barrel, so 1219 passing tests said nothing.
 */

const BARREL = resolve('tests/fixtures/barrel-repo');
const DIRECT = resolve('tests/fixtures/direct-repo');

function parseRepo(repoDir: string, tag: string): GraphData {
    const out = `/tmp/kodus-graph-barrel-parity-${tag}.json`;
    runCli(['parse', '--all', '--repo-dir', repoDir, '--out', out]);
    const graph = JSON.parse(readFileSync(out, 'utf-8')) as GraphData;
    rmSync(out, { force: true });
    return graph;
}

const callsOf = (g: GraphData): GraphEdge[] => g.edges.filter((e) => e.kind === 'CALLS');

/** `src/app/login.ts::login -> src/lib/auth.ts::authenticate` */
const signature = (edges: GraphEdge[]): string[] =>
    edges.map((e) => `${e.source_qualified} -> ${e.target_qualified}`).sort();

describe('barrel parity: re-export imports resolve to the defining file', () => {
    const barrel = parseRepo(BARREL, 'barrel');
    const direct = parseRepo(DIRECT, 'direct');

    it('emits the same CALLS edges whether imports go through a barrel or not', () => {
        expect(signature(callsOf(barrel))).toEqual(signature(callsOf(direct)));
    });

    it('resolves barrel imports to the defining file, not the barrel', () => {
        const targets = callsOf(barrel).map((e) => e.target_qualified);

        expect(targets).toContain('src/lib/auth.ts::authenticate');
        expect(targets).toContain('src/lib/format.ts::formatDate');
        // The barrel declares no symbols; an edge naming it is a dangling target.
        for (const t of targets) {
            expect(t.startsWith('src/lib/index.ts')).toBe(false);
        }
    });

    it('does not silently drop calls made through a barrel', () => {
        // The original bug: 6 calls resolved by the resolver, 0 CALLS edges in
        // the graph. Assert the edges survive the builder's external-target filter.
        expect(callsOf(barrel).length).toBe(callsOf(direct).length);
        expect(callsOf(barrel).length).toBeGreaterThan(0);
    });

    it('keeps barrel-resolved edges at the same confidence as direct imports', () => {
        const conf = (edges: GraphEdge[]) => edges.map((e) => e.confidence).sort();
        expect(conf(callsOf(barrel))).toEqual(conf(callsOf(direct)));
    });

    it('does not pull unrelated consumers of the same barrel into a callee blast radius', () => {
        // `report` imports formatDate from the same barrel as `login` imports
        // authenticate. Resolving *through* the barrel must not couple them:
        // nothing should call authenticate except login.
        const callersOfAuthenticate = callsOf(barrel)
            .filter((e) => e.target_qualified === 'src/lib/auth.ts::authenticate')
            .map((e) => e.source_qualified);

        expect(callersOfAuthenticate).toEqual(['src/app/login.ts::login']);
    });
});

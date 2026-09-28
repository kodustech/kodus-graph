import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import type { GraphEdge, ParseOutput } from '../../src/graph/types';
import { runCli } from '../helpers/run-cli';

/**
 * `parse --min-confidence` leaves low-confidence CALLS edges out of the file.
 * On large Java repos the 0.30 tier and its `alternatives` lists are most of
 * the output (113 of 195 MB on Apache Dubbo) while `analyze` / `context`
 * discard them at their default 0.5 anyway.
 */

const FIXTURE = resolve('tests/fixtures/ambiguity-repo');
const tmpDirs: string[] = [];

afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
        rmSync(d, { recursive: true, force: true });
    }
});

function scratch(): string {
    const dir = mkdtempSync(join(tmpdir(), 'kodus-graph-min-confidence-'));
    tmpDirs.push(dir);
    cpSync(FIXTURE, dir, { recursive: true });
    return dir;
}

const read = (p: string) => JSON.parse(readFileSync(p, 'utf-8')) as ParseOutput;
const lowCalls = (g: ParseOutput): GraphEdge[] =>
    g.edges.filter((e) => e.kind === 'CALLS' && (e.confidence ?? 1) < 0.5);
const nonCalls = (g: ParseOutput) =>
    g.edges
        .filter((e) => e.kind !== 'CALLS')
        .map((e) => `${e.kind} ${e.source_qualified} ${e.target_qualified}`)
        .sort();

describe('parse --min-confidence', () => {
    it('drops CALLS below the cut, keeps every other edge kind, and records the cut', () => {
        const dir = scratch();
        const all = join(dir, 'all.json');
        const cut = join(dir, 'cut.json');
        runCli(['parse', '--all', '--repo-dir', dir, '--out', all]);
        runCli(['parse', '--all', '--repo-dir', dir, '--out', cut, '--min-confidence', '0.5']);
        const gAll = read(all);
        const gCut = read(cut);

        expect(lowCalls(gAll).length).toBeGreaterThan(0); // the fixture really has 0.30 edges
        expect(lowCalls(gCut)).toEqual([]);
        expect(nonCalls(gCut)).toEqual(nonCalls(gAll)); // TESTED_BY etc. untouched
        expect(gCut.metadata.min_confidence).toBe(0.5);
        expect(gAll.metadata.min_confidence).toBeUndefined();
    });

    it('keeps the cut across update', () => {
        const dir = scratch();
        const out = join(dir, 'graph.json');
        runCli(['parse', '--all', '--repo-dir', dir, '--out', out, '--min-confidence', '0.5']);
        // Touch every source file so update re-parses (and re-resolves) all of them.
        for (const f of execFileSync('find', [join(dir, 'src'), '-name', '*.ts'], { encoding: 'utf-8' })
            .trim()
            .split('\n')) {
            writeFileSync(f, `${readFileSync(f, 'utf-8')}\n// touched\n`);
        }
        runCli(['update', '--repo-dir', dir, '--graph', out, '--out', out]);
        const g = read(out);
        expect(lowCalls(g)).toEqual([]);
        expect(g.metadata.min_confidence).toBe(0.5);
    });

    it('rejects a value outside 0..1', () => {
        const dir = scratch();
        expect(() =>
            runCli(['parse', '--all', '--repo-dir', dir, '--out', join(dir, 'g.json'), '--min-confidence', '5']),
        ).toThrow();
    });
});

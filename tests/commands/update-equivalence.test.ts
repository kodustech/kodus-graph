import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import type { GraphEdge, ParseOutput } from '../../src/graph/types';
import { pickClosestCandidate } from '../../src/resolver/call-resolver';
import { runCli } from '../helpers/run-cli';

/**
 * `update` must produce the graph a fresh `parse` would.
 *
 * It used to re-parse only the changed files and keep every other edge as it
 * was, so a renamed or deleted target left callers pointing at nothing and a
 * newly defined one never got its edge. Re-parsing the dependents exposed the
 * rest: barrels outside the slice weren't followed, symbol-less files looked new
 * on every run, types / return types / class hierarchy of untouched files were
 * unknown, and ties between same-named candidates depended on insertion order.
 * The fixture below exercises each of those.
 */

const tmpDirs: string[] = [];
afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
        rmSync(d, { recursive: true, force: true });
    }
});

const FILES: Record<string, string> = {
    // Symbol-less file: no node, so its hash only lives in metadata.file_hashes.
    'src/constants.ts': `export const LIMIT = 10;\n`,
    'src/model/status.ts': `export enum Status {\n    Open = 'open',\n    Closed = 'closed',\n}\n`,
    'src/model/base.ts': `export class BaseRepo {\n    save(id: string): string {\n        return id;\n    }\n}\n`,
    'src/model/user-repo.ts': `import { BaseRepo } from './base';\n\nexport class UserRepo extends BaseRepo {\n    find(id: string): string {\n        return id;\n    }\n}\n`,
    'src/model/factory.ts': `import { UserRepo } from './user-repo';\n\nexport function makeRepo(): UserRepo {\n    return new UserRepo();\n}\n`,
    'src/util/format.ts': `export function formatId(id: string): string {\n    return id.trim();\n}\n`,
    // Barrel: re-exports only.
    'src/util/index.ts': `export { formatId } from './format';\n`,
    'src/app.ts': `import { LIMIT } from './constants';
import { makeRepo } from './model/factory';
import { Status } from './model/status';
import { formatId } from './util';

export function handle(id: string, status: Status): string {
    const repo = makeRepo();
    repo.save(formatId(id));
    return status === Status.Open ? repo.find(id) : String(LIMIT);
}
`,
    'src/other.ts': `import { formatId } from './util';\n\nexport function other(id: string): string {\n    return formatId(id);\n}\n`,
};

function repo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'kodus-graph-update-equivalence-'));
    tmpDirs.push(dir);
    for (const [p, content] of Object.entries(FILES)) {
        mkdirSync(join(dir, p, '..'), { recursive: true });
        writeFileSync(join(dir, p), content);
    }
    writeFileSync(join(dir, '.gitignore'), 'graph*.json\n');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return dir;
}

const edgeKey = (e: GraphEdge) =>
    `${e.kind} ${e.source_qualified} > ${e.target_qualified} @${e.line} ${e.confidence ?? ''}`;
const read = (p: string) => JSON.parse(readFileSync(p, 'utf-8')) as ParseOutput;

/** Parse, apply `mutate`, then compare `update` of the old graph with a fresh parse. */
function updateMatchesParse(mutate: (dir: string) => void): { update: ParseOutput; parse: ParseOutput } {
    const dir = repo();
    const updated = join(dir, 'graph-updated.json');
    const fresh = join(dir, 'graph-fresh.json');
    runCli(['parse', '--all', '--repo-dir', dir, '--out', updated]);
    mutate(dir);
    runCli(['update', '--repo-dir', dir, '--graph', updated, '--out', updated]);
    runCli(['parse', '--all', '--repo-dir', dir, '--out', fresh]);
    const u = read(updated);
    const p = read(fresh);
    expect(u.nodes.map((n) => n.qualified_name).sort()).toEqual(p.nodes.map((n) => n.qualified_name).sort());
    expect(u.edges.map(edgeKey).sort()).toEqual(p.edges.map(edgeKey).sort());
    return { update: u, parse: p };
}

describe('update produces the same graph as a fresh parse', () => {
    it('after renaming a function its untouched callers still call', () => {
        const { update } = updateMatchesParse((dir) => {
            const f = join(dir, 'src/util/format.ts');
            writeFileSync(f, readFileSync(f, 'utf-8').replace('formatId(', 'formatIdentifier('));
        });
        expect(update.edges.some((e) => e.target_qualified === 'src/util/format.ts::formatId')).toBe(false);
    });

    it('after defining a function an untouched file already called', () => {
        updateMatchesParse((dir) => {
            writeFileSync(
                join(dir, 'src/caller.ts'),
                `import { later } from './util/format';\n\nexport function caller(): string {\n    return later();\n}\n`,
            );
        });
        // Two-step variant: the call exists first, the target arrives in the update.
        const dir = repo();
        const updated = join(dir, 'graph-updated.json');
        const fresh = join(dir, 'graph-fresh.json');
        writeFileSync(
            join(dir, 'src/caller.ts'),
            `import { later } from './util/format';\n\nexport function caller(): string {\n    return later();\n}\n`,
        );
        runCli(['parse', '--all', '--repo-dir', dir, '--out', updated]);
        writeFileSync(
            join(dir, 'src/util/format.ts'),
            `${FILES['src/util/format.ts']}\nexport function later(): string {\n    return 'x';\n}\n`,
        );
        runCli(['update', '--repo-dir', dir, '--graph', updated, '--out', updated]);
        runCli(['parse', '--all', '--repo-dir', dir, '--out', fresh]);
        expect(read(updated).edges.map(edgeKey).sort()).toEqual(read(fresh).edges.map(edgeKey).sort());
    });

    it('after deleting a file its untouched importers used', () => {
        const { update } = updateMatchesParse((dir) => rmSync(join(dir, 'src/model/factory.ts')));
        expect(update.edges.some((e) => e.target_qualified.startsWith('src/model/factory.ts'))).toBe(false);
    });

    it('when the edit is in a file whose callers go through a barrel, a factory and a base class', () => {
        updateMatchesParse((dir) => {
            const f = join(dir, 'src/app.ts');
            writeFileSync(f, `${readFileSync(f, 'utf-8')}\n// touched\n`);
        });
    });
});

describe('update bookkeeping', () => {
    it('does not treat symbol-less files as new on every run', () => {
        const dir = repo();
        const out = join(dir, 'graph.json');
        runCli(['parse', '--all', '--repo-dir', dir, '--out', out]);
        const meta = read(out).metadata;
        expect(meta.file_hashes?.['src/constants.ts']).toBeDefined();
        expect(meta.re_exports?.some((r) => r.file === 'src/util/index.ts')).toBe(true);
        const before = readFileSync(out, 'utf-8');
        runCli(['update', '--repo-dir', dir, '--graph', out, '--out', out]);
        expect(read(out).edges.map(edgeKey).sort()).toEqual(
            (JSON.parse(before) as ParseOutput).edges.map(edgeKey).sort(),
        );
    });

    it('parse emits USES_TYPE to an enum declared in another file', () => {
        const dir = repo();
        const out = join(dir, 'graph.json');
        runCli(['parse', '--all', '--repo-dir', dir, '--out', out]);
        expect(
            read(out).edges.some(
                (e) =>
                    e.kind === 'USES_TYPE' &&
                    e.source_qualified === 'src/app.ts::handle' &&
                    e.target_qualified === 'src/model/status.ts::Status',
            ),
        ).toBe(true);
    });
});

describe('pickClosestCandidate', () => {
    it('breaks ties the same way whatever order the candidates come in', () => {
        const a = 'src/x/one.ts::run';
        const b = 'src/y/two.ts::run';
        expect(pickClosestCandidate([a, b], 'lib/caller.ts')).toBe(pickClosestCandidate([b, a], 'lib/caller.ts'));
    });
});

import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync, spawnSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

import type { ParseOutput } from '../../src/graph/types';
import { runCli } from '../helpers/run-cli';

/**
 * `update` must re-discover the same file set `parse` did.
 *
 * It used to call `discoverFiles(repoDir)` with no options, so a graph built
 * with `parse --exclude` got the excluded files back on the first `update`, and
 * a graph built with `--no-gitignore` lost its ignored files. The discovery
 * settings now travel in `metadata.discovery`.
 */

const tmpDirs: string[] = [];

afterEach(() => {
    for (const d of tmpDirs.splice(0)) {
        rmSync(d, { recursive: true, force: true });
    }
});

function gitRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'kodus-graph-update-discovery-'));
    tmpDirs.push(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    mkdirSync(join(dir, 'generated'), { recursive: true });
    writeFileSync(join(dir, '.gitignore'), 'generated/\ngraph.json\n');
    writeFileSync(join(dir, 'src/app.ts'), 'export function app(): number {\n    return 1;\n}\n');
    writeFileSync(join(dir, 'src/skip.ts'), 'export function skip(): number {\n    return 2;\n}\n');
    writeFileSync(join(dir, 'generated/api.ts'), 'export function api(): number {\n    return 3;\n}\n');
    execFileSync('git', ['init', '-q'], { cwd: dir });
    return dir;
}

function files(graphPath: string): string[] {
    const g = JSON.parse(readFileSync(graphPath, 'utf-8')) as ParseOutput;
    return [...new Set(g.nodes.map((n) => n.file_path))].sort();
}

function updateCapturingStderr(dir: string, out: string): string {
    const r = spawnSync(
        process.execPath,
        ['run', resolve('src/cli.ts'), 'update', '--repo-dir', dir, '--graph', out, '--out', out],
        {
            encoding: 'utf-8',
        },
    );
    expect(r.status).toBe(0);
    return r.stderr;
}

function touchApp(dir: string): void {
    writeFileSync(join(dir, 'src/app.ts'), 'export function app(): number {\n    return 42;\n}\n');
}

describe('update: re-discovers with the settings parse used', () => {
    it('records the walk (not the requested gitignore flag) when there is no git', () => {
        const dir = mkdtempSync(join(tmpdir(), 'kodus-graph-update-discovery-nogit-'));
        tmpDirs.push(dir);
        mkdirSync(join(dir, 'src'), { recursive: true });
        writeFileSync(join(dir, 'src/app.ts'), 'export function app(): number {\n    return 1;\n}\n');
        const out = join(dir, 'graph.json');
        runCli(['parse', '--all', '--repo-dir', dir, '--out', out]);
        const meta = (JSON.parse(readFileSync(out, 'utf-8')) as ParseOutput).metadata;
        expect(meta.discovery?.respect_gitignore).toBe(false);
        expect(meta.discovery?.gitignore_requested).toBe(true);
    });

    it('records an explicit --files list as not produced by git', () => {
        const dir = gitRepo();
        const out = join(dir, 'graph.json');
        runCli(['parse', '--files', 'src/app.ts', '--repo-dir', dir, '--out', out]);
        const meta = (JSON.parse(readFileSync(out, 'utf-8')) as ParseOutput).metadata;
        expect(meta.discovery?.respect_gitignore).toBe(false);
        expect(meta.discovery?.gitignore_requested).toBe(true);
    });

    it('replays an explicit --files list: keeps a named git-ignored file, pulls in nothing else', () => {
        const dir = gitRepo();
        const out = join(dir, 'graph.json');
        runCli(['parse', '--files', 'src/app.ts', 'generated/api.ts', '--repo-dir', dir, '--out', out]);
        expect(files(out)).toEqual(['generated/api.ts', 'src/app.ts']);

        touchApp(dir);
        runCli(['update', '--repo-dir', dir, '--graph', out, '--out', out]);
        expect(files(out)).toEqual(['generated/api.ts', 'src/app.ts']);

        // Missing from disk: out of the graph, but still named, so it returns.
        rmSync(join(dir, 'generated/api.ts'));
        runCli(['update', '--repo-dir', dir, '--graph', out, '--out', out]);
        expect(files(out)).toEqual(['src/app.ts']);
        const meta = (JSON.parse(readFileSync(out, 'utf-8')) as ParseOutput).metadata;
        expect(meta.discovery?.files).toEqual(['src/app.ts', 'generated/api.ts']);

        writeFileSync(join(dir, 'generated/api.ts'), 'export function api(): number {\n    return 4;\n}\n');
        runCli(['update', '--repo-dir', dir, '--graph', out, '--out', out]);
        expect(files(out)).toEqual(['generated/api.ts', 'src/app.ts']);
    });

    it('treats an empty explicit list as no list (re-discovers instead of wiping the graph)', () => {
        const dir = gitRepo();
        const out = join(dir, 'graph.json');
        runCli(['parse', '--all', '--repo-dir', dir, '--out', out]);
        const g = JSON.parse(readFileSync(out, 'utf-8')) as ParseOutput;
        g.metadata.discovery = { files: [], gitignore_requested: true, respect_gitignore: true };
        writeFileSync(out, JSON.stringify(g));

        touchApp(dir);
        runCli(['update', '--repo-dir', dir, '--graph', out, '--out', out]);
        expect(files(out)).toEqual(['src/app.ts', 'src/skip.ts']);
    });

    it('recovers from a one-off git failure instead of pinning the graph to the walk', () => {
        const dir = gitRepo();
        const out = join(dir, 'graph.json');
        const head = readFileSync(join(dir, '.git/HEAD'), 'utf-8');
        runCli(['parse', '--all', '--repo-dir', dir, '--out', out]);
        expect(files(out)).toEqual(['src/app.ts', 'src/skip.ts']);

        // git breaks for one run: update walks, so the ignored file comes in, and says so.
        writeFileSync(join(dir, '.git/HEAD'), 'garbage\n');
        touchApp(dir);
        const broken = updateCapturingStderr(dir, out);
        expect(files(out)).toEqual(['generated/api.ts', 'src/app.ts', 'src/skip.ts']);
        expect(broken).toContain('file discovery changed');

        // git works again: the next update goes back to the git listing.
        writeFileSync(join(dir, '.git/HEAD'), head);
        const recovered = updateCapturingStderr(dir, out);
        expect(files(out)).toEqual(['src/app.ts', 'src/skip.ts']);
        expect(recovered).toContain('file discovery changed');
        const meta = (JSON.parse(readFileSync(out, 'utf-8')) as ParseOutput).metadata;
        expect(meta.discovery?.respect_gitignore).toBe(true);
    });

    it('keeps --exclude in force across update', () => {
        const dir = gitRepo();
        const out = join(dir, 'graph.json');
        runCli(['parse', '--all', '--repo-dir', dir, '--out', out, '--exclude', 'src/skip.ts']);
        expect(files(out)).toEqual(['src/app.ts']);

        touchApp(dir);
        runCli(['update', '--repo-dir', dir, '--graph', out, '--out', out]);
        expect(files(out)).toEqual(['src/app.ts']);
    });

    it('keeps ignored files across update when parsed with --no-gitignore', () => {
        const dir = gitRepo();
        const out = join(dir, 'graph.json');
        runCli(['parse', '--all', '--repo-dir', dir, '--out', out, '--no-gitignore']);
        expect(files(out)).toEqual(['generated/api.ts', 'src/app.ts', 'src/skip.ts']);

        touchApp(dir);
        runCli(['update', '--repo-dir', dir, '--graph', out, '--out', out]);
        expect(files(out)).toEqual(['generated/api.ts', 'src/app.ts', 'src/skip.ts']);
        const meta = (JSON.parse(readFileSync(out, 'utf-8')) as ParseOutput).metadata;
        expect(meta.discovery?.respect_gitignore).toBe(false);
    });

    it('drops ignored files from a legacy graph that has no discovery metadata', () => {
        const dir = gitRepo();
        const out = join(dir, 'graph.json');
        runCli(['parse', '--all', '--repo-dir', dir, '--out', out, '--no-gitignore']);
        const legacy = JSON.parse(readFileSync(out, 'utf-8')) as ParseOutput;
        delete legacy.metadata.discovery;
        writeFileSync(out, JSON.stringify(legacy));

        runCli(['update', '--repo-dir', dir, '--graph', out, '--out', out]);
        expect(files(out)).toEqual(['src/app.ts', 'src/skip.ts']);
    });
});

import { afterEach, describe, expect, it } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

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

function touchApp(dir: string): void {
    writeFileSync(join(dir, 'src/app.ts'), 'export function app(): number {\n    return 42;\n}\n');
}

describe('update: re-discovers with the settings parse used', () => {
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

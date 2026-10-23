import { describe, expect, it, spyOn } from 'bun:test';
import { execFileSync } from 'child_process';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { discoverFiles } from '../../src/parser/discovery';

const TMP = '/tmp/kodus-graph-discovery-test';

function setupFixture() {
    rmSync(TMP, { recursive: true, force: true });
    mkdirSync(join(TMP, 'src/core'), { recursive: true });
    mkdirSync(join(TMP, 'src/utils'), { recursive: true });
    mkdirSync(join(TMP, 'tests'), { recursive: true });
    mkdirSync(join(TMP, 'vendor'), { recursive: true });
    writeFileSync(join(TMP, 'src/core/auth.ts'), 'export function login() {}');
    writeFileSync(join(TMP, 'src/core/auth.test.ts'), 'test("login", () => {})');
    writeFileSync(join(TMP, 'src/utils/helpers.ts'), 'export function help() {}');
    writeFileSync(join(TMP, 'tests/e2e.ts'), 'test("e2e", () => {})');
    writeFileSync(join(TMP, 'vendor/lib.ts'), 'export function vendored() {}');
}

describe('discoverFiles', () => {
    const tmpDir = '/tmp/kodus-graph-test-discovery';

    it('should find supported files and skip node_modules', () => {
        mkdirSync(join(tmpDir, 'src'), { recursive: true });
        mkdirSync(join(tmpDir, 'node_modules/pkg'), { recursive: true });
        writeFileSync(join(tmpDir, 'src/app.ts'), 'const x = 1;');
        writeFileSync(join(tmpDir, 'src/util.py'), 'x = 1');
        writeFileSync(join(tmpDir, 'src/readme.txt'), 'hello');
        writeFileSync(join(tmpDir, 'node_modules/pkg/index.js'), 'module.exports = {}');

        const files = discoverFiles(tmpDir);
        expect(files).toContain(join(tmpDir, 'src/app.ts'));
        expect(files).toContain(join(tmpDir, 'src/util.py'));
        expect(files).not.toContain(join(tmpDir, 'src/readme.txt'));
        expect(files).not.toContain(join(tmpDir, 'node_modules/pkg/index.js'));

        rmSync(tmpDir, { recursive: true });
    });

    it('should filter to specific files when provided', () => {
        mkdirSync(join(tmpDir, 'src'), { recursive: true });
        writeFileSync(join(tmpDir, 'src/a.ts'), 'const a = 1;');
        writeFileSync(join(tmpDir, 'src/b.ts'), 'const b = 2;');

        const files = discoverFiles(tmpDir, ['src/a.ts']);
        expect(files).toHaveLength(1);
        expect(files[0]).toContain('a.ts');

        rmSync(tmpDir, { recursive: true });
    });

    it('should skip minified and bundled files', () => {
        mkdirSync(join(tmpDir, 'src'), { recursive: true });
        writeFileSync(join(tmpDir, 'src/app.ts'), 'const x = 1;');
        writeFileSync(join(tmpDir, 'src/chart.min.js'), 'minified code');
        writeFileSync(join(tmpDir, 'src/vendor.bundle.js'), 'bundled code');
        writeFileSync(join(tmpDir, 'src/viz-3.0.1.js'), 'vendored code'); // not minified, should still be included
        writeFileSync(join(tmpDir, 'src/main.chunk.js'), 'chunk code');

        const files = discoverFiles(tmpDir);
        expect(files).toContain(join(tmpDir, 'src/app.ts'));
        expect(files).toContain(join(tmpDir, 'src/viz-3.0.1.js'));
        expect(files).not.toContain(join(tmpDir, 'src/chart.min.js'));
        expect(files).not.toContain(join(tmpDir, 'src/vendor.bundle.js'));
        expect(files).not.toContain(join(tmpDir, 'src/main.chunk.js'));

        rmSync(tmpDir, { recursive: true });
    });
});

describe('discoverFiles with include/exclude', () => {
    it('should return all files when no include/exclude', () => {
        setupFixture();
        const files = discoverFiles(TMP);
        // vendor is in SKIP_DIRS, so 4 files: auth.ts, auth.test.ts, helpers.ts, e2e.ts
        expect(files.length).toBe(4);
        rmSync(TMP, { recursive: true, force: true });
    });

    it('should filter by include pattern', () => {
        setupFixture();
        const files = discoverFiles(TMP, undefined, ['src/core/**']);
        const names = files.map((f) => f.split('/').pop());
        expect(names).toContain('auth.ts');
        expect(names).toContain('auth.test.ts');
        expect(names).not.toContain('helpers.ts');
        expect(names).not.toContain('e2e.ts');
        rmSync(TMP, { recursive: true, force: true });
    });

    it('should filter by exclude pattern', () => {
        setupFixture();
        const files = discoverFiles(TMP, undefined, undefined, ['**/*.test.*']);
        const names = files.map((f) => f.split('/').pop());
        expect(names).toContain('auth.ts');
        expect(names).toContain('helpers.ts');
        expect(names).not.toContain('auth.test.ts');
        rmSync(TMP, { recursive: true, force: true });
    });

    it('should apply include then exclude', () => {
        setupFixture();
        const files = discoverFiles(TMP, undefined, ['src/**'], ['**/*.test.*']);
        const names = files.map((f) => f.split('/').pop());
        expect(names).toContain('auth.ts');
        expect(names).toContain('helpers.ts');
        expect(names).not.toContain('auth.test.ts');
        expect(names).not.toContain('e2e.ts');
        rmSync(TMP, { recursive: true, force: true });
    });
});

describe('discoverFiles --max-files guard', () => {
    it('throws when the walk exceeds maxFiles and allowPartial is off', () => {
        setupFixture();
        // The fixture walk finds 4 files; cap at 2 with no escape hatch.
        expect(() => discoverFiles(TMP, undefined, undefined, undefined, { maxFiles: 2 })).toThrow(
            /over the --max-files cap/,
        );
        rmSync(TMP, { recursive: true, force: true });
    });

    it('truncates to maxFiles when allowPartial is on', () => {
        setupFixture();
        const files = discoverFiles(TMP, undefined, undefined, undefined, { maxFiles: 2, allowPartial: true });
        expect(files.length).toBe(2);
        rmSync(TMP, { recursive: true, force: true });
    });

    it('does not cap when maxFiles is unset', () => {
        setupFixture();
        const files = discoverFiles(TMP, undefined, undefined, undefined, {});
        expect(files.length).toBe(4);
        rmSync(TMP, { recursive: true, force: true });
    });

    it('never caps an explicit filterFiles list', () => {
        setupFixture();
        // Two files named explicitly, cap of 1 — the list is honored in full.
        const files = discoverFiles(TMP, ['src/core/auth.ts', 'src/utils/helpers.ts'], undefined, undefined, {
            maxFiles: 1,
        });
        expect(files.length).toBe(2);
        rmSync(TMP, { recursive: true, force: true });
    });
});

describe('discoverFiles inside a git work tree', () => {
    const GIT_TMP = '/tmp/kodus-graph-discovery-git-test';

    function git(...args: string[]): void {
        execFileSync('git', args, { cwd: GIT_TMP, stdio: 'ignore' });
    }

    function setupGitRepo(): void {
        rmSync(GIT_TMP, { recursive: true, force: true });
        mkdirSync(join(GIT_TMP, 'src'), { recursive: true });
        mkdirSync(join(GIT_TMP, '.worktrees/copy/src'), { recursive: true });
        mkdirSync(join(GIT_TMP, 'generated'), { recursive: true });
        mkdirSync(join(GIT_TMP, 'pkg/out-of-tree'), { recursive: true });
        mkdirSync(join(GIT_TMP, 'dist'), { recursive: true });
        writeFileSync(join(GIT_TMP, '.gitignore'), '.worktrees/\ngenerated/\n');
        writeFileSync(join(GIT_TMP, 'pkg/.gitignore'), 'out-of-tree/\n');
        writeFileSync(join(GIT_TMP, 'src/app.ts'), 'export const app = 1;');
        writeFileSync(join(GIT_TMP, 'src/gone.ts'), 'export const gone = 1;');
        writeFileSync(join(GIT_TMP, 'dist/bundle.ts'), 'export const built = 1;');
        writeFileSync(join(GIT_TMP, '.worktrees/copy/src/app.ts'), 'export const app = 1;');
        writeFileSync(join(GIT_TMP, 'generated/api.ts'), 'export const api = 1;');
        writeFileSync(join(GIT_TMP, 'pkg/out-of-tree/x.ts'), 'export const x = 1;');
        git('init', '-q');
        git('add', '.');
        git('add', '-f', 'dist/bundle.ts');
        git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
        rmSync(join(GIT_TMP, 'src/gone.ts'));
        writeFileSync(join(GIT_TMP, 'src/untracked.ts'), 'export const u = 1;');
    }

    it('skips paths ignored by root and nested .gitignore files', () => {
        setupGitRepo();
        const rel = discoverFiles(GIT_TMP)
            .map((f) => f.slice(GIT_TMP.length + 1))
            .sort();
        expect(rel).toEqual(['src/app.ts', 'src/untracked.ts']);
        rmSync(GIT_TMP, { recursive: true, force: true });
    });

    it('still skips SKIP_DIRS even when their files are tracked', () => {
        setupGitRepo();
        const files = discoverFiles(GIT_TMP);
        expect(files).not.toContain(join(GIT_TMP, 'dist/bundle.ts'));
        rmSync(GIT_TMP, { recursive: true, force: true });
    });

    it('drops files tracked in the index but deleted from disk', () => {
        setupGitRepo();
        const files = discoverFiles(GIT_TMP);
        expect(files).not.toContain(join(GIT_TMP, 'src/gone.ts'));
        rmSync(GIT_TMP, { recursive: true, force: true });
    });

    it('reads ignored paths when respectGitignore is false, still skipping SKIP_DIRS', () => {
        setupGitRepo();
        const rel = discoverFiles(GIT_TMP, undefined, undefined, undefined, { respectGitignore: false })
            .map((f) => f.slice(GIT_TMP.length + 1))
            .sort();
        expect(rel).toEqual([
            '.worktrees/copy/src/app.ts',
            'generated/api.ts',
            'pkg/out-of-tree/x.ts',
            'src/app.ts',
            'src/untracked.ts',
        ]);
        rmSync(GIT_TMP, { recursive: true, force: true });
    });

    it('lists only the subtree when repoDir is a subdirectory of the work tree', () => {
        setupGitRepo();
        // pkg/ holds only ignored files: nothing to parse, and no fallback walk.
        expect(discoverFiles(join(GIT_TMP, 'pkg'))).toEqual([]);
        const src = discoverFiles(join(GIT_TMP, 'src')).sort();
        expect(src).toEqual([join(GIT_TMP, 'src/app.ts'), join(GIT_TMP, 'src/untracked.ts')]);
        rmSync(GIT_TMP, { recursive: true, force: true });
    });

    it('walks a repoDir that the enclosing repo ignores (explicitly requested)', () => {
        setupGitRepo();
        const files = discoverFiles(join(GIT_TMP, 'generated'));
        expect(files).toEqual([join(GIT_TMP, 'generated/api.ts')]);
        rmSync(GIT_TMP, { recursive: true, force: true });
    });

    it('reports the strategy actually used', () => {
        setupGitRepo();
        const viaGit: { strategy?: 'git' | 'walk' } = {};
        discoverFiles(GIT_TMP, undefined, undefined, undefined, { report: viaGit });
        expect(viaGit.strategy).toBe('git');
        const optedOut: { strategy?: 'git' | 'walk' } = {};
        discoverFiles(GIT_TMP, undefined, undefined, undefined, { respectGitignore: false, report: optedOut });
        expect(optedOut.strategy).toBe('walk');
        rmSync(GIT_TMP, { recursive: true, force: true });
    });

    it('warns and reports a walk when git cannot list a checkout', () => {
        setupGitRepo();
        // A checkout git refuses to read (corrupt repo, "dubious ownership" on a CI mount).
        writeFileSync(join(GIT_TMP, '.git/HEAD'), 'garbage\n');
        const writes: string[] = [];
        const spy = spyOn(process.stderr, 'write').mockImplementation(((chunk: string) => {
            writes.push(String(chunk));
            return true;
        }) as typeof process.stderr.write);
        try {
            const report: { strategy?: 'git' | 'walk' } = {};
            const files = discoverFiles(GIT_TMP, undefined, undefined, undefined, { report });
            expect(report.strategy).toBe('walk');
            expect(files).toContain(join(GIT_TMP, 'generated/api.ts'));
            expect(writes.some((w) => w.includes('git could not list files'))).toBe(true);
        } finally {
            spy.mockRestore();
            rmSync(GIT_TMP, { recursive: true, force: true });
        }
    });

    it('applies include/exclude on top of the git listing', () => {
        setupGitRepo();
        const files = discoverFiles(GIT_TMP, undefined, undefined, ['src/untracked.ts']);
        expect(files).toEqual([join(GIT_TMP, 'src/app.ts')]);
        rmSync(GIT_TMP, { recursive: true, force: true });
    });
});

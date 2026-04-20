import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { execSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { executeDiff } from '../../src/commands/diff';

// Import to trigger language registration.
import '../../src/parser/languages';

/**
 * Integration test for `diff --base <ref>`.
 *
 * Creates a throwaway git repo with two commits modifying the same TypeScript
 * file. Calling `executeDiff` with `--base HEAD~1` should produce a NON-empty
 * diff — previously the command compared HEAD against HEAD (bug B5).
 */
describe('executeDiff --base <ref>', () => {
    let tmpRepo: string;
    let outPath: string;

    beforeAll(() => {
        tmpRepo = mkdtempSync(join(tmpdir(), 'kodus-graph-diff-base-'));
        outPath = join(tmpRepo, 'diff.json');

        const run = (cmd: string): void => {
            execSync(cmd, {
                cwd: tmpRepo,
                stdio: 'ignore',
                // Stop git from picking up the outer repo's hooks / config.
                env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
            });
        };

        run('git init -q -b main');
        run('git config user.email "test@example.com"');
        run('git config user.name "Test"');
        run('git config commit.gpgsign false');

        // Initial commit: simple file with one function.
        writeFileSync(
            join(tmpRepo, 'a.ts'),
            `export function add(x: number, y: number): number {\n    return x + y;\n}\n`,
        );
        run('git add a.ts');
        run('git commit -q -m initial');

        // Second commit: change the BODY of add (content_hash differs) and
        // also widen the signature so "params" contract diff triggers.
        writeFileSync(
            join(tmpRepo, 'a.ts'),
            `export function add(x: number, y: number, z: number): number {\n    const s = x + y + z;\n    return s;\n}\n`,
        );
        run('git add a.ts');
        run('git commit -q -m modify');
    });

    afterAll(() => {
        if (tmpRepo) {
            rmSync(tmpRepo, { recursive: true, force: true });
        }
    });

    it('detects modification between HEAD~1 and HEAD (no longer compares HEAD vs HEAD)', async () => {
        await executeDiff({
            repoDir: tmpRepo,
            base: 'HEAD~1',
            graph: join(tmpRepo, 'unused.json'), // not loaded in base-ref flow
            out: outPath,
        });

        const result = JSON.parse(readFileSync(outPath, 'utf-8'));
        // Before the fix: added=0, removed=0, modified=0 regardless of diff.
        // After the fix: the add() signature widening + body rewrite must register.
        expect(result.summary.modified).toBeGreaterThanOrEqual(1);
        const mod = result.nodes.modified.find((m: { qualified_name: string }) => m.qualified_name.endsWith('::add'));
        expect(mod).toBeDefined();
        // body change must be picked up via content_hash comparison
        expect(mod.changes).toContain('body');
        // params widening must be picked up as a contract diff
        expect(mod.contract_diffs.some((d: { field: string }) => d.field === 'params')).toBe(true);
    });

    it('treats newly-added files as "added" (skips base-side parse)', async () => {
        // Add a new file in a third commit. HEAD now has b.ts that never
        // existed at HEAD~1 — git show should fail, and the base-side parse
        // should skip it, producing an "added" delta.
        execSync('git checkout -q -b added-file', { cwd: tmpRepo });
        writeFileSync(join(tmpRepo, 'b.ts'), 'export function brand(): string { return "kodus"; }\n');
        execSync('git add b.ts && git commit -q -m "add b"', {
            cwd: tmpRepo,
            env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
        });

        await executeDiff({
            repoDir: tmpRepo,
            base: 'HEAD~1',
            graph: join(tmpRepo, 'unused.json'),
            out: outPath,
        });

        const result = JSON.parse(readFileSync(outPath, 'utf-8'));
        expect(result.summary.added).toBeGreaterThanOrEqual(1);
        expect(result.nodes.added.some((n: { qualified_name: string }) => n.qualified_name.endsWith('::brand'))).toBe(
            true,
        );
    });
});

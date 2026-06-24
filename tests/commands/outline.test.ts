import { describe, expect, it } from 'bun:test';
import { readFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { executeOutline } from '../../src/commands/outline';
import { executeParse } from '../../src/commands/parse';
// Import to trigger language registration.
import '../../src/parser/languages';

describe('executeOutline', () => {
    const fixtureDir = resolve('tests/fixtures/sample-repo');
    const txtPath = '/tmp/kodus-graph-test-outline.txt';
    const jsonPath = '/tmp/kodus-graph-test-outline.json';

    it('renders a nested structural outline (text)', async () => {
        await executeOutline({
            repoDir: fixtureDir,
            files: ['src/auth.ts'],
            format: 'text',
            out: txtPath,
        });
        const out = readFileSync(txtPath, 'utf8');

        // Top-level declarations.
        expect(out).toContain('interface AuthConfig');
        expect(out).toContain('class AuthService');
        expect(out).toContain('fn hashPassword(password: string): string');
        // Method nested under its class, on a deeper indent than the class line.
        const classIdx = out.indexOf('class AuthService');
        const methodIdx = out.indexOf('method authenticate');
        expect(methodIdx).toBeGreaterThan(classIdx);
        expect(out).toMatch(/ {6}method authenticate/); // nested indent
        // async flag surfaced.
        expect(out).toMatch(/method authenticate.*\[.*async.*\]/);

        rmSync(txtPath, { force: true });
    });

    it('emits machine-readable JSON with members nested under the class', async () => {
        await executeOutline({
            repoDir: fixtureDir,
            files: ['src/auth.ts'],
            format: 'json',
            out: jsonPath,
        });
        const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as Array<{
            file: string;
            symbols: Array<{
                kind: string;
                name: string;
                signature: string;
                members?: Array<{ kind: string; name: string; is_async: boolean }>;
            }>;
        }>;

        expect(parsed).toHaveLength(1);
        expect(parsed[0].file).toBe('src/auth.ts');

        const cls = parsed[0].symbols.find((s) => s.name === 'AuthService');
        expect(cls).toBeDefined();
        expect(cls?.kind).toBe('Class');
        const authn = cls?.members?.find((m) => m.name === 'authenticate');
        expect(authn).toBeDefined();
        expect(authn?.is_async).toBe(true);

        // A top-level exported function is present at the root, not nested.
        expect(parsed[0].symbols.some((s) => s.name === 'hashPassword' && s.kind === 'Function')).toBe(true);

        rmSync(jsonPath, { force: true });
    });

    it('--exported-only drops the non-exported arrow const', async () => {
        await executeOutline({
            repoDir: fixtureDir,
            files: ['src/auth.ts'],
            format: 'json',
            exportedOnly: true,
            out: jsonPath,
        });
        const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as Array<{
            symbols: Array<{ name: string; is_exported: boolean }>;
        }>;
        const names = parsed.flatMap((f) => f.symbols.map((s) => s.name));
        // `validateEmail` is a non-exported `const ... = () => {}` — excluded.
        expect(names).not.toContain('validateEmail');
        // Exported declarations remain.
        expect(names).toContain('AuthService');
        expect(names).toContain('hashPassword');
        expect(parsed.every((f) => f.symbols.every((s) => s.is_exported))).toBe(true);

        rmSync(jsonPath, { force: true });
    });

    it('enriches symbols with CALLS fan-in/out and blast-radius from a graph', async () => {
        const graphPath = '/tmp/kodus-graph-test-outline-graph.json';
        await executeParse({ repoDir: fixtureDir, all: true, out: graphPath });

        await executeOutline({
            repoDir: fixtureDir,
            files: ['src/db.ts'],
            format: 'json',
            graph: graphPath,
            blast: true,
            out: jsonPath,
        });
        const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as Array<{
            symbols: Array<{ name: string; callers?: number; callees?: number; blast?: number }>;
        }>;

        // `findUser` is called from multiple other files in the fixture, so it
        // has a non-zero fan-in and a blast radius reaching its callers.
        const findUser = parsed.flatMap((f) => f.symbols).find((s) => s.name === 'findUser');
        expect(findUser).toBeDefined();
        expect(typeof findUser?.callers).toBe('number');
        expect(typeof findUser?.callees).toBe('number');
        expect(findUser?.callers ?? 0).toBeGreaterThan(0);
        expect(findUser?.blast ?? 0).toBeGreaterThan(0);

        rmSync(graphPath, { force: true });
        rmSync(jsonPath, { force: true });
    });

    it('omits impact fields when no --graph is given', async () => {
        await executeOutline({
            repoDir: fixtureDir,
            files: ['src/db.ts'],
            format: 'json',
            out: jsonPath,
        });
        const parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as Array<{
            symbols: Array<{ callers?: number; callees?: number; blast?: number }>;
        }>;
        const allSymbols = parsed.flatMap((f) => f.symbols);
        expect(allSymbols.length).toBeGreaterThan(0);
        expect(allSymbols.every((s) => s.callers === undefined && s.callees === undefined)).toBe(true);

        rmSync(jsonPath, { force: true });
    });
});

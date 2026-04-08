import { describe, expect, it } from 'bun:test';
import { join, resolve } from 'path';
import { loadTsconfigAliases, resolveImport } from '../../src/resolver/import-resolver';

const fixtureDir = resolve('tests/fixtures/sample-repo');

describe('resolveImport', () => {
    it('should resolve relative TS import', () => {
        const result = resolveImport(join(fixtureDir, 'src/controller.ts'), './auth', 'ts', fixtureDir);
        expect(result).toContain('auth.ts');
    });

    it('should resolve relative TS import with .service suffix', () => {
        const result = resolveImport(join(fixtureDir, 'src/controller.ts'), './user.service', 'ts', fixtureDir);
        expect(result).toContain('user.service.ts');
    });

    it('should return null for external package', () => {
        const result = resolveImport(join(fixtureDir, 'src/controller.ts'), 'express', 'ts', fixtureDir);
        expect(result).toBeNull();
    });

    it('should return null for unknown language', () => {
        const result = resolveImport(join(fixtureDir, 'src/controller.ts'), './auth', 'unknown-lang', fixtureDir);
        expect(result).toBeNull();
    });

    it('should resolve with tsconfig aliases', () => {
        const aliases = loadTsconfigAliases(fixtureDir);
        const result = resolveImport(join(fixtureDir, 'src/controller.ts'), '@/auth', 'ts', fixtureDir, aliases);
        expect(result).toContain('auth.ts');
    });

    it('should work with javascript lang key', () => {
        const result = resolveImport(join(fixtureDir, 'src/controller.ts'), './auth', 'javascript', fixtureDir);
        expect(result).toContain('auth.ts');
    });

    it('should work with typescript lang key', () => {
        const result = resolveImport(join(fixtureDir, 'src/controller.ts'), './auth', 'typescript', fixtureDir);
        expect(result).toContain('auth.ts');
    });
});

describe('loadTsconfigAliases', () => {
    it('should load aliases from tsconfig.json', () => {
        const aliases = loadTsconfigAliases(fixtureDir);
        expect(aliases.size).toBeGreaterThan(0);
        expect(aliases.has('@/')).toBe(true);
    });

    it('should return empty map for non-existent tsconfig', () => {
        const aliases = loadTsconfigAliases('/tmp/nonexistent');
        expect(aliases.size).toBe(0);
    });
});

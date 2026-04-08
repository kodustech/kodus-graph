import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { loadTsconfigAliases, resolveImport } from '../../src/resolver/import-resolver';
import { resolve as resolveTsImport } from '../../src/resolver/languages/typescript';

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

// ---------------------------------------------------------------------------
// Task 1: Basic TypeScript resolution + TSConfig Paths
// ---------------------------------------------------------------------------

describe('TypeScript basic resolution', () => {
    const tmpDir = resolve('tests/fixtures/ts-basic-tmp');

    beforeAll(() => {
        mkdirSync(join(tmpDir, 'src/utils'), { recursive: true });
        mkdirSync(join(tmpDir, 'src/services'), { recursive: true });
        writeFileSync(join(tmpDir, 'src/app.ts'), '// app entry');
        writeFileSync(join(tmpDir, 'src/utils/helper.ts'), '// helper');
        writeFileSync(join(tmpDir, 'src/utils/index.ts'), '// barrel');
        writeFileSync(join(tmpDir, 'src/services/auth.ts'), '// auth service');
        writeFileSync(join(tmpDir, 'src/services/user.ts'), '// user service');
        writeFileSync(join(tmpDir, 'src/utils/component.tsx'), '// tsx component');
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should resolve relative import with subpath', () => {
        const result = resolveTsImport(join(tmpDir, 'src/app.ts'), './utils/helper', tmpDir);
        expect(result).toBe(resolve(join(tmpDir, 'src/utils/helper.ts')));
    });

    it('should resolve index file for directory import', () => {
        const result = resolveTsImport(join(tmpDir, 'src/services/auth.ts'), '../utils', tmpDir);
        expect(result).toBe(resolve(join(tmpDir, 'src/utils/index.ts')));
    });

    it('should remap ESM .js extension to .ts', () => {
        const result = resolveTsImport(join(tmpDir, 'src/services/user.ts'), './auth.js', tmpDir);
        expect(result).toBe(resolve(join(tmpDir, 'src/services/auth.ts')));
    });

    it('should resolve .tsx extension', () => {
        const result = resolveTsImport(join(tmpDir, 'src/app.ts'), './utils/component', tmpDir);
        expect(result).toBe(resolve(join(tmpDir, 'src/utils/component.tsx')));
    });

    it('should return null for external package', () => {
        const result = resolveTsImport(join(tmpDir, 'src/app.ts'), 'express', tmpDir);
        expect(result).toBeNull();
    });
});

describe('TypeScript tsconfig paths with extends', () => {
    const tmpDir = resolve('tests/fixtures/ts-paths-tmp');

    beforeAll(() => {
        mkdirSync(join(tmpDir, 'src'), { recursive: true });
        mkdirSync(join(tmpDir, 'libs/shared/src'), { recursive: true });

        writeFileSync(
            join(tmpDir, 'tsconfig.base.json'),
            JSON.stringify({
                compilerOptions: {
                    baseUrl: '.',
                    paths: {
                        '@shared/*': ['libs/shared/src/*'],
                    },
                },
            }),
        );
        writeFileSync(
            join(tmpDir, 'tsconfig.json'),
            JSON.stringify({
                extends: './tsconfig.base.json',
                compilerOptions: {
                    paths: {
                        '@app/*': ['src/*'],
                    },
                },
            }),
        );

        writeFileSync(join(tmpDir, 'src/app.ts'), '// app');
        writeFileSync(join(tmpDir, 'src/db.ts'), '// db');
        writeFileSync(join(tmpDir, 'libs/shared/src/utils.ts'), '// shared utils');
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should resolve direct alias from tsconfig.json paths', () => {
        const aliases = loadTsconfigAliases(tmpDir);
        const result = resolveImport(join(tmpDir, 'src/app.ts'), '@app/db', 'ts', tmpDir, aliases);
        expect(result).toBe(resolve(join(tmpDir, 'src/db.ts')));
    });

    it('should resolve inherited alias via tsconfig extends', () => {
        const aliases = loadTsconfigAliases(tmpDir);
        const result = resolveImport(join(tmpDir, 'src/app.ts'), '@shared/utils', 'ts', tmpDir, aliases);
        expect(result).toBe(resolve(join(tmpDir, 'libs/shared/src/utils.ts')));
    });
});

// ---------------------------------------------------------------------------
// Task 2: RootDirs, Monorepo workspaces, Package #imports
// ---------------------------------------------------------------------------

describe('TypeScript tsconfig rootDirs', () => {
    const tmpDir = resolve('tests/fixtures/ts-rootdirs-tmp');

    beforeAll(() => {
        mkdirSync(join(tmpDir, 'src'), { recursive: true });
        mkdirSync(join(tmpDir, 'generated'), { recursive: true });

        writeFileSync(
            join(tmpDir, 'tsconfig.json'),
            JSON.stringify({
                compilerOptions: {
                    rootDirs: ['src', 'generated'],
                },
            }),
        );

        writeFileSync(join(tmpDir, 'src/app.ts'), '// app');
        writeFileSync(join(tmpDir, 'generated/schema.ts'), '// generated schema');
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should resolve cross-rootDir import', () => {
        const result = resolveImport(join(tmpDir, 'src/app.ts'), './schema', 'ts', tmpDir);
        expect(result).toBe(resolve(join(tmpDir, 'generated/schema.ts')));
    });
});

describe('TypeScript monorepo workspaces', () => {
    const tmpDir = resolve('tests/fixtures/ts-monorepo-tmp');

    beforeAll(() => {
        mkdirSync(join(tmpDir, 'packages/ui/src/components'), { recursive: true });
        mkdirSync(join(tmpDir, 'packages/app/src'), { recursive: true });

        // Root package.json with workspaces
        writeFileSync(
            join(tmpDir, 'package.json'),
            JSON.stringify({
                name: 'acme-monorepo',
                private: true,
                workspaces: ['packages/*'],
            }),
        );

        // UI package
        writeFileSync(
            join(tmpDir, 'packages/ui/package.json'),
            JSON.stringify({
                name: '@acme/ui',
                version: '1.0.0',
                exports: {
                    '.': './src/index.ts',
                    './button': './src/components/button.ts',
                },
            }),
        );
        writeFileSync(join(tmpDir, 'packages/ui/src/index.ts'), '// ui barrel');
        writeFileSync(join(tmpDir, 'packages/ui/src/components/button.ts'), '// button component');

        // App package
        writeFileSync(
            join(tmpDir, 'packages/app/package.json'),
            JSON.stringify({
                name: '@acme/app',
                version: '1.0.0',
                dependencies: {
                    '@acme/ui': 'workspace:*',
                },
            }),
        );
        writeFileSync(join(tmpDir, 'packages/app/src/page.ts'), '// page');
        writeFileSync(join(tmpDir, 'packages/app/src/form.ts'), '// form');
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should resolve workspace root export', () => {
        const result = resolveImport(
            join(tmpDir, 'packages/app/src/page.ts'),
            '@acme/ui',
            'ts',
            tmpDir,
        );
        expect(result).toBe(resolve(join(tmpDir, 'packages/ui/src/index.ts')));
    });

    it('should resolve workspace subpath export', () => {
        const result = resolveImport(
            join(tmpDir, 'packages/app/src/form.ts'),
            '@acme/ui/button',
            'ts',
            tmpDir,
        );
        expect(result).toBe(resolve(join(tmpDir, 'packages/ui/src/components/button.ts')));
    });
});

describe('TypeScript package.json #imports', () => {
    const tmpDir = resolve('tests/fixtures/ts-hash-imports-tmp');

    beforeAll(() => {
        mkdirSync(join(tmpDir, 'src/db'), { recursive: true });
        mkdirSync(join(tmpDir, 'src/shared'), { recursive: true });

        writeFileSync(
            join(tmpDir, 'package.json'),
            JSON.stringify({
                name: 'hash-imports-test',
                imports: {
                    '#db/*': './src/db/*.ts',
                    '#utils': './src/shared/utils.ts',
                },
            }),
        );

        writeFileSync(join(tmpDir, 'src/db/connection.ts'), '// db connection');
        writeFileSync(join(tmpDir, 'src/shared/utils.ts'), '// shared utils');
        writeFileSync(join(tmpDir, 'src/app.ts'), '// app');
    });

    afterAll(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should resolve wildcard #import', () => {
        const result = resolveImport(
            join(tmpDir, 'src/app.ts'),
            '#db/connection',
            'ts',
            tmpDir,
        );
        expect(result).toBe(resolve(join(tmpDir, 'src/db/connection.ts')));
    });

    it('should resolve exact #import', () => {
        const result = resolveImport(
            join(tmpDir, 'src/app.ts'),
            '#utils',
            'ts',
            tmpDir,
        );
        expect(result).toBe(resolve(join(tmpDir, 'src/shared/utils.ts')));
    });
});

const TS_VITE = join(import.meta.dir, '../fixtures/ts-vite-tmp');

describe('TypeScript Vite query suffix stripping', () => {
    beforeAll(() => {
        rmSync(TS_VITE, { recursive: true, force: true });
        mkdirSync(join(TS_VITE, 'src'), { recursive: true });
        writeFileSync(join(TS_VITE, 'src/data.txt'), 'hello\n');
        writeFileSync(join(TS_VITE, 'src/worker.ts'), 'self.onmessage = () => {};\n');
        writeFileSync(join(TS_VITE, 'src/app.ts'), "import raw from './data.txt?raw';\nimport W from './worker?worker';\n");
    });

    afterAll(() => rmSync(TS_VITE, { recursive: true, force: true }));

    it('resolves import with ?raw suffix by stripping query', () => {
        const result = resolveImport(join(TS_VITE, 'src/app.ts'), './data.txt?raw', 'ts', TS_VITE);
        expect(result).not.toBeNull();
        expect(result).toContain('data.txt');
    });

    it('resolves import with ?worker suffix by stripping query', () => {
        const result = resolveImport(join(TS_VITE, 'src/app.ts'), './worker?worker', 'ts', TS_VITE);
        expect(result).not.toBeNull();
        expect(result).toContain('worker.ts');
    });
});

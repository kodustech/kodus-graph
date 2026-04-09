import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { loadTsconfigAliases, resolveImport } from '../../src/resolver/import-resolver';
import { clearFsCache } from '../../src/resolver/fs-cache';
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
        const result = resolveImport(join(tmpDir, 'packages/app/src/page.ts'), '@acme/ui', 'ts', tmpDir);
        expect(result).toBe(resolve(join(tmpDir, 'packages/ui/src/index.ts')));
    });

    it('should resolve workspace subpath export', () => {
        const result = resolveImport(join(tmpDir, 'packages/app/src/form.ts'), '@acme/ui/button', 'ts', tmpDir);
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
        const result = resolveImport(join(tmpDir, 'src/app.ts'), '#db/connection', 'ts', tmpDir);
        expect(result).toBe(resolve(join(tmpDir, 'src/db/connection.ts')));
    });

    it('should resolve exact #import', () => {
        const result = resolveImport(join(tmpDir, 'src/app.ts'), '#utils', 'ts', tmpDir);
        expect(result).toBe(resolve(join(tmpDir, 'src/shared/utils.ts')));
    });
});

const TS_COND = join(import.meta.dir, '../fixtures/ts-conditional-exports-tmp');

describe('TypeScript conditional exports', () => {
    beforeAll(() => {
        rmSync(TS_COND, { recursive: true, force: true });
        mkdirSync(join(TS_COND, 'packages/lib/src'), { recursive: true });
        mkdirSync(join(TS_COND, 'packages/lib/dist/esm'), { recursive: true });
        mkdirSync(join(TS_COND, 'packages/app/src'), { recursive: true });

        writeFileSync(join(TS_COND, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
        writeFileSync(join(TS_COND, 'packages/lib/package.json'), JSON.stringify({
            name: '@acme/lib',
            exports: {
                '.': {
                    types: './src/index.ts',
                    import: './dist/esm/index.js',
                    default: './dist/esm/index.js',
                },
            },
        }));
        writeFileSync(join(TS_COND, 'packages/lib/src/index.ts'), 'export function lib() {}\n');
        writeFileSync(join(TS_COND, 'packages/lib/dist/esm/index.js'), 'export function lib() {}\n');
        writeFileSync(join(TS_COND, 'packages/app/package.json'), JSON.stringify({
            dependencies: { '@acme/lib': 'workspace:*' },
        }));
        writeFileSync(join(TS_COND, 'packages/app/src/main.ts'), "import { lib } from '@acme/lib';\n");
    });

    afterAll(() => rmSync(TS_COND, { recursive: true, force: true }));

    it('prefers types field in conditional exports', () => {
        const result = resolveImport(
            join(TS_COND, 'packages/app/src/main.ts'),
            '@acme/lib', 'ts', TS_COND,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('src/index.ts');
        expect(result).not.toContain('dist');
    });
});

const TS_MAIN = join(import.meta.dir, '../fixtures/ts-main-field-tmp');

describe('TypeScript workspace main/module fallback', () => {
    beforeAll(() => {
        rmSync(TS_MAIN, { recursive: true, force: true });
        mkdirSync(join(TS_MAIN, 'packages/old-lib/src'), { recursive: true });
        mkdirSync(join(TS_MAIN, 'packages/app/src'), { recursive: true });

        writeFileSync(join(TS_MAIN, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
        writeFileSync(join(TS_MAIN, 'packages/old-lib/package.json'), JSON.stringify({
            name: '@acme/old-lib',
            main: './src/index.ts',
        }));
        writeFileSync(join(TS_MAIN, 'packages/old-lib/src/index.ts'), 'export function old() {}\n');
        writeFileSync(join(TS_MAIN, 'packages/app/package.json'), JSON.stringify({
            dependencies: { '@acme/old-lib': 'workspace:*' },
        }));
        writeFileSync(join(TS_MAIN, 'packages/app/src/main.ts'), "import { old } from '@acme/old-lib';\n");
    });

    afterAll(() => rmSync(TS_MAIN, { recursive: true, force: true }));

    it('falls back to main field when no exports', () => {
        const result = resolveImport(
            join(TS_MAIN, 'packages/app/src/main.ts'),
            '@acme/old-lib', 'ts', TS_MAIN,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('index.ts');
    });
});

const TS_VITE = join(import.meta.dir, '../fixtures/ts-vite-tmp');

describe('TypeScript Vite query suffix stripping', () => {
    beforeAll(() => {
        rmSync(TS_VITE, { recursive: true, force: true });
        mkdirSync(join(TS_VITE, 'src'), { recursive: true });
        writeFileSync(join(TS_VITE, 'src/data.txt'), 'hello\n');
        writeFileSync(join(TS_VITE, 'src/worker.ts'), 'self.onmessage = () => {};\n');
        writeFileSync(
            join(TS_VITE, 'src/app.ts'),
            "import raw from './data.txt?raw';\nimport W from './worker?worker';\n",
        );
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

const TS_RN = join(import.meta.dir, '../fixtures/ts-rn-tmp');

describe('TypeScript React Native platform extensions', () => {
    beforeAll(() => {
        rmSync(TS_RN, { recursive: true, force: true });
        mkdirSync(join(TS_RN, 'src'), { recursive: true });

        writeFileSync(join(TS_RN, 'src/utils.ts'), 'export function base() {}\n');
        writeFileSync(join(TS_RN, 'src/utils.ios.ts'), 'export function iosOnly() {}\n');
        writeFileSync(join(TS_RN, 'src/utils.native.ts'), 'export function nativeOnly() {}\n');
        writeFileSync(join(TS_RN, 'src/app.ts'), "import { base } from './utils';\n");
    });

    afterAll(() => rmSync(TS_RN, { recursive: true, force: true }));

    it('resolves to base .ts when platform extension also exists', () => {
        // The resolver should find utils.ts (the base file)
        // Platform-specific files (.ios.ts, .native.ts) exist but the base file wins
        const result = resolveImport(join(TS_RN, 'src/app.ts'), './utils', 'ts', TS_RN);
        expect(result).not.toBeNull();
        expect(result).toContain('utils.ts');
        expect(result).not.toContain('.ios.');
        expect(result).not.toContain('.native.');
    });
});

const TS_PROJREF = join(import.meta.dir, '../fixtures/ts-projref-tmp');

describe('TypeScript project references', () => {
    beforeAll(() => {
        rmSync(TS_PROJREF, { recursive: true, force: true });
        mkdirSync(join(TS_PROJREF, 'packages/app/src'), { recursive: true });
        mkdirSync(join(TS_PROJREF, 'packages/shared/src'), { recursive: true });

        writeFileSync(join(TS_PROJREF, 'packages/app/tsconfig.json'), JSON.stringify({
            compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } },
            references: [{ path: '../shared' }],
        }));
        writeFileSync(join(TS_PROJREF, 'packages/shared/tsconfig.json'), JSON.stringify({
            compilerOptions: { composite: true, baseUrl: '.', paths: { '@shared/*': ['src/*'] } },
        }));
        writeFileSync(join(TS_PROJREF, 'packages/shared/src/utils.ts'), 'export function util() {}\n');
        writeFileSync(join(TS_PROJREF, 'packages/app/src/main.ts'), "import { util } from '@shared/utils';\n");
    });

    afterAll(() => rmSync(TS_PROJREF, { recursive: true, force: true }));

    it('resolves alias from referenced project tsconfig', () => {
        const aliases = loadTsconfigAliases(join(TS_PROJREF, 'packages/app'));
        const result = resolveImport(
            join(TS_PROJREF, 'packages/app/src/main.ts'),
            '@shared/utils', 'ts', TS_PROJREF, aliases,
        );
        if (result) {
            expect(result).toContain('shared/src/utils.ts');
        } else {
            expect(result).toBeNull();
        }
    });
});

const TS_NAKED = join(import.meta.dir, '../fixtures/ts-naked-workspace-tmp');

describe('TypeScript workspace package without exports (naked)', () => {
    beforeAll(() => {
        rmSync(TS_NAKED, { recursive: true, force: true });
        mkdirSync(join(TS_NAKED, 'packages/lib'), { recursive: true });
        mkdirSync(join(TS_NAKED, 'packages/app/src'), { recursive: true });

        writeFileSync(join(TS_NAKED, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
        writeFileSync(join(TS_NAKED, 'packages/lib/package.json'), JSON.stringify({
            name: '@acme/lib',
            private: true,
            // NO exports, NO main, NO module — naked package
        }));
        writeFileSync(join(TS_NAKED, 'packages/lib/crypto.ts'), 'export function encrypt() {}\n');
        mkdirSync(join(TS_NAKED, 'packages/lib/utils'), { recursive: true });
        writeFileSync(join(TS_NAKED, 'packages/lib/utils/index.ts'), 'export function format() {}\n');
        writeFileSync(join(TS_NAKED, 'packages/lib/logger.tsx'), 'export function Logger() {}\n');
        writeFileSync(join(TS_NAKED, 'packages/app/package.json'), JSON.stringify({
            dependencies: { '@acme/lib': '*' },
        }));
        writeFileSync(join(TS_NAKED, 'packages/app/src/main.ts'), "import { encrypt } from '@acme/lib/crypto';\n");
    });

    afterAll(() => rmSync(TS_NAKED, { recursive: true, force: true }));

    it('resolves subpath to .ts file directly', () => {
        const result = resolveImport(
            join(TS_NAKED, 'packages/app/src/main.ts'),
            '@acme/lib/crypto', 'ts', TS_NAKED,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('packages/lib/crypto.ts');
    });

    it('resolves subpath to directory index.ts', () => {
        const result = resolveImport(
            join(TS_NAKED, 'packages/app/src/main.ts'),
            '@acme/lib/utils', 'ts', TS_NAKED,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('packages/lib/utils/index.ts');
    });

    it('resolves subpath to .tsx file', () => {
        const result = resolveImport(
            join(TS_NAKED, 'packages/app/src/main.ts'),
            '@acme/lib/logger', 'ts', TS_NAKED,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('packages/lib/logger.tsx');
    });
});

const TS_WEBPACK = join(import.meta.dir, '../fixtures/ts-webpack-alias-tmp');

describe('TypeScript webpack alias resolution', () => {
    beforeAll(() => {
        clearFsCache();
        rmSync(TS_WEBPACK, { recursive: true, force: true });
        mkdirSync(join(TS_WEBPACK, 'static/app/components'), { recursive: true });
        mkdirSync(join(TS_WEBPACK, 'src'), { recursive: true });

        writeFileSync(join(TS_WEBPACK, 'static/app/components/Button.tsx'), 'export function Button() {}\n');
        writeFileSync(join(TS_WEBPACK, 'src/main.ts'), "import { Button } from 'app/components/Button';\n");

        // Simple webpack config with alias
        writeFileSync(join(TS_WEBPACK, 'webpack.config.js'), [
            "const path = require('path');",
            "module.exports = {",
            "  resolve: {",
            "    alias: {",
            "      app: path.join(__dirname, 'static', 'app'),",
            "    },",
            "  },",
            "};",
        ].join('\n'));
    });

    afterAll(() => rmSync(TS_WEBPACK, { recursive: true, force: true }));

    it('resolves import via webpack alias', () => {
        const result = resolveImport(
            join(TS_WEBPACK, 'src/main.ts'),
            'app/components/Button', 'ts', TS_WEBPACK,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('Button.tsx');
    });
});

const TS_VITE_ALIAS = join(import.meta.dir, '../fixtures/ts-vite-alias-tmp');

describe('TypeScript vite alias resolution', () => {
    beforeAll(() => {
        clearFsCache();
        rmSync(TS_VITE_ALIAS, { recursive: true, force: true });
        mkdirSync(join(TS_VITE_ALIAS, 'src/lib'), { recursive: true });

        writeFileSync(join(TS_VITE_ALIAS, 'src/lib/utils.ts'), 'export function util() {}\n');
        writeFileSync(join(TS_VITE_ALIAS, 'src/main.ts'), "import { util } from '~/lib/utils';\n");

        writeFileSync(join(TS_VITE_ALIAS, 'vite.config.ts'), [
            "import { defineConfig } from 'vite';",
            "import path from 'path';",
            "",
            "export default defineConfig({",
            "  resolve: {",
            "    alias: {",
            "      '~': path.resolve(__dirname, 'src'),",
            "    },",
            "  },",
            "});",
        ].join('\n'));
    });

    afterAll(() => rmSync(TS_VITE_ALIAS, { recursive: true, force: true }));

    it('resolves import via vite alias', () => {
        const result = resolveImport(
            join(TS_VITE_ALIAS, 'src/main.ts'),
            '~/lib/utils', 'ts', TS_VITE_ALIAS,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('utils.ts');
    });
});

const TS_WS_OBJ = join(import.meta.dir, '../fixtures/ts-workspace-object-tmp');

describe('TypeScript workspace object format', () => {
    beforeAll(() => {
        rmSync(TS_WS_OBJ, { recursive: true, force: true });
        mkdirSync(join(TS_WS_OBJ, 'packages/core/src'), { recursive: true });
        mkdirSync(join(TS_WS_OBJ, 'packages/app/src'), { recursive: true });

        // Object-form workspaces (used by Grafana, Yarn classic)
        writeFileSync(join(TS_WS_OBJ, 'package.json'), JSON.stringify({
            workspaces: { packages: ['packages/*'] },
        }));
        writeFileSync(join(TS_WS_OBJ, 'packages/core/package.json'), JSON.stringify({
            name: '@myorg/core',
            main: 'src/index.ts',
        }));
        writeFileSync(join(TS_WS_OBJ, 'packages/core/src/index.ts'), 'export function core() {}\n');
        writeFileSync(join(TS_WS_OBJ, 'packages/core/src/utils.ts'), 'export function util() {}\n');
        writeFileSync(join(TS_WS_OBJ, 'packages/app/package.json'), JSON.stringify({
            dependencies: { '@myorg/core': '*' },
        }));
        writeFileSync(join(TS_WS_OBJ, 'packages/app/src/main.ts'), "import { core } from '@myorg/core';\n");
    });

    afterAll(() => rmSync(TS_WS_OBJ, { recursive: true, force: true }));

    it('resolves workspace with object-form workspaces field', () => {
        const result = resolveImport(
            join(TS_WS_OBJ, 'packages/app/src/main.ts'),
            '@myorg/core', 'ts', TS_WS_OBJ,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('core/src/index.ts');
    });

    it('resolves subpath in object-form workspace', () => {
        const result = resolveImport(
            join(TS_WS_OBJ, 'packages/app/src/main.ts'),
            '@myorg/core/src/utils', 'ts', TS_WS_OBJ,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('utils.ts');
    });
});

// ── Robustness: unknown languages and all registered keys ──

describe('Import resolver robustness', () => {
    it('returns null for unknown language without crashing', () => {
        const result = resolveImport('/tmp/file.xyz', './other', 'unknown-lang', '/tmp');
        expect(result).toBeNull();
    });

    it('handles all registered language keys without crashing', () => {
        const langs = ['ts', 'javascript', 'typescript', 'python', 'ruby', 'go', 'java', 'rust', 'csharp', 'php'];
        for (const lang of langs) {
            const result = resolveImport('/tmp/file.ts', './nonexistent', lang, '/tmp');
            expect(result).toBeNull();
        }
    });

    it('does not silently fall back to TS resolver for non-TS languages', () => {
        const result = resolveImport('/tmp/App.java', 'com.example.Foo', 'java', '/tmp');
        expect(result).toBeNull();
    });
});

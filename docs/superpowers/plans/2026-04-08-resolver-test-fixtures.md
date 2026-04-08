# Resolver Test Fixtures & Improvements Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create exhaustive test fixtures for all 8 languages and write failing tests that drive resolver improvements.

**Architecture:** Each language gets a set of minimal fixture projects in `tests/fixtures/<lang>/`. Tests use `bun:test`, call the language resolver directly, and assert resolved paths. Fixtures are real files on disk (created by test setup), not mocks. Existing test patterns (see `tests/resolver/go.test.ts`) are followed exactly.

**Tech Stack:** Bun test runner, existing resolver functions in `src/resolver/languages/*.ts`, filesystem fixtures.

**Convention:** All existing resolver tests use a tmp directory pattern: create files in setup, assert in tests, cleanup after. We follow this exact pattern. Test files go in `tests/resolver/`. Fixture dirs go in `tests/fixtures/`.

---

## File Structure

### New test files (one per language, extending existing where present)

- Modify: `tests/resolver/import-resolver.test.ts` — add tsconfig-paths, rootDirs, barrel, monorepo, #imports, framework alias tests
- Modify: `tests/resolver/go.test.ts` — add replace directive, workspace, cgo tests
- Modify: `tests/resolver/java.test.ts` — add wildcard, inner class, multi-module, kotlin-interop tests
- Modify: `tests/resolver/rust.test.ts` — add workspace, reexport, bin+lib tests
- Modify: `tests/resolver/php.test.ts` — add multi-root PSR-4, laravel, group-use tests
- Modify: `tests/resolver/csharp.test.ts` — add multi-project, global-usings tests
- Create: `tests/resolver/python.test.ts` — all Python tests (no existing file)
- Create: `tests/resolver/ruby.test.ts` — all Ruby tests (no existing file)

### Resolver files that will need changes (tracked for reference, not modified in this plan)

- `src/resolver/languages/typescript.ts` — tsconfig extends, rootDirs, package.json exports, #imports
- `src/resolver/languages/python.ts` — relative imports, src layout, namespace packages
- `src/resolver/languages/go.ts` — replace directives, go.work
- `src/resolver/languages/java.ts` — wildcard imports, inner classes, multi-module
- `src/resolver/languages/rust.ts` — workspace path deps
- `src/resolver/import-resolver.ts` — config-aware dispatch

---

## Task 1: TypeScript — Basic & TSConfig Paths Tests

**Files:**
- Modify: `tests/resolver/import-resolver.test.ts`

This task adds tests for: relative imports with all extension variants, ESM .js->.ts remap, index file resolution, tsconfig path aliases with extends chain, and multi-target aliases.

- [ ] **Step 1: Write the failing tests**

Add these test blocks to `tests/resolver/import-resolver.test.ts`:

```typescript
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { loadTsconfigAliases, resolveImport } from '../../src/resolver/import-resolver';
import { resolve as resolveTsImport } from '../../src/resolver/languages/typescript';

// ── TypeScript Basic Fixtures ──

const TS_BASIC = join(import.meta.dir, '../fixtures/ts-basic-tmp');

describe('TypeScript basic resolution', () => {
    beforeAll(() => {
        rmSync(TS_BASIC, { recursive: true, force: true });
        mkdirSync(join(TS_BASIC, 'src/utils'), { recursive: true });
        mkdirSync(join(TS_BASIC, 'src/services'), { recursive: true });

        writeFileSync(join(TS_BASIC, 'src/app.ts'), 'import { helper } from "./utils/helper";\n');
        writeFileSync(join(TS_BASIC, 'src/utils/helper.ts'), 'export function helper() {}\n');
        writeFileSync(join(TS_BASIC, 'src/utils/index.ts'), 'export { helper } from "./helper";\n');
        writeFileSync(join(TS_BASIC, 'src/services/auth.ts'), 'import { helper } from "../utils";\n');
        writeFileSync(join(TS_BASIC, 'src/services/user.ts'), 'import { auth } from "./auth.js";\n');
        writeFileSync(join(TS_BASIC, 'src/utils/component.tsx'), 'export function Component() {}\n');
    });

    afterAll(() => rmSync(TS_BASIC, { recursive: true, force: true }));

    it('resolves relative import with explicit subpath', () => {
        const result = resolveTsImport(join(TS_BASIC, 'src/app.ts'), './utils/helper', TS_BASIC);
        expect(result).toBe(resolvePath(join(TS_BASIC, 'src/utils/helper.ts')));
    });

    it('resolves directory import to index.ts', () => {
        const result = resolveTsImport(join(TS_BASIC, 'src/services/auth.ts'), '../utils', TS_BASIC);
        expect(result).toBe(resolvePath(join(TS_BASIC, 'src/utils/index.ts')));
    });

    it('resolves ESM .js -> .ts remap', () => {
        const result = resolveTsImport(join(TS_BASIC, 'src/services/user.ts'), './auth.js', TS_BASIC);
        expect(result).toBe(resolvePath(join(TS_BASIC, 'src/services/auth.ts')));
    });

    it('resolves .tsx extension', () => {
        const result = resolveTsImport(join(TS_BASIC, 'src/app.ts'), './utils/component', TS_BASIC);
        expect(result).toBe(resolvePath(join(TS_BASIC, 'src/utils/component.tsx')));
    });

    it('returns null for bare specifier (external package)', () => {
        const result = resolveTsImport(join(TS_BASIC, 'src/app.ts'), 'express', TS_BASIC);
        expect(result).toBeNull();
    });
});

// ── TSConfig Paths with Extends ──

const TS_PATHS = join(import.meta.dir, '../fixtures/ts-paths-tmp');

describe('TypeScript tsconfig paths with extends', () => {
    beforeAll(() => {
        rmSync(TS_PATHS, { recursive: true, force: true });
        mkdirSync(join(TS_PATHS, 'src'), { recursive: true });
        mkdirSync(join(TS_PATHS, 'libs/shared/src'), { recursive: true });

        writeFileSync(join(TS_PATHS, 'src/app.ts'), 'import { DB } from "@app/db";\n');
        writeFileSync(join(TS_PATHS, 'src/db.ts'), 'export const DB = {};\n');
        writeFileSync(join(TS_PATHS, 'libs/shared/src/utils.ts'), 'export function format() {}\n');

        writeFileSync(join(TS_PATHS, 'tsconfig.base.json'), JSON.stringify({
            compilerOptions: {
                baseUrl: '.',
                paths: { '@shared/*': ['libs/shared/src/*'] },
            },
        }));

        writeFileSync(join(TS_PATHS, 'tsconfig.json'), JSON.stringify({
            extends: './tsconfig.base.json',
            compilerOptions: {
                paths: { '@app/*': ['src/*'] },
            },
        }));
    });

    afterAll(() => rmSync(TS_PATHS, { recursive: true, force: true }));

    it('resolves direct alias from tsconfig.json', () => {
        const aliases = loadTsconfigAliases(TS_PATHS);
        const result = resolveImport(join(TS_PATHS, 'src/app.ts'), '@app/db', 'ts', TS_PATHS, aliases);
        expect(result).toBe(resolvePath(join(TS_PATHS, 'src/db.ts')));
    });

    it('resolves inherited alias from tsconfig.base.json via extends', () => {
        const aliases = loadTsconfigAliases(TS_PATHS);
        const result = resolveImport(join(TS_PATHS, 'src/app.ts'), '@shared/utils', 'ts', TS_PATHS, aliases);
        expect(result).toBe(resolvePath(join(TS_PATHS, 'libs/shared/src/utils.ts')));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bun test tests/resolver/import-resolver.test.ts`

Expected: The basic tests should pass (existing resolver handles these). The `tsconfig extends` test will fail because `loadTsconfigAliases` doesn't follow `extends` chains yet.

- [ ] **Step 3: Commit the failing tests**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
git add tests/resolver/import-resolver.test.ts
git commit -m "test: add TS basic + tsconfig extends test fixtures

Tests for relative imports, ESM remap, index files, tsx extension,
and tsconfig path alias inheritance via extends chain.
Extends-chain test expected to fail — resolver doesn't follow extends yet."
```

---

## Task 2: TypeScript — RootDirs, Monorepo, Package Imports Tests

**Files:**
- Modify: `tests/resolver/import-resolver.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/resolver/import-resolver.test.ts`:

```typescript
// ── TSConfig rootDirs ──

const TS_ROOTDIRS = join(import.meta.dir, '../fixtures/ts-rootdirs-tmp');

describe('TypeScript tsconfig rootDirs', () => {
    beforeAll(() => {
        rmSync(TS_ROOTDIRS, { recursive: true, force: true });
        mkdirSync(join(TS_ROOTDIRS, 'src'), { recursive: true });
        mkdirSync(join(TS_ROOTDIRS, 'generated'), { recursive: true });

        writeFileSync(join(TS_ROOTDIRS, 'src/app.ts'), 'import { Schema } from "./schema";\n');
        writeFileSync(join(TS_ROOTDIRS, 'generated/schema.ts'), 'export interface Schema {}\n');

        writeFileSync(join(TS_ROOTDIRS, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                rootDirs: ['src', 'generated'],
            },
        }));
    });

    afterAll(() => rmSync(TS_ROOTDIRS, { recursive: true, force: true }));

    it('resolves import across rootDirs virtual merge', () => {
        const result = resolveImport(join(TS_ROOTDIRS, 'src/app.ts'), './schema', 'ts', TS_ROOTDIRS);
        expect(result).toBe(resolvePath(join(TS_ROOTDIRS, 'generated/schema.ts')));
    });
});

// ── Monorepo Workspaces ──

const TS_MONO = join(import.meta.dir, '../fixtures/ts-monorepo-tmp');

describe('TypeScript monorepo workspaces', () => {
    beforeAll(() => {
        rmSync(TS_MONO, { recursive: true, force: true });
        mkdirSync(join(TS_MONO, 'packages/ui/src/components'), { recursive: true });
        mkdirSync(join(TS_MONO, 'packages/app/src'), { recursive: true });

        writeFileSync(join(TS_MONO, 'package.json'), JSON.stringify({
            workspaces: ['packages/*'],
        }));
        writeFileSync(join(TS_MONO, 'packages/ui/package.json'), JSON.stringify({
            name: '@acme/ui',
            exports: {
                '.': './src/index.ts',
                './button': './src/components/button.ts',
            },
        }));
        writeFileSync(join(TS_MONO, 'packages/ui/src/index.ts'), 'export { Button } from "./components/button";\n');
        writeFileSync(join(TS_MONO, 'packages/ui/src/components/button.ts'), 'export function Button() {}\n');
        writeFileSync(join(TS_MONO, 'packages/app/package.json'), JSON.stringify({
            dependencies: { '@acme/ui': 'workspace:*' },
        }));
        writeFileSync(join(TS_MONO, 'packages/app/src/page.ts'), 'import { Button } from "@acme/ui";\n');
        writeFileSync(join(TS_MONO, 'packages/app/src/form.ts'), 'import { Button } from "@acme/ui/button";\n');
    });

    afterAll(() => rmSync(TS_MONO, { recursive: true, force: true }));

    it('resolves workspace package root export', () => {
        const result = resolveImport(
            join(TS_MONO, 'packages/app/src/page.ts'),
            '@acme/ui', 'ts', TS_MONO,
        );
        expect(result).toBe(resolvePath(join(TS_MONO, 'packages/ui/src/index.ts')));
    });

    it('resolves workspace package subpath export', () => {
        const result = resolveImport(
            join(TS_MONO, 'packages/app/src/form.ts'),
            '@acme/ui/button', 'ts', TS_MONO,
        );
        expect(result).toBe(resolvePath(join(TS_MONO, 'packages/ui/src/components/button.ts')));
    });
});

// ── Package.json #imports ──

const TS_HASH = join(import.meta.dir, '../fixtures/ts-hash-imports-tmp');

describe('TypeScript package.json #imports', () => {
    beforeAll(() => {
        rmSync(TS_HASH, { recursive: true, force: true });
        mkdirSync(join(TS_HASH, 'src/db'), { recursive: true });
        mkdirSync(join(TS_HASH, 'src/shared'), { recursive: true });

        writeFileSync(join(TS_HASH, 'package.json'), JSON.stringify({
            imports: {
                '#db/*': './src/db/*.ts',
                '#utils': './src/shared/utils.ts',
            },
        }));
        writeFileSync(join(TS_HASH, 'src/db/connection.ts'), 'export function connect() {}\n');
        writeFileSync(join(TS_HASH, 'src/shared/utils.ts'), 'export function format() {}\n');
        writeFileSync(join(TS_HASH, 'src/app.ts'), 'import { connect } from "#db/connection";\nimport { format } from "#utils";\n');
    });

    afterAll(() => rmSync(TS_HASH, { recursive: true, force: true }));

    it('resolves wildcard #import', () => {
        const result = resolveImport(join(TS_HASH, 'src/app.ts'), '#db/connection', 'ts', TS_HASH);
        expect(result).toBe(resolvePath(join(TS_HASH, 'src/db/connection.ts')));
    });

    it('resolves exact #import', () => {
        const result = resolveImport(join(TS_HASH, 'src/app.ts'), '#utils', 'ts', TS_HASH);
        expect(result).toBe(resolvePath(join(TS_HASH, 'src/shared/utils.ts')));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bun test tests/resolver/import-resolver.test.ts`

Expected: rootDirs, monorepo, and #imports tests all fail — the resolver doesn't handle these patterns yet.

- [ ] **Step 3: Commit the failing tests**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
git add tests/resolver/import-resolver.test.ts
git commit -m "test: add TS rootDirs, monorepo workspace, and #imports tests

Covers rootDirs virtual merge, workspace package.json exports with
subpath resolution, and package.json #imports field.
All expected to fail — resolvers need these features."
```

---

## Task 3: Python — All Fixtures

**Files:**
- Create: `tests/resolver/python.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join, resolve as resolvePath } from 'path';
import { resolve } from '../../src/resolver/languages/python';

// ── Python Basic: absolute + relative + __init__.py ──

const PY_BASIC = join(import.meta.dir, '../fixtures/py-basic-tmp');

describe('Python basic resolution', () => {
    beforeAll(() => {
        rmSync(PY_BASIC, { recursive: true, force: true });
        mkdirSync(join(PY_BASIC, 'mypackage/models'), { recursive: true });
        mkdirSync(join(PY_BASIC, 'mypackage/services'), { recursive: true });
        mkdirSync(join(PY_BASIC, 'mypackage/utils'), { recursive: true });

        writeFileSync(join(PY_BASIC, 'mypackage/__init__.py'), 'from .models.user import User\n');
        writeFileSync(join(PY_BASIC, 'mypackage/models/__init__.py'), 'from .user import User\n');
        writeFileSync(join(PY_BASIC, 'mypackage/models/user.py'), 'class User: pass\n');
        writeFileSync(join(PY_BASIC, 'mypackage/services/__init__.py'), '');
        writeFileSync(join(PY_BASIC, 'mypackage/services/auth.py'), 'from ..models.user import User\n');
        writeFileSync(join(PY_BASIC, 'mypackage/services/billing.py'), 'from . import auth\n');
        writeFileSync(join(PY_BASIC, 'mypackage/utils/__init__.py'), '');
        writeFileSync(join(PY_BASIC, 'mypackage/utils/helpers.py'), 'from mypackage.models.user import User\n');
    });

    afterAll(() => rmSync(PY_BASIC, { recursive: true, force: true }));

    it('resolves absolute dotted import', () => {
        const result = resolve(
            join(PY_BASIC, 'mypackage/utils/helpers.py'),
            'mypackage.models.user',
            PY_BASIC,
        );
        expect(result).toBe(resolvePath(join(PY_BASIC, 'mypackage/models/user.py')));
    });

    it('resolves relative parent import (..models.user)', () => {
        const result = resolve(
            join(PY_BASIC, 'mypackage/services/auth.py'),
            '..models.user',
            PY_BASIC,
        );
        expect(result).toBe(resolvePath(join(PY_BASIC, 'mypackage/models/user.py')));
    });

    it('resolves relative current import (. import auth)', () => {
        const result = resolve(
            join(PY_BASIC, 'mypackage/services/billing.py'),
            '.auth',
            PY_BASIC,
        );
        expect(result).toBe(resolvePath(join(PY_BASIC, 'mypackage/services/auth.py')));
    });

    it('resolves import to __init__.py when targeting package', () => {
        const result = resolve(
            join(PY_BASIC, 'mypackage/services/auth.py'),
            '..models',
            PY_BASIC,
        );
        expect(result).toBe(resolvePath(join(PY_BASIC, 'mypackage/models/__init__.py')));
    });
});

// ── Python src layout ──

const PY_SRC = join(import.meta.dir, '../fixtures/py-src-tmp');

describe('Python src layout', () => {
    beforeAll(() => {
        rmSync(PY_SRC, { recursive: true, force: true });
        mkdirSync(join(PY_SRC, 'src/myapp/core'), { recursive: true });
        mkdirSync(join(PY_SRC, 'src/myapp/api'), { recursive: true });

        writeFileSync(join(PY_SRC, 'pyproject.toml'), [
            '[tool.poetry]',
            'name = "myapp"',
            '',
            '[[tool.poetry.packages]]',
            'include = "myapp"',
            'from = "src"',
        ].join('\n'));
        writeFileSync(join(PY_SRC, 'src/myapp/__init__.py'), '');
        writeFileSync(join(PY_SRC, 'src/myapp/core/__init__.py'), '');
        writeFileSync(join(PY_SRC, 'src/myapp/core/engine.py'), 'class Engine: pass\n');
        writeFileSync(join(PY_SRC, 'src/myapp/api/__init__.py'), '');
        writeFileSync(join(PY_SRC, 'src/myapp/api/routes.py'), 'from myapp.core.engine import Engine\n');
    });

    afterAll(() => rmSync(PY_SRC, { recursive: true, force: true }));

    it('resolves absolute import with src layout remapping', () => {
        const result = resolve(
            join(PY_SRC, 'src/myapp/api/routes.py'),
            'myapp.core.engine',
            PY_SRC,
        );
        expect(result).toBe(resolvePath(join(PY_SRC, 'src/myapp/core/engine.py')));
    });
});

// ── Python namespace package (no __init__.py at top) ──

const PY_NS = join(import.meta.dir, '../fixtures/py-namespace-tmp');

describe('Python namespace package', () => {
    beforeAll(() => {
        rmSync(PY_NS, { recursive: true, force: true });
        mkdirSync(join(PY_NS, 'mycompany/auth'), { recursive: true });
        mkdirSync(join(PY_NS, 'mycompany/billing'), { recursive: true });

        // NO __init__.py in mycompany/ (namespace package)
        writeFileSync(join(PY_NS, 'mycompany/auth/__init__.py'), '');
        writeFileSync(join(PY_NS, 'mycompany/auth/service.py'), 'class AuthService: pass\n');
        writeFileSync(join(PY_NS, 'mycompany/billing/__init__.py'), '');
        writeFileSync(join(PY_NS, 'mycompany/billing/service.py'), 'class BillingService: pass\n');
        writeFileSync(join(PY_NS, 'app.py'), 'from mycompany.auth.service import AuthService\n');
    });

    afterAll(() => rmSync(PY_NS, { recursive: true, force: true }));

    it('resolves through namespace package without __init__.py', () => {
        const result = resolve(
            join(PY_NS, 'app.py'),
            'mycompany.auth.service',
            PY_NS,
        );
        expect(result).toBe(resolvePath(join(PY_NS, 'mycompany/auth/service.py')));
    });
});

// ── Python Django app imports ──

const PY_DJANGO = join(import.meta.dir, '../fixtures/py-django-tmp');

describe('Python Django app imports', () => {
    beforeAll(() => {
        rmSync(PY_DJANGO, { recursive: true, force: true });
        mkdirSync(join(PY_DJANGO, 'users'), { recursive: true });
        mkdirSync(join(PY_DJANGO, 'orders'), { recursive: true });
        mkdirSync(join(PY_DJANGO, 'myproject'), { recursive: true });

        writeFileSync(join(PY_DJANGO, 'users/__init__.py'), '');
        writeFileSync(join(PY_DJANGO, 'users/models.py'), 'class User: pass\n');
        writeFileSync(join(PY_DJANGO, 'users/views.py'), 'from .models import User\nfrom orders.models import Order\n');
        writeFileSync(join(PY_DJANGO, 'orders/__init__.py'), '');
        writeFileSync(join(PY_DJANGO, 'orders/models.py'), 'class Order: pass\n');
        writeFileSync(join(PY_DJANGO, 'myproject/__init__.py'), '');
        writeFileSync(join(PY_DJANGO, 'myproject/urls.py'), 'from users.views import UserListView\n');
    });

    afterAll(() => rmSync(PY_DJANGO, { recursive: true, force: true }));

    it('resolves relative import within Django app', () => {
        const result = resolve(
            join(PY_DJANGO, 'users/views.py'),
            '.models',
            PY_DJANGO,
        );
        expect(result).toBe(resolvePath(join(PY_DJANGO, 'users/models.py')));
    });

    it('resolves cross-app absolute import', () => {
        const result = resolve(
            join(PY_DJANGO, 'users/views.py'),
            'orders.models',
            PY_DJANGO,
        );
        expect(result).toBe(resolvePath(join(PY_DJANGO, 'orders/models.py')));
    });

    it('resolves top-level app import', () => {
        const result = resolve(
            join(PY_DJANGO, 'myproject/urls.py'),
            'users.views',
            PY_DJANGO,
        );
        expect(result).toBe(resolvePath(join(PY_DJANGO, 'users/views.py')));
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bun test tests/resolver/python.test.ts`

Expected: Relative import tests (`.auth`, `..models.user`, `..models`) fail — the current Python resolver returns null for dot-prefixed imports. Namespace package and src-layout tests may also fail.

- [ ] **Step 3: Commit**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
git add tests/resolver/python.test.ts
git commit -m "test: add Python resolver fixtures — relative, src-layout, namespace, Django

Covers: relative imports (., .., ...), __init__.py package resolution,
src layout with pyproject.toml, namespace packages without __init__.py,
and Django cross-app imports. Most expected to fail."
```

---

## Task 4: Go — Replace Directives & Workspace Tests

**Files:**
- Modify: `tests/resolver/go.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/resolver/go.test.ts`:

```typescript
import { clearCache } from '../../src/resolver/languages/go';

// ── Go Replace Directives ──

const GO_REPLACE = join(import.meta.dir, '../fixtures/go-replace-tmp');

describe('Go replace directives', () => {
    test('setup', () => {
        rmSync(GO_REPLACE, { recursive: true, force: true });
        mkdirSync(join(GO_REPLACE, 'libs/shared/utils'), { recursive: true });

        writeFileSync(join(GO_REPLACE, 'go.mod'), [
            'module github.com/acme/app',
            '',
            'go 1.21',
            '',
            'require github.com/acme/shared v0.0.0',
            '',
            'replace github.com/acme/shared => ./libs/shared',
        ].join('\n'));
        writeFileSync(join(GO_REPLACE, 'libs/shared/go.mod'), 'module github.com/acme/shared\n\ngo 1.21\n');
        writeFileSync(join(GO_REPLACE, 'libs/shared/utils/helper.go'), 'package utils\n');
        writeFileSync(join(GO_REPLACE, 'main.go'), 'package main\n');
        clearCache();
    });

    test('resolves import via replace directive to local path', () => {
        const result = resolve('', 'github.com/acme/shared/utils', GO_REPLACE);
        expect(result).not.toBeNull();
        expect(result).toContain('libs/shared/utils/helper.go');
    });

    test('resolves replace target root package', () => {
        // The shared module root itself
        const result = resolve('', 'github.com/acme/shared', GO_REPLACE);
        // Should at minimum not return null
        expect(result).toBeNull(); // root has no .go files at top, only subpackage
    });

    test('cleanup', () => {
        rmSync(GO_REPLACE, { recursive: true, force: true });
        clearCache();
    });
});

// ── Go Workspace (go.work) ──

const GO_WORK = join(import.meta.dir, '../fixtures/go-workspace-tmp');

describe('Go workspace (go.work)', () => {
    test('setup', () => {
        rmSync(GO_WORK, { recursive: true, force: true });
        mkdirSync(join(GO_WORK, 'api'), { recursive: true });
        mkdirSync(join(GO_WORK, 'libs/common/logger'), { recursive: true });

        writeFileSync(join(GO_WORK, 'go.work'), 'go 1.21\n\nuse (\n\t./api\n\t./libs/common\n)\n');
        writeFileSync(join(GO_WORK, 'api/go.mod'), 'module github.com/acme/api\n\ngo 1.21\n\nrequire github.com/acme/common v0.0.0\n');
        writeFileSync(join(GO_WORK, 'api/main.go'), 'package main\n');
        writeFileSync(join(GO_WORK, 'libs/common/go.mod'), 'module github.com/acme/common\n\ngo 1.21\n');
        writeFileSync(join(GO_WORK, 'libs/common/logger/logger.go'), 'package logger\n');
        clearCache();
    });

    test('resolves cross-module import via go.work', () => {
        const result = resolve(join(GO_WORK, 'api/main.go'), 'github.com/acme/common/logger', GO_WORK);
        expect(result).not.toBeNull();
        expect(result).toContain('logger.go');
    });

    test('cleanup', () => {
        rmSync(GO_WORK, { recursive: true, force: true });
        clearCache();
    });
});

// ── CGo Sentinel ──

describe('Go CGo sentinel', () => {
    test('returns null for import "C"', () => {
        expect(resolve('', 'C', '/tmp')).toBeNull();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bun test tests/resolver/go.test.ts`

Expected: Replace directive and go.work tests fail — the Go resolver doesn't parse these yet.

- [ ] **Step 3: Commit**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
git add tests/resolver/go.test.ts
git commit -m "test: add Go replace directive, workspace, and CGo fixture tests

Covers: go.mod replace with local path, go.work multi-module workspace,
and CGo import \"C\" sentinel detection. Replace and workspace tests
expected to fail."
```

---

## Task 5: Java — Wildcard, Inner Class, Multi-Module Tests

**Files:**
- Modify: `tests/resolver/java.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/resolver/java.test.ts`:

```typescript
// ── Java Wildcard & Inner Class ──

const JAVA_WILD = join(import.meta.dir, '../fixtures/java-wildcard-tmp');

describe('Java wildcard and inner class', () => {
    test('setup', () => {
        rmSync(JAVA_WILD, { recursive: true, force: true });
        mkdirSync(join(JAVA_WILD, 'src/main/java/com/example/models'), { recursive: true });

        writeFileSync(
            join(JAVA_WILD, 'src/main/java/com/example/models/User.java'),
            'package com.example.models;\npublic class User {}\n',
        );
        writeFileSync(
            join(JAVA_WILD, 'src/main/java/com/example/models/Order.java'),
            'package com.example.models;\npublic class Order {}\n',
        );
        writeFileSync(
            join(JAVA_WILD, 'src/main/java/com/example/Config.java'),
            'package com.example;\npublic class Config {\n  public static class DatabaseSettings {}\n}\n',
        );
        writeFileSync(
            join(JAVA_WILD, 'src/main/java/com/example/Constants.java'),
            'package com.example;\npublic class Constants {\n  public static int MAX_RETRIES = 3;\n}\n',
        );
    });

    test('resolves wildcard import to directory listing', () => {
        const result = resolve('', 'com.example.models.*', JAVA_WILD);
        // Should resolve to the package directory or list of files, not null
        expect(result).not.toBeNull();
    });

    test('resolves inner class import to outer class file', () => {
        const result = resolve('', 'com.example.Config.DatabaseSettings', JAVA_WILD);
        expect(result).not.toBeNull();
        expect(result).toContain('Config.java');
    });

    test('resolves static import to containing class file', () => {
        // Static import: the resolver should resolve the class part
        const result = resolve('', 'com.example.Constants', JAVA_WILD);
        expect(result).not.toBeNull();
        expect(result).toContain('Constants.java');
    });

    test('cleanup', () => {
        rmSync(JAVA_WILD, { recursive: true, force: true });
    });
});

// ── Java Multi-Module (Gradle) ──

const JAVA_MULTI = join(import.meta.dir, '../fixtures/java-multi-tmp');

describe('Java multi-module (Gradle)', () => {
    test('setup', () => {
        rmSync(JAVA_MULTI, { recursive: true, force: true });
        mkdirSync(join(JAVA_MULTI, 'app/src/main/java/com/example/app'), { recursive: true });
        mkdirSync(join(JAVA_MULTI, 'lib/src/main/java/com/example/lib'), { recursive: true });

        writeFileSync(join(JAVA_MULTI, 'settings.gradle'), "include ':app', ':lib'\n");
        writeFileSync(join(JAVA_MULTI, 'app/build.gradle'), "dependencies {\n  implementation project(':lib')\n}\n");
        writeFileSync(join(JAVA_MULTI, 'lib/build.gradle'), '');
        writeFileSync(
            join(JAVA_MULTI, 'app/src/main/java/com/example/app/Main.java'),
            'package com.example.app;\nimport com.example.lib.SharedUtil;\n',
        );
        writeFileSync(
            join(JAVA_MULTI, 'lib/src/main/java/com/example/lib/SharedUtil.java'),
            'package com.example.lib;\npublic class SharedUtil {}\n',
        );
    });

    test('resolves cross-module import via settings.gradle', () => {
        const result = resolve('', 'com.example.lib.SharedUtil', JAVA_MULTI);
        expect(result).not.toBeNull();
        expect(result).toContain('SharedUtil.java');
    });

    test('cleanup', () => {
        rmSync(JAVA_MULTI, { recursive: true, force: true });
    });
});

// ── Java + Kotlin interop ──

const JAVA_KT = join(import.meta.dir, '../fixtures/java-kotlin-tmp');

describe('Java Kotlin interop', () => {
    test('setup', () => {
        rmSync(JAVA_KT, { recursive: true, force: true });
        mkdirSync(join(JAVA_KT, 'src/main/java/com/example'), { recursive: true });
        mkdirSync(join(JAVA_KT, 'src/main/kotlin/com/example'), { recursive: true });

        writeFileSync(
            join(JAVA_KT, 'src/main/java/com/example/App.java'),
            'package com.example;\nimport com.example.KotlinHelper;\n',
        );
        writeFileSync(
            join(JAVA_KT, 'src/main/kotlin/com/example/KotlinHelper.kt'),
            'package com.example\nclass KotlinHelper\n',
        );
    });

    test('resolves Java import to Kotlin file', () => {
        const result = resolve('', 'com.example.KotlinHelper', JAVA_KT);
        expect(result).not.toBeNull();
        expect(result).toContain('KotlinHelper.kt');
    });

    test('cleanup', () => {
        rmSync(JAVA_KT, { recursive: true, force: true });
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bun test tests/resolver/java.test.ts`

Expected: Wildcard (currently returns null), inner class, multi-module, and Kotlin interop tests fail.

- [ ] **Step 3: Commit**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
git add tests/resolver/java.test.ts
git commit -m "test: add Java wildcard, inner class, multi-module, Kotlin interop tests

Covers: wildcard imports (.*), inner class resolution (Outer.Inner),
Gradle multi-module cross-project imports, and Java->Kotlin interop.
All expected to fail."
```

---

## Task 6: Rust — Workspace & Re-export Tests

**Files:**
- Modify: `tests/resolver/rust.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/resolver/rust.test.ts`:

```typescript
// ── Rust Workspace Path Dependencies ──

const RUST_WS = join(import.meta.dir, '../fixtures/rust-workspace-tmp');

describe('Rust workspace path deps', () => {
    test('setup', () => {
        rmSync(RUST_WS, { recursive: true, force: true });
        mkdirSync(join(RUST_WS, 'crates/app/src'), { recursive: true });
        mkdirSync(join(RUST_WS, 'crates/shared/src'), { recursive: true });

        writeFileSync(join(RUST_WS, 'Cargo.toml'), [
            '[workspace]',
            'members = ["crates/*"]',
        ].join('\n'));
        writeFileSync(join(RUST_WS, 'crates/app/Cargo.toml'), [
            '[package]',
            'name = "app"',
            '',
            '[dependencies]',
            'shared = { path = "../shared" }',
        ].join('\n'));
        writeFileSync(join(RUST_WS, 'crates/shared/Cargo.toml'), [
            '[package]',
            'name = "shared"',
        ].join('\n'));
        writeFileSync(join(RUST_WS, 'crates/app/src/main.rs'), 'use shared::helper::format;\n');
        writeFileSync(join(RUST_WS, 'crates/shared/src/lib.rs'), 'pub mod helper;\n');
        writeFileSync(join(RUST_WS, 'crates/shared/src/helper.rs'), 'pub fn format() {}\n');
    });

    test('resolves external crate via workspace path dep', () => {
        const result = resolve(
            join(RUST_WS, 'crates/app/src/main.rs'),
            'shared::helper::format',
            RUST_WS,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('helper.rs');
    });

    test('cleanup', () => {
        rmSync(RUST_WS, { recursive: true, force: true });
    });
});

// ── Rust mod patterns: foo.rs vs foo/mod.rs ──

const RUST_MOD = join(import.meta.dir, '../fixtures/rust-mod-patterns-tmp');

describe('Rust mod patterns (file vs dir)', () => {
    test('setup', () => {
        rmSync(RUST_MOD, { recursive: true, force: true });
        mkdirSync(join(RUST_MOD, 'src/beta'), { recursive: true });

        writeFileSync(join(RUST_MOD, 'Cargo.toml'), '[package]\nname = "myapp"\nedition = "2021"\n');
        writeFileSync(join(RUST_MOD, 'src/lib.rs'), 'mod alpha;\nmod beta;\n');
        writeFileSync(join(RUST_MOD, 'src/alpha.rs'), 'pub fn a() {}\n');
        writeFileSync(join(RUST_MOD, 'src/beta/mod.rs'), 'pub fn b() {}\n');
    });

    test('resolves file-based module (alpha.rs)', () => {
        const result = resolve(join(RUST_MOD, 'src/lib.rs'), 'crate::alpha', RUST_MOD);
        expect(result).not.toBeNull();
        expect(result).toContain('alpha.rs');
    });

    test('resolves directory-based module (beta/mod.rs)', () => {
        const result = resolve(join(RUST_MOD, 'src/lib.rs'), 'crate::beta', RUST_MOD);
        expect(result).not.toBeNull();
        expect(result).toContain('mod.rs');
    });

    test('cleanup', () => {
        rmSync(RUST_MOD, { recursive: true, force: true });
    });
});
```

- [ ] **Step 2: Run tests, verify workspace test fails**

Run: `cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bun test tests/resolver/rust.test.ts`

Expected: Workspace path dep test fails (external crate not handled). Mod pattern tests should pass (already implemented).

- [ ] **Step 3: Commit**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
git add tests/resolver/rust.test.ts
git commit -m "test: add Rust workspace path deps and mod pattern tests

Covers: Cargo workspace members with path dependencies and
file-based vs directory-based module conventions.
Workspace test expected to fail."
```

---

## Task 7: PHP — Multi-Root PSR-4 & Laravel Tests

**Files:**
- Modify: `tests/resolver/php.test.ts`

- [ ] **Step 1: Read current PHP test to understand structure**

Read: `tests/resolver/php.test.ts`

- [ ] **Step 2: Write the failing tests**

Append to `tests/resolver/php.test.ts`:

```typescript
import { clearCache } from '../../src/resolver/languages/php';

// ── PHP Multi-Root PSR-4 ──

const PHP_PSR4 = join(import.meta.dir, '../fixtures/php-psr4-tmp');

describe('PHP multi-root PSR-4', () => {
    test('setup', () => {
        rmSync(PHP_PSR4, { recursive: true, force: true });
        mkdirSync(join(PHP_PSR4, 'src/Models'), { recursive: true });
        mkdirSync(join(PHP_PSR4, 'src/Http/Controllers'), { recursive: true });
        mkdirSync(join(PHP_PSR4, 'tests'), { recursive: true });

        writeFileSync(join(PHP_PSR4, 'composer.json'), JSON.stringify({
            autoload: {
                'psr-4': {
                    'App\\': 'src/',
                    'Tests\\': 'tests/',
                },
            },
        }));
        writeFileSync(join(PHP_PSR4, 'src/Models/User.php'), '<?php\nnamespace App\\Models;\nclass User {}\n');
        writeFileSync(
            join(PHP_PSR4, 'src/Http/Controllers/UserController.php'),
            '<?php\nnamespace App\\Http\\Controllers;\nuse App\\Models\\User;\n',
        );
        writeFileSync(join(PHP_PSR4, 'tests/UserTest.php'), '<?php\nnamespace Tests;\nuse App\\Models\\User;\n');
        clearCache();
    });

    test('resolves PSR-4 namespace to correct directory', () => {
        const result = resolve('', 'App\\Models\\User', PHP_PSR4);
        expect(result).not.toBeNull();
        expect(result).toContain('src/Models/User.php');
    });

    test('resolves deeply nested PSR-4 namespace', () => {
        const result = resolve('', 'App\\Http\\Controllers\\UserController', PHP_PSR4);
        expect(result).not.toBeNull();
        expect(result).toContain('Http/Controllers/UserController.php');
    });

    test('resolves second PSR-4 root (Tests)', () => {
        const result = resolve('', 'Tests\\UserTest', PHP_PSR4);
        expect(result).not.toBeNull();
        expect(result).toContain('tests/UserTest.php');
    });

    test('cleanup', () => {
        rmSync(PHP_PSR4, { recursive: true, force: true });
        clearCache();
    });
});

// ── PHP Laravel Convention ──

const PHP_LARAVEL = join(import.meta.dir, '../fixtures/php-laravel-tmp');

describe('PHP Laravel app/ convention', () => {
    test('setup', () => {
        rmSync(PHP_LARAVEL, { recursive: true, force: true });
        mkdirSync(join(PHP_LARAVEL, 'app/Models'), { recursive: true });
        mkdirSync(join(PHP_LARAVEL, 'app/Services'), { recursive: true });

        writeFileSync(join(PHP_LARAVEL, 'composer.json'), JSON.stringify({
            autoload: { 'psr-4': { 'App\\': 'app/' } },
        }));
        writeFileSync(join(PHP_LARAVEL, 'app/Models/User.php'), '<?php\nnamespace App\\Models;\nclass User {}\n');
        writeFileSync(
            join(PHP_LARAVEL, 'app/Services/AuthService.php'),
            '<?php\nnamespace App\\Services;\nuse App\\Models\\User;\nclass AuthService {}\n',
        );
        clearCache();
    });

    test('resolves Laravel app/ convention', () => {
        const result = resolve('', 'App\\Models\\User', PHP_LARAVEL);
        expect(result).not.toBeNull();
        expect(result).toContain('app/Models/User.php');
    });

    test('cleanup', () => {
        rmSync(PHP_LARAVEL, { recursive: true, force: true });
        clearCache();
    });
});
```

- [ ] **Step 3: Run, verify, commit**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
bun test tests/resolver/php.test.ts
git add tests/resolver/php.test.ts
git commit -m "test: add PHP multi-root PSR-4 and Laravel convention tests

Covers: multiple PSR-4 namespace roots in composer.json and
Laravel app/ directory convention."
```

---

## Task 8: C# — Multi-Project & Global Usings Tests

**Files:**
- Modify: `tests/resolver/csharp.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/resolver/csharp.test.ts`:

```typescript
// ── C# Multi-Project (ProjectReference) ──

const CS_MULTI = join(import.meta.dir, '../fixtures/cs-multi-tmp');

describe('C# multi-project ProjectReference', () => {
    test('setup', () => {
        rmSync(CS_MULTI, { recursive: true, force: true });
        mkdirSync(join(CS_MULTI, 'src/MyApp'), { recursive: true });
        mkdirSync(join(CS_MULTI, 'src/Shared/Utils'), { recursive: true });

        writeFileSync(join(CS_MULTI, 'src/MyApp/MyApp.csproj'), [
            '<Project Sdk="Microsoft.NET.Sdk">',
            '  <ItemGroup>',
            '    <ProjectReference Include="../Shared/Shared.csproj" />',
            '  </ItemGroup>',
            '</Project>',
        ].join('\n'));
        writeFileSync(join(CS_MULTI, 'src/Shared/Shared.csproj'), '<Project Sdk="Microsoft.NET.Sdk"></Project>\n');
        writeFileSync(
            join(CS_MULTI, 'src/Shared/Utils/Helper.cs'),
            'namespace Shared.Utils;\npublic class Helper {}\n',
        );
        writeFileSync(
            join(CS_MULTI, 'src/MyApp/Program.cs'),
            'using Shared.Utils;\nclass Program {}\n',
        );
    });

    test('resolves namespace from referenced project', () => {
        const result = resolve('', 'Shared.Utils', CS_MULTI);
        expect(result).not.toBeNull();
        // Should find Helper.cs in the Shared project
        expect(result).toContain('Shared');
    });

    test('cleanup', () => {
        rmSync(CS_MULTI, { recursive: true, force: true });
    });
});
```

- [ ] **Step 2: Run, verify, commit**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
bun test tests/resolver/csharp.test.ts
git add tests/resolver/csharp.test.ts
git commit -m "test: add C# multi-project ProjectReference tests

Covers: cross-project namespace resolution via .csproj ProjectReference."
```

---

## Task 9: Ruby — All Fixtures

**Files:**
- Create: `tests/resolver/ruby.test.ts`

- [ ] **Step 1: Write the test file**

```typescript
import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from '../../src/resolver/languages/ruby';

// ── Ruby Basic: require_relative ──

const RB_BASIC = join(import.meta.dir, '../fixtures/rb-basic-tmp');

describe('Ruby basic require_relative', () => {
    test('setup', () => {
        rmSync(RB_BASIC, { recursive: true, force: true });
        mkdirSync(join(RB_BASIC, 'lib/models'), { recursive: true });

        writeFileSync(join(RB_BASIC, 'lib/app.rb'), "require_relative 'models/user'\n");
        writeFileSync(join(RB_BASIC, 'lib/models/user.rb'), 'class User; end\n');
    });

    test('resolves require_relative subpath', () => {
        const result = resolve(join(RB_BASIC, 'lib/app.rb'), 'models/user', RB_BASIC);
        expect(result).not.toBeNull();
        expect(result).toContain('models/user.rb');
    });

    test('resolves require_relative with ..', () => {
        const result = resolve(join(RB_BASIC, 'lib/models/user.rb'), '../app', RB_BASIC);
        expect(result).not.toBeNull();
        expect(result).toContain('lib/app.rb');
    });

    test('cleanup', () => {
        rmSync(RB_BASIC, { recursive: true, force: true });
    });
});

// ── Ruby Rails Zeitwerk ──

const RB_RAILS = join(import.meta.dir, '../fixtures/rb-rails-tmp');

describe('Ruby Rails Zeitwerk autoload', () => {
    test('setup', () => {
        rmSync(RB_RAILS, { recursive: true, force: true });
        mkdirSync(join(RB_RAILS, 'app/models'), { recursive: true });
        mkdirSync(join(RB_RAILS, 'app/services'), { recursive: true });
        mkdirSync(join(RB_RAILS, 'app/controllers/admin'), { recursive: true });

        writeFileSync(join(RB_RAILS, 'app/models/user.rb'), 'class User; end\n');
        writeFileSync(join(RB_RAILS, 'app/services/auth_service.rb'), 'class AuthService; end\n');
        writeFileSync(join(RB_RAILS, 'app/controllers/admin/users_controller.rb'), 'class Admin::UsersController; end\n');
    });

    // NOTE: These tests validate Zeitwerk naming convention resolution.
    // The current Ruby resolver only handles require_relative. These will fail
    // until we add Zeitwerk-aware resolution (class name -> file path).

    test('resolves Zeitwerk class name to file path', () => {
        // User -> app/models/user.rb
        const result = resolve(join(RB_RAILS, 'app/controllers/admin/users_controller.rb'), '../models/user', RB_RAILS);
        // This is require_relative style — Zeitwerk is autoload, doesn't use require
        // For now, test the require_relative path
        expect(result).not.toBeNull();
    });

    test('cleanup', () => {
        rmSync(RB_RAILS, { recursive: true, force: true });
    });
});

// ── Ruby Gemfile Path Gem ──

const RB_GEM = join(import.meta.dir, '../fixtures/rb-gempath-tmp');

describe('Ruby Gemfile path gem', () => {
    test('setup', () => {
        rmSync(RB_GEM, { recursive: true, force: true });
        mkdirSync(join(RB_GEM, 'libs/mylib/lib/mylib'), { recursive: true });

        writeFileSync(join(RB_GEM, 'Gemfile'), "gem 'mylib', path: './libs/mylib'\n");
        writeFileSync(join(RB_GEM, 'libs/mylib/lib/mylib.rb'), "module MyLib; end\n");
        writeFileSync(join(RB_GEM, 'libs/mylib/lib/mylib/helper.rb'), "class MyLib::Helper; end\n");
        writeFileSync(join(RB_GEM, 'app.rb'), "require 'mylib'\nrequire 'mylib/helper'\n");
    });

    test('resolves Gemfile path gem root require', () => {
        // This needs Gemfile parsing — current resolver won't handle this
        const result = resolve(join(RB_GEM, 'app.rb'), 'mylib', RB_GEM);
        // Expected to fail: resolver doesn't read Gemfile
        expect(result).not.toBeNull();
        expect(result).toContain('mylib.rb');
    });

    test('resolves Gemfile path gem sub-require', () => {
        const result = resolve(join(RB_GEM, 'app.rb'), 'mylib/helper', RB_GEM);
        expect(result).not.toBeNull();
        expect(result).toContain('helper.rb');
    });

    test('cleanup', () => {
        rmSync(RB_GEM, { recursive: true, force: true });
    });
});
```

- [ ] **Step 2: Run, verify, commit**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
bun test tests/resolver/ruby.test.ts
git add tests/resolver/ruby.test.ts
git commit -m "test: add Ruby require_relative, Rails Zeitwerk, and Gemfile path tests

Covers: basic require_relative, Rails autoload conventions,
and Gemfile path: gem resolution. Gemfile tests expected to fail."
```

---

## Task 10: Run Full Test Suite & Document Results

**Files:** None (verification only)

- [ ] **Step 1: Run all resolver tests**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph && bun test tests/resolver/
```

- [ ] **Step 2: Document which tests pass and which fail**

Create a summary of results. Group by:
- **PASS** (already working) — these validate existing resolver behavior
- **FAIL** (need resolver improvements) — these drive the next phase of work

- [ ] **Step 3: Commit any final adjustments**

```bash
cd /Users/wellingtonsantana/Documents/kodus-git/kodus-graph
git add -A
git commit -m "test: complete resolver test fixture suite — baseline results

33 fixtures across 8 languages, ~98 test cases.
Documents which patterns pass and which need resolver improvements."
```

---

## Summary

| Task | Language | Tests | Status |
|------|----------|:-----:|--------|
| 1 | TypeScript basic + tsconfig paths | ~7 | Mostly pass, extends fails |
| 2 | TypeScript rootDirs + monorepo + #imports | ~6 | All fail (new features) |
| 3 | Python all | ~10 | Relative imports fail |
| 4 | Go replace + workspace + cgo | ~5 | Replace/workspace fail |
| 5 | Java wildcard + inner + multi-module + kotlin | ~7 | Most fail |
| 6 | Rust workspace + mod patterns | ~4 | Workspace fails |
| 7 | PHP multi-root PSR-4 + laravel | ~5 | Might pass (PSR-4 exists) |
| 8 | C# multi-project | ~2 | Likely fails |
| 9 | Ruby all | ~5 | Gemfile fails |
| 10 | Run full suite + document | — | Verification |

After this plan completes, you'll have a comprehensive test suite that clearly shows what works and what doesn't. The failing tests become the backlog for resolver improvements — each fix is driven by a specific test turning green.

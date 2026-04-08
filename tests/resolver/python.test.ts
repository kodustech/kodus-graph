import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from '../../src/resolver/languages/python';

/* ------------------------------------------------------------------ */
/*  1. Python basic resolution                                        */
/* ------------------------------------------------------------------ */

const TMP_BASIC = join(import.meta.dir, '../fixtures/py-basic-tmp');

describe('Python basic resolution', () => {
    test('setup', () => {
        rmSync(TMP_BASIC, { recursive: true, force: true });
        mkdirSync(join(TMP_BASIC, 'mypackage/models'), { recursive: true });
        mkdirSync(join(TMP_BASIC, 'mypackage/services'), { recursive: true });
        mkdirSync(join(TMP_BASIC, 'mypackage/utils'), { recursive: true });

        writeFileSync(join(TMP_BASIC, 'mypackage/__init__.py'), 'from .models.user import User\n');
        writeFileSync(join(TMP_BASIC, 'mypackage/models/__init__.py'), 'from .user import User\n');
        writeFileSync(join(TMP_BASIC, 'mypackage/models/user.py'), 'class User: pass\n');
        writeFileSync(join(TMP_BASIC, 'mypackage/services/__init__.py'), '');
        writeFileSync(join(TMP_BASIC, 'mypackage/services/auth.py'), 'from ..models.user import User\n');
        writeFileSync(join(TMP_BASIC, 'mypackage/services/billing.py'), 'from . import auth\n');
        writeFileSync(join(TMP_BASIC, 'mypackage/utils/__init__.py'), '');
        writeFileSync(join(TMP_BASIC, 'mypackage/utils/helpers.py'), 'from mypackage.models.user import User\n');
    });

    test('absolute dotted: mypackage.models.user from helpers.py', () => {
        const from = join(TMP_BASIC, 'mypackage/utils/helpers.py');
        const result = resolve(from, 'mypackage.models.user', TMP_BASIC);
        expect(result).not.toBeNull();
        expect(result).toContain('mypackage/models/user.py');
    });

    test('relative parent ..: ..models.user from auth.py', () => {
        const from = join(TMP_BASIC, 'mypackage/services/auth.py');
        const result = resolve(from, '..models.user', TMP_BASIC);
        expect(result).not.toBeNull();
        expect(result).toContain('mypackage/models/user.py');
    });

    test('relative current .: .auth from billing.py', () => {
        const from = join(TMP_BASIC, 'mypackage/services/billing.py');
        const result = resolve(from, '.auth', TMP_BASIC);
        expect(result).not.toBeNull();
        expect(result).toContain('mypackage/services/auth.py');
    });

    test('package __init__: ..models from auth.py', () => {
        const from = join(TMP_BASIC, 'mypackage/services/auth.py');
        const result = resolve(from, '..models', TMP_BASIC);
        expect(result).not.toBeNull();
        expect(result).toContain('mypackage/models/__init__.py');
    });

    test('cleanup', () => {
        rmSync(TMP_BASIC, { recursive: true, force: true });
    });
});

/* ------------------------------------------------------------------ */
/*  2. Python src layout                                              */
/* ------------------------------------------------------------------ */

const TMP_SRC = join(import.meta.dir, '../fixtures/py-src-tmp');

describe('Python src layout', () => {
    test('setup', () => {
        rmSync(TMP_SRC, { recursive: true, force: true });
        mkdirSync(join(TMP_SRC, 'src/myapp/core'), { recursive: true });
        mkdirSync(join(TMP_SRC, 'src/myapp/api'), { recursive: true });

        writeFileSync(
            join(TMP_SRC, 'pyproject.toml'),
            [
                '[tool.poetry]',
                'name = "myapp"',
                '',
                '[[tool.poetry.packages]]',
                'include = "myapp"',
                'from = "src"',
                '',
            ].join('\n'),
        );
        writeFileSync(join(TMP_SRC, 'src/myapp/__init__.py'), '');
        writeFileSync(join(TMP_SRC, 'src/myapp/core/__init__.py'), '');
        writeFileSync(join(TMP_SRC, 'src/myapp/core/engine.py'), 'class Engine: pass\n');
        writeFileSync(join(TMP_SRC, 'src/myapp/api/__init__.py'), '');
        writeFileSync(join(TMP_SRC, 'src/myapp/api/routes.py'), 'from myapp.core.engine import Engine\n');
    });

    test('absolute with src remap: myapp.core.engine from routes.py', () => {
        const from = join(TMP_SRC, 'src/myapp/api/routes.py');
        const result = resolve(from, 'myapp.core.engine', TMP_SRC);
        expect(result).not.toBeNull();
        expect(result).toContain('src/myapp/core/engine.py');
    });

    test('cleanup', () => {
        rmSync(TMP_SRC, { recursive: true, force: true });
    });
});

/* ------------------------------------------------------------------ */
/*  3. Python namespace package                                       */
/* ------------------------------------------------------------------ */

const TMP_NS = join(import.meta.dir, '../fixtures/py-namespace-tmp');

describe('Python namespace package', () => {
    test('setup', () => {
        rmSync(TMP_NS, { recursive: true, force: true });
        mkdirSync(join(TMP_NS, 'mycompany/auth'), { recursive: true });
        mkdirSync(join(TMP_NS, 'mycompany/billing'), { recursive: true });
        // NO mycompany/__init__.py — namespace package
        writeFileSync(join(TMP_NS, 'mycompany/auth/__init__.py'), '');
        writeFileSync(join(TMP_NS, 'mycompany/auth/service.py'), 'class AuthService: pass\n');
        writeFileSync(join(TMP_NS, 'mycompany/billing/__init__.py'), '');
        writeFileSync(join(TMP_NS, 'mycompany/billing/service.py'), 'class BillingService: pass\n');
        writeFileSync(join(TMP_NS, 'app.py'), 'from mycompany.auth.service import AuthService\n');
    });

    test('namespace without __init__: mycompany.auth.service from app.py', () => {
        const from = join(TMP_NS, 'app.py');
        const result = resolve(from, 'mycompany.auth.service', TMP_NS);
        expect(result).not.toBeNull();
        expect(result).toContain('mycompany/auth/service.py');
    });

    test('cleanup', () => {
        rmSync(TMP_NS, { recursive: true, force: true });
    });
});

/* ------------------------------------------------------------------ */
/*  4. Python Django app imports                                      */
/* ------------------------------------------------------------------ */

const TMP_DJANGO = join(import.meta.dir, '../fixtures/py-django-tmp');

describe('Python Django app imports', () => {
    test('setup', () => {
        rmSync(TMP_DJANGO, { recursive: true, force: true });
        mkdirSync(join(TMP_DJANGO, 'users'), { recursive: true });
        mkdirSync(join(TMP_DJANGO, 'orders'), { recursive: true });
        mkdirSync(join(TMP_DJANGO, 'myproject'), { recursive: true });

        writeFileSync(join(TMP_DJANGO, 'users/__init__.py'), '');
        writeFileSync(join(TMP_DJANGO, 'users/models.py'), 'class User: pass\n');
        writeFileSync(
            join(TMP_DJANGO, 'users/views.py'),
            ['from .models import User', 'from orders.models import Order', ''].join('\n'),
        );
        writeFileSync(join(TMP_DJANGO, 'orders/__init__.py'), '');
        writeFileSync(join(TMP_DJANGO, 'orders/models.py'), 'class Order: pass\n');
        writeFileSync(join(TMP_DJANGO, 'myproject/__init__.py'), '');
        writeFileSync(join(TMP_DJANGO, 'myproject/urls.py'), 'from users.views import index\n');
    });

    test('relative in app: .models from users/views.py', () => {
        const from = join(TMP_DJANGO, 'users/views.py');
        const result = resolve(from, '.models', TMP_DJANGO);
        expect(result).not.toBeNull();
        expect(result).toContain('users/models.py');
    });

    test('cross-app absolute: orders.models from users/views.py', () => {
        const from = join(TMP_DJANGO, 'users/views.py');
        const result = resolve(from, 'orders.models', TMP_DJANGO);
        expect(result).not.toBeNull();
        expect(result).toContain('orders/models.py');
    });

    test('top-level app import: users.views from myproject/urls.py', () => {
        const from = join(TMP_DJANGO, 'myproject/urls.py');
        const result = resolve(from, 'users.views', TMP_DJANGO);
        expect(result).not.toBeNull();
        expect(result).toContain('users/views.py');
    });

    test('cleanup', () => {
        rmSync(TMP_DJANGO, { recursive: true, force: true });
    });
});

/* ------------------------------------------------------------------ */
/*  5. Python wildcard import with __all__                            */
/* ------------------------------------------------------------------ */

const TMP_WILDCARD = join(import.meta.dir, '../fixtures/py-wildcard-tmp');

describe('Python wildcard import with __all__', () => {
    test('setup', () => {
        rmSync(TMP_WILDCARD, { recursive: true, force: true });
        mkdirSync(join(TMP_WILDCARD, 'mylib'), { recursive: true });

        writeFileSync(
            join(TMP_WILDCARD, 'mylib/__init__.py'),
            "__all__ = ['Foo', 'Bar']\nfrom .foo import Foo\nfrom .bar import Bar\n",
        );
        writeFileSync(join(TMP_WILDCARD, 'mylib/foo.py'), 'class Foo: pass\n');
        writeFileSync(join(TMP_WILDCARD, 'mylib/bar.py'), 'class Bar: pass\n');
        writeFileSync(join(TMP_WILDCARD, 'app.py'), 'from mylib import *\n');
    });

    test('wildcard import resolves to package __init__.py', () => {
        const result = resolve(join(TMP_WILDCARD, 'app.py'), 'mylib', TMP_WILDCARD);
        expect(result).not.toBeNull();
        expect(result).toContain('__init__.py');
    });

    test('cleanup', () => {
        rmSync(TMP_WILDCARD, { recursive: true, force: true });
    });
});

const TMP_SETUPCFG = join(import.meta.dir, '../fixtures/py-setupcfg-tmp');

describe('Python setup.cfg package_dir', () => {
    test('setup', () => {
        rmSync(TMP_SETUPCFG, { recursive: true, force: true });
        mkdirSync(join(TMP_SETUPCFG, 'src/mylib'), { recursive: true });

        writeFileSync(join(TMP_SETUPCFG, 'setup.cfg'), [
            '[options]',
            'package_dir =',
            '    = src',
        ].join('\n'));
        writeFileSync(join(TMP_SETUPCFG, 'src/mylib/__init__.py'), '');
        writeFileSync(join(TMP_SETUPCFG, 'src/mylib/core.py'), 'class Core: pass\n');
    });

    test('resolves import with setup.cfg src layout', () => {
        const result = resolve(
            join(TMP_SETUPCFG, 'test_app.py'),
            'mylib.core',
            TMP_SETUPCFG,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('src/mylib/core.py');
    });

    test('cleanup', () => {
        rmSync(TMP_SETUPCFG, { recursive: true, force: true });
    });
});

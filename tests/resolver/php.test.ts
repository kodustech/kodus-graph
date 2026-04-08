import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { clearCache, resolve } from '../../src/resolver/languages/php';

const TMP = join(import.meta.dir, '../fixtures/php-resolver-tmp');

describe('PHP import resolver', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'src/Models'), { recursive: true });
        mkdirSync(join(TMP, 'src/Services'), { recursive: true });
        writeFileSync(
            join(TMP, 'composer.json'),
            JSON.stringify(
                {
                    autoload: {
                        'psr-4': {
                            'App\\': 'src/',
                        },
                    },
                },
                null,
                2,
            ),
        );
        writeFileSync(join(TMP, 'src/Models/User.php'), '<?php\nnamespace App\\Models;\nclass User {}\n');
        writeFileSync(
            join(TMP, 'src/Services/AuthService.php'),
            '<?php\nnamespace App\\Services;\nclass AuthService {}\n',
        );
    });

    test('resolves PSR-4 mapped namespace to correct file', () => {
        const result = resolve('', 'App\\Models\\User', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('User.php');
    });

    test('resolves another PSR-4 mapped class', () => {
        const result = resolve('', 'App\\Services\\AuthService', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('AuthService.php');
    });

    test('returns null for vendor/external class not on disk', () => {
        expect(resolve('', 'Illuminate\\Database\\Eloquent\\Model', TMP)).toBeNull();
        expect(resolve('', 'Symfony\\Component\\HttpFoundation\\Request', TMP)).toBeNull();
    });

    test('returns null for non-existent PSR-4 class in mapped namespace', () => {
        expect(resolve('', 'App\\NonExistent\\FooBar', TMP)).toBeNull();
    });

    test('falls back to src/ directory without PSR-4 for simple path', () => {
        // The file src/Models/User.php also resolves via fallback if namespace is not PSR-4
        const tmpNoComposer = join(import.meta.dir, '../fixtures/php-resolver-nocomposer-tmp');
        rmSync(tmpNoComposer, { recursive: true, force: true });
        mkdirSync(join(tmpNoComposer, 'src/Helpers'), { recursive: true });
        writeFileSync(join(tmpNoComposer, 'src/Helpers/StringHelper.php'), '<?php\nclass StringHelper {}\n');
        const result = resolve('', 'Helpers/StringHelper', tmpNoComposer);
        expect(result).not.toBeNull();
        expect(result).toContain('StringHelper.php');
        rmSync(tmpNoComposer, { recursive: true, force: true });
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

const TMP_PSR4 = join(import.meta.dir, '../fixtures/php-psr4-tmp');

describe('PHP multi-root PSR-4', () => {
    test('setup', () => {
        clearCache();
        rmSync(TMP_PSR4, { recursive: true, force: true });
        mkdirSync(join(TMP_PSR4, 'src/Models'), { recursive: true });
        mkdirSync(join(TMP_PSR4, 'src/Http/Controllers'), { recursive: true });
        mkdirSync(join(TMP_PSR4, 'tests'), { recursive: true });
        writeFileSync(
            join(TMP_PSR4, 'composer.json'),
            JSON.stringify(
                {
                    autoload: {
                        'psr-4': {
                            'App\\': 'src/',
                            'Tests\\': 'tests/',
                        },
                    },
                },
                null,
                2,
            ),
        );
        writeFileSync(join(TMP_PSR4, 'src/Models/User.php'), '<?php\nnamespace App\\Models;\nclass User {}\n');
        writeFileSync(
            join(TMP_PSR4, 'src/Http/Controllers/UserController.php'),
            '<?php\nnamespace App\\Http\\Controllers;\nclass UserController {}\n',
        );
        writeFileSync(join(TMP_PSR4, 'tests/UserTest.php'), '<?php\nnamespace Tests;\nclass UserTest {}\n');
    });

    test('resolves App\\Models\\User to src/Models/User.php', () => {
        const result = resolve('', 'App\\Models\\User', TMP_PSR4);
        expect(result).not.toBeNull();
        expect(result).toContain('src/Models/User.php');
    });

    test('resolves App\\Http\\Controllers\\UserController to src/Http/Controllers/UserController.php', () => {
        const result = resolve('', 'App\\Http\\Controllers\\UserController', TMP_PSR4);
        expect(result).not.toBeNull();
        expect(result).toContain('src/Http/Controllers/UserController.php');
    });

    test('resolves Tests\\UserTest to tests/UserTest.php', () => {
        const result = resolve('', 'Tests\\UserTest', TMP_PSR4);
        expect(result).not.toBeNull();
        expect(result).toContain('tests/UserTest.php');
    });

    test('cleanup', () => {
        rmSync(TMP_PSR4, { recursive: true, force: true });
        clearCache();
    });
});

const TMP_LARAVEL = join(import.meta.dir, '../fixtures/php-laravel-tmp');

describe('PHP Laravel app/ convention', () => {
    test('setup', () => {
        clearCache();
        rmSync(TMP_LARAVEL, { recursive: true, force: true });
        mkdirSync(join(TMP_LARAVEL, 'app/Models'), { recursive: true });
        mkdirSync(join(TMP_LARAVEL, 'app/Services'), { recursive: true });
        writeFileSync(
            join(TMP_LARAVEL, 'composer.json'),
            JSON.stringify(
                {
                    autoload: {
                        'psr-4': {
                            'App\\': 'app/',
                        },
                    },
                },
                null,
                2,
            ),
        );
        writeFileSync(join(TMP_LARAVEL, 'app/Models/User.php'), '<?php\nnamespace App\\Models;\nclass User {}\n');
        writeFileSync(
            join(TMP_LARAVEL, 'app/Services/AuthService.php'),
            '<?php\nnamespace App\\Services;\nclass AuthService {}\n',
        );
    });

    test('resolves App\\Models\\User to app/Models/User.php', () => {
        const result = resolve('', 'App\\Models\\User', TMP_LARAVEL);
        expect(result).not.toBeNull();
        expect(result).toContain('app/Models/User.php');
    });

    test('cleanup', () => {
        rmSync(TMP_LARAVEL, { recursive: true, force: true });
        clearCache();
    });
});

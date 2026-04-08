import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from '../../src/resolver/languages/php';

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

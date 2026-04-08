import { describe, expect, test } from 'bun:test';
import { resolve } from '../../src/resolver/languages/csharp';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

const TMP = join(import.meta.dir, '../fixtures/csharp-resolver-tmp');

describe('C# import resolver', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'src/Services'), { recursive: true });
        mkdirSync(join(TMP, 'src/Models'), { recursive: true });
        writeFileSync(
            join(TMP, 'src/Services/AuthService.cs'),
            'namespace MyApp.Services { public class AuthService {} }\n',
        );
        writeFileSync(
            join(TMP, 'src/Models/User.cs'),
            'namespace MyApp.Models { public class User {} }\n',
        );
    });

    test('resolves namespace by trailing class name segment', () => {
        const result = resolve('', 'MyApp.Services.AuthService', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('AuthService.cs');
    });

    test('resolves another namespace', () => {
        const result = resolve('', 'MyApp.Models.User', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('User.cs');
    });

    test('returns null for System.* stdlib', () => {
        expect(resolve('', 'System.Collections.Generic', TMP)).toBeNull();
        expect(resolve('', 'System.IO', TMP)).toBeNull();
        expect(resolve('', 'System', TMP)).toBeNull();
    });

    test('returns null for Microsoft.* stdlib', () => {
        expect(resolve('', 'Microsoft.Extensions.Logging', TMP)).toBeNull();
    });

    test('returns null for Newtonsoft.* stdlib', () => {
        expect(resolve('', 'Newtonsoft.Json', TMP)).toBeNull();
    });

    test('returns null for unknown namespace not on disk', () => {
        expect(resolve('', 'ThirdParty.Library.SomeClass', TMP)).toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

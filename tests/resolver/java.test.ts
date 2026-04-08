import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from '../../src/resolver/languages/java';

const TMP = join(import.meta.dir, '../fixtures/java-resolver-tmp');

describe('Java import resolver', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'src/main/java/com/example/auth'), { recursive: true });
        mkdirSync(join(TMP, 'src/main/java/com/example/models'), { recursive: true });
        writeFileSync(
            join(TMP, 'src/main/java/com/example/auth/AuthService.java'),
            'package com.example.auth;\npublic class AuthService {}\n',
        );
        writeFileSync(
            join(TMP, 'src/main/java/com/example/models/User.java'),
            'package com.example.models;\npublic class User {}\n',
        );
    });

    test('resolves fully-qualified class name under src/main/java', () => {
        const result = resolve('', 'com.example.auth.AuthService', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('AuthService.java');
    });

    test('resolves another class in models package', () => {
        const result = resolve('', 'com.example.models.User', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('User.java');
    });

    test('returns null for java.* stdlib', () => {
        expect(resolve('', 'java.util.List', TMP)).toBeNull();
        expect(resolve('', 'java.io.File', TMP)).toBeNull();
    });

    test('returns null for javax.* stdlib', () => {
        expect(resolve('', 'javax.servlet.http.HttpServletRequest', TMP)).toBeNull();
    });

    test('returns null for wildcard imports', () => {
        expect(resolve('', 'com.example.auth.*', TMP)).toBeNull();
    });

    test('returns null for external library not present on disk', () => {
        expect(resolve('', 'org.springframework.boot.SpringApplication', TMP)).toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

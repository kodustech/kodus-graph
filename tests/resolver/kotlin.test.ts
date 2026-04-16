import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolve } from '../../src/languages/java/resolver';

/**
 * Kotlin import resolution delegates to the Java resolver since both languages
 * share the same package → file path mapping and build systems (Maven/Gradle).
 * The Java resolver already probes .kt extensions and src/main/kotlin source roots.
 */

const TMP = join(import.meta.dir, '../fixtures/kotlin-resolver-tmp');

describe('Kotlin import resolver', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'src/main/kotlin/com/example/auth'), { recursive: true });
        mkdirSync(join(TMP, 'src/main/kotlin/com/example/models'), { recursive: true });
        writeFileSync(
            join(TMP, 'src/main/kotlin/com/example/auth/AuthService.kt'),
            'package com.example.auth\nclass AuthService {}\n',
        );
        writeFileSync(
            join(TMP, 'src/main/kotlin/com/example/models/User.kt'),
            'package com.example.models\ndata class User(val name: String)\n',
        );
    });

    test('resolves fully-qualified class name under src/main/kotlin', () => {
        const result = resolve('', 'com.example.auth.AuthService', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('AuthService.kt');
    });

    test('resolves another class in models package', () => {
        const result = resolve('', 'com.example.models.User', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('User.kt');
    });

    test('returns null for kotlin.* stdlib', () => {
        expect(resolve('', 'kotlin.collections.List', TMP)).toBeNull();
    });

    test('returns null for kotlinx.* stdlib', () => {
        expect(resolve('', 'kotlinx.coroutines.launch', TMP)).toBeNull();
    });

    test('returns null for java.* stdlib', () => {
        expect(resolve('', 'java.util.List', TMP)).toBeNull();
    });

    test('returns null for external library not present on disk', () => {
        expect(resolve('', 'org.springframework.boot.SpringApplication', TMP)).toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

const TMP_MIXED = join(import.meta.dir, '../fixtures/kotlin-mixed-tmp');

describe('Kotlin + Java interop resolution', () => {
    test('setup', () => {
        rmSync(TMP_MIXED, { recursive: true, force: true });
        mkdirSync(join(TMP_MIXED, 'src/main/java/com/example'), { recursive: true });
        mkdirSync(join(TMP_MIXED, 'src/main/kotlin/com/example'), { recursive: true });
        writeFileSync(
            join(TMP_MIXED, 'src/main/java/com/example/JavaHelper.java'),
            'package com.example;\npublic class JavaHelper {}\n',
        );
        writeFileSync(
            join(TMP_MIXED, 'src/main/kotlin/com/example/KotlinService.kt'),
            'package com.example\nclass KotlinService {}\n',
        );
    });

    test('resolves Kotlin class from Kotlin import path', () => {
        const result = resolve('', 'com.example.KotlinService', TMP_MIXED);
        expect(result).not.toBeNull();
        expect(result).toContain('KotlinService.kt');
    });

    test('resolves Java class from Kotlin import path', () => {
        const result = resolve('', 'com.example.JavaHelper', TMP_MIXED);
        expect(result).not.toBeNull();
        expect(result).toContain('JavaHelper.java');
    });

    test('cleanup', () => {
        rmSync(TMP_MIXED, { recursive: true, force: true });
    });
});

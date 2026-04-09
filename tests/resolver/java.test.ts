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

    test('wildcard import resolves to a file in the package directory', () => {
        const result = resolve('', 'com.example.auth.*', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('AuthService.java');
    });

    test('returns null for external library not present on disk', () => {
        expect(resolve('', 'org.springframework.boot.SpringApplication', TMP)).toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

const TMP_WILDCARD = join(import.meta.dir, '../fixtures/java-wildcard-tmp');

describe('Java wildcard and inner class', () => {
    test('setup', () => {
        rmSync(TMP_WILDCARD, { recursive: true, force: true });
        mkdirSync(join(TMP_WILDCARD, 'src/main/java/com/example/models'), { recursive: true });
        mkdirSync(join(TMP_WILDCARD, 'src/main/java/com/example'), { recursive: true });
        writeFileSync(
            join(TMP_WILDCARD, 'src/main/java/com/example/models/User.java'),
            'package com.example.models;\npublic class User {}\n',
        );
        writeFileSync(
            join(TMP_WILDCARD, 'src/main/java/com/example/models/Order.java'),
            'package com.example.models;\npublic class Order {}\n',
        );
        writeFileSync(
            join(TMP_WILDCARD, 'src/main/java/com/example/Config.java'),
            'package com.example;\npublic class Config {\n    public static class DatabaseSettings {}\n}\n',
        );
        writeFileSync(
            join(TMP_WILDCARD, 'src/main/java/com/example/Constants.java'),
            'package com.example;\npublic class Constants {}\n',
        );
    });

    test('wildcard import com.example.models.* resolves to directory', () => {
        const result = resolve('', 'com.example.models.*', TMP_WILDCARD);
        expect(result).not.toBeNull();
    });

    test('inner class com.example.Config.DatabaseSettings resolves to Config.java', () => {
        const result = resolve('', 'com.example.Config.DatabaseSettings', TMP_WILDCARD);
        expect(result).not.toBeNull();
        expect(result).toContain('Config.java');
    });

    test('regular class com.example.Constants resolves to Constants.java', () => {
        const result = resolve('', 'com.example.Constants', TMP_WILDCARD);
        expect(result).not.toBeNull();
        expect(result).toContain('Constants.java');
    });

    test('cleanup', () => {
        rmSync(TMP_WILDCARD, { recursive: true, force: true });
    });
});

const TMP_MULTI = join(import.meta.dir, '../fixtures/java-multi-tmp');

describe('Java multi-module (Gradle)', () => {
    test('setup', () => {
        rmSync(TMP_MULTI, { recursive: true, force: true });
        mkdirSync(join(TMP_MULTI, 'app/src/main/java/com/example/app'), { recursive: true });
        mkdirSync(join(TMP_MULTI, 'lib/src/main/java/com/example/lib'), { recursive: true });
        writeFileSync(join(TMP_MULTI, 'settings.gradle'), "include ':app', ':lib'\n");
        writeFileSync(
            join(TMP_MULTI, 'app/src/main/java/com/example/app/Main.java'),
            'package com.example.app;\npublic class Main {}\n',
        );
        writeFileSync(
            join(TMP_MULTI, 'lib/src/main/java/com/example/lib/SharedUtil.java'),
            'package com.example.lib;\npublic class SharedUtil {}\n',
        );
    });

    test('cross-module import com.example.lib.SharedUtil resolves to lib/.../SharedUtil.java', () => {
        const result = resolve('', 'com.example.lib.SharedUtil', TMP_MULTI);
        expect(result).not.toBeNull();
        expect(result).toContain('SharedUtil.java');
    });

    test('cleanup', () => {
        rmSync(TMP_MULTI, { recursive: true, force: true });
    });
});

const TMP_MAVEN = join(import.meta.dir, '../fixtures/java-maven-multi-tmp');

describe('Java Maven multi-module', () => {
    test('setup', () => {
        rmSync(TMP_MAVEN, { recursive: true, force: true });
        mkdirSync(join(TMP_MAVEN, 'api/src/main/java/com/example/api'), { recursive: true });
        mkdirSync(join(TMP_MAVEN, 'core/src/main/java/com/example/core'), { recursive: true });

        writeFileSync(
            join(TMP_MAVEN, 'pom.xml'),
            [
                '<project>',
                '  <modules>',
                '    <module>api</module>',
                '    <module>core</module>',
                '  </modules>',
                '</project>',
            ].join('\n'),
        );
        writeFileSync(join(TMP_MAVEN, 'api/pom.xml'), '<project></project>\n');
        writeFileSync(join(TMP_MAVEN, 'core/pom.xml'), '<project></project>\n');
        writeFileSync(
            join(TMP_MAVEN, 'api/src/main/java/com/example/api/Controller.java'),
            'package com.example.api;\nimport com.example.core.Service;\n',
        );
        writeFileSync(
            join(TMP_MAVEN, 'core/src/main/java/com/example/core/Service.java'),
            'package com.example.core;\npublic class Service {}\n',
        );
    });

    test('resolves cross-module import via Maven pom.xml modules', () => {
        const result = resolve('', 'com.example.core.Service', TMP_MAVEN);
        expect(result).not.toBeNull();
        expect(result).toContain('Service.java');
    });

    test('cleanup', () => {
        rmSync(TMP_MAVEN, { recursive: true, force: true });
    });
});

const TMP_KOTLIN = join(import.meta.dir, '../fixtures/java-kotlin-tmp');

describe('Java Kotlin interop', () => {
    test('setup', () => {
        rmSync(TMP_KOTLIN, { recursive: true, force: true });
        mkdirSync(join(TMP_KOTLIN, 'src/main/java/com/example'), { recursive: true });
        mkdirSync(join(TMP_KOTLIN, 'src/main/kotlin/com/example'), { recursive: true });
        writeFileSync(
            join(TMP_KOTLIN, 'src/main/java/com/example/App.java'),
            'package com.example;\npublic class App {}\n',
        );
        writeFileSync(
            join(TMP_KOTLIN, 'src/main/kotlin/com/example/KotlinHelper.kt'),
            'package com.example\nclass KotlinHelper {}\n',
        );
    });

    test('Kotlin class com.example.KotlinHelper resolves to KotlinHelper.kt', () => {
        const result = resolve('', 'com.example.KotlinHelper', TMP_KOTLIN);
        expect(result).not.toBeNull();
        expect(result).toContain('KotlinHelper.kt');
    });

    test('cleanup', () => {
        rmSync(TMP_KOTLIN, { recursive: true, force: true });
    });
});

const TMP_NESTED_MAVEN = join(import.meta.dir, '../fixtures/java-nested-maven-tmp');

describe('Java nested Maven multi-module', () => {
    test('setup', () => {
        rmSync(TMP_NESTED_MAVEN, { recursive: true, force: true });
        mkdirSync(join(TMP_NESTED_MAVEN, 'core/sub/src/main/java/com/example/sub'), { recursive: true });
        mkdirSync(join(TMP_NESTED_MAVEN, 'core/src/main/java/com/example/core'), { recursive: true });

        writeFileSync(join(TMP_NESTED_MAVEN, 'pom.xml'), [
            '<project><modules><module>core</module></modules></project>',
        ].join('\n'));
        writeFileSync(join(TMP_NESTED_MAVEN, 'core/pom.xml'), [
            '<project><modules><module>sub</module></modules></project>',
        ].join('\n'));
        writeFileSync(join(TMP_NESTED_MAVEN, 'core/sub/pom.xml'), '<project></project>\n');
        writeFileSync(
            join(TMP_NESTED_MAVEN, 'core/sub/src/main/java/com/example/sub/Deep.java'),
            'package com.example.sub;\npublic class Deep {}\n',
        );
        writeFileSync(
            join(TMP_NESTED_MAVEN, 'core/src/main/java/com/example/core/Service.java'),
            'package com.example.core;\npublic class Service {}\n',
        );
    });

    test('resolves class in nested Maven submodule', () => {
        const result = resolve('', 'com.example.sub.Deep', TMP_NESTED_MAVEN);
        expect(result).not.toBeNull();
        expect(result).toContain('Deep.java');
    });

    test('resolves class in first-level module', () => {
        const result = resolve('', 'com.example.core.Service', TMP_NESTED_MAVEN);
        expect(result).not.toBeNull();
        expect(result).toContain('Service.java');
    });

    test('cleanup', () => {
        rmSync(TMP_NESTED_MAVEN, { recursive: true, force: true });
    });
});

const TMP_SRCSET = join(import.meta.dir, '../fixtures/java-srcset-tmp');

describe('Java Gradle custom sourceSets', () => {
    test('setup', () => {
        rmSync(TMP_SRCSET, { recursive: true, force: true });
        mkdirSync(join(TMP_SRCSET, 'app/src/generated/java/com/example/gen'), { recursive: true });

        writeFileSync(join(TMP_SRCSET, 'settings.gradle'), "include ':app'\n");
        writeFileSync(join(TMP_SRCSET, 'app/build.gradle'), [
            'sourceSets {',
            '    main {',
            '        java {',
            "            srcDirs = ['src/main/java', 'src/generated/java']",
            '        }',
            '    }',
            '}',
        ].join('\n'));
        writeFileSync(
            join(TMP_SRCSET, 'app/src/generated/java/com/example/gen/Generated.java'),
            'package com.example.gen;\npublic class Generated {}\n',
        );
    });

    test('resolves class in custom sourceSet directory', () => {
        const result = resolve('', 'com.example.gen.Generated', TMP_SRCSET);
        expect(result).not.toBeNull();
        expect(result).toContain('Generated.java');
    });

    test('cleanup', () => {
        rmSync(TMP_SRCSET, { recursive: true, force: true });
    });
});

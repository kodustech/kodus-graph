import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { clearExternalCache, detectExternal } from '../../src/resolver/external-detector';

const TMP = join(import.meta.dir, '../fixtures/external-detector-tmp');

describe('External package detection', () => {
    beforeAll(() => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(TMP, { recursive: true });

        // TypeScript project
        writeFileSync(
            join(TMP, 'package.json'),
            JSON.stringify({
                dependencies: { 'react': '^18', '@nestjs/common': '^10', 'lodash': '^4' },
                devDependencies: { 'vitest': '^1', '@types/react': '^18' },
            }),
        );

        // Python project
        writeFileSync(join(TMP, 'requirements.txt'), 'django>=4.0\nflask>=2.0\nrequests>=2.28\n');

        // Go project
        writeFileSync(
            join(TMP, 'go.mod'),
            [
                'module github.com/acme/app',
                '',
                'go 1.21',
                '',
                'require (',
                '\tgithub.com/gin-gonic/gin v1.9.0',
                '\tgithub.com/lib/pq v1.10.0',
                ')',
            ].join('\n'),
        );

        // Rust project
        writeFileSync(
            join(TMP, 'Cargo.toml'),
            [
                '[package]',
                'name = "myapp"',
                '',
                '[dependencies]',
                'serde = { version = "1", features = ["derive"] }',
                'tokio = "1"',
            ].join('\n'),
        );

        // Java project
        writeFileSync(
            join(TMP, 'pom.xml'),
            [
                '<project>',
                '  <dependencies>',
                '    <dependency>',
                '      <groupId>org.springframework.boot</groupId>',
                '      <artifactId>spring-boot-starter-web</artifactId>',
                '    </dependency>',
                '  </dependencies>',
                '</project>',
            ].join('\n'),
        );

        // PHP project
        writeFileSync(
            join(TMP, 'composer.json'),
            JSON.stringify({
                require: { 'laravel/framework': '^10', 'guzzlehttp/guzzle': '^7' },
                autoload: { 'psr-4': { 'App\\': 'src/' } },
            }),
        );

        // Ruby project
        writeFileSync(join(TMP, 'Gemfile'), "gem 'rails', '~> 7.0'\ngem 'pg'\ngem 'devise'\n");

        clearExternalCache();
    });

    afterAll(() => {
        rmSync(TMP, { recursive: true, force: true });
        clearExternalCache();
    });

    // TypeScript
    it('detects npm dependency as external (TS)', () => {
        expect(detectExternal('react', 'typescript', TMP)).toBe('react');
    });
    it('detects scoped npm dependency (TS)', () => {
        expect(detectExternal('@nestjs/common', 'typescript', TMP)).toBe('@nestjs/common');
    });
    it('detects node builtin (TS)', () => {
        expect(detectExternal('fs', 'typescript', TMP)).toBe('fs');
    });
    it('detects node: prefixed builtin (TS)', () => {
        expect(detectExternal('node:path', 'typescript', TMP)).toBe('node:path');
    });
    it('does not flag relative import as external (TS)', () => {
        expect(detectExternal('./utils', 'typescript', TMP)).toBeNull();
    });
    it('does not flag #import as external (TS)', () => {
        expect(detectExternal('#db/conn', 'typescript', TMP)).toBeNull();
    });

    // Python
    it('detects pip dependency (Python)', () => {
        expect(detectExternal('django', 'python', TMP)).toBe('django');
    });
    it('detects pip dependency submodule (Python)', () => {
        expect(detectExternal('django.db.models', 'python', TMP)).toBe('django');
    });
    it('detects Python stdlib (Python)', () => {
        expect(detectExternal('os', 'python', TMP)).toBe('os');
    });
    it('does not flag relative import as external (Python)', () => {
        expect(detectExternal('.models', 'python', TMP)).toBeNull();
    });

    // Go
    it('detects Go stdlib (Go)', () => {
        expect(detectExternal('fmt', 'go', TMP)).toBe('fmt');
    });
    it('detects Go external module (Go)', () => {
        expect(detectExternal('github.com/gin-gonic/gin', 'go', TMP)).toBe('github.com/gin-gonic/gin');
    });
    it('does not flag own module as external (Go)', () => {
        expect(detectExternal('github.com/acme/app/internal/auth', 'go', TMP)).toBeNull();
    });

    // Rust
    it('detects Rust stdlib (Rust)', () => {
        expect(detectExternal('std::fmt', 'rust', TMP)).toBe('std');
    });
    it('detects Cargo dependency (Rust)', () => {
        expect(detectExternal('serde::Serialize', 'rust', TMP)).toBe('serde');
    });
    it('does not flag crate:: as external (Rust)', () => {
        expect(detectExternal('crate::models', 'rust', TMP)).toBeNull();
    });

    // Java
    it('detects Java stdlib (Java)', () => {
        expect(detectExternal('java.util.List', 'java', TMP)).toBe('java.util');
    });
    it('detects Maven dependency (Java)', () => {
        expect(detectExternal('org.springframework.boot.SpringApplication', 'java', TMP)).toBe(
            'spring-boot-starter-web',
        );
    });

    // PHP
    it('detects Composer dependency (PHP)', () => {
        expect(detectExternal('Illuminate\\Support\\Facades\\DB', 'php', TMP)).toBe('laravel/framework');
    });

    // Ruby
    it('detects gem dependency (Ruby)', () => {
        expect(detectExternal('devise', 'ruby', TMP)).toBe('devise');
    });
    it('detects Ruby stdlib (Ruby)', () => {
        expect(detectExternal('json', 'ruby', TMP)).toBe('json');
    });
});

import { describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { clearCache, resolve } from '../../src/languages/go/resolver';

const TMP = join(import.meta.dir, '../fixtures/go-resolver-tmp');

describe('Go import resolver', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'pkg/auth'), { recursive: true });
        mkdirSync(join(TMP, 'internal/db'), { recursive: true });
        writeFileSync(join(TMP, 'go.mod'), 'module github.com/example/myapp\n\ngo 1.21\n');
        writeFileSync(join(TMP, 'pkg/auth/auth.go'), 'package auth\n');
        writeFileSync(join(TMP, 'internal/db/db.go'), 'package db\n');
    });

    test('resolves module-prefixed package import to directory entry file', () => {
        const result = resolve('', 'github.com/example/myapp/pkg/auth', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('auth.go');
    });

    test('resolves internal package import', () => {
        const result = resolve('', 'github.com/example/myapp/internal/db', TMP);
        expect(result).not.toBeNull();
        expect(result).toContain('db.go');
    });

    test('returns null for stdlib import (no dot in first segment)', () => {
        expect(resolve('', 'fmt', TMP)).toBeNull();
        expect(resolve('', 'net/http', TMP)).toBeNull();
        expect(resolve('', 'os', TMP)).toBeNull();
    });

    test('returns null for external third-party import', () => {
        expect(resolve('', 'github.com/gin-gonic/gin', TMP)).toBeNull();
        expect(resolve('', 'golang.org/x/sync/errgroup', TMP)).toBeNull();
    });

    test('returns null when go.mod is absent', () => {
        expect(resolve('', 'github.com/example/myapp/pkg/auth', '/tmp/nonexistent-go-root')).toBeNull();
    });

    test('cleanup', () => {
        rmSync(TMP, { recursive: true, force: true });
    });
});

const TMP_REPLACE = join(import.meta.dir, '../fixtures/go-replace-tmp');

describe('Go replace directives', () => {
    test('setup', () => {
        clearCache();
        rmSync(TMP_REPLACE, { recursive: true, force: true });
        mkdirSync(join(TMP_REPLACE, 'libs/shared/utils'), { recursive: true });
        writeFileSync(
            join(TMP_REPLACE, 'go.mod'),
            [
                'module github.com/acme/app',
                '',
                'go 1.21',
                '',
                'require github.com/acme/shared v0.0.0',
                '',
                'replace github.com/acme/shared => ./libs/shared',
                '',
            ].join('\n'),
        );
        writeFileSync(join(TMP_REPLACE, 'libs/shared/go.mod'), 'module github.com/acme/shared\n\ngo 1.21\n');
        writeFileSync(join(TMP_REPLACE, 'libs/shared/utils/helpers.go'), 'package utils\n');
    });

    test('resolves replace-directive local module import', () => {
        const result = resolve('', 'github.com/acme/shared/utils', TMP_REPLACE);
        expect(result).not.toBeNull();
        expect(result).toContain('helpers.go');
    });

    test('cleanup', () => {
        rmSync(TMP_REPLACE, { recursive: true, force: true });
        clearCache();
    });
});

const TMP_WORKSPACE = join(import.meta.dir, '../fixtures/go-workspace-tmp');

describe('Go workspace (go.work)', () => {
    test('setup', () => {
        clearCache();
        rmSync(TMP_WORKSPACE, { recursive: true, force: true });
        mkdirSync(join(TMP_WORKSPACE, 'svc-api/handler'), { recursive: true });
        mkdirSync(join(TMP_WORKSPACE, 'lib-core/models'), { recursive: true });

        writeFileSync(
            join(TMP_WORKSPACE, 'go.work'),
            ['go 1.21', '', 'use (', '    ./svc-api', '    ./lib-core', ')', ''].join('\n'),
        );
        writeFileSync(join(TMP_WORKSPACE, 'svc-api/go.mod'), 'module github.com/acme/svc-api\n\ngo 1.21\n');
        writeFileSync(join(TMP_WORKSPACE, 'svc-api/handler/handler.go'), 'package handler\n');
        writeFileSync(join(TMP_WORKSPACE, 'lib-core/go.mod'), 'module github.com/acme/lib-core\n\ngo 1.21\n');
        writeFileSync(join(TMP_WORKSPACE, 'lib-core/models/user.go'), 'package models\n');
    });

    test('resolves cross-module import via go.work', () => {
        const result = resolve(
            join(TMP_WORKSPACE, 'svc-api/handler/handler.go'),
            'github.com/acme/lib-core/models',
            TMP_WORKSPACE,
        );
        expect(result).not.toBeNull();
        expect(result).toContain('user.go');
    });

    test('cleanup', () => {
        rmSync(TMP_WORKSPACE, { recursive: true, force: true });
        clearCache();
    });
});

const TMP_VENDOR = join(import.meta.dir, '../fixtures/go-vendor-tmp');

describe('Go vendor directory', () => {
    test('setup', () => {
        rmSync(TMP_VENDOR, { recursive: true, force: true });
        mkdirSync(join(TMP_VENDOR, 'vendor/github.com/thirdparty/lib'), { recursive: true });
        mkdirSync(join(TMP_VENDOR, 'pkg'), { recursive: true });

        writeFileSync(join(TMP_VENDOR, 'go.mod'), 'module github.com/acme/vendored\n\ngo 1.21\n');
        writeFileSync(join(TMP_VENDOR, 'vendor/github.com/thirdparty/lib/lib.go'), 'package lib\n');
        writeFileSync(join(TMP_VENDOR, 'main.go'), 'package main\n');
        clearCache();
    });

    test('resolves vendored dependency', () => {
        const result = resolve('', 'github.com/thirdparty/lib', TMP_VENDOR);
        expect(result).not.toBeNull();
        expect(result).toContain('vendor');
        expect(result).toContain('lib.go');
    });

    test('cleanup', () => {
        rmSync(TMP_VENDOR, { recursive: true, force: true });
        clearCache();
    });
});

describe('Go CGo sentinel', () => {
    test('import "C" returns null', () => {
        clearCache();
        expect(resolve('', 'C', TMP)).toBeNull();
    });
});

const TMP_INTERNAL = join(import.meta.dir, '../fixtures/go-internal-tmp');

describe('Go internal package', () => {
    test('setup', () => {
        rmSync(TMP_INTERNAL, { recursive: true, force: true });
        mkdirSync(join(TMP_INTERNAL, 'internal/auth'), { recursive: true });
        writeFileSync(join(TMP_INTERNAL, 'go.mod'), 'module github.com/acme/svc\n\ngo 1.21\n');
        writeFileSync(join(TMP_INTERNAL, 'internal/auth/handler.go'), 'package auth\n');
        clearCache();
    });

    test('resolves internal package normally', () => {
        const result = resolve('', 'github.com/acme/svc/internal/auth', TMP_INTERNAL);
        expect(result).not.toBeNull();
        expect(result).toContain('handler.go');
    });

    test('cleanup', () => {
        rmSync(TMP_INTERNAL, { recursive: true, force: true });
        clearCache();
    });
});

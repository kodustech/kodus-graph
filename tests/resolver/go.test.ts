import { describe, expect, test } from 'bun:test';
import { resolve } from '../../src/resolver/languages/go';
import { join } from 'path';
import { mkdirSync, writeFileSync, rmSync } from 'fs';

const TMP = join(import.meta.dir, '../fixtures/go-resolver-tmp');

describe('Go import resolver', () => {
    test('setup', () => {
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'pkg/auth'), { recursive: true });
        mkdirSync(join(TMP, 'internal/db'), { recursive: true });
        writeFileSync(
            join(TMP, 'go.mod'),
            'module github.com/example/myapp\n\ngo 1.21\n',
        );
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

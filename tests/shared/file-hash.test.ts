import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { computeFileHash } from '../../src/shared/file-hash';

describe('computeFileHash', () => {
    const tmpDir = '/tmp/kodus-graph-test-hash';

    it('should return consistent SHA-256 hash', () => {
        mkdirSync(tmpDir, { recursive: true });
        const file = join(tmpDir, 'test.ts');
        writeFileSync(file, 'const x = 1;');
        const hash1 = computeFileHash(file);
        const hash2 = computeFileHash(file);
        expect(hash1).toBe(hash2);
        expect(hash1).toHaveLength(64); // SHA-256 hex
        rmSync(tmpDir, { recursive: true });
    });

    it('should return different hash for different content', () => {
        mkdirSync(tmpDir, { recursive: true });
        const file = join(tmpDir, 'test.ts');
        writeFileSync(file, 'const x = 1;');
        const hash1 = computeFileHash(file);
        writeFileSync(file, 'const x = 2;');
        const hash2 = computeFileHash(file);
        expect(hash1).not.toBe(hash2);
        rmSync(tmpDir, { recursive: true });
    });
});

import { beforeEach, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { cachedExists, cachedReaddir, clearFsCache } from '../../src/resolver/fs-cache';

const TMP = join(import.meta.dir, '../fixtures/fs-cache-tmp');

describe('fs-cache', () => {
    beforeEach(() => {
        clearFsCache();
        rmSync(TMP, { recursive: true, force: true });
        mkdirSync(join(TMP, 'sub'), { recursive: true });
        writeFileSync(join(TMP, 'file.txt'), 'hello');
        writeFileSync(join(TMP, 'sub/a.ts'), '');
        writeFileSync(join(TMP, 'sub/b.ts'), '');
    });

    it('cachedExists returns true for existing file', () => {
        expect(cachedExists(join(TMP, 'file.txt'))).toBe(true);
    });

    it('cachedExists returns false for missing file', () => {
        expect(cachedExists(join(TMP, 'nope.txt'))).toBe(false);
    });

    it('cachedReaddir lists directory contents sorted', () => {
        const files = cachedReaddir(join(TMP, 'sub'));
        expect(files).toEqual(['a.ts', 'b.ts']);
    });

    it('cachedReaddir returns empty for non-existent dir', () => {
        expect(cachedReaddir(join(TMP, 'missing'))).toEqual([]);
    });

    it('clearFsCache resets all caches', () => {
        cachedExists(join(TMP, 'file.txt'));
        clearFsCache();
        // After clearing, a new file should be detected
        writeFileSync(join(TMP, 'new.txt'), '');
        expect(cachedExists(join(TMP, 'new.txt'))).toBe(true);
    });
});

import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, rmSync, statSync } from 'fs';
import { createSecureTempFile } from '../../src/shared/temp';

describe('createSecureTempFile', () => {
  const cleanupDirs: string[] = [];

  afterEach(() => {
    for (const dir of cleanupDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    cleanupDirs.length = 0;
  });

  it('should create a temp directory and return file path', () => {
    const tmp = createSecureTempFile('test');
    cleanupDirs.push(tmp.dir);
    expect(existsSync(tmp.dir)).toBe(true);
    expect(tmp.filePath.startsWith(tmp.dir)).toBe(true);
    expect(tmp.filePath.endsWith('.json')).toBe(true);
  });

  it('should create directory with restricted permissions (0700)', () => {
    const tmp = createSecureTempFile('perms');
    cleanupDirs.push(tmp.dir);
    const stats = statSync(tmp.dir);
    const mode = stats.mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('should generate unique file names on consecutive calls', () => {
    const a = createSecureTempFile('uniq');
    const b = createSecureTempFile('uniq');
    cleanupDirs.push(a.dir, b.dir);
    expect(a.filePath).not.toBe(b.filePath);
    expect(a.dir).not.toBe(b.dir);
  });

  it('should include the prefix in the directory name', () => {
    const tmp = createSecureTempFile('ctx');
    cleanupDirs.push(tmp.dir);
    expect(tmp.dir).toContain('kodus-graph-ctx-');
  });
});

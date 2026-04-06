import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, symlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { ensureWithinRoot } from '../../src/shared/safe-path';

describe('ensureWithinRoot', () => {
  const repoRoot = resolve('tests/fixtures/sample-repo');

  it('should accept a path within the root', () => {
    const result = ensureWithinRoot(join(repoRoot, 'src/auth.ts'), repoRoot);
    expect(result).toBe(resolve(repoRoot, 'src/auth.ts'));
  });

  it('should throw for path traversal with ../', () => {
    expect(() => {
      ensureWithinRoot(join(repoRoot, '../../etc/passwd'), repoRoot);
    }).toThrow('Path escapes repository root');
  });

  it('should throw for absolute path outside root', () => {
    expect(() => {
      ensureWithinRoot('/etc/passwd', repoRoot);
    }).toThrow('Path escapes repository root');
  });

  it('should throw for path with embedded traversal', () => {
    expect(() => {
      ensureWithinRoot(join(repoRoot, 'src/../../../../../../etc/shadow'), repoRoot);
    }).toThrow('Path escapes repository root');
  });

  it('should handle symlink escape attempts', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'safe-path-test-'));
    const symlinkPath = join(tmpDir, 'escape');
    try {
      symlinkSync('/etc', symlinkPath);
      expect(() => {
        ensureWithinRoot(join(symlinkPath, 'passwd'), tmpDir);
      }).toThrow('Path escapes repository root');
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('should accept path that does not exist yet (speculative)', () => {
    const result = ensureWithinRoot(join(repoRoot, 'src/new-file.ts'), repoRoot);
    expect(result).toBe(resolve(repoRoot, 'src/new-file.ts'));
  });
});

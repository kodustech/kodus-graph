import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { discoverFiles } from '../../src/parser/discovery';

const TMP = '/tmp/kodus-graph-discovery-test';

function setupFixture() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, 'src/core'), { recursive: true });
  mkdirSync(join(TMP, 'src/utils'), { recursive: true });
  mkdirSync(join(TMP, 'tests'), { recursive: true });
  mkdirSync(join(TMP, 'vendor'), { recursive: true });
  writeFileSync(join(TMP, 'src/core/auth.ts'), 'export function login() {}');
  writeFileSync(join(TMP, 'src/core/auth.test.ts'), 'test("login", () => {})');
  writeFileSync(join(TMP, 'src/utils/helpers.ts'), 'export function help() {}');
  writeFileSync(join(TMP, 'tests/e2e.ts'), 'test("e2e", () => {})');
  writeFileSync(join(TMP, 'vendor/lib.ts'), 'export function vendored() {}');
}

describe('discoverFiles', () => {
  const tmpDir = '/tmp/kodus-graph-test-discovery';

  it('should find supported files and skip node_modules', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    mkdirSync(join(tmpDir, 'node_modules/pkg'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/app.ts'), 'const x = 1;');
    writeFileSync(join(tmpDir, 'src/util.py'), 'x = 1');
    writeFileSync(join(tmpDir, 'src/readme.txt'), 'hello');
    writeFileSync(join(tmpDir, 'node_modules/pkg/index.js'), 'module.exports = {}');

    const files = discoverFiles(tmpDir);
    expect(files).toContain(join(tmpDir, 'src/app.ts'));
    expect(files).toContain(join(tmpDir, 'src/util.py'));
    expect(files).not.toContain(join(tmpDir, 'src/readme.txt'));
    expect(files).not.toContain(join(tmpDir, 'node_modules/pkg/index.js'));

    rmSync(tmpDir, { recursive: true });
  });

  it('should filter to specific files when provided', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/a.ts'), 'const a = 1;');
    writeFileSync(join(tmpDir, 'src/b.ts'), 'const b = 2;');

    const files = discoverFiles(tmpDir, ['src/a.ts']);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('a.ts');

    rmSync(tmpDir, { recursive: true });
  });

  it('should skip minified and bundled files', () => {
    mkdirSync(join(tmpDir, 'src'), { recursive: true });
    writeFileSync(join(tmpDir, 'src/app.ts'), 'const x = 1;');
    writeFileSync(join(tmpDir, 'src/chart.min.js'), 'minified code');
    writeFileSync(join(tmpDir, 'src/vendor.bundle.js'), 'bundled code');
    writeFileSync(join(tmpDir, 'src/viz-3.0.1.js'), 'vendored code'); // not minified, should still be included
    writeFileSync(join(tmpDir, 'src/main.chunk.js'), 'chunk code');

    const files = discoverFiles(tmpDir);
    expect(files).toContain(join(tmpDir, 'src/app.ts'));
    expect(files).toContain(join(tmpDir, 'src/viz-3.0.1.js'));
    expect(files).not.toContain(join(tmpDir, 'src/chart.min.js'));
    expect(files).not.toContain(join(tmpDir, 'src/vendor.bundle.js'));
    expect(files).not.toContain(join(tmpDir, 'src/main.chunk.js'));

    rmSync(tmpDir, { recursive: true });
  });
});

describe('discoverFiles with include/exclude', () => {
  it('should return all files when no include/exclude', () => {
    setupFixture();
    const files = discoverFiles(TMP);
    // vendor is in SKIP_DIRS, so 4 files: auth.ts, auth.test.ts, helpers.ts, e2e.ts
    expect(files.length).toBe(4);
    rmSync(TMP, { recursive: true, force: true });
  });

  it('should filter by include pattern', () => {
    setupFixture();
    const files = discoverFiles(TMP, undefined, ['src/core/**']);
    const names = files.map((f) => f.split('/').pop());
    expect(names).toContain('auth.ts');
    expect(names).toContain('auth.test.ts');
    expect(names).not.toContain('helpers.ts');
    expect(names).not.toContain('e2e.ts');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('should filter by exclude pattern', () => {
    setupFixture();
    const files = discoverFiles(TMP, undefined, undefined, ['**/*.test.*']);
    const names = files.map((f) => f.split('/').pop());
    expect(names).toContain('auth.ts');
    expect(names).toContain('helpers.ts');
    expect(names).not.toContain('auth.test.ts');
    rmSync(TMP, { recursive: true, force: true });
  });

  it('should apply include then exclude', () => {
    setupFixture();
    const files = discoverFiles(TMP, undefined, ['src/**'], ['**/*.test.*']);
    const names = files.map((f) => f.split('/').pop());
    expect(names).toContain('auth.ts');
    expect(names).toContain('helpers.ts');
    expect(names).not.toContain('auth.test.ts');
    expect(names).not.toContain('e2e.ts');
    rmSync(TMP, { recursive: true, force: true });
  });
});

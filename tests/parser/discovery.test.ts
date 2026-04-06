import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { discoverFiles } from '../../src/parser/discovery';

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

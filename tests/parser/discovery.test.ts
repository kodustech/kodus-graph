import { describe, it, expect } from 'bun:test';
import { discoverFiles } from '../../src/parser/discovery';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';

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
});

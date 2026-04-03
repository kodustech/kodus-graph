import { describe, it, expect } from 'bun:test';
import { executeParse } from '../../src/commands/parse';
import { resolve } from 'path';
import { readFileSync, rmSync } from 'fs';

// Import to trigger language registration
import '../../src/parser/languages';

describe('executeParse', () => {
  const fixtureDir = resolve('tests/fixtures/sample-repo');
  const outPath = '/tmp/kodus-graph-test-parse.json';

  it('should parse specific files and write valid JSON output', async () => {
    await executeParse({
      repoDir: fixtureDir,
      files: ['src/auth.ts', 'src/controller.ts', 'src/db.ts'],
      all: false,
      out: outPath,
    });

    const output = JSON.parse(readFileSync(outPath, 'utf-8'));
    expect(output.metadata.files_parsed).toBeGreaterThan(0);
    expect(output.nodes.length).toBeGreaterThan(0);
    expect(output.edges.length).toBeGreaterThan(0);

    // Verify Postgres schema alignment
    const node = output.nodes[0];
    expect(node).toHaveProperty('kind');
    expect(node).toHaveProperty('name');
    expect(node).toHaveProperty('qualified_name');
    expect(node).toHaveProperty('file_path');
    expect(node).toHaveProperty('is_test');
    expect(node).toHaveProperty('file_hash');

    rmSync(outPath, { force: true });
  });
});

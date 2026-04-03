import { describe, it, expect } from 'bun:test';
import { executeContext } from '../../src/commands/context';
import { executeParse } from '../../src/commands/parse';
import { resolve } from 'path';
import { readFileSync, rmSync } from 'fs';

// Import to trigger language registration
import '../../src/parser/languages';

describe('executeContext', () => {
  const fixtureDir = resolve('tests/fixtures/sample-repo');
  const parsePath = '/tmp/kodus-graph-test-ctx-parse.json';
  const outPath = '/tmp/kodus-graph-test-context.json';

  it('should produce formatted context with metadata', async () => {
    // Build parse output first
    await executeParse({
      repoDir: fixtureDir,
      all: true,
      out: parsePath,
    });

    await executeContext({
      repoDir: fixtureDir,
      files: ['src/auth.ts'],
      graph: parsePath,
      out: outPath,
    });

    const output = JSON.parse(readFileSync(outPath, 'utf-8'));
    expect(output).toHaveProperty('text');
    expect(output).toHaveProperty('metadata');
    expect(output.text).toContain('authenticate');
    expect(output.metadata.changed_functions).toBeGreaterThan(0);
    expect(output.metadata).toHaveProperty('risk_level');
    expect(output.metadata).toHaveProperty('risk_score');

    rmSync(parsePath, { force: true });
    rmSync(outPath, { force: true });
  });
});

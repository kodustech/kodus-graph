import { describe, expect, it } from 'bun:test';
import { readFileSync, rmSync } from 'fs';
import { resolve } from 'path';
import { executeContext } from '../../src/commands/context';
import { executeParse } from '../../src/commands/parse';

// Import to trigger language registration
import '../../src/parser/languages';

describe('executeContext', () => {
  const fixtureDir = resolve('tests/fixtures/sample-repo');
  const parsePath = '/tmp/kodus-graph-test-ctx-parse.json';
  const outPath = '/tmp/kodus-graph-test-context.json';

  it('should produce V2 context with graph and analysis sections', async () => {
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
      minConfidence: 0.5,
      maxDepth: 3,
    });

    const output = JSON.parse(readFileSync(outPath, 'utf-8'));
    expect(output).toHaveProperty('graph');
    expect(output).toHaveProperty('analysis');
    expect(output.graph).toHaveProperty('nodes');
    expect(output.graph).toHaveProperty('edges');
    expect(output.analysis).toHaveProperty('changed_functions');
    expect(output.analysis).toHaveProperty('structural_diff');
    expect(output.analysis).toHaveProperty('blast_radius');
    expect(output.analysis).toHaveProperty('affected_flows');
    expect(output.analysis).toHaveProperty('inheritance');
    expect(output.analysis).toHaveProperty('test_gaps');
    expect(output.analysis).toHaveProperty('risk');
    expect(output.analysis.metadata.changed_functions_count).toBeGreaterThan(0);
    expect(output.analysis.metadata.min_confidence).toBe(0.5);

    rmSync(parsePath, { force: true });
    rmSync(outPath, { force: true });
  });
});

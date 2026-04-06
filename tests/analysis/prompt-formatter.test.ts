import { describe, expect, it } from 'bun:test';
import { buildContextV2 } from '../../src/analysis/context-builder';
import { formatPrompt } from '../../src/analysis/prompt-formatter';
import type { GraphData } from '../../src/graph/types';

describe('formatPrompt', () => {
  const graphData: GraphData = {
    nodes: [
      {
        kind: 'Function',
        name: 'authenticate',
        qualified_name: 'src/auth.ts::authenticate',
        file_path: 'src/auth.ts',
        line_start: 10,
        line_end: 25,
        language: 'typescript',
        params: '(ctx: Context)',
        return_type: 'Result',
        is_test: false,
        file_hash: 'a',
      },
      {
        kind: 'Function',
        name: 'login',
        qualified_name: 'src/ctrl.ts::login',
        file_path: 'src/ctrl.ts',
        line_start: 5,
        line_end: 15,
        language: 'typescript',
        params: '(req: Request)',
        return_type: 'Response',
        is_test: false,
        file_hash: 'b',
      },
      {
        kind: 'Class',
        name: 'AuthService',
        qualified_name: 'src/auth.ts::AuthService',
        file_path: 'src/auth.ts',
        line_start: 1,
        line_end: 50,
        language: 'typescript',
        is_test: false,
        file_hash: 'a',
      },
    ],
    edges: [
      {
        kind: 'CALLS',
        source_qualified: 'src/ctrl.ts::login',
        target_qualified: 'src/auth.ts::authenticate',
        file_path: 'src/ctrl.ts',
        line: 8,
        confidence: 0.9,
      },
      {
        kind: 'INHERITS',
        source_qualified: 'src/auth.ts::AuthService',
        target_qualified: 'src/base.ts::BaseService',
        file_path: 'src/auth.ts',
        line: 1,
      },
    ],
  };

  it('should produce readable prompt text with all sections', () => {
    const output = buildContextV2({
      mergedGraph: graphData,
      oldGraph: null,
      changedFiles: ['src/auth.ts'],
      minConfidence: 0.5,
      maxDepth: 3,
    });

    const text = formatPrompt(output);

    expect(text).toContain('# Code Review Context');
    expect(text).toContain('Risk:');
    expect(text).toContain('## Changed Functions');
    expect(text).toContain('authenticate(ctx: Context) -> Result');
    expect(text).toContain('Callers:');
    expect(text).toContain('login');
    expect(text).toContain('Test coverage:');
    expect(text).toContain('## Inheritance');
    expect(text).toContain('AuthService extends BaseService');
  });

  it('should handle empty changed functions', () => {
    const output = buildContextV2({
      mergedGraph: graphData,
      oldGraph: null,
      changedFiles: [],
      minConfidence: 0.5,
      maxDepth: 3,
    });

    const text = formatPrompt(output);

    expect(text).toContain('# Code Review Context');
    expect(text).not.toContain('## Changed Functions');
  });
});

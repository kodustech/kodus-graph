import { describe, it, expect } from 'bun:test';
import { buildReviewContext } from '../../src/analysis/review-context';
import type { GraphData } from '../../src/graph/types';

describe('buildReviewContext', () => {
  it('should format context with callers, callees, and test gaps', () => {
    const graph: GraphData = {
      nodes: [
        { kind: 'Function', name: 'authenticate', qualified_name: 'src/auth.ts::authenticate', file_path: 'src/auth.ts', line_start: 10, line_end: 25, language: 'typescript', params: '(ctx: Context)', return_type: 'Result', is_test: false, file_hash: 'a' },
        { kind: 'Function', name: 'login', qualified_name: 'src/ctrl.ts::login', file_path: 'src/ctrl.ts', line_start: 5, line_end: 15, language: 'typescript', params: '(req: Request)', return_type: 'Response', is_test: false, file_hash: 'b' },
        { kind: 'Function', name: 'findUser', qualified_name: 'src/db.ts::findUser', file_path: 'src/db.ts', line_start: 1, line_end: 5, language: 'typescript', params: '(id: number)', return_type: 'User | null', is_test: false, file_hash: 'c' },
      ],
      edges: [
        { kind: 'CALLS', source_qualified: 'src/ctrl.ts::login', target_qualified: 'src/auth.ts::authenticate', file_path: 'src/ctrl.ts', line: 8, confidence: 0.9 },
        { kind: 'CALLS', source_qualified: 'src/auth.ts::authenticate', target_qualified: 'src/db.ts::findUser', file_path: 'src/auth.ts', line: 15, confidence: 0.85 },
      ],
    };

    const result = buildReviewContext(graph, ['src/auth.ts']);

    expect(result.text).toContain('authenticate');
    expect(result.text).toContain('called by');
    expect(result.text).toContain('login');
    expect(result.text).toContain('calls');
    expect(result.text).toContain('findUser');
    expect(result.text).toContain('NO TEST COVERAGE');
    expect(result.metadata.changed_functions).toBeGreaterThan(0);
    expect(result.metadata.risk_level).toBeDefined();
  });

  it('should include risk score summary', () => {
    const graph: GraphData = {
      nodes: [
        { kind: 'Function', name: 'foo', qualified_name: 'src/a.ts::foo', file_path: 'src/a.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'a' },
      ],
      edges: [],
    };

    const result = buildReviewContext(graph, ['src/a.ts']);
    expect(result.metadata.risk_level).toBeDefined();
    expect(result.metadata.risk_score).toBeDefined();
  });
});

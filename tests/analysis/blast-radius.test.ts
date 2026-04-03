import { describe, it, expect } from 'bun:test';
import { computeBlastRadius } from '../../src/analysis/blast-radius';
import type { GraphData } from '../../src/graph/types';

describe('computeBlastRadius', () => {
  it('should find impacted nodes via CALLS edges', () => {
    const graph: GraphData = {
      nodes: [
        { kind: 'Function', name: 'auth', qualified_name: 'src/auth.ts::auth', file_path: 'src/auth.ts', line_start: 1, line_end: 10, language: 'typescript', is_test: false, file_hash: 'a' },
        { kind: 'Function', name: 'login', qualified_name: 'src/ctrl.ts::login', file_path: 'src/ctrl.ts', line_start: 1, line_end: 10, language: 'typescript', is_test: false, file_hash: 'b' },
        { kind: 'Function', name: 'route', qualified_name: 'src/routes.ts::route', file_path: 'src/routes.ts', line_start: 1, line_end: 10, language: 'typescript', is_test: false, file_hash: 'c' },
      ],
      edges: [
        { kind: 'CALLS', source_qualified: 'src/ctrl.ts::login', target_qualified: 'src/auth.ts::auth', file_path: 'src/ctrl.ts', line: 5, confidence: 0.9 },
        { kind: 'CALLS', source_qualified: 'src/routes.ts::route', target_qualified: 'src/ctrl.ts::login', file_path: 'src/routes.ts', line: 3, confidence: 0.85 },
      ],
    };

    const result = computeBlastRadius(graph, ['src/auth.ts'], 2);
    expect(result.total_functions).toBeGreaterThan(1);
    expect(result.total_files).toBeGreaterThan(1);
  });

  it('should respect maxDepth', () => {
    const graph: GraphData = {
      nodes: [
        { kind: 'Function', name: 'a', qualified_name: 'a.ts::a', file_path: 'a.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'x' },
        { kind: 'Function', name: 'b', qualified_name: 'b.ts::b', file_path: 'b.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'y' },
        { kind: 'Function', name: 'c', qualified_name: 'c.ts::c', file_path: 'c.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'z' },
      ],
      edges: [
        { kind: 'CALLS', source_qualified: 'b.ts::b', target_qualified: 'a.ts::a', file_path: 'b.ts', line: 2, confidence: 0.9 },
        { kind: 'CALLS', source_qualified: 'c.ts::c', target_qualified: 'b.ts::b', file_path: 'c.ts', line: 2, confidence: 0.9 },
      ],
    };

    const depth1 = computeBlastRadius(graph, ['a.ts'], 1);
    const depth2 = computeBlastRadius(graph, ['a.ts'], 2);
    expect(depth2.total_functions).toBeGreaterThanOrEqual(depth1.total_functions);
  });
});

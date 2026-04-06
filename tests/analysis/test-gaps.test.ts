import { describe, expect, it } from 'bun:test';
import { findTestGaps } from '../../src/analysis/test-gaps';
import type { GraphData } from '../../src/graph/types';

describe('findTestGaps', () => {
  it('should detect functions without TESTED_BY', () => {
    const graph: GraphData = {
      nodes: [
        {
          kind: 'Function',
          name: 'untestedFn',
          qualified_name: 'src/a.ts::untestedFn',
          file_path: 'src/a.ts',
          line_start: 1,
          line_end: 5,
          language: 'typescript',
          is_test: false,
          file_hash: 'a',
        },
        {
          kind: 'Function',
          name: 'testedFn',
          qualified_name: 'src/b.ts::testedFn',
          file_path: 'src/b.ts',
          line_start: 1,
          line_end: 5,
          language: 'typescript',
          is_test: false,
          file_hash: 'b',
        },
      ],
      edges: [
        {
          kind: 'TESTED_BY',
          source_qualified: 'src/b.ts',
          target_qualified: 'tests/b.test.ts',
          file_path: 'tests/b.test.ts',
          line: 0,
        },
      ],
    };

    const gaps = findTestGaps(graph, ['src/a.ts', 'src/b.ts']);
    expect(gaps.some((g) => g.function === 'src/a.ts::untestedFn')).toBe(true);
    expect(gaps.some((g) => g.function === 'src/b.ts::testedFn')).toBe(false);
  });

  it('should not flag test files', () => {
    const graph: GraphData = {
      nodes: [
        {
          kind: 'Test',
          name: 'testFoo',
          qualified_name: 'tests/a.test.ts::test:testFoo',
          file_path: 'tests/a.test.ts',
          line_start: 1,
          line_end: 5,
          language: 'typescript',
          is_test: true,
          file_hash: 'a',
        },
      ],
      edges: [],
    };

    const gaps = findTestGaps(graph, ['tests/a.test.ts']);
    expect(gaps).toHaveLength(0);
  });
});

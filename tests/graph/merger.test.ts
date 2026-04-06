import { describe, expect, it } from 'bun:test';
import { mergeGraphs } from '../../src/graph/merger';
import type { GraphData, MainGraphInput } from '../../src/graph/types';

describe('mergeGraphs', () => {
  it('should replace nodes/edges for changed files while keeping the rest', () => {
    const mainGraph: MainGraphInput = {
      repo_id: 'test',
      sha: 'abc',
      nodes: [
        {
          kind: 'Function',
          name: 'oldAuth',
          qualified_name: 'src/auth.ts::oldAuth',
          file_path: 'src/auth.ts',
          line_start: 1,
          line_end: 10,
          language: 'typescript',
          is_test: false,
          file_hash: 'a',
        },
        {
          kind: 'Function',
          name: 'dbQuery',
          qualified_name: 'src/db.ts::dbQuery',
          file_path: 'src/db.ts',
          line_start: 1,
          line_end: 10,
          language: 'typescript',
          is_test: false,
          file_hash: 'b',
        },
      ],
      edges: [
        {
          kind: 'CALLS',
          source_qualified: 'src/auth.ts::oldAuth',
          target_qualified: 'src/db.ts::dbQuery',
          file_path: 'src/auth.ts',
          line: 5,
          confidence: 0.9,
        },
      ],
    };

    const localParse: GraphData = {
      nodes: [
        {
          kind: 'Function',
          name: 'newAuth',
          qualified_name: 'src/auth.ts::newAuth',
          file_path: 'src/auth.ts',
          line_start: 1,
          line_end: 15,
          language: 'typescript',
          is_test: false,
          file_hash: 'c',
        },
      ],
      edges: [
        {
          kind: 'CALLS',
          source_qualified: 'src/auth.ts::newAuth',
          target_qualified: 'src/db.ts::dbQuery',
          file_path: 'src/auth.ts',
          line: 8,
          confidence: 0.85,
        },
      ],
    };

    const changedFiles = ['src/auth.ts'];
    const merged = mergeGraphs(mainGraph, localParse, changedFiles);

    // oldAuth should be replaced by newAuth
    expect(merged.nodes.some((n) => n.name === 'oldAuth')).toBe(false);
    expect(merged.nodes.some((n) => n.name === 'newAuth')).toBe(true);
    // db.ts node should remain
    expect(merged.nodes.some((n) => n.name === 'dbQuery')).toBe(true);
    // Old edge from auth.ts should be removed, new one added
    expect(merged.edges.some((e) => e.source_qualified === 'src/auth.ts::oldAuth')).toBe(false);
    expect(merged.edges.some((e) => e.source_qualified === 'src/auth.ts::newAuth')).toBe(true);
  });

  it('should return only local parse when no main graph', () => {
    const localParse: GraphData = {
      nodes: [
        {
          kind: 'Function',
          name: 'foo',
          qualified_name: 'src/a.ts::foo',
          file_path: 'src/a.ts',
          line_start: 1,
          line_end: 5,
          language: 'typescript',
          is_test: false,
          file_hash: 'x',
        },
      ],
      edges: [],
    };

    const merged = mergeGraphs(null, localParse, ['src/a.ts']);
    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0].name).toBe('foo');
  });
});

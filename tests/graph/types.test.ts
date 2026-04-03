import { describe, it, expect } from 'bun:test';
import type { GraphNode, GraphEdge, GraphData, ParseOutput, AnalysisOutput, ContextOutput } from '../../src/graph/types';

describe('GraphNode', () => {
  it('should accept a valid Function node', () => {
    const node: GraphNode = {
      kind: 'Function',
      name: 'authenticate',
      qualified_name: 'src/auth.py::authenticate',
      file_path: 'src/auth.py',
      line_start: 42,
      line_end: 68,
      language: 'python',
      params: '(ctx: Context)',
      return_type: 'Result',
      is_test: false,
      file_hash: 'abc123',
    };
    expect(node.kind).toBe('Function');
    expect(node.qualified_name).toContain('::');
  });

  it('should accept a node with optional fields omitted', () => {
    const node: GraphNode = {
      kind: 'Class',
      name: 'UserService',
      qualified_name: 'src/user.ts::UserService',
      file_path: 'src/user.ts',
      line_start: 10,
      line_end: 50,
      language: 'typescript',
      is_test: false,
      file_hash: 'def456',
    };
    expect(node.params).toBeUndefined();
    expect(node.return_type).toBeUndefined();
  });
});

describe('GraphEdge', () => {
  it('should accept a CALLS edge with confidence', () => {
    const edge: GraphEdge = {
      kind: 'CALLS',
      source_qualified: 'src/auth.py::authenticate',
      target_qualified: 'src/db.py::find_user',
      file_path: 'src/auth.py',
      line: 55,
      confidence: 0.85,
    };
    expect(edge.kind).toBe('CALLS');
    expect(edge.confidence).toBeGreaterThan(0);
  });

  it('should accept edge without confidence (non-CALLS)', () => {
    const edge: GraphEdge = {
      kind: 'IMPORTS',
      source_qualified: 'src/auth.py',
      target_qualified: 'src/db.py',
      file_path: 'src/auth.py',
      line: 1,
    };
    expect(edge.confidence).toBeUndefined();
  });
});

describe('ParseOutput', () => {
  it('should have metadata, nodes, and edges', () => {
    const output: ParseOutput = {
      metadata: {
        repo_dir: '/repo',
        files_parsed: 2,
        total_nodes: 10,
        total_edges: 20,
        duration_ms: 100,
      },
      nodes: [],
      edges: [],
    };
    expect(output.metadata.files_parsed).toBe(2);
  });
});

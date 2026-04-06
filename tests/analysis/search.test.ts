import { describe, expect, it } from 'bun:test';
import { findCallees, findCallers, searchNodes } from '../../src/analysis/search';
import type { IndexedGraph } from '../../src/graph/loader';
import type { GraphEdge, GraphNode } from '../../src/graph/types';

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): IndexedGraph {
  const byQualified = new Map(nodes.map((n) => [n.qualified_name, n]));
  const byFile = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const list = byFile.get(n.file_path);
    if (list) list.push(n);
    else byFile.set(n.file_path, [n]);
  }
  const adjacency = new Map<string, GraphEdge[]>();
  const reverseAdjacency = new Map<string, GraphEdge[]>();
  const edgesByKind = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const fwd = adjacency.get(e.source_qualified);
    if (fwd) fwd.push(e);
    else adjacency.set(e.source_qualified, [e]);
    const rev = reverseAdjacency.get(e.target_qualified);
    if (rev) rev.push(e);
    else reverseAdjacency.set(e.target_qualified, [e]);
    const byKind = edgesByKind.get(e.kind);
    if (byKind) byKind.push(e);
    else edgesByKind.set(e.kind, [e]);
  }
  return {
    nodes,
    edges,
    byQualified,
    byFile,
    adjacency,
    reverseAdjacency,
    edgesByKind,
    metadata: {
      repo_dir: '',
      files_parsed: 0,
      total_nodes: 0,
      total_edges: 0,
      duration_ms: 0,
      parse_errors: 0,
      extract_errors: 0,
    },
  };
}

const node = (
  name: string,
  file: string,
  kind: 'Function' | 'Method' | 'Class' = 'Function',
  parent?: string,
): GraphNode => ({
  kind,
  name,
  qualified_name: `${file}::${parent ? `${parent}.` : ''}${name}`,
  file_path: file,
  line_start: 1,
  line_end: 5,
  language: 'typescript',
  is_test: false,
  file_hash: 'x',
  ...(parent ? { parent_name: parent } : {}),
});

const edge = (src: string, tgt: string): GraphEdge => ({
  kind: 'CALLS',
  source_qualified: src,
  target_qualified: tgt,
  file_path: src.split('::')[0],
  line: 1,
});

describe('searchNodes', () => {
  const nodes = [
    node('authenticate', 'src/auth.ts', 'Method', 'AuthService'),
    node('findUser', 'src/db.ts'),
    node('Baz', 'src/other.ts', 'Class'),
  ];
  const g = makeGraph(nodes, []);

  it('should match by name substring', () => {
    const results = searchNodes(g, { query: 'auth' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('authenticate');
  });

  it('should match by glob pattern', () => {
    const results = searchNodes(g, { query: 'find*' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('findUser');
  });

  it('should match by regex', () => {
    const results = searchNodes(g, { query: '/^auth/i' });
    expect(results).toHaveLength(1);
  });

  it('should filter by kind', () => {
    const results = searchNodes(g, { query: '*', kind: 'Class' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Baz');
  });

  it('should filter by file glob', () => {
    const results = searchNodes(g, { query: '*', file: 'src/db*' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('findUser');
  });

  it('should respect limit', () => {
    const results = searchNodes(g, { query: '*', limit: 1 });
    expect(results).toHaveLength(1);
  });
});

describe('findCallers', () => {
  const nodes = [node('foo', 'src/a.ts'), node('bar', 'src/b.ts')];
  const edges = [edge('src/a.ts::foo', 'src/b.ts::bar')];
  const g = makeGraph(nodes, edges);

  it('should find callers of a node', () => {
    const results = findCallers(g, 'src/b.ts::bar');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('foo');
  });

  it('should return empty for no callers', () => {
    const results = findCallers(g, 'src/a.ts::foo');
    expect(results).toHaveLength(0);
  });
});

describe('findCallees', () => {
  const nodes = [node('foo', 'src/a.ts'), node('bar', 'src/b.ts')];
  const edges = [edge('src/a.ts::foo', 'src/b.ts::bar')];
  const g = makeGraph(nodes, edges);

  it('should find callees of a node', () => {
    const results = findCallees(g, 'src/a.ts::foo');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('bar');
  });
});

import { describe, expect, it } from 'bun:test';
import { detectCommunities } from '../../src/analysis/communities';
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

const node = (name: string, file: string): GraphNode => ({
  kind: 'Function',
  name,
  qualified_name: `${file}::${name}`,
  file_path: file,
  line_start: 1,
  line_end: 5,
  language: 'typescript',
  is_test: false,
  file_hash: 'x',
});

const callEdge = (src: string, tgt: string): GraphEdge => ({
  kind: 'CALLS',
  source_qualified: src,
  target_qualified: tgt,
  file_path: src.split('::')[0],
  line: 1,
});

describe('detectCommunities', () => {
  it('should group nodes by directory at depth 2', () => {
    const nodes = [node('foo', 'src/auth/service.ts'), node('bar', 'src/auth/guard.ts'), node('baz', 'src/db/repo.ts')];
    const g = makeGraph(nodes, []);
    const result = detectCommunities(g, { depth: 2, minSize: 1 });

    expect(result.communities).toHaveLength(2);
    const auth = result.communities.find((c) => c.name === 'src/auth');
    expect(auth).toBeDefined();
    expect(auth!.node_count).toBe(2);
  });

  it('should filter by min-size', () => {
    const nodes = [node('foo', 'src/auth/service.ts'), node('bar', 'src/auth/guard.ts'), node('baz', 'src/db/repo.ts')];
    const g = makeGraph(nodes, []);
    const result = detectCommunities(g, { depth: 2, minSize: 2 });

    expect(result.communities).toHaveLength(1);
    expect(result.communities[0].name).toBe('src/auth');
  });

  it('should detect coupling between communities', () => {
    const nodes = [node('foo', 'src/auth/service.ts'), node('bar', 'src/db/repo.ts')];
    const edges = [callEdge('src/auth/service.ts::foo', 'src/db/repo.ts::bar')];
    const g = makeGraph(nodes, edges);
    const result = detectCommunities(g, { depth: 2, minSize: 1 });

    expect(result.coupling.length).toBeGreaterThanOrEqual(1);
    const pair = result.coupling.find((c) => c.source === 'src/auth' && c.target === 'src/db');
    expect(pair).toBeDefined();
    expect(pair!.edges).toBe(1);
  });

  it('should calculate cohesion', () => {
    const nodes = [node('foo', 'src/auth/a.ts'), node('bar', 'src/auth/b.ts')];
    const edges = [callEdge('src/auth/a.ts::foo', 'src/auth/b.ts::bar')];
    const g = makeGraph(nodes, edges);
    const result = detectCommunities(g, { depth: 2, minSize: 1 });

    const auth = result.communities.find((c) => c.name === 'src/auth');
    expect(auth!.cohesion).toBeGreaterThan(0);
  });
});

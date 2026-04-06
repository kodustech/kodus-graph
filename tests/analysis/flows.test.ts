import { describe, expect, it } from 'bun:test';
import { detectFlows } from '../../src/analysis/flows';
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

const fn = (
  name: string,
  file: string,
  kind: 'Function' | 'Method' | 'Test' = 'Function',
  parent?: string,
): GraphNode => ({
  kind,
  name,
  qualified_name: `${file}::${parent ? `${parent}.` : ''}${kind === 'Test' ? 'test:' : ''}${name}`,
  file_path: file,
  line_start: 1,
  line_end: 5,
  language: 'typescript',
  is_test: kind === 'Test',
  file_hash: 'x',
  ...(parent ? { parent_name: parent } : {}),
});

const call = (src: string, tgt: string): GraphEdge => ({
  kind: 'CALLS',
  source_qualified: src,
  target_qualified: tgt,
  file_path: src.split('::')[0],
  line: 1,
});

describe('detectFlows', () => {
  it('should detect test entry points and trace paths', () => {
    const nodes = [
      fn('should auth', 'tests/auth.test.ts', 'Test'),
      fn('authenticate', 'src/auth.ts', 'Method', 'AuthService'),
      fn('findUser', 'src/db.ts'),
    ];
    const edges = [
      call('tests/auth.test.ts::test:should auth', 'src/auth.ts::AuthService.authenticate'),
      call('src/auth.ts::AuthService.authenticate', 'src/db.ts::findUser'),
    ];
    const g = makeGraph(nodes, edges);
    const result = detectFlows(g, { maxDepth: 10, type: 'all' });

    expect(result.flows).toHaveLength(1);
    expect(result.flows[0].type).toBe('test');
    expect(result.flows[0].depth).toBe(2);
    expect(result.flows[0].path).toHaveLength(3);
  });

  it('should detect HTTP handler entry points', () => {
    const nodes = [fn('login', 'src/controller.ts', 'Method', 'AuthController'), fn('authenticate', 'src/auth.ts')];
    const edges = [call('src/controller.ts::AuthController.login', 'src/auth.ts::authenticate')];
    const g = makeGraph(nodes, edges);
    const result = detectFlows(g, { maxDepth: 10, type: 'all' });

    const httpFlows = result.flows.filter((f) => f.type === 'http');
    expect(httpFlows).toHaveLength(1);
    expect(httpFlows[0].entry_point).toContain('login');
  });

  it('should filter by type', () => {
    const nodes = [
      fn('should auth', 'tests/auth.test.ts', 'Test'),
      fn('login', 'src/controller.ts', 'Method', 'AuthController'),
    ];
    const g = makeGraph(nodes, []);
    const result = detectFlows(g, { maxDepth: 10, type: 'test' });

    expect(result.flows.every((f) => f.type === 'test')).toBe(true);
  });

  it('should respect maxDepth', () => {
    const nodes = [
      fn('test1', 'tests/a.test.ts', 'Test'),
      fn('a', 'src/a.ts'),
      fn('b', 'src/b.ts'),
      fn('c', 'src/c.ts'),
    ];
    const edges = [
      call('tests/a.test.ts::test:test1', 'src/a.ts::a'),
      call('src/a.ts::a', 'src/b.ts::b'),
      call('src/b.ts::b', 'src/c.ts::c'),
    ];
    const g = makeGraph(nodes, edges);
    const result = detectFlows(g, { maxDepth: 1, type: 'all' });

    expect(result.flows[0].depth).toBe(1);
    expect(result.flows[0].path).toHaveLength(2);
  });

  it('should calculate criticality as node_count * file_count', () => {
    const nodes = [fn('test1', 'tests/a.test.ts', 'Test'), fn('a', 'src/a.ts'), fn('b', 'src/b.ts')];
    const edges = [call('tests/a.test.ts::test:test1', 'src/a.ts::a'), call('src/a.ts::a', 'src/b.ts::b')];
    const g = makeGraph(nodes, edges);
    const result = detectFlows(g, { maxDepth: 10, type: 'all' });

    expect(result.flows[0].node_count).toBe(3);
    expect(result.flows[0].file_count).toBe(3);
    expect(result.flows[0].criticality).toBe(9);
  });
});

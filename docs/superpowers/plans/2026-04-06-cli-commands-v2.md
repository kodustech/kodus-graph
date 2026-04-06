# CLI Commands v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 5 new CLI commands (diff, update, communities, flows, search) and a shared graph loader to kodus-graph.

**Architecture:** All commands share a `loadGraph()` factory that reads `ParseOutput` JSON and builds in-memory indices. Each command delegates to pure analysis functions. No new external dependencies.

**Tech Stack:** Bun runtime, TypeScript, ast-grep (existing), commander (existing), Zod (existing).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/graph/loader.ts` | Create | `loadGraph()` factory, `IndexedGraph` type, Zod validation |
| `src/graph/types.ts` | Modify | Add `files_unchanged`, `incremental` to `ParseMetadata` |
| `src/analysis/diff.ts` | Create | Structural diff: compare nodes/edges, classify changes |
| `src/analysis/communities.ts` | Create | Directory grouping, cohesion, coupling analysis |
| `src/analysis/flows.ts` | Create | Entry point detection, BFS path tracing |
| `src/analysis/search.ts` | Create | Text/glob/regex matching, relation queries |
| `src/commands/diff.ts` | Create | CLI wiring for `diff` command |
| `src/commands/update.ts` | Create | CLI wiring for `update` command (incremental parse) |
| `src/commands/communities.ts` | Create | CLI wiring for `communities` command |
| `src/commands/flows.ts` | Create | CLI wiring for `flows` command |
| `src/commands/search.ts` | Create | CLI wiring for `search` command |
| `src/cli.ts` | Modify | Register 5 new commands |
| `tests/graph/loader.test.ts` | Create | Unit tests for `loadGraph()` |
| `tests/analysis/diff.test.ts` | Create | Unit tests for diff analysis |
| `tests/analysis/communities.test.ts` | Create | Unit tests for community detection |
| `tests/analysis/flows.test.ts` | Create | Unit tests for flow detection |
| `tests/analysis/search.test.ts` | Create | Unit tests for search |

---

### Task 1: Graph Loader (`loadGraph` + `IndexedGraph`)

**Files:**
- Create: `src/graph/loader.ts`
- Test: `tests/graph/loader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/graph/loader.test.ts
import { describe, expect, it } from 'bun:test';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { loadGraph } from '../../src/graph/loader';
import type { ParseOutput } from '../../src/graph/types';

const tmpDir = '/tmp/kodus-graph-test-loader';

function sampleOutput(): ParseOutput {
  return {
    metadata: {
      repo_dir: '/repo',
      files_parsed: 2,
      total_nodes: 3,
      total_edges: 2,
      duration_ms: 100,
      parse_errors: 0,
      extract_errors: 0,
    },
    nodes: [
      { kind: 'Function', name: 'foo', qualified_name: 'src/a.ts::foo', file_path: 'src/a.ts', line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'aaa' },
      { kind: 'Function', name: 'bar', qualified_name: 'src/b.ts::bar', file_path: 'src/b.ts', line_start: 1, line_end: 3, language: 'typescript', is_test: false, file_hash: 'bbb' },
      { kind: 'Class', name: 'Baz', qualified_name: 'src/a.ts::Baz', file_path: 'src/a.ts', line_start: 10, line_end: 20, language: 'typescript', is_test: false, file_hash: 'aaa' },
    ],
    edges: [
      { kind: 'CALLS', source_qualified: 'src/a.ts::foo', target_qualified: 'src/b.ts::bar', file_path: 'src/a.ts', line: 3 },
      { kind: 'IMPORTS', source_qualified: 'src/a.ts', target_qualified: 'src/b.ts', file_path: 'src/a.ts', line: 1 },
    ],
  };
}

describe('loadGraph', () => {
  it('should load and index a valid ParseOutput JSON', () => {
    mkdirSync(tmpDir, { recursive: true });
    const path = join(tmpDir, 'graph.json');
    writeFileSync(path, JSON.stringify(sampleOutput()));

    const g = loadGraph(path);

    expect(g.nodes).toHaveLength(3);
    expect(g.edges).toHaveLength(2);
    expect(g.byQualified.get('src/a.ts::foo')?.name).toBe('foo');
    expect(g.byFile.get('src/a.ts')).toHaveLength(2);
    expect(g.byFile.get('src/b.ts')).toHaveLength(1);
    expect(g.adjacency.get('src/a.ts::foo')).toHaveLength(1);
    expect(g.reverseAdjacency.get('src/b.ts::bar')).toHaveLength(1);
    expect(g.edgesByKind.get('CALLS')).toHaveLength(1);
    expect(g.edgesByKind.get('IMPORTS')).toHaveLength(1);
    expect(g.metadata.files_parsed).toBe(2);

    rmSync(tmpDir, { recursive: true });
  });

  it('should throw on invalid JSON', () => {
    mkdirSync(tmpDir, { recursive: true });
    const path = join(tmpDir, 'bad.json');
    writeFileSync(path, '{ "nodes": "not-array" }');

    expect(() => loadGraph(path)).toThrow();

    rmSync(tmpDir, { recursive: true });
  });

  it('should throw on missing file', () => {
    expect(() => loadGraph('/tmp/nonexistent-graph-xyz.json')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/graph/loader.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the implementation**

```typescript
// src/graph/loader.ts
import { readFileSync } from 'fs';
import { z } from 'zod';
import type { EdgeKind, GraphEdge, GraphNode, ParseMetadata } from './types';

const ParseOutputSchema = z.object({
  metadata: z.object({
    repo_dir: z.string(),
    files_parsed: z.number(),
    total_nodes: z.number(),
    total_edges: z.number(),
    duration_ms: z.number(),
    parse_errors: z.number(),
    extract_errors: z.number(),
    files_unchanged: z.number().optional(),
    incremental: z.boolean().optional(),
  }),
  nodes: z.array(
    z.object({
      kind: z.enum(['Function', 'Method', 'Constructor', 'Class', 'Interface', 'Enum', 'Test']),
      name: z.string(),
      qualified_name: z.string(),
      file_path: z.string(),
      line_start: z.number(),
      line_end: z.number(),
      language: z.string(),
      is_test: z.boolean(),
      file_hash: z.string(),
      parent_name: z.string().optional(),
      params: z.string().optional(),
      return_type: z.string().optional(),
      modifiers: z.string().optional(),
    }),
  ),
  edges: z.array(
    z.object({
      kind: z.enum(['CALLS', 'IMPORTS', 'INHERITS', 'IMPLEMENTS', 'TESTED_BY', 'CONTAINS']),
      source_qualified: z.string(),
      target_qualified: z.string(),
      file_path: z.string(),
      line: z.number(),
      confidence: z.number().optional(),
    }),
  ),
});

export interface IndexedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  byQualified: Map<string, GraphNode>;
  byFile: Map<string, GraphNode[]>;
  adjacency: Map<string, GraphEdge[]>;
  reverseAdjacency: Map<string, GraphEdge[]>;
  edgesByKind: Map<string, GraphEdge[]>;
  metadata: ParseMetadata;
}

export function loadGraph(path: string): IndexedGraph {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`Failed to read graph file: ${path} — ${String(err)}`);
  }

  const parsed = ParseOutputSchema.parse(raw);

  const nodes = parsed.nodes as GraphNode[];
  const edges = parsed.edges as GraphEdge[];
  const metadata = parsed.metadata as ParseMetadata;

  const byQualified = new Map<string, GraphNode>();
  const byFile = new Map<string, GraphNode[]>();
  const adjacency = new Map<string, GraphEdge[]>();
  const reverseAdjacency = new Map<string, GraphEdge[]>();
  const edgesByKind = new Map<string, GraphEdge[]>();

  for (const node of nodes) {
    byQualified.set(node.qualified_name, node);
    const list = byFile.get(node.file_path);
    if (list) list.push(node);
    else byFile.set(node.file_path, [node]);
  }

  for (const edge of edges) {
    const fwd = adjacency.get(edge.source_qualified);
    if (fwd) fwd.push(edge);
    else adjacency.set(edge.source_qualified, [edge]);

    const rev = reverseAdjacency.get(edge.target_qualified);
    if (rev) rev.push(edge);
    else reverseAdjacency.set(edge.target_qualified, [edge]);

    const byKind = edgesByKind.get(edge.kind);
    if (byKind) byKind.push(edge);
    else edgesByKind.set(edge.kind, [edge]);
  }

  return { nodes, edges, byQualified, byFile, adjacency, reverseAdjacency, edgesByKind, metadata };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/graph/loader.test.ts`
Expected: 3 pass, 0 fail

- [ ] **Step 5: Run full suite**

Run: `bun run check`
Expected: All pass, 0 lint errors, 0 type errors

- [ ] **Step 6: Commit**

```bash
git add src/graph/loader.ts tests/graph/loader.test.ts
git commit -m "feat: add loadGraph() with IndexedGraph indices"
```

---

### Task 2: Extend `ParseMetadata` with incremental fields

**Files:**
- Modify: `src/graph/types.ts`

- [ ] **Step 1: Add optional fields to ParseMetadata**

In `src/graph/types.ts`, add two optional fields to `ParseMetadata` after `extract_errors`:

```typescript
export interface ParseMetadata {
  repo_dir: string;
  files_parsed: number;
  total_nodes: number;
  total_edges: number;
  duration_ms: number;
  parse_errors: number;
  extract_errors: number;
  files_unchanged?: number;
  incremental?: boolean;
}
```

- [ ] **Step 2: Run full suite to confirm nothing breaks**

Run: `bun run check`
Expected: All existing tests pass (fields are optional, backward-compatible)

- [ ] **Step 3: Commit**

```bash
git add src/graph/types.ts
git commit -m "feat: add files_unchanged and incremental fields to ParseMetadata"
```

---

### Task 3: Search analysis logic

**Files:**
- Create: `src/analysis/search.ts`
- Test: `tests/analysis/search.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/analysis/search.test.ts
import { describe, expect, it } from 'bun:test';
import { searchNodes, findCallers, findCallees } from '../../src/analysis/search';
import type { GraphEdge, GraphNode } from '../../src/graph/types';
import type { IndexedGraph } from '../../src/graph/loader';

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
    nodes, edges, byQualified, byFile, adjacency, reverseAdjacency, edgesByKind,
    metadata: { repo_dir: '', files_parsed: 0, total_nodes: 0, total_edges: 0, duration_ms: 0, parse_errors: 0, extract_errors: 0 },
  };
}

const node = (name: string, file: string, kind: 'Function' | 'Method' | 'Class' = 'Function', parent?: string): GraphNode => ({
  kind, name, qualified_name: `${file}::${parent ? `${parent}.` : ''}${name}`, file_path: file,
  line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'x',
  ...(parent ? { parent_name: parent } : {}),
});

const edge = (src: string, tgt: string): GraphEdge => ({
  kind: 'CALLS', source_qualified: src, target_qualified: tgt, file_path: src.split('::')[0], line: 1,
});

describe('searchNodes', () => {
  const nodes = [node('authenticate', 'src/auth.ts', 'Method', 'AuthService'), node('findUser', 'src/db.ts'), node('Baz', 'src/other.ts', 'Class')];
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/analysis/search.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the implementation**

```typescript
// src/analysis/search.ts
import type { GraphNode, NodeKind } from '../graph/types';
import type { IndexedGraph } from '../graph/loader';

export interface SearchOptions {
  query?: string;
  kind?: string;
  file?: string;
  limit?: number;
}

export function searchNodes(graph: IndexedGraph, opts: SearchOptions): GraphNode[] {
  const { query, kind, file, limit = 50 } = opts;
  let results = graph.nodes;

  if (query) {
    const matcher = buildMatcher(query);
    results = results.filter((n) => matcher(n.name) || matcher(n.qualified_name));
  }

  if (kind) {
    results = results.filter((n) => n.kind === kind);
  }

  if (file) {
    const fileMatcher = buildMatcher(file);
    results = results.filter((n) => fileMatcher(n.file_path));
  }

  results.sort((a, b) => a.file_path.localeCompare(b.file_path) || a.line_start - b.line_start);

  return results.slice(0, limit);
}

export function findCallers(graph: IndexedGraph, qualifiedName: string): GraphNode[] {
  const edges = graph.reverseAdjacency.get(qualifiedName) || [];
  const callers: GraphNode[] = [];
  for (const e of edges) {
    if (e.kind !== 'CALLS') continue;
    const node = graph.byQualified.get(e.source_qualified);
    if (node) callers.push(node);
  }
  return callers;
}

export function findCallees(graph: IndexedGraph, qualifiedName: string): GraphNode[] {
  const edges = graph.adjacency.get(qualifiedName) || [];
  const callees: GraphNode[] = [];
  for (const e of edges) {
    if (e.kind !== 'CALLS') continue;
    const node = graph.byQualified.get(e.target_qualified);
    if (node) callees.push(node);
  }
  return callees;
}

function buildMatcher(pattern: string): (text: string) => boolean {
  // Regex: /pattern/flags
  if (pattern.startsWith('/')) {
    const lastSlash = pattern.lastIndexOf('/');
    if (lastSlash > 0) {
      const regex = new RegExp(pattern.slice(1, lastSlash), pattern.slice(lastSlash + 1));
      return (text) => regex.test(text);
    }
  }

  // Glob: contains *
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const regex = new RegExp(`^${escaped}$`, 'i');
    return (text) => regex.test(text);
  }

  // Substring (case-insensitive)
  const lower = pattern.toLowerCase();
  return (text) => text.toLowerCase().includes(lower);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/analysis/search.test.ts`
Expected: 8 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/analysis/search.ts tests/analysis/search.test.ts
git commit -m "feat: add search analysis (text, glob, regex, callers, callees)"
```

---

### Task 4: Communities analysis logic

**Files:**
- Create: `src/analysis/communities.ts`
- Test: `tests/analysis/communities.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/analysis/communities.test.ts
import { describe, expect, it } from 'bun:test';
import { detectCommunities } from '../../src/analysis/communities';
import type { GraphEdge, GraphNode } from '../../src/graph/types';
import type { IndexedGraph } from '../../src/graph/loader';

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
    nodes, edges, byQualified, byFile, adjacency, reverseAdjacency, edgesByKind,
    metadata: { repo_dir: '', files_parsed: 0, total_nodes: 0, total_edges: 0, duration_ms: 0, parse_errors: 0, extract_errors: 0 },
  };
}

const node = (name: string, file: string): GraphNode => ({
  kind: 'Function', name, qualified_name: `${file}::${name}`, file_path: file,
  line_start: 1, line_end: 5, language: 'typescript', is_test: false, file_hash: 'x',
});

const callEdge = (src: string, tgt: string): GraphEdge => ({
  kind: 'CALLS', source_qualified: src, target_qualified: tgt, file_path: src.split('::')[0], line: 1,
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/analysis/communities.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the implementation**

```typescript
// src/analysis/communities.ts
import { dirname } from 'path';
import type { IndexedGraph } from '../graph/loader';

export interface CommunityOptions {
  depth: number;
  minSize: number;
}

export interface Community {
  name: string;
  files: string[];
  node_count: number;
  cohesion: number;
  language: string;
}

export interface CouplingPair {
  source: string;
  target: string;
  edges: number;
  strength: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface CommunitiesResult {
  communities: Community[];
  coupling: CouplingPair[];
  summary: { total_communities: number; avg_cohesion: number; high_coupling_pairs: number };
}

function getCommunityKey(filePath: string, depth: number): string {
  const parts = filePath.split('/');
  return parts.slice(0, depth).join('/');
}

export function detectCommunities(graph: IndexedGraph, opts: CommunityOptions): CommunitiesResult {
  const { depth, minSize } = opts;

  // Group nodes by directory
  const groups = new Map<string, Set<string>>(); // community -> files
  const nodeComm = new Map<string, string>(); // qualified_name -> community

  for (const node of graph.nodes) {
    const key = getCommunityKey(node.file_path, depth);
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key)!.add(node.file_path);
    nodeComm.set(node.qualified_name, key);
  }

  // Count internal and cross edges per community pair
  const internalEdges = new Map<string, number>();
  const crossEdges = new Map<string, number>(); // "a|b" -> count

  for (const edge of graph.edges) {
    if (edge.kind !== 'CALLS' && edge.kind !== 'IMPORTS') continue;
    const srcComm = nodeComm.get(edge.source_qualified);
    const tgtComm = nodeComm.get(edge.target_qualified);
    if (!srcComm || !tgtComm) continue;

    if (srcComm === tgtComm) {
      internalEdges.set(srcComm, (internalEdges.get(srcComm) || 0) + 1);
    } else {
      const pairKey = [srcComm, tgtComm].sort().join('|');
      crossEdges.set(pairKey, (crossEdges.get(pairKey) || 0) + 1);
    }
  }

  // Build communities
  const communities: Community[] = [];
  for (const [name, files] of groups) {
    const nodeCount = graph.nodes.filter((n) => getCommunityKey(n.file_path, depth) === name).length;
    if (nodeCount < minSize) continue;

    const internal = internalEdges.get(name) || 0;
    const maxPossible = nodeCount * (nodeCount - 1);
    const cohesion = maxPossible > 0 ? Math.round((internal / maxPossible) * 100) / 100 : 0;

    const langs = new Map<string, number>();
    for (const n of graph.nodes) {
      if (getCommunityKey(n.file_path, depth) === name) {
        langs.set(n.language, (langs.get(n.language) || 0) + 1);
      }
    }
    let dominant = 'unknown';
    let maxCount = 0;
    for (const [lang, count] of langs) {
      if (count > maxCount) { dominant = lang; maxCount = count; }
    }

    communities.push({
      name,
      files: [...files].sort(),
      node_count: nodeCount,
      cohesion,
      language: dominant,
    });
  }

  communities.sort((a, b) => b.node_count - a.node_count);

  // Build coupling pairs
  const communityNames = new Set(communities.map((c) => c.name));
  const coupling: CouplingPair[] = [];
  for (const [pairKey, count] of crossEdges) {
    const [src, tgt] = pairKey.split('|');
    if (!communityNames.has(src) || !communityNames.has(tgt)) continue;

    const srcTotal = graph.edges.filter((e) => {
      const c = nodeComm.get(e.source_qualified);
      return c === src || c === tgt;
    }).length;
    const ratio = srcTotal > 0 ? count / srcTotal : 0;
    const strength = ratio > 0.3 ? 'HIGH' : ratio > 0.1 ? 'MEDIUM' : 'LOW';

    coupling.push({ source: src, target: tgt, edges: count, strength });
  }

  coupling.sort((a, b) => b.edges - a.edges);

  const avgCohesion = communities.length > 0
    ? Math.round((communities.reduce((s, c) => s + c.cohesion, 0) / communities.length) * 100) / 100
    : 0;

  return {
    communities,
    coupling,
    summary: {
      total_communities: communities.length,
      avg_cohesion: avgCohesion,
      high_coupling_pairs: coupling.filter((c) => c.strength === 'HIGH').length,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/analysis/communities.test.ts`
Expected: 4 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/analysis/communities.ts tests/analysis/communities.test.ts
git commit -m "feat: add community detection (directory grouping + coupling analysis)"
```

---

### Task 5: Flows analysis logic

**Files:**
- Create: `src/analysis/flows.ts`
- Test: `tests/analysis/flows.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/analysis/flows.test.ts
import { describe, expect, it } from 'bun:test';
import { detectFlows } from '../../src/analysis/flows';
import type { GraphEdge, GraphNode } from '../../src/graph/types';
import type { IndexedGraph } from '../../src/graph/loader';

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
    nodes, edges, byQualified, byFile, adjacency, reverseAdjacency, edgesByKind,
    metadata: { repo_dir: '', files_parsed: 0, total_nodes: 0, total_edges: 0, duration_ms: 0, parse_errors: 0, extract_errors: 0 },
  };
}

const fn = (name: string, file: string, kind: 'Function' | 'Method' | 'Test' = 'Function', parent?: string): GraphNode => ({
  kind, name, qualified_name: `${file}::${parent ? `${parent}.` : ''}${kind === 'Test' ? 'test:' : ''}${name}`,
  file_path: file, line_start: 1, line_end: 5, language: 'typescript', is_test: kind === 'Test', file_hash: 'x',
  ...(parent ? { parent_name: parent } : {}),
});

const call = (src: string, tgt: string): GraphEdge => ({
  kind: 'CALLS', source_qualified: src, target_qualified: tgt, file_path: src.split('::')[0], line: 1,
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
    const nodes = [
      fn('login', 'src/controller.ts', 'Method', 'AuthController'),
      fn('authenticate', 'src/auth.ts'),
    ];
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
    const nodes = [fn('test1', 'tests/a.test.ts', 'Test'), fn('a', 'src/a.ts'), fn('b', 'src/b.ts'), fn('c', 'src/c.ts')];
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
    const edges = [
      call('tests/a.test.ts::test:test1', 'src/a.ts::a'),
      call('src/a.ts::a', 'src/b.ts::b'),
    ];
    const g = makeGraph(nodes, edges);
    const result = detectFlows(g, { maxDepth: 10, type: 'all' });

    expect(result.flows[0].node_count).toBe(3);
    expect(result.flows[0].file_count).toBe(3);
    expect(result.flows[0].criticality).toBe(9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/analysis/flows.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the implementation**

```typescript
// src/analysis/flows.ts
import type { IndexedGraph } from '../graph/loader';

export interface FlowOptions {
  maxDepth: number;
  type: 'test' | 'http' | 'all';
}

export interface Flow {
  entry_point: string;
  type: 'test' | 'http';
  depth: number;
  node_count: number;
  file_count: number;
  criticality: number;
  path: string[];
}

export interface FlowsResult {
  flows: Flow[];
  summary: { total_flows: number; by_type: { test: number; http: number }; avg_depth: number; max_criticality: number };
}

const HTTP_METHOD_NAMES = new Set(['get', 'post', 'put', 'delete', 'patch', 'handle', 'handler']);

function isHttpHandler(qualifiedName: string, name: string, parentName?: string): boolean {
  if (HTTP_METHOD_NAMES.has(name.toLowerCase())) return true;
  if (parentName && parentName.toLowerCase().endsWith('controller')) return true;
  return false;
}

export function detectFlows(graph: IndexedGraph, opts: FlowOptions): FlowsResult {
  const { maxDepth, type } = opts;

  // Find entry points
  const entryPoints: { qualified: string; type: 'test' | 'http' }[] = [];

  for (const node of graph.nodes) {
    if (type !== 'http' && node.kind === 'Test') {
      entryPoints.push({ qualified: node.qualified_name, type: 'test' });
    }
    if (type !== 'test' && (node.kind === 'Method' || node.kind === 'Function')) {
      if (isHttpHandler(node.qualified_name, node.name, node.parent_name)) {
        entryPoints.push({ qualified: node.qualified_name, type: 'http' });
      }
    }
  }

  // BFS for each entry point
  const flows: Flow[] = [];

  for (const ep of entryPoints) {
    const path: string[] = [ep.qualified];
    const visited = new Set<string>([ep.qualified]);
    const files = new Set<string>();

    const startNode = graph.byQualified.get(ep.qualified);
    if (startNode) files.add(startNode.file_path);

    let frontier = [ep.qualified];
    let depth = 0;

    while (frontier.length > 0 && depth < maxDepth) {
      const next: string[] = [];
      for (const q of frontier) {
        for (const edge of graph.adjacency.get(q) || []) {
          if (edge.kind !== 'CALLS') continue;
          if (visited.has(edge.target_qualified)) continue;
          visited.add(edge.target_qualified);
          next.push(edge.target_qualified);
          path.push(edge.target_qualified);
          const targetNode = graph.byQualified.get(edge.target_qualified);
          if (targetNode) files.add(targetNode.file_path);
        }
      }
      if (next.length === 0) break;
      frontier = next;
      depth++;
    }

    flows.push({
      entry_point: ep.qualified,
      type: ep.type,
      depth,
      node_count: visited.size,
      file_count: files.size,
      criticality: visited.size * files.size,
      path,
    });
  }

  flows.sort((a, b) => b.criticality - a.criticality);

  const testFlows = flows.filter((f) => f.type === 'test').length;
  const httpFlows = flows.filter((f) => f.type === 'http').length;
  const avgDepth = flows.length > 0 ? Math.round((flows.reduce((s, f) => s + f.depth, 0) / flows.length) * 10) / 10 : 0;
  const maxCriticality = flows.length > 0 ? flows[0].criticality : 0;

  return {
    flows,
    summary: { total_flows: flows.length, by_type: { test: testFlows, http: httpFlows }, avg_depth: avgDepth, max_criticality: maxCriticality },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/analysis/flows.test.ts`
Expected: 5 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/analysis/flows.ts tests/analysis/flows.test.ts
git commit -m "feat: add flow detection (test + HTTP entry points, BFS tracing)"
```

---

### Task 6: Diff analysis logic

**Files:**
- Create: `src/analysis/diff.ts`
- Test: `tests/analysis/diff.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/analysis/diff.test.ts
import { describe, expect, it } from 'bun:test';
import { computeStructuralDiff } from '../../src/analysis/diff';
import type { GraphEdge, GraphNode } from '../../src/graph/types';
import type { IndexedGraph } from '../../src/graph/loader';

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
    nodes, edges, byQualified, byFile, adjacency, reverseAdjacency, edgesByKind,
    metadata: { repo_dir: '', files_parsed: 0, total_nodes: 0, total_edges: 0, duration_ms: 0, parse_errors: 0, extract_errors: 0 },
  };
}

const node = (name: string, file: string, lineStart = 1, lineEnd = 5, params?: string): GraphNode => ({
  kind: 'Function', name, qualified_name: `${file}::${name}`, file_path: file,
  line_start: lineStart, line_end: lineEnd, language: 'typescript', is_test: false, file_hash: 'x',
  ...(params ? { params } : {}),
});

describe('computeStructuralDiff', () => {
  it('should detect added nodes', () => {
    const oldGraph = makeGraph([node('foo', 'src/a.ts')], []);
    const newNodes: GraphNode[] = [node('foo', 'src/a.ts'), node('bar', 'src/a.ts')];
    const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

    expect(result.nodes.added).toHaveLength(1);
    expect(result.nodes.added[0].qualified_name).toBe('src/a.ts::bar');
  });

  it('should detect removed nodes', () => {
    const oldGraph = makeGraph([node('foo', 'src/a.ts'), node('bar', 'src/a.ts')], []);
    const newNodes: GraphNode[] = [node('foo', 'src/a.ts')];
    const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

    expect(result.nodes.removed).toHaveLength(1);
    expect(result.nodes.removed[0].qualified_name).toBe('src/a.ts::bar');
  });

  it('should detect modified nodes (line range changed)', () => {
    const oldGraph = makeGraph([node('foo', 'src/a.ts', 1, 5)], []);
    const newNodes: GraphNode[] = [node('foo', 'src/a.ts', 1, 10)];
    const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

    expect(result.nodes.modified).toHaveLength(1);
    expect(result.nodes.modified[0].changes).toContain('line_range');
  });

  it('should detect modified nodes (params changed)', () => {
    const oldGraph = makeGraph([node('foo', 'src/a.ts', 1, 5, '(x: number)')], []);
    const newNodes: GraphNode[] = [node('foo', 'src/a.ts', 1, 5, '(x: number, y: string)')];
    const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

    expect(result.nodes.modified).toHaveLength(1);
    expect(result.nodes.modified[0].changes).toContain('params');
  });

  it('should compute risk_by_file using reverse adjacency', () => {
    const oldNodes = [node('foo', 'src/a.ts'), node('bar', 'src/b.ts')];
    const oldEdges: GraphEdge[] = [{ kind: 'CALLS', source_qualified: 'src/b.ts::bar', target_qualified: 'src/a.ts::foo', file_path: 'src/b.ts', line: 1 }];
    const oldGraph = makeGraph(oldNodes, oldEdges);
    const newNodes: GraphNode[] = [node('foo', 'src/a.ts', 1, 10)]; // modified
    const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

    expect(result.risk_by_file['src/a.ts']).toBeDefined();
    expect(result.risk_by_file['src/a.ts'].dependents).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/analysis/diff.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write the implementation**

```typescript
// src/analysis/diff.ts
import type { IndexedGraph } from '../graph/loader';
import type { GraphEdge, GraphNode } from '../graph/types';

export interface NodeChange {
  qualified_name: string;
  kind: string;
  file_path: string;
  line_start: number;
  line_end: number;
}

export interface ModifiedNode {
  qualified_name: string;
  changes: string[];
}

export interface DiffResult {
  changed_files: string[];
  summary: { added: number; removed: number; modified: number };
  nodes: { added: NodeChange[]; removed: NodeChange[]; modified: ModifiedNode[] };
  edges: { added: Pick<GraphEdge, 'kind' | 'source_qualified' | 'target_qualified'>[]; removed: Pick<GraphEdge, 'kind' | 'source_qualified' | 'target_qualified'>[] };
  risk_by_file: Record<string, { dependents: number; risk: 'HIGH' | 'MEDIUM' | 'LOW' }>;
}

export function computeStructuralDiff(
  oldGraph: IndexedGraph,
  newNodes: GraphNode[],
  newEdges: GraphEdge[],
  changedFiles: string[],
): DiffResult {
  const changedSet = new Set(changedFiles);

  // Old nodes in changed files
  const oldNodesInChanged = new Map<string, GraphNode>();
  for (const n of oldGraph.nodes) {
    if (changedSet.has(n.file_path)) oldNodesInChanged.set(n.qualified_name, n);
  }

  // New nodes in changed files
  const newNodesMap = new Map<string, GraphNode>();
  for (const n of newNodes) {
    if (changedSet.has(n.file_path)) newNodesMap.set(n.qualified_name, n);
  }

  // Classify nodes
  const added: NodeChange[] = [];
  const removed: NodeChange[] = [];
  const modified: ModifiedNode[] = [];

  for (const [qn, n] of newNodesMap) {
    if (!oldNodesInChanged.has(qn)) {
      added.push({ qualified_name: qn, kind: n.kind, file_path: n.file_path, line_start: n.line_start, line_end: n.line_end });
    }
  }

  for (const [qn, n] of oldNodesInChanged) {
    if (!newNodesMap.has(qn)) {
      removed.push({ qualified_name: qn, kind: n.kind, file_path: n.file_path, line_start: n.line_start, line_end: n.line_end });
    } else {
      const newN = newNodesMap.get(qn)!;
      const changes: string[] = [];
      if (n.line_start !== newN.line_start || n.line_end !== newN.line_end) changes.push('line_range');
      if ((n.params || '') !== (newN.params || '')) changes.push('params');
      if ((n.return_type || '') !== (newN.return_type || '')) changes.push('return_type');
      if (changes.length > 0) modified.push({ qualified_name: qn, changes });
    }
  }

  // Classify edges
  const oldEdgesInChanged = oldGraph.edges.filter((e) => changedSet.has(e.file_path));
  const oldEdgeKeys = new Set(oldEdgesInChanged.map((e) => `${e.kind}|${e.source_qualified}|${e.target_qualified}`));
  const newEdgesInChanged = newEdges.filter((e) => changedSet.has(e.file_path));
  const newEdgeKeys = new Set(newEdgesInChanged.map((e) => `${e.kind}|${e.source_qualified}|${e.target_qualified}`));

  const addedEdges = newEdgesInChanged
    .filter((e) => !oldEdgeKeys.has(`${e.kind}|${e.source_qualified}|${e.target_qualified}`))
    .map((e) => ({ kind: e.kind, source_qualified: e.source_qualified, target_qualified: e.target_qualified }));

  const removedEdges = oldEdgesInChanged
    .filter((e) => !newEdgeKeys.has(`${e.kind}|${e.source_qualified}|${e.target_qualified}`))
    .map((e) => ({ kind: e.kind, source_qualified: e.source_qualified, target_qualified: e.target_qualified }));

  // Risk by file: count unique dependents via reverse adjacency
  const riskByFile: Record<string, { dependents: number; risk: 'HIGH' | 'MEDIUM' | 'LOW' }> = {};
  for (const file of changedFiles) {
    const nodesInFile = oldGraph.byFile.get(file) || [];
    const dependents = new Set<string>();
    for (const n of nodesInFile) {
      for (const edge of oldGraph.reverseAdjacency.get(n.qualified_name) || []) {
        if (!changedSet.has(edge.file_path)) dependents.add(edge.source_qualified);
      }
    }
    const count = dependents.size;
    const risk = count >= 10 ? 'HIGH' : count >= 3 ? 'MEDIUM' : 'LOW';
    riskByFile[file] = { dependents: count, risk };
  }

  return {
    changed_files: changedFiles,
    summary: { added: added.length, removed: removed.length, modified: modified.length },
    nodes: { added, removed, modified },
    edges: { added: addedEdges, removed: removedEdges },
    risk_by_file: riskByFile,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/analysis/diff.test.ts`
Expected: 5 pass, 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/analysis/diff.ts tests/analysis/diff.test.ts
git commit -m "feat: add structural diff analysis (added/removed/modified nodes + risk)"
```

---

### Task 7: `search` command wiring

**Files:**
- Create: `src/commands/search.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the command**

```typescript
// src/commands/search.ts
import { writeFileSync } from 'fs';
import { loadGraph } from '../graph/loader';
import { findCallees, findCallers, searchNodes } from '../analysis/search';

interface SearchCommandOptions {
  graph: string;
  query?: string;
  kind?: string;
  file?: string;
  callersOf?: string;
  calleesOf?: string;
  limit: number;
  out?: string;
}

export function executeSearch(opts: SearchCommandOptions): void {
  const graph = loadGraph(opts.graph);

  let results;
  let queryInfo: Record<string, string | null>;

  if (opts.callersOf) {
    results = findCallers(graph, opts.callersOf);
    queryInfo = { callers_of: opts.callersOf, kind: null, file: null };
  } else if (opts.calleesOf) {
    results = findCallees(graph, opts.calleesOf);
    queryInfo = { callees_of: opts.calleesOf, kind: null, file: null };
  } else {
    results = searchNodes(graph, { query: opts.query, kind: opts.kind, file: opts.file, limit: opts.limit });
    queryInfo = { pattern: opts.query || null, kind: opts.kind || null, file: opts.file || null };
  }

  const output = JSON.stringify({ results, total: results.length, query: queryInfo }, null, 2);

  if (opts.out) {
    writeFileSync(opts.out, output);
  } else {
    process.stdout.write(`${output}\n`);
  }
}
```

- [ ] **Step 2: Register in `cli.ts`**

Add to `src/cli.ts` after the existing `context` command block. Add the import at the top with the others:

Import to add:
```typescript
import { executeSearch } from './commands/search';
```

Command to add:
```typescript
program
  .command('search')
  .description('Search the graph by name, kind, file, or relations')
  .requiredOption('--graph <path>', 'Path to graph JSON')
  .option('--query <pattern>', 'Search by name/qualified_name (glob or /regex/)')
  .option('--kind <type>', 'Filter by kind: Function, Method, Class, Interface, Enum, Test')
  .option('--file <pattern>', 'Filter by file path (glob)')
  .option('--callers-of <qualified>', 'Find callers of this node')
  .option('--callees-of <qualified>', 'Find callees of this node')
  .option('--limit <n>', 'Max results', '50')
  .option('--out <path>', 'Output file (default: stdout)')
  .action((opts) => {
    const modes = [opts.query, opts.callersOf, opts.calleesOf].filter(Boolean).length;
    if (modes === 0) {
      process.stderr.write('Error: one of --query, --callers-of, or --callees-of is required\n');
      process.exit(1);
    }
    if (modes > 1) {
      process.stderr.write('Error: --query, --callers-of, and --callees-of are mutually exclusive\n');
      process.exit(1);
    }
    executeSearch({
      graph: opts.graph,
      query: opts.query,
      kind: opts.kind,
      file: opts.file,
      callersOf: opts.callersOf,
      calleesOf: opts.calleesOf,
      limit: parseInt(opts.limit, 10),
      out: opts.out,
    });
  });
```

- [ ] **Step 3: Run full check**

Run: `bun run check`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/commands/search.ts src/cli.ts
git commit -m "feat: add search CLI command"
```

---

### Task 8: `communities` command wiring

**Files:**
- Create: `src/commands/communities.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the command**

```typescript
// src/commands/communities.ts
import { writeFileSync } from 'fs';
import { detectCommunities } from '../analysis/communities';
import { loadGraph } from '../graph/loader';

interface CommunitiesCommandOptions {
  graph: string;
  out: string;
  minSize: number;
  depth: number;
}

export function executeCommunities(opts: CommunitiesCommandOptions): void {
  const graph = loadGraph(opts.graph);
  const result = detectCommunities(graph, { depth: opts.depth, minSize: opts.minSize });
  writeFileSync(opts.out, JSON.stringify(result, null, 2));
  process.stderr.write(
    `Communities: ${result.summary.total_communities} detected, avg cohesion ${result.summary.avg_cohesion}, ${result.summary.high_coupling_pairs} high-coupling pairs\n`,
  );
}
```

- [ ] **Step 2: Register in `cli.ts`**

Import to add:
```typescript
import { executeCommunities } from './commands/communities';
```

Command to add:
```typescript
program
  .command('communities')
  .description('Detect module clusters and coupling between them')
  .requiredOption('--graph <path>', 'Path to graph JSON')
  .requiredOption('--out <path>', 'Output JSON file path')
  .option('--min-size <n>', 'Minimum nodes per community', '2')
  .option('--depth <n>', 'Directory grouping depth', '2')
  .action((opts) => {
    executeCommunities({
      graph: opts.graph,
      out: opts.out,
      minSize: parseInt(opts.minSize, 10),
      depth: parseInt(opts.depth, 10),
    });
  });
```

- [ ] **Step 3: Run full check**

Run: `bun run check`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/commands/communities.ts src/cli.ts
git commit -m "feat: add communities CLI command"
```

---

### Task 9: `flows` command wiring

**Files:**
- Create: `src/commands/flows.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the command**

```typescript
// src/commands/flows.ts
import { writeFileSync } from 'fs';
import { detectFlows } from '../analysis/flows';
import { loadGraph } from '../graph/loader';

interface FlowsCommandOptions {
  graph: string;
  out: string;
  maxDepth: number;
  type: 'test' | 'http' | 'all';
}

export function executeFlows(opts: FlowsCommandOptions): void {
  const graph = loadGraph(opts.graph);
  const result = detectFlows(graph, { maxDepth: opts.maxDepth, type: opts.type });
  writeFileSync(opts.out, JSON.stringify(result, null, 2));
  process.stderr.write(
    `Flows: ${result.summary.total_flows} detected (test:${result.summary.by_type.test} http:${result.summary.by_type.http}), avg depth ${result.summary.avg_depth}\n`,
  );
}
```

- [ ] **Step 2: Register in `cli.ts`**

Import to add:
```typescript
import { executeFlows } from './commands/flows';
```

Command to add:
```typescript
program
  .command('flows')
  .description('Detect entry points and trace execution paths')
  .requiredOption('--graph <path>', 'Path to graph JSON')
  .requiredOption('--out <path>', 'Output JSON file path')
  .option('--max-depth <n>', 'Max BFS trace depth', '10')
  .option('--type <kind>', 'Filter: test, http, all', 'all')
  .action((opts) => {
    executeFlows({
      graph: opts.graph,
      out: opts.out,
      maxDepth: parseInt(opts.maxDepth, 10),
      type: opts.type as 'test' | 'http' | 'all',
    });
  });
```

- [ ] **Step 3: Run full check**

Run: `bun run check`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/commands/flows.ts src/cli.ts
git commit -m "feat: add flows CLI command"
```

---

### Task 10: `diff` command wiring

**Files:**
- Create: `src/commands/diff.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the command**

```typescript
// src/commands/diff.ts
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { writeFileSync } from 'fs';
import { relative, resolve } from 'path';
import { performance } from 'perf_hooks';
import { computeStructuralDiff } from '../analysis/diff';
import { buildGraphData } from '../graph/builder';
import { loadGraph } from '../graph/loader';
import type { ImportEdge } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { resolveAllCalls } from '../resolver/call-resolver';
import { createImportMap } from '../resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../resolver/import-resolver';
import { createSymbolTable } from '../resolver/symbol-table';
import { computeFileHash } from '../shared/file-hash';
import { log } from '../shared/logger';

interface DiffCommandOptions {
  repoDir: string;
  base?: string;
  files?: string[];
  graph: string;
  out: string;
}

export async function executeDiff(opts: DiffCommandOptions): Promise<void> {
  const t0 = performance.now();
  const repoDir = resolve(opts.repoDir);

  // Resolve changed files
  let changedFiles: string[];
  if (opts.base) {
    try {
      const output = execSync(`git diff --name-only ${opts.base}`, { cwd: repoDir, encoding: 'utf-8' });
      changedFiles = output.trim().split('\n').filter(Boolean);
    } catch (err) {
      process.stderr.write(`Error: failed to run git diff with base "${opts.base}": ${String(err)}\n`);
      process.exit(1);
    }
  } else {
    changedFiles = opts.files!;
  }

  process.stderr.write(`[1/4] ${changedFiles.length} changed files\n`);

  // Load old graph
  const graphPath = resolve(opts.graph);
  if (!existsSync(graphPath)) {
    process.stderr.write(`Error: graph file not found: ${graphPath}\n`);
    process.exit(1);
  }
  const oldGraph = loadGraph(graphPath);
  process.stderr.write(`[2/4] Loaded previous graph (${oldGraph.nodes.length} nodes)\n`);

  // Re-parse changed files
  const absFiles = discoverFiles(repoDir, changedFiles);
  const rawGraph = await parseBatch(absFiles, repoDir);

  const tsconfigAliases = loadTsconfigAliases(repoDir);
  const symbolTable = createSymbolTable();
  const importMap = createImportMap();
  const importEdges: ImportEdge[] = [];

  for (const f of rawGraph.functions) symbolTable.add(f.file, f.name, f.qualified);
  for (const c of rawGraph.classes) symbolTable.add(c.file, c.name, c.qualified);
  for (const i of rawGraph.interfaces) symbolTable.add(i.file, i.name, i.qualified);

  for (const imp of rawGraph.imports) {
    const langKey = imp.lang === 'python' ? 'python' : imp.lang === 'ruby' ? 'ruby' : 'typescript';
    const resolved = resolveImport(resolve(repoDir, imp.file), imp.module, langKey, repoDir, tsconfigAliases);
    const resolvedRel = resolved ? relative(repoDir, resolved) : null;
    importEdges.push({ source: imp.file, target: resolvedRel || imp.module, resolved: !!resolvedRel, line: imp.line });
    const target = resolvedRel || imp.module;
    for (const name of imp.names) importMap.add(imp.file, name, target);
  }

  const { callEdges } = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, importMap);

  const fileHashes = new Map<string, string>();
  for (const f of absFiles) {
    try { fileHashes.set(relative(repoDir, f), computeFileHash(f)); } catch {}
  }

  const newGraphData = buildGraphData(rawGraph, callEdges, importEdges, repoDir, fileHashes);
  process.stderr.write(`[3/4] Re-parsed ${absFiles.length} files (${newGraphData.nodes.length} nodes)\n`);

  // Compute diff
  const relChangedFiles = changedFiles.map((f) => (f.startsWith('/') ? relative(repoDir, f) : f));
  const result = computeStructuralDiff(oldGraph, newGraphData.nodes, newGraphData.edges, relChangedFiles);
  process.stderr.write(
    `[4/4] Diff: +${result.summary.added} -${result.summary.removed} ~${result.summary.modified} nodes (${Math.round(performance.now() - t0)}ms)\n`,
  );

  writeFileSync(opts.out, JSON.stringify(result, null, 2));
}
```

- [ ] **Step 2: Register in `cli.ts`**

Import to add:
```typescript
import { executeDiff } from './commands/diff';
```

Command to add:
```typescript
program
  .command('diff')
  .description('Compare changed files against an existing graph')
  .option('--base <ref>', 'Git ref to diff against')
  .option('--files <paths...>', 'Explicit list of changed files')
  .option('--repo-dir <path>', 'Repository root directory', '.')
  .option('--graph <path>', 'Previous graph JSON', '.kodus-graph/graph.json')
  .requiredOption('--out <path>', 'Output JSON file path')
  .action(async (opts) => {
    if (!opts.base && !opts.files) {
      process.stderr.write('Error: one of --base or --files is required\n');
      process.exit(1);
    }
    const repoDir = resolve(opts.repoDir);
    if (!existsSync(repoDir)) {
      process.stderr.write(`Error: --repo-dir does not exist: ${repoDir}\n`);
      process.exit(1);
    }
    await executeDiff({
      repoDir: opts.repoDir,
      base: opts.base,
      files: opts.files,
      graph: opts.graph,
      out: opts.out,
    });
  });
```

Also add at the top of `cli.ts` if not already present:
```typescript
import { resolve } from 'path';
import { existsSync } from 'fs';
```

- [ ] **Step 3: Run full check**

Run: `bun run check`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/commands/diff.ts src/cli.ts
git commit -m "feat: add diff CLI command (structural diff + risk analysis)"
```

---

### Task 11: `update` command wiring

**Files:**
- Create: `src/commands/update.ts`
- Modify: `src/cli.ts`

- [ ] **Step 1: Write the command**

```typescript
// src/commands/update.ts
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, relative, resolve } from 'path';
import { performance } from 'perf_hooks';
import { buildGraphData } from '../graph/builder';
import { loadGraph } from '../graph/loader';
import type { GraphEdge, GraphNode, ImportEdge, ParseOutput } from '../graph/types';
import { parseBatch } from '../parser/batch';
import { discoverFiles } from '../parser/discovery';
import { resolveAllCalls } from '../resolver/call-resolver';
import { createImportMap } from '../resolver/import-map';
import { loadTsconfigAliases, resolveImport } from '../resolver/import-resolver';
import { createSymbolTable } from '../resolver/symbol-table';
import { computeFileHash } from '../shared/file-hash';
import { log } from '../shared/logger';

const DEFAULT_GRAPH_PATH = '.kodus-graph/graph.json';

interface UpdateCommandOptions {
  repoDir: string;
  graph?: string;
  out?: string;
}

export async function executeUpdate(opts: UpdateCommandOptions): Promise<void> {
  const t0 = performance.now();
  const repoDir = resolve(opts.repoDir);
  const graphPath = resolve(repoDir, opts.graph || DEFAULT_GRAPH_PATH);
  const outPath = resolve(repoDir, opts.out || opts.graph || DEFAULT_GRAPH_PATH);

  if (!existsSync(graphPath)) {
    process.stderr.write(`Error: graph file not found: ${graphPath}. Run "kodus-graph parse" first.\n`);
    process.exit(1);
  }

  const oldGraph = loadGraph(graphPath);
  process.stderr.write(`[1/5] Loaded previous graph (${oldGraph.nodes.length} nodes)\n`);

  // Build file hash index from old graph
  const oldHashes = new Map<string, string>();
  for (const node of oldGraph.nodes) {
    if (node.file_hash && !oldHashes.has(node.file_path)) {
      oldHashes.set(node.file_path, node.file_hash);
    }
  }

  // Discover current files
  const allFiles = discoverFiles(repoDir);
  const allRel = allFiles.map((f) => relative(repoDir, f));
  const currentFiles = new Set(allRel);
  const oldFiles = new Set(oldHashes.keys());

  // Classify files
  const added: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];
  const unchanged: string[] = [];

  for (const file of currentFiles) {
    const absPath = resolve(repoDir, file);
    if (!oldHashes.has(file)) {
      added.push(file);
    } else {
      const currentHash = computeFileHash(absPath);
      if (currentHash !== oldHashes.get(file)) {
        modified.push(file);
      } else {
        unchanged.push(file);
      }
    }
  }

  for (const file of oldFiles) {
    if (!currentFiles.has(file)) deleted.push(file);
  }

  const toReparse = [...added, ...modified];
  process.stderr.write(
    `[2/5] Files: ${added.length} added, ${modified.length} modified, ${deleted.length} deleted, ${unchanged.length} unchanged\n`,
  );

  if (toReparse.length === 0 && deleted.length === 0) {
    process.stderr.write('[3/5] No changes detected, graph is up to date\n');
    // Still write output (may be different path)
    const output: ParseOutput = {
      metadata: {
        ...oldGraph.metadata,
        duration_ms: Math.round(performance.now() - t0),
        files_unchanged: unchanged.length,
        incremental: true,
      },
      nodes: oldGraph.nodes,
      edges: oldGraph.edges,
    };
    ensureDir(outPath);
    writeFileSync(outPath, JSON.stringify(output, null, 2));
    return;
  }

  // Re-parse changed files
  const absToReparse = toReparse.map((f) => resolve(repoDir, f));
  const rawGraph = await parseBatch(absToReparse, repoDir);
  process.stderr.write(`[3/5] Re-parsed ${toReparse.length} files\n`);

  // Resolve imports and calls for new files
  const tsconfigAliases = loadTsconfigAliases(repoDir);
  const symbolTable = createSymbolTable();
  const importMap = createImportMap();
  const importEdges: ImportEdge[] = [];

  for (const f of rawGraph.functions) symbolTable.add(f.file, f.name, f.qualified);
  for (const c of rawGraph.classes) symbolTable.add(c.file, c.name, c.qualified);
  for (const i of rawGraph.interfaces) symbolTable.add(i.file, i.name, i.qualified);

  for (const imp of rawGraph.imports) {
    const langKey = imp.lang === 'python' ? 'python' : imp.lang === 'ruby' ? 'ruby' : 'typescript';
    const resolved = resolveImport(resolve(repoDir, imp.file), imp.module, langKey, repoDir, tsconfigAliases);
    const resolvedRel = resolved ? relative(repoDir, resolved) : null;
    importEdges.push({ source: imp.file, target: resolvedRel || imp.module, resolved: !!resolvedRel, line: imp.line });
    const target = resolvedRel || imp.module;
    for (const name of imp.names) importMap.add(imp.file, name, target);
  }

  const { callEdges } = resolveAllCalls(rawGraph.rawCalls, rawGraph.diMaps, symbolTable, importMap);

  const fileHashes = new Map<string, string>();
  for (const f of absToReparse) {
    try { fileHashes.set(relative(repoDir, f), computeFileHash(f)); } catch {}
  }

  const newGraphData = buildGraphData(rawGraph, callEdges, importEdges, repoDir, fileHashes);
  process.stderr.write(`[4/5] Built new graph fragment (${newGraphData.nodes.length} nodes)\n`);

  // Merge: keep old nodes/edges NOT in changed/deleted files, add new ones
  const changedOrDeleted = new Set([...toReparse, ...deleted]);
  const mergedNodes: GraphNode[] = oldGraph.nodes.filter((n) => !changedOrDeleted.has(n.file_path));
  const mergedEdges: GraphEdge[] = oldGraph.edges.filter((e) => !changedOrDeleted.has(e.file_path));

  mergedNodes.push(...newGraphData.nodes);
  mergedEdges.push(...newGraphData.edges);

  process.stderr.write(`[5/5] Merged: ${mergedNodes.length} nodes, ${mergedEdges.length} edges\n`);

  const output: ParseOutput = {
    metadata: {
      repo_dir: repoDir,
      files_parsed: toReparse.length,
      files_unchanged: unchanged.length,
      total_nodes: mergedNodes.length,
      total_edges: mergedEdges.length,
      duration_ms: Math.round(performance.now() - t0),
      parse_errors: rawGraph.parseErrors,
      extract_errors: rawGraph.extractErrors,
      incremental: true,
    },
    nodes: mergedNodes,
    edges: mergedEdges,
  };

  ensureDir(outPath);
  writeFileSync(outPath, JSON.stringify(output, null, 2));
}

function ensureDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
```

- [ ] **Step 2: Register in `cli.ts`**

Import to add:
```typescript
import { executeUpdate } from './commands/update';
```

Command to add:
```typescript
program
  .command('update')
  .description('Incrementally update graph (only re-parse changed files)')
  .option('--repo-dir <path>', 'Repository root directory', '.')
  .option('--graph <path>', 'Previous graph JSON (default: .kodus-graph/graph.json)')
  .option('--out <path>', 'Output path (default: same as --graph)')
  .action(async (opts) => {
    const repoDir = resolve(opts.repoDir);
    if (!existsSync(repoDir)) {
      process.stderr.write(`Error: --repo-dir does not exist: ${repoDir}\n`);
      process.exit(1);
    }
    await executeUpdate({
      repoDir: opts.repoDir,
      graph: opts.graph,
      out: opts.out,
    });
  });
```

- [ ] **Step 3: Run full check**

Run: `bun run check`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add src/commands/update.ts src/cli.ts
git commit -m "feat: add update CLI command (incremental parse with file hash comparison)"
```

---

### Task 12: Final check — full suite + lint + typecheck

- [ ] **Step 1: Run the complete check pipeline**

Run: `bun run check`
Expected: 0 type errors, 0 lint errors, all tests pass

- [ ] **Step 2: Verify all 8 CLI commands are registered**

Run: `bun run src/cli.ts --help`
Expected output should list: `parse`, `analyze`, `context`, `diff`, `update`, `communities`, `flows`, `search`

- [ ] **Step 3: Commit if any fixups were needed**

```bash
git add -A
git commit -m "chore: final fixups for CLI v2 commands"
```

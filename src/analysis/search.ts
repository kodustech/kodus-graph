import type { IndexedGraph } from '../graph/loader';
import type { GraphNode } from '../graph/types';

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

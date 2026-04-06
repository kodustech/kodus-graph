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
  edges: {
    added: Pick<GraphEdge, 'kind' | 'source_qualified' | 'target_qualified'>[];
    removed: Pick<GraphEdge, 'kind' | 'source_qualified' | 'target_qualified'>[];
  };
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
      added.push({
        qualified_name: qn,
        kind: n.kind,
        file_path: n.file_path,
        line_start: n.line_start,
        line_end: n.line_end,
      });
    }
  }

  for (const [qn, n] of oldNodesInChanged) {
    if (!newNodesMap.has(qn)) {
      removed.push({
        qualified_name: qn,
        kind: n.kind,
        file_path: n.file_path,
        line_start: n.line_start,
        line_end: n.line_end,
      });
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

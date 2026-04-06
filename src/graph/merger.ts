import type { GraphData, MainGraphInput } from './types';

/**
 * Merge local parse (PR changed files) with the main graph (from Postgres).
 * Replaces all nodes/edges from changed files with the local parse.
 * Keeps everything else from the main graph intact.
 */
export function mergeGraphs(
  mainGraph: MainGraphInput | null,
  localParse: GraphData,
  changedFiles: string[],
): GraphData {
  if (!mainGraph) return localParse;

  const changedSet = new Set(changedFiles);

  // Keep main graph nodes/edges NOT in changed files
  const mainNodes = mainGraph.nodes.filter((n) => !changedSet.has(n.file_path));
  const mainEdges = mainGraph.edges.filter((e) => !changedSet.has(e.file_path));

  return {
    nodes: [...mainNodes, ...localParse.nodes],
    edges: [...mainEdges, ...localParse.edges],
  };
}

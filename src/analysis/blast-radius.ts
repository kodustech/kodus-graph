import type { BlastRadiusResult, GraphData } from '../graph/types';

export function computeBlastRadius(graph: GraphData, changedFiles: string[], maxDepth: number = 2): BlastRadiusResult {
    // Build adjacency list from CALLS edges (callers of changed nodes)
    const adj = new Map<string, Set<string>>();
    for (const edge of graph.edges) {
        if (edge.kind !== 'CALLS' && edge.kind !== 'IMPORTS') {
            continue;
        }
        // Reverse direction: target -> source (who calls/imports this?)
        if (!adj.has(edge.target_qualified)) {
            adj.set(edge.target_qualified, new Set());
        }
        adj.get(edge.target_qualified)!.add(edge.source_qualified);
        // Forward direction too for IMPORTS
        if (edge.kind === 'IMPORTS') {
            if (!adj.has(edge.source_qualified)) {
                adj.set(edge.source_qualified, new Set());
            }
            adj.get(edge.source_qualified)!.add(edge.target_qualified);
        }
    }

    // Seed: all nodes in changed files
    const changedSet = new Set(changedFiles);
    const seeds = graph.nodes.filter((n) => changedSet.has(n.file_path)).map((n) => n.qualified_name);

    // BFS
    const visited = new Set<string>(seeds);
    const byDepth: Record<string, string[]> = {};
    let frontier = seeds;

    for (let depth = 1; depth <= maxDepth; depth++) {
        const next: string[] = [];
        for (const node of frontier) {
            for (const neighbor of adj.get(node) || []) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    next.push(neighbor);
                }
            }
        }
        if (next.length > 0) {
            byDepth[String(depth)] = next;
        }
        frontier = next;
    }

    // Count unique files
    const nodeIndex = new Map(graph.nodes.map((n) => [n.qualified_name, n]));
    const impactedFiles = new Set<string>();
    for (const q of visited) {
        const node = nodeIndex.get(q);
        if (node) {
            impactedFiles.add(node.file_path);
        }
    }

    return {
        total_functions: visited.size,
        total_files: impactedFiles.size,
        by_depth: byDepth,
    };
}

import type { BlastRadiusResult, GraphData } from '../graph/types';

export function computeBlastRadius(
    graph: GraphData,
    changedQualifiedNames: string[],
    maxDepth: number = 2,
    minConfidence?: number,
): BlastRadiusResult {
    const minConf = minConfidence ?? 0.5;

    // Build adjacency list filtering by confidence
    const adj = new Map<string, Set<string>>();

    const addEdge = (from: string, to: string) => {
        if (!adj.has(from)) {
            adj.set(from, new Set());
        }
        adj.get(from)!.add(to);
    };

    for (const edge of graph.edges) {
        if (edge.kind === 'IMPORTS') {
            // IMPORTS: unidirectional — change in imported affects importer
            addEdge(edge.target_qualified, edge.source_qualified);
        } else if (edge.kind === 'CALLS' && (edge.confidence ?? 1.0) >= minConf) {
            // CALLS: only edges with sufficient confidence, reverse direction
            addEdge(edge.target_qualified, edge.source_qualified);
        }
    }

    // Seeds: qualified names directly (no more file-level)
    const visited = new Set<string>(changedQualifiedNames);
    const byDepth: Record<string, string[]> = {};
    let frontier = [...changedQualifiedNames];

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

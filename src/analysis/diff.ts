import type { IndexedGraph } from '../graph/loader';
import type { GraphEdge, GraphNode } from '../graph/types';
import { log } from '../shared/logger';

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
        if (changedSet.has(n.file_path)) {
            oldNodesInChanged.set(n.qualified_name, n);
        }
    }

    // New nodes in changed files
    const newNodesMap = new Map<string, GraphNode>();
    for (const n of newNodes) {
        if (changedSet.has(n.file_path)) {
            newNodesMap.set(n.qualified_name, n);
        }
    }

    log.debug('diff: input', {
        oldNodesInChanged: oldNodesInChanged.size,
        newNodesInChanged: newNodesMap.size,
        changedFiles,
    });

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
            // Detect real content changes vs. pure displacement.
            // content_hash = SHA256 of the node's source text (position-independent).
            if (n.content_hash && newN.content_hash) {
                // Definitive: hash comparison catches ALL content changes,
                // even same-line-count edits (e.g. `return 1` → `return 2`).
                if (n.content_hash !== newN.content_hash) {
                    changes.push('body');
                    log.debug('diff: body change detected', {
                        node: qn,
                        oldHash: n.content_hash.substring(0, 8),
                        newHash: newN.content_hash.substring(0, 8),
                    });
                } else {
                    log.debug('diff: hash match (displacement only)', {
                        node: qn,
                        oldLines: `${n.line_start}-${n.line_end}`,
                        newLines: `${newN.line_start}-${newN.line_end}`,
                    });
                }
            } else if (n.line_start !== newN.line_start || n.line_end !== newN.line_end) {
                // Fallback (legacy data without content_hash): size heuristic.
                const oldSize = n.line_end - n.line_start;
                const newSize = newN.line_end - newN.line_start;
                if (oldSize !== newSize) {
                    changes.push('line_range');
                    log.debug('diff: line_range fallback (no content_hash)', {
                        node: qn,
                        hasOldHash: !!n.content_hash,
                        hasNewHash: !!newN.content_hash,
                        oldSize,
                        newSize,
                    });
                }
            }
            if ((n.params || '') !== (newN.params || '')) {
                changes.push('params');
            }
            if ((n.return_type || '') !== (newN.return_type || '')) {
                changes.push('return_type');
            }
            if (changes.length > 0) {
                modified.push({ qualified_name: qn, changes });
            }
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
                if (!changedSet.has(edge.file_path)) {
                    dependents.add(edge.source_qualified);
                }
            }
        }
        const count = dependents.size;
        const risk = count >= 10 ? 'HIGH' : count >= 3 ? 'MEDIUM' : 'LOW';
        riskByFile[file] = { dependents: count, risk };
    }

    log.info('diff: result', {
        added: added.length,
        removed: removed.length,
        modified: modified.length,
        edgesAdded: addedEdges.length,
        edgesRemoved: removedEdges.length,
        modifiedDetails: modified.map((m) => `${m.qualified_name} [${m.changes.join(',')}]`),
    });

    return {
        changed_files: changedFiles,
        summary: { added: added.length, removed: removed.length, modified: modified.length },
        nodes: { added, removed, modified },
        edges: { added: addedEdges, removed: removedEdges },
        risk_by_file: riskByFile,
    };
}

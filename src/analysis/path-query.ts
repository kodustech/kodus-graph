/**
 * Shortest call path between two symbols — "how does A reach B?".
 *
 * The multi-hop question grep cannot answer without chaining searches and
 * guessing at each link. Here it is a single breadth-first traversal over CALLS
 * edges (control flows from caller to callee), returning the shortest path and
 * the edge kind taken into each step, so the answer is auditable: every hop is a
 * real edge in the graph, not an inference.
 */

import type { IndexedGraph } from '../graph/loader';
import type { EdgeKind } from '../graph/types';

export interface PathQueryInput {
    from: string;
    to: string;
    /** Edge kinds that count as a hop. Defaults to CALLS (the call path). */
    kinds?: EdgeKind[];
    /** Give up after this many hops. */
    maxDepth?: number;
}

export interface PathStep {
    qualified_name: string;
    file: string;
    /** Edge kind traversed to arrive here; undefined for the origin. */
    via?: EdgeKind;
}

export interface PathQueryResult {
    found: boolean;
    from: string;
    to: string;
    /** Number of hops (edges) — 0 when from === to, absent when not found. */
    length?: number;
    path: PathStep[];
}

export function computePath(graph: IndexedGraph, input: PathQueryInput): PathQueryResult {
    const kinds = new Set<EdgeKind>(input.kinds ?? ['CALLS']);
    const maxDepth = input.maxDepth ?? 10;
    const { from, to } = input;

    const fileOf = (q: string): string => graph.byQualified.get(q)?.file_path ?? q.split('::')[0];

    if (!graph.byQualified.has(from) || !graph.byQualified.has(to)) {
        return { found: false, from, to, path: [] };
    }
    if (from === to) {
        return { found: true, from, to, length: 0, path: [{ qualified_name: from, file: fileOf(from) }] };
    }

    // BFS, tracking the predecessor and the edge kind taken into each node.
    const prev = new Map<string, { from: string; via: EdgeKind }>();
    const visited = new Set<string>([from]);
    let frontier: string[] = [from];

    for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
        const next: string[] = [];
        for (const node of frontier) {
            for (const edge of graph.adjacency.get(node) ?? []) {
                if (!kinds.has(edge.kind) || visited.has(edge.target_qualified)) {
                    continue;
                }
                visited.add(edge.target_qualified);
                prev.set(edge.target_qualified, { from: node, via: edge.kind });
                if (edge.target_qualified === to) {
                    // Reconstruct from `to` back to `from`.
                    const rev: PathStep[] = [{ qualified_name: to, file: fileOf(to), via: edge.kind }];
                    let cur = to;
                    while (cur !== from) {
                        const step = prev.get(cur)!;
                        cur = step.from;
                        rev.push(
                            cur === from
                                ? { qualified_name: cur, file: fileOf(cur) }
                                : { qualified_name: cur, file: fileOf(cur), via: prev.get(cur)!.via },
                        );
                    }
                    const path = rev.reverse();
                    return { found: true, from, to, length: path.length - 1, path };
                }
                next.push(edge.target_qualified);
            }
        }
        frontier = next;
    }

    return { found: false, from, to, path: [] };
}

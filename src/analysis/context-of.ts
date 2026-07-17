/**
 * The context pack for a single symbol — "everything you need to work on X",
 * in one query instead of a chain of greps.
 *
 * An agent (or a reviewer) landing on a symbol needs the same handful of facts:
 * where it is, who calls it, what it calls, which types it touches, and whether
 * it's tested. Assembling that by grep means reading every candidate file to
 * separate real references from comments and shadows; the graph already knows,
 * so this returns it directly, ranked so the most-connected neighbours come
 * first and a token budget keeps the pack small.
 *
 * Depth 1 by design: the immediate neighbourhood is what you need to edit X.
 * Going deeper is the blast radius (a separate, impact-oriented traversal).
 */

import type { IndexedGraph } from '../graph/loader';
import type { GraphEdge, GraphNode } from '../graph/types';

export interface ContextOfInput {
    symbol: string;
    /** Max neighbours per list (callers, callees, …), most-connected first. */
    limit?: number;
}

export interface NeighbourRef {
    qualified_name: string;
    file: string;
    line: number;
    /** Weighted degree of the neighbour — how central it is in the graph. */
    degree: number;
}

export interface ContextOfResult {
    found: boolean;
    symbol?: {
        qualified_name: string;
        kind: string;
        file: string;
        line_start: number;
        line_end: number;
        signature?: string;
    };
    /** Symbols that call this one. */
    callers: NeighbourRef[];
    /** Symbols this one calls. */
    callees: NeighbourRef[];
    /** Types this symbol's signature names (USES_TYPE). */
    uses_types: string[];
    /** Tests that cover this symbol (TESTED_BY). */
    tested_by: string[];
    /** True when more neighbours existed than `limit` and were dropped. */
    truncated: boolean;
}

function degreeOf(graph: IndexedGraph, qualified: string): number {
    return (graph.adjacency.get(qualified)?.length ?? 0) + (graph.reverseAdjacency.get(qualified)?.length ?? 0);
}

function toRef(graph: IndexedGraph, qualified: string, line: number): NeighbourRef {
    const node = graph.byQualified.get(qualified);
    return {
        qualified_name: qualified,
        file: node?.file_path ?? qualified.split('::')[0],
        line,
        degree: degreeOf(graph, qualified),
    };
}

function signatureOf(node: GraphNode): string | undefined {
    const params = (node as GraphNode & { params?: string }).params;
    const ret = (node as GraphNode & { return_type?: string }).return_type;
    if (!params && !ret) {
        return undefined;
    }
    return `${node.name}${params ?? '()'}${ret ? ` -> ${ret}` : ''}`;
}

export function computeContextOf(graph: IndexedGraph, input: ContextOfInput): ContextOfResult {
    const limit = input.limit ?? 15;
    const node = graph.byQualified.get(input.symbol);
    if (!node) {
        return { found: false, callers: [], callees: [], uses_types: [], tested_by: [], truncated: false };
    }

    const outgoing = graph.adjacency.get(input.symbol) ?? [];
    const incoming = graph.reverseAdjacency.get(input.symbol) ?? [];

    const callersAll = incoming.filter((e) => e.kind === 'CALLS');
    const calleesAll = outgoing.filter((e) => e.kind === 'CALLS');
    const usesTypes = [
        ...new Set(outgoing.filter((e) => e.kind === 'USES_TYPE').map((e) => e.target_qualified)),
    ].sort();
    const testedBy = [...new Set(outgoing.filter((e) => e.kind === 'TESTED_BY').map((e) => e.target_qualified))].sort();

    const rankLimit = (edges: GraphEdge[], pick: (e: GraphEdge) => string): NeighbourRef[] => {
        const refs = edges.map((e) => toRef(graph, pick(e), e.line));
        // Deduplicate by qualified name, keeping the highest degree seen.
        const byName = new Map<string, NeighbourRef>();
        for (const r of refs) {
            const prev = byName.get(r.qualified_name);
            if (!prev || r.degree > prev.degree) {
                byName.set(r.qualified_name, r);
            }
        }
        return [...byName.values()].sort((a, b) => b.degree - a.degree).slice(0, limit);
    };

    const callers = rankLimit(callersAll, (e) => e.source_qualified);
    const callees = rankLimit(calleesAll, (e) => e.target_qualified);

    const distinctCallers = new Set(callersAll.map((e) => e.source_qualified)).size;
    const distinctCallees = new Set(calleesAll.map((e) => e.target_qualified)).size;
    const truncated = distinctCallers > callers.length || distinctCallees > callees.length;

    return {
        found: true,
        symbol: {
            qualified_name: node.qualified_name,
            kind: node.kind,
            file: node.file_path,
            line_start: node.line_start,
            line_end: node.line_end,
            signature: signatureOf(node),
        },
        callers,
        callees,
        uses_types: usesTypes,
        tested_by: testedBy,
        truncated,
    };
}

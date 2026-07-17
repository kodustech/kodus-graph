/**
 * Importance ranking for retrieval — "the N symbols that matter most here".
 *
 * When an agent asks for context, it wants the load-bearing symbols first, not
 * an unordered dump it has to read to filter. Rank by structural degree: fan-in
 * (how many symbols depend on this) plus fan-out (how much it reaches). Fan-in
 * dominates the tie-break, because a heavily depended-on symbol is both the most
 * important to understand and the riskiest to change.
 *
 * Degree is the cheap, deterministic centrality; it is what the hub detection
 * already uses. A fuller PageRank could layer on later, but degree answers "what
 * should I look at first" well for a bounded neighbourhood.
 */

import type { IndexedGraph } from '../graph/loader';
import type { EdgeKind } from '../graph/types';

const STRUCTURAL = new Set<EdgeKind>(['CALLS', 'INHERITS', 'USES_TYPE']);

export interface RankingInput {
    top?: number;
    /** Restrict to symbols declared in this file. */
    file?: string;
    /** Restrict to a node kind (Function, Class, …). */
    kind?: string;
}

export interface RankedSymbol {
    qualified_name: string;
    kind: string;
    file: string;
    /** Structural edges pointing at this symbol (how many depend on it). */
    in_degree: number;
    /** Structural edges leaving this symbol (how much it reaches). */
    out_degree: number;
    score: number;
}

function structuralDegree(edges: { kind: EdgeKind }[] | undefined): number {
    if (!edges) {
        return 0;
    }
    let n = 0;
    for (const e of edges) {
        if (STRUCTURAL.has(e.kind)) {
            n++;
        }
    }
    return n;
}

export function computeRanking(graph: IndexedGraph, input: RankingInput): RankedSymbol[] {
    const top = input.top ?? 20;

    const ranked: RankedSymbol[] = [];
    for (const node of graph.nodes) {
        if (input.file && node.file_path !== input.file) {
            continue;
        }
        if (input.kind && node.kind !== input.kind) {
            continue;
        }
        const inDeg = structuralDegree(graph.reverseAdjacency.get(node.qualified_name));
        const outDeg = structuralDegree(graph.adjacency.get(node.qualified_name));
        if (inDeg === 0 && outDeg === 0) {
            continue; // an unconnected node is not "important" for retrieval
        }
        ranked.push({
            qualified_name: node.qualified_name,
            kind: node.kind,
            file: node.file_path,
            in_degree: inDeg,
            out_degree: outDeg,
            score: inDeg + outDeg,
        });
    }

    // Highest total degree first; fan-in breaks ties; name keeps it deterministic.
    ranked.sort(
        (a, b) => b.score - a.score || b.in_degree - a.in_degree || a.qualified_name.localeCompare(b.qualified_name),
    );
    return ranked.slice(0, top);
}

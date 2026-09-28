import type { GraphEdge } from './types';

/**
 * Drop CALLS edges below `minConfidence`; every other edge kind is kept.
 *
 * Applied to what `parse` / `update` write, after TESTED_BY has been derived
 * from the full set of resolved calls, so test coverage is unaffected. On large
 * Java repos the 0.30 ambiguous tier (with its `alternatives` lists) is most of
 * the file, and `analyze` / `context` discard it at their default 0.5 anyway.
 */
export function dropLowConfidenceCalls(edges: GraphEdge[], minConfidence: number | undefined): GraphEdge[] {
    if (!minConfidence || minConfidence <= 0) {
        return edges;
    }
    return edges.filter((e) => e.kind !== 'CALLS' || (e.confidence ?? 1) >= minConfidence);
}

/**
 * Structural orientation for the code a PR touches — "review that teaches".
 *
 * A reviewer (or a newcomer opening their first PR) sees *what* changed and its
 * risk, but not *where it lives* in the system. This answers that from the graph
 * alone, deterministically, by composing primitives that already exist:
 *   - which module (community) the changed symbols belong to,
 *   - whether any of them is a hub (heavily depended-on) or a bridge (a
 *     chokepoint between subsystems),
 *   - the immediate neighbourhood: who calls into the change, and what it calls.
 *
 * It emits facts, not prose. A product layer (kodus-ai) can narrate them with a
 * model; keeping the narration out of here preserves the determinism of the
 * graph engine.
 */

import type { IndexedGraph } from '../graph/loader';
import { detectTopologicalCommunities } from './topological-communities';

export interface SubsystemContextInput {
    /** Changed symbols (qualified names) the PR touches. */
    changed: string[];
    /** Size of the hub/bridge pool considered "notable". */
    topN?: number;
    /** Minimum community size to report as a subsystem. */
    minCommunitySize?: number;
}

export interface SubsystemInfo {
    id: number;
    size: number;
    files: string[];
    language: string;
    /** Which of the changed symbols fall inside this subsystem. */
    changed_here: string[];
}

export interface SubsystemContextResult {
    changed: string[];
    /** The modules the change lives in, most-touched first. */
    subsystems: SubsystemInfo[];
    /** Changed symbols that are among the most depended-on nodes. */
    hubs_touched: string[];
    /** Changed symbols that bridge distinct subsystems — high blast if broken. */
    bridges_touched: string[];
    /** Symbols that call into the change (who depends on it), excluding the change itself. */
    callers: string[];
    /** Symbols the change calls (what it depends on), excluding the change itself. */
    callees: string[];
}

export function computeSubsystemContext(graph: IndexedGraph, input: SubsystemContextInput): SubsystemContextResult {
    const topN = input.topN ?? 20;
    const minSize = input.minCommunitySize ?? 2;
    const changedSet = new Set(input.changed);

    const topo = detectTopologicalCommunities(graph, { minSize, topN });

    // Which subsystems does the change land in, and which changed symbols each holds.
    const subsystems: SubsystemInfo[] = [];
    for (const community of topo.communities) {
        const changedHere = community.nodes.filter((q) => changedSet.has(q));
        if (changedHere.length === 0) {
            continue;
        }
        subsystems.push({
            id: community.id,
            size: community.size,
            files: community.files,
            language: community.language,
            changed_here: changedHere.sort(),
        });
    }

    const hubNames = new Set(topo.hubs.map((h) => h.qualified_name));
    const bridgeNames = new Set(topo.bridges.map((b) => b.qualified_name));
    const hubs_touched = input.changed.filter((q) => hubNames.has(q)).sort();
    const bridges_touched = input.changed.filter((q) => bridgeNames.has(q)).sort();

    // Immediate neighbourhood over CALLS edges. Callers = edges pointing at a
    // changed symbol, callees = edges leaving one; both exclude the changed set
    // so the result is the surrounding code, not the change itself.
    const callers = new Set<string>();
    const callees = new Set<string>();
    for (const edge of graph.edgesByKind.get('CALLS') ?? []) {
        if (changedSet.has(edge.target_qualified) && !changedSet.has(edge.source_qualified)) {
            callers.add(edge.source_qualified);
        }
        if (changedSet.has(edge.source_qualified) && !changedSet.has(edge.target_qualified)) {
            callees.add(edge.target_qualified);
        }
    }

    return {
        changed: [...input.changed].sort(),
        subsystems,
        hubs_touched,
        bridges_touched,
        callers: [...callers].sort(),
        callees: [...callees].sort(),
    };
}

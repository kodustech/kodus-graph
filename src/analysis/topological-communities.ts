/**
 * Topological community detection over the symbol-level structural graph.
 *
 * The sibling `communities.ts` groups nodes by directory — cheap, but it only
 * tells you how the code is *filed*, not how it actually *connects*. This module
 * ignores paths and clusters by connectivity: it runs Louvain modularity
 * optimization (the greedy core of the Leiden family) on the CALLS / INHERITS /
 * USES_TYPE edges, so two files that call each other constantly land in one
 * community even if they live in different directories, and a file that nothing
 * calls splits off even if it sits inside a busy package.
 *
 * On top of the clustering it surfaces two node roles that directory grouping
 * cannot see:
 *   - hubs:    highest-degree nodes — architectural hotspots; changing one has
 *              wide blast radius.
 *   - bridges: nodes whose neighbors span the most *distinct* communities — the
 *              chokepoints gluing subsystems together. This is a cheap, honest
 *              proxy for betweenness centrality (true betweenness is O(V*E));
 *              it answers "how many separate modules does this node stitch?".
 *
 * Louvain is the greedy local-moving + aggregation heart of Leiden. It does not
 * include Leiden's refinement phase (which guarantees every community is
 * internally connected), so a community here is well-modularized but not
 * formally connectivity-guaranteed — an acceptable trade for code graphs, and
 * named honestly ("modularity-based") rather than claimed as full Leiden.
 */

import type { IndexedGraph } from '../graph/loader';
import type { EdgeKind } from '../graph/types';

export interface TopologicalOptions {
    /** Communities smaller than this are dropped from the result. */
    minSize: number;
    /** How many hubs and bridges to report. */
    topN: number;
}

export interface TopoCommunity {
    id: number;
    size: number;
    nodes: string[];
    files: string[];
    language: string;
    internal_edges: number;
    external_edges: number;
}

export interface HubNode {
    qualified_name: string;
    file: string;
    community: number;
    degree: number;
    in_degree: number;
    out_degree: number;
}

export interface BridgeNode {
    qualified_name: string;
    file: string;
    community: number;
    /** Number of distinct *other* communities this node's neighbors fall into. */
    connects: number;
}

export interface TopologicalResult {
    communities: TopoCommunity[];
    hubs: HubNode[];
    bridges: BridgeNode[];
    modularity: number;
    summary: {
        total_communities: number;
        clustered_nodes: number;
        modularity: number;
    };
}

/** Structural edges that express real connectivity between symbols. */
const STRUCTURAL_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['CALLS', 'INHERITS', 'USES_TYPE']);

/**
 * Weighted undirected graph built from the structural edges. Node ids are dense
 * integers `[0, n)`; `labels[i]` maps back to the qualified name. `adj[i]` is a
 * map from neighbor index to summed edge weight (both directions folded in).
 */
interface WeightedGraph {
    n: number;
    labels: string[];
    adj: Map<number, number>[];
    /** Weighted degree per node. */
    k: number[];
    /** Total edge weight (each undirected edge counted once). */
    m: number;
}

function buildWeightedGraph(graph: IndexedGraph): WeightedGraph {
    const index = new Map<string, number>();
    const labels: string[] = [];

    const idOf = (q: string): number => {
        let id = index.get(q);
        if (id === undefined) {
            id = labels.length;
            index.set(q, id);
            labels.push(q);
        }
        return id;
    };

    const adj: Map<number, number>[] = [];
    const ensure = (i: number): Map<number, number> => {
        while (adj.length <= i) {
            adj.push(new Map());
        }
        return adj[i];
    };

    for (const edge of graph.edges) {
        if (!STRUCTURAL_KINDS.has(edge.kind)) {
            continue;
        }
        // Both endpoints must be real graph nodes (skip edges to phantom targets).
        if (!graph.byQualified.has(edge.source_qualified) || !graph.byQualified.has(edge.target_qualified)) {
            continue;
        }
        const u = idOf(edge.source_qualified);
        const v = idOf(edge.target_qualified);
        if (u === v) {
            continue; // ignore self-loops (recursion) — they don't affect clustering
        }
        const au = ensure(u);
        const av = ensure(v);
        au.set(v, (au.get(v) ?? 0) + 1);
        av.set(u, (av.get(u) ?? 0) + 1);
    }

    const n = labels.length;
    while (adj.length < n) {
        adj.push(new Map());
    }

    const k: number[] = new Array(n).fill(0);
    let totalWeight = 0;
    for (let i = 0; i < n; i++) {
        let deg = 0;
        for (const w of adj[i].values()) {
            deg += w;
        }
        k[i] = deg;
        totalWeight += deg;
    }

    return { n, labels, adj, k, m: totalWeight / 2 };
}

/**
 * One Louvain level: greedily move each node to the neighboring community that
 * maximizes modularity gain, repeating passes until no node moves. Returns the
 * community label per node.
 */
function louvainLocalMoving(adj: Map<number, number>[], k: number[], m: number): number[] {
    const n = adj.length;
    const comm = new Array(n).fill(0).map((_, i) => i);
    const sigmaTot = k.slice(); // each node starts alone, so community total = its degree
    const twoM = 2 * m;
    if (twoM === 0) {
        return comm;
    }

    let improved = true;
    let passes = 0;
    const MAX_PASSES = 50; // convergence guard — Louvain settles in a handful
    while (improved && passes < MAX_PASSES) {
        improved = false;
        passes++;
        for (let i = 0; i < n; i++) {
            const ci = comm[i];
            // Weight from i into each neighboring community.
            const wToComm = new Map<number, number>();
            for (const [j, w] of adj[i]) {
                const cj = comm[j];
                wToComm.set(cj, (wToComm.get(cj) ?? 0) + w);
            }

            // Tentatively remove i from its community.
            sigmaTot[ci] -= k[i];

            let bestComm = ci;
            let bestGain = (wToComm.get(ci) ?? 0) - (sigmaTot[ci] * k[i]) / twoM;
            for (const [c, wIn] of wToComm) {
                const gain = wIn - (sigmaTot[c] * k[i]) / twoM;
                if (gain > bestGain) {
                    bestGain = gain;
                    bestComm = c;
                }
            }

            sigmaTot[bestComm] += k[i];
            if (bestComm !== ci) {
                comm[i] = bestComm;
                improved = true;
            }
        }
    }
    return comm;
}

/**
 * Split any internally-disconnected community into its connected components.
 *
 * This is the guarantee Leiden adds over Louvain: Louvain's aggregation can
 * strand a community that is not internally connected (Traag et al. 2019 measure
 * up to 25% badly connected, 16% outright disconnected), which for a code graph
 * would report "one module" that is really two unrelated pieces. We enforce the
 * property directly: within each community, walk the induced subgraph and give
 * every connected component its own id.
 *
 * Modularity is unchanged by this — components that split share no edge, so no
 * intra-community edge is lost. It is a pure correctness gain, not a trade. This
 * is not full Leiden (no CPM refinement pass), but it delivers Leiden's headline
 * connectivity guarantee in ~a screenful, no dependency.
 */
export function enforceConnectivity(adj: Map<number, number>[], comm: number[]): number[] {
    const n = comm.length;
    const byComm = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
        const list = byComm.get(comm[i]);
        if (list) {
            list.push(i);
        } else {
            byComm.set(comm[i], [i]);
        }
    }

    const result = new Array<number>(n).fill(-1);
    const seen = new Set<number>();
    let nextId = 0;
    for (const nodes of byComm.values()) {
        const inComm = new Set(nodes);
        for (const start of nodes) {
            if (seen.has(start)) {
                continue;
            }
            const compId = nextId++;
            const stack = [start];
            seen.add(start);
            while (stack.length > 0) {
                const cur = stack.pop()!;
                result[cur] = compId;
                for (const nb of adj[cur].keys()) {
                    if (inComm.has(nb) && !seen.has(nb)) {
                        seen.add(nb);
                        stack.push(nb);
                    }
                }
            }
        }
    }
    return result;
}

/** Modularity Q of a partition, for reporting the clustering quality. */
function modularity(adj: Map<number, number>[], k: number[], m: number, comm: number[]): number {
    if (m === 0) {
        return 0;
    }
    const twoM = 2 * m;
    let q = 0;
    for (let i = 0; i < adj.length; i++) {
        for (const [j, w] of adj[i]) {
            if (comm[i] === comm[j]) {
                q += w - (k[i] * k[j]) / twoM;
            }
        }
    }
    return q / twoM;
}

export function detectTopologicalCommunities(graph: IndexedGraph, opts: TopologicalOptions): TopologicalResult {
    const { minSize, topN } = opts;
    const wg = buildWeightedGraph(graph);

    // Louvain local moving, then Leiden's connectivity guarantee: split any
    // community that came out internally disconnected.
    const comm = enforceConnectivity(wg.adj, louvainLocalMoving(wg.adj, wg.k, wg.m));
    const q = modularity(wg.adj, wg.k, wg.m, comm);

    // Renumber communities to dense ids and gather membership.
    const remap = new Map<number, number>();
    const members: number[][] = [];
    for (let i = 0; i < wg.n; i++) {
        let id = remap.get(comm[i]);
        if (id === undefined) {
            id = members.length;
            remap.set(comm[i], id);
            members.push([]);
        }
        members[id].push(i);
    }

    const communityOf = new Array(wg.n);
    for (let id = 0; id < members.length; id++) {
        for (const node of members[id]) {
            communityOf[node] = id;
        }
    }

    // Build community records (dropping the small ones).
    const communities: TopoCommunity[] = [];
    const keptCommunityIds = new Set<number>();
    for (let id = 0; id < members.length; id++) {
        if (members[id].length < minSize) {
            continue;
        }
        keptCommunityIds.add(id);

        const nodes: string[] = [];
        const files = new Set<string>();
        const langs = new Map<string, number>();
        for (const idx of members[id]) {
            const q0 = wg.labels[idx];
            nodes.push(q0);
            const node = graph.byQualified.get(q0);
            if (node) {
                files.add(node.file_path);
                langs.set(node.language, (langs.get(node.language) ?? 0) + 1);
            }
        }
        let internal = 0;
        let external = 0;
        for (const idx of members[id]) {
            for (const [j, w] of wg.adj[idx]) {
                if (communityOf[j] === id) {
                    internal += w;
                } else {
                    external += w;
                }
            }
        }
        let dominant = 'unknown';
        let max = 0;
        for (const [lang, count] of langs) {
            if (count > max) {
                dominant = lang;
                max = count;
            }
        }
        communities.push({
            id,
            size: members[id].length,
            nodes: nodes.sort(),
            files: [...files].sort(),
            language: dominant,
            internal_edges: internal / 2, // each intra edge counted from both ends
            external_edges: external,
        });
    }
    communities.sort((a, b) => b.size - a.size);

    // Hubs: highest weighted degree, restricted to kept communities.
    const hubs: HubNode[] = [];
    for (let i = 0; i < wg.n; i++) {
        if (!keptCommunityIds.has(communityOf[i])) {
            continue;
        }
        const q0 = wg.labels[i];
        const node = graph.byQualified.get(q0);
        const fanOut = (graph.adjacency.get(q0) ?? []).filter((e) => STRUCTURAL_KINDS.has(e.kind)).length;
        const fanIn = (graph.reverseAdjacency.get(q0) ?? []).filter((e) => STRUCTURAL_KINDS.has(e.kind)).length;
        hubs.push({
            qualified_name: q0,
            file: node?.file_path ?? '',
            community: communityOf[i],
            degree: wg.k[i],
            in_degree: fanIn,
            out_degree: fanOut,
        });
    }
    hubs.sort((a, b) => b.degree - a.degree);

    // Bridges: neighbors span the most distinct *other* communities.
    const bridges: BridgeNode[] = [];
    for (let i = 0; i < wg.n; i++) {
        const own = communityOf[i];
        if (!keptCommunityIds.has(own)) {
            continue;
        }
        const otherComms = new Set<number>();
        for (const j of wg.adj[i].keys()) {
            const cj = communityOf[j];
            if (cj !== own && keptCommunityIds.has(cj)) {
                otherComms.add(cj);
            }
        }
        if (otherComms.size === 0) {
            continue;
        }
        const q0 = wg.labels[i];
        bridges.push({
            qualified_name: q0,
            file: graph.byQualified.get(q0)?.file_path ?? '',
            community: own,
            connects: otherComms.size,
        });
    }
    bridges.sort((a, b) => b.connects - a.connects);

    const clusteredNodes = communities.reduce((s, c) => s + c.size, 0);
    const roundedQ = Math.round(q * 1000) / 1000;
    return {
        communities,
        hubs: hubs.slice(0, topN),
        bridges: bridges.slice(0, topN),
        modularity: roundedQ,
        summary: {
            total_communities: communities.length,
            clustered_nodes: clusteredNodes,
            modularity: roundedQ,
        },
    };
}

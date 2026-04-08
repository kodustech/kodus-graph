import type { IndexedGraph } from '../graph/loader';

export interface CommunityOptions {
    depth: number;
    minSize: number;
}

export interface Community {
    name: string;
    files: string[];
    node_count: number;
    cohesion: number;
    language: string;
}

export interface CouplingPair {
    source: string;
    target: string;
    edges: number;
    strength: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface CommunitiesResult {
    communities: Community[];
    coupling: CouplingPair[];
    summary: { total_communities: number; avg_cohesion: number; high_coupling_pairs: number };
}

function getCommunityKey(filePath: string, depth: number): string {
    const parts = filePath.split('/');
    return parts.slice(0, depth).join('/');
}

export function detectCommunities(graph: IndexedGraph, opts: CommunityOptions): CommunitiesResult {
    const { depth, minSize } = opts;

    // Group nodes by directory
    const groups = new Map<string, Set<string>>(); // community -> files
    const nodeComm = new Map<string, string>(); // qualified_name -> community

    for (const node of graph.nodes) {
        const key = getCommunityKey(node.file_path, depth);
        if (!groups.has(key)) {
            groups.set(key, new Set());
        }
        groups.get(key)!.add(node.file_path);
        nodeComm.set(node.qualified_name, key);
    }

    // Count internal and cross edges per community pair
    const internalEdges = new Map<string, number>();
    const crossEdges = new Map<string, number>(); // "a|b" -> count

    for (const edge of graph.edges) {
        if (edge.kind !== 'CALLS' && edge.kind !== 'IMPORTS') {
            continue;
        }
        const srcComm = nodeComm.get(edge.source_qualified);
        const tgtComm = nodeComm.get(edge.target_qualified);
        if (!srcComm || !tgtComm) {
            continue;
        }

        if (srcComm === tgtComm) {
            internalEdges.set(srcComm, (internalEdges.get(srcComm) || 0) + 1);
        } else {
            const pairKey = [srcComm, tgtComm].sort().join('|');
            crossEdges.set(pairKey, (crossEdges.get(pairKey) || 0) + 1);
        }
    }

    // Build communities
    const communities: Community[] = [];
    for (const [name, files] of groups) {
        const nodeCount = graph.nodes.filter((n) => getCommunityKey(n.file_path, depth) === name).length;
        if (nodeCount < minSize) {
            continue;
        }

        const internal = internalEdges.get(name) || 0;
        const maxPossible = nodeCount * (nodeCount - 1);
        const cohesion = maxPossible > 0 ? Math.round((internal / maxPossible) * 100) / 100 : 0;

        const langs = new Map<string, number>();
        for (const n of graph.nodes) {
            if (getCommunityKey(n.file_path, depth) === name) {
                langs.set(n.language, (langs.get(n.language) || 0) + 1);
            }
        }
        let dominant = 'unknown';
        let maxCount = 0;
        for (const [lang, count] of langs) {
            if (count > maxCount) {
                dominant = lang;
                maxCount = count;
            }
        }

        communities.push({
            name,
            files: [...files].sort(),
            node_count: nodeCount,
            cohesion,
            language: dominant,
        });
    }

    communities.sort((a, b) => b.node_count - a.node_count);

    // Build coupling pairs
    const communityNames = new Set(communities.map((c) => c.name));
    const coupling: CouplingPair[] = [];
    for (const [pairKey, count] of crossEdges) {
        const [src, tgt] = pairKey.split('|') as [string, string];
        if (!communityNames.has(src) || !communityNames.has(tgt)) {
            continue;
        }

        const srcTotal = graph.edges.filter((e) => {
            const c = nodeComm.get(e.source_qualified);
            return c === src || c === tgt;
        }).length;
        const ratio = srcTotal > 0 ? count / srcTotal : 0;
        const strength = ratio > 0.3 ? 'HIGH' : ratio > 0.1 ? 'MEDIUM' : 'LOW';

        coupling.push({ source: src, target: tgt, edges: count, strength });
    }

    coupling.sort((a, b) => b.edges - a.edges);

    const avgCohesion =
        communities.length > 0
            ? Math.round((communities.reduce((s, c) => s + c.cohesion, 0) / communities.length) * 100) / 100
            : 0;

    return {
        communities,
        coupling,
        summary: {
            total_communities: communities.length,
            avg_cohesion: avgCohesion,
            high_coupling_pairs: coupling.filter((c) => c.strength === 'HIGH').length,
        },
    };
}

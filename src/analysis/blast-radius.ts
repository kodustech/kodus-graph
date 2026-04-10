import type { BlastRadiusEntry, BlastRadiusResult, GraphData, ImpactCategory } from '../graph/types';

interface AdjEntry {
    neighbor: string;
    confidence: number;
    edgeKind: 'CALLS' | 'IMPORTS';
}

interface FrontierEntry {
    qualified: string;
    accumulated: number;
    edgeKind: 'CALLS' | 'IMPORTS';
    originSeed: string;
}

export function computeBlastRadius(
    graph: GraphData,
    changedQualifiedNames: string[],
    maxDepth: number = 2,
    minConfidence?: number,
    contractBreakingSeeds?: Set<string>,
): BlastRadiusResult {
    const minConf = minConfidence ?? 0.5;

    // Build adjacency list with metadata
    const adj = new Map<string, AdjEntry[]>();

    const addEdge = (from: string, entry: AdjEntry) => {
        if (!adj.has(from)) {
            adj.set(from, []);
        }
        adj.get(from)!.push(entry);
    };

    for (const edge of graph.edges) {
        if (edge.kind === 'IMPORTS') {
            // IMPORTS: unidirectional — change in imported affects importer
            addEdge(edge.target_qualified, {
                neighbor: edge.source_qualified,
                confidence: 1.0,
                edgeKind: 'IMPORTS',
            });
        } else if (edge.kind === 'CALLS' && (edge.confidence ?? 1.0) >= minConf) {
            // CALLS: only edges with sufficient confidence, reverse direction
            addEdge(edge.target_qualified, {
                neighbor: edge.source_qualified,
                confidence: edge.confidence ?? 1.0,
                edgeKind: 'CALLS',
            });
        }
    }

    // Track best accumulated confidence per node
    const bestConfidence = new Map<string, number>();
    const bestEdgeKind = new Map<string, 'CALLS' | 'IMPORTS'>();
    const bestOriginSeed = new Map<string, string>();
    const nodeDepth = new Map<string, number>();

    const seedSet = new Set(changedQualifiedNames);
    const byDepth: Record<string, BlastRadiusEntry[]> = {};

    // Initialize frontier from seeds
    let frontier: FrontierEntry[] = [];
    for (const seed of changedQualifiedNames) {
        const neighbors = adj.get(seed) || [];
        for (const entry of neighbors) {
            if (seedSet.has(entry.neighbor)) continue;

            const childAccumulated = entry.edgeKind === 'CALLS'
                ? 1.0 * entry.confidence
                : 1.0; // IMPORTS always 1.0

            const existing = bestConfidence.get(entry.neighbor);
            if (existing === undefined || childAccumulated > existing) {
                bestConfidence.set(entry.neighbor, childAccumulated);
                bestEdgeKind.set(entry.neighbor, entry.edgeKind);
                bestOriginSeed.set(entry.neighbor, seed);
                nodeDepth.set(entry.neighbor, 1);
            }

            frontier.push({
                qualified: entry.neighbor,
                accumulated: childAccumulated,
                edgeKind: entry.edgeKind,
                originSeed: seed,
            });
        }
    }

    // Deduplicate frontier: keep best accumulated per node
    let frontierBest = new Map<string, FrontierEntry>();
    for (const fe of frontier) {
        const existing = frontierBest.get(fe.qualified);
        if (!existing || fe.accumulated > existing.accumulated) {
            frontierBest.set(fe.qualified, fe);
        }
    }

    // Build depth 1 entries
    if (frontierBest.size > 0) {
        const contractBreaking = contractBreakingSeeds ?? new Set<string>();
        const entries: BlastRadiusEntry[] = [];
        for (const [, fe] of frontierBest) {
            let category: ImpactCategory;
            if (fe.edgeKind === 'CALLS' && contractBreaking.has(fe.originSeed)) {
                category = 'contract_breaking';
            } else {
                category = 'behavior_affected';
            }

            entries.push({
                qualified_name: fe.qualified,
                accumulated_confidence: fe.accumulated,
                edge_kind: fe.edgeKind,
                impact_category: category,
                flows: [],
                impact_score: 0,
            });
        }
        byDepth['1'] = entries;
    }

    // BFS for remaining depths
    for (let depth = 2; depth <= maxDepth; depth++) {
        const nextBest = new Map<string, FrontierEntry>();

        for (const [, parentEntry] of frontierBest) {
            const neighbors = adj.get(parentEntry.qualified) || [];
            for (const adjEntry of neighbors) {
                if (seedSet.has(adjEntry.neighbor)) continue;

                const childAccumulated = adjEntry.edgeKind === 'CALLS'
                    ? parentEntry.accumulated * adjEntry.confidence
                    : parentEntry.accumulated * 1.0; // IMPORTS deterministic

                // Check if already visited at a previous depth with better confidence
                const prevBest = bestConfidence.get(adjEntry.neighbor);
                if (prevBest !== undefined && nodeDepth.get(adjEntry.neighbor)! < depth) {
                    // Already found at earlier depth — only update if better confidence
                    if (childAccumulated > prevBest) {
                        bestConfidence.set(adjEntry.neighbor, childAccumulated);
                        bestEdgeKind.set(adjEntry.neighbor, adjEntry.edgeKind);
                        bestOriginSeed.set(adjEntry.neighbor, parentEntry.originSeed);
                        // Update the entry in the existing depth
                        const existingDepth = String(nodeDepth.get(adjEntry.neighbor)!);
                        const existingEntries = byDepth[existingDepth];
                        if (existingEntries) {
                            const idx = existingEntries.findIndex(e => e.qualified_name === adjEntry.neighbor);
                            if (idx !== -1) {
                                existingEntries[idx].accumulated_confidence = childAccumulated;
                                existingEntries[idx].edge_kind = adjEntry.edgeKind;
                            }
                        }
                    }
                    continue;
                }

                // Same depth — keep the best
                if (prevBest !== undefined && nodeDepth.get(adjEntry.neighbor) === depth) {
                    if (childAccumulated > prevBest) {
                        bestConfidence.set(adjEntry.neighbor, childAccumulated);
                        bestEdgeKind.set(adjEntry.neighbor, adjEntry.edgeKind);
                        bestOriginSeed.set(adjEntry.neighbor, parentEntry.originSeed);
                        nextBest.set(adjEntry.neighbor, {
                            qualified: adjEntry.neighbor,
                            accumulated: childAccumulated,
                            edgeKind: adjEntry.edgeKind,
                            originSeed: parentEntry.originSeed,
                        });
                    }
                    continue;
                }

                // New node at this depth
                bestConfidence.set(adjEntry.neighbor, childAccumulated);
                bestEdgeKind.set(adjEntry.neighbor, adjEntry.edgeKind);
                bestOriginSeed.set(adjEntry.neighbor, parentEntry.originSeed);
                nodeDepth.set(adjEntry.neighbor, depth);
                nextBest.set(adjEntry.neighbor, {
                    qualified: adjEntry.neighbor,
                    accumulated: childAccumulated,
                    edgeKind: adjEntry.edgeKind,
                    originSeed: parentEntry.originSeed,
                });
            }
        }

        if (nextBest.size > 0) {
            const entries: BlastRadiusEntry[] = [];
            for (const [, fe] of nextBest) {
                entries.push({
                    qualified_name: fe.qualified,
                    accumulated_confidence: fe.accumulated,
                    edge_kind: fe.edgeKind,
                    impact_category: 'transitive',
                    flows: [],
                    impact_score: 0,
                });
            }
            byDepth[String(depth)] = entries;
        }

        frontierBest = nextBest;
    }

    // Count unique visited nodes (seeds + all discovered)
    const visited = new Set<string>(changedQualifiedNames);
    for (const entries of Object.values(byDepth)) {
        for (const entry of entries) {
            visited.add(entry.qualified_name);
        }
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

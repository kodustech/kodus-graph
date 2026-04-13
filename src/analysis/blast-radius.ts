import type { BlastRadiusEntry, BlastRadiusResult, EdgeKind, GraphData, ImpactCategory } from '../graph/types';

type BlastRadiusEdgeKind = Extract<EdgeKind, 'CALLS' | 'IMPORTS'>;

interface AdjEntry {
    neighbor: string;
    confidence: number;
    edgeKind: BlastRadiusEdgeKind;
}

interface FrontierEntry {
    qualified: string;
    accumulated: number;
    edgeKind: BlastRadiusEdgeKind;
    originSeed: string;
}

interface NodeState {
    confidence: number;
    edgeKind: BlastRadiusEdgeKind;
    originSeed: string;
    depth: number;
}

function computeCategory(
    depth: number,
    edgeKind: BlastRadiusEdgeKind,
    originSeed: string,
    cbSeeds: Set<string>,
): ImpactCategory {
    if (depth === 1 && edgeKind === 'CALLS' && cbSeeds.has(originSeed)) {
        return 'contract_breaking';
    }
    if (depth === 1) {
        return 'behavior_affected';
    }
    return 'transitive';
}

export function computeBlastRadius(
    graph: GraphData,
    changedQualifiedNames: string[],
    maxDepth: number = 2,
    minConfidence?: number,
    contractBreakingSeeds?: Set<string>,
): BlastRadiusResult {
    const minConf = minConfidence ?? 0.5;
    const cbSeeds = contractBreakingSeeds ?? new Set<string>();

    // Build node lookup for is_exported checks
    const nodeByQN = new Map(graph.nodes.map((n) => [n.qualified_name, n]));

    // Build adjacency list with metadata
    const adj = new Map<string, AdjEntry[]>();
    const adjSeen = new Set<string>();

    const addEdge = (from: string, to: string, confidence: number, edgeKind: BlastRadiusEdgeKind) => {
        const key = `${from}\0${to}\0${edgeKind}`;
        if (adjSeen.has(key)) {
            // Update confidence if higher
            const list = adj.get(from)!;
            const entry = list.find((e) => e.neighbor === to && e.edgeKind === edgeKind);
            if (entry && confidence > entry.confidence) {
                entry.confidence = confidence;
            }
            return;
        }
        adjSeen.add(key);
        if (!adj.has(from)) {
            adj.set(from, []);
        }
        adj.get(from)!.push({ neighbor: to, confidence, edgeKind });
    };

    for (const edge of graph.edges) {
        if (edge.kind === 'IMPORTS') {
            // IMPORTS: unidirectional — change in imported affects importer
            addEdge(edge.target_qualified, edge.source_qualified, 1.0, 'IMPORTS');
        } else if (edge.kind === 'CALLS' && (edge.confidence ?? 1.0) >= minConf) {
            // Skip cross-file calls to non-exported functions (likely wrong resolution)
            const targetNode = nodeByQN.get(edge.target_qualified);
            if (targetNode && targetNode.is_exported === false) {
                const sourceFile = edge.source_qualified.split('::')[0];
                const targetFile = edge.target_qualified.split('::')[0];
                if (sourceFile !== targetFile) {
                    continue;
                }
            }
            // CALLS: only edges with sufficient confidence, reverse direction
            addEdge(edge.target_qualified, edge.source_qualified, edge.confidence ?? 1.0, 'CALLS');
        }
    }

    // Consolidated state per node
    const nodeState = new Map<string, NodeState>();

    const seedSet = new Set(changedQualifiedNames);

    // Use Maps per depth for O(1) lookup instead of findIndex
    const depthEntryMaps = new Map<number, Map<string, BlastRadiusEntry>>();

    // Initialize frontier from seeds
    const frontier: FrontierEntry[] = [];
    for (const seed of changedQualifiedNames) {
        const neighbors = adj.get(seed) || [];
        for (const entry of neighbors) {
            if (seedSet.has(entry.neighbor)) {
                continue;
            }

            const childAccumulated = entry.edgeKind === 'CALLS' ? entry.confidence : 1.0; // IMPORTS always 1.0

            const existing = nodeState.get(entry.neighbor);
            if (existing === undefined || childAccumulated > existing.confidence) {
                nodeState.set(entry.neighbor, {
                    confidence: childAccumulated,
                    edgeKind: entry.edgeKind,
                    originSeed: seed,
                    depth: 1,
                });
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
        const depthMap = new Map<string, BlastRadiusEntry>();
        for (const [, fe] of frontierBest) {
            const category = computeCategory(1, fe.edgeKind, fe.originSeed, cbSeeds);

            depthMap.set(fe.qualified, {
                qualified_name: fe.qualified,
                accumulated_confidence: fe.accumulated,
                edge_kind: fe.edgeKind,
                impact_category: category,
                flows: [],
                impact_score: 0,
            });
        }
        depthEntryMaps.set(1, depthMap);
    }

    // BFS for remaining depths
    for (let depth = 2; depth <= maxDepth; depth++) {
        const nextBest = new Map<string, FrontierEntry>();

        for (const [, parentEntry] of frontierBest) {
            const neighbors = adj.get(parentEntry.qualified) || [];
            for (const adjEntry of neighbors) {
                if (seedSet.has(adjEntry.neighbor)) {
                    continue;
                }

                const childAccumulated =
                    adjEntry.edgeKind === 'CALLS'
                        ? parentEntry.accumulated * adjEntry.confidence
                        : parentEntry.accumulated; // IMPORTS: deterministic, confidence = 1.0

                // Check if already visited at a previous depth with better confidence
                const prevState = nodeState.get(adjEntry.neighbor);
                if (prevState !== undefined && prevState.depth < depth) {
                    // Already found at earlier depth — only update if better confidence
                    if (childAccumulated > prevState.confidence) {
                        nodeState.set(adjEntry.neighbor, {
                            confidence: childAccumulated,
                            edgeKind: adjEntry.edgeKind,
                            originSeed: parentEntry.originSeed,
                            depth: prevState.depth,
                        });
                        // Update the entry in the existing depth
                        const existingMap = depthEntryMaps.get(prevState.depth);
                        if (existingMap) {
                            const existingEntry = existingMap.get(adjEntry.neighbor);
                            if (existingEntry) {
                                existingEntry.accumulated_confidence = childAccumulated;
                                existingEntry.edge_kind = adjEntry.edgeKind;
                                // Recompute impact_category based on original depth and new edge properties
                                existingEntry.impact_category = computeCategory(
                                    prevState.depth,
                                    adjEntry.edgeKind,
                                    parentEntry.originSeed,
                                    cbSeeds,
                                );
                            }
                        }
                    }
                    continue;
                }

                // Same depth — keep the best
                if (prevState !== undefined && prevState.depth === depth) {
                    if (childAccumulated > prevState.confidence) {
                        nodeState.set(adjEntry.neighbor, {
                            confidence: childAccumulated,
                            edgeKind: adjEntry.edgeKind,
                            originSeed: parentEntry.originSeed,
                            depth,
                        });
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
                nodeState.set(adjEntry.neighbor, {
                    confidence: childAccumulated,
                    edgeKind: adjEntry.edgeKind,
                    originSeed: parentEntry.originSeed,
                    depth,
                });
                nextBest.set(adjEntry.neighbor, {
                    qualified: adjEntry.neighbor,
                    accumulated: childAccumulated,
                    edgeKind: adjEntry.edgeKind,
                    originSeed: parentEntry.originSeed,
                });
            }
        }

        if (nextBest.size > 0) {
            const depthMap = new Map<string, BlastRadiusEntry>();
            for (const [, fe] of nextBest) {
                depthMap.set(fe.qualified, {
                    qualified_name: fe.qualified,
                    accumulated_confidence: fe.accumulated,
                    edge_kind: fe.edgeKind,
                    impact_category: 'transitive',
                    flows: [],
                    impact_score: 0,
                });
            }
            depthEntryMaps.set(depth, depthMap);
        }

        frontierBest = nextBest;
    }

    // Convert depth entry maps to arrays for the result
    const byDepth: Record<string, BlastRadiusEntry[]> = {};
    for (const [d, map] of depthEntryMaps) {
        byDepth[String(d)] = [...map.values()];
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

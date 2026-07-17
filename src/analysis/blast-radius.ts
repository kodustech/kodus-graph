import type { BlastRadiusEntry, BlastRadiusResult, EdgeKind, GraphData, ImpactCategory } from '../graph/types';
import { DEFAULT_BLAST_MAX_DEPTH } from '../shared/constants';
import { GraphIndex } from './graph-index';

type BlastRadiusEdgeKind = Extract<EdgeKind, 'CALLS' | 'IMPORTS' | 'USES_TYPE' | 'INHERITS'>;

/**
 * Confidence carried by a USES_TYPE edge.
 *
 * `deriveEdges` only emits one when the name was imported into that file (or
 * declared beside it) AND resolves to a type this repo declares — so the
 * dependency is real, not guessed. It sits below the receiver tier because the
 * edge says the signature mentions the type, not that every change to the type
 * breaks the function: widening a union or adding an optional field usually
 * doesn't. Decays across depth like CALLS.
 */
const USES_TYPE_CONFIDENCE = 0.8;

/**
 * Confidence carried by an INHERITS edge.
 *
 * A change to a base class reaches every subclass that extends it: the subclass
 * *is* the base plus its own additions, so behavior, fields, and contract flow
 * down. This is one of the strongest structural couplings — higher than a
 * signature merely naming a type (USES_TYPE) — so it sits just under a direct
 * receiver-resolved call. Traversed reversed, like CALLS: the changed base is
 * the target of the edge, the affected subclass is the source. Decays across
 * depth so a change three levels up a hierarchy still counts, but less.
 */
const INHERITS_CONFIDENCE = 0.9;

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
    maxDepth: number = DEFAULT_BLAST_MAX_DEPTH,
    minConfidence?: number,
    contractBreakingSeeds?: Set<string>,
    options?: { index?: GraphIndex },
): BlastRadiusResult {
    const minConf = minConfidence ?? 0.5;
    const cbSeeds = contractBreakingSeeds ?? new Set<string>();
    const idx = options?.index ?? new GraphIndex(graph);

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

    for (const edge of idx.edgesByKind('IMPORTS')) {
        // IMPORTS: unidirectional — change in imported affects importer
        addEdge(edge.target_qualified, edge.source_qualified, 1.0, 'IMPORTS');
    }
    for (const edge of idx.edgesByKind('CALLS')) {
        if ((edge.confidence ?? 1.0) < minConf) {
            continue;
        }
        // Skip cross-file calls to non-exported functions (likely wrong resolution)
        const targetNode = idx.nodeByQualified(edge.target_qualified);
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
    for (const edge of idx.edgesByKind('USES_TYPE')) {
        if (USES_TYPE_CONFIDENCE < minConf) {
            continue;
        }
        // Reverse, like CALLS: a change to the type reaches the signature that
        // names it. Unlike IMPORTS these are symbol-to-symbol, so they meet the
        // symbol seeds the traversal actually starts from.
        addEdge(edge.target_qualified, edge.source_qualified, USES_TYPE_CONFIDENCE, 'USES_TYPE');
    }
    for (const edge of idx.edgesByKind('INHERITS')) {
        if (INHERITS_CONFIDENCE < minConf) {
            continue;
        }
        // Reverse, like CALLS: a change to the base (edge target) reaches every
        // subclass that extends it (edge source). Without this, changing a base
        // class left its subclasses out of the blast radius unless they happened
        // to call `super` — a real under-count of a high-impact change.
        addEdge(edge.target_qualified, edge.source_qualified, INHERITS_CONFIDENCE, 'INHERITS');
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

            // IMPORTS is the only deterministic kind (confidence 1.0); CALLS and
            // USES_TYPE both carry a resolution confidence worth propagating.
            const childAccumulated = entry.edgeKind === 'IMPORTS' ? 1.0 : entry.confidence;

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
                    adjEntry.edgeKind === 'IMPORTS'
                        ? parentEntry.accumulated // deterministic, confidence = 1.0
                        : parentEntry.accumulated * adjEntry.confidence;

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
    const impactedFiles = new Set<string>();
    for (const q of visited) {
        const node = idx.nodeByQualified(q);
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

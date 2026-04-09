import { performance } from 'perf_hooks';
import { type IndexedGraph, indexGraph } from '../graph/loader';
import type {
    AffectedFlow,
    ContextAnalysisMetadata,
    GraphData,
    GraphEdge,
    GraphNode,
    ParseMetadata,
} from '../graph/types';
import { computeBlastRadius } from './blast-radius';
import { computeStructuralDiff, type DiffResult } from './diff';
import { enrichChangedFunctions } from './enrich';
import { detectFlows } from './flows';
import { extractInheritance } from './inheritance';
import { computeRiskScore } from './risk-score';
import { findTestGaps } from './test-gaps';

export interface ContextV2Output {
    graph: {
        nodes: GraphNode[];
        edges: GraphEdge[];
        metadata: ParseMetadata;
    };
    analysis: {
        changed_functions: ReturnType<typeof enrichChangedFunctions>;
        structural_diff: DiffResult;
        blast_radius: ReturnType<typeof computeBlastRadius>;
        affected_flows: AffectedFlow[];
        inheritance: ReturnType<typeof extractInheritance>;
        test_gaps: ReturnType<typeof findTestGaps>;
        risk: ReturnType<typeof computeRiskScore>;
        metadata: ContextAnalysisMetadata;
    };
}

interface BuildContextV2Options {
    mergedGraph: GraphData;
    oldGraph: GraphData | null;
    changedFiles: string[];
    minConfidence: number;
    maxDepth: number;
    skipTests?: boolean;
}

export function buildContextV2(opts: BuildContextV2Options): ContextV2Output {
    const t0 = performance.now();
    const { mergedGraph, oldGraph, changedFiles, minConfidence, maxDepth } = opts;

    // Phase 1: Index
    const indexed = indexGraph(mergedGraph);
    const oldIndexed: IndexedGraph = oldGraph ? indexGraph(oldGraph) : indexGraph({ nodes: [], edges: [] });

    // Phase 2: Independent analyses
    const changedSet = new Set(changedFiles);
    const newNodesInChanged = mergedGraph.nodes.filter((n) => changedSet.has(n.file_path));
    const newEdgesInChanged = mergedGraph.edges.filter((e) => changedSet.has(e.file_path));

    const structuralDiff = computeStructuralDiff(oldIndexed, newNodesInChanged, newEdgesInChanged, changedFiles);

    // Extract truly changed qualified names from structural diff (added + modified + removed)
    const trulyChangedQN = new Set([
        ...structuralDiff.nodes.added.map((n) => n.qualified_name),
        ...structuralDiff.nodes.modified.map((n) => n.qualified_name),
        ...structuralDiff.nodes.removed.map((n) => n.qualified_name),
    ]);

    const blastRadius = computeBlastRadius(mergedGraph, [...trulyChangedQN], maxDepth, minConfidence);
    const allFlows = detectFlows(indexed, { maxDepth: 10, type: 'all' });
    const testGaps = opts.skipTests ? [] : findTestGaps(mergedGraph, changedFiles);
    const risk = computeRiskScore(mergedGraph, changedFiles, blastRadius, { skipTests: opts.skipTests });
    const inheritance = extractInheritance(indexed, changedFiles);

    // Phase 3: Filter affected flows — only truly changed (added+modified+removed), non-test functions
    const changedFuncSet = new Set(
        [...trulyChangedQN].filter((qn) => {
            const node = indexed.byQualified.get(qn);
            return node && !node.is_test;
        }),
    );

    const affectedFlows: AffectedFlow[] = [];
    for (const flow of allFlows.flows) {
        const touches = flow.path.filter((qn) => changedFuncSet.has(qn));
        if (touches.length > 0) {
            affectedFlows.push({
                entry_point: flow.entry_point,
                type: flow.type,
                touches_changed: touches,
                depth: flow.depth,
                path: flow.path,
            });
        }
    }

    // Phase 3: Enrichment
    const enriched = enrichChangedFunctions(indexed, changedFiles, structuralDiff, allFlows.flows, minConfidence, true);

    // Phase 4: Assembly
    const totalCallers = enriched.reduce((s, f) => s + f.callers.length, 0);
    const totalCallees = enriched.reduce((s, f) => s + f.callees.length, 0);

    const metadata: ContextAnalysisMetadata = {
        changed_functions_count: enriched.length,
        total_callers: totalCallers,
        total_callees: totalCallees,
        untested_count: testGaps.length,
        affected_flows_count: affectedFlows.length,
        duration_ms: Math.round(performance.now() - t0),
        min_confidence: minConfidence,
    };

    const graphMetadata: ParseMetadata = indexed.metadata.repo_dir
        ? indexed.metadata
        : {
              repo_dir: '',
              files_parsed: changedFiles.length,
              total_nodes: mergedGraph.nodes.length,
              total_edges: mergedGraph.edges.length,
              duration_ms: 0,
              parse_errors: 0,
              extract_errors: 0,
          };

    return {
        graph: {
            nodes: mergedGraph.nodes,
            edges: mergedGraph.edges,
            metadata: graphMetadata,
        },
        analysis: {
            changed_functions: enriched,
            structural_diff: structuralDiff,
            blast_radius: blastRadius,
            affected_flows: affectedFlows,
            inheritance,
            test_gaps: testGaps,
            risk,
            metadata,
        },
    };
}

import { performance } from 'perf_hooks';
import { type IndexedGraph, indexGraph } from '../graph/loader';
import type {
    AffectedFlow,
    BlastRadiusResult,
    ContextAnalysisMetadata,
    FlowRef,
    GraphData,
    GraphEdge,
    GraphNode,
    ParseMetadata,
} from '../graph/types';
import { log } from '../shared/logger';
import { computeBlastRadius } from './blast-radius';
import { computeStructuralDiff, type DiffResult } from './diff';
import { type DiffHunk, overlapsWithDiff } from './diff-lines';
import { enrichChangedFunctions } from './enrich';
import { detectFlows, type FlowsResult } from './flows';
import { GraphIndex } from './graph-index';
import { extractInheritance } from './inheritance';
import type { RiskConfig } from './risk-config';
import { computeRiskScore } from './risk-score';
import { findTestGaps } from './test-gaps';

/** Default weight for blast radius entries not in any detected flow. */
const FLOW_WEIGHT_BASELINE = 0.1;
/**
 * Hub-damping threshold used for the coupling neighbourhood. Nodes whose
 * fan-out exceeds this are reached but not expanded, so barrel/index files
 * don't explode the "review together" set. 15 is the value backtested on real
 * kodus-ai co-changes (reverse 0.024 → bidirectional+hub15 ~0.70 symbol recall).
 */
const COUPLING_DEFAULT_HUB_THRESHOLD = 15;
/** Multiplier for test-only flows (lower than HTTP flows since they represent test paths, not production). */
const FLOW_WEIGHT_TEST_MULTIPLIER = 0.3;

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
        /**
         * Bidirectional + hub-damped neighbourhood of the change — "what else to
         * review together". Present only when `couplingDirection` is
         * 'bidirectional'. Distinct from `blast_radius` (reverse, "what breaks"):
         * this also walks the change's dependencies and sibling cluster, which is
         * where most real co-change lives. Never feeds the risk score.
         */
        coupling_neighbourhood?: ReturnType<typeof computeBlastRadius>;
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
    /** Parsed diff hunks per file — used to filter changed functions in fallback mode (no oldGraph) */
    diffHunks?: Map<string, DiffHunk[]>;
    /** Custom risk score weights/caps (resolved — object form only at this layer). */
    riskConfig?: RiskConfig;
    /**
     * When 'bidirectional', also compute `coupling_neighbourhood` (the "review
     * together" set). Default 'reverse' computes only the classic blast radius,
     * leaving the coupling field absent. The primary `blast_radius` (risk /
     * breakage) is ALWAYS reverse regardless of this setting.
     */
    couplingDirection?: 'reverse' | 'bidirectional';
    /** Hub-damping threshold for the coupling neighbourhood (0 = off; default 15). */
    hubThreshold?: number;
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

    // The unified diff is ground truth for what changed. When hunks are
    // available it does TWO jobs — subtract false positives AND add what the
    // structural diff missed:
    //
    // (1) SUBTRACT: a stale or field-incomplete baseline (e.g. a DB export
    //     missing `throws`/`decorators`/`content_hash`) makes the structural
    //     diff fire on metadata divergence that isn't a real code change. Drop
    //     any "changed" node that doesn't actually intersect a changed line.
    //
    // (2) ADD: when the baseline graph is built from HEAD — which is REQUIRED
    //     for accurate cross-file edges, and is exactly what kodus-ai passes via
    //     `--graph` — the old-vs-new structural diff sees the changed file at
    //     its current content on BOTH sides, so added/modified come back empty
    //     and the changed set collapses to zero. In that case the diff hunks are
    //     the only signal the file changed at all. Seed changed functions
    //     directly from hunk overlap so passing `--graph` never zeroes out the
    //     changed set (the "0 changed" bug). A hunk-overlapping Function/Method
    //     that the structural diff didn't classify gets a synthesized `modified`
    //     entry so enrichChangedFunctions surfaces it with callers/callees.
    if (opts.diffHunks && opts.diffHunks.size > 0) {
        const before = trulyChangedQN.size;

        // (1) subtract non-overlapping
        for (const qn of [...trulyChangedQN]) {
            const node = indexed.byQualified.get(qn);
            if (node && !overlapsWithDiff(node.file_path, node.line_start, node.line_end, opts.diffHunks)) {
                trulyChangedQN.delete(qn);
            }
        }

        // (2) add hunk-overlapping functions/methods the structural diff missed
        const modifiedQN = new Set(structuralDiff.nodes.modified.map((m) => m.qualified_name));
        const addedQN = new Set(structuralDiff.nodes.added.map((n) => n.qualified_name));
        for (const node of newNodesInChanged) {
            if (node.kind !== 'Function' && node.kind !== 'Method') {
                continue;
            }
            if (node.is_test || trulyChangedQN.has(node.qualified_name)) {
                continue;
            }
            if (!overlapsWithDiff(node.file_path, node.line_start, node.line_end, opts.diffHunks)) {
                continue;
            }
            trulyChangedQN.add(node.qualified_name);
            if (!modifiedQN.has(node.qualified_name) && !addedQN.has(node.qualified_name)) {
                // Synthesize a minimal modified entry — the hunk proves the body
                // changed; we just have no structural delta to attribute it to.
                structuralDiff.nodes.modified.push({
                    qualified_name: node.qualified_name,
                    changes: ['body'],
                    contract_diffs: [],
                });
                modifiedQN.add(node.qualified_name);
            }
        }

        // Keep structuralDiff added/modified consistent with the final set so
        // enrichChangedFunctions sees exactly the same changed functions.
        structuralDiff.nodes.added = structuralDiff.nodes.added.filter((n) => trulyChangedQN.has(n.qualified_name));
        structuralDiff.nodes.modified = structuralDiff.nodes.modified.filter((n) =>
            trulyChangedQN.has(n.qualified_name),
        );
        structuralDiff.summary.added = structuralDiff.nodes.added.length;
        structuralDiff.summary.modified = structuralDiff.nodes.modified.length;

        log.info('context: diff-hunk filter applied', {
            before,
            after: trulyChangedQN.size,
            seeded: trulyChangedQN.size - before > 0 ? trulyChangedQN.size - before : 0,
        });
    }

    const contractBreakingSeeds = new Set(
        structuralDiff.nodes.modified.filter((m) => m.contract_diffs.length > 0).map((m) => m.qualified_name),
    );
    const graphIndex = new GraphIndex(mergedGraph);
    const blastRadius = computeBlastRadius(
        mergedGraph,
        [...trulyChangedQN],
        maxDepth,
        minConfidence,
        contractBreakingSeeds,
        { index: graphIndex },
    );
    const allFlows = detectFlows(indexed, { maxDepth: 10, type: 'all' });
    enrichBlastRadiusWithFlows(blastRadius, allFlows);

    // Coupling neighbourhood — bidirectional + hub-damped. Answers "what else
    // should I review with this change" (siblings + dependencies), which the
    // reverse blast radius (callers only) misses. Opt-in and NEVER fed to the
    // risk score, so risk stays a clean "what breaks downstream" signal.
    let couplingNeighbourhood: BlastRadiusResult | undefined;
    if (opts.couplingDirection === 'bidirectional' && trulyChangedQN.size > 0) {
        couplingNeighbourhood = computeBlastRadius(
            mergedGraph,
            [...trulyChangedQN],
            maxDepth,
            minConfidence,
            contractBreakingSeeds,
            {
                index: graphIndex,
                direction: 'bidirectional',
                hubThreshold: opts.hubThreshold ?? COUPLING_DEFAULT_HUB_THRESHOLD,
            },
        );
        enrichBlastRadiusWithFlows(couplingNeighbourhood, allFlows);
    }
    const testGaps = opts.skipTests ? [] : findTestGaps(mergedGraph, changedFiles, graphIndex);
    const risk = computeRiskScore(mergedGraph, changedFiles, blastRadius, {
        skipTests: opts.skipTests,
        riskConfig: opts.riskConfig,
        index: graphIndex,
    });
    const inheritance = extractInheritance(indexed, changedFiles);

    // Phase 2b: Filter affected flows — only truly changed (added+modified+removed), non-test functions
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
            ...(couplingNeighbourhood ? { coupling_neighbourhood: couplingNeighbourhood } : {}),
            affected_flows: affectedFlows,
            inheritance,
            test_gaps: testGaps,
            risk,
            metadata,
        },
    };
}

function enrichBlastRadiusWithFlows(blastRadius: BlastRadiusResult, allFlows: FlowsResult): void {
    // Build flow index: qualified_name → FlowRef[]
    const flowIndex = new Map<string, FlowRef[]>();
    const flowSeenKeys = new Map<string, Set<string>>(); // qn → set of seen entry_points

    for (const flow of allFlows.flows) {
        for (const qn of flow.path) {
            if (!flowIndex.has(qn)) {
                flowIndex.set(qn, []);
                flowSeenKeys.set(qn, new Set());
            }
            const seen = flowSeenKeys.get(qn)!;
            if (!seen.has(flow.entry_point)) {
                seen.add(flow.entry_point);
                flowIndex.get(qn)!.push({
                    entry_point: flow.entry_point,
                    type: flow.type,
                    criticality: flow.criticality,
                });
            }
        }
    }

    // Use ?? to only substitute null/undefined; 0 would cause div-by-zero so we guard separately
    const maxCriticality = allFlows.summary.max_criticality ?? 0;
    const safeDivisor = maxCriticality > 0 ? maxCriticality : 1;

    for (const entries of Object.values(blastRadius.by_depth)) {
        for (const entry of entries) {
            entry.flows = flowIndex.get(entry.qualified_name) || [];

            let flowWeight = FLOW_WEIGHT_BASELINE;
            if (entry.flows.length > 0) {
                const httpFlows = entry.flows.filter((f) => f.type === 'http');
                const testFlows = entry.flows.filter((f) => f.type === 'test');

                if (httpFlows.length > 0) {
                    const maxHttpCrit = Math.max(...httpFlows.map((f) => f.criticality));
                    flowWeight = Math.min(maxHttpCrit / safeDivisor, 1.0);
                } else if (testFlows.length > 0) {
                    const maxTestCrit = Math.max(...testFlows.map((f) => f.criticality));
                    flowWeight = FLOW_WEIGHT_TEST_MULTIPLIER * Math.min(maxTestCrit / safeDivisor, 1.0);
                }
            }

            entry.impact_score = Math.round(entry.accumulated_confidence * flowWeight * 100) / 100;
        }

        entries.sort((a, b) => b.impact_score - a.impact_score);
    }
}

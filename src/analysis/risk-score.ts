import type { BlastRadiusResult, GraphData, RiskScoreResult } from '../graph/types';

export function computeRiskScore(
    graph: GraphData,
    changedFiles: string[],
    blastRadius: BlastRadiusResult,
): RiskScoreResult {
    const changedSet = new Set(changedFiles);
    const changedNodes = graph.nodes.filter((n) => changedSet.has(n.file_path) && !n.is_test);

    // Factor 1: Blast radius (0.35)
    const brValue = Math.min(blastRadius.total_functions / 20, 1); // cap at 20

    // Factor 2: Test gaps (0.30)
    const testedFiles = new Set(graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.source_qualified));
    const changedFunctions = changedNodes.filter((n) => n.kind === 'Function' || n.kind === 'Method');
    const untestedCount = changedFunctions.filter((n) => !testedFiles.has(n.file_path)).length;
    const tgValue = changedFunctions.length > 0 ? untestedCount / changedFunctions.length : 0;

    // Factor 3: Complexity (0.20)
    const avgSize =
        changedNodes.length > 0
            ? changedNodes.reduce((s, n) => s + (n.line_end - n.line_start), 0) / changedNodes.length
            : 0;
    const cxValue = Math.min(avgSize / 50, 1); // cap at 50 lines

    // Factor 4: Inheritance (0.15)
    const hasInheritance = graph.edges.some(
        (e) => (e.kind === 'INHERITS' || e.kind === 'IMPLEMENTS') && changedSet.has(e.file_path),
    );
    const ihValue = hasInheritance ? 1 : 0;

    const score = brValue * 0.35 + tgValue * 0.3 + cxValue * 0.2 + ihValue * 0.15;
    const level = score >= 0.6 ? 'HIGH' : score >= 0.3 ? 'MEDIUM' : 'LOW';

    return {
        level,
        score: Math.round(score * 100) / 100,
        factors: {
            blast_radius: {
                weight: 0.35,
                value: Math.round(brValue * 100) / 100,
                detail: `${blastRadius.total_functions} functions, ${blastRadius.total_files} files`,
            },
            test_gaps: {
                weight: 0.3,
                value: Math.round(tgValue * 100) / 100,
                detail: `${untestedCount}/${changedFunctions.length} untested`,
            },
            complexity: {
                weight: 0.2,
                value: Math.round(cxValue * 100) / 100,
                detail: `avg ${Math.round(avgSize)} lines`,
            },
            inheritance: {
                weight: 0.15,
                value: ihValue,
                detail: hasInheritance ? 'has inheritance' : 'no inheritance',
            },
        },
    };
}

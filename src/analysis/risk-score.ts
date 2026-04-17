import type { BlastRadiusResult, GraphData, RiskScoreResult } from '../graph/types';
import { DEFAULT_RISK_CONFIG, type RiskConfig, validateRiskConfig } from './risk-config';

export function computeRiskScore(
    graph: GraphData,
    changedFiles: string[],
    blastRadius: BlastRadiusResult,
    options?: { skipTests?: boolean; riskConfig?: RiskConfig },
): RiskScoreResult {
    const cfg = options?.riskConfig ?? DEFAULT_RISK_CONFIG;
    validateRiskConfig(cfg);
    const { weights, caps } = cfg;

    const changedSet = new Set(changedFiles);
    const changedNodes = graph.nodes.filter((n) => changedSet.has(n.file_path) && !n.is_test);

    // Factor 1: Blast radius
    const brValue = Math.min(blastRadius.total_functions / caps.blast_functions, 1);

    // Factor 2: Test gaps
    let tgValue = 0;
    let untestedCount = 0;
    const changedFunctions = changedNodes.filter((n) => n.kind === 'Function' || n.kind === 'Method');
    if (!options?.skipTests) {
        const testedFiles = new Set(graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.file_path));
        untestedCount = changedFunctions.filter((n) => !testedFiles.has(n.file_path)).length;
        tgValue = changedFunctions.length > 0 ? untestedCount / changedFunctions.length : 0;
    }

    // Factor 3: Complexity (Task 5 will swap this to cyclomatic; kept as lines for this task)
    const avgSize =
        changedNodes.length > 0
            ? changedNodes.reduce((s, n) => s + (n.line_end - n.line_start), 0) / changedNodes.length
            : 0;
    const cxValue = Math.min(avgSize / caps.complexity, 1);

    // Factor 4: Inheritance
    const hasInheritance = graph.edges.some(
        (e) => (e.kind === 'INHERITS' || e.kind === 'IMPLEMENTS') && changedSet.has(e.file_path),
    );
    const ihValue = hasInheritance ? 1 : 0;

    const score =
        brValue * weights.blast_radius +
        tgValue * weights.test_gaps +
        cxValue * weights.complexity +
        ihValue * weights.inheritance;
    const level = score >= 0.6 ? 'HIGH' : score >= 0.3 ? 'MEDIUM' : 'LOW';

    return {
        level,
        score: Math.round(score * 100) / 100,
        factors: {
            blast_radius: {
                weight: weights.blast_radius,
                value: Math.round(brValue * 100) / 100,
                detail: `${blastRadius.total_functions} functions, ${blastRadius.total_files} files`,
            },
            test_gaps: {
                weight: weights.test_gaps,
                value: Math.round(tgValue * 100) / 100,
                detail: `${untestedCount}/${changedFunctions.length} untested`,
            },
            complexity: {
                weight: weights.complexity,
                value: Math.round(cxValue * 100) / 100,
                detail: `avg ${Math.round(avgSize)} lines`,
            },
            inheritance: {
                weight: weights.inheritance,
                value: ihValue,
                detail: hasInheritance ? 'has inheritance' : 'no inheritance',
            },
        },
    };
}

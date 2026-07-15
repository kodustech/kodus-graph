import type { BlastRadiusResult, GraphData, GraphNode, RiskScoreResult } from '../graph/types';
import { GraphIndex } from './graph-index';
import { DEFAULT_RISK_CONFIG, type RiskConfig, validateRiskConfig } from './risk-config';

export function computeRiskScore(
    graph: GraphData,
    changedFiles: string[],
    blastRadius: BlastRadiusResult,
    options?: { skipTests?: boolean; riskConfig?: RiskConfig; index?: GraphIndex },
): RiskScoreResult {
    const cfg = options?.riskConfig ?? DEFAULT_RISK_CONFIG;
    validateRiskConfig(cfg);
    const { weights, caps } = cfg;

    const idx = options?.index ?? new GraphIndex(graph);

    const changedSet = new Set(changedFiles);
    const changedNodes: GraphNode[] = [];
    for (const file of changedSet) {
        for (const node of idx.nodesByFile(file)) {
            if (!node.is_test) {
                changedNodes.push(node);
            }
        }
    }

    // Factor 1: Blast radius
    const brValue = Math.min(blastRadius.total_functions / caps.blast_functions, 1);

    // Factor 2: Test gaps
    let tgValue = 0;
    let untestedCount = 0;
    const changedFunctions = changedNodes.filter((n) => n.kind === 'Function' || n.kind === 'Method');
    if (!options?.skipTests) {
        const testedFiles = idx.testedFiles;
        untestedCount = changedFunctions.filter((n) => !testedFiles.has(n.file_path)).length;
        tgValue = changedFunctions.length > 0 ? untestedCount / changedFunctions.length : 0;
    }

    // Factor 3: Complexity — prefer cyclomatic when nodes have it, fall back to
    // LoC for legacy graphs. The two are different units and normalize against
    // their own caps; sharing one cap left the cyclomatic path (the default)
    // divided by a lines-of-code figure and effectively disabled.
    const nodesWithComplexity = changedNodes.filter((n) => typeof n.complexity === 'number');
    let cxValue: number;
    let cxDetail: string;
    if (nodesWithComplexity.length > 0) {
        const avgCx = nodesWithComplexity.reduce((s, n) => s + (n.complexity ?? 0), 0) / nodesWithComplexity.length;
        cxValue = Math.min(avgCx / caps.cyclomatic, 1);
        cxDetail = `avg cyclomatic ${Math.round(avgCx)}`;
    } else {
        const avgSize =
            changedNodes.length > 0
                ? changedNodes.reduce((s, n) => s + (n.line_end - n.line_start), 0) / changedNodes.length
                : 0;
        cxValue = Math.min(avgSize / caps.lines_of_code, 1);
        cxDetail = `avg ${Math.round(avgSize)} lines (legacy)`;
    }

    // Factor 4: Inheritance
    const hasInheritance = idx.hasInheritanceInFiles(changedSet);
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
                detail: cxDetail,
            },
            inheritance: {
                weight: weights.inheritance,
                value: ihValue,
                detail: hasInheritance ? 'has inheritance' : 'no inheritance',
            },
        },
    };
}

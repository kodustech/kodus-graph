import type { GraphData, TestGap } from '../graph/types';
import { GraphIndex } from './graph-index';

/**
 * Enumerate each changed, untested function/method as a {@link TestGap}.
 *
 * "Untested" is decided by `GraphIndex.isTested`, the same predicate
 * `computeRiskScore` uses for its `test_gaps` factor. Keeping both on one
 * definition guarantees the detail string ("N/M untested") matches
 * `AnalysisOutput.test_gaps.length` — consumers can trust either one.
 */
export function findTestGaps(graph: GraphData, changedFiles: string[], index?: GraphIndex): TestGap[] {
    const changedSet = new Set(changedFiles);
    const idx = index ?? new GraphIndex(graph);

    return graph.nodes
        .filter(
            (n) =>
                changedSet.has(n.file_path) &&
                (n.kind === 'Function' || n.kind === 'Method') &&
                !n.is_test &&
                !idx.isTested(n.qualified_name, n.file_path),
        )
        .map((n) => ({
            function: n.qualified_name,
            file_path: n.file_path,
            line_start: n.line_start,
        }));
}

import type { GraphData, TestGap } from '../graph/types';
import { GraphIndex } from './graph-index';

/**
 * Enumerate each changed, untested function/method as a {@link TestGap}.
 *
 * "Untested" is determined by the same set of SOURCE files that
 * `computeRiskScore` uses for its `test_gaps` factor (see
 * `GraphIndex.testedFiles`). Keeping both in sync guarantees that the
 * detail string ("N/M untested") matches `AnalysisOutput.test_gaps.length`
 * — consumers can trust either one.
 */
export function findTestGaps(graph: GraphData, changedFiles: string[], index?: GraphIndex): TestGap[] {
    const changedSet = new Set(changedFiles);
    const idx = index ?? new GraphIndex(graph);
    const testedFiles = idx.testedFiles;

    return graph.nodes
        .filter(
            (n) =>
                changedSet.has(n.file_path) &&
                (n.kind === 'Function' || n.kind === 'Method') &&
                !n.is_test &&
                !testedFiles.has(n.file_path),
        )
        .map((n) => ({
            function: n.qualified_name,
            file_path: n.file_path,
            line_start: n.line_start,
        }));
}

import type { GraphData, TestGap } from '../graph/types';

export function findTestGaps(graph: GraphData, changedFiles: string[]): TestGap[] {
    const changedSet = new Set(changedFiles);

    // source_qualified on TESTED_BY edges is the tested function/file, e.g.
    // 'src/auth.ts::authenticate' or just 'src/auth.ts'. Extract the file path
    // prefix (before '::') to match against node.file_path.
    const testedFiles = new Set(
        graph.edges.filter((e) => e.kind === 'TESTED_BY').map((e) => e.source_qualified.split('::')[0]),
    );

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

import type { EdgeKind, GraphData, GraphEdge, GraphNode } from '../graph/types';

/**
 * Pre-computed graph indexes for O(1) / O(k) lookups during analysis.
 *
 * Build ONCE per analyze/context run; pass to `computeRiskScore`,
 * `computeBlastRadius`, and other analysis functions so they don't each
 * linear-scan `GraphData.nodes` / `GraphData.edges`.
 *
 * Example:
 * ```typescript
 * const index = new GraphIndex(graph);
 * const blast = computeBlastRadius(graph, changedFiles, maxDepth, minConf, cb, { index });
 * const risk = computeRiskScore(graph, changedFiles, blast, { index });
 * ```
 */
export class GraphIndex {
    private readonly byFile: Map<string, GraphNode[]>;
    private readonly byQualified: Map<string, GraphNode>;
    private readonly byEdgeKind: Map<EdgeKind, GraphEdge[]>;
    /**
     * Set of SOURCE file paths that have at least one TESTED_BY edge, i.e.
     * files that contain a tested function/class. Derived from
     * `edge.source_qualified` (the tested entity) rather than
     * `edge.file_path` (which points at the test file). This matches the
     * semantics used by `findTestGaps` — both risk-score's `test_gaps`
     * factor and the analysis-level `test_gaps[]` array now consume the
     * same set, so the detail string ("N/M untested") and the array
     * length stay in sync.
     */
    public readonly testedFiles: ReadonlySet<string>;

    constructor(public readonly graph: GraphData) {
        this.byFile = new Map();
        this.byQualified = new Map();
        this.byEdgeKind = new Map();

        for (const node of graph.nodes) {
            const arr = this.byFile.get(node.file_path);
            if (arr) {
                arr.push(node);
            } else {
                this.byFile.set(node.file_path, [node]);
            }
            this.byQualified.set(node.qualified_name, node);
        }

        const tested = new Set<string>();
        for (const edge of graph.edges) {
            const arr = this.byEdgeKind.get(edge.kind);
            if (arr) {
                arr.push(edge);
            } else {
                this.byEdgeKind.set(edge.kind, [edge]);
            }
            if (edge.kind === 'TESTED_BY') {
                // `source_qualified` is the tested function/file (e.g.
                // `src/auth.ts::authenticate` or `src/auth.ts`); extract the
                // file prefix. `edge.file_path` would be wrong here — on
                // TESTED_BY it points at the test file, not the tested file.
                tested.add(edge.source_qualified.split('::')[0]);
            }
        }
        this.testedFiles = tested;
    }

    nodesByFile(file: string): readonly GraphNode[] {
        return this.byFile.get(file) ?? [];
    }

    nodeByQualified(qualified: string): GraphNode | undefined {
        return this.byQualified.get(qualified);
    }

    edgesByKind(kind: EdgeKind): readonly GraphEdge[] {
        return this.byEdgeKind.get(kind) ?? [];
    }

    hasInheritanceInFiles(files: ReadonlySet<string>): boolean {
        for (const edge of this.edgesByKind('INHERITS')) {
            if (files.has(edge.file_path)) {
                return true;
            }
        }
        for (const edge of this.edgesByKind('IMPLEMENTS')) {
            if (files.has(edge.file_path)) {
                return true;
            }
        }
        return false;
    }
}

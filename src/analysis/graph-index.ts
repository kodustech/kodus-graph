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
                tested.add(edge.file_path);
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

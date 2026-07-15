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
     * Qualified names a test demonstrably calls — the precise signal.
     *
     * Populated from symbol-level TESTED_BY edges, which `deriveEdges` emits
     * from resolved calls out of test files.
     */
    public readonly testedFunctions: ReadonlySet<string>;

    /**
     * Files covered only by the coarse fallback: file-level TESTED_BY, emitted
     * by filename matching for languages whose test calls don't resolve.
     *
     * Deliberately NOT populated from symbol-level edges. Flattening
     * `src/auth.ts::authenticate` to `src/auth.ts` was the old behaviour, and it
     * meant one tested function vouched for every function beside it — a test
     * importing a single constant reported "0/3 untested" across three untested
     * functions. Consumers should ask `testedFunctions` first and fall back here
     * only for files with no symbol-level evidence at all.
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

        const testedFns = new Set<string>();
        const testedAtFileLevel = new Set<string>();
        for (const edge of graph.edges) {
            const arr = this.byEdgeKind.get(edge.kind);
            if (arr) {
                arr.push(edge);
            } else {
                this.byEdgeKind.set(edge.kind, [edge]);
            }
            if (edge.kind === 'TESTED_BY') {
                // `source_qualified` is the tested entity — a symbol
                // (`src/auth.ts::authenticate`) from call evidence, or a bare
                // file (`src/auth.ts`) from the filename fallback. The two carry
                // different weight, so keep them apart. (`edge.file_path` is no
                // help either way: on TESTED_BY it points at the test file.)
                if (edge.source_qualified.includes('::')) {
                    testedFns.add(edge.source_qualified);
                } else {
                    testedAtFileLevel.add(edge.source_qualified);
                }
            }
        }
        this.testedFunctions = testedFns;
        this.testedFiles = testedAtFileLevel;
    }

    /**
     * Is this symbol exercised by a test?
     *
     * Symbol-level call evidence answers directly. The file-level fallback only
     * applies to languages whose test calls we could not resolve, where a bare
     * filename match is all there is — it never carries symbol-level edges, so
     * consulting it cannot let one tested function vouch for its neighbours.
     */
    isTested(qualifiedName: string, filePath: string): boolean {
        return this.testedFunctions.has(qualifiedName) || this.testedFiles.has(filePath);
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

    /**
     * Every symbol that participates in a hierarchy, as the source of an
     * INHERITS or IMPLEMENTS edge.
     */
    private hierarchySources(): Set<string> {
        const set = new Set<string>();
        for (const edge of this.edgesByKind('INHERITS')) {
            set.add(edge.source_qualified);
        }
        for (const edge of this.edgesByKind('IMPLEMENTS')) {
            set.add(edge.source_qualified);
        }
        return set;
    }

    /**
     * What share of these symbols sits in a class hierarchy, in [0, 1].
     *
     * A symbol counts if it extends/implements something itself, or if it is a
     * method on a class that does — `a.ts::Repo.save` inherits the risk of
     * `a.ts::Repo extends Base`, since an override elsewhere can change what the
     * call actually runs.
     *
     * Replaces a file-scoped boolean: the inheritance factor used to award its
     * full 0.15 whenever ANY inheritance edge existed in ANY changed file, so
     * fixing a typo in a comment beside one `class X implements Y` scored the
     * same as reworking the hierarchy. It was the cheapest factor to trip and
     * carried no information.
     */
    hierarchyShare(nodes: readonly GraphNode[]): number {
        if (nodes.length === 0) {
            return 0;
        }
        const inHierarchy = this.hierarchySources();
        let count = 0;
        for (const node of nodes) {
            if (inHierarchy.has(node.qualified_name)) {
                count++;
                continue;
            }
            // `file.ts::Class.method` → owning class `file.ts::Class`.
            const sep = node.qualified_name.indexOf('::');
            if (sep < 0) {
                continue;
            }
            const local = node.qualified_name.slice(sep + 2);
            const dot = local.lastIndexOf('.');
            if (dot < 0) {
                continue;
            }
            const owner = `${node.qualified_name.slice(0, sep + 2)}${local.slice(0, dot)}`;
            if (inHierarchy.has(owner)) {
                count++;
            }
        }
        return count / nodes.length;
    }
}

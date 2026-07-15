import { describe, expect, it } from 'bun:test';
import { GraphIndex } from '../../src/analysis/graph-index';
import type { GraphData } from '../../src/graph/types';

const graph: GraphData = {
    nodes: [
        {
            kind: 'Function',
            name: 'a',
            qualified_name: 'f1.ts::a',
            file_path: 'f1.ts',
            line_start: 1,
            line_end: 5,
            language: 'TypeScript',
            is_test: false,
        },
        {
            kind: 'Function',
            name: 'b',
            qualified_name: 'f2.ts::b',
            file_path: 'f2.ts',
            line_start: 1,
            line_end: 5,
            language: 'TypeScript',
            is_test: false,
        },
        {
            kind: 'Function',
            name: 't',
            qualified_name: 'f1.test.ts::t',
            file_path: 'f1.test.ts',
            line_start: 1,
            line_end: 5,
            language: 'TypeScript',
            is_test: true,
        },
    ],
    edges: [
        { kind: 'CALLS', source_qualified: 'f1.ts::a', target_qualified: 'f2.ts::b', file_path: 'f1.ts', line: 3 },
        { kind: 'TESTED_BY', source_qualified: 'f1.ts', target_qualified: 'f1.test.ts', file_path: 'f1.ts', line: 0 },
        {
            kind: 'INHERITS',
            source_qualified: 'f1.ts::Child',
            target_qualified: 'f2.ts::Parent',
            file_path: 'f1.ts',
            line: 1,
        },
    ],
};

describe('GraphIndex', () => {
    it('nodesByFile groups nodes by file path', () => {
        const idx = new GraphIndex(graph);
        expect(idx.nodesByFile('f1.ts')).toHaveLength(1);
        expect(idx.nodesByFile('f1.ts')[0].name).toBe('a');
        expect(idx.nodesByFile('nonexistent.ts')).toEqual([]);
    });

    it('edgesByKind returns all edges of a given kind', () => {
        const idx = new GraphIndex(graph);
        expect(idx.edgesByKind('CALLS')).toHaveLength(1);
        expect(idx.edgesByKind('TESTED_BY')).toHaveLength(1);
        expect(idx.edgesByKind('CONTAINS')).toEqual([]);
    });

    it('nodeByQualified returns O(1) node lookup', () => {
        const idx = new GraphIndex(graph);
        expect(idx.nodeByQualified('f1.ts::a')?.name).toBe('a');
        expect(idx.nodeByQualified('nonexistent')).toBeUndefined();
    });

    it('testedFiles holds file-level TESTED_BY only; symbol-level lives in testedFunctions', () => {
        const idx = new GraphIndex(graph);
        // `f1.ts` is covered by the coarse filename fallback (a bare file source).
        expect(idx.testedFiles.has('f1.ts')).toBe(true);
        expect(idx.testedFiles.has('f2.ts')).toBe(false);

        // Splitting `::` off every edge would fold symbol-level evidence into
        // this set, letting one tested function vouch for its whole file.
        const withSymbolEvidence = new GraphIndex({
            ...graph,
            edges: [
                {
                    kind: 'TESTED_BY',
                    source_qualified: 'f2.ts::b',
                    target_qualified: 'f1.test.ts',
                    file_path: 'f2.ts',
                    line: 0,
                },
            ],
        });
        expect(withSymbolEvidence.testedFunctions.has('f2.ts::b')).toBe(true);
        expect(withSymbolEvidence.testedFiles.has('f2.ts')).toBe(false);
    });

    it('isTested answers from symbol evidence, falling back to the file-level signal', () => {
        const idx = new GraphIndex(graph);
        // f1.ts has only file-level coverage — every symbol in it inherits that.
        expect(idx.isTested('f1.ts::a', 'f1.ts')).toBe(true);
        expect(idx.isTested('f2.ts::b', 'f2.ts')).toBe(false);
    });

    it('hierarchyShare is the fraction of symbols sitting in a hierarchy', () => {
        const idx = new GraphIndex(graph);
        const child = { qualified_name: 'f1.ts::Child', file_path: 'f1.ts' } as GraphData['nodes'][number];
        const plain = { qualified_name: 'f1.ts::a', file_path: 'f1.ts' } as GraphData['nodes'][number];
        const method = { qualified_name: 'f1.ts::Child.run', file_path: 'f1.ts' } as GraphData['nodes'][number];

        // Replaces a file-scoped boolean that awarded full weight whenever ANY
        // inheritance edge existed in a changed file — so touching `a`, which is
        // in no hierarchy, scored the same as reworking `Child`.
        expect(idx.hierarchyShare([child])).toBe(1);
        expect(idx.hierarchyShare([plain])).toBe(0);
        expect(idx.hierarchyShare([child, plain])).toBe(0.5);
        // A method counts through its owning class.
        expect(idx.hierarchyShare([method])).toBe(1);
        expect(idx.hierarchyShare([])).toBe(0);
    });

    it('exposes the underlying graph read-only', () => {
        const idx = new GraphIndex(graph);
        expect(idx.graph.nodes.length).toBe(3);
        expect(idx.graph.edges.length).toBe(3);
    });
});

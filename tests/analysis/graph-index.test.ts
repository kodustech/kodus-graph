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

    it('testedFiles is the set of source files with TESTED_BY edges', () => {
        const idx = new GraphIndex(graph);
        expect(idx.testedFiles.has('f1.ts')).toBe(true);
        expect(idx.testedFiles.has('f2.ts')).toBe(false);
    });

    it('hasInheritanceInFiles returns true when any INHERITS/IMPLEMENTS edge is in the set', () => {
        const idx = new GraphIndex(graph);
        expect(idx.hasInheritanceInFiles(new Set(['f1.ts']))).toBe(true);
        expect(idx.hasInheritanceInFiles(new Set(['f2.ts']))).toBe(false);
    });

    it('exposes the underlying graph read-only', () => {
        const idx = new GraphIndex(graph);
        expect(idx.graph.nodes.length).toBe(3);
        expect(idx.graph.edges.length).toBe(3);
    });
});

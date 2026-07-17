import { describe, expect, it } from 'bun:test';
import { computePrOverlap, symbolsInFiles } from '../../src/analysis/pr-overlap';
import type { GraphData } from '../../src/graph/types';

function fn(name: string, file: string): GraphData['nodes'][number] {
    return {
        kind: 'Function',
        name,
        qualified_name: `${file}::${name}`,
        file_path: file,
        line_start: 1,
        line_end: 5,
        language: 'typescript',
        is_test: false,
    };
}

// caller() calls base(); shared() stands alone; lonelyA/lonelyB are unrelated.
const graph: GraphData = {
    nodes: [
        fn('base', 'base.ts'),
        fn('caller', 'caller.ts'),
        fn('shared', 'shared.ts'),
        fn('lonelyA', 'a.ts'),
        fn('lonelyB', 'b.ts'),
    ],
    edges: [
        {
            kind: 'CALLS',
            source_qualified: 'caller.ts::caller',
            target_qualified: 'base.ts::base',
            file_path: 'caller.ts',
            line: 2,
            confidence: 0.9,
        },
    ],
};

describe('computePrOverlap', () => {
    it('flags HIGH when both PRs modify the same symbol', () => {
        const r = computePrOverlap(graph, {
            changedA: ['shared.ts::shared', 'a.ts::lonelyA'],
            changedB: ['shared.ts::shared'],
        });
        expect(r.level).toBe('HIGH');
        expect(r.shared_changed).toEqual(['shared.ts::shared']);
    });

    it('flags MEDIUM when one PR changes what the other PR depends on', () => {
        // PR A changes base(); PR B changes caller(), which calls base(). A's
        // blast radius reaches caller — they pass review apart, break together.
        const r = computePrOverlap(graph, {
            changedA: ['base.ts::base'],
            changedB: ['caller.ts::caller'],
        });
        expect(r.level).toBe('MEDIUM');
        expect(r.a_impacts_b).toContain('caller.ts::caller');
        expect(r.shared_changed).toEqual([]);
    });

    it('flags LOW/isolated when the changesets do not touch or reach each other', () => {
        const r = computePrOverlap(graph, {
            changedA: ['a.ts::lonelyA'],
            changedB: ['b.ts::lonelyB'],
        });
        expect(r.level).toBe('LOW');
        expect(r.shared_changed).toEqual([]);
        expect(r.a_impacts_b).toEqual([]);
        expect(r.b_impacts_a).toEqual([]);
    });

    it('reports per-PR changed and blast-radius counts', () => {
        const r = computePrOverlap(graph, {
            changedA: ['base.ts::base'],
            changedB: ['caller.ts::caller'],
        });
        expect(r.a.changed).toBe(1);
        expect(r.a.blast_radius).toBeGreaterThanOrEqual(1); // reaches caller
        expect(r.b.changed).toBe(1);
    });

    it('symbolsInFiles expands changed files to the symbols they declare', () => {
        expect(symbolsInFiles(graph, ['base.ts']).sort()).toEqual(['base.ts::base']);
        expect(symbolsInFiles(graph, ['nope.ts'])).toEqual([]);
    });
});

import { describe, expect, it } from 'bun:test';
import { computeSubsystemContext } from '../../src/analysis/subsystem-context';
import { indexGraph } from '../../src/graph/loader';
import type { GraphData } from '../../src/graph/types';

// Two dense triangles joined through `glue`: a1 calls glue, glue calls b1.
function twoClusterGraph(): GraphData {
    const fn = (name: string, file: string): GraphData['nodes'][number] => ({
        kind: 'Function',
        name,
        qualified_name: `${file}::${name}`,
        file_path: file,
        line_start: 1,
        line_end: 2,
        language: 'typescript',
        is_test: false,
    });
    const call = (from: string, to: string): GraphData['edges'][number] => ({
        kind: 'CALLS',
        source_qualified: from,
        target_qualified: to,
        file_path: from.split('::')[0],
        line: 1,
    });
    return {
        nodes: [
            fn('a1', 'a.ts'),
            fn('a2', 'a.ts'),
            fn('a3', 'a.ts'),
            fn('b1', 'b.ts'),
            fn('b2', 'b.ts'),
            fn('b3', 'b.ts'),
            fn('glue', 'glue.ts'),
        ],
        edges: [
            call('a.ts::a1', 'a.ts::a2'),
            call('a.ts::a2', 'a.ts::a3'),
            call('a.ts::a3', 'a.ts::a1'),
            call('b.ts::b1', 'b.ts::b2'),
            call('b.ts::b2', 'b.ts::b3'),
            call('b.ts::b3', 'b.ts::b1'),
            call('a.ts::a1', 'glue.ts::glue'),
            call('glue.ts::glue', 'b.ts::b1'),
        ],
    };
}

describe('computeSubsystemContext', () => {
    it('places the change in a module and flags glue as a bridge', () => {
        const graph = indexGraph(twoClusterGraph());
        const ctx = computeSubsystemContext(graph, { changed: ['glue.ts::glue'] });

        // glue lands in a detected subsystem, and that subsystem records glue as
        // one of its changed symbols.
        expect(ctx.subsystems.length).toBeGreaterThan(0);
        expect(ctx.subsystems.some((s) => s.changed_here.includes('glue.ts::glue'))).toBe(true);

        // glue bridges the two clusters — the review should be told.
        expect(ctx.bridges_touched).toContain('glue.ts::glue');
    });

    it('reports the immediate caller/callee neighbourhood over CALLS', () => {
        const graph = indexGraph(twoClusterGraph());
        const ctx = computeSubsystemContext(graph, { changed: ['glue.ts::glue'] });

        // a1 calls glue; glue calls b1. Neither is in the changeset, so both show
        // up as the surrounding code.
        expect(ctx.callers).toContain('a.ts::a1');
        expect(ctx.callees).toContain('b.ts::b1');
    });

    it('excludes the changed symbols themselves from the neighbourhood', () => {
        const graph = indexGraph(twoClusterGraph());
        // Change both glue and its caller a1: a1 must no longer appear as a caller.
        const ctx = computeSubsystemContext(graph, { changed: ['glue.ts::glue', 'a.ts::a1'] });
        expect(ctx.callers).not.toContain('a.ts::a1');
        expect(ctx.changed).toEqual(['a.ts::a1', 'glue.ts::glue']);
    });
});

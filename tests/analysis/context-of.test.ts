import { describe, expect, it } from 'bun:test';
import { computeContextOf } from '../../src/analysis/context-of';
import { indexGraph } from '../../src/graph/loader';
import type { GraphData } from '../../src/graph/types';

function fn(name: string, file: string, extra: Partial<GraphData['nodes'][number]> = {}): GraphData['nodes'][number] {
    return {
        kind: 'Function',
        name,
        qualified_name: `${file}::${name}`,
        file_path: file,
        line_start: 1,
        line_end: 5,
        language: 'typescript',
        is_test: false,
        ...extra,
    };
}

const graph: GraphData = {
    nodes: [
        fn('handler', 'h.ts', { params: '(req: Request)', return_type: 'Response' }),
        fn('service', 's.ts'),
        fn('repo', 'r.ts'),
        fn('caller', 'c.ts'),
    ],
    edges: [
        {
            kind: 'CALLS',
            source_qualified: 'c.ts::caller',
            target_qualified: 'h.ts::handler',
            file_path: 'c.ts',
            line: 3,
        },
        {
            kind: 'CALLS',
            source_qualified: 'h.ts::handler',
            target_qualified: 's.ts::service',
            file_path: 'h.ts',
            line: 4,
        },
        {
            kind: 'CALLS',
            source_qualified: 'h.ts::handler',
            target_qualified: 'r.ts::repo',
            file_path: 'h.ts',
            line: 5,
        },
        {
            kind: 'TESTED_BY',
            source_qualified: 'h.ts::handler',
            target_qualified: 'h.test.ts',
            file_path: 'h.ts',
            line: 0,
        },
    ],
};

describe('computeContextOf', () => {
    it('returns the callers, callees, and tests of a symbol in one query', () => {
        const ctx = computeContextOf(indexGraph(graph), { symbol: 'h.ts::handler' });
        expect(ctx.found).toBe(true);
        expect(ctx.callers.map((c) => c.qualified_name)).toEqual(['c.ts::caller']);
        expect(ctx.callees.map((c) => c.qualified_name).sort()).toEqual(['r.ts::repo', 's.ts::service']);
        expect(ctx.tested_by).toEqual(['h.test.ts']);
    });

    it('exposes the symbol signature and location', () => {
        const ctx = computeContextOf(indexGraph(graph), { symbol: 'h.ts::handler' });
        expect(ctx.symbol?.file).toBe('h.ts');
        expect(ctx.symbol?.signature).toBe('handler(req: Request) -> Response');
    });

    it('reports found=false for an unknown symbol', () => {
        const ctx = computeContextOf(indexGraph(graph), { symbol: 'nope.ts::nope' });
        expect(ctx.found).toBe(false);
        expect(ctx.callers).toEqual([]);
    });

    it('truncates neighbour lists to the limit', () => {
        const many: GraphData = {
            nodes: [fn('hot', 'hot.ts'), ...Array.from({ length: 5 }, (_, i) => fn(`c${i}`, `c${i}.ts`))],
            edges: Array.from({ length: 5 }, (_, i) => ({
                kind: 'CALLS' as const,
                source_qualified: `c${i}.ts::c${i}`,
                target_qualified: 'hot.ts::hot',
                file_path: `c${i}.ts`,
                line: 1,
            })),
        };
        const ctx = computeContextOf(indexGraph(many), { symbol: 'hot.ts::hot', limit: 2 });
        expect(ctx.callers.length).toBe(2);
        expect(ctx.truncated).toBe(true);
    });
});

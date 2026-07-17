import { describe, expect, it } from 'bun:test';
import { computeRanking } from '../../src/analysis/ranking';
import { indexGraph } from '../../src/graph/loader';
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

// Everyone calls `core`; `leaf` calls nothing and nothing calls it.
const graph: GraphData = {
    nodes: [fn('core', 'core.ts'), fn('a', 'a.ts'), fn('b', 'b.ts'), fn('c', 'c.ts'), fn('leaf', 'leaf.ts')],
    edges: [
        { kind: 'CALLS', source_qualified: 'a.ts::a', target_qualified: 'core.ts::core', file_path: 'a.ts', line: 1 },
        { kind: 'CALLS', source_qualified: 'b.ts::b', target_qualified: 'core.ts::core', file_path: 'b.ts', line: 1 },
        { kind: 'CALLS', source_qualified: 'c.ts::c', target_qualified: 'core.ts::core', file_path: 'c.ts', line: 1 },
    ],
};

describe('computeRanking', () => {
    it('ranks the most depended-on symbol first', () => {
        const ranked = computeRanking(indexGraph(graph), {});
        expect(ranked[0].qualified_name).toBe('core.ts::core');
        expect(ranked[0].in_degree).toBe(3);
        expect(ranked[0].out_degree).toBe(0);
    });

    it('excludes unconnected symbols', () => {
        const ranked = computeRanking(indexGraph(graph), {});
        expect(ranked.map((r) => r.qualified_name)).not.toContain('leaf.ts::leaf');
    });

    it('respects the file filter', () => {
        const ranked = computeRanking(indexGraph(graph), { file: 'a.ts' });
        expect(ranked.map((r) => r.qualified_name)).toEqual(['a.ts::a']);
    });

    it('honours the top limit', () => {
        const ranked = computeRanking(indexGraph(graph), { top: 2 });
        expect(ranked.length).toBe(2);
    });
});

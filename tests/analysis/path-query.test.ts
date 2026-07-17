import { describe, expect, it } from 'bun:test';
import { computePath } from '../../src/analysis/path-query';
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

const call = (from: string, to: string): GraphData['edges'][number] => ({
    kind: 'CALLS',
    source_qualified: from,
    target_qualified: to,
    file_path: from.split('::')[0],
    line: 1,
});

// handler → service → repo → db; plus an unrelated island.
const graph: GraphData = {
    nodes: [fn('handler', 'h.ts'), fn('service', 's.ts'), fn('repo', 'r.ts'), fn('db', 'd.ts'), fn('island', 'i.ts')],
    edges: [
        call('h.ts::handler', 's.ts::service'),
        call('s.ts::service', 'r.ts::repo'),
        call('r.ts::repo', 'd.ts::db'),
    ],
};

describe('computePath', () => {
    it('finds the shortest call path between two symbols', () => {
        const r = computePath(indexGraph(graph), { from: 'h.ts::handler', to: 'd.ts::db' });
        expect(r.found).toBe(true);
        expect(r.length).toBe(3);
        expect(r.path.map((s) => s.qualified_name)).toEqual([
            'h.ts::handler',
            's.ts::service',
            'r.ts::repo',
            'd.ts::db',
        ]);
        // Every hop but the origin records the edge it was reached by.
        expect(r.path[0].via).toBeUndefined();
        expect(r.path.slice(1).every((s) => s.via === 'CALLS')).toBe(true);
    });

    it('returns not found when no path exists', () => {
        const r = computePath(indexGraph(graph), { from: 'h.ts::handler', to: 'i.ts::island' });
        expect(r.found).toBe(false);
        expect(r.path).toEqual([]);
    });

    it('respects the direction of edges (db does not reach handler)', () => {
        const r = computePath(indexGraph(graph), { from: 'd.ts::db', to: 'h.ts::handler' });
        expect(r.found).toBe(false);
    });

    it('gives up past maxDepth', () => {
        const r = computePath(indexGraph(graph), { from: 'h.ts::handler', to: 'd.ts::db', maxDepth: 2 });
        expect(r.found).toBe(false); // db is 3 hops away
    });

    it('returns a zero-length path when from === to', () => {
        const r = computePath(indexGraph(graph), { from: 'h.ts::handler', to: 'h.ts::handler' });
        expect(r.found).toBe(true);
        expect(r.length).toBe(0);
    });
});

import { describe, expect, it } from 'bun:test';
import { detectTopologicalCommunities } from '../../src/analysis/topological-communities';
import { indexGraph } from '../../src/graph/loader';
import type { GraphData } from '../../src/graph/types';

/**
 * Two dense triangles (a1/a2/a3 and b1/b2/b3), joined only through `glue`, which
 * a1 calls and which in turn calls b1. Directory grouping would file `glue` on
 * its own; topology puts it with whichever cluster pulls hardest and — the point
 * of the feature — flags it as the bridge between the two.
 */
function twoClusterGraph(): GraphData {
    const fn = (name: string, file: string): GraphData['nodes'][number] => ({
        kind: 'Function',
        name,
        qualified_name: `${file}::${name}`,
        file_path: file,
        line_start: 1,
        line_end: 2,
        language: 'TypeScript',
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

describe('detectTopologicalCommunities', () => {
    it('separates two densely-connected clusters by topology, not directory', () => {
        const idx = indexGraph(twoClusterGraph());
        const result = detectTopologicalCommunities(idx, { minSize: 2, topN: 10 });

        expect(result.summary.total_communities).toBe(2);
        // A partition this clean scores well above the 0.3 "meaningful structure"
        // threshold; a directory split would not be measured this way at all.
        expect(result.modularity).toBeGreaterThan(0.3);

        // The three b-functions must all land in the same community, distinct
        // from the a-cluster's.
        const commOf = (q: string) => result.communities.find((c) => c.nodes.includes(q))?.id;
        expect(commOf('b.ts::b1')).toBe(commOf('b.ts::b2'));
        expect(commOf('b.ts::b1')).toBe(commOf('b.ts::b3'));
        expect(commOf('a.ts::a1')).not.toBe(commOf('b.ts::b1'));
    });

    it('flags glue as a bridge — its neighbors span another community', () => {
        const idx = indexGraph(twoClusterGraph());
        const result = detectTopologicalCommunities(idx, { minSize: 2, topN: 10 });

        const bridgeNames = result.bridges.map((b) => b.qualified_name);
        expect(bridgeNames).toContain('glue.ts::glue');
        // Every reported bridge touches at least one foreign community.
        for (const b of result.bridges) {
            expect(b.connects).toBeGreaterThanOrEqual(1);
        }
    });

    it('ranks the most-connected nodes as hubs, highest degree first', () => {
        const idx = indexGraph(twoClusterGraph());
        const result = detectTopologicalCommunities(idx, { minSize: 2, topN: 10 });

        expect(result.hubs.length).toBeGreaterThan(0);
        // a1 and b1 carry three structural edges each — the max in this graph.
        expect(result.hubs[0].degree).toBe(3);
        for (let i = 1; i < result.hubs.length; i++) {
            expect(result.hubs[i - 1].degree).toBeGreaterThanOrEqual(result.hubs[i].degree);
        }
    });

    it('drops communities smaller than minSize', () => {
        const idx = indexGraph(twoClusterGraph());
        // With minSize 4 only the a-cluster (a1/a2/a3/glue) survives.
        const result = detectTopologicalCommunities(idx, { minSize: 4, topN: 10 });
        expect(result.communities.every((c) => c.size >= 4)).toBe(true);
    });
});

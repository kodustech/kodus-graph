import { describe, expect, it } from 'bun:test';
import { readFileSync, rmSync } from 'fs';
import { writeGraphJSON } from '../../src/graph/json-writer';
import type { GraphEdge, GraphNode, ParseMetadata } from '../../src/graph/types';

describe('writeGraphJSON', () => {
    const OUT = '/tmp/kodus-graph-json-writer-test.json';

    const metadata: ParseMetadata = {
        repo_dir: '/repo',
        files_parsed: 2,
        total_nodes: 2,
        total_edges: 1,
        duration_ms: 100,
        parse_errors: 0,
        extract_errors: 0,
    };

    const nodes: GraphNode[] = [
        {
            kind: 'Function',
            name: 'foo',
            qualified_name: 'src/a.ts::foo',
            file_path: 'src/a.ts',
            line_start: 1,
            line_end: 5,
            language: 'typescript',
            is_test: false,
            file_hash: 'abc123',
        },
        {
            kind: 'Class',
            name: 'Bar',
            qualified_name: 'src/b.ts::Bar',
            file_path: 'src/b.ts',
            line_start: 1,
            line_end: 20,
            language: 'typescript',
            is_test: false,
            file_hash: 'def456',
        },
    ];

    const edges: GraphEdge[] = [
        {
            kind: 'CALLS',
            source_qualified: 'src/a.ts::foo',
            target_qualified: 'src/b.ts::Bar',
            file_path: 'src/a.ts',
            line: 3,
            confidence: 0.85,
        },
    ];

    it('should produce valid JSON parseable by JSON.parse', () => {
        writeGraphJSON(OUT, metadata, nodes, edges);
        const raw = readFileSync(OUT, 'utf-8');
        const parsed = JSON.parse(raw);

        expect(parsed.metadata.repo_dir).toBe('/repo');
        expect(parsed.metadata.total_nodes).toBe(2);
        expect(parsed.nodes).toHaveLength(2);
        expect(parsed.edges).toHaveLength(1);
        expect(parsed.nodes[0].name).toBe('foo');
        expect(parsed.nodes[1].name).toBe('Bar');
        expect(parsed.edges[0].kind).toBe('CALLS');

        rmSync(OUT, { force: true });
    });

    it('should handle empty nodes and edges', () => {
        const emptyMeta: ParseMetadata = {
            ...metadata,
            total_nodes: 0,
            total_edges: 0,
        };
        writeGraphJSON(OUT, emptyMeta, [], []);
        const parsed = JSON.parse(readFileSync(OUT, 'utf-8'));

        expect(parsed.nodes).toHaveLength(0);
        expect(parsed.edges).toHaveLength(0);

        rmSync(OUT, { force: true });
    });
});

// tests/graph/loader.test.ts
import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { indexGraph, loadGraph } from '../../src/graph/loader';
import type { GraphData, ParseOutput } from '../../src/graph/types';

const tmpDir = '/tmp/kodus-graph-test-loader';

function sampleOutput(): ParseOutput {
    return {
        metadata: {
            repo_dir: '/repo',
            files_parsed: 2,
            total_nodes: 3,
            total_edges: 2,
            duration_ms: 100,
            parse_errors: 0,
            extract_errors: 0,
        },
        nodes: [
            {
                kind: 'Function',
                name: 'foo',
                qualified_name: 'src/a.ts::foo',
                file_path: 'src/a.ts',
                line_start: 1,
                line_end: 5,
                language: 'typescript',
                is_test: false,
                file_hash: 'aaa',
            },
            {
                kind: 'Function',
                name: 'bar',
                qualified_name: 'src/b.ts::bar',
                file_path: 'src/b.ts',
                line_start: 1,
                line_end: 3,
                language: 'typescript',
                is_test: false,
                file_hash: 'bbb',
            },
            {
                kind: 'Class',
                name: 'Baz',
                qualified_name: 'src/a.ts::Baz',
                file_path: 'src/a.ts',
                line_start: 10,
                line_end: 20,
                language: 'typescript',
                is_test: false,
                file_hash: 'aaa',
            },
        ],
        edges: [
            {
                kind: 'CALLS',
                source_qualified: 'src/a.ts::foo',
                target_qualified: 'src/b.ts::bar',
                file_path: 'src/a.ts',
                line: 3,
            },
            {
                kind: 'IMPORTS',
                source_qualified: 'src/a.ts',
                target_qualified: 'src/b.ts',
                file_path: 'src/a.ts',
                line: 1,
            },
        ],
    };
}

describe('loadGraph', () => {
    it('should load and index a valid ParseOutput JSON', () => {
        mkdirSync(tmpDir, { recursive: true });
        const path = join(tmpDir, 'graph.json');
        writeFileSync(path, JSON.stringify(sampleOutput()));

        const g = loadGraph(path);

        expect(g.nodes).toHaveLength(3);
        expect(g.edges).toHaveLength(2);
        expect(g.byQualified.get('src/a.ts::foo')?.name).toBe('foo');
        expect(g.byFile.get('src/a.ts')).toHaveLength(2);
        expect(g.byFile.get('src/b.ts')).toHaveLength(1);
        expect(g.adjacency.get('src/a.ts::foo')).toHaveLength(1);
        expect(g.reverseAdjacency.get('src/b.ts::bar')).toHaveLength(1);
        expect(g.edgesByKind.get('CALLS')).toHaveLength(1);
        expect(g.edgesByKind.get('IMPORTS')).toHaveLength(1);
        expect(g.metadata.files_parsed).toBe(2);

        rmSync(tmpDir, { recursive: true });
    });

    it('should throw on invalid JSON', () => {
        mkdirSync(tmpDir, { recursive: true });
        const path = join(tmpDir, 'bad.json');
        writeFileSync(path, '{ "nodes": "not-array" }');

        expect(() => loadGraph(path)).toThrow();

        rmSync(tmpDir, { recursive: true });
    });

    it('should throw on missing file', () => {
        expect(() => loadGraph('/tmp/nonexistent-graph-xyz.json')).toThrow();
    });
});

describe('indexGraph', () => {
    it('should build indices from in-memory GraphData', () => {
        const data: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'foo',
                    qualified_name: 'src/a.ts::foo',
                    file_path: 'src/a.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'abc',
                },
                {
                    kind: 'Function',
                    name: 'bar',
                    qualified_name: 'src/b.ts::bar',
                    file_path: 'src/b.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'def',
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'src/a.ts::foo',
                    target_qualified: 'src/b.ts::bar',
                    file_path: 'src/a.ts',
                    line: 5,
                    confidence: 0.9,
                },
            ],
        };

        const indexed = indexGraph(data);

        expect(indexed.nodes).toHaveLength(2);
        expect(indexed.edges).toHaveLength(1);
        expect(indexed.byQualified.get('src/a.ts::foo')?.name).toBe('foo');
        expect(indexed.byFile.get('src/a.ts')).toHaveLength(1);
        expect(indexed.adjacency.get('src/a.ts::foo')).toHaveLength(1);
        expect(indexed.reverseAdjacency.get('src/b.ts::bar')).toHaveLength(1);
        expect(indexed.edgesByKind.get('CALLS')).toHaveLength(1);
        expect(indexed.metadata.total_nodes).toBe(2);
        expect(indexed.metadata.total_edges).toBe(1);
    });
});

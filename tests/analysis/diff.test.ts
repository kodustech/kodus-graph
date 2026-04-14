import { describe, expect, it } from 'bun:test';
import { computeStructuralDiff } from '../../src/analysis/diff';
import type { IndexedGraph } from '../../src/graph/loader';
import type { GraphEdge, GraphNode } from '../../src/graph/types';

function makeGraph(nodes: GraphNode[], edges: GraphEdge[]): IndexedGraph {
    const byQualified = new Map(nodes.map((n) => [n.qualified_name, n]));
    const byFile = new Map<string, GraphNode[]>();
    for (const n of nodes) {
        const list = byFile.get(n.file_path);
        if (list) {
            list.push(n);
        } else {
            byFile.set(n.file_path, [n]);
        }
    }
    const adjacency = new Map<string, GraphEdge[]>();
    const reverseAdjacency = new Map<string, GraphEdge[]>();
    const edgesByKind = new Map<string, GraphEdge[]>();
    for (const e of edges) {
        const fwd = adjacency.get(e.source_qualified);
        if (fwd) {
            fwd.push(e);
        } else {
            adjacency.set(e.source_qualified, [e]);
        }
        const rev = reverseAdjacency.get(e.target_qualified);
        if (rev) {
            rev.push(e);
        } else {
            reverseAdjacency.set(e.target_qualified, [e]);
        }
        const byKind = edgesByKind.get(e.kind);
        if (byKind) {
            byKind.push(e);
        } else {
            edgesByKind.set(e.kind, [e]);
        }
    }
    return {
        nodes,
        edges,
        byQualified,
        byFile,
        adjacency,
        reverseAdjacency,
        edgesByKind,
        metadata: {
            repo_dir: '',
            files_parsed: 0,
            total_nodes: 0,
            total_edges: 0,
            duration_ms: 0,
            parse_errors: 0,
            extract_errors: 0,
        },
    };
}

const node = (
    name: string,
    file: string,
    lineStart = 1,
    lineEnd = 5,
    params?: string,
    opts?: { return_type?: string; modifiers?: string },
): GraphNode => ({
    kind: 'Function',
    name,
    qualified_name: `${file}::${name}`,
    file_path: file,
    line_start: lineStart,
    line_end: lineEnd,
    language: 'typescript',
    is_test: false,
    file_hash: 'x',
    ...(params ? { params } : {}),
    ...(opts?.return_type ? { return_type: opts.return_type } : {}),
    ...(opts?.modifiers ? { modifiers: opts.modifiers } : {}),
});

describe('computeStructuralDiff', () => {
    it('should detect added nodes', () => {
        const oldGraph = makeGraph([node('foo', 'src/a.ts')], []);
        const newNodes: GraphNode[] = [node('foo', 'src/a.ts'), node('bar', 'src/a.ts')];
        const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

        expect(result.nodes.added).toHaveLength(1);
        expect(result.nodes.added[0].qualified_name).toBe('src/a.ts::bar');
    });

    it('should detect removed nodes', () => {
        const oldGraph = makeGraph([node('foo', 'src/a.ts'), node('bar', 'src/a.ts')], []);
        const newNodes: GraphNode[] = [node('foo', 'src/a.ts')];
        const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

        expect(result.nodes.removed).toHaveLength(1);
        expect(result.nodes.removed[0].qualified_name).toBe('src/a.ts::bar');
    });

    it('should detect body change when content_hash differs (real modification)', () => {
        const oldNode = { ...node('foo', 'src/a.ts', 1, 5), content_hash: 'aaa' };
        const newNode = { ...node('foo', 'src/a.ts', 1, 10), content_hash: 'bbb' };
        const oldGraph = makeGraph([oldNode], []);
        const result = computeStructuralDiff(oldGraph, [newNode], [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].changes).toContain('body');
    });

    it('should detect body change even when line range is identical (same-line edit)', () => {
        const oldNode = { ...node('foo', 'src/a.ts', 1, 5), content_hash: 'aaa' };
        const newNode = { ...node('foo', 'src/a.ts', 1, 5), content_hash: 'bbb' }; // same lines, different content
        const oldGraph = makeGraph([oldNode], []);
        const result = computeStructuralDiff(oldGraph, [newNode], [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].changes).toContain('body');
    });

    it('should NOT flag line_range when content_hash matches (pure displacement)', () => {
        const hash = 'same_hash_abc';
        const oldNode = { ...node('foo', 'src/a.ts', 1, 5), content_hash: hash };
        const newNode = { ...node('foo', 'src/a.ts', 10, 14), content_hash: hash }; // moved but same content
        const oldGraph = makeGraph([oldNode], []);
        const result = computeStructuralDiff(oldGraph, [newNode], [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(0);
    });

    it('should fallback to size heuristic when content_hash is missing (legacy data)', () => {
        // No content_hash on either node — falls back to size comparison
        const oldGraph = makeGraph([node('foo', 'src/a.ts', 1, 5)], []);
        const newNodes: GraphNode[] = [node('foo', 'src/a.ts', 10, 14)]; // size 4→4
        const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(0); // same size = displacement
    });

    it('should detect line_range via size fallback when content_hash missing and size differs', () => {
        const oldGraph = makeGraph([node('foo', 'src/a.ts', 1, 5)], []);
        const newNodes: GraphNode[] = [node('foo', 'src/a.ts', 1, 10)]; // size 4→9
        const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].changes).toContain('line_range');
    });

    it('should detect modified nodes (params changed)', () => {
        const oldGraph = makeGraph([node('foo', 'src/a.ts', 1, 5, '(x: number)')], []);
        const newNodes: GraphNode[] = [node('foo', 'src/a.ts', 1, 5, '(x: number, y: string)')];
        const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].changes).toContain('params');
    });

    it('should include contract_diffs with old/new values for params change', () => {
        const oldGraph = makeGraph([node('foo', 'src/a.ts', 1, 5, '(x: number)')], []);
        const newNodes: GraphNode[] = [node('foo', 'src/a.ts', 1, 5, '(x: number, y: string)')];
        const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].contract_diffs).toEqual([
            { field: 'params', old_value: '(x: number)', new_value: '(x: number, y: string)' },
        ]);
    });

    it('should include contract_diffs for return_type change', () => {
        const oldGraph = makeGraph([node('foo', 'src/a.ts', 1, 5, undefined, { return_type: 'string' })], []);
        const newNodes: GraphNode[] = [node('foo', 'src/a.ts', 1, 5, undefined, { return_type: 'string | null' })];
        const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].contract_diffs).toEqual([
            { field: 'return_type', old_value: 'string', new_value: 'string | null' },
        ]);
    });

    it('should detect modifiers change', () => {
        const oldGraph = makeGraph([node('foo', 'src/a.ts', 1, 5, undefined, { modifiers: 'public' })], []);
        const newNodes: GraphNode[] = [node('foo', 'src/a.ts', 1, 5, undefined, { modifiers: 'private' })];
        const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].changes).toContain('modifiers');
        expect(result.nodes.modified[0].contract_diffs).toEqual([
            { field: 'modifiers', old_value: 'public', new_value: 'private' },
        ]);
    });

    it('should have empty contract_diffs when only body changed', () => {
        const oldNode = { ...node('foo', 'src/a.ts', 1, 5), content_hash: 'aaa' };
        const newNode = { ...node('foo', 'src/a.ts', 1, 5), content_hash: 'bbb' };
        const oldGraph = makeGraph([oldNode], []);
        const result = computeStructuralDiff(oldGraph, [newNode], [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].changes).toEqual(['body']);
        expect(result.nodes.modified[0].contract_diffs).toEqual([]);
    });

    it('should detect is_async change as contract diff', () => {
        const oldNode = { ...node('foo', 'src/a.ts', 1, 5), is_async: false };
        const newNode = { ...node('foo', 'src/a.ts', 1, 5), is_async: true };
        const oldGraph = makeGraph([oldNode], []);
        const result = computeStructuralDiff(oldGraph, [newNode], [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].changes).toContain('is_async');
        expect(result.nodes.modified[0].contract_diffs).toContainEqual({
            field: 'is_async',
            old_value: 'false',
            new_value: 'true',
        });
    });

    it('should detect decorators change as contract diff', () => {
        const oldNode = { ...node('foo', 'src/a.ts', 1, 5), decorators: ['@Service'] };
        const newNode = { ...node('foo', 'src/a.ts', 1, 5), decorators: ['@Service', '@Singleton'] };
        const oldGraph = makeGraph([oldNode], []);
        const result = computeStructuralDiff(oldGraph, [newNode], [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].changes).toContain('decorators');
        expect(result.nodes.modified[0].contract_diffs).toContainEqual({
            field: 'decorators',
            old_value: '@Service',
            new_value: '@Service, @Singleton',
        });
    });

    it('should detect decorators added from none', () => {
        const oldNode = node('foo', 'src/a.ts', 1, 5);
        const newNode = { ...node('foo', 'src/a.ts', 1, 5), decorators: ['@Injectable', '@Singleton'] };
        const oldGraph = makeGraph([oldNode], []);
        const result = computeStructuralDiff(oldGraph, [newNode], [], ['src/a.ts']);

        expect(result.nodes.modified).toHaveLength(1);
        expect(result.nodes.modified[0].changes).toContain('decorators');
        expect(result.nodes.modified[0].contract_diffs).toContainEqual({
            field: 'decorators',
            old_value: '(none)',
            new_value: '@Injectable, @Singleton',
        });
    });

    it('should NOT detect is_async change when both are undefined (default false)', () => {
        const oldNode = node('foo', 'src/a.ts', 1, 5);
        const newNode = node('foo', 'src/a.ts', 1, 5);
        const oldGraph = makeGraph([oldNode], []);
        const result = computeStructuralDiff(oldGraph, [newNode], [], ['src/a.ts']);

        // No changes at all (both default to false)
        const asyncDiffs = result.nodes.modified.flatMap((m) => m.contract_diffs.filter((d) => d.field === 'is_async'));
        expect(asyncDiffs).toHaveLength(0);
    });

    it('should compute risk_by_file using reverse adjacency', () => {
        const oldNodes = [node('foo', 'src/a.ts'), node('bar', 'src/b.ts')];
        const oldEdges: GraphEdge[] = [
            {
                kind: 'CALLS',
                source_qualified: 'src/b.ts::bar',
                target_qualified: 'src/a.ts::foo',
                file_path: 'src/b.ts',
                line: 1,
            },
        ];
        const oldGraph = makeGraph(oldNodes, oldEdges);
        const newNodes: GraphNode[] = [node('foo', 'src/a.ts', 1, 10)]; // modified
        const result = computeStructuralDiff(oldGraph, newNodes, [], ['src/a.ts']);

        expect(result.risk_by_file['src/a.ts']).toBeDefined();
        expect(result.risk_by_file['src/a.ts'].dependents).toBeGreaterThanOrEqual(1);
    });
});

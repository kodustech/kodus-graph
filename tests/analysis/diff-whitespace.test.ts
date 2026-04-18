import { describe, expect, it } from 'bun:test';
import { computeStructuralDiff } from '../../src/analysis/diff';
import type { IndexedGraph } from '../../src/graph/loader';
import type { GraphEdge, GraphNode } from '../../src/graph/types';

function makeGraph(nodes: GraphNode[], edges: GraphEdge[] = []): IndexedGraph {
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

function fnNode(name: string, opts: { params?: string; return_type?: string } = {}): GraphNode {
    const file = 'src/a.ts';
    return {
        kind: 'Function',
        name,
        qualified_name: `${file}::${name}`,
        file_path: file,
        line_start: 1,
        line_end: 5,
        language: 'typescript',
        is_test: false,
        file_hash: 'x',
        content_hash: 'same',
        ...(opts.params !== undefined ? { params: opts.params } : {}),
        ...(opts.return_type !== undefined ? { return_type: opts.return_type } : {}),
    };
}

function paramsDiff(oldNode: GraphNode, newNode: GraphNode) {
    const result = computeStructuralDiff(makeGraph([oldNode]), [newNode], [], [oldNode.file_path]);
    return result.nodes.modified.flatMap((m) => m.contract_diffs).filter((d) => d.field === 'params');
}

function returnTypeDiff(oldNode: GraphNode, newNode: GraphNode) {
    const result = computeStructuralDiff(makeGraph([oldNode]), [newNode], [], [oldNode.file_path]);
    return result.nodes.modified.flatMap((m) => m.contract_diffs).filter((d) => d.field === 'return_type');
}

describe('contract-diff whitespace/format normalization', () => {
    it('multiline params reformat -> no contract diff', () => {
        const before = fnNode('VersionInfo', { params: '(a: string, b: number)' });
        const after = fnNode('VersionInfo', { params: '(\n    a: string,\n    b: number,\n)' });
        expect(paramsDiff(before, after)).toHaveLength(0);
    });

    it('trailing comma added -> no contract diff', () => {
        const before = fnNode('getOrganizationMembers', { params: '(id: string)' });
        const after = fnNode('getOrganizationMembers', { params: '(id: string,)' });
        expect(paramsDiff(before, after)).toHaveLength(0);
    });

    it('rename ctx -> _ctx (unused-param convention) -> no contract diff', () => {
        const before = fnNode('runKodyRulesAnalysis', { params: '(context: Context)' });
        const after = fnNode('runKodyRulesAnalysis', { params: '(_context: Context)' });
        expect(paramsDiff(before, after)).toHaveLength(0);
    });

    it('underscore prefix on destructured param -> no contract diff', () => {
        const before = fnNode('fn', { params: '(foo: Bar, { opts }: Opts)' });
        const after = fnNode('fn', { params: '(foo: Bar, { _opts }: Opts)' });
        expect(paramsDiff(before, after)).toHaveLength(0);
    });

    it('real param addition -> still flagged', () => {
        const before = fnNode('fn', { params: '(a: string)' });
        const after = fnNode('fn', { params: '(a: string, b: number)' });
        expect(paramsDiff(before, after)).toHaveLength(1);
    });

    it('return type multiline reformat -> no contract diff', () => {
        const before = fnNode('fn', { return_type: 'Promise<User>' });
        const after = fnNode('fn', { return_type: 'Promise<\n    User\n>' });
        expect(returnTypeDiff(before, after)).toHaveLength(0);
    });

    it('real return type change -> still flagged', () => {
        const before = fnNode('fn', { return_type: 'Promise<User>' });
        const after = fnNode('fn', { return_type: 'Promise<User | null>' });
        expect(returnTypeDiff(before, after)).toHaveLength(1);
    });

    it('type-position _Private is NOT stripped (regression guard)', () => {
        const before = fnNode('fn', { params: '(ctx: _Private)' });
        const after = fnNode('fn', { params: '(ctx: Private)' });
        // This IS a real change - the regex must not strip the type-position underscore
        // on the "before" side, so a real diff must still be detected.
        expect(paramsDiff(before, after)).toHaveLength(1);
    });

    it('emitted diff entry keeps ORIGINAL before/after text (not normalized)', () => {
        // Real change, so an entry IS emitted — verify we preserve raw strings.
        const before = fnNode('fn', { params: '(a: string)' });
        const after = fnNode('fn', { params: '(\n    a: string,\n    b: number,\n)' });
        const diffs = paramsDiff(before, after);
        expect(diffs).toHaveLength(1);
        expect(diffs[0].old_value).toBe('(a: string)');
        expect(diffs[0].new_value).toBe('(\n    a: string,\n    b: number,\n)');
    });
});

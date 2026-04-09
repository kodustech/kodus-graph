import { describe, expect, it } from 'bun:test';
import { buildContextV2 } from '../../src/analysis/context-builder';
import type { GraphData } from '../../src/graph/types';

const graphData: GraphData = {
    nodes: [
        {
            kind: 'Function',
            name: 'authenticate',
            qualified_name: 'src/auth.ts::authenticate',
            file_path: 'src/auth.ts',
            line_start: 10,
            line_end: 25,
            language: 'typescript',
            params: '(ctx: Context)',
            return_type: 'Result',
            is_test: false,
            file_hash: 'a',
        },
        {
            kind: 'Function',
            name: 'login',
            qualified_name: 'src/ctrl.ts::login',
            file_path: 'src/ctrl.ts',
            line_start: 5,
            line_end: 15,
            language: 'typescript',
            params: '(req: Request)',
            return_type: 'Response',
            is_test: false,
            file_hash: 'b',
        },
        {
            kind: 'Class',
            name: 'AuthService',
            qualified_name: 'src/auth.ts::AuthService',
            file_path: 'src/auth.ts',
            line_start: 1,
            line_end: 50,
            language: 'typescript',
            is_test: false,
            file_hash: 'a',
        },
    ],
    edges: [
        {
            kind: 'CALLS',
            source_qualified: 'src/ctrl.ts::login',
            target_qualified: 'src/auth.ts::authenticate',
            file_path: 'src/ctrl.ts',
            line: 8,
            confidence: 0.9,
        },
    ],
};

describe('buildContextV2', () => {
    it('should produce ContextV2Output with graph and analysis sections', () => {
        const result = buildContextV2({
            mergedGraph: graphData,
            oldGraph: null,
            changedFiles: ['src/auth.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        // Graph section
        expect(result.graph.nodes).toHaveLength(3);
        expect(result.graph.edges).toHaveLength(1);
        expect(result.graph.metadata).toBeDefined();

        // Analysis sections
        expect(result.analysis.changed_functions).toHaveLength(1);
        expect(result.analysis.changed_functions[0].qualified_name).toBe('src/auth.ts::authenticate');
        expect(result.analysis.changed_functions[0].callers).toHaveLength(1);
        expect(result.analysis.structural_diff).toBeDefined();
        expect(result.analysis.structural_diff.summary.added).toBeGreaterThanOrEqual(0);
        expect(result.analysis.blast_radius).toBeDefined();
        expect(result.analysis.blast_radius.total_files).toBeGreaterThanOrEqual(1);
        expect(result.analysis.affected_flows).toBeDefined();
        expect(result.analysis.inheritance).toHaveLength(1);
        expect(result.analysis.inheritance[0].qualified_name).toBe('src/auth.ts::AuthService');
        expect(result.analysis.test_gaps).toBeDefined();
        expect(result.analysis.risk).toBeDefined();
        expect(result.analysis.risk.level).toBeDefined();
        expect(result.analysis.metadata.changed_functions_count).toBe(1);
        expect(result.analysis.metadata.min_confidence).toBe(0.5);
        expect(result.analysis.metadata.duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('should handle empty changed files', () => {
        const result = buildContextV2({
            mergedGraph: graphData,
            oldGraph: null,
            changedFiles: [],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        expect(result.analysis.changed_functions).toHaveLength(0);
        expect(result.analysis.metadata.changed_functions_count).toBe(0);
        expect(result.graph.nodes).toHaveLength(3);
    });

    it('should filter affected flows to only those touching changed files', () => {
        const result = buildContextV2({
            mergedGraph: graphData,
            oldGraph: null,
            changedFiles: ['src/auth.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        for (const flow of result.analysis.affected_flows) {
            expect(flow.touches_changed.length).toBeGreaterThan(0);
        }
    });

    it('should mark functions as new when oldGraph excludes changed files (same-branch fix)', () => {
        // Simulates what context.ts does when it detects same-branch:
        // oldGraph has NO nodes for changed files → diff sees everything as "added"
        const oldGraphWithoutChangedFiles: GraphData = {
            nodes: [
                // Only nodes from unchanged files
                {
                    kind: 'Function',
                    name: 'login',
                    qualified_name: 'src/ctrl.ts::login',
                    file_path: 'src/ctrl.ts',
                    line_start: 5,
                    line_end: 15,
                    language: 'typescript',
                    params: '(req: Request)',
                    return_type: 'Response',
                    is_test: false,
                    file_hash: 'b',
                },
            ],
            edges: [],
        };

        const result = buildContextV2({
            mergedGraph: graphData,
            oldGraph: oldGraphWithoutChangedFiles,
            changedFiles: ['src/auth.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        // Functions in changed files should be marked as new (not unchanged)
        expect(result.analysis.changed_functions[0].is_new).toBe(true);
        expect(result.analysis.structural_diff.nodes.added.length).toBeGreaterThan(0);
        expect(
            result.analysis.structural_diff.nodes.added.some((n) => n.qualified_name === 'src/auth.ts::authenticate'),
        ).toBe(true);
    });

    it('should NOT mark functions as new when identical oldGraph is provided (pre-fix behavior)', () => {
        // When oldGraph has the same nodes as mergedGraph → everything is "unchanged"
        // With onlyChanged=true in enrichment, no functions are returned since none truly changed
        const result = buildContextV2({
            mergedGraph: graphData,
            oldGraph: graphData,
            changedFiles: ['src/auth.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        // With identical graphs, nothing truly changed → no enriched functions
        expect(result.analysis.changed_functions).toHaveLength(0);
        expect(result.analysis.structural_diff.nodes.added).toHaveLength(0);
        expect(result.analysis.structural_diff.nodes.modified).toHaveLength(0);
    });

    it('should seed blast radius from trulyChangedQN (not file-level)', () => {
        // Graph with 2 functions in the same changed file, but only one is modified
        const oldGraph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'authenticate',
                    qualified_name: 'src/auth.ts::authenticate',
                    file_path: 'src/auth.ts',
                    line_start: 10,
                    line_end: 20,
                    language: 'typescript',
                    params: '(ctx: Ctx)', // different from merged → will be "modified"
                    return_type: 'Result',
                    is_test: false,
                    file_hash: 'old',
                },
                {
                    kind: 'Function',
                    name: 'validate',
                    qualified_name: 'src/auth.ts::validate',
                    file_path: 'src/auth.ts',
                    line_start: 30,
                    line_end: 40,
                    language: 'typescript',
                    params: '(token: string)',
                    return_type: 'boolean',
                    is_test: false,
                    file_hash: 'old',
                },
            ],
            edges: [],
        };

        const mergedWithTwoFns: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'authenticate',
                    qualified_name: 'src/auth.ts::authenticate',
                    file_path: 'src/auth.ts',
                    line_start: 10,
                    line_end: 25,
                    language: 'typescript',
                    params: '(ctx: Context)', // changed params
                    return_type: 'Result',
                    is_test: false,
                    file_hash: 'a',
                },
                {
                    kind: 'Function',
                    name: 'validate',
                    qualified_name: 'src/auth.ts::validate',
                    file_path: 'src/auth.ts',
                    line_start: 30,
                    line_end: 40,
                    language: 'typescript',
                    params: '(token: string)', // same params → unchanged
                    return_type: 'boolean',
                    is_test: false,
                    file_hash: 'old',
                },
                {
                    kind: 'Function',
                    name: 'helper',
                    qualified_name: 'src/utils.ts::helper',
                    file_path: 'src/utils.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'u',
                },
            ],
            edges: [
                // helper calls authenticate → blast radius should reach helper only if authenticate is a seed
                {
                    kind: 'CALLS',
                    source_qualified: 'src/utils.ts::helper',
                    target_qualified: 'src/auth.ts::authenticate',
                    file_path: 'src/utils.ts',
                    line: 3,
                    confidence: 0.9,
                },
                // helper also calls validate → if validate were a seed, helper would still be reached
                {
                    kind: 'CALLS',
                    source_qualified: 'src/utils.ts::helper',
                    target_qualified: 'src/auth.ts::validate',
                    file_path: 'src/utils.ts',
                    line: 4,
                    confidence: 0.9,
                },
            ],
        };

        const result = buildContextV2({
            mergedGraph: mergedWithTwoFns,
            oldGraph,
            changedFiles: ['src/auth.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        // Only authenticate is modified (params change); validate is unchanged
        expect(result.analysis.structural_diff.nodes.modified.length).toBe(1);
        expect(result.analysis.structural_diff.nodes.modified[0].qualified_name).toBe('src/auth.ts::authenticate');

        // Blast radius seeds = trulyChangedQN, which is just [authenticate]
        // So total_functions includes authenticate + helper (reached via reverse CALLS)
        expect(result.analysis.blast_radius.total_functions).toBeGreaterThanOrEqual(1);
    });

    it('should build changedFuncSet from trulyChangedQN only (not all functions in file)', () => {
        // Two functions in the same file, but only one truly changed
        const oldGraph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'authenticate',
                    qualified_name: 'src/auth.ts::authenticate',
                    file_path: 'src/auth.ts',
                    line_start: 10,
                    line_end: 20,
                    language: 'typescript',
                    params: '(ctx: Ctx)',
                    return_type: 'Result',
                    is_test: false,
                    file_hash: 'old',
                },
                {
                    kind: 'Function',
                    name: 'validate',
                    qualified_name: 'src/auth.ts::validate',
                    file_path: 'src/auth.ts',
                    line_start: 30,
                    line_end: 40,
                    language: 'typescript',
                    params: '(token: string)',
                    return_type: 'boolean',
                    is_test: false,
                    file_hash: 'old',
                },
            ],
            edges: [],
        };

        const mergedWithTwoFns: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'authenticate',
                    qualified_name: 'src/auth.ts::authenticate',
                    file_path: 'src/auth.ts',
                    line_start: 10,
                    line_end: 25,
                    language: 'typescript',
                    params: '(ctx: Context)',
                    return_type: 'Result',
                    is_test: false,
                    file_hash: 'a',
                },
                {
                    kind: 'Function',
                    name: 'validate',
                    qualified_name: 'src/auth.ts::validate',
                    file_path: 'src/auth.ts',
                    line_start: 30,
                    line_end: 40,
                    language: 'typescript',
                    params: '(token: string)',
                    return_type: 'boolean',
                    is_test: false,
                    file_hash: 'old',
                },
            ],
            edges: [],
        };

        const result = buildContextV2({
            mergedGraph: mergedWithTwoFns,
            oldGraph,
            changedFiles: ['src/auth.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        // Only authenticate truly changed, validate did not
        // So enriched functions should only contain authenticate (onlyChanged=true)
        expect(result.analysis.changed_functions).toHaveLength(1);
        expect(result.analysis.changed_functions[0].qualified_name).toBe('src/auth.ts::authenticate');

        // Affected flows should only match against truly changed functions (authenticate)
        // With no flows detected in this simple graph, affected_flows should be empty
        expect(result.analysis.affected_flows).toHaveLength(0);
    });

    it('should compute structural diff when oldGraph is provided', () => {
        const oldGraph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'authenticate',
                    qualified_name: 'src/auth.ts::authenticate',
                    file_path: 'src/auth.ts',
                    line_start: 10,
                    line_end: 20,
                    language: 'typescript',
                    params: '(ctx: Ctx)',
                    return_type: 'Result',
                    is_test: false,
                    file_hash: 'old',
                },
            ],
            edges: [],
        };

        const result = buildContextV2({
            mergedGraph: graphData,
            oldGraph,
            changedFiles: ['src/auth.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        // authenticate has changed params and line_range
        expect(result.analysis.structural_diff.nodes.modified.length).toBeGreaterThan(0);
        expect(result.analysis.changed_functions[0].diff_changes.length).toBeGreaterThan(0);
        expect(result.analysis.changed_functions[0].is_new).toBe(false);
    });
});

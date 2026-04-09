import { describe, expect, it } from 'bun:test';
import { buildContextV2 } from '../../src/analysis/context-builder';
import { formatPrompt } from '../../src/analysis/prompt-formatter';
import type { GraphData } from '../../src/graph/types';

describe('formatPrompt', () => {
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
            {
                kind: 'INHERITS',
                source_qualified: 'src/auth.ts::AuthService',
                target_qualified: 'src/base.ts::BaseService',
                file_path: 'src/auth.ts',
                line: 1,
            },
        ],
    };

    it('should produce compact prompt with header, changed functions, and hierarchy', () => {
        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: null,
            changedFiles: ['src/auth.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const text = formatPrompt(output);

        // Header line with stats
        expect(text).toMatch(/\d+ changed \| \d+ impacted \| \d+ files \| risk/);
        // Changed section
        expect(text).toContain('CHANGED:');
        expect(text).toContain('authenticate(ctx: Context) -> Result');
        // Caller with ← notation
        expect(text).toContain('← login');
        // Hierarchy
        expect(text).toContain('HIERARCHY:');
        expect(text).toContain('AuthService extends BaseService');
    });

    it('should format contract diffs and caller impact inline', () => {
        const graphWithContract: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'processOrder',
                    qualified_name: 'src/order.ts::processOrder',
                    file_path: 'src/order.ts',
                    line_start: 10,
                    line_end: 30,
                    language: 'typescript',
                    params: '(id: number, priority: number)',
                    return_type: 'string | null',
                    is_test: false,
                    file_hash: 'x',
                },
                {
                    kind: 'Function',
                    name: 'handleRequest',
                    qualified_name: 'src/handler.ts::handleRequest',
                    file_path: 'src/handler.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    params: '(req: Request)',
                    return_type: 'Response',
                    is_test: false,
                    file_hash: 'y',
                },
                {
                    kind: 'Function',
                    name: 'runBatch',
                    qualified_name: 'src/batch.ts::runBatch',
                    file_path: 'src/batch.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    params: '(items: string[])',
                    return_type: 'void',
                    is_test: false,
                    file_hash: 'z',
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'src/handler.ts::handleRequest',
                    target_qualified: 'src/order.ts::processOrder',
                    file_path: 'src/handler.ts',
                    line: 5,
                    confidence: 0.95,
                },
                {
                    kind: 'CALLS',
                    source_qualified: 'src/batch.ts::runBatch',
                    target_qualified: 'src/order.ts::processOrder',
                    file_path: 'src/batch.ts',
                    line: 3,
                    confidence: 0.9,
                },
            ],
        };

        const output = buildContextV2({
            mergedGraph: graphWithContract,
            oldGraph: {
                nodes: [
                    {
                        kind: 'Function',
                        name: 'processOrder',
                        qualified_name: 'src/order.ts::processOrder',
                        file_path: 'src/order.ts',
                        line_start: 10,
                        line_end: 25,
                        language: 'typescript',
                        params: '(id: number)',
                        return_type: 'string',
                        is_test: false,
                        file_hash: 'x',
                        content_hash: 'old_hash',
                    },
                ],
                edges: [],
            },
            changedFiles: ['src/order.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const text = formatPrompt(output);

        // Contract diffs inline with ⚠
        expect(text).toContain('⚠ params: (id: number) → (id: number, priority: number)');
        expect(text).toContain('⚠ return_type: string → string | null');
        // Caller impact inline with ⚠
        expect(text).toContain('⚠ 2 callers may need param update');
        // Callers with ← notation
        expect(text).toContain('← handleRequest');
        expect(text).toContain('← runBatch');
    });

    it('should handle empty changed functions', () => {
        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: null,
            changedFiles: [],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const text = formatPrompt(output);

        // Header still present
        expect(text).toMatch(/\d+ changed/);
        // No CHANGED section
        expect(text).not.toContain('CHANGED:');
    });

    it('should show similar sibling methods when inheritance exists', () => {
        // Sibling class is in a DIFFERENT file (not changed) — this is the real scenario:
        // OptimizedPaginator.getItemKey changed, DateTimePaginator.getItemKey exists in base graph
        const graphWithSiblings: GraphData = {
            nodes: [
                // Parent class
                {
                    kind: 'Class',
                    name: 'BasePaginator',
                    qualified_name: 'src/paginator.ts::BasePaginator',
                    file_path: 'src/paginator.ts',
                    line_start: 1,
                    line_end: 100,
                    language: 'typescript',
                    is_test: false,
                },
                // Child A (changed file)
                {
                    kind: 'Class',
                    name: 'OptimizedPaginator',
                    qualified_name: 'src/optimized.ts::OptimizedPaginator',
                    file_path: 'src/optimized.ts',
                    line_start: 1,
                    line_end: 100,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Method',
                    name: 'OptimizedPaginator.getItemKey',
                    qualified_name: 'src/optimized.ts::OptimizedPaginator::getItemKey',
                    file_path: 'src/optimized.ts',
                    line_start: 30,
                    line_end: 40,
                    language: 'typescript',
                    params: '(item: any)',
                    return_type: 'string',
                    is_test: false,
                },
                // Child B (sibling, NOT in changed files)
                {
                    kind: 'Class',
                    name: 'DateTimePaginator',
                    qualified_name: 'src/datetime.ts::DateTimePaginator',
                    file_path: 'src/datetime.ts',
                    line_start: 1,
                    line_end: 100,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Method',
                    name: 'DateTimePaginator.getItemKey',
                    qualified_name: 'src/datetime.ts::DateTimePaginator::getItemKey',
                    file_path: 'src/datetime.ts',
                    line_start: 30,
                    line_end: 40,
                    language: 'typescript',
                    params: '(item: any)',
                    return_type: 'number',
                    is_test: false,
                },
            ],
            edges: [
                {
                    kind: 'INHERITS',
                    source_qualified: 'src/optimized.ts::OptimizedPaginator',
                    target_qualified: 'src/paginator.ts::BasePaginator',
                    file_path: 'src/optimized.ts',
                    line: 1,
                },
                {
                    kind: 'INHERITS',
                    source_qualified: 'src/datetime.ts::DateTimePaginator',
                    target_qualified: 'src/paginator.ts::BasePaginator',
                    file_path: 'src/datetime.ts',
                    line: 1,
                },
            ],
        };

        const output = buildContextV2({
            mergedGraph: graphWithSiblings,
            oldGraph: null,
            changedFiles: ['src/optimized.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const text = formatPrompt(output);

        // Should show the sibling's implementation as "similar:"
        expect(text).toContain('similar: DateTimePaginator.getItemKey');
    });
});

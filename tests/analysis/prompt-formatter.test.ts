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
        expect(text).toMatch(/\d+ changed \(\d+ untested\) \| \d+ impacted \| \d+ files \| risk/);
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
        expect(text).toMatch(/\d+ changed \(\d+ untested\)/);
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
        // Class-qualified signature: method should show ClassName.method
        expect(text).toContain('OptimizedPaginator.getItemKey');
    });

    it('should prefix class name on method signatures', () => {
        const graphWithMethod: GraphData = {
            nodes: [
                {
                    kind: 'Class',
                    name: 'PaymentService',
                    qualified_name: 'src/payment.ts::PaymentService',
                    file_path: 'src/payment.ts',
                    line_start: 1,
                    line_end: 50,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Method',
                    name: 'PaymentService.processOrder',
                    qualified_name: 'src/payment.ts::PaymentService::processOrder',
                    file_path: 'src/payment.ts',
                    line_start: 10,
                    line_end: 30,
                    language: 'typescript',
                    params: '(id: number)',
                    return_type: 'void',
                    is_test: false,
                },
            ],
            edges: [],
        };

        const output = buildContextV2({
            mergedGraph: graphWithMethod,
            oldGraph: null,
            changedFiles: ['src/payment.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const text = formatPrompt(output);

        // Should show "PaymentService.processOrder" not just "processOrder"
        expect(text).toContain('PaymentService.processOrder(id: number) -> void');
    });

    it('should inherit callers from parent class method overrides', () => {
        const graphWithOverride: GraphData = {
            nodes: [
                {
                    kind: 'Class',
                    name: 'BasePaginator',
                    qualified_name: 'src/base.ts::BasePaginator',
                    file_path: 'src/base.ts',
                    line_start: 1,
                    line_end: 50,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Method',
                    name: 'BasePaginator.getResult',
                    qualified_name: 'src/base.ts::BasePaginator::getResult',
                    file_path: 'src/base.ts',
                    line_start: 10,
                    line_end: 30,
                    language: 'typescript',
                    params: '(limit: number)',
                    return_type: 'Result',
                    is_test: false,
                },
                {
                    kind: 'Class',
                    name: 'CustomPaginator',
                    qualified_name: 'src/custom.ts::CustomPaginator',
                    file_path: 'src/custom.ts',
                    line_start: 1,
                    line_end: 50,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Method',
                    name: 'CustomPaginator.getResult',
                    qualified_name: 'src/custom.ts::CustomPaginator::getResult',
                    file_path: 'src/custom.ts',
                    line_start: 10,
                    line_end: 30,
                    language: 'typescript',
                    params: '(limit: number)',
                    return_type: 'Result',
                    is_test: false,
                },
                {
                    kind: 'Function',
                    name: 'handleRequest',
                    qualified_name: 'src/handler.ts::handleRequest',
                    file_path: 'src/handler.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                },
            ],
            edges: [
                {
                    kind: 'INHERITS',
                    source_qualified: 'src/custom.ts::CustomPaginator',
                    target_qualified: 'src/base.ts::BasePaginator',
                    file_path: 'src/custom.ts',
                    line: 1,
                },
                // handleRequest calls BasePaginator.getResult (via base class reference)
                {
                    kind: 'CALLS',
                    source_qualified: 'src/handler.ts::handleRequest',
                    target_qualified: 'src/base.ts::BasePaginator::getResult',
                    file_path: 'src/handler.ts',
                    line: 5,
                    confidence: 0.95,
                },
            ],
        };

        const output = buildContextV2({
            mergedGraph: graphWithOverride,
            oldGraph: null,
            changedFiles: ['src/custom.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const text = formatPrompt(output);

        // CustomPaginator.getResult should inherit handleRequest as a caller
        // (even though the CALLS edge points to BasePaginator.getResult)
        expect(text).toContain('CustomPaginator.getResult');
        expect(text).toContain('← handleRequest');
        expect(text).toContain('1 callers');
    });

    it('should scope untested count to changed functions only', () => {
        // Graph with 3 functions in changed file, but only 1 is actually changed
        const graphMixed: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'changedFn',
                    qualified_name: 'src/a.ts::changedFn',
                    file_path: 'src/a.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Function',
                    name: 'unchangedFn',
                    qualified_name: 'src/a.ts::unchangedFn',
                    file_path: 'src/a.ts',
                    line_start: 20,
                    line_end: 30,
                    language: 'typescript',
                    is_test: false,
                },
            ],
            edges: [],
        };

        const output = buildContextV2({
            mergedGraph: graphMixed,
            oldGraph: {
                nodes: [
                    {
                        kind: 'Function',
                        name: 'changedFn',
                        qualified_name: 'src/a.ts::changedFn',
                        file_path: 'src/a.ts',
                        line_start: 1,
                        line_end: 8,
                        language: 'typescript',
                        is_test: false,
                        content_hash: 'old',
                    },
                    {
                        kind: 'Function',
                        name: 'unchangedFn',
                        qualified_name: 'src/a.ts::unchangedFn',
                        file_path: 'src/a.ts',
                        line_start: 20,
                        line_end: 30,
                        language: 'typescript',
                        is_test: false,
                        content_hash: 'same',
                    },
                ],
                edges: [],
            },
            changedFiles: ['src/a.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const text = formatPrompt(output);

        // Header should say "1 changed (1 untested)" not "2 untested"
        expect(text).toContain('1 changed (1 untested)');
    });
});

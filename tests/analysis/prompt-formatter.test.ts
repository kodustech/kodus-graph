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

    it('should produce readable prompt text with all sections', () => {
        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: null,
            changedFiles: ['src/auth.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const text = formatPrompt(output);

        expect(text).toContain('# Code Review Context');
        expect(text).toContain('Risk:');
        expect(text).toContain('## Changed Functions');
        expect(text).toContain('authenticate(ctx: Context) -> Result');
        expect(text).toContain('Callers:');
        expect(text).toContain('login');
        expect(text).toContain('Test coverage:');
        expect(text).toContain('## Inheritance');
        expect(text).toContain('AuthService extends BaseService');
    });

    it('should format contract diffs in prompt output', () => {
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

        // Should contain new format with Changes line
        expect(text).toContain('Status: modified');
        expect(text).toContain('  Changes:');
        // Should contain contract diff details
        expect(text).toContain('- params: (id: number) -> (id: number, priority: number)');
        expect(text).toContain('- return_type: string -> string | null');
        // Should contain impact line
        expect(text).toContain('Impact: 2 callers may need param update; 2 callers may assume old return type');
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

        expect(text).toContain('# Code Review Context');
        expect(text).not.toContain('## Changed Functions');
    });
});

import { describe, expect, it } from 'bun:test';
import { buildContextV2 } from '../../src/analysis/context-builder';
import { formatXml } from '../../src/analysis/xml-formatter';
import type { GraphData } from '../../src/graph/types';

describe('formatXml', () => {
    it('renders <Alternatives>/<Alt> children for low-confidence ambiguous callers', () => {
        const graphData: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'validate',
                    qualified_name: 'src/feature/target.ts::validate',
                    file_path: 'src/feature/target.ts',
                    line_start: 10,
                    line_end: 20,
                    language: 'typescript',
                    params: '(x: string)',
                    return_type: 'boolean',
                    is_test: false,
                },
                {
                    kind: 'Function',
                    name: 'caller',
                    qualified_name: 'src/caller.ts::caller',
                    file_path: 'src/caller.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'src/caller.ts::caller',
                    target_qualified: 'src/feature/target.ts::validate',
                    file_path: 'src/caller.ts',
                    line: 5,
                    confidence: 0.3,
                    alternatives: ['src/other/m2.ts::validate', 'src/other/m3.ts::validate'],
                },
            ],
        };

        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: null,
            changedFiles: ['src/feature/target.ts'],
            minConfidence: 0.3,
            maxDepth: 3,
        });

        const xml = formatXml(output);

        expect(xml).toContain('<Alternatives>');
        expect(xml).toContain('<Alt>src/other/m2.ts::validate</Alt>');
        expect(xml).toContain('<Alt>src/other/m3.ts::validate</Alt>');
        expect(xml).toContain('</Alternatives>');
    });

    it('caps alternatives at 3 and emits an overflow comment', () => {
        const graphData: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'validate',
                    qualified_name: 'src/feature/target.ts::validate',
                    file_path: 'src/feature/target.ts',
                    line_start: 10,
                    line_end: 20,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Function',
                    name: 'caller',
                    qualified_name: 'src/caller.ts::caller',
                    file_path: 'src/caller.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'src/caller.ts::caller',
                    target_qualified: 'src/feature/target.ts::validate',
                    file_path: 'src/caller.ts',
                    line: 5,
                    confidence: 0.3,
                    alternatives: [
                        'src/m1.ts::validate',
                        'src/m2.ts::validate',
                        'src/m3.ts::validate',
                        'src/m4.ts::validate',
                        'src/m5.ts::validate',
                    ],
                },
            ],
        };

        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: null,
            changedFiles: ['src/feature/target.ts'],
            minConfidence: 0.3,
            maxDepth: 3,
        });

        const xml = formatXml(output);

        expect(xml).toContain('<Alternatives>');
        expect(xml).toContain('<!-- +2 more -->');
        expect(xml).not.toContain('<Alt>src/m4.ts::validate</Alt>');
        expect(xml).not.toContain('<Alt>src/m5.ts::validate</Alt>');
    });

    it('does NOT emit <Alternatives> for high-confidence callers', () => {
        const graphData: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'validate',
                    qualified_name: 'src/feature/target.ts::validate',
                    file_path: 'src/feature/target.ts',
                    line_start: 10,
                    line_end: 20,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Function',
                    name: 'caller',
                    qualified_name: 'src/caller.ts::caller',
                    file_path: 'src/caller.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'src/caller.ts::caller',
                    target_qualified: 'src/feature/target.ts::validate',
                    file_path: 'src/caller.ts',
                    line: 5,
                    confidence: 0.9,
                    alternatives: ['src/other.ts::validate'],
                },
            ],
        };

        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: null,
            changedFiles: ['src/feature/target.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const xml = formatXml(output);

        expect(xml).not.toContain('<Alternatives>');
    });

    it('emits <ContractDiff field="params"> with <Added>/<Removed> for long params', () => {
        const longBefore =
            '(context: ReviewContext, config: ReviewConfig, options: { tier: string, mode: string, priority: number })';
        const longAfter =
            '(context: ReviewContext, config: ReviewConfig, options: { tier: string, mode: string, priority: number }, byokConfig?: BYOKConfig)';

        const graphData: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'reviewPR',
                    qualified_name: 'src/review.ts::reviewPR',
                    file_path: 'src/review.ts',
                    line_start: 10,
                    line_end: 50,
                    language: 'typescript',
                    params: longAfter,
                    return_type: 'Promise<Result>',
                    is_test: false,
                    file_hash: 'n',
                },
            ],
            edges: [],
        };

        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: {
                nodes: [
                    {
                        kind: 'Function',
                        name: 'reviewPR',
                        qualified_name: 'src/review.ts::reviewPR',
                        file_path: 'src/review.ts',
                        line_start: 10,
                        line_end: 45,
                        language: 'typescript',
                        params: longBefore,
                        return_type: 'Promise<Result>',
                        is_test: false,
                        file_hash: 'n',
                        content_hash: 'old',
                    },
                ],
                edges: [],
            },
            changedFiles: ['src/review.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const xml = formatXml(output);
        expect(xml).toContain('<ContractDiff field="params">');
        expect(xml).toContain('<Added>byokConfig?: BYOKConfig</Added>');
        // Short before blob should NOT appear as a single before→after dump in the signal text
        expect(xml).not.toContain(`Parameters changed: ${longBefore}`);
    });

    it('emits <ContractDiff field="return_type"> with <Before>/<After> for long return_type', () => {
        const longRtBefore = 'Promise<UserResult<SomeVeryLongGenericArgs, AndAnotherOne, AndAThirdOne, AndOneMore>>';
        const longRtAfter =
            'Promise<UserResult<SomeVeryLongGenericArgs, AndAnotherOne, AndAThirdOne, AndOneMore> | null>';

        const graphData: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'loadUser',
                    qualified_name: 'src/u.ts::loadUser',
                    file_path: 'src/u.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    params: '(id: number)',
                    return_type: longRtAfter,
                    is_test: false,
                    file_hash: 'h',
                },
            ],
            edges: [],
        };

        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: {
                nodes: [
                    {
                        kind: 'Function',
                        name: 'loadUser',
                        qualified_name: 'src/u.ts::loadUser',
                        file_path: 'src/u.ts',
                        line_start: 1,
                        line_end: 5,
                        language: 'typescript',
                        params: '(id: number)',
                        return_type: longRtBefore,
                        is_test: false,
                        file_hash: 'h',
                        content_hash: 'o',
                    },
                ],
                edges: [],
            },
            changedFiles: ['src/u.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const xml = formatXml(output);
        expect(xml).toContain('<ContractDiff field="return_type">');
        expect(xml).toContain('<Before>');
        expect(xml).toContain('<After>');
        // Escaped generics
        expect(xml).toContain('&lt;');
        expect(xml).toContain('&gt;');
    });
});

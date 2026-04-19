import { describe, expect, it } from 'bun:test';
import { buildContextV2 } from '../../src/analysis/context-builder';
import { buildReviewFocusItems, formatXml } from '../../src/analysis/xml-formatter';
import type { CallerRef, EnrichedFunction, GraphData } from '../../src/graph/types';

function makeCaller(qn: string, name = qn.split('::').pop() || qn, line = 1): CallerRef {
    return {
        qualified_name: qn,
        name,
        file_path: qn.split('::')[0],
        line,
        confidence: 0.9,
    };
}

function makeFn(overrides: Partial<EnrichedFunction> & { qualified_name: string; name: string }): EnrichedFunction {
    return {
        kind: 'Function',
        signature: '()',
        file_path: overrides.qualified_name.split('::')[0],
        line_start: 1,
        line_end: 10,
        callers: [],
        callees: [],
        has_test_coverage: true,
        diff_changes: [],
        contract_diffs: [],
        is_new: false,
        in_flows: [],
        ...overrides,
    };
}

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

describe('ReviewFocus dedup', () => {
    it('merges params change + untested into one focus (not two)', () => {
        const fn = makeFn({
            qualified_name: 'src/shield.ts::getSeverityLevelShield',
            name: 'getSeverityLevelShield',
            has_test_coverage: false,
            contract_diffs: [
                {
                    field: 'params',
                    old_value: '(level: number)',
                    new_value: '(level: number, ctx: Context)',
                },
            ],
            callers: Array.from({ length: 7 }, (_, i) => makeCaller(`src/c${i}.ts::caller${i}`)),
        });

        const items = buildReviewFocusItems([fn], new Set());

        expect(items).toHaveLength(1);
        expect(items[0]).toContain('getSeverityLevelShield');
        expect(items[0]).toContain('7 callers');
        expect(items[0]).toContain('signature change');
        expect(items[0]).toContain('no test coverage');
    });

    it('throws + params combine into a single sentence', () => {
        const fn = makeFn({
            qualified_name: 'src/order.ts::processOrder',
            name: 'processOrder',
            contract_diffs: [
                {
                    field: 'throws',
                    old_value: '(none)',
                    new_value: 'ValidationError',
                },
                {
                    field: 'params',
                    old_value: '(order: Order)',
                    new_value: '(order: Order, ctx: Context)',
                },
            ],
            callers: Array.from({ length: 5 }, (_, i) => makeCaller(`src/c${i}.ts::caller${i}`)),
        });

        const items = buildReviewFocusItems([fn], new Set());

        expect(items).toHaveLength(1);
        expect(items[0]).toContain('processOrder');
        expect(items[0]).toContain('ValidationError');
        expect(items[0]).toContain('signature change');
    });

    it('throws alone emits a throws-focused sentence', () => {
        const fn = makeFn({
            qualified_name: 'src/auth.ts::authenticate',
            name: 'authenticate',
            contract_diffs: [
                {
                    field: 'throws',
                    old_value: '(none)',
                    new_value: 'AuthError',
                },
            ],
            callers: [
                makeCaller('src/a.ts::callerA'),
                makeCaller('src/b.ts::callerB'),
                makeCaller('src/c.ts::callerC'),
            ],
        });

        const items = buildReviewFocusItems([fn], new Set());

        expect(items).toHaveLength(1);
        expect(items[0]).toContain('authenticate');
        expect(items[0]).toContain('AuthError');
        expect(items[0]).toContain('new exception');
    });

    it('untested alone (no contract diff) emits an untested-focused sentence', () => {
        const fn = makeFn({
            qualified_name: 'src/req.ts::handleRequest',
            name: 'handleRequest',
            has_test_coverage: false,
            diff_changes: ['body'],
            callers: Array.from({ length: 4 }, (_, i) => makeCaller(`src/c${i}.ts::caller${i}`)),
        });

        const items = buildReviewFocusItems([fn], new Set());

        expect(items).toHaveLength(1);
        expect(items[0]).toContain('handleRequest');
        expect(items[0]).toContain('4 callers');
        expect(items[0]).toContain('no test coverage');
        expect(items[0]).toContain('body changes');
    });

    it('three distinct functions produce three focus items (no merge across functions)', () => {
        const fns: EnrichedFunction[] = [
            makeFn({
                qualified_name: 'src/a.ts::aFn',
                name: 'aFn',
                contract_diffs: [{ field: 'params', old_value: '()', new_value: '(x: number)' }],
                callers: [makeCaller('src/x.ts::x1'), makeCaller('src/x.ts::x2'), makeCaller('src/x.ts::x3')],
            }),
            makeFn({
                qualified_name: 'src/b.ts::bFn',
                name: 'bFn',
                contract_diffs: [{ field: 'return_type', old_value: 'string', new_value: 'string | null' }],
                callers: [makeCaller('src/y.ts::y1')],
            }),
            makeFn({
                qualified_name: 'src/c.ts::cFn',
                name: 'cFn',
                contract_diffs: [{ field: 'throws', old_value: '(none)', new_value: 'CError' }],
                callers: [makeCaller('src/z.ts::z1')],
            }),
        ];

        const items = buildReviewFocusItems(fns, new Set());

        expect(items).toHaveLength(3);
        expect(items[0]).toContain('aFn');
        expect(items[1]).toContain('bFn');
        expect(items[2]).toContain('cFn');
    });

    it('slice(0, 5) cap still applies after dedup', () => {
        const fns: EnrichedFunction[] = Array.from({ length: 8 }, (_, i) =>
            makeFn({
                qualified_name: `src/f${i}.ts::fn${i}`,
                name: `fn${i}`,
                contract_diffs: [{ field: 'params', old_value: '()', new_value: '(x: number)' }],
                callers: [
                    makeCaller(`src/x${i}.ts::x1`),
                    makeCaller(`src/x${i}.ts::x2`),
                    makeCaller(`src/x${i}.ts::x3`),
                ],
            }),
        );

        const items = buildReviewFocusItems(fns, new Set());

        expect(items.length).toBeLessThanOrEqual(5);
        expect(items).toHaveLength(5);
    });
});

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

    it('renders how each caller was resolved, so a guess cannot read as a fact', () => {
        // The resolver grades edges across five tiers, but every <Caller> used to
        // render byte-identically. A 0.60 unique-name guess and a 0.95
        // receiver-typed resolution reaching the model as the same assertion is
        // how a caller list turns into a confident wrong answer.
        const graphData: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'validate',
                    qualified_name: 'src/target.ts::validate',
                    file_path: 'src/target.ts',
                    line_start: 10,
                    line_end: 20,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Function',
                    name: 'sure',
                    qualified_name: 'src/sure.ts::sure',
                    file_path: 'src/sure.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Function',
                    name: 'guess',
                    qualified_name: 'src/guess.ts::guess',
                    file_path: 'src/guess.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                },
            ],
            edges: [
                {
                    kind: 'CALLS',
                    source_qualified: 'src/sure.ts::sure',
                    target_qualified: 'src/target.ts::validate',
                    file_path: 'src/sure.ts',
                    line: 3,
                    confidence: 0.95,
                    tier: 'receiver',
                },
                {
                    kind: 'CALLS',
                    source_qualified: 'src/guess.ts::guess',
                    target_qualified: 'src/target.ts::validate',
                    file_path: 'src/guess.ts',
                    line: 3,
                    confidence: 0.6,
                    tier: 'unique',
                },
            ],
        };

        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: null,
            changedFiles: ['src/target.ts'],
            minConfidence: 0.5,
            maxDepth: 3,
        });

        const xml = formatXml(output);

        expect(xml).toContain('<Caller name="sure" file="src/sure.ts" line="3" confidence="0.95" tier="receiver" />');
        expect(xml).toContain('<Caller name="guess" file="src/guess.ts" line="3" confidence="0.60" tier="unique" />');
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

    it('emits <Imports> and <Hierarchy> sections even when changedFunctions=0', () => {
        // A file with a class and an import, but no function-level content
        // change. Without the fix, XML is just a bare <Summary/> under
        // <CallGraph> (~137 bytes) — the prompt format still shows IMPORTS
        // and HIERARCHY sections. This test asserts parity.
        const graphData: GraphData = {
            nodes: [
                {
                    kind: 'Class',
                    name: 'Foo',
                    qualified_name: 'src/foo.ts::Foo',
                    file_path: 'src/foo.ts',
                    line_start: 1,
                    line_end: 20,
                    language: 'typescript',
                    is_test: false,
                },
                {
                    kind: 'Class',
                    name: 'Base',
                    qualified_name: 'src/base.ts::Base',
                    file_path: 'src/base.ts',
                    line_start: 1,
                    line_end: 15,
                    language: 'typescript',
                    is_test: false,
                },
            ],
            edges: [
                {
                    kind: 'IMPORTS',
                    source_qualified: 'src/foo.ts',
                    target_qualified: 'src/base.ts::Base',
                    file_path: 'src/foo.ts',
                    line: 1,
                },
                {
                    kind: 'INHERITS',
                    source_qualified: 'src/foo.ts::Foo',
                    target_qualified: 'src/base.ts::Base',
                    file_path: 'src/foo.ts',
                    line: 3,
                },
            ],
        };

        // No changes — oldGraph === mergedGraph means the structural diff is empty.
        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: graphData,
            changedFiles: ['src/foo.ts'],
            minConfidence: 0.3,
            maxDepth: 3,
        });

        const xml = formatXml(output);

        // Sanity: no changed functions (the scenario we care about).
        expect(xml).toContain('changedFunctions="0"');
        // Imports section appears with the deduped source→target pair.
        expect(xml).toContain('<Imports>');
        expect(xml).toContain('<Import source="src/foo.ts"');
        expect(xml).toContain('target="src/base.ts::Base"');
        expect(xml).toContain('</Imports>');
        // Hierarchy section lists the class (with its extends relationship).
        expect(xml).toContain('<Hierarchy>');
        expect(xml).toContain('<Class name="Foo" extends="Base"');
        expect(xml).toContain('</Hierarchy>');
    });

    it('dedups duplicate IMPORTS edges (same source→target emitted once)', () => {
        // Two `from assemble import …` in the same file would produce two
        // IMPORTS edges with identical (file_path, target_qualified) but
        // different lines. The renderer must show a single <Import> entry.
        const graphData: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'run',
                    qualified_name: 'src/caller.py::run',
                    file_path: 'src/caller.py',
                    line_start: 1,
                    line_end: 10,
                    language: 'python',
                    is_test: false,
                },
            ],
            edges: [
                {
                    kind: 'IMPORTS',
                    source_qualified: 'src/caller.py',
                    target_qualified: 'src/assemble.py',
                    file_path: 'src/caller.py',
                    line: 1,
                },
                {
                    kind: 'IMPORTS',
                    source_qualified: 'src/caller.py',
                    target_qualified: 'src/assemble.py',
                    file_path: 'src/caller.py',
                    line: 2,
                },
            ],
        };

        const output = buildContextV2({
            mergedGraph: graphData,
            oldGraph: graphData,
            changedFiles: ['src/caller.py'],
            minConfidence: 0.3,
            maxDepth: 3,
        });

        const xml = formatXml(output);

        const importMatches = xml.match(/<Import source="src\/caller\.py"/g) || [];
        expect(importMatches.length).toBe(1);
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

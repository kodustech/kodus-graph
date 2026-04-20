import { describe, expect, it } from 'bun:test';
import { computeBlastRadius } from '../../src/analysis/blast-radius';
import { GraphIndex } from '../../src/analysis/graph-index';
import { computeRiskScore } from '../../src/analysis/risk-score';
import { findTestGaps } from '../../src/analysis/test-gaps';
import type { GraphData } from '../../src/graph/types';

describe('findTestGaps', () => {
    it('should detect functions without TESTED_BY', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'untestedFn',
                    qualified_name: 'src/a.ts::untestedFn',
                    file_path: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
                {
                    kind: 'Function',
                    name: 'testedFn',
                    qualified_name: 'src/b.ts::testedFn',
                    file_path: 'src/b.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'b',
                },
            ],
            edges: [
                {
                    kind: 'TESTED_BY',
                    source_qualified: 'src/b.ts',
                    target_qualified: 'tests/b.test.ts',
                    file_path: 'tests/b.test.ts',
                    line: 0,
                },
            ],
        };

        const gaps = findTestGaps(graph, ['src/a.ts', 'src/b.ts']);
        expect(gaps.some((g) => g.function === 'src/a.ts::untestedFn')).toBe(true);
        expect(gaps.some((g) => g.function === 'src/b.ts::testedFn')).toBe(false);
    });

    it('aligns with risk-score untestedCount (test_gaps.length === N from "N/M untested" detail)', () => {
        // All three changed functions live in files with no TESTED_BY edge.
        // Risk-score's detail must say "3/3 untested" AND test_gaps must
        // contain 3 entries — both must match the same calculation.
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'a',
                    qualified_name: 'src/a.ts::a',
                    file_path: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
                {
                    kind: 'Function',
                    name: 'b',
                    qualified_name: 'src/b.ts::b',
                    file_path: 'src/b.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'b',
                },
                {
                    kind: 'Function',
                    name: 'c',
                    qualified_name: 'src/c.ts::c',
                    file_path: 'src/c.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'c',
                },
            ],
            edges: [],
        };
        const changedFiles = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
        const index = new GraphIndex(graph);
        const gaps = findTestGaps(graph, changedFiles, index);
        const blast = computeBlastRadius(graph, [], undefined, undefined, undefined, { index });
        const risk = computeRiskScore(graph, changedFiles, blast, { index });
        expect(risk.factors.test_gaps.value).toBe(1);
        expect(risk.factors.test_gaps.detail).toBe('3/3 untested');
        expect(gaps.length).toBe(3);
    });

    it('populates test_gaps entries with qualified name, file path, and line for each untested changed function', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'processOrder',
                    qualified_name: 'src/order.ts::processOrder',
                    file_path: 'src/order.ts',
                    line_start: 42,
                    line_end: 58,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'h1',
                },
            ],
            edges: [],
        };
        const gaps = findTestGaps(graph, ['src/order.ts']);
        expect(gaps).toHaveLength(1);
        expect(gaps[0]).toEqual({
            function: 'src/order.ts::processOrder',
            file_path: 'src/order.ts',
            line_start: 42,
        });
    });

    it('should not flag test files', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Test',
                    name: 'testFoo',
                    qualified_name: 'tests/a.test.ts::test:testFoo',
                    file_path: 'tests/a.test.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: true,
                    file_hash: 'a',
                },
            ],
            edges: [],
        };

        const gaps = findTestGaps(graph, ['tests/a.test.ts']);
        expect(gaps).toHaveLength(0);
    });
});

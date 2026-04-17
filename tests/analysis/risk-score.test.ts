import { describe, expect, it } from 'bun:test';
import { computeRiskScore } from '../../src/analysis/risk-score';
import type { BlastRadiusResult, GraphData } from '../../src/graph/types';

describe('computeRiskScore', () => {
    it('should return LOW for small blast radius with tests', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'foo',
                    qualified_name: 'src/a.ts::foo',
                    file_path: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
            ],
            edges: [
                {
                    kind: 'TESTED_BY',
                    source_qualified: 'src/a.ts::foo',
                    target_qualified: 'tests/a.test.ts::test_foo',
                    file_path: 'src/a.ts',
                    line: 0,
                },
            ],
        };
        const blastRadius: BlastRadiusResult = { total_functions: 1, total_files: 1, by_depth: {} };

        const result = computeRiskScore(graph, ['src/a.ts'], blastRadius);
        expect(result.level).toBe('LOW');
        expect(result.score).toBeLessThan(0.4);
    });

    it('should return HIGH for large blast radius without tests', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'core',
                    qualified_name: 'src/core.ts::core',
                    file_path: 'src/core.ts',
                    line_start: 1,
                    line_end: 100,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
            ],
            edges: [],
        };
        const blastRadius: BlastRadiusResult = { total_functions: 20, total_files: 10, by_depth: {} };

        const result = computeRiskScore(graph, ['src/core.ts'], blastRadius);
        expect(result.level).toBe('HIGH');
        expect(result.score).toBeGreaterThan(0.6);
    });

    it('should include 4 risk factors', () => {
        const graph: GraphData = { nodes: [], edges: [] };
        const blastRadius: BlastRadiusResult = { total_functions: 5, total_files: 3, by_depth: {} };

        const result = computeRiskScore(graph, ['src/a.ts'], blastRadius);
        expect(result.factors).toHaveProperty('blast_radius');
        expect(result.factors).toHaveProperty('test_gaps');
        expect(result.factors).toHaveProperty('complexity');
        expect(result.factors).toHaveProperty('inheritance');
    });

    it('should correctly detect tested files via TESTED_BY edge file_path', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'foo',
                    qualified_name: 'src/a.ts::foo',
                    file_path: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
            ],
            edges: [
                {
                    kind: 'TESTED_BY',
                    source_qualified: 'src/a.ts::foo',
                    target_qualified: 'tests/a.test.ts::test_foo',
                    file_path: 'src/a.ts',
                    line: 0,
                },
            ],
        };
        const blastRadius: BlastRadiusResult = { total_functions: 1, total_files: 1, by_depth: {} };

        const result = computeRiskScore(graph, ['src/a.ts'], blastRadius);
        expect(result.factors.test_gaps.value).toBe(0);
        expect(result.factors.test_gaps.detail).toBe('0/1 untested');
    });

    it('should use cyclomatic complexity from GraphNode.complexity when present', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'foo',
                    qualified_name: 'src/a.ts::foo',
                    file_path: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    complexity: 20,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
            ],
            edges: [],
        };
        const blastRadius: BlastRadiusResult = { total_functions: 1, total_files: 1, by_depth: {} };

        const result = computeRiskScore(graph, ['src/a.ts'], blastRadius);
        // With default cap of 50, avg cyclomatic 20 → 20/50 = 0.4
        expect(result.factors.complexity.value).toBe(0.4);
        expect(result.factors.complexity.detail).toBe('avg cyclomatic 20');
    });

    it('should fall back to lines-of-code when complexity is missing (legacy graphs)', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'foo',
                    qualified_name: 'src/a.ts::foo',
                    file_path: 'src/a.ts',
                    line_start: 1,
                    line_end: 101,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
            ],
            edges: [],
        };
        const blastRadius: BlastRadiusResult = { total_functions: 1, total_files: 1, by_depth: {} };

        const result = computeRiskScore(graph, ['src/a.ts'], blastRadius);
        // avg size = 100 lines, cap 50 → min(100/50, 1) = 1
        expect(result.factors.complexity.value).toBe(1);
        expect(result.factors.complexity.detail).toBe('avg 100 lines (legacy)');
    });

    it('should average cyclomatic over only nodes that have complexity in mixed graphs', () => {
        const graph: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'withCx',
                    qualified_name: 'src/a.ts::withCx',
                    file_path: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    complexity: 10,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
                {
                    kind: 'Function',
                    name: 'noCx',
                    qualified_name: 'src/a.ts::noCx',
                    file_path: 'src/a.ts',
                    line_start: 10,
                    line_end: 500,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
            ],
            edges: [],
        };
        const blastRadius: BlastRadiusResult = { total_functions: 2, total_files: 1, by_depth: {} };

        const result = computeRiskScore(graph, ['src/a.ts'], blastRadius);
        // Only the node with complexity is used: avg cyclomatic = 10, 10/50 = 0.2
        expect(result.factors.complexity.value).toBe(0.2);
        expect(result.factors.complexity.detail).toContain('avg cyclomatic 10');
    });
});

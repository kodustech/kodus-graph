import { describe, expect, it } from 'bun:test';
import type { DiffResult } from '../../src/analysis/diff';
import { enrichChangedFunctions } from '../../src/analysis/enrich';
import type { Flow } from '../../src/analysis/flows';
import { indexGraph } from '../../src/graph/loader';
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
            kind: 'Function',
            name: 'findUser',
            qualified_name: 'src/db.ts::findUser',
            file_path: 'src/db.ts',
            line_start: 1,
            line_end: 5,
            language: 'typescript',
            params: '(id: number)',
            return_type: 'User | null',
            is_test: false,
            file_hash: 'c',
        },
        {
            kind: 'Test',
            name: 'test auth',
            qualified_name: 'tests/auth.test.ts::test auth',
            file_path: 'tests/auth.test.ts',
            line_start: 1,
            line_end: 10,
            language: 'typescript',
            is_test: true,
            file_hash: 'd',
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
            kind: 'CALLS',
            source_qualified: 'src/auth.ts::authenticate',
            target_qualified: 'src/db.ts::findUser',
            file_path: 'src/auth.ts',
            line: 15,
            confidence: 0.85,
        },
        {
            kind: 'TESTED_BY',
            source_qualified: 'src/auth.ts',
            target_qualified: 'tests/auth.test.ts::test auth',
            file_path: 'src/auth.ts',
            line: 0,
        },
    ],
};

const diff: DiffResult = {
    changed_files: ['src/auth.ts'],
    summary: { added: 0, removed: 0, modified: 1 },
    nodes: {
        added: [],
        removed: [],
        modified: [{ qualified_name: 'src/auth.ts::authenticate', changes: ['params'] }],
    },
    edges: { added: [], removed: [] },
    risk_by_file: { 'src/auth.ts': { dependents: 1, risk: 'LOW' } },
};

const allFlows: Flow[] = [
    {
        entry_point: 'src/ctrl.ts::login',
        type: 'http',
        depth: 2,
        node_count: 3,
        file_count: 3,
        criticality: 9,
        path: ['src/ctrl.ts::login', 'src/auth.ts::authenticate', 'src/db.ts::findUser'],
    },
];

describe('enrichChangedFunctions', () => {
    it('should enrich changed functions with callers, callees, diff, flows, coverage', () => {
        const indexed = indexGraph(graphData);
        const result = enrichChangedFunctions(indexed, ['src/auth.ts'], diff, allFlows, 0.5);

        expect(result).toHaveLength(1);
        const fn = result[0];

        expect(fn.qualified_name).toBe('src/auth.ts::authenticate');
        expect(fn.signature).toBe('authenticate(ctx: Context) -> Result');
        expect(fn.callers).toHaveLength(1);
        expect(fn.callers[0].name).toBe('login');
        expect(fn.callers[0].confidence).toBe(0.9);
        expect(fn.callees).toHaveLength(1);
        expect(fn.callees[0].name).toBe('findUser');
        expect(fn.callees[0].signature).toBe('findUser(id: number) -> User | null');
        expect(fn.has_test_coverage).toBe(true);
        expect(fn.diff_changes).toEqual(['params']);
        expect(fn.is_new).toBe(false);
        expect(fn.in_flows).toEqual(['src/ctrl.ts::login']);
    });

    it('should filter callers below min-confidence', () => {
        const indexed = indexGraph(graphData);
        const result = enrichChangedFunctions(indexed, ['src/auth.ts'], diff, allFlows, 0.95);

        expect(result[0].callers).toHaveLength(0);
    });

    it('should mark new functions as is_new with empty diff_changes', () => {
        const diffWithNew: DiffResult = {
            changed_files: ['src/auth.ts'],
            summary: { added: 1, removed: 0, modified: 0 },
            nodes: {
                added: [
                    {
                        qualified_name: 'src/auth.ts::authenticate',
                        kind: 'Function',
                        file_path: 'src/auth.ts',
                        line_start: 10,
                        line_end: 25,
                    },
                ],
                removed: [],
                modified: [],
            },
            edges: { added: [], removed: [] },
            risk_by_file: {},
        };

        const indexed = indexGraph(graphData);
        const result = enrichChangedFunctions(indexed, ['src/auth.ts'], diffWithNew, [], 0.5);

        expect(result[0].is_new).toBe(true);
        expect(result[0].diff_changes).toEqual([]);
    });

    it('should skip Test and Constructor nodes', () => {
        const indexed = indexGraph(graphData);
        const result = enrichChangedFunctions(indexed, ['tests/auth.test.ts'], diff, [], 0.5);
        expect(result).toHaveLength(0);
    });

    it('should exclude unchanged functions when onlyChanged=true', () => {
        // Graph has authenticate (modified) and login (unchanged) in changed files
        const graphWithTwoChanged: GraphData = {
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
                    file_hash: 'a',
                },
            ],
            edges: [],
        };

        const diffWithOneModified: DiffResult = {
            changed_files: ['src/auth.ts'],
            summary: { added: 0, removed: 0, modified: 1 },
            nodes: {
                added: [],
                removed: [],
                modified: [{ qualified_name: 'src/auth.ts::authenticate', changes: ['params'], contract_diffs: [] }],
            },
            edges: { added: [], removed: [] },
            risk_by_file: {},
        };

        const indexed = indexGraph(graphWithTwoChanged);

        // onlyChanged=true: only authenticate (modified) should appear
        const resultOnly = enrichChangedFunctions(indexed, ['src/auth.ts'], diffWithOneModified, [], 0.5, true);
        expect(resultOnly).toHaveLength(1);
        expect(resultOnly[0].qualified_name).toBe('src/auth.ts::authenticate');

        // validate should NOT appear even though it's in the changed file
    });

    it('should include all functions in changed files when onlyChanged=false (backward compat)', () => {
        const graphWithTwoFns: GraphData = {
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
                    file_hash: 'a',
                },
            ],
            edges: [],
        };

        const diffWithOneModified: DiffResult = {
            changed_files: ['src/auth.ts'],
            summary: { added: 0, removed: 0, modified: 1 },
            nodes: {
                added: [],
                removed: [],
                modified: [{ qualified_name: 'src/auth.ts::authenticate', changes: ['params'], contract_diffs: [] }],
            },
            edges: { added: [], removed: [] },
            risk_by_file: {},
        };

        const indexed = indexGraph(graphWithTwoFns);

        // onlyChanged=false (default): both functions should appear
        const resultAll = enrichChangedFunctions(indexed, ['src/auth.ts'], diffWithOneModified, [], 0.5, false);
        expect(resultAll).toHaveLength(2);
        const qns = resultAll.map((f) => f.qualified_name).sort();
        expect(qns).toEqual(['src/auth.ts::authenticate', 'src/auth.ts::validate']);
    });

    it('should include added functions when onlyChanged=true', () => {
        const graphWithNewFn: GraphData = {
            nodes: [
                {
                    kind: 'Function',
                    name: 'newHelper',
                    qualified_name: 'src/auth.ts::newHelper',
                    file_path: 'src/auth.ts',
                    line_start: 50,
                    line_end: 60,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
                {
                    kind: 'Function',
                    name: 'existingFn',
                    qualified_name: 'src/auth.ts::existingFn',
                    file_path: 'src/auth.ts',
                    line_start: 1,
                    line_end: 10,
                    language: 'typescript',
                    is_test: false,
                    file_hash: 'a',
                },
            ],
            edges: [],
        };

        const diffWithAdded: DiffResult = {
            changed_files: ['src/auth.ts'],
            summary: { added: 1, removed: 0, modified: 0 },
            nodes: {
                added: [
                    {
                        qualified_name: 'src/auth.ts::newHelper',
                        kind: 'Function',
                        file_path: 'src/auth.ts',
                        line_start: 50,
                        line_end: 60,
                    },
                ],
                removed: [],
                modified: [],
            },
            edges: { added: [], removed: [] },
            risk_by_file: {},
        };

        const indexed = indexGraph(graphWithNewFn);
        const result = enrichChangedFunctions(indexed, ['src/auth.ts'], diffWithAdded, [], 0.5, true);

        // Only newHelper (added) should appear; existingFn is unchanged
        expect(result).toHaveLength(1);
        expect(result[0].qualified_name).toBe('src/auth.ts::newHelper');
        expect(result[0].is_new).toBe(true);
    });
});

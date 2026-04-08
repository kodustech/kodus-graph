import { describe, expect, it } from 'bun:test';
import { deriveEdges, extractTestStem } from '../../src/graph/edges';
import type { ImportEdge, RawGraph } from '../../src/graph/types';

describe('extractTestStem', () => {
    it('should extract stem from Ruby spec files', () => {
        expect(extractTestStem('spec/models/user_spec.rb')).toBe('user');
    });

    it('should extract stem from Python test files', () => {
        expect(extractTestStem('tests/test_auth.py')).toBe('auth');
        expect(extractTestStem('tests/auth_test.py')).toBe('auth');
    });

    it('should extract stem from JS/TS test files', () => {
        expect(extractTestStem('src/__tests__/auth.test.ts')).toBe('auth');
        expect(extractTestStem('tests/auth.spec.tsx')).toBe('auth');
    });

    it('should extract stem from Java test files', () => {
        expect(extractTestStem('test/UserTest.java')).toBe('User');
    });

    it('should return null for non-test files', () => {
        expect(extractTestStem('src/auth.ts')).toBeNull();
        expect(extractTestStem('lib/user.rb')).toBeNull();
    });

    it('should return null for empty stem', () => {
        expect(extractTestStem('Test.java')).toBeNull();
    });
});

describe('deriveEdges', () => {
    it('should derive INHERITS edges from class extends', () => {
        const graph: RawGraph = {
            functions: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
            classes: [
                {
                    name: 'Admin',
                    file: 'src/admin.ts',
                    line_start: 1,
                    line_end: 10,
                    extends: 'User',
                    implements: '',
                    qualified: 'src/admin.ts::Admin',
                },
            ],
        };
        const result = deriveEdges(graph, []);
        expect(result.inherits.some((e) => e.source === 'src/admin.ts::Admin' && e.target === 'User')).toBe(true);
    });

    it('should derive TESTED_BY edges from test file imports', () => {
        const graph: RawGraph = {
            functions: [],
            classes: [],
            interfaces: [],
            enums: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
            tests: [
                {
                    name: 'test auth',
                    file: 'tests/auth.test.ts',
                    line_start: 1,
                    line_end: 5,
                    qualified: 'tests/auth.test.ts::test:test auth',
                },
            ],
        };
        const importEdges: ImportEdge[] = [
            { source: 'tests/auth.test.ts', target: 'src/auth.ts', resolved: true, line: 1 },
        ];
        const result = deriveEdges(graph, importEdges);
        expect(result.testedBy.some((e) => e.source === 'src/auth.ts' && e.target === 'tests/auth.test.ts')).toBe(true);
    });

    it('should derive TESTED_BY edges from file-name matching (Ruby spec)', () => {
        const graph: RawGraph = {
            functions: [
                {
                    name: 'validate',
                    file: 'app/models/user.rb',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Method',
                    className: 'User',
                    qualified: 'app/models/user.rb::User.validate',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
            tests: [
                {
                    name: 'validates user',
                    file: 'spec/models/user_spec.rb',
                    line_start: 1,
                    line_end: 10,
                    qualified: 'spec/models/user_spec.rb::test:validates user',
                },
            ],
        };
        const result = deriveEdges(graph, []);
        expect(result.testedBy).toHaveLength(1);
        expect(result.testedBy[0].source).toBe('app/models/user.rb');
        expect(result.testedBy[0].target).toBe('spec/models/user_spec.rb');
    });

    it('should deduplicate TESTED_BY edges from both heuristics', () => {
        const graph: RawGraph = {
            functions: [
                {
                    name: 'login',
                    file: 'src/auth.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    className: '',
                    qualified: 'src/auth.ts::login',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
            tests: [
                {
                    name: 'test login',
                    file: 'tests/auth.test.ts',
                    line_start: 1,
                    line_end: 10,
                    qualified: 'tests/auth.test.ts::test:test login',
                },
            ],
        };
        const importEdges: ImportEdge[] = [
            { source: 'tests/auth.test.ts', target: 'src/auth.ts', resolved: true, line: 1 },
        ];
        // Both heuristics match the same pair — should produce only 1 edge
        const result = deriveEdges(graph, importEdges);
        const authEdges = result.testedBy.filter(
            (e) => e.source === 'src/auth.ts' && e.target === 'tests/auth.test.ts',
        );
        expect(authEdges).toHaveLength(1);
    });

    it('should derive CONTAINS edges for functions in files', () => {
        const graph: RawGraph = {
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
            functions: [
                {
                    name: 'foo',
                    file: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    className: '',
                    qualified: 'src/a.ts::foo',
                },
            ],
        };
        const result = deriveEdges(graph, []);
        expect(result.contains.some((e) => e.source === 'src/a.ts' && e.target === 'src/a.ts::foo')).toBe(true);
    });

    it('should derive IMPLEMENTS edges from class implements', () => {
        const graph: RawGraph = {
            functions: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
            classes: [
                {
                    name: 'AuthService',
                    file: 'src/auth.ts',
                    line_start: 1,
                    line_end: 50,
                    extends: '',
                    implements: 'IAuthService',
                    qualified: 'src/auth.ts::AuthService',
                },
            ],
        };
        const result = deriveEdges(graph, []);
        expect(
            result.implements.some((e) => e.source === 'src/auth.ts::AuthService' && e.target === 'IAuthService'),
        ).toBe(true);
    });
});

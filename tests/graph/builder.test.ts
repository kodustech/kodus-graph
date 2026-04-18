import { describe, expect, it } from 'bun:test';
import { buildGraphData } from '../../src/graph/builder';
import type { RawCallEdge, RawGraph } from '../../src/graph/types';
import { getCapabilitiesFor } from '../../src/languages/capabilities';
// Ensure language capabilities are registered — `parser/extractor` imports
// every language barrel, triggering side-effect registration of extractors
// and their capability entries.
import '../../src/parser/extractor';

describe('buildGraphData', () => {
    it('should convert raw graph to GraphData with correct node kinds', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'foo',
                    file: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '(x: number)',
                    returnType: 'void',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/a.ts::foo',
                },
            ],
            classes: [
                {
                    name: 'Bar',
                    file: 'src/a.ts',
                    line_start: 10,
                    line_end: 20,
                    extends: '',
                    implements: [],
                    ast_kind: 'class_declaration',
                    qualified: 'src/a.ts::Bar',
                },
            ],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };

        const result = buildGraphData(raw, [], [], 'src', new Map());

        expect(result.nodes.some((n) => n.kind === 'Function' && n.name === 'foo')).toBe(true);
        expect(result.nodes.some((n) => n.kind === 'Class' && n.name === 'Bar')).toBe(true);
    });

    it('should include CALLS edges in output', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'caller',
                    file: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/a.ts::caller',
                },
                {
                    name: 'callee',
                    file: 'src/b.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/b.ts::callee',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };
        const callEdges: RawCallEdge[] = [
            { source: 'src/a.ts', target: 'src/b.ts::callee', callName: 'callee', line: 3, confidence: 0.85 },
        ];

        const result = buildGraphData(raw, callEdges, [], 'src', new Map());

        expect(result.edges.some((e) => e.kind === 'CALLS' && e.target_qualified === 'src/b.ts::callee')).toBe(true);
    });

    it('should resolve caller function from line number instead of ::unknown', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'myFunction',
                    file: 'src/a.ts',
                    line_start: 10,
                    line_end: 20,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/a.ts::myFunction',
                },
                {
                    name: 'helper',
                    file: 'src/b.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/b.ts::helper',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };
        const callEdges: RawCallEdge[] = [
            { source: 'src/a.ts', target: 'src/b.ts::helper', callName: 'helper', line: 15, confidence: 0.85 },
        ];

        const result = buildGraphData(raw, callEdges, [], 'src', new Map());
        const callEdge = result.edges.find((e) => e.kind === 'CALLS');

        expect(callEdge?.source_qualified).toBe('src/a.ts::myFunction');
    });

    it('should resolve to innermost function for nested scopes', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'outer',
                    file: 'src/a.ts',
                    line_start: 1,
                    line_end: 30,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/a.ts::outer',
                },
                {
                    name: 'inner',
                    file: 'src/a.ts',
                    line_start: 10,
                    line_end: 20,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/a.ts::inner',
                },
                {
                    name: 'helper',
                    file: 'src/b.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/b.ts::helper',
                },
                {
                    name: 'other',
                    file: 'src/b.ts',
                    line_start: 7,
                    line_end: 12,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/b.ts::other',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };
        const callEdges: RawCallEdge[] = [
            // Call inside inner function
            { source: 'src/a.ts', target: 'src/b.ts::helper', callName: 'helper', line: 15, confidence: 0.85 },
            // Call inside outer but outside inner
            { source: 'src/a.ts', target: 'src/b.ts::other', callName: 'other', line: 25, confidence: 0.85 },
        ];

        const result = buildGraphData(raw, callEdges, [], 'src', new Map());
        const calls = result.edges.filter((e) => e.kind === 'CALLS');

        expect(calls.find((e) => e.target_qualified === 'src/b.ts::helper')?.source_qualified).toBe('src/a.ts::inner');
        expect(calls.find((e) => e.target_qualified === 'src/b.ts::other')?.source_qualified).toBe('src/a.ts::outer');
    });

    it('should fallback to ::unknown for top-level calls outside any function', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'myFunction',
                    file: 'src/a.py',
                    line_start: 10,
                    line_end: 20,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_definition',
                    className: '',
                    qualified: 'src/a.py::myFunction',
                },
                {
                    name: 'init',
                    file: 'src/b.py',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_definition',
                    className: '',
                    qualified: 'src/b.py::init',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };
        const callEdges: RawCallEdge[] = [
            // Module-level call (line 3 is before any function)
            { source: 'src/a.py', target: 'src/b.py::init', callName: 'init', line: 3, confidence: 0.5 },
        ];

        const result = buildGraphData(raw, callEdges, [], 'src', new Map());
        const callEdge = result.edges.find((e) => e.kind === 'CALLS');

        // Top-level calls with no enclosing function are skipped (no ::unknown edges)
        expect(callEdge).toBeUndefined();
    });

    it('should resolve method calls within class methods (Python-style)', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'get_result',
                    file: 'src/paginator.py',
                    line_start: 135,
                    line_end: 214,
                    params: '(self, limit=100)',
                    returnType: '',
                    kind: 'Method',
                    ast_kind: 'function_definition',
                    className: 'BasePaginator',
                    qualified: 'src/paginator.py::BasePaginator.get_result',
                },
                {
                    name: 'count_hits',
                    file: 'src/paginator.py',
                    line_start: 216,
                    line_end: 217,
                    params: '(self, max_hits)',
                    returnType: '',
                    kind: 'Method',
                    ast_kind: 'function_definition',
                    className: 'BasePaginator',
                    qualified: 'src/paginator.py::BasePaginator.count_hits',
                },
            ],
            classes: [
                {
                    name: 'BasePaginator',
                    file: 'src/paginator.py',
                    line_start: 60,
                    line_end: 220,
                    extends: '',
                    implements: [],
                    ast_kind: 'class_definition',
                    qualified: 'src/paginator.py::BasePaginator',
                },
            ],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };
        const callEdges: RawCallEdge[] = [
            // count_hits() called from within get_result at line 157
            {
                source: 'src/paginator.py',
                target: 'src/paginator.py::BasePaginator.count_hits',
                callName: 'count_hits',
                line: 157,
                confidence: 0.85,
            },
        ];

        const result = buildGraphData(raw, callEdges, [], 'src', new Map());
        const callEdge = result.edges.find((e) => e.kind === 'CALLS');

        expect(callEdge?.source_qualified).toBe('src/paginator.py::BasePaginator.get_result');
    });

    it('should handle multiple classes in the same file', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'methodA',
                    file: 'src/service.ts',
                    line_start: 5,
                    line_end: 15,
                    params: '()',
                    returnType: '',
                    kind: 'Method',
                    ast_kind: 'method_definition',
                    className: 'ServiceA',
                    qualified: 'src/service.ts::ServiceA.methodA',
                },
                {
                    name: 'methodB',
                    file: 'src/service.ts',
                    line_start: 25,
                    line_end: 35,
                    params: '()',
                    returnType: '',
                    kind: 'Method',
                    ast_kind: 'method_definition',
                    className: 'ServiceB',
                    qualified: 'src/service.ts::ServiceB.methodB',
                },
                {
                    name: 'query',
                    file: 'src/db.ts',
                    line_start: 1,
                    line_end: 10,
                    params: '(sql: string)',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/db.ts::query',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };
        const callEdges: RawCallEdge[] = [
            { source: 'src/service.ts', target: 'src/db.ts::query', callName: 'query', line: 10, confidence: 0.9 },
            { source: 'src/service.ts', target: 'src/db.ts::query', callName: 'query', line: 30, confidence: 0.9 },
        ];

        const result = buildGraphData(raw, callEdges, [], 'src', new Map());
        const calls = result.edges.filter((e) => e.kind === 'CALLS');

        expect(calls[0].source_qualified).toBe('src/service.ts::ServiceA.methodA');
        expect(calls[1].source_qualified).toBe('src/service.ts::ServiceB.methodB');
    });

    it('should include derived edges (INHERITS, CONTAINS, etc)', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'foo',
                    file: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/a.ts::foo',
                },
            ],
            classes: [
                {
                    name: 'User',
                    file: 'src/a.ts',
                    line_start: 7,
                    line_end: 9,
                    extends: '',
                    implements: [],
                    ast_kind: 'class_declaration',
                    qualified: 'src/a.ts::User',
                },
                {
                    name: 'Admin',
                    file: 'src/a.ts',
                    line_start: 10,
                    line_end: 30,
                    extends: 'User',
                    implements: [],
                    ast_kind: 'class_declaration',
                    qualified: 'src/a.ts::Admin',
                },
            ],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };

        const result = buildGraphData(raw, [], [], 'src', new Map());

        expect(result.edges.some((e) => e.kind === 'CONTAINS')).toBe(true);
        expect(result.edges.some((e) => e.kind === 'INHERITS' && e.target_qualified === 'src/a.ts::User')).toBe(true);
    });

    it('should filter out CALLS edges to external packages', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'handler',
                    file: 'src/page.ts',
                    line_start: 1,
                    line_end: 10,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/page.ts::handler',
                },
                {
                    name: 'helper',
                    file: 'src/utils.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/utils.ts::helper',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };
        const callEdges: RawCallEdge[] = [
            // Internal call — should be kept
            { source: 'src/page.ts', target: 'src/utils.ts::helper', callName: 'helper', line: 3, confidence: 0.9 },
            // External call — should be filtered out
            {
                source: 'src/page.ts',
                target: 'next/navigation::useRouter',
                callName: 'useRouter',
                line: 5,
                confidence: 0.5,
            },
        ];

        const result = buildGraphData(raw, callEdges, [], 'src', new Map());
        const calls = result.edges.filter((e) => e.kind === 'CALLS');

        expect(calls).toHaveLength(1);
        expect(calls[0].target_qualified).toBe('src/utils.ts::helper');
    });

    // ── GraphNode.language uses canonical registry keys (Phase 3.5 Task 2) ──
    // `detectLang` previously emitted lowercase legacy keys ('typescript', 'javascript')
    // that diverged from the canonical registry keys used by `registerExtractor`,
    // `getCapabilitiesFor`, `getNoiseFor`, etc. These tests pin the canonical
    // output so consumers can look up capabilities via `node.language` directly.
    it('emits canonical "TypeScript" for .ts files (not lowercase "typescript")', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'foo',
                    file: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/a.ts::foo',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };

        const result = buildGraphData(raw, [], [], 'src', new Map());
        const node = result.nodes.find((n) => n.name === 'foo');
        expect(node?.language).toBe('TypeScript');
    });

    it('emits canonical "Tsx" for .tsx files', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'Page',
                    file: 'src/page.tsx',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/page.tsx::Page',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };

        const result = buildGraphData(raw, [], [], 'src', new Map());
        const node = result.nodes.find((n) => n.name === 'Page');
        expect(node?.language).toBe('Tsx');
    });

    it('emits canonical "JavaScript" for .js files (not lowercase "javascript")', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'bar',
                    file: 'src/b.js',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/b.js::bar',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };

        const result = buildGraphData(raw, [], [], 'src', new Map());
        const node = result.nodes.find((n) => n.name === 'bar');
        expect(node?.language).toBe('JavaScript');
    });

    it('emits lowercase "python" for .py files (matches registry key)', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'g',
                    file: 'src/a.py',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_definition',
                    className: '',
                    qualified: 'src/a.py::g',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };

        const result = buildGraphData(raw, [], [], 'src', new Map());
        const node = result.nodes.find((n) => n.name === 'g');
        expect(node?.language).toBe('python');
    });

    // Cross-registry sanity: `GraphNode.language` must map directly into the
    // capabilities registry without any translation layer. Pre-Phase-3.5 this
    // was broken — `'typescript'` (lowercase) did not resolve because caps
    // registered under `'TypeScript'`. Post-fix, `node.language` is the key.
    it('GraphNode.language is a valid key into the capabilities registry', () => {
        const raw: RawGraph = {
            functions: [
                {
                    name: 'tsFn',
                    file: 'src/a.ts',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/a.ts::tsFn',
                },
                {
                    name: 'goFn',
                    file: 'src/a.go',
                    line_start: 1,
                    line_end: 5,
                    params: '()',
                    returnType: '',
                    kind: 'Function',
                    ast_kind: 'function_declaration',
                    className: '',
                    qualified: 'src/a.go::goFn',
                },
            ],
            classes: [],
            interfaces: [],
            enums: [],
            tests: [],
            imports: [],
            reExports: [],
            rawCalls: [],
            diMaps: new Map(),
        };

        const result = buildGraphData(raw, [], [], 'src', new Map());
        const tsNode = result.nodes.find((n) => n.name === 'tsFn');
        const goNode = result.nodes.find((n) => n.name === 'goFn');

        // TypeScript caps exist and include async + exceptions + decorators.
        const tsCaps = getCapabilitiesFor(tsNode!.language);
        expect(tsCaps).not.toBeNull();
        expect(tsCaps?.hasAsync).toBe(true);

        // Go caps exist and exclude async + exceptions (register-level truth
        // that `applicableContractDiffs` relies on for suppression).
        const goCaps = getCapabilitiesFor(goNode!.language);
        expect(goCaps).not.toBeNull();
        expect(goCaps?.hasAsync).toBe(false);
        expect(goCaps?.hasExceptions).toBe(false);
    });
});

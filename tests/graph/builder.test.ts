import { describe, expect, it } from 'bun:test';
import { buildGraphData } from '../../src/graph/builder';
import type { RawCallEdge, RawGraph } from '../../src/graph/types';

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
          implements: '',
          qualified: 'src/a.ts::Bar',
        },
      ],
      interfaces: [],
      enums: [],
      tests: [],
      imports: [],
      reExports: [],
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
          className: '',
          qualified: 'src/a.ts::myFunction',
        },
      ],
      classes: [],
      interfaces: [],
      enums: [],
      tests: [],
      imports: [],
      reExports: [],
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
          className: '',
          qualified: 'src/a.ts::inner',
        },
      ],
      classes: [],
      interfaces: [],
      enums: [],
      tests: [],
      imports: [],
      reExports: [],
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
          className: '',
          qualified: 'src/a.py::myFunction',
        },
      ],
      classes: [],
      interfaces: [],
      enums: [],
      tests: [],
      imports: [],
      reExports: [],
      diMaps: new Map(),
    };
    const callEdges: RawCallEdge[] = [
      // Module-level call (line 3 is before any function)
      { source: 'src/a.py', target: 'src/b.py::init', callName: 'init', line: 3, confidence: 0.5 },
    ];

    const result = buildGraphData(raw, callEdges, [], 'src', new Map());
    const callEdge = result.edges.find((e) => e.kind === 'CALLS');

    expect(callEdge?.source_qualified).toBe('src/a.py::unknown');
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
          implements: '',
          qualified: 'src/paginator.py::BasePaginator',
        },
      ],
      interfaces: [],
      enums: [],
      tests: [],
      imports: [],
      reExports: [],
      diMaps: new Map(),
    };
    const callEdges: RawCallEdge[] = [
      // count_hits() called from within get_result at line 157
      { source: 'src/paginator.py', target: 'src/paginator.py::BasePaginator.count_hits', callName: 'count_hits', line: 157, confidence: 0.85 },
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
          className: 'ServiceB',
          qualified: 'src/service.ts::ServiceB.methodB',
        },
      ],
      classes: [],
      interfaces: [],
      enums: [],
      tests: [],
      imports: [],
      reExports: [],
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
          className: '',
          qualified: 'src/a.ts::foo',
        },
      ],
      classes: [
        {
          name: 'Admin',
          file: 'src/a.ts',
          line_start: 10,
          line_end: 30,
          extends: 'User',
          implements: '',
          qualified: 'src/a.ts::Admin',
        },
      ],
      interfaces: [],
      enums: [],
      tests: [],
      imports: [],
      reExports: [],
      diMaps: new Map(),
    };

    const result = buildGraphData(raw, [], [], 'src', new Map());

    expect(result.edges.some((e) => e.kind === 'CONTAINS')).toBe(true);
    expect(result.edges.some((e) => e.kind === 'INHERITS')).toBe(true);
  });
});

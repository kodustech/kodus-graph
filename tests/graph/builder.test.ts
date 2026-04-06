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

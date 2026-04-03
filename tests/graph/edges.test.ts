import { describe, it, expect } from 'bun:test';
import { deriveEdges } from '../../src/graph/edges';
import type { RawGraph, ImportEdge } from '../../src/graph/types';

describe('deriveEdges', () => {
  it('should derive INHERITS edges from class extends', () => {
    const graph: RawGraph = {
      functions: [], interfaces: [], enums: [], tests: [],
      imports: [], reExports: [], diMaps: new Map(),
      classes: [
        { name: 'Admin', file: 'src/admin.ts', line_start: 1, line_end: 10, extends: 'User', implements: '', qualified: 'src/admin.ts::Admin' },
      ],
    };
    const result = deriveEdges(graph, []);
    expect(result.inherits.some(e => e.source === 'src/admin.ts::Admin' && e.target === 'User')).toBe(true);
  });

  it('should derive TESTED_BY edges from test file imports', () => {
    const graph: RawGraph = {
      functions: [], classes: [], interfaces: [], enums: [],
      imports: [], reExports: [], diMaps: new Map(),
      tests: [{ name: 'test auth', file: 'tests/auth.test.ts', line_start: 1, line_end: 5, qualified: 'tests/auth.test.ts::test:test auth' }],
    };
    const importEdges: ImportEdge[] = [
      { source: 'tests/auth.test.ts', target: 'src/auth.ts', resolved: true, line: 1 },
    ];
    const result = deriveEdges(graph, importEdges);
    expect(result.testedBy.some(e => e.source === 'src/auth.ts' && e.target === 'tests/auth.test.ts')).toBe(true);
  });

  it('should derive CONTAINS edges for functions in files', () => {
    const graph: RawGraph = {
      classes: [], interfaces: [], enums: [], tests: [],
      imports: [], reExports: [], diMaps: new Map(),
      functions: [
        { name: 'foo', file: 'src/a.ts', line_start: 1, line_end: 5, params: '()', returnType: '', kind: 'Function', className: '', qualified: 'src/a.ts::foo' },
      ],
    };
    const result = deriveEdges(graph, []);
    expect(result.contains.some(e => e.source === 'src/a.ts' && e.target === 'src/a.ts::foo')).toBe(true);
  });

  it('should derive IMPLEMENTS edges from class implements', () => {
    const graph: RawGraph = {
      functions: [], interfaces: [], enums: [], tests: [],
      imports: [], reExports: [], diMaps: new Map(),
      classes: [
        { name: 'AuthService', file: 'src/auth.ts', line_start: 1, line_end: 50, extends: '', implements: 'IAuthService', qualified: 'src/auth.ts::AuthService' },
      ],
    };
    const result = deriveEdges(graph, []);
    expect(result.implements.some(e => e.source === 'src/auth.ts::AuthService' && e.target === 'IAuthService')).toBe(true);
  });
});

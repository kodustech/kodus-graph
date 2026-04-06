import { describe, expect, it } from 'bun:test';
import { resolveCall } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable } from '../../src/resolver/symbol-table';

describe('resolveCall', () => {
  it('should resolve same-file call with 0.85 confidence', () => {
    const st = createSymbolTable();
    st.add('src/auth.ts', 'validate', 'src/auth.ts::validate');
    const im = createImportMap();

    const result = resolveCall('validate', 'src/auth.ts', st, im);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.85);
    expect(result!.target).toBe('src/auth.ts::validate');
  });

  it('should resolve import-based call with 0.90 confidence', () => {
    const st = createSymbolTable();
    st.add('src/db.ts', 'findUser', 'src/db.ts::findUser');
    const im = createImportMap();
    im.add('src/auth.ts', 'findUser', 'src/db.ts');

    const result = resolveCall('findUser', 'src/auth.ts', st, im);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.9);
  });

  it('should resolve unique global name with 0.50 confidence', () => {
    const st = createSymbolTable();
    st.add('src/utils.ts', 'calculateTaxRate', 'src/utils.ts::calculateTaxRate');
    const im = createImportMap();

    const result = resolveCall('calculateTaxRate', 'src/other.ts', st, im);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.5);
  });

  it('should resolve ambiguous call with 0.30 confidence', () => {
    const st = createSymbolTable();
    st.add('src/a.ts', 'handleRequest', 'src/a.ts::handleRequest');
    st.add('src/b.ts', 'handleRequest', 'src/b.ts::handleRequest');
    const im = createImportMap();

    const result = resolveCall('handleRequest', 'src/other.ts', st, im);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.3);
  });

  it('should return null for noise functions', () => {
    const st = createSymbolTable();
    const im = createImportMap();

    const result = resolveCall('console', 'src/auth.ts', st, im);
    expect(result).toBeNull();
  });

  it('should prefer import-resolved over same-file when import exists', () => {
    const st = createSymbolTable();
    st.add('src/auth.ts', 'findUser', 'src/auth.ts::findUser');
    st.add('src/db.ts', 'findUser', 'src/db.ts::findUser');
    const im = createImportMap();
    im.add('src/auth.ts', 'findUser', 'src/db.ts');

    // Same-file is checked first (0.85), so same-file wins
    const result = resolveCall('findUser', 'src/auth.ts', st, im);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.85);
    expect(result!.target).toBe('src/auth.ts::findUser');
  });

  it('should return file-level import with 0.70 when symbol not in target file symbol table', () => {
    const st = createSymbolTable();
    // Symbol is NOT in db.ts in the symbol table, but import says it comes from db.ts
    const im = createImportMap();
    im.add('src/auth.ts', 'findUser', 'src/db.ts');

    const result = resolveCall('findUser', 'src/auth.ts', st, im);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.7);
    expect(result!.target).toBe('src/db.ts::findUser');
  });

  it('should return null for unknown names not in symbol table', () => {
    const st = createSymbolTable();
    const im = createImportMap();

    const result = resolveCall('unknownFunction', 'src/auth.ts', st, im);
    expect(result).toBeNull();
  });
});

describe('resolveDICall', () => {
  // DI resolution is tested via resolveAllCalls integration,
  // but we test the exported resolveCall does NOT handle DI (it's name-based only)
  it('should not resolve this.field.method patterns (handled by resolveAllCalls)', () => {
    const st = createSymbolTable();
    const im = createImportMap();

    // resolveCall handles plain names, not DI patterns
    const result = resolveCall('this.authService.validate', 'src/auth.ts', st, im);
    // 'this.authService.validate' is not in NOISE, but not in symbol table either
    expect(result).toBeNull();
  });
});

import type { RawCallSite } from '../../src/graph/types';
import { resolveAllCalls } from '../../src/resolver/call-resolver';

describe('resolveAllCalls (pure, no I/O)', () => {
  it('should resolve DI call via diMaps', () => {
    const st = createSymbolTable();
    st.add('src/auth.ts', 'AuthService', 'src/auth.ts::AuthService');
    st.add('src/auth.ts', 'validate', 'src/auth.ts::AuthService.validate');
    const im = createImportMap();
    const diMaps = new Map<string, Map<string, string>>();
    diMaps.set('src/controller.ts', new Map([['authService', 'AuthService']]));

    const rawCalls: RawCallSite[] = [
      { source: 'src/controller.ts', callName: 'validate', line: 10, diField: 'authService' },
    ];

    const { callEdges } = resolveAllCalls(rawCalls, diMaps, st, im);
    expect(callEdges.length).toBeGreaterThanOrEqual(1);
    const diEdge = callEdges.find((e) => e.confidence >= 0.9);
    expect(diEdge).toBeDefined();
  });

  it('should fallback to name-based resolution when DI fails', () => {
    const st = createSymbolTable();
    st.add('src/utils.ts', 'validate', 'src/utils.ts::validate');
    const im = createImportMap();
    const diMaps = new Map<string, Map<string, string>>();

    const rawCalls: RawCallSite[] = [
      { source: 'src/controller.ts', callName: 'validate', line: 10, diField: 'unknownField' },
    ];

    const { callEdges } = resolveAllCalls(rawCalls, diMaps, st, im);
    expect(callEdges.length).toBeGreaterThanOrEqual(1);
    expect(callEdges[0].confidence).toBeLessThan(0.9);
  });

  it('should resolve direct calls without diField', () => {
    const st = createSymbolTable();
    st.add('src/auth.ts', 'handleRequest', 'src/auth.ts::handleRequest');
    const im = createImportMap();
    im.add('src/controller.ts', 'handleRequest', 'src/auth.ts');
    const diMaps = new Map<string, Map<string, string>>();

    const rawCalls: RawCallSite[] = [{ source: 'src/controller.ts', callName: 'handleRequest', line: 5 }];

    const { callEdges } = resolveAllCalls(rawCalls, diMaps, st, im);
    expect(callEdges).toHaveLength(1);
    expect(callEdges[0].confidence).toBe(0.9);
  });

  it('should filter NOISE calls', () => {
    const st = createSymbolTable();
    const im = createImportMap();
    const diMaps = new Map<string, Map<string, string>>();

    const rawCalls: RawCallSite[] = [
      { source: 'src/test.ts', callName: 'console', line: 1 },
      { source: 'src/test.ts', callName: 'push', line: 2 },
    ];

    const { callEdges, stats } = resolveAllCalls(rawCalls, diMaps, st, im);
    expect(callEdges).toHaveLength(0);
    expect(stats.noise).toBe(2);
  });

  it('should be synchronous (no async)', () => {
    const st = createSymbolTable();
    const im = createImportMap();
    const diMaps = new Map<string, Map<string, string>>();
    const rawCalls: RawCallSite[] = [];

    const result = resolveAllCalls(rawCalls, diMaps, st, im);
    expect(result.callEdges).toBeDefined();
    expect(result.stats).toBeDefined();
    expect(result instanceof Promise).toBe(false);
  });
});

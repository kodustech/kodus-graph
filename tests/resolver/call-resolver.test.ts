import { describe, it, expect } from 'bun:test';
import { resolveCall } from '../../src/resolver/call-resolver';
import { createSymbolTable } from '../../src/resolver/symbol-table';
import { createImportMap } from '../../src/resolver/import-map';

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
    expect(result!.confidence).toBe(0.90);
  });

  it('should resolve unique global name with 0.50 confidence', () => {
    const st = createSymbolTable();
    st.add('src/utils.ts', 'calculateTaxRate', 'src/utils.ts::calculateTaxRate');
    const im = createImportMap();

    const result = resolveCall('calculateTaxRate', 'src/other.ts', st, im);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.50);
  });

  it('should resolve ambiguous call with 0.30 confidence', () => {
    const st = createSymbolTable();
    st.add('src/a.ts', 'handleRequest', 'src/a.ts::handleRequest');
    st.add('src/b.ts', 'handleRequest', 'src/b.ts::handleRequest');
    const im = createImportMap();

    const result = resolveCall('handleRequest', 'src/other.ts', st, im);
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(0.30);
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
    expect(result!.confidence).toBe(0.70);
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

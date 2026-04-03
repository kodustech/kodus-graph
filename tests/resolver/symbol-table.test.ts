import { describe, it, expect } from 'bun:test';
import { createSymbolTable } from '../../src/resolver/symbol-table';

describe('SymbolTable', () => {
  it('should add and lookup exact symbols', () => {
    const st = createSymbolTable();
    st.add('src/auth.ts', 'AuthService', 'src/auth.ts::AuthService');
    expect(st.lookupExact('src/auth.ts', 'AuthService')).toBe('src/auth.ts::AuthService');
  });

  it('should return null for missing symbol', () => {
    const st = createSymbolTable();
    expect(st.lookupExact('src/auth.ts', 'Missing')).toBeNull();
  });

  it('should track uniqueness', () => {
    const st = createSymbolTable();
    st.add('src/a.ts', 'foo', 'src/a.ts::foo');
    expect(st.isUnique('foo')).toBe(true);

    st.add('src/b.ts', 'foo', 'src/b.ts::foo');
    expect(st.isUnique('foo')).toBe(false);
  });

  it('should return global candidates', () => {
    const st = createSymbolTable();
    st.add('src/a.ts', 'bar', 'src/a.ts::bar');
    st.add('src/b.ts', 'bar', 'src/b.ts::bar');
    expect(st.lookupGlobal('bar')).toHaveLength(2);
  });

  it('should track size correctly', () => {
    const st = createSymbolTable();
    expect(st.size).toBe(0);
    expect(st.fileCount).toBe(0);

    st.add('src/a.ts', 'foo', 'src/a.ts::foo');
    st.add('src/a.ts', 'bar', 'src/a.ts::bar');
    st.add('src/b.ts', 'baz', 'src/b.ts::baz');

    expect(st.size).toBe(3);
    expect(st.fileCount).toBe(2);
  });
});

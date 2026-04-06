import { describe, expect, it } from 'bun:test';
import { getLanguage, getSupportedExtensions } from '../../src/parser/languages';

describe('getLanguage', () => {
  it('should return TypeScript for .ts', () => {
    expect(getLanguage('.ts')).toBeDefined();
  });

  it('should return python for .py', () => {
    expect(getLanguage('.py')).toBe('python');
  });

  it('should return null for unsupported extension', () => {
    expect(getLanguage('.txt')).toBeNull();
  });
});

describe('getSupportedExtensions', () => {
  it('should return 9+ extensions', () => {
    const exts = getSupportedExtensions();
    expect(exts.length).toBeGreaterThanOrEqual(9);
    expect(exts).toContain('.ts');
    expect(exts).toContain('.py');
    expect(exts).toContain('.go');
  });
});

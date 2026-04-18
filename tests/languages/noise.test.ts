import { describe, expect, it } from 'bun:test';
import { getNoiseFor, registerNoise } from '../../src/languages/noise-registry';
// Side-effect imports — mirrors how the resolver will pull them.
import '../../src/languages/go';
import '../../src/languages/java';
import '../../src/languages/python';
import '../../src/languages/ruby';
import '../../src/languages/typescript';

describe('per-language NOISE registry', () => {
    it('returns the TypeScript noise set for TypeScript language', () => {
        const noise = getNoiseFor('TypeScript');
        expect(noise.has('log')).toBe(true);
        expect(noise.has('useEffect')).toBe(true);
        // Python-only noise must NOT appear in TS list
        expect(noise.has('print')).toBe(false);
    });

    it('returns the Python noise set for Python language', () => {
        const noise = getNoiseFor('python');
        expect(noise.has('print')).toBe(true);
        expect(noise.has('enumerate')).toBe(true);
        // TS-only noise must NOT appear in Python list
        expect(noise.has('useEffect')).toBe(false);
    });

    it('returns the Ruby noise set for Ruby language', () => {
        const noise = getNoiseFor('ruby');
        expect(noise.has('puts')).toBe(true);
        expect(noise.has('attr_accessor')).toBe(true);
    });

    it('returns the Go noise set for Go language', () => {
        const noise = getNoiseFor('go');
        expect(noise.has('Println')).toBe(true);
        expect(noise.has('panic')).toBe(true);
    });

    it('returns the Java noise set for Java language', () => {
        const noise = getNoiseFor('java');
        expect(noise.has('println')).toBe(true);
        expect(noise.has('equals')).toBe(true);
    });

    it('returns an empty set when language is unregistered', () => {
        expect(getNoiseFor('Klingon').size).toBe(0);
    });

    it('JavaScript shares the TypeScript noise set', () => {
        const js = getNoiseFor('JavaScript');
        const ts = getNoiseFor('TypeScript');
        expect(js.size).toBe(ts.size);
        expect(js.has('log')).toBe(true);
    });

    it('registerNoise replaces previous entry for the same language', () => {
        // Use a synthetic language key so we don't disturb real entries that
        // other test files depend on (the registry is a process-wide singleton).
        registerNoise('TestLang_replace', new Set(['a']));
        registerNoise('TestLang_replace', new Set(['b']));
        expect(getNoiseFor('TestLang_replace').has('b')).toBe(true);
        expect(getNoiseFor('TestLang_replace').has('a')).toBe(false);
    });
});

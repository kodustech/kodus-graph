import { describe, expect, it } from 'bun:test';
import { languageOfFile } from '../../src/languages/language-of-file';

describe('languageOfFile', () => {
    it('maps .ts to TypeScript (capitalized)', () => {
        expect(languageOfFile('src/foo.ts')).toBe('TypeScript');
    });

    it('maps .tsx to Tsx (capitalized)', () => {
        expect(languageOfFile('src/foo.tsx')).toBe('Tsx');
    });

    it('maps .js / .jsx / .mjs / .cjs / .es6 to JavaScript', () => {
        expect(languageOfFile('src/foo.js')).toBe('JavaScript');
        expect(languageOfFile('src/foo.jsx')).toBe('JavaScript');
        expect(languageOfFile('src/foo.mjs')).toBe('JavaScript');
        expect(languageOfFile('src/foo.cjs')).toBe('JavaScript');
        expect(languageOfFile('src/foo.es6')).toBe('JavaScript');
    });

    it('maps .py to python (lowercase)', () => {
        expect(languageOfFile('src/foo.py')).toBe('python');
    });

    it('maps .rb to ruby (lowercase)', () => {
        expect(languageOfFile('src/foo.rb')).toBe('ruby');
    });

    it('maps .cpp / .cc / .cxx / .hpp / .hh to cpp', () => {
        expect(languageOfFile('src/foo.cpp')).toBe('cpp');
        expect(languageOfFile('src/foo.cc')).toBe('cpp');
        expect(languageOfFile('src/foo.cxx')).toBe('cpp');
        expect(languageOfFile('src/foo.hpp')).toBe('cpp');
        expect(languageOfFile('src/foo.hh')).toBe('cpp');
    });

    it('maps .c and .h to c', () => {
        expect(languageOfFile('src/foo.c')).toBe('c');
        expect(languageOfFile('src/foo.h')).toBe('c');
    });

    it('maps .scala and .sc to scala', () => {
        expect(languageOfFile('src/foo.scala')).toBe('scala');
        expect(languageOfFile('src/foo.sc')).toBe('scala');
    });

    it('maps .kt / .kts to kotlin', () => {
        expect(languageOfFile('src/foo.kt')).toBe('kotlin');
        expect(languageOfFile('src/foo.kts')).toBe('kotlin');
    });

    it('maps .ex / .exs to elixir', () => {
        expect(languageOfFile('src/foo.ex')).toBe('elixir');
        expect(languageOfFile('src/foo.exs')).toBe('elixir');
    });

    it('is case-insensitive on the extension', () => {
        expect(languageOfFile('src/FOO.TS')).toBe('TypeScript');
        expect(languageOfFile('src/foo.PY')).toBe('python');
    });

    it('returns null for unknown extensions', () => {
        expect(languageOfFile('README.md')).toBeNull();
        expect(languageOfFile('package.json')).toBeNull();
        expect(languageOfFile('src/weird.xyz')).toBeNull();
    });

    it('returns null when there is no extension', () => {
        expect(languageOfFile('Makefile')).toBeNull();
        expect(languageOfFile('src/noext')).toBeNull();
    });
});

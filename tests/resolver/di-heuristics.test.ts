import { describe, expect, it } from 'bun:test';
import { getDIHeuristicsFor } from '../../src/languages/engine';
import '../../src/languages/typescript';
import '../../src/languages/csharp';
import '../../src/languages/java';
import '../../src/languages/kotlin';
import '../../src/languages/scala';
import '../../src/languages/php';
import '../../src/languages/go';
import '../../src/languages/python';
import '../../src/languages/rust';

describe('per-language DI heuristics', () => {
    it('TypeScript: I-prefix maps to dropped-prefix impl', () => {
        const h = getDIHeuristicsFor('TypeScript');
        expect(h).not.toBeNull();
        expect(h!('IUserService')).toEqual(['UserService']);
        expect(h!('IOrder')).toEqual(['Order']);
        expect(h!('UserService')).toEqual([]);
    });

    it('JavaScript and Tsx share the TS heuristic', () => {
        expect(getDIHeuristicsFor('JavaScript')!('IFoo')).toEqual(['Foo']);
        expect(getDIHeuristicsFor('Tsx')!('IFoo')).toEqual(['Foo']);
    });

    it('C# uses the same I-prefix convention', () => {
        const h = getDIHeuristicsFor('csharp');
        expect(h!('IUserService')).toEqual(['UserService']);
    });

    it('Java: bare interface maps to ImplSuffix and DefaultPrefix', () => {
        const h = getDIHeuristicsFor('java');
        expect(h!('UserService')).toEqual(['UserServiceImpl', 'DefaultUserService']);
    });

    it('Kotlin reuses Java convention', () => {
        const h = getDIHeuristicsFor('kotlin');
        expect(h!('UserService')).toEqual(['UserServiceImpl', 'DefaultUserService']);
    });

    it('Scala reuses Java convention', () => {
        const h = getDIHeuristicsFor('scala');
        expect(h!('UserService')).toEqual(['UserServiceImpl', 'DefaultUserService']);
    });

    it('PHP reuses Java convention', () => {
        const h = getDIHeuristicsFor('php');
        expect(h!('UserService')).toEqual(['UserServiceImpl', 'DefaultUserService']);
    });

    it('Go: -er suffix drops to root; otherwise prefixes with Default', () => {
        const h = getDIHeuristicsFor('go');
        expect(h!('Reader')).toContain('Read');
        expect(h!('Reader')).toContain('DefaultReader');
        expect(h!('Storage')).toEqual(['DefaultStorage']);
    });

    it('Python, Rust return null (no convention)', () => {
        expect(getDIHeuristicsFor('python')).toBeNull();
        expect(getDIHeuristicsFor('rust')).toBeNull();
    });

    it('unknown language returns null', () => {
        expect(getDIHeuristicsFor('Klingon')).toBeNull();
    });
});

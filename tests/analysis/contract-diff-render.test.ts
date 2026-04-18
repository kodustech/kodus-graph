import { describe, expect, it } from 'bun:test';
import { renderParamsDiff, renderReturnTypeDiff, tokenizeTopLevel } from '../../src/analysis/contract-diff-render';

describe('tokenizeTopLevel', () => {
    it('splits a plain param list', () => {
        expect(tokenizeTopLevel('(a: string, b: number)')).toEqual(['a: string', 'b: number']);
    });

    it('respects nested generics <>', () => {
        expect(tokenizeTopLevel('(a: Map<string, number>, b: number)')).toEqual([
            'a: Map<string, number>',
            'b: number',
        ]);
    });

    it('respects nested object types {}', () => {
        expect(tokenizeTopLevel('(a: { x: number, y: number }, b: string)')).toEqual([
            'a: { x: number, y: number }',
            'b: string',
        ]);
    });

    it('respects nested tuple/array []', () => {
        expect(tokenizeTopLevel('(a: [number, string], b: boolean)')).toEqual(['a: [number, string]', 'b: boolean']);
    });

    it('handles empty params', () => {
        expect(tokenizeTopLevel('()')).toEqual([]);
    });
});

describe('renderParamsDiff', () => {
    it('simple case: short single-line → "before → after"', () => {
        const r = renderParamsDiff('(a: string)', '(a: string, b: number)');
        expect(r.mode).toBe('simple');
        expect(r.text).toBe('(a: string) → (a: string, b: number)');
    });

    it('long case: added param → token diff', () => {
        const before =
            '(context: ReviewContext, config: ReviewConfig, options: { tier: string, mode: string, priority: number })';
        const after =
            '(context: ReviewContext, config: ReviewConfig, options: { tier: string, mode: string, priority: number }, byokConfig?: BYOKConfig)';
        const r = renderParamsDiff(before, after);
        expect(r.mode).toBe('token');
        expect(r.added).toEqual(['byokConfig?: BYOKConfig']);
        expect(r.removed).toEqual([]);
    });

    it('long case: type change on existing param → removed+added of same name', () => {
        const before = '(severity: SeverityLevel, other: LongTypeName<A, B, C>)';
        const after = '(severity: string, other: LongTypeName<A, B, C>)';
        const r = renderParamsDiff(before, after);
        if (r.mode === 'token') {
            expect(r.removed).toEqual(['severity: SeverityLevel']);
            expect(r.added).toEqual(['severity: string']);
        } else {
            expect(r.text).toContain('SeverityLevel');
            expect(r.text).toContain('severity: string');
        }
    });

    it('multiline input → always token mode', () => {
        const before = '(\n    a: string,\n    b: number,\n)';
        const after = '(\n    a: string,\n    b: number,\n    c: boolean,\n)';
        const r = renderParamsDiff(before, after);
        expect(r.mode).toBe('token');
        expect(r.added).toEqual(['c: boolean']);
    });
});

describe('renderReturnTypeDiff', () => {
    it('simple short → "before → after"', () => {
        const r = renderReturnTypeDiff('Promise<User>', 'Promise<User | null>');
        expect(r.mode).toBe('simple');
        expect(r.text).toBe('Promise<User> → Promise<User | null>');
    });

    it('long → before/after labeled lines', () => {
        const before = 'Promise<UserResult<SomeVeryLongGenericArgs, AndAnotherOne, AndAThirdOne, AndOneMore>>';
        const after = 'Promise<UserResult<SomeVeryLongGenericArgs, AndAnotherOne, AndAThirdOne, AndOneMore> | null>';
        const r = renderReturnTypeDiff(before, after);
        expect(r.mode).toBe('long');
        expect(r.text).toContain('before:');
        expect(r.text).toContain('after:');
    });
});

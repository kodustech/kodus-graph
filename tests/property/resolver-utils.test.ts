import { describe, expect, test } from 'bun:test';
import * as fc from 'fast-check';
import { tokenizeTopLevel } from '../../src/analysis/contract-diff-render';
import { normalizeParams } from '../../src/analysis/diff';
import { pickClosestCandidate } from '../../src/resolver/call-resolver';

// ---------------------------------------------------------------------------
// tokenizeTopLevel — splits param strings on top-level commas, ignoring
// commas inside bracket pairs.
// ---------------------------------------------------------------------------

describe('property: tokenizeTopLevel', () => {
    test('every token has balanced brackets', () => {
        // Build random param strings with bracket pairs and commas.
        const balanced = fc.letrec((tie) => ({
            atom: fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9]*$/),
            wrapped: fc.tuple(fc.constantFrom('()', '[]', '{}', '<>'), tie('expr')).map(([brk, inner]) => {
                return brk[0] + (inner as string) + brk[1];
            }),
            expr: fc.oneof(
                { withCrossShrink: true },
                tie('atom'),
                tie('wrapped'),
                fc.tuple(tie('expr'), tie('expr')).map(([a, b]) => `${a}, ${b}`),
            ),
        }));
        fc.assert(
            fc.property(balanced.expr, (raw) => {
                const wrapped = `(${raw})`;
                const tokens = tokenizeTopLevel(wrapped);
                for (const tok of tokens) {
                    let depth = 0;
                    for (const ch of tok) {
                        if (ch === '(' || ch === '[' || ch === '{' || ch === '<') {
                            depth++;
                        } else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') {
                            depth--;
                        }
                        if (depth < 0) {
                            return false;
                        }
                    }
                    if (depth !== 0) {
                        return false;
                    }
                }
                return true;
            }),
            { numRuns: 200 },
        );
    });

    test('empty / whitespace-only inputs yield []', () => {
        fc.assert(
            fc.property(fc.stringMatching(/^[\s]*$/), (s) => {
                expect(tokenizeTopLevel(`(${s})`)).toEqual([]);
            }),
        );
    });

    test('idempotent under wrap/unwrap when input has no top-level commas', () => {
        // For an atom (no top-level comma), tokenize → [atom].
        fc.assert(
            fc.property(
                fc.stringMatching(/^[a-zA-Z][a-zA-Z0-9 :]*$/).filter((s) => s.trim().length > 0),
                (atom) => {
                    expect(tokenizeTopLevel(`(${atom})`)).toEqual([atom.trim()]);
                },
            ),
        );
    });
});

// ---------------------------------------------------------------------------
// normalizeParams — collapses whitespace, strips trailing commas, removes
// leading underscore at name-position. Used for cross-language equality.
// ---------------------------------------------------------------------------

describe('property: normalizeParams', () => {
    test('idempotent (normalize twice = normalize once)', () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 200 }), (s) => {
                const once = normalizeParams(s);
                const twice = normalizeParams(once);
                expect(twice).toBe(once);
            }),
            { numRuns: 200 },
        );
    });

    test('never produces double whitespace', () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 200 }), (s) => {
                expect(normalizeParams(s)).not.toMatch(/ {2,}/);
            }),
            { numRuns: 200 },
        );
    });

    test('result is trimmed', () => {
        fc.assert(
            fc.property(fc.string({ maxLength: 200 }), (s) => {
                const result = normalizeParams(s);
                if (result.length === 0) {
                    return;
                }
                expect(result).toBe(result.trim());
            }),
            { numRuns: 200 },
        );
    });

    test('undefined and empty input both produce empty string', () => {
        expect(normalizeParams(undefined)).toBe('');
        expect(normalizeParams('')).toBe('');
    });
});

// ---------------------------------------------------------------------------
// pickClosestCandidate — proximity-based candidate ranking.
// ---------------------------------------------------------------------------

const fileSegment = fc.stringMatching(/^[a-z][a-z0-9_-]{0,8}$/);
const filePath = fc
    .array(fileSegment, { minLength: 1, maxLength: 5 })
    .chain((segs) => fileSegment.map((tail) => `${segs.join('/')}/${tail}.ts`));

describe('property: pickClosestCandidate', () => {
    test('result is always one of the input candidates', () => {
        fc.assert(
            fc.property(fc.array(filePath, { minLength: 1, maxLength: 8 }), filePath, (candidates, caller) => {
                const result = pickClosestCandidate(candidates, caller);
                expect(candidates).toContain(result);
            }),
            { numRuns: 200 },
        );
    });

    test('with a single candidate, always returns it', () => {
        fc.assert(
            fc.property(filePath, filePath, (candidate, caller) => {
                expect(pickClosestCandidate([candidate], caller)).toBe(candidate);
            }),
            { numRuns: 100 },
        );
    });

    test('deterministic — same inputs produce same output', () => {
        fc.assert(
            fc.property(fc.array(filePath, { minLength: 1, maxLength: 6 }), filePath, (candidates, caller) => {
                const a = pickClosestCandidate(candidates, caller);
                const b = pickClosestCandidate(candidates, caller);
                expect(a).toBe(b);
            }),
            { numRuns: 100 },
        );
    });

    test('a sibling in the caller dir always wins over candidates in other dirs', () => {
        fc.assert(
            fc.property(
                fc.tuple(fileSegment, fileSegment, fileSegment, fileSegment),
                ([dir, callerName, siblingName, otherName]) => {
                    fc.pre(callerName !== siblingName);
                    fc.pre(dir !== otherName);
                    const caller = `${dir}/${callerName}.ts`;
                    const sibling = `${dir}/${siblingName}.ts::sym`;
                    const other = `${otherName}/x/${callerName}.ts::sym`;
                    expect(pickClosestCandidate([other, sibling], caller)).toBe(sibling);
                    expect(pickClosestCandidate([sibling, other], caller)).toBe(sibling);
                },
            ),
            { numRuns: 100 },
        );
    });
});

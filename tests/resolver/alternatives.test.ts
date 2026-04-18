import { describe, expect, it } from 'bun:test';
import type { RawCallSite } from '../../src/graph/types';
// Required for noise routing — keeps the test self-contained against the
// production resolver path.
import '../../src/languages/typescript';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable, type SymbolTable } from '../../src/resolver/symbol-table';

function seedDefinitions(table: SymbolTable, qualifiedNames: string[]): void {
    for (const q of qualifiedNames) {
        const [file, symbol] = q.includes('::') ? q.split('::') : [q, q];
        const name = symbol.includes('.') ? symbol.split('.').pop()! : symbol;
        table.add(file, name, q);
    }
}

describe('alternatives on ambiguous CALLS', () => {
    it('records the non-picked candidates when ambiguity resolves at 0.30', () => {
        const table = createSymbolTable();
        // Three candidates, all in unrelated modules — triggers ambiguous tier.
        // The picked one depends on proximity from src/caller.ts.
        seedDefinitions(table, [
            'src/feature/m1.ts::validate',
            'src/feature/m2.ts::validate',
            'src/feature/m3.ts::validate',
        ]);
        const rawCalls: RawCallSite[] = [{ source: 'src/caller.ts', callName: 'validate', line: 1 }];
        const { callEdges } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(callEdges.length).toBe(1);
        expect(callEdges[0].confidence).toBe(0.3);
        expect(callEdges[0].alternatives).toBeDefined();
        expect(callEdges[0].alternatives!.length).toBe(2);
        for (const alt of callEdges[0].alternatives!) {
            expect(alt).not.toBe(callEdges[0].target);
        }
    });

    it('does NOT populate alternatives at same-file tier (0.85)', () => {
        const table = createSymbolTable();
        seedDefinitions(table, ['src/caller.ts::helper']);
        const rawCalls: RawCallSite[] = [{ source: 'src/caller.ts', callName: 'helper', line: 1 }];
        const { callEdges } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(callEdges[0].confidence).toBe(0.85);
        expect(callEdges[0].alternatives).toBeUndefined();
    });

    it('does NOT populate alternatives at unique tier (0.50)', () => {
        const table = createSymbolTable();
        // Single global candidate — unique tier.
        seedDefinitions(table, ['src/other.ts::uniqueFn']);
        const rawCalls: RawCallSite[] = [{ source: 'src/caller.ts', callName: 'uniqueFn', line: 1 }];
        const { callEdges } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(callEdges[0].confidence).toBeGreaterThanOrEqual(0.5);
        expect(callEdges[0].alternatives).toBeUndefined();
    });

    it('emits alternatives in deterministic (sorted) order regardless of insertion order', () => {
        // Seed candidates in a non-alphabetical order. If we relied on
        // `lookupGlobal` insertion order the alternatives array would mirror
        // this ordering, which varies by OS/filesystem traversal. Sorting at
        // emit time locks in a stable order so graph snapshots don't churn.
        const rawCalls: RawCallSite[] = [{ source: 'src/caller.ts', callName: 'validate', line: 1 }];

        const run = (): string[] => {
            const table = createSymbolTable();
            seedDefinitions(table, ['src/zebra.ts::validate', 'src/alpha.ts::validate', 'src/midway.ts::validate']);
            const { callEdges } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
            expect(callEdges[0].alternatives).toBeDefined();
            return callEdges[0].alternatives!;
        };

        const first = run();
        const second = run();
        // Identical between runs — proves determinism.
        expect(first).toEqual(second);
        // And specifically in lexicographic sorted order.
        const sorted = [...first].sort();
        expect(first).toEqual(sorted);
    });
});

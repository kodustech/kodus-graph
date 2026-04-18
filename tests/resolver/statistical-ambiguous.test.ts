import { describe, expect, it } from 'bun:test';
import type { RawCallSite } from '../../src/graph/types';
// Required for noise routing (Task 7) — not strictly needed for ambiguity, but
// keeps the test self-contained against the production resolver path.
import '../../src/languages/typescript';
import { resolveAllCalls } from '../../src/resolver/call-resolver';
import { createImportMap } from '../../src/resolver/import-map';
import { createSymbolTable } from '../../src/resolver/symbol-table';

function seedDefinitions(table: ReturnType<typeof createSymbolTable>, qualifiedNames: string[]): void {
    // The canonical registration API is `add(file, name, qualified)`. Derive
    // file and name from each qualified string so callers can pass
    // `src/foo.ts::name` pairs directly.
    for (const q of qualifiedNames) {
        const [file, symbol] = q.includes('::') ? q.split('::') : [q, q];
        // symbol may itself be `Class.method`; use the trailing segment as name.
        const name = symbol.includes('.') ? symbol.split('.').pop()! : symbol;
        table.add(file, name, q);
    }
}

describe('statistical ambiguous-noise', () => {
    it('drops calls whose name is defined in many files (codebase-ambiguous)', () => {
        const table = createSymbolTable();
        // 20 files all defining `validate` → triggers the statistical drop.
        seedDefinitions(
            table,
            Array.from({ length: 20 }, (_, i) => `src/m${i}.ts::validate`),
        );
        const rawCalls: RawCallSite[] = [{ source: 'src/caller.ts', callName: 'validate', line: 1 }];
        const { stats } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(stats.ambiguousNoise).toBe(1);
        expect(stats.ambiguous).toBe(0);
    });

    it('keeps calls when only a few files define the name (normal ambiguity)', () => {
        const table = createSymbolTable();
        // Only 2 files defining `validate` → still ambiguous at 0.30, not dropped.
        seedDefinitions(table, ['src/m1.ts::validate', 'src/m2.ts::validate']);
        const rawCalls: RawCallSite[] = [{ source: 'src/caller.ts', callName: 'validate', line: 1 }];
        const { stats, callEdges } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(stats.ambiguousNoise).toBe(0);
        expect(callEdges.length).toBe(1);
        expect(callEdges[0].confidence).toBe(0.3);
    });

    it('countDefinitions returns the number of distinct files, not occurrences', () => {
        const table = createSymbolTable();
        // Same qualified name registered twice → still counts as 1 file.
        seedDefinitions(table, ['src/a.ts::foo', 'src/a.ts::foo', 'src/b.ts::foo']);
        expect(table.countDefinitions('foo')).toBe(2);
    });
});

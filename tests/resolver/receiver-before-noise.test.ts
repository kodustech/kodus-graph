import { describe, expect, it } from 'bun:test';
// Ensure language noise lists are registered
import '../../src/languages/python';
import '../../src/languages/typescript';
import type { RawCallSite } from '../../src/graph/types';
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

describe('receiver-tier runs before noise filter', () => {
    it('user-domain call with noise-listed name (Python update) resolves at 0.95 when receiver is in symbol table', () => {
        const table = createSymbolTable();
        // User-defined class with update() method.
        seedDefinitions(table, ['src/service.py::UserService.update']);
        const rawCalls: RawCallSite[] = [
            { source: 'src/caller.py', callName: 'update', line: 1, receiverType: 'UserService' },
        ];
        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(stats.noise).toBe(0);
        expect(stats.receiver).toBe(1);
        expect(callEdges.length).toBe(1);
        expect(callEdges[0].confidence).toBe(0.95);
        expect(callEdges[0].target).toBe('src/service.py::UserService.update');
    });

    it('stdlib-looking call without receiver type still gets noise-filtered', () => {
        const table = createSymbolTable();
        const rawCalls: RawCallSite[] = [{ source: 'src/caller.py', callName: 'update', line: 1 }];
        const { stats } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(stats.noise).toBe(1);
        expect(stats.receiver).toBe(0);
    });

    it('receiver type inferred but no match in symbol table falls through to noise', () => {
        const table = createSymbolTable();
        // ExternalUser is NOT in the symbol table (external package).
        const rawCalls: RawCallSite[] = [
            { source: 'src/caller.py', callName: 'update', line: 1, receiverType: 'ExternalUser' },
        ];
        const { stats } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        // `update` is in Python noise; since no symbol-table match for
        // `ExternalUser.update`, the noise filter fires after receiver falls through.
        expect(stats.receiver).toBe(0);
        expect(stats.noise).toBe(1);
    });

    it('non-noise-listed call with receiver type still resolves at 0.95 (regression: Phase 3 behavior preserved)', () => {
        const table = createSymbolTable();
        seedDefinitions(table, ['src/foo.ts::Foo.doWork']);
        const rawCalls: RawCallSite[] = [{ source: 'src/caller.ts', callName: 'doWork', line: 1, receiverType: 'Foo' }];
        const { callEdges, stats } = resolveAllCalls(rawCalls, new Map(), table, createImportMap());
        expect(stats.receiver).toBe(1);
        expect(callEdges[0].confidence).toBe(0.95);
    });
});
